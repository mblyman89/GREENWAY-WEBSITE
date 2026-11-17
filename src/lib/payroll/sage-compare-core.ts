/**
 * src/lib/payroll/sage-compare-core.ts   (D248 slice 4)
 *
 * SAGE COMPARISON: Michael types (or pastes) what Sage produced for a pay
 * period, per employee per paystub line, and this lays it beside the
 * calculated preview with the difference and a verdict per cell.
 *
 * Owner (D248, verbatim excerpt): "...calculate all things employee payroll
 * for me to compare with sage ... the proper gross amount, and roughly the
 * right amounts for the majority of the taxes ..."
 *
 * Tolerances follow that sentence: gross and hours must match to the cent /
 * hundredth; federal income tax is "rough" (Sage may use the percentage or the
 * wage-bracket method, both lawful); every flat-rate tax must match within a
 * few cents of rounding. The tolerance table is here, in one place, and shown
 * on screen so a verdict is never a mystery.
 *
 * PURE. No I/O. Stored shape is parsed defensively (a bad row is dropped and
 * reported, never trusted). Self-tests at the bottom.
 */

import { PREVIEW_COLUMNS, type PreviewColumnKey, type PreviewRow } from "@/lib/payroll/pay-preview-core";





/** Allowed absolute difference per column (cents, or hundredth-hours for hours). */
export const TOLERANCE: Record<PreviewColumnKey, { abs: number; why: string }> = {
  regularHours: { abs: 0, why: "Same punches, same hours." },
  overtimeHours: { abs: 0, why: "Overtime is over 40 per workweek - must match exactly." },
  regularPay: { abs: 1, why: "Rounding only." },
  overtimePay: { abs: 1, why: "Rounding only." },
  gross: { abs: 1, why: "Gross must match - a cent of rounding at most." },
  federal: { abs: 500, why: "Rough: Sage may use the wage-bracket table; we use the percentage method. Within $5 is normal." },
  socialSecurity: { abs: 2, why: "6.2% of gross - rounding only." },
  medicare: { abs: 2, why: "1.45% of gross - rounding only." },
  additionalMedicare: { abs: 2, why: "0.9% over $200,000 year to date." },
  pfmlEmployee: { abs: 2, why: "Flat rate - rounding only." },
  waCares: { abs: 2, why: "0.58% of gross - rounding only." },
  lniEmployee: { abs: 2, why: "Per hour worked - rounding only." },
  garnishments: { abs: 0, why: "Set by the order." },
  voluntary: { abs: 0, why: "Set by the employee's election." },
  net: { abs: 600, why: "Net carries the federal difference; within $6 follows from the federal tolerance." },
  erSocialSecurity: { abs: 2, why: "Rounding only." },
  erMedicare: { abs: 2, why: "Rounding only." },
  futa: { abs: 2, why: "0.6% up to $7,000 per year - rounding only." },
  suta: { abs: 2, why: "Your ESD rate - rounding only." },
  pfmlEmployer: { abs: 2, why: "Rounding only." },
  lniEmployer: { abs: 2, why: "Per hour worked - rounding only." },
  employerTaxes: { abs: 10, why: "Sum of the employer lines." },
  totalCost: { abs: 10, why: "Gross plus employer taxes." },
};

export type SageEntries = Readonly<Record<string, Readonly<Partial<Record<PreviewColumnKey, number>>>>>;

export type SageCompareDoc = {
  readonly entries: SageEntries;
  readonly updatedAt: string | null;
};

const KEYS = new Set<string>(PREVIEW_COLUMNS.map((c) => c.key));

/** Parse stored JSON. Anything malformed is dropped and counted. */
export function parseSageDoc(raw: unknown): { doc: SageCompareDoc; dropped: number } {
  let dropped = 0;
  const out: Record<string, Partial<Record<PreviewColumnKey, number>>> = {};
  const obj = raw && typeof raw === "object" ? (raw as { entries?: unknown; updatedAt?: unknown }) : null;
  const ents = obj?.entries && typeof obj.entries === "object" ? (obj.entries as Record<string, unknown>) : {};
  for (const [emp, vals] of Object.entries(ents)) {
    if (!vals || typeof vals !== "object") {
      dropped++;
      continue;
    }
    const row: Partial<Record<PreviewColumnKey, number>> = {};
    for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
      if (KEYS.has(k) && typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 1e11) row[k as PreviewColumnKey] = v;
      else dropped++;
    }
    if (Object.keys(row).length > 0) out[emp] = row;
  }
  return { doc: { entries: out, updatedAt: typeof obj?.updatedAt === "string" ? obj.updatedAt : null }, dropped };
}

/**
 * Parse one typed amount into integer hundredths (cents or hundredth-hours).
 * Accepts "1,234.56", "$1234.5", "(12.00)" and "-12". Blank = not entered.
 */
export function parseAmount(s: string): { ok: true; value: number | null } | { ok: false; error: string } {
  let t = s.trim();
  if (t === "") return { ok: true, value: null };
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$,\s]/g, "");
  if (t.startsWith("-")) {
    neg = !neg;
    t = t.slice(1);
  }
  if (!/^\d+(\.\d{0,2})?$/.test(t) && !/^\.\d{1,2}$/.test(t)) return { ok: false, error: `"${s.trim()}" is not an amount.` };
  const [w, f = ""] = t.split(".");
  const v = Number(w || "0") * 100 + Number((f + "00").slice(0, 2));
  return { ok: true, value: neg ? -v : v };
}

export type CellVerdict = "match" | "within" | "off" | "not_entered" | "not_computed";

export type CompareCell = {
  readonly key: PreviewColumnKey;
  readonly ours: number | null;
  readonly sage: number | null;
  /** ours - sage, when both exist. */
  readonly diff: number | null;
  readonly verdict: CellVerdict;
};

export type CompareRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly cells: readonly CompareCell[];
  readonly entered: number;
  readonly matched: number;
  readonly within: number;
  readonly off: number;
  readonly verdict: "match" | "within" | "off" | "not_entered" | "not_computed";
};

export function compareCell(key: PreviewColumnKey, ours: number | null, sage: number | null): CompareCell {
  if (sage === null || sage === undefined) return { key, ours, sage: null, diff: null, verdict: "not_entered" };
  if (ours === null) return { key, ours, sage, diff: null, verdict: "not_computed" };
  const diff = ours - sage;
  const a = Math.abs(diff);
  const verdict: CellVerdict = a === 0 ? "match" : a <= TOLERANCE[key].abs ? "within" : "off";
  return { key, ours, sage, diff, verdict };
}

export function compareRow(row: PreviewRow, sage: Partial<Record<PreviewColumnKey, number>> | undefined): CompareRow {
  const cells = PREVIEW_COLUMNS.map((c) => compareCell(c.key, row.amounts[c.key], sage?.[c.key] ?? null));
  const entered = cells.filter((c) => c.verdict !== "not_entered").length;
  const matched = cells.filter((c) => c.verdict === "match").length;
  const within = cells.filter((c) => c.verdict === "within").length;
  const off = cells.filter((c) => c.verdict === "off").length;
  const notComputed = cells.filter((c) => c.verdict === "not_computed").length;
  const verdict: CompareRow["verdict"] =
    entered === 0 ? "not_entered" : off > 0 ? "off" : notComputed > 0 && matched + within === 0 ? "not_computed" : within > 0 ? "within" : "match";
  return { employeeId: row.employeeId, name: row.name, cells, entered, matched, within, off, verdict };
}

export type CompareSummary = {
  readonly employeesEntered: number;
  readonly cellsEntered: number;
  readonly matched: number;
  readonly within: number;
  readonly off: number;
  /** Per column: how many employees are off, and the total difference. */
  readonly byColumn: readonly { key: PreviewColumnKey; label: string; entered: number; off: number; totalDiff: number }[];
};

export function summarize(rows: readonly CompareRow[]): CompareSummary {
  const byColumn = PREVIEW_COLUMNS.map((c) => {
    let entered = 0;
    let off = 0;
    let totalDiff = 0;
    for (const r of rows) {
      const cell = r.cells.find((x) => x.key === c.key);
      if (!cell || cell.verdict === "not_entered") continue;
      entered++;
      if (cell.verdict === "off") off++;
      totalDiff += cell.diff ?? 0;
    }
    return { key: c.key, label: c.label, entered, off, totalDiff };
  });
  return {
    employeesEntered: rows.filter((r) => r.entered > 0).length,
    cellsEntered: rows.reduce((s, r) => s + r.entered, 0),
    matched: rows.reduce((s, r) => s + r.matched, 0),
    within: rows.reduce((s, r) => s + r.within, 0),
    off: rows.reduce((s, r) => s + r.off, 0),
    byColumn,
  };
}

/* ── CSV paste: the preview CSV with Sage's numbers typed in ───────────────── */

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Parse a pasted CSV: a header row with "Employee" and any of the preview
 * column labels (the downloaded preview CSV, edited with Sage's numbers, works
 * as-is). Employees are matched by exact name, case-insensitive. Unknown
 * names, unknown columns and bad amounts are reported, never guessed.
 */
export function parseSageCsv(
  text: string,
  employees: readonly { id: string; name: string }[],
): { entries: Record<string, Partial<Record<PreviewColumnKey, number>>>; problems: string[] } {
  const problems: string[] = [];
  const entries: Record<string, Partial<Record<PreviewColumnKey, number>>> = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const hi = lines.findIndex((l) => norm(splitCsvLine(l)[0] ?? "") === "employee");
  if (hi < 0) return { entries, problems: ['No header row starting with "Employee" was found.'] };
  const head = splitCsvLine(lines[hi]);
  const labelToKey = new Map(PREVIEW_COLUMNS.map((c) => [norm(c.label), c.key] as const));
  const colKeys = head.map((h) => labelToKey.get(norm(h)) ?? null);
  if (colKeys.every((k) => k === null)) problems.push("None of the header columns matched a paystub line.");
  const byName = new Map(employees.map((e) => [e.name.trim().toLowerCase(), e.id] as const));
  for (const l of lines.slice(hi + 1)) {
    const cells = splitCsvLine(l);
    const name = (cells[0] ?? "").trim();
    if (!name || /^total/i.test(name)) continue;
    const id = byName.get(name.toLowerCase());
    if (!id) {
      problems.push(`"${name}" is not an employee on this pay run - row skipped.`);
      continue;
    }
    const row: Partial<Record<PreviewColumnKey, number>> = {};
    cells.forEach((v, i) => {
      const k = colKeys[i];
      if (!k) return;
      const p = parseAmount(v);
      if (!p.ok) problems.push(`${name}, ${head[i]}: ${p.error}`);
      else if (p.value !== null) row[k] = p.value;
    });
    if (Object.keys(row).length > 0) entries[id] = { ...(entries[id] ?? {}), ...row };
  }
  return { entries, problems };
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════ */

export function __runSageCompareCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`sage-compare-core FAIL: ${name}`);
    }
  };

  // parseAmount
  const pa = (s: string) => {
    const r = parseAmount(s);
    return r.ok ? r.value : "ERR";
  };
  ok("plain", pa("12.34") === 1234);
  ok("commas+dollar", pa("$1,234.56") === 123456);
  ok("one decimal", pa("5.5") === 550);
  ok("whole", pa("17") === 1700);
  ok("leading dot", pa(".07") === 7);
  ok("parens negative", pa("(12.00)") === -1200);
  ok("minus", pa("-3.10") === -310);
  ok("blank is null", pa("  ") === null);
  ok("three decimals refused", pa("1.234") === "ERR");
  ok("letters refused", pa("abc") === "ERR");
  ok("double dot refused", pa("1.2.3") === "ERR");

  // compareCell
  ok("exact match", compareCell("gross", 1000, 1000).verdict === "match");
  ok("gross 1c within", compareCell("gross", 1001, 1000).verdict === "within");
  ok("gross 2c off", compareCell("gross", 1002, 1000).verdict === "off");
  ok("federal $4.99 within", compareCell("federal", 10499, 10000).verdict === "within");
  ok("federal $5.01 off", compareCell("federal", 10501, 10000).verdict === "off");
  ok("diff sign ours-sage", compareCell("medicare", 100, 103).diff === -3);
  ok("not entered", compareCell("suta", 100, null).verdict === "not_entered");
  ok("not computed", compareCell("suta", null, 100).verdict === "not_computed");
  ok("OT hours exact", compareCell("overtimeHours", 150, 125).verdict === "off");
  ok("every column has a tolerance", PREVIEW_COLUMNS.every((c) => TOLERANCE[c.key] && TOLERANCE[c.key].abs >= 0 && TOLERANCE[c.key].why.length > 0));

  // compareRow / summarize
  const amounts = Object.fromEntries(PREVIEW_COLUMNS.map((c) => [c.key, null])) as Record<PreviewColumnKey, number | null>;
  amounts.gross = 100000;
  amounts.federal = 6000;
  amounts.net = 85000;
  const prow: PreviewRow = { employeeId: "e1", name: "Pat Doe", status: "ready", amounts, sickHundredthHours: 0, sickPayEstimateCents: null, tipsCents: null, problems: [], notes: [], reAdds: true };
  const r0 = compareRow(prow, undefined);
  ok("row nothing entered", r0.verdict === "not_entered" && r0.entered === 0);
  const r1 = compareRow(prow, { gross: 100000, federal: 6000 });
  ok("row match", r1.verdict === "match" && r1.matched === 2);
  const r2 = compareRow(prow, { gross: 100000, federal: 6200 });
  ok("row within", r2.verdict === "within" && r2.within === 1);
  const r3 = compareRow(prow, { gross: 99000 });
  ok("row off", r3.verdict === "off" && r3.off === 1);
  const r4 = compareRow(prow, { suta: 400 });
  ok("row not computed only", r4.verdict === "not_computed");
  const s = summarize([r1, r2, r3, r0]);
  ok("summary employees", s.employeesEntered === 3);
  ok("summary counts", s.matched === 3 && s.within === 1 && s.off === 1 && s.cellsEntered === 5);
  const g = s.byColumn.find((c) => c.key === "gross")!;
  ok("summary by column", g.entered === 3 && g.off === 1 && g.totalDiff === 1000);

  // parseSageDoc
  const d = parseSageDoc({ entries: { e1: { gross: 100, bogus: 5, net: 1.5 }, e2: "x", e3: {} }, updatedAt: "2026-11-17T00:00:00Z" });
  ok("doc keeps good", d.doc.entries.e1?.gross === 100 && d.doc.entries.e1?.net === undefined);
  ok("doc dropped count", d.dropped === 3);
  ok("doc empty row omitted", d.doc.entries.e3 === undefined);
  ok("doc updatedAt", d.doc.updatedAt === "2026-11-17T00:00:00Z");
  ok("doc null safe", Object.keys(parseSageDoc(null).doc.entries).length === 0);

  // parseSageCsv
  const emps = [{ id: "e1", name: "Pat Doe" }, { id: "e2", name: "Lee, Sam" }];
  const csv = [
    "Greenway payroll preview - title line",
    "Employee,Status,Gross,Federal income tax,Social Security,Mystery",
    "Pat Doe,ready,\"1,000.00\",60.00,62.00,9",
    "\"Lee, Sam\",ready,500.00,abc,31.00,",
    "Nobody,ready,1.00,,,",
    "TOTAL (computed rows),,1500.00,,,",
  ].join("\n");
  const pc = parseSageCsv(csv, emps);
  ok("csv pat gross", pc.entries.e1?.gross === 100000 && pc.entries.e1?.federal === 6000 && pc.entries.e1?.socialSecurity === 6200);
  ok("csv quoted name", pc.entries.e2?.gross === 50000 && pc.entries.e2?.socialSecurity === 3100);
  ok("csv bad amount reported", pc.problems.some((p) => p.includes("Lee, Sam") && p.includes("abc")));
  ok("csv unknown name reported", pc.problems.some((p) => p.includes("Nobody")));
  ok("csv total row skipped", !pc.problems.some((p) => p.includes("TOTAL")));
  ok("csv no header", parseSageCsv("a,b\n1,2", emps).problems.length === 1);
  ok("csv case-insensitive name", parseSageCsv("employee,gross\npat doe,1.00", emps).entries.e1?.gross === 100);

  return { passed, failed };
}
