/**
 * scripts/compliance/render-books-66.tsx   (slice books-66)
 *
 * VISUAL CONFIRMATION for the one surface this slice created:
 *   the EAMS confirmation facsimile, /admin/books/wa-quarterly/confirmation
 *
 * Standing rule 130c: ONE visual check per new surface, at the end. This is it.
 *
 * WHY A PHOTOGRAPH MATTERS MORE HERE THAN ON ANY PREVIOUS SLICE
 *
 * Every other sheet in this system is judged on whether its FIGURES are right,
 * and figures are what gates are for. This page is different: Michael asked for
 * it because of how it LOOKS.
 *
 *   "if you can recreate or redraw or do some sort of genius technique to allow
 *    me to see the form filled as sage does it so I can visualize my data"
 *   "thats what I am used to seeing"
 *
 * Resemblance is the requirement, and no assertion can measure resemblance. A
 * gate can prove "$61,531.21" is in the view object; only a picture can show
 * that the page reads as the document he recognises. So this is the one place
 * where the screenshot is not a formality.
 *
 * WHY IT RENDERS THE REAL COMPONENT
 *
 * `EamsConfirmationSheet` is imported and called with a view built by the REAL
 * `buildEamsConfirmation`. Nothing here is hand-written HTML. If the spacing in
 * the photograph is wrong, the spacing on his screen is wrong.
 *
 * THE FIGURES ARE HIS OWN FILED Q1 2026
 *
 * Read off `1ST QUARTER FORM 5208A.pdf` with `pdftotext -layout`. That makes
 * the photograph directly comparable to the source document: if the rebuild is
 * faithful, the two can be held side by side and the numbers match line for
 * line. Using invented figures would have made the picture prettier and
 * worthless.
 *
 * WHAT THIS PROVES: layout, hierarchy, the two-column arrangement, that the
 * charges column reads top to bottom in ESD's order, that the preview notice is
 * impossible to miss, and that missing fields are conspicuous.
 * WHAT IT DOES NOT PROVE: auth, data fetching, the database read. Those are
 * gated by tests/compliance/eams-confirmation-core.test.ts and the type checker.
 *
 * RUN:
 *   TSX_TSCONFIG_PATH=scripts/compliance/tsconfig.render.json \
 *     npx tsx scripts/compliance/render-books-66.tsx
 *   node scripts/compliance/shoot-audit-hub.mjs
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

import { EamsConfirmationSheet } from "../../src/components/admin/books/EamsConfirmationSheet";
import {
  buildEamsConfirmation,
  type BuildConfirmationInput,
} from "../../src/lib/payroll/eams-confirmation-core";
import { WA_QUARTERLY_LESSONS } from "../../src/lib/payroll/form-box-lessons-wa";
import { type WaQuarterReturn } from "../../src/lib/payroll/wa-quarterly-core";

const OUT = join(process.cwd(), ".render");
mkdirSync(OUT, { recursive: true });

const globals = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/* ── MICHAEL'S FILED Q1 2026, VERBATIM FROM THE PDF ───────────────────────
 *
 *   Gross wages              $61,531.21
 *   Excess wages                  $0.00
 *   Total taxable wages      $61,531.21
 *   UI tax due                  $227.66   Rate 0.37%
 *   EAF tax due                  $18.46   Rate 0.03%
 *   UI and EAF charges          $246.12
 *   Total employees: 11  Total hours: 3027
 *
 * ASSERTED, NOT ASSUMED (rule 39). If the builder ever stops reproducing these
 * figures, this script must fail LOUDLY rather than quietly photograph the new
 * behaviour and call it confirmed.
 */
const FILED = {
  gross: "$61,531.21",
  excess: "$0.00",
  taxable: "$61,531.21",
  ui: "$227.66",
  eaf: "$18.46",
  total: "$246.12",
} as const;

const EMPLOYEES: ReadonlyArray<{
  readonly subjectId: string;
  readonly displayName: string;
  readonly wagesCents: number;
  readonly hours: number;
  readonly ssn: string;
}> = [
  { subjectId: "e1", displayName: "STEPHEN BENOIT", wagesCents: 1_399_650, hours: 451, ssn: "111-11-1883" },
  { subjectId: "e2", displayName: "ANGELA BRITTON", wagesCents: 950_347, hours: 490, ssn: "111-11-0724" },
  { subjectId: "e3", displayName: "RAELENE TAITAGUE", wagesCents: 390_812, hours: 223, ssn: "111-11-5156" },
  { subjectId: "e4", displayName: "LARRY DEE", wagesCents: 982_684, hours: 516, ssn: "111-11-5805" },
  { subjectId: "e5", displayName: "ISANA SOLIS", wagesCents: 314_740, hours: 172, ssn: "111-11-4009" },
  { subjectId: "e6", displayName: "BAILEY GIOVANNINI", wagesCents: 634_688, hours: 338, ssn: "111-11-8985" },
  { subjectId: "e7", displayName: "JERMAINE JOHNSON", wagesCents: 450_766, hours: 258, ssn: "111-11-1943" },
  { subjectId: "e8", displayName: "MICHAEL ZENGER", wagesCents: 481_409, hours: 259, ssn: "111-11-0426" },
  { subjectId: "e9", displayName: "CLARK AUTUMN", wagesCents: 212_601, hours: 124, ssn: "111-11-8006" },
  { subjectId: "e10", displayName: "COLE DAYLIN", wagesCents: 184_405, hours: 108, ssn: "111-11-6995" },
  { subjectId: "e11", displayName: "ZACHARY SMITH", wagesCents: 151_019, hours: 88, ssn: "111-11-1068" },
];

/*
 * The SSNs above are FABRICATED last-four-preserving stand-ins. The real ones
 * are not in this repository and must never be. Last four digits are copied
 * from the filed PDF only because they are what the masked column displays, and
 * the whole point of the photograph is to show the column rendering.
 */

function line(id: string, boxLabel: string, amountCents: number) {
  return {
    id,
    form: "esd_5208a" as const,
    boxLabel,
    amountCents,
    measure: "money" as const,
    quantity: null,
    whoseMoney: "employer_cost" as const,
    shownAs: `${boxLabel}, from the filed Q1 2026 return`,
  };
}

const GROSS_CENTS = 6_153_121;

const RET = {
  quarter: { year: 2026, quarter: 1 as const },
  grossWagesCents: GROSS_CENTS,
  subjectsEsdTaxableCents: GROSS_CENTS,
  totalHours: 3_027,
  headcount: 11,
  lines: [
    line("esd-ui", "UI tax due", 22_766),
    line("esd-eaf", "EAF tax due", 1_846),
    line("esd-total", "Total due", 24_612),
  ],
  wageDetail: EMPLOYEES.map((e) => ({
    subjectId: e.subjectId,
    displayName: e.displayName,
    wagesCents: e.wagesCents,
    hours: e.hours,
  })),
  esdTotalCents: 24_612,
  pfmlWaCaresTotalCents: 0,
  lniTotalCents: 0,
} as unknown as WaQuarterReturn;

const INPUT: BuildConfirmationInput = {
  quarter: { year: 2026, quarter: 1 },
  ret: RET,
  profile: {
    legalName: "LYMAN'S MARIJUANA L.L.C.",
    tradeName: "GREENWAY MARIJUANA",
    ein: "46-4217016",
    esdAccount: "000-073905-00-0",
    ubi: "603-353-555",
    businessStructure: "llc_s_corp",
    mailingCityStateZip: "PORT ORCHARD WA 98366",
    preparerName: "Michael Lyman",
    preparerPhone: "(360) 204-1119",
    preparerEmail: "michael@greenwaymarijuana.com",
  },
  uiRateMilliPct: 370,
  eafRateMilliPct: 30,
  wageBaseCents: 7_820_000,
  socCodeBySubject: Object.fromEntries(EMPLOYEES.map((e) => [e.subjectId, "41-2031"])),
  ssnBySubject: Object.fromEntries(EMPLOYEES.map((e) => [e.subjectId, e.ssn])),
  monthlyHeadcount: [10, 11, 9],
};

const view = buildEamsConfirmation(INPUT);

/* ── THE ASSERTIONS THAT MAKE THIS HARNESS WORTH RUNNING ─────────────────── */

function must(actualLabel: string, expected: string): void {
  const row = view.charges.find((c) => c.label === actualLabel);
  if (row === undefined) {
    throw new Error(
      `render-books-66: the charges column has no "${actualLabel}" row at all. The ` +
        `photograph would show a page missing a line ESD prints, and look fine doing it.`,
    );
  }
  if (row.amount !== expected) {
    throw new Error(
      `render-books-66: "${actualLabel}" rendered as ${row.amount}, but Michael's filed ` +
        `Q1 2026 confirmation prints ${expected}. Refusing to photograph a page that does ` +
        `not reproduce the source document.`,
    );
  }
}

must("Gross wages", FILED.gross);
must("Excess wages", FILED.excess);
must("Total taxable wages", FILED.taxable);
must("UI tax due", FILED.ui);
must("EAF tax due", FILED.eaf);
must("UI and EAF charges", FILED.total);
must("Charges this quarter", FILED.total);

if (view.wageRows.length !== 11) {
  throw new Error(
    `render-books-66: expected 11 employee rows, the number on the filed return, got ` +
      `${view.wageRows.length}.`,
  );
}
if (view.totalHours !== 3_027) {
  throw new Error(
    `render-books-66: total hours rendered as ${view.totalHours}; the filed return says 3027.`,
  );
}
for (const row of view.wageRows) {
  if (!/^\*\*\*-\*\*-\d{4}$/.test(row.ssn)) {
    throw new Error(
      `render-books-66: an SSN reached the page as ${JSON.stringify(row.ssn)}, which is not ` +
        `the masked shape. Refusing to produce an image containing a readable SSN.`,
    );
  }
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${globals}</style>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body{background:var(--admin-canvas,#0b0f0b);color:var(--admin-text,#f5f7f5);
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  .harness{max-width:1180px;margin:0 auto;padding:28px;}
  .harness-label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;
       color:var(--admin-accent,#7ed957);font-weight:800;margin:26px 0 8px;}
</style>
</head>
<body><div class="harness">${body}</div></body></html>`;
}

/* ── 1. THE FULL PAGE, WITH HIS OWN FILED FIGURES ────────────────────────── */
writeFileSync(
  join(OUT, "50-eams-confirmation-filed-q1.html"),
  page(
    "EAMS confirmation facsimile - Michael's filed Q1 2026",
    `<p class="harness-label">Every figure below is from 1ST QUARTER FORM 5208A.pdf &mdash; compare line for line</p>` +
      renderToStaticMarkup(
        <EamsConfirmationSheet view={view} lessons={WA_QUARTERLY_LESSONS} />,
      ),
  ),
);

/* ── 2. THE UNHAPPY PAGE ─────────────────────────────────────────────────
 *
 * Photographed SEPARATELY because the interesting question about the identity
 * block is not whether it renders — it is whether a reader can tell "we do not
 * have your EIN" apart from "everything is fine" AT A GLANCE, without reading.
 * That is D-15's lesson, and one photograph of the happy path cannot answer it.
 *
 * Here the EIN, the UBI and every SOC code are absent, and the engine produced
 * no tax lines.
 */
const bareView = buildEamsConfirmation({
  ...INPUT,
  profile: { ...INPUT.profile, ein: null, ubi: null, preparerEmail: null },
  socCodeBySubject: {},
  monthlyHeadcount: [null, null, null],
  ret: { ...RET, lines: [] } as unknown as WaQuarterReturn,
});

writeFileSync(
  join(OUT, "51-eams-confirmation-missing-data.html"),
  page(
    "EAMS confirmation facsimile - things missing from the books",
    `<p class="harness-label">EIN, UBI, email and every SOC code absent; engine produced no tax lines &mdash; nothing may look like a zero</p>` +
      renderToStaticMarkup(
        <EamsConfirmationSheet view={bareView} lessons={WA_QUARTERLY_LESSONS} />,
      ),
  ),
);

/* ── 3. THE EMPTY QUARTER (books-67) ────────────────────────────────────────
 *
 * The state Michael actually hit and reported: *"the esd form page says it
 * refuses to draw the form because there is 1 problem, no payroll yet ...
 * Ideally I'd like to see the form like all the others, even with no payroll
 * data to fill it with."*
 *
 * This is the page that used to be a refusal notice. Two questions can only be
 * answered by looking at it: does the blank form still teach where everything
 * goes, and is it unmistakably blank rather than unmistakably zero. A test can
 * assert the strings; only a photograph shows whether a reader would be misled.
 */
const emptyView = buildEamsConfirmation({ ...INPUT, ret: null });

/*
 * Pre-render assertion, same discipline as the filed-figure `must()` above: do
 * not emit an image that could be mistaken for a return reporting no wages.
 */
for (const row of emptyView.charges) {
  if (row.amount === "$0.00") {
    throw new Error(
      `render-books-67: charge "${row.label}" printed $0.00 on an EMPTY quarter. ` +
        `A zero on an unemployment report asserts that no wages were paid. ` +
        `Refusing to produce a screenshot of that.`,
    );
  }
}
if (emptyView.emptyReason === null) {
  throw new Error(
    "render-books-67: the empty quarter produced no explanation, so the page " +
      "would show a wall of dashes with no reason. Refusing to shoot it.",
  );
}

writeFileSync(
  join(OUT, "52-eams-confirmation-empty-quarter.html"),
  page(
    "EAMS confirmation facsimile - a quarter with no payroll yet",
    `<p class="harness-label">No pay run in this quarter &mdash; the form still draws, every amount is an em dash, and the blue panel says why</p>` +
      renderToStaticMarkup(
        <EamsConfirmationSheet view={emptyView} lessons={WA_QUARTERLY_LESSONS} />,
      ),
  ),
);

console.log("rendered 3 pages into .render/ (all filed-figure and empty-quarter assertions passed)");
