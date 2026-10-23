/**
 * src/lib/promotions/promo-fix-core.ts   (R74 S22, owner round 11)
 *
 * Owner, verbatim: "I try to build my daily deals promotions. I refuses to
 * publish any of them because there are a few bad apples in the bunch. I need
 * a way to hide these items from the menu so I can publish the promotion right
 * away."
 *
 * PURE helpers for the promotion page's fix-it controls. No I/O, no React,
 * no environment reads.
 *
 * Two facts make "hide it, then publish" correct and not a loophole:
 *
 *  1. A HIDDEN card cannot be sold at a discount. The register refuses a
 *     hidden card (register-availability-core: "hidden_card"), the website
 *     never lists it (live-menu.ts filters `hidden`), and an order line for it
 *     fails placement (order-pricing.ts). So a hidden product can never be
 *     discounted below its cost, and the publish guard does not need to check
 *     it. Before S22 the guard read EVERY published card, hidden or not, so
 *     hiding a bad apple did not unblock the publish.
 *
 *  2. A NEVER-DISCOUNT product is excluded from every rule by the engine
 *     (discount-engine.ts attachConfigs / applyNeverDiscount, and the
 *     storefront snapshots). The standing audit already respected that list;
 *     the publish guard did not.
 *
 * The register still clamps every ticket at the cost floor (defense in depth),
 * and un-hiding a product puts it straight back in front of the standing
 * below-cost audit on the promotions command center.
 */

/** How many products one "Hide all" press may hide (a page of blockers, not the catalog). */
export const MAX_HIDE_PER_PRESS = 100;

/** The hidden_reason prefix written on the enrichment record (the live row uses product-visibility-core). */
export const PROMO_HIDE_REASON_PREFIX = "Hidden from the promotion page";

export type GuardableRow = { key: string; hidden: boolean };

export type GuardableSplit<T> = {
  /** Cards the guard must check: visible and not on the never-discount list. */
  kept: T[];
  /** Hidden cards (not sellable, so never discounted). */
  hiddenSkipped: number;
  /** Visible cards on the never-discount list (the engine never discounts them). */
  neverSkipped: number;
};

/**
 * Drop the cards no promotion can ever discount. A hidden card is counted as
 * hidden even when it is also on the never-discount list (one count each).
 */
export function splitGuardable<T extends GuardableRow>(rows: T[], neverDiscountKeys: string[]): GuardableSplit<T> {
  const never = new Set(neverDiscountKeys.map((k) => k.trim()).filter(Boolean));
  const kept: T[] = [];
  let hiddenSkipped = 0;
  let neverSkipped = 0;
  for (const r of rows) {
    if (r.hidden === true) {
      hiddenSkipped += 1;
      continue;
    }
    if (never.has(r.key)) {
      neverSkipped += 1;
      continue;
    }
    kept.push(r);
  }
  return { kept, hiddenSkipped, neverSkipped };
}

/** One plain sentence for the cost-floor box: what the guard left out and why. */
export function guardSkipNote(hiddenSkipped: number, neverSkipped: number): string | null {
  const parts: string[] = [];
  if (hiddenSkipped > 0) {
    parts.push(`${hiddenSkipped} hidden product${hiddenSkipped === 1 ? "" : "s"} (not on the menu, so never sold at this price)`);
  }
  if (neverSkipped > 0) {
    parts.push(`${neverSkipped} never-discount product${neverSkipped === 1 ? "" : "s"} (no deal ever applies)`);
  }
  if (parts.length === 0) return null;
  return `Not checked: ${parts.join(" and ")}.`;
}

export type BlockerRef = { key: string; name: string };

export type HidePick = { ok: true; picks: BlockerRef[] } | { ok: false; error: string };

/**
 * Which products a Hide press may hide. Only products that are blocking THIS
 * promotion right now (re-checked on the server at press time), so a stale
 * page or a hand-made form can never hide an arbitrary product from here.
 *  - requested "all": every current blocker (at most MAX_HIDE_PER_PRESS).
 *  - requested keys: each must be a current blocker, else the whole press is
 *    refused with the product named (fail closed, nothing hidden).
 */
export function pickProductsToHide(
  requested: string[] | "all",
  blockers: BlockerRef[],
  max: number = MAX_HIDE_PER_PRESS,
): HidePick {
  const byKey = new Map<string, BlockerRef>();
  for (const b of blockers) if (b.key && !byKey.has(b.key)) byKey.set(b.key, b);
  if (requested === "all") {
    const all = Array.from(byKey.values());
    if (all.length === 0) {
      return { ok: false, error: "Nothing to hide: no product is blocking this promotion any more. Press Publish." };
    }
    return { ok: true, picks: all.slice(0, Math.max(1, max)) };
  }
  const keys = Array.from(new Set(requested.map((k) => k.trim()).filter(Boolean)));
  if (keys.length === 0) return { ok: false, error: "Pick a product to hide." };
  if (keys.length > max) {
    return { ok: false, error: `At most ${max} products can be hidden in one press.` };
  }
  const picks: BlockerRef[] = [];
  for (const k of keys) {
    const b = byKey.get(k);
    if (!b) {
      return {
        ok: false,
        error: `Nothing was hidden: product ${k} is not blocking this promotion any more (the page was out of date). Reload and try again.`,
      };
    }
    picks.push(b);
  }
  return { ok: true, picks };
}

/** The reason stored on the product's enrichment record (shown on the product page). */
export function promoHideReason(promoTitle: string): string {
  const t = (promoTitle ?? "").trim() || "a promotion";
  return `${PROMO_HIDE_REASON_PREFIX} (${t}): its price or cost would put the deal below the cost of acquisition.`;
}

export type HideOutcome = {
  hidden: BlockerRef[];
  alreadyHidden: BlockerRef[];
  failed: { ref: BlockerRef; error: string }[];
  /** Still blocking after the hide (re-checked). */
  stillBlocking: number;
};

/** The banner after a Hide press. Loud about failures; says plainly whether Publish will now work. */
export function hideOutcomeMessage(o: HideOutcome): { tone: "ok" | "error"; text: string } {
  const names = (refs: BlockerRef[]) => {
    const shown = refs.slice(0, 5).map((r) => r.name || r.key);
    return shown.join(", ") + (refs.length > 5 ? ` and ${refs.length - 5} more` : "");
  };
  const parts: string[] = [];
  if (o.hidden.length > 0) {
    parts.push(`Hid ${o.hidden.length} product${o.hidden.length === 1 ? "" : "s"} from the menu: ${names(o.hidden)}.`);
  }
  if (o.alreadyHidden.length > 0) {
    parts.push(`Already hidden: ${names(o.alreadyHidden)}.`);
  }
  if (o.failed.length > 0) {
    parts.push(
      `Could not hide ${o.failed.length}: ` +
        o.failed.slice(0, 3).map((f) => `${f.ref.name || f.ref.key} (${f.error})`).join("; ") +
        (o.failed.length > 3 ? ` and ${o.failed.length - 3} more` : "") +
        ".",
    );
  }
  if (o.stillBlocking > 0) {
    parts.push(`${o.stillBlocking} product${o.stillBlocking === 1 ? " still blocks" : "s still block"} publishing.`);
  } else {
    parts.push("Nothing blocks publishing now: press Publish (go live).");
  }
  parts.push("To put a product back, open it and set Visibility to Inherit POS.");
  return { tone: o.failed.length > 0 ? "error" : "ok", text: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPromoFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL promo-fix-core: ${name}`);
    }
  };

  // splitGuardable
  {
    const rows = [
      { key: "a", hidden: false },
      { key: "b", hidden: true },
      { key: "c", hidden: false },
      { key: "d", hidden: true },
    ];
    const s = splitGuardable(rows, ["c", "d", " ", ""]);
    ok(s.kept.length === 1 && s.kept[0].key === "a", "only visible, discountable cards are kept");
    ok(s.hiddenSkipped === 2, "hidden cards counted (also when on the never list)");
    ok(s.neverSkipped === 1, "never-discount visible card counted once");
    const none = splitGuardable(rows, []);
    ok(none.kept.map((r) => r.key).join() === "a,c" && none.neverSkipped === 0, "empty never list keeps every visible card");
    const trimmed = splitGuardable([{ key: "x", hidden: false }], [" x "]);
    ok(trimmed.kept.length === 0 && trimmed.neverSkipped === 1, "never keys are trimmed");
    const extra = splitGuardable([{ key: "x", hidden: false, name: "X" }], []);
    ok(extra.kept[0].name === "X", "rows are passed through untouched");
    ok(splitGuardable([], ["a"]).kept.length === 0, "empty menu is empty");
  }

  // guardSkipNote
  {
    ok(guardSkipNote(0, 0) === null, "nothing skipped -> no note");
    ok(guardSkipNote(1, 0) === "Not checked: 1 hidden product (not on the menu, so never sold at this price).", "one hidden");
    ok(guardSkipNote(3, 2) === "Not checked: 3 hidden products (not on the menu, so never sold at this price) and 2 never-discount products (no deal ever applies).", "both, plural");
    ok(guardSkipNote(0, 1) === "Not checked: 1 never-discount product (no deal ever applies).", "one never");
  }

  // pickProductsToHide
  {
    const blockers = [
      { key: "k1", name: "One" },
      { key: "k2", name: "Two" },
      { key: "k1", name: "One dup" },
    ];
    const all = pickProductsToHide("all", blockers);
    ok(all.ok && all.picks.length === 2 && all.picks[0].name === "One", "all = every current blocker, de-duplicated");
    const capped = pickProductsToHide("all", blockers, 1);
    ok(capped.ok && capped.picks.length === 1, "all is capped at max");
    const noneLeft = pickProductsToHide("all", []);
    ok(!noneLeft.ok && /Press Publish/.test(noneLeft.error), "all with no blockers says publish");
    const one = pickProductsToHide(["k2"], blockers);
    ok(one.ok && one.picks.length === 1 && one.picks[0].key === "k2", "a named blocker is picked");
    const stale = pickProductsToHide(["k2", "zzz"], blockers);
    ok(!stale.ok && /zzz/.test(stale.error) && /Nothing was hidden/.test(stale.error), "a non-blocker refuses the whole press, named");
    const empty = pickProductsToHide([" ", ""], blockers);
    ok(!empty.ok && empty.error === "Pick a product to hide.", "blank keys refused");
    const dup = pickProductsToHide(["k1", " k1 "], blockers);
    ok(dup.ok && dup.picks.length === 1, "repeated keys hide once");
    const tooMany = pickProductsToHide(["k1", "k2"], blockers, 1);
    ok(!tooMany.ok && /At most 1/.test(tooMany.error), "more than max keys refused");
    ok(MAX_HIDE_PER_PRESS === 100, "press cap is 100");
  }

  // promoHideReason
  {
    ok(promoHideReason("Wax Wednesday") === "Hidden from the promotion page (Wax Wednesday): its price or cost would put the deal below the cost of acquisition.", "reason names the promotion");
    ok(promoHideReason("  ").includes("(a promotion)"), "blank title is still a sentence");
    ok(promoHideReason("X").startsWith(PROMO_HIDE_REASON_PREFIX), "reason carries the prefix");
  }

  // hideOutcomeMessage
  {
    const A = { key: "a", name: "Alpha" };
    const B = { key: "b", name: "" };
    const m1 = hideOutcomeMessage({ hidden: [A], alreadyHidden: [], failed: [], stillBlocking: 0 });
    ok(m1.tone === "ok", "clean hide is ok");
    ok(m1.text.startsWith("Hid 1 product from the menu: Alpha."), "names the hidden product");
    ok(m1.text.includes("Nothing blocks publishing now"), "says publish will work");
    ok(m1.text.includes("Inherit POS"), "says how to undo");
    const m2 = hideOutcomeMessage({ hidden: [], alreadyHidden: [], failed: [{ ref: B, error: "db down" }], stillBlocking: 1 });
    ok(m2.tone === "error", "a failure is an error");
    ok(m2.text.includes("Could not hide 1: b (db down).") && m2.text.includes("1 product still blocks publishing."), "failure named with key fallback");
    const many = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, name: `P${i}` }));
    const m3 = hideOutcomeMessage({ hidden: many, alreadyHidden: [A], failed: [], stillBlocking: 2 });
    ok(m3.text.includes("Hid 7 products") && m3.text.includes("P4 and 2 more"), "long lists are shortened");
    ok(m3.text.includes("Already hidden: Alpha.") && m3.text.includes("2 products still block publishing."), "already hidden + plural still block");
  }

  return { passed, failed };
}
