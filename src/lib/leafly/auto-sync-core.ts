/**
 * src/lib/leafly/auto-sync-core.ts  (SLICE L-41 -- "i can not get the auto
 * sync feature to turn on")
 *
 * ###########################################################################
 * # WHAT THE OWNER SAW, AND THE TWO DEFECTS BEHIND IT                       #
 * #                                                                         #
 * #   "when i save the settings, it says it saved, then the check button    #
 * #    tells me it did not save and did not turn on auto sync."             #
 * #                                                                         #
 * # DEFECT 1 -- THE READ. The save wrote `{ ..., schedule: { enabled: true  #
 * # } }`. Every reader then handed the WHOLE blob to the schedule resolver, #
 * # which looked for `enabled` at the top level, found nothing, and         #
 * # answered "off". Fixed in `readStoredLeaflySchedule` (sync-settings-core)#
 * #                                                                         #
 * # DEFECT 2 -- THE SEND. Fixing only the read would have produced          #
 * # something worse than a switch that does not stick: a switch that sticks #
 * # and then fails on every tick. The scheduler sent through                #
 * # `pushLeaflyMenu`, the all-or-nothing path behind the old "Push POST /   #
 * # Push PUT" buttons -- the ones the owner reports "throw errors when      #
 * # pressed". It refuses the whole menu when any product fails Leafly's     #
 * # contract. His menu has such products, so automation would have sent    #
 * # nothing, forever, and backed off.                                       #
 * #                                                                         #
 * # The owner told us which path works:                                     #
 * #                                                                         #
 * #   "the send the whole menu hold back the bad ones works great"          #
 * #                                                                         #
 * # So automatic runs now build their payload exactly the way that button   #
 * # does (`buildFullMenuDecision`: same feed, preflight, settings, optional #
 * # size repair, validator, withhold plan), and this module decides what to #
 * # transmit from it.                                                       #
 * ###########################################################################
 *
 * THE ONE RULE THAT SHAPES EVERYTHING BELOW
 * -----------------------------------------
 * Leafly Menu API v2 (docs/leafly-menu-api-v2.md, from the vendored spec):
 *
 *   POST  -- "replaces" the menu and DELETES ANY ITEM NOT IN THE PAYLOAD.
 *            Recommended once per day.
 *   PUT   -- update-or-insert, never deletes.
 *   DELETE-- body `{ ids: [...] }`, removes exactly those.
 *
 * A held-back product is, by definition, NOT in the payload. So a POST while
 * anything is held back would delete that product from the live Leafly menu.
 * The full-menu button never POSTs for that reason (full-menu-server.ts
 * header). This module applies the same rule and adds the other half:
 *
 *   - Daily full run, NOTHING held back  -> POST. The authoritative daily
 *     replace Leafly's certification checklist recommends.
 *   - Daily full run, something held back -> PUT every passing product, plus
 *     DELETE for products that genuinely left the menu. Never POST.
 *   - In-between run -> PUT only what changed, plus DELETE for products that
 *     genuinely left.
 *
 * "GENUINELY LEFT" -- THE DELETE RULE
 * -----------------------------------
 * An id we previously sent is deleted only when it is neither being sent now
 * NOR being held back now. A held-back product is still on the shop's menu;
 * it has a data problem. Deleting it from Leafly would punish the shopper for
 * a typo and is exactly what the withhold design exists to prevent. Its
 * stored hash is also left untouched, for the reason full-menu-server gives:
 * writing it would claim Leafly holds something it does not, and removing it
 * would make the NEXT run issue the DELETE this rule just refused.
 *
 * PURITY
 * ------
 * Zero imports. Pure functions of their arguments. Runs under plain `tsx`.
 * Registered with a floor in scripts/compliance/run-pure-selftests.ts.
 */

/* ========================================================================== */
/* Inputs                                                                     */
/* ========================================================================== */

/** Which scheduled decision this run is carrying out. */
export type AutoSyncKind = "daily_full" | "intraday_delta";

export type AutoSyncInput = {
  kind: AutoSyncKind;
  /**
   * Did the withhold plan allow a send at all? False when the plan refused
   * (too much of the menu failing, unattributable errors, nothing left).
   */
  planProceeds: boolean;
  /** The plan's own sentence, used verbatim when it refuses. */
  planNarrative: string;
  /** Products that pass, with the hash of exactly what would be sent. */
  send: ReadonlyArray<{ id: string; hash: string }>;
  /** Wire ids held back for failing Leafly's contract. */
  withheldIds: ReadonlyArray<string>;
  /** id -> hash of what Leafly last accepted from us (sync state). */
  previous: ReadonlyMap<string, string>;
  /** Owner's "resend everything" flag: defeats the no-change skip. */
  forceResend: boolean;
  /**
   * The product FAMILY an id belongs to. The size repair lists one product as
   * several Leafly items (`parent--slug`), so the same shop product can be on
   * Leafly under a different id than the one being judged today -- e.g. the
   * repair was on yesterday and is off today. A held-back product protects
   * its whole family from deletion (A2b). The server passes
   * `splitParentId(id) ?? id`; this module stays import-free, so it is
   * injected. Absent means "every id is its own family".
   */
  familyOf?: (id: string) => string;
};

/* ========================================================================== */
/* Output                                                                     */
/* ========================================================================== */

export type AutoSyncAction =
  /** Nothing is transmitted; the plan refused. Reported as a failure. */
  | "refuse"
  /** Nothing is transmitted because Leafly already holds exactly this. */
  | "skip"
  /** Replace the whole menu. Only ever chosen with nothing held back. */
  | "post"
  /** Upsert, then DELETE what genuinely left. */
  | "put";

export type AutoSyncPlan = {
  action: AutoSyncAction;
  /** Ids to POST (the entire passing menu) -- empty unless action is post. */
  postIds: string[];
  /** Ids to PUT -- empty unless action is put. */
  putIds: string[];
  /** Ids to DELETE after a successful PUT -- empty unless action is put. */
  deleteIds: string[];
  /** Held-back ids whose stored hash is deliberately left untouched. */
  protectedIds: string[];
  counts: {
    creates: number;
    updates: number;
    unchanged: number;
    deletes: number;
    withheld: number;
  };
  /**
   * True when a daily run had to use PUT instead of POST because products
   * were held back. Surfaced to the owner, because it means Leafly did not
   * receive its recommended daily replace, and why.
   */
  postDowngraded: boolean;
  /** One line for the run history. */
  summary: string;
  /** A sentence for the owner, in his words rather than HTTP verbs. */
  reason: string;
};

/* ========================================================================== */
/* The decision                                                               */
/* ========================================================================== */

function clean(ids: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id.length > 0) out.add(id);
  }
  return [...out].sort();
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Decide what an automatic run transmits.
 *
 * Invariants (each pinned by a self-test below):
 *   A1  A POST is never chosen while anything is held back.
 *   A2  A held-back id is never deleted and never appears in any send list.
 *   A3  Every id deleted was previously sent and is neither sent nor held now.
 *   A4  A refusing plan transmits nothing.
 *   A5  A daily POST sends the ENTIRE passing menu, not a delta (POST deletes
 *       whatever it omits, so a delta POST would wipe the unchanged items).
 *   A6  "Nothing changed" skips only when there is truly nothing to create,
 *       update or delete, and never when the owner forced a resend.
 */
export function planAutomaticTransmission(input: AutoSyncInput): AutoSyncPlan {
  const withheld = clean(input.withheldIds);
  const withheldSet = new Set(withheld);

  // A2, belt and braces: a product the plan listed as BOTH passing and
  // withheld is treated as withheld. The plan cannot produce that today;
  // if it ever did, the conservative reading is the one that does not
  // publish a product we were told is broken.
  const send = new Map<string, string>();
  for (const s of input.send) {
    const id = typeof s.id === "string" ? s.id.trim() : "";
    if (id.length === 0 || withheldSet.has(id)) continue;
    send.set(id, String(s.hash ?? ""));
  }
  const sendIds = [...send.keys()].sort();

  const creates: string[] = [];
  const updates: string[] = [];
  const unchanged: string[] = [];
  for (const id of sendIds) {
    const prev = input.previous.get(id);
    if (prev === undefined) creates.push(id);
    else if (prev !== send.get(id)) updates.push(id);
    else unchanged.push(id);
  }

  // A2b. A held-back product protects its whole family: yesterday's split
  // listings of a product held back today are the same shop product, still
  // on the shelf, and deleting them would take it off Leafly over a data
  // problem -- the thing the withhold design exists to prevent.
  const familyOf = (id: string): string => {
    if (!input.familyOf) return id;
    const f = input.familyOf(id);
    return typeof f === "string" && f.length > 0 ? f : id;
  };
  const heldFamilies = new Set(withheld.map(familyOf));

  // A3. Previously sent, not sent now, not held now (nor in a held family).
  const deletes: string[] = [];
  const familyProtected: string[] = [];
  for (const id of input.previous.keys()) {
    if (send.has(id) || withheldSet.has(id)) continue;
    if (heldFamilies.has(familyOf(id))) familyProtected.push(id);
    else deletes.push(id);
  }
  deletes.sort();

  const protectedIds = [
    ...new Set([...withheld.filter((id) => input.previous.has(id)), ...familyProtected]),
  ].sort();

  const counts = {
    creates: creates.length,
    updates: updates.length,
    unchanged: unchanged.length,
    deletes: deletes.length,
    withheld: withheld.length,
  };

  const heldNote =
    withheld.length === 0
      ? ""
      : ` ${plural(withheld.length, "product was", "products were")} held back for problems Leafly would refuse; ` +
        "they were left exactly as they are on Leafly and are listed on the Leafly page.";

  // A4.
  if (!input.planProceeds) {
    return {
      action: "refuse",
      postIds: [],
      putIds: [],
      deleteIds: [],
      protectedIds,
      counts,
      postDowngraded: false,
      summary: `nothing sent - ${withheld.length} held back, plan refused`,
      reason:
        `Nothing was sent. ${input.planNarrative}`.trim() +
        " Open \u201cSend my whole menu, hold back only the bad ones\u201d on the Leafly page to see which products and fix them.",
    };
  }

  const nothingChanged = creates.length === 0 && updates.length === 0 && deletes.length === 0;

  // A6.
  if (nothingChanged && !input.forceResend) {
    return {
      action: "skip",
      postIds: [],
      putIds: [],
      deleteIds: [],
      protectedIds,
      counts,
      postDowngraded: false,
      summary: `0 new, 0 changed, ${unchanged.length} unchanged, 0 removed`,
      reason:
        `Nothing had changed since Leafly last accepted your menu (${plural(unchanged.length, "product", "products")} unchanged), so nothing needed sending.` +
        heldNote,
    };
  }

  const summary =
    `${creates.length} new, ${updates.length} changed, ${unchanged.length} unchanged, ` +
    `${deletes.length} removed, ${withheld.length} held back`;

  // A1 + A5.
  if (input.kind === "daily_full" && withheld.length === 0) {
    return {
      action: "post",
      postIds: sendIds,
      putIds: [],
      deleteIds: [],
      protectedIds: [],
      counts,
      postDowngraded: false,
      summary,
      reason:
        `Sent today\u2019s full menu (${plural(sendIds.length, "product", "products")}) as a complete replacement, ` +
        "so Leafly\u2019s menu now matches yours exactly.",
    };
  }

  const isDaily = input.kind === "daily_full";
  // On the daily run every passing product is re-asserted, mirroring the
  // full-menu button the owner trusts. Between times, only what changed --
  // unless he forced a resend.
  const putIds = isDaily || input.forceResend ? sendIds : [...creates, ...updates].sort();

  return {
    action: "put",
    postIds: [],
    putIds,
    deleteIds: deletes,
    protectedIds,
    counts,
    postDowngraded: isDaily,
    summary,
    reason: isDaily
      ? `Sent today\u2019s full menu (${plural(putIds.length, "product", "products")}) as an update rather than a complete replacement, ` +
        "because a complete replacement would have deleted the held-back products from Leafly." +
        (deletes.length > 0 ? ` Removed ${plural(deletes.length, "product", "products")} you no longer list.` : "") +
        heldNote
      : `Sent ${plural(putIds.length, "change", "changes")}` +
        (deletes.length > 0 ? ` and removed ${plural(deletes.length, "product", "products")} you no longer list` : "") +
        "." +
        heldNote,
  };
}

/**
 * The stored id -> hash map after a SUCCESSFUL transmission.
 *
 *   post         -> exactly what was sent (POST replaced everything).
 *   put          -> previous, overwritten for what was sent; deleted ids
 *                   removed only if the DELETE itself succeeded.
 *   skip/refuse  -> unchanged.
 *
 * Held-back ids are never written and never removed (A2).
 */
export function nextSyncHashes(input: {
  plan: AutoSyncPlan;
  previous: ReadonlyMap<string, string>;
  sentHashes: ReadonlyMap<string, string>;
  deleteSucceeded: boolean;
}): Map<string, string> {
  const { plan, previous, sentHashes } = input;
  if (plan.action === "post") {
    const next = new Map<string, string>();
    for (const id of plan.postIds) {
      const h = sentHashes.get(id);
      if (h !== undefined) next.set(id, h);
    }
    return next;
  }
  const next = new Map(previous);
  if (plan.action !== "put") return next;
  for (const id of plan.putIds) {
    const h = sentHashes.get(id);
    if (h !== undefined) next.set(id, h);
  }
  if (input.deleteSucceeded) {
    for (const id of plan.deleteIds) next.delete(id);
  }
  return next;
}

/** The verb recorded in the run history, or null when nothing was sent. */
export function autoSyncMethod(plan: AutoSyncPlan): "POST" | "PUT" | null {
  if (plan.action === "post") return "POST";
  if (plan.action === "put") return "PUT";
  return null;
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflyAutoSyncTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[leafly-auto-sync-core] FAILED: ${label}`);
    }
  };

  const base: AutoSyncInput = {
    kind: "daily_full",
    planProceeds: true,
    planNarrative: "All good.",
    send: [
      { id: "a", hash: "h1" },
      { id: "b", hash: "h2" },
      { id: "c", hash: "h3" },
    ],
    withheldIds: [],
    previous: new Map([
      ["a", "h1"],
      ["b", "OLD"],
      ["gone", "hx"],
    ]),
    forceResend: false,
  };

  // --- A1 / A5: daily, nothing held -> POST of the ENTIRE passing menu ------
  {
    const p = planAutomaticTransmission(base);
    ok("A1: daily with nothing held back POSTs", p.action === "post");
    ok("A5: POST carries every passing product, unchanged ones included", p.postIds.join() === "a,b,c");
    ok("POST sends no separate PUT", p.putIds.length === 0);
    ok("POST issues no separate DELETE (POST itself removes omitted items)", p.deleteIds.length === 0);
    ok("POST is not a downgrade", p.postDowngraded === false);
    ok("counts: 1 new", p.counts.creates === 1);
    ok("counts: 1 changed", p.counts.updates === 1);
    ok("counts: 1 unchanged", p.counts.unchanged === 1);
    ok("counts: 1 removed", p.counts.deletes === 1);
    ok("method is POST", autoSyncMethod(p) === "POST");
    ok("reason speaks plain English (no verb)", !/\bPOST\b/.test(p.reason) && /matches yours exactly/.test(p.reason));
  }

  // --- A1: daily with something held back NEVER POSTs ----------------------
  {
    const p = planAutomaticTransmission({
      ...base,
      send: [
        { id: "a", hash: "h1" },
        { id: "c", hash: "h3" },
      ],
      withheldIds: ["b"],
    });
    ok("A1: daily with a held-back product does NOT POST", p.action === "put");
    ok("A1: postIds empty when held back", p.postIds.length === 0);
    ok("downgrade is flagged so the owner is told", p.postDowngraded === true);
    ok("daily PUT re-asserts every passing product", p.putIds.join() === "a,c");
    ok("A2: held-back product not deleted", !p.deleteIds.includes("b"));
    ok("A2: held-back product not sent", !p.putIds.includes("b"));
    ok("A2: held-back product with a stored hash is protected", p.protectedIds.join() === "b");
    ok("A3: a genuinely-gone product IS deleted", p.deleteIds.join() === "gone");
    ok("reason explains why it was not a full replacement", /would have deleted the held-back/.test(p.reason));
    ok("reason names the held-back count", /1 product was held back/.test(p.reason));
    ok("method is PUT", autoSyncMethod(p) === "PUT");
  }

  // --- intraday: only what changed -----------------------------------------
  {
    const p = planAutomaticTransmission({ ...base, kind: "intraday_delta" });
    ok("intraday never POSTs", p.action === "put");
    ok("intraday sends only new + changed", p.putIds.join() === "b,c");
    ok("intraday still deletes what genuinely left", p.deleteIds.join() === "gone");
    ok("intraday is not a daily downgrade", p.postDowngraded === false);
  }
  {
    const p = planAutomaticTransmission({ ...base, kind: "intraday_delta", forceResend: true });
    ok("forced intraday resends every passing product", p.putIds.join() === "a,b,c");
  }

  // --- A6: skip only when truly nothing changed -----------------------------
  {
    const same: AutoSyncInput = {
      ...base,
      previous: new Map([
        ["a", "h1"],
        ["b", "h2"],
        ["c", "h3"],
      ]),
    };
    const p = planAutomaticTransmission(same);
    ok("A6: nothing changed -> skip", p.action === "skip");
    ok("A6: a skip transmits nothing", p.postIds.length + p.putIds.length + p.deleteIds.length === 0);
    ok("A6: skip method is null", autoSyncMethod(p) === null);
    const forced = planAutomaticTransmission({ ...same, forceResend: true });
    ok("A6: a forced resend is never skipped", forced.action === "post" && forced.postIds.length === 3);
    // A delete alone is a change.
    const onlyGone = planAutomaticTransmission({
      ...same,
      kind: "intraday_delta",
      previous: new Map([...same.previous, ["old", "zz"]]),
    });
    ok("A6: a pending delete alone is not 'nothing changed'", onlyGone.action === "put" && onlyGone.deleteIds.join() === "old");
    ok("A6: a delete-only run sends no products", onlyGone.putIds.length === 0);
  }
  {
    // A held-back product that Leafly never had is not a change either.
    const p = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [{ id: "a", hash: "h1" }],
      withheldIds: ["new-broken"],
      previous: new Map([["a", "h1"]]),
    });
    ok("a brand-new broken product alone does not trigger a send", p.action === "skip");
    ok("skip reason still mentions the held-back product", /held back/.test(p.reason));
    ok("an unsent held-back product is not 'protected' (nothing stored)", p.protectedIds.length === 0);
  }

  // --- A4: a refusing plan transmits nothing ---------------------------------
  {
    const p = planAutomaticTransmission({ ...base, planProceeds: false, planNarrative: "Too much failed." });
    ok("A4: refused plan -> refuse", p.action === "refuse");
    ok("A4: refuse sends nothing", p.postIds.length + p.putIds.length + p.deleteIds.length === 0);
    ok("A4: refuse quotes the plan's own sentence", p.reason.includes("Too much failed."));
    ok("A4: refuse points at the panel that shows the products", /hold back only the bad ones/.test(p.reason));
    ok("A4: refuse method is null", autoSyncMethod(p) === null);
  }

  // --- A2 belt and braces: listed as both -> treated as held back -----------
  {
    const p = planAutomaticTransmission({
      ...base,
      send: [
        { id: "a", hash: "h1" },
        { id: "b", hash: "h2" },
      ],
      withheldIds: ["b"],
    });
    ok("A2: an id both sent and held is NOT sent", !p.putIds.includes("b") && !p.postIds.includes("b"));
    ok("A2: and it prevents a POST", p.action !== "post");
  }

  // --- hygiene: blanks and duplicates ---------------------------------------
  {
    const p = planAutomaticTransmission({
      ...base,
      send: [
        { id: " a ", hash: "h1" },
        { id: "", hash: "x" },
      ],
      withheldIds: ["", "  "],
      previous: new Map(),
    });
    ok("ids are trimmed", p.postIds.join() === "a");
    ok("blank withheld ids do not count as held back", p.counts.withheld === 0 && p.action === "post");
  }

  // --- A3 swept: every delete was previously sent, not sent, not held -------
  {
    const previous = new Map<string, string>();
    for (let i = 0; i < 40; i += 1) previous.set(`p${i}`, `h${i}`);
    const send = [] as { id: string; hash: string }[];
    const held = [] as string[];
    for (let i = 0; i < 40; i += 1) {
      if (i % 3 === 0) send.push({ id: `p${i}`, hash: i % 2 ? `h${i}` : `new${i}` });
      else if (i % 3 === 1) held.push(`p${i}`);
    }
    for (const kind of ["daily_full", "intraday_delta"] as const) {
      const p = planAutomaticTransmission({ ...base, kind, send, withheldIds: held, previous });
      const sendSet = new Set(send.map((s) => s.id));
      const heldSet = new Set(held);
      const allOk = p.deleteIds.every((id) => previous.has(id) && !sendSet.has(id) && !heldSet.has(id));
      ok(`A3 sweep (${kind}): every delete is genuinely gone`, allOk);
      ok(`A3 sweep (${kind}): no held id is deleted`, p.deleteIds.every((id) => !heldSet.has(id)));
      // Non-vacuity: the sweep must actually delete something.
      ok(`A3 sweep (${kind}): the sweep is not vacuous`, p.deleteIds.length > 5);
      ok(`A1 sweep (${kind}): never POST with held products`, p.action !== "post");
    }
  }

  // --- A2b: a held-back product protects its whole family -------------------
  {
    const fam = (id: string) => {
      const at = id.lastIndexOf("--");
      return at > 0 ? id.slice(0, at) : id;
    };
    // Yesterday the repair split P into two listings; today the repair is off
    // and P (unsplit) is held back.
    const p = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [{ id: "a", hash: "h1" }],
      withheldIds: ["P"],
      previous: new Map([
        ["a", "h1"],
        ["P--1g", "x1"],
        ["P--2g", "x2"],
        ["gone", "hx"],
      ]),
      familyOf: fam,
    });
    ok("A2b: split listings of a held-back product are NOT deleted", !p.deleteIds.includes("P--1g") && !p.deleteIds.includes("P--2g"));
    ok("A2b: they are reported as protected", p.protectedIds.includes("P--1g") && p.protectedIds.includes("P--2g"));
    ok("A2b: an unrelated gone product is still deleted", p.deleteIds.join() === "gone");
    // Without the family function the same input WOULD delete them -- proof
    // the family rule is what is doing the protecting.
    const noFam = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [{ id: "a", hash: "h1" }],
      withheldIds: ["P"],
      previous: new Map([
        ["a", "h1"],
        ["P--1g", "x1"],
      ]),
    });
    ok("A2b: without familyOf the split listing would be deleted (non-vacuity)", noFam.deleteIds.includes("P--1g"));
    // The reverse: a split listing is held back, the unsplit original is protected.
    const rev = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [{ id: "Q--2g", hash: "q2" }],
      withheldIds: ["Q--1g"],
      previous: new Map([["Q", "old"]]),
      familyOf: fam,
    });
    ok("A2b: the unsplit original of a held-back split listing is not deleted", !rev.deleteIds.includes("Q"));
    // A family whose members are ALL passing is not protected: the repair
    // replacing P with P--1g/P--2g genuinely retires P.
    const replaced = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [
        { id: "R--1g", hash: "r1" },
        { id: "R--2g", hash: "r2" },
      ],
      withheldIds: [],
      previous: new Map([["R", "old"]]),
      familyOf: fam,
    });
    ok("A2b: an original fully replaced by passing split listings IS deleted", replaced.deleteIds.join() === "R");
    // A familyOf that returns junk falls back to the id itself.
    const junk = planAutomaticTransmission({
      ...base,
      kind: "intraday_delta",
      send: [],
      withheldIds: ["Z"],
      previous: new Map([["Y", "y"]]),
      familyOf: () => "",
    });
    ok("A2b: an empty family falls back to the id (Y is not Z's family)", junk.deleteIds.join() === "Y");
  }

  // --- nextSyncHashes ---------------------------------------------------------
  {
    const p = planAutomaticTransmission(base); // post a,b,c
    const sent = new Map([
      ["a", "h1"],
      ["b", "h2"],
      ["c", "h3"],
    ]);
    const n = nextSyncHashes({ plan: p, previous: base.previous, sentHashes: sent, deleteSucceeded: false });
    ok("after POST the map is exactly what was sent", [...n.keys()].sort().join() === "a,b,c");
    ok("after POST 'gone' is dropped (POST removed it)", !n.has("gone"));
    ok("after POST hashes are the sent ones", n.get("b") === "h2");
  }
  {
    const input: AutoSyncInput = {
      ...base,
      send: [
        { id: "a", hash: "h1" },
        { id: "c", hash: "h3" },
      ],
      withheldIds: ["b"],
    };
    const p = planAutomaticTransmission(input);
    const sent = new Map([
      ["a", "h1"],
      ["c", "h3"],
    ]);
    const okDel = nextSyncHashes({ plan: p, previous: input.previous, sentHashes: sent, deleteSucceeded: true });
    ok("after PUT the held-back hash is left EXACTLY as it was", okDel.get("b") === "OLD");
    ok("after PUT the sent product is recorded", okDel.get("c") === "h3");
    ok("after a successful DELETE the gone product is removed", !okDel.has("gone"));
    const badDel = nextSyncHashes({ plan: p, previous: input.previous, sentHashes: sent, deleteSucceeded: false });
    ok("after a FAILED delete the gone product is kept, so the next run retries it", badDel.get("gone") === "hx");
  }
  {
    const p = planAutomaticTransmission({ ...base, planProceeds: false });
    const n = nextSyncHashes({ plan: p, previous: base.previous, sentHashes: new Map(), deleteSucceeded: true });
    ok("a refusal changes nothing in the stored map", n.size === 3 && n.get("b") === "OLD" && n.has("gone"));
    ok("the returned map is a copy, not the caller's", n !== base.previous);
  }

  return { passed, failed };
}
