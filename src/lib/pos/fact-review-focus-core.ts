/**
 * src/lib/pos/fact-review-focus-core.ts   (R14b — per-product fix in Fact Review)
 *
 * Owner, Round 14: "I need to be able to publish the menu right away, then be
 * able to go back and fix each product using all the new features … Keep
 * making the fixing features as intelligent as you can so it's as easy as
 * possible to fix the Cultivera garbage."
 *
 * Measured problem (owner screenshot): 614 pending rows. The per-product list
 * was ONE collapsed <details> of all 614 cards, with no way to open only the
 * products that share a reason, no search, and a save that returned to the
 * unfiltered page. The inline fix form offered empty inputs even when the
 * product NAME states the value ("10 x 10mg", "1:1", "3.5g").
 *
 * This core supplies:
 *   1. FOCUS — `?group=<reason key>&q=<text>` narrows the one-at-a-time list
 *      (group keys are fact-review-bulk-core groupKeyForReason slugs), and the
 *      same focus is carried through a save so the reviewer stays in place.
 *   2. NAME SUGGESTIONS — values read LITERALLY from the product name by
 *      extractNameFacts (fact-extraction-core.ts). Only exact statements are
 *      used: "N x Mmg" (servings + mg each), a dose explicitly attributed to
 *      THC or CBD (exactly one each), a ratio label, a single g / ml size.
 *      A bare pack count ("10pk") is NOT a serving count and a dose with no
 *      cannabinoid word is NOT assumed to be THC — both are skipped. When the
 *      name contradicts itself (servings × mg ≠ the stated THC total) the
 *      package total is withheld and the conflict is stated.
 *      Suggestions are NEVER saved automatically (Rule 3.1): the reviewer
 *      presses "Use these values", which records a normal attributed fix with
 *      a note naming the source.
 *
 * PURE: no I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 */
import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";

export const ONE_AT_A_TIME_ANCHOR = "one-at-a-time";

const GROUP_KEY_RE = /^[a-z0-9-]{1,80}$/;
const Q_MAX = 120;

export type FactFocus = { group: string | null; q: string | null };

/** Parse (and sanitise) the focus from search params or form fields. */
export function parseFactFocus(raw: { group?: unknown; q?: unknown }): FactFocus {
  const g = typeof raw.group === "string" ? raw.group.trim() : "";
  const q = typeof raw.q === "string" ? raw.q.trim().replace(/\s+/g, " ").slice(0, Q_MAX) : "";
  return { group: GROUP_KEY_RE.test(g) ? g : null, q: q || null };
}

/** "group=…&q=…" (no leading "?"), or "" when there is no focus. */
export function focusQuery(f: FactFocus): string {
  const parts: string[] = [];
  if (f.group) parts.push(`group=${encodeURIComponent(f.group)}`);
  if (f.q) parts.push(`q=${encodeURIComponent(f.q)}`);
  return parts.join("&");
}

/** Link that opens ONE reason's products, one at a time. */
export function factsGroupHref(importId: string, groupKey: string): string {
  const q = focusQuery(parseFactFocus({ group: groupKey }));
  return `/admin/menu-imports/${encodeURIComponent(importId)}/facts${q ? `?${q}` : ""}#${ONE_AT_A_TIME_ANCHOR}`;
}

/** Where a successful single decision returns: the same focus, list open. */
export function savedRedirectSuffix(f: FactFocus): string {
  const q = focusQuery(f);
  return q ? `&${q}#${ONE_AT_A_TIME_ANCHOR}` : "";
}

export type FocusableRow = { sourceItemId: string; name: string; brand?: string | null };

/**
 * Narrow pending rows to the focus. `groupOf` maps a row id to its reason key
 * (from groupPendingReviews). Search is case-insensitive over name + brand.
 */
export function filterByFocus<T extends FocusableRow>(
  rows: readonly T[],
  f: FactFocus,
  groupOf: (sourceItemId: string) => string | undefined,
): T[] {
  const needle = f.q ? f.q.toLowerCase() : null;
  return rows.filter((r) => {
    if (f.group && groupOf(r.sourceItemId) !== f.group) return false;
    if (needle && !`${r.name} ${r.brand ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

// ─── name suggestions ──────────────────────────────────────────────────────

export type SuggestField =
  | "servingsPerPack"
  | "mgPerServing"
  | "packageThcMg"
  | "packageCbdMg"
  | "ratioLabel"
  | "netWeightGrams"
  | "netVolumeMl";

export type NameSuggestion = { field: SuggestField; label: string; value: string; why: string };

export type NameSuggestions = { suggestions: NameSuggestion[]; conflicts: string[] };

const LABELS: Record<SuggestField, string> = {
  servingsPerPack: "Servings per pack",
  mgPerServing: "Mg per serving",
  packageThcMg: "Package THC (mg)",
  packageCbdMg: "Package CBD (mg)",
  ratioLabel: "Ratio",
  netWeightGrams: "Net weight (g)",
  netVolumeMl: "Net volume (ml)",
};

function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Read the name's literal statements into fix-form values. Never invents. */
export function suggestFactsFromName(name: string | null | undefined): NameSuggestions {
  const text = String(name ?? "").trim();
  const out: NameSuggestion[] = [];
  const conflicts: string[] = [];
  if (!text) return { suggestions: out, conflicts };
  const f = extractNameFacts(text);
  const add = (field: SuggestField, value: number | string, why: string) =>
    out.push({ field, label: LABELS[field], value: typeof value === "number" ? num(value) : value, why });

  const sxd = f.servingsTimesDose;
  if (sxd) {
    add("servingsPerPack", sxd.servings, `The name says "${sxd.servings} x ${num(sxd.mgPerServing)}mg".`);
    add("mgPerServing", sxd.mgPerServing, `The name says "${sxd.servings} x ${num(sxd.mgPerServing)}mg".`);
  }
  for (const [canna, field] of [["THC", "packageThcMg"], ["CBD", "packageCbdMg"]] as const) {
    const hits = f.doses.filter((d) => d.cannabinoid === canna);
    if (hits.length !== 1) continue;
    const mg = hits[0].mg;
    if (canna === "THC" && sxd && Math.abs(sxd.servings * sxd.mgPerServing - mg) > 1e-9) {
      conflicts.push(
        `The name says ${sxd.servings} x ${num(sxd.mgPerServing)}mg (= ${num(sxd.servings * sxd.mgPerServing)}mg) but also ${num(mg)}mg THC — check the package.`,
      );
      continue;
    }
    add(field, mg, `The name says "${num(mg)}mg ${canna}".`);
  }
  if (f.ratioLabel) add("ratioLabel", f.ratioLabel, `The name says "${f.ratioLabel}".`);
  const grams = f.sizes.filter((s) => s.unit === "g");
  if (grams.length === 1) add("netWeightGrams", grams[0].quantity, `The name says "${num(grams[0].quantity)}g".`);
  const mls = f.sizes.filter((s) => s.unit === "ml");
  if (mls.length === 1) add("netVolumeMl", mls[0].quantity, `The name says "${num(mls[0].quantity)}ml".`);
  return { suggestions: out, conflicts };
}

/** The note recorded with a "Use these values" fix. */
export function suggestionNote(s: readonly NameSuggestion[]): string {
  return `Values read from the product name: ${s.map((x) => `${x.label} ${x.value}`).join(", ")}.`;
}

// ─── self-tests ────────────────────────────────────────────────────────────

export function __runFactReviewFocusCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ fact-review-focus-core: ${name}`);
    }
  };

  // Focus parse.
  ok(parseFactFocus({ group: "ratio-mismatch", q: "  wyld  gummies " }).q === "wyld gummies", "q trimmed + collapsed");
  ok(parseFactFocus({ group: "ratio-mismatch" }).group === "ratio-mismatch", "slug accepted");
  ok(parseFactFocus({ group: "Bad Key!" }).group === null, "non-slug refused");
  ok(parseFactFocus({ group: "x".repeat(81) }).group === null, "over-long key refused");
  ok(parseFactFocus({ group: ["a"], q: 5 }).group === null && parseFactFocus({ q: 5 }).q === null, "non-strings ignored");
  ok(parseFactFocus({ q: "x".repeat(300) }).q?.length === Q_MAX, "q capped");
  ok(parseFactFocus({ q: "   " }).q === null, "blank q → null");
  ok(focusQuery({ group: null, q: null }) === "", "no focus → empty");
  ok(focusQuery({ group: "a-b", q: "1:1 & co" }) === "group=a-b&q=1%3A1%20%26%20co", "encoded query");
  ok(factsGroupHref("imp 1", "a-b") === "/admin/menu-imports/imp%201/facts?group=a-b#one-at-a-time", "group href");
  ok(factsGroupHref("i", "BAD KEY") === "/admin/menu-imports/i/facts#one-at-a-time", "bad key → plain list");
  ok(savedRedirectSuffix({ group: null, q: null }) === "", "no focus → no suffix");
  ok(savedRedirectSuffix({ group: "g", q: null }) === "&group=g#one-at-a-time", "suffix keeps focus");

  // Filter.
  const rows = [
    { sourceItemId: "1", name: "Wyld Gummies", brand: "Wyld" },
    { sourceItemId: "2", name: "Doozies", brand: "Ceres" },
    { sourceItemId: "3", name: "Mints", brand: null },
  ];
  const gmap = new Map([["1", "g1"], ["2", "g1"], ["3", "g2"]]);
  const groupOf = (id: string) => gmap.get(id);
  ok(filterByFocus(rows, { group: null, q: null }, groupOf).length === 3, "no focus → all");
  ok(filterByFocus(rows, { group: "g1", q: null }, groupOf).map((r) => r.sourceItemId).join() === "1,2", "group filter");
  ok(filterByFocus(rows, { group: null, q: "CERES" }, groupOf).map((r) => r.sourceItemId).join() === "2", "brand search, case-insensitive");
  ok(filterByFocus(rows, { group: "g2", q: "wyld" }, groupOf).length === 0, "group AND search");
  ok(filterByFocus(rows, { group: "nope", q: null }, groupOf).length === 0, "unknown group → none");

  // Suggestions.
  const val = (n: string, field: SuggestField) => suggestFactsFromName(n).suggestions.find((s) => s.field === field)?.value;
  ok(val("Mints 20 x 5mg", "servingsPerPack") === "20" && val("Mints 20 x 5mg", "mgPerServing") === "5", "N x Mmg");
  ok(val("Doozies 10pk 100mg THC", "servingsPerPack") === undefined, "bare pack count is NOT servings");
  ok(val("Doozies 10pk 100mg THC", "packageThcMg") === "100", "attributed THC dose");
  ok(val("Ceres Soda 12 fl oz 10mg", "packageThcMg") === undefined, "unattributed dose never assumed THC");
  const j = suggestFactsFromName("Journeyman 1:1 Chocolate 100mg THC/100mg CBD");
  ok(j.suggestions.find((s) => s.field === "packageCbdMg")?.value === "100" && j.suggestions.find((s) => s.field === "ratioLabel")?.value === "1:1", "THC+CBD+ratio");
  ok(val("Flower 3.5g", "netWeightGrams") === "3.5", "grams");
  ok(val("Tincture 30ml 1000mg", "netVolumeMl") === "30", "ml");
  ok(val("Ceres Soda 12 fl oz 10mg", "netVolumeMl") === undefined, "fl oz not converted (never guessed)");
  const c = suggestFactsFromName("Gummies 10 x 10mg 50mg THC");
  ok(c.conflicts.length === 1 && c.suggestions.every((s) => s.field !== "packageThcMg"), "self-contradicting name withholds the total");
  ok(c.conflicts[0].includes("check the package"), "conflict stated");
  const agree = suggestFactsFromName("Gummies 10 x 10mg 100mg THC");
  ok(agree.conflicts.length === 0 && agree.suggestions.some((s) => s.field === "packageThcMg" && s.value === "100"), "consistent name keeps the total");
  ok(suggestFactsFromName("").suggestions.length === 0 && suggestFactsFromName(null).suggestions.length === 0, "blank name");
  ok(suggestFactsFromName("Blue Dream").suggestions.length === 0, "no statements → no suggestions");
  ok(suggestFactsFromName("Mints 20 x 5mg").suggestions.every((s) => s.why.startsWith("The name says")), "every suggestion explains itself");
  ok(suggestionNote(suggestFactsFromName("Mints 20 x 5mg").suggestions) === "Values read from the product name: Servings per pack 20, Mg per serving 5.", "note text");
  return { passed, failed };
}
