/**
 * src/lib/compliance/ccrs-resend-refused-core.ts — D227 S4 (PURE).
 *
 * "Re-send refused rows": after CCRS refused some rows of a Sale file and the
 * error file was applied (rows -> `rejected`), build a file that carries ONLY
 * those sale lines again, recomputed by today's exporter.
 *
 * Why it is safe:
 *   - CCRS accepts a Sale file row by row; a refused row was never filed, so
 *     it goes again as Insert (routeSaleInserts already re-sends any line with
 *     no ledger entry). "Duplicate Sale for Licensee" [G L1390] only happens
 *     for a line CCRS holds, and a held line is dropped by the fresh build.
 *   - The rows come from a FRESH build of the same dates (the fixed money,
 *     the ledger routing, the E60 last check), never from the stored bytes of
 *     the refused file, so the fault that caused the refusal is not repeated.
 *   - Every row must pass the excise identity CCRS checks:
 *     CannabisExciseTax == round(37% x (Quantity x UnitPrice - Discount))
 *     [G L1374, L1377], with Discount and taxes for the whole line
 *     [FAQ L0153-L0160]; only a medical sale may carry 0 [G L1378].
 *   - Only `rejected` rows are re-sent. `uncertain` rows (CCRS may hold them)
 *     are never re-sent here.
 */
import { CCRS_COLUMNS, ccrsReaderSplit } from "./ccrs-batch-core";
import { ccrsPrintedExciseMinor } from "@/lib/reports/tax-base-core";

export type RefusedRow = { rowNo: number; externalId: string; state: string; saleDate: string | null };

const COL = (name: string) => CCRS_COLUMNS.Sale.indexOf(name);

/** MM/DD/YYYY -> YYYY-MM-DD (null when not that shape). */
export function saleDateIso(mdy: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((mdy ?? "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** "12.31" -> 1231; null when it is not a plain non-negative 2-decimal amount. */
export function moneyMinor(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

/** What to re-send and over which dates, from the rows of the refused file. */
export function resendScope(rows: readonly RefusedRow[]): {
  ids: string[];
  from: string | null;
  to: string | null;
  undated: string[];
} {
  const refused = rows.filter((r) => r.state === "rejected");
  const ids = [...new Set(refused.map((r) => r.externalId))];
  const dates = refused.map((r) => saleDateIso(r.saleDate)).filter((d): d is string => !!d).sort();
  const undated = refused.filter((r) => !saleDateIso(r.saleDate)).map((r) => r.externalId);
  return { ids, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, undated };
}

/** The excise identity CCRS applies to one Sale data row; null = holds. */
export function saleRowIdentityProblem(cells: readonly string[]): string | null {
  const qty = Number(cells[COL("Quantity")]);
  const unit = moneyMinor(cells[COL("UnitPrice")]);
  const disc = moneyMinor(cells[COL("Discount")]);
  const excise = moneyMinor(cells[COL("CannabisExciseTax")]);
  const type = cells[COL("SaleType")];
  if (!Number.isFinite(qty) || qty <= 0 || unit === null || disc === null || excise === null) return "a money or quantity cell is not a plain amount";
  if (type === "RecreationalMedical" && excise === 0) return null;
  const want = ccrsPrintedExciseMinor(qty, unit, disc);
  return want === excise ? null : `CannabisExciseTax ${(excise / 100).toFixed(2)} is not 37% of ${qty} x ${(unit / 100).toFixed(2)} - ${(disc / 100).toFixed(2)} (= ${(want / 100).toFixed(2)})`;
}

export type ResendPlan = {
  /** The new Sale csv (only the refused lines), null when nothing can go. */
  csv: string | null;
  sent: string[];
  /** Refused ids the fresh build does not carry (held back, already re-sent in a later file, or the sale changed). */
  notInBuild: string[];
  /** Rows the fresh build carries that still fail the identity (never sent). */
  failing: { id: string; why: string }[];
  /** Rows that would not go as Insert (CCRS would refuse an Update for a line it never filed). */
  notInsert: string[];
};

/**
 * Keep only the refused lines of a freshly built Sale csv. The 3 header rows
 * and the column row are kept; NumberRecords is rewritten to the kept count.
 */
export function planResendRefused(freshSaleCsv: string, refusedIds: readonly string[]): ResendPlan {
  const want = new Set(refusedIds);
  const body = freshSaleCsv.endsWith("\r\n") ? freshSaleCsv.slice(0, -2) : freshSaleCsv;
  const lines = body.split("\r\n");
  const out: ResendPlan = { csv: null, sent: [], notInBuild: [], failing: [], notInsert: [] };
  if (lines.length < 4) {
    out.notInBuild = [...want];
    return out;
  }
  const D = COL("SaleDetailExternalIdentifier");
  const OP = COL("Operation");
  const keep: string[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(4)) {
    if (line === "") continue;
    const cells = ccrsReaderSplit(line);
    const id = cells[D];
    if (!want.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (cells[OP] !== "Insert") {
      out.notInsert.push(id);
      continue;
    }
    const why = saleRowIdentityProblem(cells);
    if (why) {
      out.failing.push({ id, why });
      continue;
    }
    keep.push(line);
    out.sent.push(id);
  }
  out.notInBuild = refusedIds.filter((id) => !seen.has(id));
  if (keep.length > 0) out.csv = [lines[0], lines[1], `NumberRecords,${keep.length}`, lines[3], ...keep].join("\r\n") + "\r\n";
  return out;
}

/** The note shown to the owner after the press (one line per outcome). */
export function resendSummaryText(plan: ResendPlan, fileName: string | null): string {
  const parts: string[] = [];
  if (fileName) parts.push(`${plan.sent.length} refused row(s) are in ${fileName}: download it from the files list, upload it, then mark it uploaded.`);
  else parts.push("No re-send file was made.");
  if (plan.notInBuild.length) parts.push(`${plan.notInBuild.length} not re-sent (already in a later file, held back, or the sale changed): ${plan.notInBuild.join(", ")}.`);
  if (plan.failing.length) parts.push(`${plan.failing.length} still fail the excise check and were not sent: ${plan.failing.map((f) => `${f.id} (${f.why})`).join("; ")}.`);
  if (plan.notInsert.length) parts.push(`${plan.notInsert.length} would not go as Insert and were not sent: ${plan.notInsert.join(", ")}.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 * Self-tests (PURE)
 * ------------------------------------------------------------------ */

export function __runCcrsResendRefusedCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-resend-refused-core: ${m}`);
    }
  };
  const head = ["SubmittedBy,Greenway", "SubmittedDate,11/10/2026", "NumberRecords,3", CCRS_COLUMNS.Sale.join(",")];
  const row = (id: string, qty: string, unit: string, disc: string, excise: string, op = "Insert", type = "RecreationalRetail") => {
    const c = CCRS_COLUMNS.Sale.map(() => "");
    c[COL("LicenseNumber")] = "413541";
    c[COL("SaleType")] = type;
    c[COL("SaleDate")] = "11/06/2026";
    c[COL("Quantity")] = qty;
    c[COL("UnitPrice")] = unit;
    c[COL("Discount")] = disc;
    c[COL("RetailSalesTax")] = "0.00";
    c[COL("CannabisExciseTax")] = excise;
    c[COL("SaleDetailExternalIdentifier")] = id;
    c[COL("Operation")] = op;
    return c.join(",");
  };
  // D227 real case, fixed: 3 x 12.31 - 0.02 = 36.91 -> 13.66.
  const csv = [...head, row("A", "3", "12.31", "0.02", "13.66"), row("B", "1", "23.92", "7.17", "6.20"), row("C", "3", "12.30", "0.00", "13.66")].join("\r\n") + "\r\n";

  ok(moneyMinor("12.31") === 1231 && moneyMinor("0.5") === 50 && moneyMinor("$1") === null && moneyMinor("-1.00") === null, "moneyMinor");
  ok(saleDateIso("11/06/2026") === "2026-11-06" && saleDateIso("2026-11-06") === null, "saleDateIso");

  const p = planResendRefused(csv, ["A", "C", "Z"]);
  ok(p.sent.join() === "A", "only the refused line that holds the identity is sent");
  ok(p.failing.length === 1 && p.failing[0].id === "C" && p.failing[0].why.includes("13.65"), "the pre-D227 line (12.30/0.00) is caught, never sent");
  ok(p.notInBuild.join() === "Z", "a refused id the fresh build does not carry is reported");
  ok(!!p.csv && p.csv.split("\r\n")[2] === "NumberRecords,1" && p.csv.endsWith("\r\n") && !p.csv.includes(",B,") , "NumberRecords rewritten; unrefused lines never ride along");
  ok(p.csv!.split("\r\n")[3] === CCRS_COLUMNS.Sale.join(","), "column row kept");

  const u = planResendRefused([...head, row("A", "3", "12.31", "0.02", "13.66", "Update")].join("\r\n") + "\r\n", ["A"]);
  ok(u.csv === null && u.notInsert.join() === "A", "an Update is never re-sent for a line CCRS never filed");

  const med = planResendRefused([...head, row("M", "2", "10.00", "0.00", "0.00", "Insert", "RecreationalMedical")].join("\r\n") + "\r\n", ["M"]);
  ok(med.sent.join() === "M", "medical 0 excise passes [G L1378]");
  const rec0 = planResendRefused([...head, row("R", "2", "10.00", "0.00", "0.00")].join("\r\n") + "\r\n", ["R"]);
  ok(rec0.sent.length === 0 && rec0.failing.length === 1, "non-medical 0 excise fails");
  // FAQ worked example [FAQ L0153-L0160]: 3 x 5.00 - 3.00 = 12.00 -> 4.44.
  ok(saleRowIdentityProblem(ccrsReaderSplit(row("F", "3", "5.00", "3.00", "4.44"))) === null, "FAQ example holds");

  const s = resendScope([
    { rowNo: 80, externalId: "A", state: "rejected", saleDate: "11/06/2026" },
    { rowNo: 81, externalId: "B", state: "rejected", saleDate: "11/08/2026" },
    { rowNo: 82, externalId: "C", state: "uncertain", saleDate: "11/01/2026" },
    { rowNo: 83, externalId: "D", state: "confirmed", saleDate: "11/01/2026" },
    { rowNo: 84, externalId: "E", state: "rejected", saleDate: null },
  ]);
  ok(s.ids.join() === "A,B,E" && s.from === "2026-11-06" && s.to === "2026-11-08", "scope = rejected rows only, their date span");
  ok(s.undated.join() === "E", "an undated refused row is reported");

  const t = resendSummaryText(p, "Sale_413541_20261110160000.csv");
  ok(t.includes("1 refused row(s)") && t.includes("Z") && t.includes("13.65"), "summary names every outcome");
  ok(resendSummaryText({ csv: null, sent: [], notInBuild: [], failing: [], notInsert: [] }, null).startsWith("No re-send"), "summary with no file");
  return { passed, failed };
}
