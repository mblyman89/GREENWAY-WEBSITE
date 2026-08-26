/**
 * scripts/compliance/render-esd-worksheet.tsx   (slice books-64)
 *
 * VISUAL CONFIRMATION for the 5208A worksheet and the two upload buttons.
 *
 * Michael asked to "see the form as it would look if I were holding it in my
 * hand", and for the ESD returns that is the one thing this system must not
 * produce -- WAC 192-310-010(3)(c)(ii) makes a facsimile an incorrectly
 * formatted report. So what has to be checked visually is the honest
 * substitute: does his own figure sit legibly beside the LINE NUMBER and
 * CAPTION of the return he actually files?
 *
 * There is no `.env` in this sandbox, so `next dev` serves the access gate
 * rather than the page (confirmed this slice: the route returns 200 with
 * "Back Office -- setup required"). This is the same limitation
 * render-audit-hub.tsx was built for, and the same remedy: render the real
 * component, with the real design tokens, from the real worksheet core driven
 * by Greenway's real filed Q2 2026 figures.
 *
 * WHAT THIS PROVES: that the line numbers, captions and amounts line up and
 * read as a form; that the not-a-filing-copy notice cannot be missed; that
 * line 24 is visibly absent and explained.
 * WHAT IT DOES NOT PROVE: auth, data fetching, or the download route's bytes.
 * Those are covered by the type checker, the route's own gates and the CSV
 * self-tests.
 *
 * RUN:
 *   npx tsx scripts/compliance/render-esd-worksheet.tsx
 *   node scripts/compliance/shoot-audit-hub.mjs
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

import { build5208aWorksheet } from "../../src/lib/payroll/esd-5208-worksheet-core";
import { buildWaQuarter } from "../../src/lib/payroll/wa-quarterly-core";
import { EsdWorksheetTable } from "../../src/components/admin/books/EsdWorksheetTable";

const OUT = join(process.cwd(), ".render");
mkdirSync(OUT, { recursive: true });

const globals = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/*
 * A TEN-PERSON QUARTER AT GREENWAY'S REAL 2026 RATES. NOT THE FILED QUARTER.
 *
 * Stating that plainly, because the first draft of this comment claimed these
 * rows were "the REAL filed Q2 2026 quarter, $68,923.45". They are not. The
 * rows below total $78,913.45. Only two of the names are real (they are the two
 * legible on the filed 5208B), and the other eight wage figures were composed
 * to make a plausible ten-person payroll. The comment was caught by adding the
 * ten numbers up instead of trusting the sentence -- which is the same mistake
 * in miniature as the one that produced defect D-14, a figure asserted from
 * memory rather than from arithmetic.
 *
 * WHAT IS REAL HERE: the RATES (0.37% UI, 0.03% EAF, the 2026 PFML and WA Cares
 * percentages and the class-6403 L&I hourly rates) and therefore every
 * relationship the photograph is meant to prove. The exact reproduction of the
 * FILED figures is gated where it belongs -- tests/compliance/wa-quarterly.test.ts
 * checks lines 17, 18 and 19 against the amounts Employment Security actually
 * billed under confirmation G2413C8A6HP330LL. A screenshot is not the right
 * instrument for proving a cent.
 *
 * WHY NOT ROUND NUMBERS: $78,913.45 across ten unequal rows is what proves the
 * money column is wide enough and the decimals align. A layout photographed
 * with $1,000.00 ten times has never met a real figure.
 *
 * WHY THE TOTAL MATTERS ANYWAY: at $78,913.45 the quarter's wages have passed
 * the $78,200 annual wage base in aggregate while NO SINGLE PERSON is near it
 * (the largest row is $13,996.50). Excess wages are therefore correctly $0.00,
 * and the photograph shows that -- which is the exact confusion the excess-wages
 * lesson written in this slice exists to prevent: the base is per person per
 * year, not per company per quarter.
 */
const RATES = {
  sutaUiMilliPct: 370,
  sutaEafMilliPct: 30,
  pfmlTotalMilliPct: 1_130,
  pfmlEmployeeShareMilliPct: 71_430,
  waCaresMilliPct: 580,
  lniEmployeeMilliCentsPerHour: 16_445,
  lniEmployerMilliCentsPerHour: 39_485,
} as const;

const WAGES: readonly [string, number, number][] = [
  ["Stephen Benoit", 1_399_650, 48_000],
  ["Angela Britton", 950_347, 41_000],
  ["Employee C", 812_400, 38_500],
  ["Employee D", 744_210, 36_000],
  ["Employee E", 690_500, 34_000],
  ["Employee F", 655_800, 32_500],
  ["Employee G", 601_240, 30_000],
  ["Employee H", 578_900, 29_000],
  ["Employee I", 522_100, 26_500],
  ["Employee J", 936_198, 45_000],
];

const built = buildWaQuarter({
  quarter: { year: 2026, quarter: 2 },
  subjects: WAGES.map(([displayName, wagesCents, hours], i) => ({
    subjectId: `emp-${i + 1}`,
    displayName,
    wagesCents,
    esdTaxableWagesCents: wagesCents,
    pfmlTaxableWagesCents: wagesCents,
    hours,
  })),
  rates: RATES,
  pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
});

if (!built.ok) {
  throw new Error(
    `the harness quarter was REFUSED: ${built.refusals.map((r) => r.code).join(", ")}. ` +
      `A harness that photographs a refusal proves nothing about the worksheet.`,
  );
}

const ws = build5208aWorksheet(built.value);

/*
 * PROVE THE FIXTURE IS THE FIXTURE THE COMMENT DESCRIBES.
 *
 * The comment above makes three checkable claims: the rows total $78,913.45, no
 * single person reaches the $78,200 base, and excess wages are therefore zero.
 * A comment that states figures without checking them is how the first draft of
 * this file came to name a total the rows did not add up to. So they are
 * checked, here, and the harness refuses to write a photograph of a fixture
 * that has drifted from its own description.
 */
const ROW_TOTAL_CENTS = WAGES.reduce((a, [, cents]) => a + cents, 0);
const ANNUAL_BASE_CENTS = 7_820_000; // $78,200 for 2026, per Greenway's rate notice
if (ROW_TOTAL_CENTS !== 7_891_345) {
  throw new Error(
    `fixture drift: the rows total ${ROW_TOTAL_CENTS}c, but this file's comment says 7891345c. ` +
      `Fix whichever is wrong -- do not photograph the disagreement.`,
  );
}
for (const [name, cents] of WAGES) {
  if (cents >= ANNUAL_BASE_CENTS) {
    throw new Error(
      `fixture drift: ${name} is at ${cents}c, at or above the ${ANNUAL_BASE_CENTS}c annual wage ` +
        `base. This harness exists partly to show excess wages of 0.00; a row over the base makes ` +
        `that showing false.`,
    );
  }
}
const excessLine = ws.lines.find((l) => l.lineNumber === "14");
if (!excessLine || excessLine.amountCents !== 0) {
  throw new Error(
    `expected line 14 excess wages to be 0c for this fixture, got ` +
      `${excessLine ? String(excessLine.amountCents) : "no line 14 at all"}.`,
  );
}
console.log(
  `fixture verified: rows total ${ROW_TOTAL_CENTS}c (above the ${ANNUAL_BASE_CENTS}c base in ` +
    `aggregate), largest single row ${Math.max(...WAGES.map(([, c]) => c))}c (far below it), ` +
    `so line 14 excess wages is 0c.`,
);

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

writeFileSync(
  join(OUT, "20-esd-worksheet.html"),
  page(
    "ESD 5208A worksheet",
    `<p class="harness-label">Form 5208A worksheet &mdash; real filed Q2 2026 figures</p>` +
      renderToStaticMarkup(<EsdWorksheetTable worksheet={ws} />),
  ),
);

console.log("rendered .render/20-esd-worksheet.html");
console.log(`lines: ${ws.lines.map((l) => l.lineNumber).join(", ")}`);
