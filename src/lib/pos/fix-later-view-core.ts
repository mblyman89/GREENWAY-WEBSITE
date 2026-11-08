/**
 * src/lib/pos/fix-later-view-core.ts  (D207e)
 *
 * Owner, 2026: "on the fix it later page, under the deep search, it has a
 * dropdown carrot that I can open to see the three manifests. Under this is a
 * table with like 40 or 70 lots that say they don't have a coa, but their
 * manifests listed in the table are not one of the three manifests from the
 * above list. Please look into this for me."
 *
 * Finding: the "Selling now, fix later" table lists EVERY stocked lot with ANY
 * fix-later reason (no menu product, auto price, quarantine, no COA, fixed at
 * the register), not only the lots without a COA; the column showed the lot's
 * barcode (not its manifest). Pure parts of the clearer table:
 *
 *   - parseFixLaterFilter: the `why` query value -> a reason or "all".
 *   - fixLaterChips: one chip per reason present (with its count) + "All".
 *   - fixLaterRows: the rows for the chosen filter, lots fixed at the register
 *     first, then by delivery and name.
 *   - fixLaterExplain: the sentence above the table that says what it is and
 *     how many of its lots have no COA (and on how many deliveries).
 */
import type { FixLaterReason } from "@/lib/pos/register-fix-later-core";

export const FIX_LATER_REASONS: readonly FixLaterReason[] = [
  "no_coa",
  "no_menu_product",
  "quarantine",
  "price_from_cost",
  "price_guessed",
  "category_guessed",
  "fixed_at_register",
];

export type FixLaterFilter = FixLaterReason | "all";

export function parseFixLaterFilter(raw: string | null | undefined): FixLaterFilter {
  const v = (raw ?? "").trim();
  return (FIX_LATER_REASONS as readonly string[]).includes(v) ? (v as FixLaterReason) : "all";
}

export type FixLaterViewRow = { lotId: string; label: string; fixLater: readonly FixLaterReason[]; delivery: string | null };

export function fixLaterChips(rows: readonly FixLaterViewRow[]): { key: FixLaterFilter; count: number }[] {
  const out: { key: FixLaterFilter; count: number }[] = [{ key: "all", count: rows.length }];
  for (const r of FIX_LATER_REASONS) {
    const n = rows.filter((x) => x.fixLater.includes(r)).length;
    if (n > 0) out.push({ key: r, count: n });
  }
  return out;
}

export function fixLaterRows<T extends FixLaterViewRow>(rows: readonly T[], filter: FixLaterFilter): T[] {
  return rows
    .filter((r) => filter === "all" || r.fixLater.includes(filter))
    .sort(
      (a, b) =>
        Number(b.fixLater.includes("fixed_at_register")) - Number(a.fixLater.includes("fixed_at_register")) ||
        (a.delivery ?? "~").localeCompare(b.delivery ?? "~") ||
        a.label.localeCompare(b.label),
    );
}

const s_ = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function fixLaterExplain(rows: readonly FixLaterViewRow[]): string {
  const noCoa = rows.filter((r) => r.fixLater.includes("no_coa"));
  const deliveries = new Set(noCoa.map((r) => r.delivery ?? "?"));
  const other = rows.length - noCoa.length;
  const head = `Every lot with stock that is selling with something still to fix, for ANY reason (not only a missing COA): ${s_(rows.length, "lot")}.`;
  const coa =
    noCoa.length === 0
      ? " None of them is missing its COA."
      : ` ${s_(noCoa.length, "lot")} ${noCoa.length === 1 ? "has" : "have"} no COA, on ${s_(deliveries.size, "delivery", "deliveries")}${other > 0 ? `; the other ${other} are listed for another reason (see "What to fix")` : ""}.`;
  return `${head}${coa} Use the buttons to show one reason at a time.`;
}

export function __runFixLaterViewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL fix-later-view-core: " + m);
    passed += 1;
  };
  ok(parseFixLaterFilter("no_coa") === "no_coa" && parseFixLaterFilter("x' or 1") === "all" && parseFixLaterFilter(null) === "all", "filter parsed strictly");
  const rows: FixLaterViewRow[] = [
    { lotId: "1", label: "B lot", fixLater: ["no_menu_product"], delivery: "CONSCIOUS 1303" },
    { lotId: "2", label: "A lot", fixLater: ["no_coa"], delivery: "GREEN RESEARCH GF4290" },
    { lotId: "3", label: "C lot", fixLater: ["no_coa", "price_from_cost"], delivery: "ALIS 2105" },
    { lotId: "4", label: "D lot", fixLater: ["fixed_at_register", "no_menu_product"], delivery: null },
  ];
  const chips = fixLaterChips(rows);
  ok(chips.map((c) => `${c.key}:${c.count}`).join() === "all:4,no_coa:2,no_menu_product:2,price_from_cost:1,fixed_at_register:1", "chips: only reasons present, with counts");
  ok(fixLaterRows(rows, "no_coa").map((r) => r.lotId).join() === "3,2", "no COA only, by delivery");
  ok(fixLaterRows(rows, "all")[0].lotId === "4", "fixed at the register first");
  ok(fixLaterRows(rows, "quarantine").length === 0, "a reason with no lots shows none");
  const ex = fixLaterExplain(rows);
  ok(ex.includes("for ANY reason") && ex.includes("2 lots have no COA, on 2 deliveries") && ex.includes("the other 2 are listed for another reason"), "explains the mixed table");
  ok(fixLaterExplain([rows[0]]).includes("None of them is missing its COA"), "no COA gaps said");
  ok(FIX_LATER_REASONS.length === 7, "every reason covered");
  return { passed, failed: 0 };
}
