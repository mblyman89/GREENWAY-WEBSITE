/**
 * src/lib/leafly/full-menu-core.ts  (TASK J ask 3 -- "send the full menu,
 * withholding the bad ones")
 *
 * ###########################################################################
 * # THE OWNER'S QUESTION                                                    #
 * #                                                                        #
 * #   "Is it possible to send the full menu withholding the bad ones?"     #
 * ###########################################################################
 *
 * WHAT ALREADY EXISTED, MEASURED RATHER THAN REMEMBERED
 * -----------------------------------------------------
 * Two half-answers were already in the codebase, and neither one is what the
 * owner asked for:
 *
 *   `pushLeaflyPassingOnlyAction`  -- does exactly the right thing, but ONLY
 *     for the targeted item picker. It takes an explicit `ids: string[]`. It
 *     cannot send the menu.
 *
 *   `invalidItemPolicy: "quarantine"` -- works on the full menu, but it is a
 *     PERSISTENT SETTING rather than a decision made at the moment of the
 *     push, it is off by default, it has no preview, and -- decisively -- it
 *     REFUSES when a quarter or more of the menu is failing.
 *
 * That last clause is not a footnote, it is the whole problem. A reproduction
 * through the real builder, real validator and real quarantine decision
 * measured it:
 *
 *     600 products, 200 with colliding sizes  ->  33.3% failing
 *     quarantine REFUSES: "too_widespread ... This needs a developer."
 *     NOTHING IS SENT.
 *
 * And 200-of-600 is not a pessimistic fixture. The collision defect hits
 * every each-only product carrying more than one weight -- pre-rolls,
 * edibles, topicals, concentrates sold in tiers. In a real dispensary that is
 * routinely a third of the menu. So for the owner's actual situation, the
 * existing "skip the bad ones" setting answers his question with "no".
 *
 * WHY THE CEILING IS RIGHT AND MUST NOT BE LOWERED
 * ------------------------------------------------
 * The temptation is to raise `QUARANTINE_MAX_SHARE_PERCENT` to 90 and call
 * the feature shipped. That would be a shortcut, and a dangerous one. The
 * ceiling exists to distinguish "a few mistyped records" from "our builder is
 * broken", and it is correct: a defect touching one item in four IS usually
 * ours. Disabling that alarm would mean the next genuine builder defect
 * publishes a gutted menu silently.
 *
 * The honest resolution is not to weaken the alarm. It is to REMOVE THE CAUSE
 * before the alarm is consulted. The collision repair already exists and is
 * proven to do exactly that:
 *
 *     the same 600 products, repaired first
 *       -> 1000 products, 0 collisions, 0 quarantined, whole menu sendable
 *
 * So this module's plan is: REPAIR, then MEASURE, then WITHHOLD only what is
 * still genuinely broken, and only then consult the ceiling -- against the
 * repaired figure, which is the figure that describes reality.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * The pure decision half. It does not fetch, build, validate or transmit. It
 * is handed the measurements and it decides, so that the decision can be
 * proved in CI without a database or a network, and so that the rule that
 * governs the owner's menu is readable in one place.
 *
 * THE FOUR RULES
 * --------------
 *   F1. NEVER report success for a push that sent nothing. An empty PUT is
 *       not a no-op in spirit and "we sent nothing successfully" is a lie.
 *   F2. NEVER withhold a product without naming it. The failure mode this
 *       whole area is designed against is a product quietly missing from the
 *       menu for months.
 *   F3. NEVER proceed on unattributed errors. If a finding blames no product,
 *       withholding the named ones cannot make the payload valid, so the push
 *       would fail anyway -- after telling the owner it had solved his
 *       problem.
 *   F4. NEVER let a systematic defect masquerade as tidying. The ceiling
 *       still applies, measured AFTER repair.
 *
 * PURITY
 * ------
 * Zero imports. Pure functions of their arguments. Runs under plain `tsx`.
 */

/* ========================================================================== */
/* Inputs                                                                     */
/* ========================================================================== */

/**
 * A validation finding, in the shape this module needs.
 *
 * Structural rather than an import of the validator's own type. That keeps
 * this file dependency-free and lets tests construct findings by hand without
 * standing up a payload.
 */
export type FullMenuIssue = {
  severity: "error" | "warning";
  code: string;
  itemId: string | null;
  message: string;
};

/** A product as it appears on the wire, reduced to what the decision needs. */
export type FullMenuItem = {
  id: string;
  name?: string | null;
};

/**
 * What the repair accomplished, if it was run.
 *
 * Supplied rather than recomputed because the repair lives in
 * `collision-apply-server.ts` (which touches the feed) and this module must
 * stay pure. `null` means no repair was attempted, which is a legitimate
 * mode and must read differently from "repair ran and changed nothing".
 */
export type FullMenuRepairSummary = {
  /** Products whose sizes were corrected in place. */
  repairedItemCount: number;
  /** Products that were listed as several products, one per size. */
  splitItemCount: number;
  /** How many products those splits became. */
  createdItemCount: number;
  /** Products the repair could not fix, and said so. */
  refusalCount: number;
  /** The repair's own verdict on its output. */
  clean: boolean;
};

/* ========================================================================== */
/* Outputs                                                                    */
/* ========================================================================== */

export type WithheldProduct = {
  itemId: string;
  itemName: string | null;
  /** Distinct error codes, sorted, so two runs read the same. */
  codes: string[];
  /** The real validator messages. Never paraphrased. */
  reasons: string[];
};

/**
 * Why a plan refuses.
 *
 *   "nothing_wrong"     -- not a refusal; everything passed, send it all.
 *   "unattributed"      -- F3.
 *   "nothing_left"      -- every product failed; there is no menu to send.
 *   "too_widespread"    -- F4; the ceiling, after repair.
 */
export type FullMenuRefusal =
  | "unattributed"
  | "nothing_left"
  | "too_widespread";

export type FullMenuPlan = {
  /** May the caller transmit? */
  proceed: boolean;
  /** Null when proceeding. */
  refusal: FullMenuRefusal | null;
  /** Exactly the ids to send. Empty when refusing. */
  sendIds: string[];
  /** Named, always, whether proceeding or not. F2. */
  withheld: WithheldProduct[];
  /** Findings that blamed nobody. Always surfaced. */
  unattributed: FullMenuIssue[];
  /** Products considered, after any repair. */
  totalItems: number;
  /** Withheld as a percentage of the menu, one decimal. */
  withheldSharePercent: number;
  /** Echoed so the narrative can describe it without a second source. */
  repair: FullMenuRepairSummary | null;
  /** Warnings do not block, but they are counted so nothing is invisible. */
  warningCount: number;
};

/* ========================================================================== */
/* The ceiling                                                                */
/* ========================================================================== */

/**
 * The share of the menu that may be withheld before this refuses.
 *
 * Deliberately the SAME number as `QUARANTINE_MAX_SHARE_PERCENT` (25), and
 * deliberately NOT imported from it -- this module is pure and that one is
 * too, but importing would couple two rules that happen to agree today rather
 * than two rules that must agree. A drift test asserts they match, so if
 * someone changes one the suite says so instead of silently diverging.
 *
 * The comparison is `>=`, matching quarantine: when a threshold is a
 * judgement call, the conservative side of the boundary is the one that does
 * not publish.
 */
export const FULL_MENU_MAX_WITHHELD_PERCENT = 25;

/* ========================================================================== */
/* The decision                                                               */
/* ========================================================================== */

function trim(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Decide what to send for a FULL-MENU push that is allowed to withhold the
 * products Leafly would reject.
 *
 * @param items The wire items, AFTER any repair. Passing pre-repair items
 *   would make every count describe a payload that is not the one being sent.
 * @param issues The validator's findings against those same items.
 * @param repair What the repair did, or null if it was not run.
 * @param maxWithheldPercent Override for the ceiling. Exposed for tests and
 *   for a future owner-facing control; defaults to the constant above.
 */
export function planFullMenuPush(input: {
  items: readonly FullMenuItem[];
  issues: readonly FullMenuIssue[];
  repair?: FullMenuRepairSummary | null;
  maxWithheldPercent?: number;
}): FullMenuPlan {
  const items = input.items ?? [];
  const issues = input.issues ?? [];
  const repair = input.repair ?? null;
  const ceiling = input.maxWithheldPercent ?? FULL_MENU_MAX_WITHHELD_PERCENT;

  const totalItems = items.length;

  const errors = issues.filter((i) => i.severity === "error");
  const warningCount = issues.length - errors.length;

  // Group errors by the product they blame.
  const byItem = new Map<string, FullMenuIssue[]>();
  const unattributed: FullMenuIssue[] = [];
  for (const e of errors) {
    const id = trim(e.itemId);
    if (id.length === 0) {
      unattributed.push(e);
      continue;
    }
    const bucket = byItem.get(id);
    if (bucket === undefined) byItem.set(id, [e]);
    else bucket.push(e);
  }

  const nameOf = new Map<string, string | null>();
  for (const it of items) nameOf.set(trim(it.id), it.name ?? null);

  const withheld: WithheldProduct[] = [];
  for (const [itemId, list] of byItem) {
    withheld.push({
      itemId,
      itemName: nameOf.get(itemId) ?? null,
      codes: Array.from(new Set(list.map((i) => trim(i.code)))).sort(),
      reasons: list.map((i) => i.message),
    });
  }
  // Stable order: two runs over the same data must read identically, or the
  // owner cannot tell a changed menu from a reshuffled report.
  withheld.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const condemned = new Set(withheld.map((w) => w.itemId));
  const sendIds = items.map((i) => trim(i.id)).filter((id) => id.length > 0 && !condemned.has(id));

  const withheldSharePercent =
    totalItems === 0 ? 0 : Math.round((withheld.length / totalItems) * 1000) / 10;

  const base = {
    withheld,
    unattributed,
    totalItems,
    withheldSharePercent,
    repair,
    warningCount,
  };

  // Nothing is wrong: send everything. Running this unconditionally is safe.
  if (errors.length === 0) {
    // F1 still applies -- an empty menu is not a success.
    if (sendIds.length === 0) {
      return { proceed: false, refusal: "nothing_left", sendIds: [], ...base };
    }
    return { proceed: true, refusal: null, sendIds, ...base };
  }

  // F3. An error blaming nobody cannot be withheld away.
  if (unattributed.length > 0) {
    return { proceed: false, refusal: "unattributed", sendIds: [], ...base };
  }

  // F1. Nothing survived.
  if (sendIds.length === 0) {
    return { proceed: false, refusal: "nothing_left", sendIds: [], ...base };
  }

  // F4. The ceiling, measured against the repaired menu.
  if (withheldSharePercent >= ceiling) {
    return { proceed: false, refusal: "too_widespread", sendIds: [], ...base };
  }

  return { proceed: true, refusal: null, sendIds, ...base };
}

/* ========================================================================== */
/* Telling the owner                                                          */
/* ========================================================================== */

/**
 * The headline, in the owner's language rather than the validator's.
 *
 * Always returns a sentence. Unlike `describeQuarantine`, which returns null
 * on a clean run, this is the primary report for a button the owner pressed
 * ON PURPOSE -- pressing "send the good ones" and getting no message back
 * would read as a failure.
 */
export function describeFullMenuPlan(plan: FullMenuPlan): string {
  const n = plan.withheld.length;
  const productWord = n === 1 ? "product" : "products";
  const repairNote = describeFullMenuRepair(plan.repair);

  if (plan.proceed) {
    if (n === 0) {
      return (
        `All ${plan.totalItems} products meet Leafly's rules and were sent. ` +
        `Nothing was held back.${repairNote}`
      );
    }
    return (
      `${plan.sendIds.length} of ${plan.totalItems} products were sent to Leafly. ` +
      `${n} ${productWord} (${plan.withheldSharePercent}% of the menu) did not meet Leafly's ` +
      `rules and ${n === 1 ? "was" : "were"} held back — ${n === 1 ? "it is" : "they are"} ` +
      `named below with the reason and a button to fix ${n === 1 ? "it" : "them"}. ` +
      `Fix ${n === 1 ? "it" : "them"} and ${n === 1 ? "it" : "they"} will publish on the next ` +
      `send.${repairNote}`
    );
  }

  switch (plan.refusal) {
    case "unattributed":
      return (
        `Nothing was sent. Some of the problems could not be traced to a specific product, ` +
        `so holding back the named ones would not have made the send succeed — it would ` +
        `have failed anyway, after telling you it had worked. This one needs a developer.` +
        repairNote
      );
    case "nothing_left":
      if (plan.totalItems === 0) {
        return `Nothing was sent, because there are no products in the menu to send.`;
      }
      return (
        `Nothing was sent, because all ${plan.totalItems} products failed Leafly's rules. ` +
        `There was no good menu left to publish. This one needs a developer.${repairNote}`
      );
    case "too_widespread":
      return (
        `Nothing was sent. ${n} of ${plan.totalItems} products failed — ` +
        `${plan.withheldSharePercent}% of the menu. A failure that widespread is normally a ` +
        `fault in the integration rather than a few bad product records, so the send stopped ` +
        `instead of publishing a gutted menu. This one needs a developer.${repairNote}`
      );
    default:
      return `Nothing was sent.${repairNote}`;
  }
}

/**
 * What the repair did, as a trailing clause. Returns "" when there is nothing
 * to say, so it can be concatenated unconditionally.
 */
export function describeFullMenuRepair(repair: FullMenuRepairSummary | null): string {
  if (repair === null) return "";
  const bits: string[] = [];
  if (repair.repairedItemCount > 0) {
    bits.push(
      `${repair.repairedItemCount} product${repair.repairedItemCount === 1 ? "" : "s"} had ` +
        `${repair.repairedItemCount === 1 ? "its" : "their"} sizes corrected automatically`,
    );
  }
  if (repair.splitItemCount > 0) {
    bits.push(
      `${repair.splitItemCount} product${repair.splitItemCount === 1 ? "" : "s"} ` +
        `${repair.splitItemCount === 1 ? "was" : "were"} listed as ${repair.createdItemCount} ` +
        `separate Leafly products so every size stays visible`,
    );
  }
  if (repair.refusalCount > 0) {
    bits.push(
      `${repair.refusalCount} product${repair.refusalCount === 1 ? "" : "s"} could not be ` +
        `fixed automatically and need${repair.refusalCount === 1 ? "s" : ""} a size label ` +
        `corrected first`,
    );
  }
  if (bits.length === 0) return " Nothing needed repairing first.";
  return ` Before sending: ${bits.join("; ")}.`;
}

/** One line per held-back product, ready for a list in the admin UI. */
export function describeWithheldProducts(
  plan: FullMenuPlan,
  limit = 100,
): string[] {
  const capped = plan.withheld.slice(0, Math.max(0, limit));
  const lines = capped.map((w) => {
    const who = w.itemName ? `${w.itemName} (${w.itemId})` : w.itemId;
    const first = w.reasons[0] ?? "No reason recorded.";
    const more =
      w.reasons.length > 1
        ? ` …and ${w.reasons.length - 1} more problem${w.reasons.length - 1 === 1 ? "" : "s"}.`
        : "";
    return `${who}: ${first}${more}`;
  });
  const hidden = plan.withheld.length - capped.length;
  if (hidden > 0) {
    lines.push(`…and ${hidden} more product${hidden === 1 ? "" : "s"} not shown.`);
  }
  return lines;
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflyFullMenuTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[full-menu-core] FAILED: ${name}`);
    }
  };

  const item = (id: string, name?: string): FullMenuItem => ({ id, name: name ?? `Name ${id}` });
  const err = (itemId: string | null, code = "bad_thing"): FullMenuIssue => ({
    severity: "error",
    code,
    itemId,
    message: `${code} on ${itemId ?? "nobody"}`,
  });
  const warn = (itemId: string | null): FullMenuIssue => ({
    severity: "warning",
    code: "a_warning",
    itemId,
    message: "just a warning",
  });

  /* ---------------- clean menus ---------------- */

  {
    const p = planFullMenuPush({ items: [item("a"), item("b")], issues: [] });
    ok("clean menu proceeds", p.proceed === true);
    ok("clean menu sends everything", p.sendIds.length === 2);
    ok("clean menu withholds nothing", p.withheld.length === 0);
    ok("clean menu has no refusal", p.refusal === null);
    ok("clean menu share is zero", p.withheldSharePercent === 0);
    ok("clean narrative says all were sent", describeFullMenuPlan(p).includes("All 2 products"));
  }
  {
    // Warnings must never block.
    const p = planFullMenuPush({ items: [item("a")], issues: [warn("a"), warn(null)] });
    ok("warnings do not block", p.proceed === true);
    ok("warnings are counted", p.warningCount === 2);
    ok("warnings do not withhold", p.withheld.length === 0);
  }
  {
    const p = planFullMenuPush({ items: [], issues: [] });
    ok("an empty menu refuses (F1)", p.proceed === false);
    ok("an empty menu says nothing_left", p.refusal === "nothing_left");
    ok("an empty menu explains itself", describeFullMenuPlan(p).includes("no products"));
  }

  /* ---------------- withholding ---------------- */

  {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    // 1 of 5 = 20%, under the ceiling.
    const p = planFullMenuPush({ items, issues: [err("c")] });
    ok("one bad product still sends", p.proceed === true);
    ok("the bad one is excluded", !p.sendIds.includes("c"));
    ok("the good ones are sent", p.sendIds.length === 4);
    ok("the bad one is named (F2)", p.withheld.length === 1 && p.withheld[0].itemId === "c");
    ok("the name is carried", p.withheld[0].itemName === "Name c");
    ok("the real reason is carried", p.withheld[0].reasons[0] === "bad_thing on c");
    ok("share is 20%", p.withheldSharePercent === 20);
    const lines = describeWithheldProducts(p);
    ok("a line is produced per withheld product", lines.length === 1);
    ok("the line names the product", lines[0].includes("Name c") && lines[0].includes("(c)"));
  }
  {
    // Several errors on one product collapse to one entry with all reasons.
    const p = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d"), item("e")],
      issues: [err("c", "z_code"), err("c", "a_code")],
    });
    ok("one entry per product, not per error", p.withheld.length === 1);
    ok("codes are de-duplicated and sorted", JSON.stringify(p.withheld[0].codes) === JSON.stringify(["a_code", "z_code"]));
    ok("every reason is kept", p.withheld[0].reasons.length === 2);
    ok("the line mentions the extra problem", describeWithheldProducts(p)[0].includes("1 more problem"));
  }
  {
    // Ordering must be stable regardless of issue order.
    const items = [item("a"), item("b"), item("c"), item("d"), item("e"), item("f"), item("g"), item("h")];
    const one = planFullMenuPush({ items, issues: [err("d"), err("b")] });
    const two = planFullMenuPush({ items, issues: [err("b"), err("d")] });
    ok("withheld order is stable", JSON.stringify(one.withheld) === JSON.stringify(two.withheld));
    ok("withheld is sorted by id", one.withheld[0].itemId === "b" && one.withheld[1].itemId === "d");
  }

  /* ---------------- F3: unattributed ---------------- */

  {
    const p = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d")],
      issues: [err(null)],
    });
    ok("an unattributed error refuses (F3)", p.proceed === false);
    ok("the refusal is named", p.refusal === "unattributed");
    ok("nothing is sent", p.sendIds.length === 0);
    ok("the unattributed error is surfaced", p.unattributed.length === 1);
    ok("the narrative explains F3", describeFullMenuPlan(p).includes("could not be traced"));
  }
  {
    // A blank-string itemId counts as unattributed, not as a product named "".
    const p = planFullMenuPush({ items: [item("a"), item("b")], issues: [err("   ")] });
    ok("a whitespace itemId is unattributed", p.refusal === "unattributed");
  }

  /* ---------------- F1: nothing left ---------------- */

  {
    const p = planFullMenuPush({ items: [item("a"), item("b")], issues: [err("a"), err("b")] });
    ok("every product failing refuses (F1)", p.proceed === false);
    ok("the refusal is nothing_left", p.refusal === "nothing_left");
    ok("no empty send is reported as success", p.sendIds.length === 0);
    ok("both are still named", p.withheld.length === 2);
    ok("the narrative says all failed", describeFullMenuPlan(p).includes("all 2 products failed"));
  }

  /* ---------------- F4: the ceiling ---------------- */

  {
    // Exactly 25% -> refuse.
    const items = [item("a"), item("b"), item("c"), item("d")];
    const p = planFullMenuPush({ items, issues: [err("a")] });
    ok("at exactly the ceiling it refuses", p.withheldSharePercent === 25 && p.proceed === false);
    ok("the refusal is too_widespread", p.refusal === "too_widespread");
    ok("the narrative says widespread", describeFullMenuPlan(p).includes("widespread"));
  }
  {
    // 20% -> proceed. Just under.
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    ok(
      "just under the ceiling it proceeds",
      planFullMenuPush({ items, issues: [err("a")] }).proceed === true,
    );
  }
  {
    // The override is honoured, in both directions.
    const items = [item("a"), item("b"), item("c"), item("d")];
    ok(
      "a higher ceiling permits more",
      planFullMenuPush({ items, issues: [err("a")], maxWithheldPercent: 50 }).proceed === true,
    );
    const items5 = [item("a"), item("b"), item("c"), item("d"), item("e")];
    ok(
      "a lower ceiling permits less",
      planFullMenuPush({ items: items5, issues: [err("a")], maxWithheldPercent: 10 }).proceed === false,
    );
  }
  {
    // The ceiling agrees with quarantine's. Drift guard.
    ok("the ceiling is 25", FULL_MENU_MAX_WITHHELD_PERCENT === 25);
  }

  /* ---------------- repair summary ---------------- */

  {
    const repair: FullMenuRepairSummary = {
      repairedItemCount: 3,
      splitItemCount: 2,
      createdItemCount: 6,
      refusalCount: 1,
      clean: true,
    };
    const p = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d"), item("e")],
      issues: [],
      repair,
    });
    ok("the repair summary is echoed", p.repair !== null && p.repair.createdItemCount === 6);
    const text = describeFullMenuPlan(p);
    ok("the narrative mentions corrections", text.includes("sizes corrected automatically"));
    ok("the narrative mentions the split", text.includes("separate Leafly products"));
    ok("the narrative mentions the refusal", text.includes("could not be fixed automatically"));
  }
  {
    const nothing: FullMenuRepairSummary = {
      repairedItemCount: 0,
      splitItemCount: 0,
      createdItemCount: 0,
      refusalCount: 0,
      clean: true,
    };
    ok(
      "a no-op repair reads differently from no repair",
      describeFullMenuRepair(nothing) === " Nothing needed repairing first.",
    );
    ok("no repair says nothing at all", describeFullMenuRepair(null) === "");
  }
  {
    // Singular/plural, because a report that says "1 products" looks broken.
    const one: FullMenuRepairSummary = {
      repairedItemCount: 1,
      splitItemCount: 1,
      createdItemCount: 2,
      refusalCount: 1,
      clean: true,
    };
    const s = describeFullMenuRepair(one);
    ok("singular repaired reads correctly", s.includes("1 product had its sizes"));
    ok("singular split reads correctly", s.includes("1 product was listed"));
    ok("singular refusal reads correctly", s.includes("1 product could not be fixed"));
  }

  /* ---------------- invariants ---------------- */

  {
    // Conservation: every product is either sent or named. Never both, never
    // neither. This is the single most important property in the file.
    const items = [item("a"), item("b"), item("c"), item("d"), item("e"), item("f"), item("g"), item("h")];
    const p = planFullMenuPush({ items, issues: [err("c")] });
    const accounted = new Set([...p.sendIds, ...p.withheld.map((w) => w.itemId)]);
    ok("every product is accounted for", accounted.size === items.length);
    ok(
      "no product is both sent and withheld",
      p.sendIds.every((id) => !p.withheld.some((w) => w.itemId === id)),
    );
  }
  {
    // Refusing always sends nothing. No partial refusal.
    const cases: FullMenuPlan[] = [
      planFullMenuPush({ items: [item("a")], issues: [err(null)] }),
      planFullMenuPush({ items: [item("a")], issues: [err("a")] }),
      planFullMenuPush({ items: [item("a"), item("b"), item("c"), item("d")], issues: [err("a")] }),
    ];
    ok("a refusal always sends nothing", cases.every((c) => c.proceed || c.sendIds.length === 0));
    ok("a refusal always has a reason", cases.every((c) => c.proceed || c.refusal !== null));
    ok("proceeding always has no reason", cases.every((c) => !c.proceed || c.refusal === null));
  }
  {
    // Proceeding always sends at least one product (F1).
    const p = planFullMenuPush({ items: [item("a"), item("b")], issues: [] });
    ok("proceeding sends at least one", !p.proceed || p.sendIds.length > 0);
  }
  {
    // Determinism.
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const issues = [err("b"), warn("a")];
    ok(
      "planning is deterministic",
      JSON.stringify(planFullMenuPush({ items, issues })) ===
        JSON.stringify(planFullMenuPush({ items, issues })),
    );
  }
  {
    // An error naming a product that is not in the menu must not crash, and
    // must not silently vanish either: it lands in `withheld` with a null name.
    const p = planFullMenuPush({
      items: [item("a"), item("b"), item("c"), item("d"), item("e")],
      issues: [err("ghost")],
    });
    ok("an error for an absent product is kept", p.withheld.some((w) => w.itemId === "ghost"));
    ok("its name is null rather than invented", p.withheld.find((w) => w.itemId === "ghost")?.itemName === null);
    ok("it does not reduce what is sent", p.sendIds.length === 5);
  }
  {
    // The list cap.
    const items = Array.from({ length: 30 }, (_, i) => item(`i${String(i).padStart(2, "0")}`));
    const issues = items.slice(0, 20).map((it) => err(it.id));
    const p = planFullMenuPush({ items, issues, maxWithheldPercent: 99 });
    const lines = describeWithheldProducts(p, 5);
    ok("the list is capped", lines.length === 6);
    ok("the overflow is stated", lines[5].includes("15 more products"));
    ok("a zero cap still states the overflow", describeWithheldProducts(p, 0).length === 1);
  }
  {
    // A product with a blank id is not sendable and must not become "".
    const p = planFullMenuPush({ items: [item("a"), { id: "   " }], issues: [] });
    ok("a blank id is never sent", !p.sendIds.includes(""));
    ok("a blank id does not crash", p.proceed === true);
  }

  return { passed, failed };
}
