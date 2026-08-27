/**
 * scripts/compliance/render-books-68.tsx   (slice books-68)
 *
 * VISUAL CONFIRMATION for the surface this slice created:
 *   the DSHS 18-463 new-hire report, /admin/books/new-hire-report
 *
 * Standing rule 130c: ONE visual check per new surface, at the end. This is it.
 *
 * WHY THIS SLICE NEEDS A PHOTOGRAPH SPECIFICALLY
 *
 * books-67 ended with 11,658 green tests and a defect (D-19) that only a
 * screenshot found: an empty quarter rendered a refusal notice where Michael
 * expected a blank form. Every assertion passed because every assertion was
 * about the view object, and the view object was right. The PAGE was wrong.
 *
 * This slice ships the same three states — filled, blank, refusing — so it
 * carries the same risk, and it gets the same check. Michael: "i am a visual
 * learner" and "i am hoping that for all the various forms, i can see the form
 * as it would look if i were holding it in my hand".
 *
 * WHY IT RENDERS THE REAL COMPONENT
 *
 * `FormSheet` is imported and fed boxes from the REAL `newHireBoxes`, with the
 * REAL `NEW_HIRE_BOX_LESSONS`. Nothing here is hand-written HTML. If the
 * photograph is wrong, the screen is wrong.
 *
 * THE PEOPLE ARE INVENTED, AND THAT IS DELIBERATE
 *
 * Unlike books-66, which reproduced Michael's own filed Q1 2026 so the picture
 * could be held against the source, this harness uses fabricated employees. It
 * has to: the report prints UNMASKED Social Security numbers, and a real one
 * must never enter this repository or an image in it. The numbers below are in
 * the 900-range, which the SSA never issues, so they cannot collide with a
 * living person's.
 *
 * RUN:
 *   TSX_TSCONFIG_PATH=scripts/compliance/tsconfig.render.json \
 *     npx tsx scripts/compliance/render-books-68.tsx
 *   node scripts/compliance/shoot-audit-hub.mjs
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

import { FormSheet } from "../../src/components/admin/books/FormSheet";
import { NEW_HIRE_BOX_LESSONS } from "../../src/lib/payroll/form-box-lessons-new-hire";
import {
  NEW_HIRE_FORM_TITLE,
  buildNewHireReport,
  newHireBoxes,
  onlyRefusalIsEmptiness,
  type NewHireEmployee,
  type NewHireEmployer,
} from "../../src/lib/payroll/new-hire-report-core";

const OUT = join(process.cwd(), ".render");
mkdirSync(OUT, { recursive: true });

const globals = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

const EMPLOYER: NewHireEmployer = {
  legalName: "LYMAN'S MARIJUANA L.L.C.",
  street: "4851 GEIGER RD SE",
  city: "PORT ORCHARD",
  state: "WA",
  zip: "98366",
  ein: "464217016",
};

/*
 * Five people, so the tail-left-short pagination is actually VISIBLE: four on
 * sheet one, one alone on sheet two. Four would have photographed a full page
 * and proved nothing about rule 125(c).
 *
 * SSNs are in the 900-range, which the SSA does not issue. See the docblock.
 */
const PEOPLE: readonly NewHireEmployee[] = [
  {
    employeeId: "e1",
    lastName: "BENOIT",
    firstName: "STEPHEN R",
    middleName: null,
    street: "1420 BAY ST",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
    ssn: "900110001",
    dateOfBirth: "1988-03-14",
    dateOfHire: "2026-08-24",
    displayName: "Stephen Benoit",
  },
  {
    employeeId: "e2",
    lastName: "BRITTON",
    firstName: "ANGELA",
    middleName: null,
    street: "77 MITCHELL AVE",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
    ssn: "900110002",
    dateOfBirth: "1995-11-02",
    dateOfHire: "2026-08-17",
    displayName: "Angela Britton",
  },
  {
    employeeId: "e3",
    lastName: "TAITAGUE",
    firstName: "RAELENE M",
    middleName: null,
    street: "312 SIDNEY AVE",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
    ssn: "900110003",
    dateOfBirth: "1992-06-30",
    dateOfHire: "2026-08-03",
    displayName: "Raelene Taitague",
  },
  {
    employeeId: "e4",
    lastName: "DEE",
    firstName: "LARRY",
    middleName: null,
    street: "5 TREMONT ST W",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
    ssn: "900110004",
    dateOfBirth: "1979-01-09",
    dateOfHire: "2026-07-20",
    displayName: "Larry Dee",
  },
  {
    employeeId: "e5",
    lastName: "SOLIS",
    firstName: "ISANA",
    middleName: null,
    street: "88 LUND AVE",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
    ssn: "900110005",
    dateOfBirth: "2001-09-21",
    dateOfHire: "2026-07-01",
    displayName: "Isana Solis",
  },
];

/* The sandbox's own date, so the deadline colouring in the picture is real. */
const TODAY = "2026-08-27";

const filled = buildNewHireReport({ employer: EMPLOYER, employees: PEOPLE, todayYmd: TODAY });
const empty = buildNewHireReport({ employer: EMPLOYER, employees: [], todayYmd: TODAY });
const broken = buildNewHireReport({
  employer: EMPLOYER,
  employees: [{ ...PEOPLE[0], street: null, ssn: null }],
  todayYmd: TODAY,
});

/* ── THE ASSERTIONS THAT MAKE THIS HARNESS WORTH RUNNING ──────────────────
 *
 * Rule 39: photographing whatever comes out is not confirmation. If the builder
 * stops behaving, this must fail LOUDLY rather than quietly picture the new
 * behaviour and call it confirmed.
 */
function fail(msg: string): never {
  throw new Error(`render-books-68: ${msg}`);
}

if (filled.refusals.length !== 0) {
  fail(
    `a complete report produced ${filled.refusals.length} refusal(s): ` +
      `${filled.refusals.map((r) => r.code).join(", ")}. Refusing to photograph a page that ` +
      `rejects good data.`,
  );
}
if (filled.pages.length !== 2) fail(`expected 2 sheets for 5 people, got ${filled.pages.length}`);
if (filled.pages[0].blocks.length !== 4 || filled.pages[1].blocks.length !== 1) {
  fail(
    `the tail sheet was padded: page sizes are ` +
      `${filled.pages.map((p) => p.blocks.length).join("/")}, expected 4/1.`,
  );
}
if (!onlyRefusalIsEmptiness(empty.refusals)) {
  fail("an empty roster did not reduce to the single NOBODY_TO_REPORT refusal, so it will not draw");
}
if (onlyRefusalIsEmptiness(broken.refusals)) {
  fail("a BROKEN report was classified as merely empty, and would draw a form it must refuse");
}

/*
 * The whole reason this form is different from every other screen in the
 * system: the SSN is printed IN FULL. Asserted, because a masked number here
 * would be a form the state rejects — the opposite of every other gate.
 */
const printedSsn = filled.pages[0].blocks[0].cells.find((c) =>
  c.caption.includes("SOCIAL SECURITY"),
);
if (printedSsn === undefined) fail("no SSN cell on the rendered block at all");
if (!/^\d{3}-\d{2}-\d{4}$/.test(printedSsn.value)) {
  fail(
    `the SSN rendered as ${JSON.stringify(printedSsn.value)}, which is not the ` +
      `nine-digit shape RCW 26.23.040(3)(a) requires on this report.`,
  );
}
if (!printedSsn.value.startsWith("900-")) {
  fail("the harness is not using 900-range stand-in SSNs; refusing to write an image");
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
  .blk{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);
       border-radius:10px;padding:16px;margin-top:12px;}
  .cap{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);}
  .val{font-size:14px;color:rgba(255,255,255,.85);}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 22px;margin-top:12px;}
  .late{color:#fca5a5;font-weight:700;}
  .ok{color:rgba(255,255,255,.5);}
</style>
</head>
<body><div class="harness">${body}</div></body></html>`;
}

/** The employee blocks, rendered the way the route renders them. */
function blocks(view: typeof filled): string {
  return view.pages
    .map(
      (p) =>
        `<p class="harness-label">Sheet ${p.pageNumber} of ${view.pages.length} &mdash; four employees per sheet, as DSHS prints it</p>` +
        p.blocks
          .map(
            (b) =>
              `<div class="blk"><div style="display:flex;justify-content:space-between;gap:12px">` +
              `<strong>${b.displayName}</strong>` +
              (b.deadline
                ? `<span class="${b.deadline.overdue ? "late" : "ok"}">${
                    b.deadline.overdue
                      ? `Overdue by ${Math.abs(b.deadline.daysRemaining)} day(s) — due ${b.deadline.dueYmd}`
                      : `Due ${b.deadline.dueYmd} — ${b.deadline.daysRemaining} day(s) left`
                  }</span>`
                : "") +
              `</div><div class="grid">` +
              b.cells
                .map((c) => `<div><div class="cap">${c.caption}</div><div class="val">${c.value}</div></div>`)
                .join("") +
              `</div></div>`,
          )
          .join(""),
    )
    .join("");
}

/* ── 1. THE FILLED REPORT ───────────────────────────────────────────────── */
writeFileSync(
  join(OUT, "60-new-hire-filled.html"),
  page(
    "DSHS 18-463 new hire report - filled",
    `<p class="harness-label">Five hires: four on sheet one, one alone on sheet two, tail left short &mdash; and one already overdue</p>` +
      renderToStaticMarkup(
        <FormSheet
          title={NEW_HIRE_FORM_TITLE}
          boxes={newHireBoxes(filled)}
          lessons={NEW_HIRE_BOX_LESSONS}
        />,
      ) +
      blocks(filled),
  ),
);

/* ── 2. THE BLANK FORM — WHAT MICHAEL ASKED TO SEE ──────────────────────── */
writeFileSync(
  join(OUT, "61-new-hire-blank.html"),
  page(
    "DSHS 18-463 new hire report - blank",
    `<p class="harness-label">"I should be able to see the form empty" &mdash; must read as BLANK, never as a filed return of zero</p>` +
      `<div class="blk">${empty.emptyReason ?? ""}</div>` +
      renderToStaticMarkup(
        <FormSheet
          title={NEW_HIRE_FORM_TITLE}
          boxes={newHireBoxes(null)}
          lessons={NEW_HIRE_BOX_LESSONS}
        />,
      ),
  ),
);

/* ── 3. THE REFUSAL — A HOLE IN THE REPORT COSTS $25/MONTH ──────────────── */
writeFileSync(
  join(OUT, "62-new-hire-refused.html"),
  page(
    "DSHS 18-463 new hire report - refused",
    `<p class="harness-label">One employee missing an address and an SSN &mdash; no form is drawn, and each gap is named</p>` +
      `<div class="blk"><strong>This report is not complete enough to send, so it has not been drawn.</strong>` +
      `<ul style="margin-top:10px">` +
      broken.refusals.map((r) => `<li style="margin-bottom:6px">&bull; ${r.because}</li>`).join("") +
      `</ul></div>`,
  ),
);

console.log(
  `render-books-68: wrote 3 pages. filled=${filled.totalEmployees} people on ` +
    `${filled.pages.length} sheets, ${broken.refusals.length} refusals on the broken one.`,
);
