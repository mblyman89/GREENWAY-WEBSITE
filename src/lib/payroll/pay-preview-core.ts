/**
 * src/lib/payroll/pay-preview-core.ts   (D248 slice 3)
 *
 * THE PAY-RUN PREVIEW: the existing pay-run engine's answer for a period, laid
 * out as a payroll register - one row per employee, one column per line of a
 * Sage paystub - with period totals and a self-check that every row re-adds.
 *
 * Owner (D248, verbatim excerpt): "...take the hours worked and calculate all
 * things employee payroll for me to compare with sage ... gross pay, rough fed
 * tax, all other taxes should be accurate."
 *
 * NOTHING HERE CALCULATES A TAX. Every amount comes from computePayRun (the
 * engine behind /admin/books/pay-run: Pub. 15-T worksheet 1A, FICA with the
 * wage base, WA PFML, WA Cares, L&I per hour, FUTA, SUTA, garnishments). This
 * file only arranges those numbers and checks that they add up, so the
 * register and the engine can never disagree.
 *
 * Two things the engine's gross does NOT include are reported beside it,
 * never silently added: paid sick leave taken (an estimate at the regular
 * rate) and tips. Adding them would change every tax on the row, and the
 * engine has not computed those taxes - so they are shown as "not in gross"
 * for the owner to compare with Sage line by line.
 *
 * PURE. No I/O. Self-tests at the bottom (__runPayPreviewCoreTests).
 * Never books, files or pays.
 */

/* ═════════════════════════════════════════════════════════════════════════ *
 * INPUT SHAPES - the minimum of PayRunLine this file reads (structural, so the
 * self-tests can build lines without the whole engine)
 * ═════════════════════════════════════════════════════════════════════════ */

export type PreviewLineInput = {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly status: "ready" | "attention" | "blocked";
  readonly netPayCents: number | null;
  readonly grossWagesCents: number | null;
  readonly totalGarnishedCents: number;
  readonly refusals: readonly { message: string; whatToDo: string }[];
  readonly attentionNotes: readonly string[];
  readonly breakdown: { readonly totalVoluntaryCents: number } | null;
  readonly taxes: {
    readonly grossWagesCents: number;
    readonly federalIncomeTax: { readonly line4b_withholdingCents: number };
    readonly fica: {
      readonly employeeOasdiCents: number;
      readonly employerOasdiCents: number;
      readonly employeeMedicareCents: number;
      readonly employerMedicareCents: number;
      readonly employeeAdditionalMedicareCents: number;
      readonly oasdiCeilingReached: boolean;
    };
    readonly futa: { readonly netFutaCents: number };
    readonly pfml: { readonly employeeShareCents: number; readonly employerShareCents: number };
    readonly waCares: { readonly employeeCents: number; readonly exempt: boolean };
    readonly suta: { ok: true; value: { employerCents: number } } | { ok: false; refusal: { message?: string } };
    readonly lni:
      | { ok: true; value: { employeeCents: number; employerCents: number } }
      | { ok: false; refusal: { message?: string } };
    readonly totalEmployeeWithheldCents: number;
    readonly uncollectedEmployeeTaxCents: number;
    readonly totalEmployerTaxCents: number;
    readonly netPayCents: number;
  } | null;
  readonly w4Provenance?: string;
};

/** Hours and side-amounts the register shows next to the engine's money. */
export type PreviewHours = {
  readonly regularHundredthHours: number | null;
  readonly overtimeHundredthHours: number | null;
  readonly straightTimeCents: number | null;
  readonly overtimePremiumCents: number | null;
  readonly hourlyRateMilliCents: number | null;
  readonly sickMinutes: number;
  readonly tipsCents: number | null;
};

/* ═════════════════════════════════════════════════════════════════════════ *
 * OUTPUT
 * ═════════════════════════════════════════════════════════════════════════ */

/** Column keys, in Sage paystub order. Used for the table, the CSV and slice 4. */
export const PREVIEW_COLUMNS = [
  { key: "regularHours", label: "Regular hrs", kind: "hours" },
  { key: "overtimeHours", label: "OT hrs", kind: "hours" },
  { key: "regularPay", label: "Regular pay", kind: "money" },
  { key: "overtimePay", label: "OT pay", kind: "money" },
  { key: "gross", label: "Gross", kind: "money" },
  { key: "federal", label: "Federal income tax", kind: "money" },
  { key: "socialSecurity", label: "Social Security", kind: "money" },
  { key: "medicare", label: "Medicare", kind: "money" },
  { key: "additionalMedicare", label: "Addl. Medicare", kind: "money" },
  { key: "pfmlEmployee", label: "WA PFML (employee)", kind: "money" },
  { key: "waCares", label: "WA Cares", kind: "money" },
  { key: "lniEmployee", label: "L&I (employee)", kind: "money" },
  { key: "garnishments", label: "Garnishments", kind: "money" },
  { key: "voluntary", label: "Other deductions", kind: "money" },
  { key: "net", label: "Net pay", kind: "money" },
  { key: "erSocialSecurity", label: "ER Social Security", kind: "money" },
  { key: "erMedicare", label: "ER Medicare", kind: "money" },
  { key: "futa", label: "FUTA", kind: "money" },
  { key: "suta", label: "WA SUTA", kind: "money" },
  { key: "pfmlEmployer", label: "WA PFML (employer)", kind: "money" },
  { key: "lniEmployer", label: "L&I (employer)", kind: "money" },
  { key: "employerTaxes", label: "Employer taxes", kind: "money" },
  { key: "totalCost", label: "Total cost", kind: "money" },
] as const;

export type PreviewColumnKey = (typeof PREVIEW_COLUMNS)[number]["key"];

/** Hours columns are in hundredths; money columns in cents. Null = not computed. */
export type PreviewAmounts = Record<PreviewColumnKey, number | null>;

export type PreviewRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly status: "ready" | "attention" | "blocked";
  readonly amounts: PreviewAmounts;
  /** Sick hours taken in the period and their estimated pay - NOT in gross. */
  readonly sickHundredthHours: number;
  readonly sickPayEstimateCents: number | null;
  readonly tipsCents: number | null;
  /** Rows the engine could not compute: its reasons, verbatim. */
  readonly problems: readonly string[];
  readonly notes: readonly string[];
  /** Self-check: gross - employee withheld - garnishments - voluntary = net. */
  readonly reAdds: boolean;
};

export type PreviewTotals = PreviewAmounts & {
  readonly sickHundredthHours: number;
  readonly sickPayEstimateCents: number;
  readonly tipsCents: number;
};

/* ═════════════════════════════════════════════════════════════════════════ *
 * BUILD
 * ═════════════════════════════════════════════════════════════════════════ */

function emptyAmounts(): PreviewAmounts {
  const a = {} as Record<PreviewColumnKey, number | null>;
  for (const c of PREVIEW_COLUMNS) a[c.key] = null;
  return a;
}

/** Sick pay estimate at the regular hourly rate, whole cents, half up. */
export function sickPayEstimate(minutes: number, rateMilliCents: number | null): number | null {
  if (rateMilliCents === null || rateMilliCents <= 0) return null;
  const m = Math.max(0, Math.floor(minutes));
  return Math.round((m * rateMilliCents) / 60 / 1000);
}

export function buildPreviewRow(line: PreviewLineInput, hours: PreviewHours | null): PreviewRow {
  const a = emptyAmounts();
  const h = hours;
  a.regularHours = h?.regularHundredthHours ?? null;
  a.overtimeHours = h?.overtimeHundredthHours ?? null;
  const sickH = Math.round(((h?.sickMinutes ?? 0) * 100) / 60);
  const sickEst = h ? sickPayEstimate(h.sickMinutes, h.hourlyRateMilliCents) : null;
  const notes: string[] = [...line.attentionNotes];

  const t = line.taxes;
  if (line.status === "blocked" || !t) {
    return {
      employeeId: line.employeeId,
      name: line.employeeName,
      status: "blocked",
      amounts: a,
      sickHundredthHours: sickH,
      sickPayEstimateCents: sickEst,
      tipsCents: h?.tipsCents ?? null,
      problems: line.refusals.map((r) => `${r.message} ${r.whatToDo}`.trim()),
      notes,
      reAdds: true,
    };
  }

  // Regular pay = straight time on regular hours; OT pay = 1.5x on OT hours
  // (straight time on OT hours + the half-time premium), as Sage shows them.
  // Derived from the timesheet engine's own split; they must re-add to gross.
  if (h && h.straightTimeCents !== null && h.overtimePremiumCents !== null && h.regularHundredthHours !== null && h.overtimeHundredthHours !== null) {
    const totalH = h.regularHundredthHours + h.overtimeHundredthHours;
    const stOnOt = totalH > 0 ? Math.round((h.straightTimeCents * h.overtimeHundredthHours) / totalH) : 0;
    a.regularPay = h.straightTimeCents - stOnOt;
    a.overtimePay = stOnOt + h.overtimePremiumCents;
    if (a.regularPay + a.overtimePay !== t.grossWagesCents) {
      notes.push("Regular + OT pay do not re-add to the engine's gross; the engine's gross is the one used.");
    }
  }
  a.gross = t.grossWagesCents;
  a.federal = t.federalIncomeTax.line4b_withholdingCents;
  a.socialSecurity = t.fica.employeeOasdiCents;
  a.medicare = t.fica.employeeMedicareCents;
  a.additionalMedicare = t.fica.employeeAdditionalMedicareCents;
  a.pfmlEmployee = t.pfml.employeeShareCents;
  a.waCares = t.waCares.employeeCents;
  a.lniEmployee = t.lni.ok ? t.lni.value.employeeCents : null;
  a.garnishments = line.totalGarnishedCents;
  a.voluntary = line.breakdown?.totalVoluntaryCents ?? 0;
  a.net = line.netPayCents;
  a.erSocialSecurity = t.fica.employerOasdiCents;
  a.erMedicare = t.fica.employerMedicareCents;
  a.futa = t.futa.netFutaCents;
  a.suta = t.suta.ok ? t.suta.value.employerCents : null;
  a.pfmlEmployer = t.pfml.employerShareCents;
  a.lniEmployer = t.lni.ok ? t.lni.value.employerCents : null;
  a.employerTaxes = t.totalEmployerTaxCents;
  a.totalCost = t.grossWagesCents + t.totalEmployerTaxCents;

  if (!t.lni.ok) notes.push(`L&I not computed: ${t.lni.refusal.message ?? "rate refused"}.`);
  if (!t.suta.ok) notes.push(`SUTA not computed: ${t.suta.refusal.message ?? "rate refused"}.`);
  if (t.fica.oasdiCeilingReached) notes.push("Social Security wage base reached this year - no more Social Security on wages above it.");
  if (t.waCares.exempt) notes.push("WA Cares exemption on file - no WA Cares premium.");
  if (t.uncollectedEmployeeTaxCents > 0) notes.push(`This cheque could not carry all its withholding: ${(t.uncollectedEmployeeTaxCents / 100).toFixed(2)} uncollected.`);
  if (line.w4Provenance && /default|none|missing/i.test(line.w4Provenance)) notes.push("No usable W-4: federal tax uses the IRS default (single, no adjustments).");

  const withheld =
    (a.federal ?? 0) + (a.socialSecurity ?? 0) + (a.medicare ?? 0) + (a.additionalMedicare ?? 0) + (a.pfmlEmployee ?? 0) + (a.waCares ?? 0) + (a.lniEmployee ?? 0);
  // Withheld parts may be cut short by the insufficient-funds rule; the engine's
  // own total is what came out. Re-add check uses the engine total, and checks
  // the parts too when nothing went uncollected.
  const partsOk = t.uncollectedEmployeeTaxCents > 0 || withheld === t.totalEmployeeWithheldCents;
  const netOk = a.net !== null && t.grossWagesCents - t.totalEmployeeWithheldCents - (a.garnishments ?? 0) - (a.voluntary ?? 0) === a.net;
  const erOk =
    (a.erSocialSecurity ?? 0) + (a.erMedicare ?? 0) + (a.futa ?? 0) + (a.suta ?? 0) + (a.pfmlEmployer ?? 0) + (a.lniEmployer ?? 0) === t.totalEmployerTaxCents;

  return {
    employeeId: line.employeeId,
    name: line.employeeName,
    status: line.status,
    amounts: a,
    sickHundredthHours: sickH,
    sickPayEstimateCents: sickEst,
    tipsCents: h?.tipsCents ?? null,
    problems: [],
    notes,
    reAdds: partsOk && netOk && erOk,
  };
}

/** Column totals over computed rows only (blocked rows are listed, not summed). */
export function previewTotals(rows: readonly PreviewRow[]): PreviewTotals {
  const t = {} as Record<PreviewColumnKey, number | null>;
  for (const c of PREVIEW_COLUMNS) {
    let sum = 0;
    let any = false;
    for (const r of rows) {
      if (r.status === "blocked") continue;
      const v = r.amounts[c.key];
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    t[c.key] = any ? sum : null;
  }
  return {
    ...t,
    sickHundredthHours: rows.reduce((s, r) => s + r.sickHundredthHours, 0),
    sickPayEstimateCents: rows.reduce((s, r) => s + (r.sickPayEstimateCents ?? 0), 0),
    tipsCents: rows.reduce((s, r) => s + (r.tipsCents ?? 0), 0),
  };
}

/** Effective rates on the period, for the "does this look right" glance. */
export function effectiveRates(t: PreviewAmounts): { label: string; pct: number | null }[] {
  const g = t.gross;
  const pct = (v: number | null) => (g && g > 0 && v !== null ? Math.round((v / g) * 10000) / 100 : null);
  return [
    { label: "Federal income tax", pct: pct(t.federal) },
    { label: "Social Security", pct: pct(t.socialSecurity) },
    { label: "Medicare", pct: pct(t.medicare) },
    { label: "WA PFML (employee)", pct: pct(t.pfmlEmployee) },
    { label: "WA Cares", pct: pct(t.waCares) },
    { label: "Net pay", pct: pct(t.net) },
    { label: "Employer taxes", pct: pct(t.employerTaxes) },
  ];
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * CSV (for side-by-side with a Sage export)
 * ═════════════════════════════════════════════════════════════════════════ */

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function fmtColumn(kind: "hours" | "money", v: number | null): string {
  if (v === null) return "";
  return (v / 100).toFixed(2);
}

export function previewCsv(rows: readonly PreviewRow[], meta: { periodLabel: string; payDate: string }): string {
  const head = ["Employee", "Status", ...PREVIEW_COLUMNS.map((c) => c.label), "Sick hrs (not in gross)", "Sick pay est. (not in gross)", "Tips (not in gross)"];
  const lines = [
    csvCell(`Greenway payroll preview - ${meta.periodLabel} - pay date ${meta.payDate} - CALCULATED FOR COMPARISON ONLY (not booked, not paid)`),
    head.map(csvCell).join(","),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.status,
        ...PREVIEW_COLUMNS.map((c) => fmtColumn(c.kind, r.amounts[c.key])),
        fmtColumn("hours", r.sickHundredthHours),
        fmtColumn("money", r.sickPayEstimateCents),
        fmtColumn("money", r.tipsCents),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const t = previewTotals(rows);
  lines.push(
    [
      "TOTAL (computed rows)",
      "",
      ...PREVIEW_COLUMNS.map((c) => fmtColumn(c.kind, t[c.key])),
      fmtColumn("hours", t.sickHundredthHours),
      fmtColumn("money", t.sickPayEstimateCents),
      fmtColumn("money", t.tipsCents),
    ]
      .map(csvCell)
      .join(","),
  );
  return lines.join("\n") + "\n";
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * SELF-TESTS
 * ═════════════════════════════════════════════════════════════════════════ */

export function __runPayPreviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ pay-preview-core: ${m}`);
    }
  };

  // A real-shaped line: 80h + 5h OT at $20.00 = 85h straight 1700.00 + premium 50.00 = 1750.00 gross.
  const taxes = (over: Partial<NonNullable<PreviewLineInput["taxes"]>> = {}): NonNullable<PreviewLineInput["taxes"]> => ({
    grossWagesCents: 175000,
    federalIncomeTax: { line4b_withholdingCents: 12000 },
    fica: { employeeOasdiCents: 10850, employerOasdiCents: 10850, employeeMedicareCents: 2538, employerMedicareCents: 2538, employeeAdditionalMedicareCents: 0, oasdiCeilingReached: false },
    futa: { netFutaCents: 1050 },
    pfml: { employeeShareCents: 1413, employerShareCents: 0 },
    waCares: { employeeCents: 1015, exempt: false },
    suta: { ok: true, value: { employerCents: 700 } },
    lni: { ok: true, value: { employeeCents: 140, employerCents: 336 } },
    totalEmployeeWithheldCents: 12000 + 10850 + 2538 + 1413 + 1015 + 140,
    uncollectedEmployeeTaxCents: 0,
    totalEmployerTaxCents: 10850 + 2538 + 1050 + 700 + 0 + 336,
    netPayCents: 175000 - (12000 + 10850 + 2538 + 1413 + 1015 + 140),
    ...over,
  });
  const line = (over: Partial<PreviewLineInput> = {}): PreviewLineInput => ({
    employeeId: "e1",
    employeeName: "Pat",
    status: "ready",
    netPayCents: 175000 - 27956,
    grossWagesCents: 175000,
    totalGarnishedCents: 0,
    refusals: [],
    attentionNotes: [],
    breakdown: { totalVoluntaryCents: 0 },
    taxes: taxes(),
    ...over,
  });
  const hrs: PreviewHours = {
    regularHundredthHours: 8000,
    overtimeHundredthHours: 500,
    straightTimeCents: 170000,
    overtimePremiumCents: 5000,
    hourlyRateMilliCents: 2_000_000,
    sickMinutes: 240,
    tipsCents: 3125,
  };

  ok(sickPayEstimate(240, 2_000_000) === 8000, "4h sick at $20 = $80");
  ok(sickPayEstimate(240, null) === null, "no rate -> no estimate");
  ok(sickPayEstimate(-5, 2_000_000) === 0, "negative minutes clamp");
  ok(sickPayEstimate(1, 1_713_000) === 29, "1 min at $17.13 rounds to 29c");

  const r = buildPreviewRow(line(), hrs);
  ok(r.amounts.gross === 175000, "gross from engine");
  ok(r.amounts.regularPay === 160000, "regular pay = 80h x $20");
  ok(r.amounts.overtimePay === 15000, "OT pay = 5h x $30");
  ok((r.amounts.regularPay ?? 0) + (r.amounts.overtimePay ?? 0) === r.amounts.gross, "reg + OT = gross");
  ok(r.amounts.federal === 12000 && r.amounts.socialSecurity === 10850 && r.amounts.medicare === 2538, "fed/SS/medicare");
  ok(r.amounts.pfmlEmployee === 1413 && r.amounts.waCares === 1015 && r.amounts.lniEmployee === 140, "WA employee lines");
  ok(r.amounts.net === 147044, "net");
  ok(r.amounts.employerTaxes === 15474 && r.amounts.totalCost === 190474, "employer + total cost");
  ok(r.reAdds, "row re-adds");
  ok(r.sickHundredthHours === 400 && r.sickPayEstimateCents === 8000, "sick hours + estimate shown");
  ok(r.tipsCents === 3125, "tips shown");
  ok(r.amounts.regularHours === 8000 && r.amounts.overtimeHours === 500, "hours");
  ok(r.notes.length === 0, "no notes on a clean row");

  // A row whose net does not re-add is caught.
  const bad = buildPreviewRow(line({ netPayCents: 147000 }), hrs);
  ok(!bad.reAdds, "net mismatch caught");
  // A row whose employer parts do not re-add is caught.
  const badEr = buildPreviewRow(line({ taxes: taxes({ totalEmployerTaxCents: 1 }) }), hrs);
  ok(!badEr.reAdds, "employer mismatch caught");
  // Garnishment reduces net and still re-adds.
  const g = buildPreviewRow(line({ totalGarnishedCents: 5000, netPayCents: 142044 }), hrs);
  ok(g.reAdds && g.amounts.garnishments === 5000, "garnishment re-adds");

  // L&I / SUTA refused: null, noted, employer total still checked against what was computed.
  const lniOff = buildPreviewRow(
    line({
      taxes: taxes({
        lni: { ok: false, refusal: { message: "L&I rate not on file" } },
        totalEmployeeWithheldCents: 12000 + 10850 + 2538 + 1413 + 1015,
        totalEmployerTaxCents: 10850 + 2538 + 1050 + 700,
      }),
      netPayCents: 175000 - (12000 + 10850 + 2538 + 1413 + 1015),
    }),
    hrs,
  );
  ok(lniOff.amounts.lniEmployee === null && lniOff.amounts.lniEmployer === null, "L&I null when refused");
  ok(lniOff.notes.some((n) => n.includes("L&I not computed")), "L&I refusal noted");
  ok(lniOff.reAdds, "still re-adds without L&I");

  // Blocked line: problems verbatim, amounts null, not summed.
  const blocked = buildPreviewRow(
    line({ status: "blocked", taxes: null, netPayCents: null, refusals: [{ message: "No hours.", whatToDo: "Fix the open punch." }] }),
    { ...hrs, straightTimeCents: null, overtimePremiumCents: null },
  );
  ok(blocked.status === "blocked" && blocked.amounts.gross === null && blocked.amounts.net === null, "blocked -> nulls");
  ok(blocked.problems[0] === "No hours. Fix the open punch.", "problems verbatim");

  // W-4 default noted; ceiling noted.
  const w = buildPreviewRow(line({ w4Provenance: "statutory_default_no_w4" }), hrs);
  ok(w.notes.some((n) => n.includes("IRS default")), "W-4 default noted");
  const c = buildPreviewRow(line({ taxes: taxes({ fica: { ...taxes().fica, oasdiCeilingReached: true } }) }), hrs);
  ok(c.notes.some((n) => n.includes("wage base")), "SS ceiling noted");

  // Totals skip blocked rows.
  const tot = previewTotals([r, r, blocked]);
  ok(tot.gross === 350000 && tot.net === 294088, "totals over computed rows");
  ok(tot.sickHundredthHours === 1200, "sick hours sum all rows");
  ok(previewTotals([blocked]).gross === null, "all blocked -> null total");

  // Effective rates.
  const er = effectiveRates(tot);
  ok(er.find((x) => x.label === "Social Security")!.pct === 6.2, "SS 6.2%");
  ok(er.find((x) => x.label === "Medicare")!.pct === 1.45, "Medicare 1.45%");
  ok(effectiveRates(previewTotals([blocked]))[0].pct === null, "no gross -> null pct");

  // CSV.
  const csv = previewCsv([r, blocked], { periodLabel: "2026-23 · Nov 1–Nov 14", payDate: "2026-11-20" });
  const rowsCsv = csv.trim().split("\n");
  ok(rowsCsv.length === 5, "csv: title, head, 2 rows, total");
  ok(rowsCsv[0].includes("COMPARISON ONLY"), "csv says comparison only");
  ok(rowsCsv[2].startsWith("Pat,ready,80.00,5.00,1600.00,150.00,1750.00,120.00"), `csv row (${rowsCsv[2].slice(0, 60)})`);
  ok(rowsCsv[3].startsWith("Pat,blocked,80.00,5.00,,,"), "blocked csv row blank money");
  ok(rowsCsv[4].startsWith("TOTAL (computed rows),,80.00,5.00,1600.00"), "csv total");
  ok(csvCell('a,"b"') === '"a,""b"""', "csv escaping");
  ok(PREVIEW_COLUMNS.length === 23, "23 columns");

  return { passed, failed };
}
