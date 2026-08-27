/**
 * scripts/compliance/render-books-65.tsx   (slice books-65)
 *
 * VISUAL CONFIRMATION for the two surfaces this slice created:
 *   1. WaSheetHeader        - the top of /admin/books/wa-quarterly/sheet
 *   2. The ESD work code box on the employee payroll setup screen
 *
 * Standing rule 130c: ONE visual check per new surface, at the end. This is it.
 *
 * WHY IT RENDERS THE REAL COMPONENTS AND NOT A MOCK-UP
 *
 * A hand-built imitation of a screen proves that I can write HTML. It proves
 * nothing about the screen Michael opens. So `WaSheetHeader` is imported and
 * called, and the SOC field is photographed by rendering the ACTUAL
 * `EmployeePayrollSetupForm` three times with three different values of
 * `socCodeOnFile` - which is exactly how the three live states are reached,
 * because that prop seeds the input. If the hint text in the photograph is
 * wrong, the hint text on his screen is wrong.
 *
 * There is no `.env` in this sandbox, so `next dev` serves AdminSetupNotice
 * instead of the page. Same limitation render-audit-hub.tsx was built for,
 * same remedy, same shooter (shoot-audit-hub.mjs photographs every .html in
 * .render/), so this adds a renderer and no new machinery. Rule 25.
 *
 * WHAT THIS PROVES: layout, contrast, hierarchy, and that the three SOC hint
 * states say three different and correct things.
 * WHAT IT DOES NOT PROVE: auth, data fetching, server actions, the database
 * write. Those are gated by tests/compliance/soc-work-code.test.ts and the
 * type checker - a photograph is the wrong instrument for a cent or a CHECK
 * constraint.
 *
 * RUN:
 *   TSX_TSCONFIG_PATH=scripts/compliance/tsconfig.render.json \
 *     npx tsx scripts/compliance/render-books-65.tsx
 *   node scripts/compliance/shoot-audit-hub.mjs
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

import { WaSheetHeader } from "../../src/components/admin/books/WaSheetHeader";
import { EmployeePayrollSetupForm } from "../../src/components/admin/payroll/EmployeePayrollSetupForm";
import { socCodeCanonical, eamsSocCode } from "../../src/lib/payroll/esd-eams-csv-core";

const OUT = join(process.cwd(), ".render");
mkdirSync(OUT, { recursive: true });

const globals = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/*
 * THE THREE SOC STATES, NAMED BY WHAT THEY MEAN RATHER THAN BY WHAT THEY LOOK
 * LIKE. Asserted here before rendering, so that if the core ever changes its
 * mind about one of them this script fails LOUDLY instead of quietly
 * photographing the new behaviour and calling it confirmed. Rule 39: a harness
 * that renders whatever it is given proves nothing.
 */
const STATES: ReadonlyArray<{
  readonly onFile: string;
  readonly meaning: string;
  readonly expectCanonical: string;
}> = [
  { onFile: "", meaning: "BLANK - lawful, warns, does not stop payroll", expectCanonical: "" },
  { onFile: "41-20", meaning: "MALFORMED - blocked, will not be saved", expectCanonical: "" },
  {
    onFile: "41-2031",
    meaning: "GOOD - Michael's own code, Retail Salespersons",
    expectCanonical: "41-2031",
  },
];

for (const s of STATES) {
  const got = socCodeCanonical(s.onFile);
  if (got !== s.expectCanonical) {
    throw new Error(
      `socCodeCanonical(${JSON.stringify(s.onFile)}) is ${JSON.stringify(got)}, but this ` +
        `harness was written expecting ${JSON.stringify(s.expectCanonical)}. The screenshot ` +
        `would show the new behaviour and call it confirmed. Fix one or the other.`,
    );
  }
}
console.log(
  `soc states verified: "" -> blank; "41-20" -> rejected; ` +
    `"41-2031" -> stored ${socCodeCanonical("41-2031")}, uploaded ${eamsSocCode("41-2031")}`,
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

/* ── 1. THE WASHINGTON SHEET HEADER ─────────────────────────────────────────
 *
 * Photographed TWICE. The interesting question about this component is not
 * whether it renders - it is whether a reader can tell "we have not been given
 * this number" apart from "everything is fine", at a glance, without reading.
 * One photograph of the happy path could not answer that.
 */
writeFileSync(
  join(OUT, "30-wa-sheet-header-complete.html"),
  page(
    "WA sheet header - everything on file",
    `<p class="harness-label">WaSheetHeader &mdash; company profile complete, rates resolved</p>` +
      renderToStaticMarkup(
        <WaSheetHeader
          quarterLabel="Q2 2026"
          ein="46-4217016"
          legalName="LYMAN'S MARIJUANA L.L.C."
          tradeName="GREENWAY MARIJUANA"
          esdAccount="000-073905-00-0"
          ubi="603-353-555"
          ratesResolved
          missingRates={[]}
          readFailed={false}
        />,
      ),
  ),
);

writeFileSync(
  join(OUT, "31-wa-sheet-header-gaps.html"),
  page(
    "WA sheet header - identifiers missing and rates unresolved",
    `<p class="harness-label">WaSheetHeader &mdash; two identifiers absent, rates not evidenced</p>` +
      renderToStaticMarkup(
        <WaSheetHeader
          quarterLabel="Q3 2026"
          ein="46-4217016"
          legalName="LYMAN'S MARIJUANA L.L.C."
          tradeName={null}
          esdAccount={null}
          ubi={null}
          ratesResolved={false}
          missingRates={["SUTA UI rate", "PFML employee share"]}
          readFailed={false}
        />,
      ),
  ),
);

/* ── 2. THE ESD WORK CODE FIELD, IN ALL THREE LIVE STATES ───────────────────
 *
 * The whole form is rendered rather than the field alone, because the field
 * alone is a component that does not exist - the box, its label, its help line
 * and its live hint are assembled inside EmployeePayrollSetupForm, and lifting
 * them out for a photograph would be photographing a copy. The shooter takes a
 * full-page image, so the surrounding screen comes along; that is a feature,
 * since the question "does this box look like it belongs on this page" is one
 * of the things a visual check is for.
 */
for (const [i, s] of STATES.entries()) {
  writeFileSync(
    join(OUT, `4${i}-soc-${i === 0 ? "blank" : i === 1 ? "malformed" : "good"}.html`),
    page(
      `SOC work code - ${s.meaning}`,
      `<p class="harness-label">ESD work code on file: ${
        s.onFile === "" ? "(none)" : s.onFile
      } &mdash; ${s.meaning}</p>` +
        renderToStaticMarkup(
          <EmployeePayrollSetupForm
            employeeId="00000000-0000-0000-0000-0000000000aa"
            employeeName="Alyssa Lyman"
            maskedSsnOnFile="XXX-XX-1234"
            socCodeOnFile={s.onFile}
            defaultFormYear={2026}
            todayYmd="2026-08-26"
          />,
        ),
    ),
  );
}

console.log(`rendered ${2 + STATES.length} pages into .render/`);
