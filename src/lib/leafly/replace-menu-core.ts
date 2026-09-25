/**
 * src/lib/leafly/replace-menu-core.ts  (SLICE L-42 -- "we have to prove we can
 * successfully complete every action. So we will need to have a successful
 * push post.")
 *
 * ###########################################################################
 * # WHY THIS EXISTS                                                         #
 * #                                                                         #
 * # Leafly's menu-certification checklist grades a DAILY FULL POST. The     #
 * # owner asked for one simple button that sends it, unless automatic sync  #
 * # already does. Verified against auto-sync-core.ts (L-41): the automatic  #
 * # daily run POSTs ONLY when nothing is held back (invariant A1), because  #
 * # a POST deletes every product it omits. His menu has held-back products, #
 * # so in practice automation sends PUT -- and he would have no POST to     #
 * # show Leafly. Hence this button.                                         #
 * #                                                                         #
 * # The old "Push POST" button threw errors because it went through the     #
 * # all-or-nothing `pushLeaflyMenu`, which refuses the whole menu if any    #
 * # product fails Leafly's checks. This one is built from the SAME build    #
 * # step as "Send my whole menu, hold back only the bad ones" -- the path   #
 * # the owner reports "works great" -- and differs only in the verb.        #
 * ###########################################################################
 *
 * WHAT A POST DOES (docs/leafly-menu-api-v2.md, vendored spec)
 * ------------------------------------------------------------
 * POST replaces the Leafly menu with exactly the items sent. Anything Leafly
 * held that is not in the payload is DELETED. So:
 *
 *   - a held-back product that is currently on Leafly will be REMOVED by the
 *     POST, and stays off until it is fixed and sent again;
 *   - a product the shop no longer lists is removed (that is the point).
 *
 * The owner must be told the first one, by count and by name, and must accept
 * it, before the POST is allowed. That is the only real danger of the button.
 *
 * Invariants (each pinned by a self-test below):
 *   R1  The POST carries EVERY passing product and no held-back product.
 *   R2  An empty POST is never sent (it would empty the Leafly menu).
 *   R3  Nothing is sent without an explicit confirmation.
 *   R4  Nothing is sent when the withhold plan itself refused.
 *   R5  With anything held back, the owner must have accepted that exact
 *       number. A stale acceptance (a different number) is refused, so a
 *       confirmation given for 3 cannot authorise removing 30.
 *   R6  `removedIds` is exactly what Leafly will delete per our records:
 *       previously sent, and not in this POST.
 *   R7  `removedHeldIds` names which of those are products still on the
 *       shelf (held back, or a split listing of one), so the warning is
 *       about the right products.
 *
 * Pure: no imports, no I/O.
 */

export type ReplaceMenuRefusal =
  | "plan_refused"
  | "empty"
  | "withheld_not_acknowledged"
  | "acknowledgement_stale"
  | "not_confirmed";

export type ReplaceMenuInput = {
  /** Did the withhold plan (full-menu-core) agree to send anything at all? */
  planProceeds: boolean;
  /** The withhold plan's own sentence, used when it refused. */
  planNarrative: string;
  /** Products passing Leafly's checks -- the POST body. */
  sendIds: ReadonlyArray<string>;
  /** Products held back for problems Leafly would refuse. */
  withheldIds: ReadonlyArray<string>;
  /** Ids our records say Leafly currently holds (stored sync-state keys). */
  previousIds: ReadonlyArray<string>;
  /**
   * The number of held-back products the owner saw and accepted would be
   * removed. `null` means he has not accepted anything.
   */
  acknowledgedWithheldCount: number | null;
  /** The owner's explicit "yes, replace it now". */
  confirm: boolean;
  /** Maps a split listing id to its parent product. Absent: identity. */
  familyOf?: (id: string) => string;
};

export type ReplaceMenuPlan = {
  proceed: boolean;
  refusal: ReplaceMenuRefusal | null;
  /** Exactly what the POST carries. */
  postIds: string[];
  withheldIds: string[];
  /** What Leafly will delete per our records (R6). */
  removedIds: string[];
  /** The removed ids that are products still on the shelf (R7). */
  removedHeldIds: string[];
  /** One line for the run history. */
  summary: string;
  /** A sentence for the owner. */
  reason: string;
};

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

export function planReplaceMenu(input: ReplaceMenuInput): ReplaceMenuPlan {
  const withheldIds = clean(input.withheldIds);
  const withheldSet = new Set(withheldIds);
  // R1: a product listed as both passing and withheld is treated as withheld.
  const postIds = clean(input.sendIds).filter((id) => !withheldSet.has(id));
  const postSet = new Set(postIds);

  const familyOf = (id: string): string => {
    if (!input.familyOf) return id;
    const f = input.familyOf(id);
    return typeof f === "string" && f.length > 0 ? f : id;
  };
  const heldFamilies = new Set(withheldIds.map(familyOf));

  // R6
  const removedIds = clean(input.previousIds).filter((id) => !postSet.has(id));
  // R7
  const removedHeldIds = removedIds.filter(
    (id) => withheldSet.has(id) || heldFamilies.has(familyOf(id)),
  );

  const summary =
    `POST ${postIds.length} products, ${withheldIds.length} held back, ` +
    `${removedIds.length} removed from Leafly (${removedHeldIds.length} of them held back)`;

  const base = { postIds, withheldIds, removedIds, removedHeldIds, summary };
  const refuse = (refusal: ReplaceMenuRefusal, reason: string): ReplaceMenuPlan => ({
    ...base,
    proceed: false,
    refusal,
    reason,
  });

  // R4
  if (!input.planProceeds) {
    return refuse(
      "plan_refused",
      `Nothing was sent. ${input.planNarrative}`.trim(),
    );
  }
  // R2
  if (postIds.length === 0) {
    return refuse(
      "empty",
      "Nothing was sent: no product passes Leafly's checks, and replacing the menu with nothing would empty your Leafly listing.",
    );
  }
  // R5
  if (withheldIds.length > 0) {
    const ack = input.acknowledgedWithheldCount;
    if (ack === null || ack === undefined) {
      return refuse(
        "withheld_not_acknowledged",
        `${plural(withheldIds.length, "product is", "products are")} held back. ` +
          "Replacing the menu removes held-back products from Leafly until they are fixed, " +
          "so you need to tick the box that says you understand before it can be sent.",
      );
    }
    if (ack !== withheldIds.length) {
      return refuse(
        "acknowledgement_stale",
        `You agreed to ${plural(ack, "held-back product", "held-back products")} being removed, ` +
          `but ${withheldIds.length} are held back now. Press \u201cCheck what a POST would do\u201d again and re-check.`,
      );
    }
  }
  // R3
  if (!input.confirm) {
    return refuse("not_confirmed", "Nothing was sent: this needs your confirmation.");
  }

  return {
    ...base,
    proceed: true,
    refusal: null,
    reason:
      `Replaced your Leafly menu with ${plural(postIds.length, "product", "products")}.` +
      (removedIds.length > 0
        ? ` Leafly removed ${plural(removedIds.length, "product", "products")} that were not in this send` +
          (removedHeldIds.length > 0
            ? ` (${removedHeldIds.length} held back for problems; they return once fixed and sent again).`
            : ".")
        : ""),
  };
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflyReplaceMenuTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL replace-menu-core: ${label}`);
    }
  };

  const base: ReplaceMenuInput = {
    planProceeds: true,
    planNarrative: "",
    sendIds: ["a", "b", "c"],
    withheldIds: [],
    previousIds: ["a", "b"],
    acknowledgedWithheldCount: null,
    confirm: true,
  };

  // --- the happy path ---------------------------------------------------
  const happy = planReplaceMenu(base);
  ok("happy: proceeds", happy.proceed === true);
  ok("happy: no refusal", happy.refusal === null);
  ok("R1: POSTs every passing product", happy.postIds.join() === "a,b,c");
  ok("happy: nothing removed", happy.removedIds.length === 0);
  ok("happy: reason names the count", happy.reason.includes("3 products"));
  ok("happy: summary starts with POST", happy.summary.startsWith("POST 3 products"));

  // --- R1 ---------------------------------------------------------------
  const r1 = planReplaceMenu({
    ...base,
    sendIds: ["a", "b", "x"],
    withheldIds: ["x"],
    acknowledgedWithheldCount: 1,
  });
  ok("R1: a product both passing and held is not POSTed", !r1.postIds.includes("x"));
  ok("R1: the rest are POSTed", r1.postIds.join() === "a,b");
  const dup = planReplaceMenu({ ...base, sendIds: [" a", "a", "b ", "", "c"] });
  ok("R1: ids are trimmed and de-duplicated", dup.postIds.join() === "a,b,c");

  // --- R2 ---------------------------------------------------------------
  const empty = planReplaceMenu({ ...base, sendIds: [] });
  ok("R2: an empty POST is refused", empty.proceed === false && empty.refusal === "empty");
  const allHeld = planReplaceMenu({
    ...base,
    sendIds: ["a"],
    withheldIds: ["a"],
    acknowledgedWithheldCount: 1,
  });
  ok("R2: all passing ids held back -> refused as empty", allHeld.refusal === "empty");
  const blank = planReplaceMenu({ ...base, sendIds: ["  ", ""] });
  ok("R2: blank ids do not count as products", blank.refusal === "empty");

  // --- R3 ---------------------------------------------------------------
  const unconfirmed = planReplaceMenu({ ...base, confirm: false });
  ok("R3: no confirmation -> refused", unconfirmed.proceed === false);
  ok("R3: refusal code", unconfirmed.refusal === "not_confirmed");
  ok("R3: lists are still computed for the preview", unconfirmed.postIds.length === 3);

  // --- R4 ---------------------------------------------------------------
  const refused = planReplaceMenu({ ...base, planProceeds: false, planNarrative: "Too many failed." });
  ok("R4: plan refusal -> nothing sent", refused.proceed === false);
  ok("R4: refusal code", refused.refusal === "plan_refused");
  ok("R4: carries the plan's own sentence", refused.reason.includes("Too many failed."));
  ok(
    "R4: outranks a missing confirmation",
    planReplaceMenu({ ...base, planProceeds: false, confirm: false }).refusal === "plan_refused",
  );

  // --- R5 ---------------------------------------------------------------
  const held = { ...base, sendIds: ["a", "b"], withheldIds: ["x", "y", "z"], previousIds: ["a", "x"] };
  const noAck = planReplaceMenu({ ...held, acknowledgedWithheldCount: null });
  ok("R5: held back and not accepted -> refused", noAck.refusal === "withheld_not_acknowledged");
  ok("R5: the sentence gives the count", noAck.reason.includes("3 products are held back"));
  const stale = planReplaceMenu({ ...held, acknowledgedWithheldCount: 2 });
  ok("R5: a stale acceptance is refused", stale.refusal === "acknowledgement_stale");
  const staleHigh = planReplaceMenu({ ...held, acknowledgedWithheldCount: 30 });
  ok("R5: an over-count acceptance is refused too", staleHigh.refusal === "acknowledgement_stale");
  const accepted = planReplaceMenu({ ...held, acknowledgedWithheldCount: 3 });
  ok("R5: the exact number accepted -> proceeds", accepted.proceed === true);
  ok(
    "R5: acceptance never needed with nothing held back",
    planReplaceMenu({ ...base, acknowledgedWithheldCount: null }).proceed === true,
  );
  ok(
    "R5 runs before R3 (the preview shows the tick box, not 'confirm')",
    planReplaceMenu({ ...held, confirm: false }).refusal === "withheld_not_acknowledged",
  );
  ok(
    "R5: an accepted but unconfirmed send is still refused",
    planReplaceMenu({ ...held, acknowledgedWithheldCount: 3, confirm: false }).refusal === "not_confirmed",
  );

  // --- R6 ---------------------------------------------------------------
  const r6 = planReplaceMenu({
    ...base,
    sendIds: ["a", "b"],
    previousIds: ["a", "b", "retired1", "retired2"],
  });
  ok("R6: previously sent and not in the POST are removed", r6.removedIds.join() === "retired1,retired2");
  ok("R6: a POSTed id is never counted as removed", !r6.removedIds.includes("a"));
  ok("R6: the reason says what Leafly removed", r6.reason.includes("removed 2 products"));
  const r6none = planReplaceMenu({ ...base, previousIds: [] });
  ok("R6: nothing previously sent -> nothing removed", r6none.removedIds.length === 0);

  // --- R7 ---------------------------------------------------------------
  const r7 = planReplaceMenu({
    ...base,
    sendIds: ["a"],
    withheldIds: ["p"],
    previousIds: ["a", "p", "p--1g", "gone"],
    acknowledgedWithheldCount: 1,
    familyOf: (id) => (id.includes("--") ? id.split("--")[0] : id),
  });
  ok("R7: a held-back product is flagged", r7.removedHeldIds.includes("p"));
  ok("R7: its split listing is flagged too", r7.removedHeldIds.includes("p--1g"));
  ok("R7: a retired product is not flagged as held", !r7.removedHeldIds.includes("gone"));
  ok("R7: but it is still removed", r7.removedIds.includes("gone"));
  ok("R7: the reason explains held-back products return", r7.reason.includes("return once fixed"));
  const r7noFamily = planReplaceMenu({
    ...base,
    sendIds: ["a"],
    withheldIds: ["p"],
    previousIds: ["a", "p--1g"],
    acknowledgedWithheldCount: 1,
  });
  ok("R7: without familyOf a split id is its own family", r7noFamily.removedHeldIds.length === 0);
  const r7bad = planReplaceMenu({
    ...base,
    sendIds: ["a"],
    withheldIds: ["p"],
    previousIds: ["a", "p"],
    acknowledgedWithheldCount: 1,
    familyOf: () => "",
  });
  ok("R7: an empty family falls back to the id", r7bad.removedHeldIds.join() === "p");

  // --- the summary is honest -------------------------------------------
  ok(
    "summary counts everything",
    r7.summary === "POST 1 products, 1 held back, 3 removed from Leafly (2 of them held back)",
  );

  return { passed, failed };
}
