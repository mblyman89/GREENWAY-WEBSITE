// Leafly Menu Integration API v2.0 — SHIPPING 598 GOOD ITEMS INSTEAD OF NONE.
//
// ###########################################################################
// # WHY THIS FILE EXISTS                                                    #
// #                                                                         #
// # A full-menu push failed like this:                                      #
// #                                                                         #
// #   Leafly payload failed validation with 128 error(s)                    #
// #                                                                         #
// # and nothing was sent. Not the bad items — NOTHING. A menu of several    #
// # hundred products stayed off Leafly because a handful of them had a      #
// # milligram value typed into a percentage field.                          #
// #                                                                         #
// # The all-or-nothing behaviour was a deliberate decision, and the reason  #
// # for it is written in push.ts:                                           #
// #                                                                         #
// #   "It throws rather than filtering: a payload that violates the         #
// #    contract means the BUILDER is wrong, and a wrong builder fails       #
// #    systematically across many items at once. Sending 'the valid ones'   #
// #    would publish a partial menu and hide the cause."                    #
// #                                                                         #
// # That reasoning is CORRECT, and this module does not overturn it. It     #
// # draws a distinction the original did not:                               #
// #                                                                         #
// #   A BUILDER defect is our code being wrong. It hits items               #
// #   indiscriminately — every Flower, every variant, whatever the shape of #
// #   the data. Shipping around it publishes a half-menu and buries the     #
// #   bug. The right answer is to stop.                                     #
// #                                                                         #
// #   A DATA defect is one product's saved values being wrong. It hits      #
// #   exactly the products a human mistyped. Stopping the whole menu        #
// #   punishes 598 innocent products for 2 guilty ones, and — worse — it    #
// #   leaves the owner with no menu at all while they hunt for the typo.    #
// #                                                                         #
// # So: quarantine is OPT-IN, it is BOUNDED, and it REFUSES ITSELF when the #
// # damage looks systematic. If a large share of the menu is failing, that  #
// # is not two typos, that is our builder, and we stop exactly as before.   #
// #                                                                         #
// # THE FAILURE MODE THIS MODULE IS DESIGNED AGAINST                        #
// #                                                                         #
// # The dangerous version of this feature is the one that quietly drops     #
// # items forever. The owner turns it on once, forgets, and six months      #
// # later a product has been invisible on Leafly the whole time because it  #
// # has been silently quarantined on every sync. Nobody ever told them.     #
// #                                                                         #
// # Everything below is shaped by that: a quarantine is always reported,    #
// # always names the product and the reason in plain words, and the ceiling #
// # exists so a broad failure can never be mistaken for routine tidying.    #
// ###########################################################################
//
// PURITY
// ------
// Zero imports. Pure functions of their arguments. Runs under plain `tsx`.

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What to do when the payload we built does not satisfy the contract.
 *
 * `block` — the behaviour that has always existed, and still the default.
 *   Nothing is sent. Safest, and correct when the cause is our code.
 *
 * `quarantine` — drop the offending ITEMS, send the rest, and report exactly
 *   what was dropped and why. Correct when the cause is a handful of bad
 *   product records, which is the common case in a real shop.
 */
export type InvalidItemPolicy = "block" | "quarantine";

export const INVALID_ITEM_POLICIES: readonly InvalidItemPolicy[] = ["block", "quarantine"];

export function isInvalidItemPolicy(value: unknown): value is InvalidItemPolicy {
  return value === "block" || value === "quarantine";
}

/**
 * The ceiling, as a PERCENTAGE of the menu.
 *
 * Above this share of items failing, quarantine refuses to act and the push
 * blocks instead. A percentage rather than a fixed count because a shop with
 * 40 products and a shop with 4,000 have very different ideas of "a few".
 *
 * WHY 25. Below a quarter, the pattern is consistent with a set of individual
 * product records being wrong — someone mistyped a batch of edibles. At or
 * above a quarter, the arithmetic stops supporting that story: a defect
 * touching one item in four is touching a whole CLASS of items, and a class of
 * items is our mapping code, not a typist. That is the case the original
 * all-or-nothing rule was written for, and it still wins.
 *
 * This is a judgement call, and it is worth being honest that it is one. It is
 * exposed as a named constant so it can be argued with, and the behaviour at
 * exactly the boundary is pinned by tests in both directions.
 */
export const QUARANTINE_MAX_SHARE_PERCENT = 25;

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The shape this module needs from a validation issue. Structural rather than
 * an import of the validator's own type, which keeps this file dependency-free
 * and lets the tests build issues by hand.
 */
export type QuarantineIssue = {
  severity: "error" | "warning";
  code: string;
  path: string;
  itemId: string | null;
  message: string;
};

export type QuarantineItem = {
  id: string;
  name?: string | null;
};

/* -------------------------------------------------------------------------- */
/* Outputs                                                                    */
/* -------------------------------------------------------------------------- */

export type QuarantinedItem = {
  itemId: string;
  itemName: string | null;
  /** Distinct error codes that condemned this item. */
  codes: string[];
  /** The full messages, so the owner sees the real explanation. */
  reasons: string[];
};

export type QuarantineDecision = {
  /** True when the caller may proceed with `keptItemIds`. */
  proceed: boolean;
  /**
   * Why not, when `proceed` is false.
   *   "policy_block"   — the owner has quarantine switched off.
   *   "too_widespread" — above the ceiling; this looks like a builder defect.
   *   "nothing_left"   — every item failed, so there is no menu to send.
   */
  blockedReason: "policy_block" | "too_widespread" | "nothing_left" | null;
  keptItemIds: string[];
  quarantined: QuarantinedItem[];
  /**
   * Errors that named no item at all (a malformed payload envelope, say).
   * These can never be quarantined — there is nothing to drop — so their
   * presence always blocks.
   */
  unattributableErrors: QuarantineIssue[];
  totalItems: number;
  /** Failing items as a percentage of the menu, rounded to one decimal. */
  failureSharePercent: number;
};

/* -------------------------------------------------------------------------- */
/* The decision                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Decide what to send when validation found errors.
 *
 * Pure: the caller supplies the items and the issues, and gets back a verdict
 * plus the exact id list to send. It performs no filtering of the payload
 * itself, because the payload's shape belongs to the builder and duplicating
 * that knowledge here is how the two would drift apart.
 */
export function decideQuarantine(input: {
  items: readonly QuarantineItem[];
  issues: readonly QuarantineIssue[];
  policy: InvalidItemPolicy;
  maxSharePercent?: number;
}): QuarantineDecision {
  const items = input.items;
  const totalItems = items.length;
  const ceiling = input.maxSharePercent ?? QUARANTINE_MAX_SHARE_PERCENT;

  const errors = input.issues.filter((i) => i.severity === "error");

  // Group errors by the item they blame.
  const byItem = new Map<string, QuarantineIssue[]>();
  const unattributable: QuarantineIssue[] = [];
  for (const e of errors) {
    const id = e.itemId;
    if (id === null || id === "") {
      unattributable.push(e);
      continue;
    }
    const list = byItem.get(id);
    if (list === undefined) byItem.set(id, [e]);
    else list.push(e);
  }

  const nameOf = new Map<string, string | null>();
  for (const it of items) nameOf.set(it.id, it.name ?? null);

  const quarantined: QuarantinedItem[] = [];
  for (const [itemId, list] of byItem) {
    quarantined.push({
      itemId,
      itemName: nameOf.get(itemId) ?? null,
      codes: Array.from(new Set(list.map((i) => i.code))).sort(),
      reasons: list.map((i) => i.message),
    });
  }
  // Stable order so two runs on the same data read the same way.
  quarantined.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const condemned = new Set(quarantined.map((q) => q.itemId));
  const keptItemIds = items.map((i) => i.id).filter((id) => !condemned.has(id));

  const failureSharePercent =
    totalItems === 0 ? 0 : Math.round((quarantined.length / totalItems) * 1000) / 10;

  const base = {
    keptItemIds,
    quarantined,
    unattributableErrors: unattributable,
    totalItems,
    failureSharePercent,
  };

  // No errors at all: nothing to decide. `proceed` is true and every item is
  // kept, so a caller can run this unconditionally.
  if (errors.length === 0) {
    return { proceed: true, blockedReason: null, ...base };
  }

  // An error that blames no item cannot be quarantined away. Something is
  // wrong with the payload as a whole, which is exactly the systematic case.
  if (unattributable.length > 0) {
    return { proceed: false, blockedReason: "too_widespread", ...base };
  }

  if (input.policy === "block") {
    return { proceed: false, blockedReason: "policy_block", ...base };
  }

  if (keptItemIds.length === 0) {
    return { proceed: false, blockedReason: "nothing_left", ...base };
  }

  // The ceiling. `>=` rather than `>`: at exactly a quarter we stop. When a
  // threshold is a judgement call, the conservative side of the boundary is
  // the one that does not publish.
  if (failureSharePercent >= ceiling) {
    return { proceed: false, blockedReason: "too_widespread", ...base };
  }

  return { proceed: true, blockedReason: null, ...base };
}

/* -------------------------------------------------------------------------- */
/* Telling the owner                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The headline. Returns null when there is nothing worth saying, so a clean
 * sync stays silent instead of printing a reassuring line nobody reads.
 */
export function describeQuarantine(d: QuarantineDecision): string | null {
  if (d.quarantined.length === 0 && d.unattributableErrors.length === 0) return null;

  const n = d.quarantined.length;
  const productWord = n === 1 ? "product" : "products";

  if (d.proceed) {
    return (
      `${d.keptItemIds.length} products were sent to Leafly. ${n} ${productWord} ` +
      `(${d.failureSharePercent}% of the menu) had problems in their saved data and were held ` +
      `back. The rest of the menu is live and correct. Fix the ${n === 1 ? "one" : "few"} below ` +
      `and ${n === 1 ? "it" : "they"} will publish on the next sync.`
    );
  }

  switch (d.blockedReason) {
    case "policy_block":
      return (
        `Nothing was sent. ${n} ${productWord} failed validation, and low-quality items are set ` +
        `to stop the whole sync. Either fix the ${n === 1 ? "product" : "products"} below, or ` +
        `switch the setting to "send the good ones" so the rest of the menu can publish.`
      );
    case "too_widespread":
      if (d.unattributableErrors.length > 0) {
        return (
          `Nothing was sent. The problem is with the menu as a whole rather than with individual ` +
          `products, so there is nothing that could safely be held back. This is a fault in the ` +
          `integration itself and needs a developer, not a data fix.`
        );
      }
      return (
        `Nothing was sent. ${n} of ${d.totalItems} products failed — ${d.failureSharePercent}% of ` +
        `the menu. A failure that widespread is a fault in the integration rather than a few ` +
        `mistyped products, so the sync stopped instead of publishing a gutted menu. This needs ` +
        `a developer.`
      );
    case "nothing_left":
      return (
        `Nothing was sent, because every one of the ${d.totalItems} products failed validation. ` +
        `There was no good menu left to publish. This needs a developer.`
      );
    default:
      return null;
  }
}

/** One line per held-back product, ready for a list in the admin UI. */
export function describeQuarantinedItems(d: QuarantineDecision): string[] {
  return d.quarantined.map((q) => {
    const who = q.itemName ? `${q.itemName} (${q.itemId})` : q.itemId;
    const first = q.reasons[0] ?? "No reason recorded.";
    const more =
      q.reasons.length > 1
        ? ` …and ${q.reasons.length - 1} more problem${q.reasons.length - 1 === 1 ? "" : "s"}.`
        : "";
    return `${who}: ${first}${more}`;
  });
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyQuarantineTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  const items = (n: number): QuarantineItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `Product ${i}` }));

  const err = (itemId: string | null, code = "content_percent_over_100"): QuarantineIssue => ({
    severity: "error",
    code,
    path: `items[0].compounds[0].content`,
    itemId,
    message: `\`content\` is 1000 with unit "percent". A potency above 100% is impossible.`,
  });

  const warn = (itemId: string): QuarantineIssue => ({
    severity: "warning",
    code: "content_zero",
    path: "items[0]",
    itemId,
    message: "warning only",
  });

  // ---- policy guard ------------------------------------------------------
  ok("block is a policy", isInvalidItemPolicy("block"));
  ok("quarantine is a policy", isInvalidItemPolicy("quarantine"));
  ok("junk is not a policy", !isInvalidItemPolicy("skip"));
  ok("null is not a policy", !isInvalidItemPolicy(null));
  ok("number is not a policy", !isInvalidItemPolicy(1));
  ok("policy list has exactly two", INVALID_ITEM_POLICIES.length === 2);

  // ---- clean menu --------------------------------------------------------
  const clean = decideQuarantine({ items: items(10), issues: [], policy: "quarantine" });
  ok("clean proceeds", clean.proceed);
  ok("clean keeps everything", clean.keptItemIds.length === 10);
  ok("clean quarantines nothing", clean.quarantined.length === 0);
  ok("clean has no reason", clean.blockedReason === null);
  ok("clean share is zero", clean.failureSharePercent === 0);
  ok("clean says nothing", describeQuarantine(clean) === null);

  // Warnings must NEVER quarantine. They are advice, not defects.
  const warnOnly = decideQuarantine({
    items: items(10),
    issues: [warn("i0"), warn("i1")],
    policy: "quarantine",
  });
  ok("warnings proceed", warnOnly.proceed);
  ok("warnings keep everything", warnOnly.keptItemIds.length === 10);
  ok("warnings quarantine nothing", warnOnly.quarantined.length === 0);
  ok("warnings say nothing", describeQuarantine(warnOnly) === null);

  // ---- THE OWNER'S CASE: a few bad items in a big menu -------------------
  // 600 items, 2 bad — the real shape of the reported failure.
  const big = decideQuarantine({
    items: items(600),
    issues: [err("i55"), err("i55", "content_not_number"), err("i101", "variant_size_indistinguishable")],
    policy: "quarantine",
  });
  ok("600-item menu proceeds", big.proceed);
  ok("598 kept", big.keptItemIds.length === 598);
  ok("2 quarantined", big.quarantined.length === 2);
  ok("i55 dropped", !big.keptItemIds.includes("i55"));
  ok("i101 dropped", !big.keptItemIds.includes("i101"));
  ok("i0 survives", big.keptItemIds.includes("i0"));
  ok("share is tiny", big.failureSharePercent < 1);

  // The two errors on one item collapse into ONE quarantined product with two
  // reasons, because the owner fixes products, not error lines.
  const i55 = big.quarantined.find((q) => q.itemId === "i55");
  ok("i55 has one record", i55 !== undefined);
  ok("i55 records both reasons", (i55?.reasons.length ?? 0) === 2);
  ok("i55 records both codes", (i55?.codes.length ?? 0) === 2);
  ok("i55 codes sorted", (i55?.codes ?? []).join(",") === "content_not_number,content_percent_over_100");
  ok("i55 carries its name", i55?.itemName === "Product 55");

  const bigText = describeQuarantine(big) ?? "";
  ok("headline exists", bigText.length > 0);
  ok("headline counts sent", bigText.includes("598 products were sent"));
  ok("headline counts held", bigText.includes("2 products"));
  ok("headline reassures", bigText.includes("live and correct"));

  const lines = describeQuarantinedItems(big);
  ok("one line per product", lines.length === 2);
  ok("line names the product", lines[0].includes("Product 101") || lines[1].includes("Product 101"));
  ok("line carries the id", lines.some((l) => l.includes("i55")));
  ok("multi-reason line says so", lines.some((l) => l.includes("and 1 more problem")));

  // ---- the default policy still blocks -----------------------------------
  const blocked = decideQuarantine({
    items: items(600),
    issues: [err("i55")],
    policy: "block",
  });
  ok("block policy does not proceed", !blocked.proceed);
  ok("block policy names itself", blocked.blockedReason === "policy_block");
  // Even when blocking, the diagnosis is still computed — the owner needs to
  // know WHICH product to fix whether or not we sent anything.
  ok("block still identifies the item", blocked.quarantined.length === 1);
  const blockedText = describeQuarantine(blocked) ?? "";
  ok("block headline says nothing sent", blockedText.includes("Nothing was sent"));
  ok("block headline offers the setting", blockedText.includes("send the good ones"));

  // ---- the ceiling -------------------------------------------------------
  // 100 items, 24 bad = 24% -> under the ceiling, proceed.
  const under = decideQuarantine({
    items: items(100),
    issues: Array.from({ length: 24 }, (_, i) => err(`i${i}`)),
    policy: "quarantine",
  });
  ok("24% proceeds", under.proceed);
  ok("24% share computed", under.failureSharePercent === 24);
  ok("24% keeps 76", under.keptItemIds.length === 76);

  // 25 bad = exactly 25% -> AT the ceiling, stop.
  const at = decideQuarantine({
    items: items(100),
    issues: Array.from({ length: 25 }, (_, i) => err(`i${i}`)),
    policy: "quarantine",
  });
  ok("25% stops", !at.proceed);
  ok("25% reason is widespread", at.blockedReason === "too_widespread");
  ok("25% share computed", at.failureSharePercent === 25);
  const atText = describeQuarantine(at) ?? "";
  ok("widespread headline says developer", atText.includes("needs a developer"));
  ok("widespread headline gives the share", atText.includes("25%"));

  // 26 bad -> well over, stop.
  const over = decideQuarantine({
    items: items(100),
    issues: Array.from({ length: 26 }, (_, i) => err(`i${i}`)),
    policy: "quarantine",
  });
  ok("26% stops", !over.proceed);
  ok("26% reason is widespread", over.blockedReason === "too_widespread");

  // The ceiling is configurable, and honoured.
  const loose = decideQuarantine({
    items: items(100),
    issues: Array.from({ length: 40 }, (_, i) => err(`i${i}`)),
    policy: "quarantine",
    maxSharePercent: 50,
  });
  ok("custom ceiling honoured", loose.proceed);
  const tight = decideQuarantine({
    items: items(100),
    issues: [err("i0")],
    policy: "quarantine",
    maxSharePercent: 0.5,
  });
  ok("tight ceiling honoured", !tight.proceed);

  // ---- everything failed -------------------------------------------------
  const allBad = decideQuarantine({
    items: items(3),
    issues: [err("i0"), err("i1"), err("i2")],
    policy: "quarantine",
  });
  ok("all-bad stops", !allBad.proceed);
  // ORDER OF THE GUARDS, pinned deliberately. 100% failure satisfies BOTH
  // `nothing_left` and the ceiling, so which message the owner gets depends on
  // the order of the checks. `nothing_left` is checked first and therefore
  // wins, and that is the outcome we want: "every single product failed" is a
  // more precise and more actionable statement than "25% or more failed".
  // Both messages end in "needs a developer", so nothing is lost by being
  // specific. The first draft of this test asserted the opposite and failed —
  // the test was wrong, not the code, and the assertion is kept here so the
  // ordering can never be silently swapped.
  ok("all-bad reason is nothing_left", allBad.blockedReason === "nothing_left");
  ok("all-bad keeps nothing", allBad.keptItemIds.length === 0);
  const nlText = describeQuarantine(allBad) ?? "";
  ok("nothing-left headline is honest", nlText.includes("every one of the 3 products failed"));
  ok("nothing-left headline says developer", nlText.includes("needs a developer"));

  // And the ceiling still owns the case where SOMETHING survives but the
  // damage is too broad — proving the two guards are genuinely distinct
  // rather than one shadowing the other.
  const mostlyBad = decideQuarantine({
    items: items(10),
    issues: Array.from({ length: 9 }, (_, i) => err(`i${i}`)),
    policy: "quarantine",
  });
  ok("90% failure stops", !mostlyBad.proceed);
  ok("90% failure is widespread, not nothing_left", mostlyBad.blockedReason === "too_widespread");
  ok("90% failure had a survivor", mostlyBad.keptItemIds.length === 1);

  // ---- unattributable errors always block --------------------------------
  const envelope = decideQuarantine({
    items: items(100),
    issues: [err(null, "payload_not_object")],
    policy: "quarantine",
  });
  ok("unattributable stops even under quarantine", !envelope.proceed);
  ok("unattributable is widespread", envelope.blockedReason === "too_widespread");
  ok("unattributable recorded", envelope.unattributableErrors.length === 1);
  const envText = describeQuarantine(envelope) ?? "";
  ok("unattributable headline blames the integration", envText.includes("menu as a whole"));
  ok("unattributable headline says developer", envText.includes("needs a developer"));

  // An empty-string itemId is just as unattributable as null. This is the kind
  // of gap a `=== null` check leaves behind.
  const emptyId = decideQuarantine({
    items: items(100),
    issues: [err("", "payload_not_object")],
    policy: "quarantine",
  });
  ok("empty-string itemId is unattributable", !emptyId.proceed);
  ok("empty-string itemId recorded", emptyId.unattributableErrors.length === 1);

  // ---- an error naming an item NOT in the list ---------------------------
  // Should still be treated as a quarantine (we cannot send what we cannot
  // identify), and must not crash or invent a name.
  const ghost = decideQuarantine({
    items: items(10),
    issues: [err("does-not-exist")],
    policy: "quarantine",
  });
  ok("ghost id still quarantines", ghost.quarantined.length === 1);
  ok("ghost id has null name", ghost.quarantined[0].itemName === null);
  ok("ghost id does not remove a real item", ghost.keptItemIds.length === 10);
  const ghostLine = describeQuarantinedItems(ghost)[0];
  ok("ghost line falls back to the id", ghostLine.startsWith("does-not-exist:"));

  // ---- empty menu --------------------------------------------------------
  const none = decideQuarantine({ items: [], issues: [], policy: "quarantine" });
  ok("empty menu proceeds", none.proceed);
  ok("empty menu share is zero not NaN", none.failureSharePercent === 0);
  ok("empty menu total zero", none.totalItems === 0);

  // ---- determinism -------------------------------------------------------
  // Same input twice must give a byte-identical answer, including ORDER.
  const runA = decideQuarantine({
    items: items(50),
    issues: [err("i9"), err("i3"), err("i40")],
    policy: "quarantine",
  });
  const runB = decideQuarantine({
    items: items(50),
    issues: [err("i40"), err("i9"), err("i3")],
    policy: "quarantine",
  });
  ok(
    "PROPERTY: quarantine order is stable regardless of issue order",
    JSON.stringify(runA.quarantined.map((q) => q.itemId)) ===
      JSON.stringify(runB.quarantined.map((q) => q.itemId)),
  );
  ok(
    "PROPERTY: kept list is stable regardless of issue order",
    JSON.stringify(runA.keptItemIds) === JSON.stringify(runB.keptItemIds),
  );

  // ---- the invariant that protects the menu ------------------------------
  // kept and quarantined must PARTITION the input: no item both sent and held,
  // none silently vanished. A drop that belongs to neither list is the exact
  // "invisible for six months" failure this module exists to prevent.
  let partitionBreaks = 0;
  for (const badCount of [0, 1, 2, 5, 10, 24]) {
    const d = decideQuarantine({
      items: items(100),
      issues: Array.from({ length: badCount }, (_, i) => err(`i${i}`)),
      policy: "quarantine",
    });
    const kept = new Set(d.keptItemIds);
    const held = new Set(d.quarantined.map((q) => q.itemId));
    if (kept.size + held.size !== 100) partitionBreaks += 1;
    for (const id of held) if (kept.has(id)) partitionBreaks += 1;
  }
  ok("PROPERTY: kept and quarantined partition the menu exactly", partitionBreaks === 0);

  // Whenever we proceed, we must be sending something. Proceeding with an
  // empty list would be a silent full outage dressed up as success.
  let emptyProceeds = 0;
  for (const badCount of [0, 1, 50, 99, 100]) {
    const d = decideQuarantine({
      items: items(100),
      issues: Array.from({ length: badCount }, (_, i) => err(`i${i}`)),
      policy: "quarantine",
    });
    if (d.proceed && d.keptItemIds.length === 0) emptyProceeds += 1;
  }
  ok("PROPERTY: never proceeds with an empty menu", emptyProceeds === 0);

  return { passed, failed };
}
