/**
 * scripts/compliance/render-audit-hub.tsx   (slice books-12)
 *
 * VISUAL CONFIRMATION HARNESS.
 *
 * Michael asked, verbatim: "On top of all the tests and testing the tests, I
 * want a visual confirmation from you that it looks and flows great."
 *
 * A `tsc --noEmit` pass proves a page COMPILES. It proves nothing whatsoever
 * about whether the page LOOKS right -- whether the contrast holds on the dark
 * canvas, whether the two-column grids collapse sensibly, whether the amber
 * citation styling reads as a quotation or as an error.
 *
 * There is no `.env` in this sandbox, so `next dev` cannot authenticate against
 * Supabase and the real route cannot be driven end to end here. What CAN be
 * done honestly is to render the presentational components -- which are pure
 * functions of their props -- to static HTML with the real Tailwind build and
 * the real design tokens, then photograph them.
 *
 * WHAT THIS PROVES: layout, spacing, typography, colour, hierarchy, and that
 * every panel renders real content from the guidance core rather than a
 * placeholder.
 *
 * WHAT IT DOES NOT PROVE, stated so nobody reads more into the screenshots than
 * they support: data fetching, RLS behaviour, server actions, or navigation.
 * Those are covered by the type checker, the store self-tests and the live
 * battle test on Michael's copy of the platform -- not by a picture.
 *
 * RUN:
 *   TSX_TSCONFIG_PATH=scripts/compliance/tsconfig.render.json \
 *     npx tsx scripts/compliance/render-audit-hub.tsx
 *   node scripts/compliance/shoot-audit-hub.mjs
 *
 * The tsconfig override is required because the count sheet and the review are
 * client components that reach `server-only` through their server actions. See
 * scripts/compliance/tsconfig.render.json for why that alias is scoped to this
 * harness instead of being added to the application's tsconfig.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

import {
  AuditMethodPanel,
  TraceDirectionsPanel,
  BlindCountPanel,
  MaterialityPanel,
  CadencePanel,
  ProvesPanel,
  GlossaryPanel,
  AuditHubAuthorities,
} from "../../src/app/admin/inventory/audits/AuditHubExplainer";
import { WhyBlockedPanel } from "../../src/app/admin/inventory/audits/WhyBlockedPanel";
import { HubRefusal } from "../../src/app/admin/inventory/audits/HubRefusal";
import { AuditCountSheet, type SheetLine } from "../../src/app/admin/inventory/audits/AuditCountSheet";
import { AuditVarianceReview } from "../../src/app/admin/inventory/audits/AuditVarianceReview";
import {
  readinessOf,
  assessLine,
  DEFAULT_MATERIALITY,
  type AuditLot,
  type AuditCountLine,
} from "../../src/lib/inventory/inventory-audit-core";
import { gateSessionForPosting } from "../../src/lib/inventory/inventory-audit-post-core";
import type { ReviewLine } from "../../src/lib/inventory/audit-hub-store";

const OUT = join(process.cwd(), ".render");
mkdirSync(OUT, { recursive: true });

/** The real design tokens, lifted from globals.css so colours are not guessed. */
const globals = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

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

function section(label: string, node: React.ReactElement): string {
  return `<p class="harness-label">${label}</p>${renderToStaticMarkup(node)}`;
}

// ---------------------------------------------------------------------------
// 1) THE MENTOR PANELS
// ---------------------------------------------------------------------------
writeFileSync(
  join(OUT, "01-method.html"),
  page(
    "Audit method",
    section("The method", <AuditMethodPanel />) +
      section("Two directions", <TraceDirectionsPanel />),
  ),
);

writeFileSync(
  join(OUT, "02-doctrine.html"),
  page(
    "Doctrine",
    section("Blind counts", <BlindCountPanel />) +
      section("Materiality", <MaterialityPanel />) +
      section("Cadence", <CadencePanel />) +
      section("What it proves", <ProvesPanel />),
  ),
);

writeFileSync(
  join(OUT, "03-glossary.html"),
  page(
    "Glossary and authorities",
    section("Glossary", <GlossaryPanel />) +
      section("Authorities", <AuditHubAuthorities />),
  ),
);

// ---------------------------------------------------------------------------
// 4) BLOCKED  —  and how to clear it
//
// EARLIER DEFECT, RECORDED RATHER THAN QUIETLY FIXED:
// the first version of this harness hand-typed five "blocker" sentences and a
// comment above them claimed they were the engine's own words. They were not.
// They were my paraphrases. The screenshot then showed the uncounted-lines
// blocker falling through to "no scripted fix" — which made the UI look broken
// when in fact the FIXTURE was wrong. A picture taken from invented data is
// worse than no picture, because it is believed.
//
// The fix is structural, not editorial. Instead of copying strings (copies
// drift), this harness now BUILDS a deliberately broken session and calls the
// real `readinessOf` and `gateSessionForPosting`. Whatever sentences the engine
// emits are the sentences photographed. If the engine's wording changes
// tomorrow, this screenshot changes with it and cannot go stale.
// ---------------------------------------------------------------------------

function lot(over: Partial<AuditLot> & { lotId: string }): AuditLot {
  return {
    lotId: over.lotId,
    lotCode: over.lotCode ?? `LOT-${over.lotId}`,
    posProductKey: over.posProductKey ?? `sku-${over.lotId}`,
    productName: over.productName ?? "Blue Dream 3.5g",
    categorySlug: over.categorySlug ?? "flower",
    vendorId: over.vendorId ?? "v1",
    vendorName: over.vendorName ?? "Sample Farms",
    onHandQty: over.onHandQty ?? 40,
    unitCostMinorUnits:
      over.unitCostMinorUnits === undefined ? 1_200 : over.unitCostMinorUnits,
    lastCountedAt: over.lastCountedAt ?? null,
    priorVarianceCount: over.priorVarianceCount ?? 0,
    status: over.status ?? "active",
  };
}

function line(over: Partial<AuditCountLine> & { lotId: string }): AuditCountLine {
  return {
    lotId: over.lotId,
    systemQty: over.systemQty ?? 40,
    countedQty: over.countedQty === undefined ? null : over.countedQty,
    recountQty: over.recountQty === undefined ? null : over.recountQty,
    reason: over.reason ?? null,
    note: over.note ?? null,
  };
}

// A session broken in five different ways on purpose, so the panel has to show
// five different remedies rather than one repeated five times.
const brokenLots: AuditLot[] = [
  lot({ lotId: "a" }),                                   // counted, big unexplained shrink
  lot({ lotId: "b" }),                                   // never counted (blank line)
  lot({ lotId: "c", unitCostMinorUnits: null }),         // no cost on file
  lot({ lotId: "d", lotCode: "LOT-D", posProductKey: "sku-dupe" }),
  lot({ lotId: "e", lotCode: "LOT-E", posProductKey: "sku-dupe" }), // merge pattern
  lot({ lotId: "f" }),                                   // in scope, NO line at all
];

const brokenLines: AuditCountLine[] = [
  line({ lotId: "a", countedQty: 5 }),                   // -35 units, no reason
  line({ lotId: "b" }),                                  // blank = nobody looked
  line({ lotId: "c", countedQty: 30 }),                  // variance but unvalued
  line({ lotId: "d", countedQty: 0 }),                    // shelf says empty
  line({ lotId: "e", countedQty: 80 }),                  // classic consolidation
];

const readiness = readinessOf(brokenLots, brokenLines, DEFAULT_MATERIALITY);

const gate = gateSessionForPosting(
  {
    sessionId: "s1",
    label: "October spot check",
    status: "counting",
    postedAt: null,
    resultApprovedBy: null,
    resultApprovedAt: null,
  },
  [],
);

writeFileSync(
  join(OUT, "04-blocked.html"),
  page(
    "Blocked",
    section(
      "Why blocked, and how to clear it",
      <WhyBlockedPanel blockers={[...readiness.blockers, gate.reason]} />,
    ) +
      section(
        "A refusal to load",
        <HubRefusal
          refusal={{
            code: "INVENTORY_AUDIT_FORBIDDEN",
            message:
              "Only the owner may approve an inventory audit. You are signed in as staff, so the " +
              "approval controls are hidden rather than shown and then refused.",
          }}
          context="the list of audits"
        />,
      ),
  ),
);

// ---------------------------------------------------------------------------
// 5) THE COUNT SHEET  --  the screen Michael will actually stand at a shelf and
//    use, with a scanner in his hand.
//
// The single most important thing to SEE here is an absence: there is no book
// quantity anywhere on this screen. That is not a styling choice, it is the
// blind-count doctrine, and `SheetLine` has no field that could carry it even
// if a future author wanted to show it.
//
// Rendered read-only AND live so both states are photographed. The live one is
// what a counter sees; the read-only one is what everyone sees once counting is
// closed, and a control that silently keeps working after close would let a
// number change after the fact.
// ---------------------------------------------------------------------------
const sheetLines: SheetLine[] = [
  {
    lotId: "a",
    lotCode: "LOT-2291",
    productName: "Blue Dream 3.5g",
    categorySlug: "flower",
    countedQty: 24,
    recountQty: null,
    needsRecount: false,
    captureMethod: "scan",
  },
  {
    lotId: "b",
    lotCode: "LOT-2292",
    productName: "Blue Dream 3.5g",
    categorySlug: "flower",
    countedQty: 6,
    recountQty: null,
    needsRecount: true,
    captureMethod: "manual",
  },
  {
    lotId: "c",
    lotCode: "LOT-3310",
    productName: "Gelato Cart 1g",
    categorySlug: "concentrate",
    countedQty: null,
    recountQty: null,
    needsRecount: false,
    captureMethod: null,
  },
  {
    lotId: "d",
    lotCode: null,
    productName: "Sour Diesel Pre-roll",
    categorySlug: "preroll",
    countedQty: null,
    recountQty: null,
    needsRecount: false,
    captureMethod: null,
  },
];

writeFileSync(
  join(OUT, "05-count-sheet.html"),
  page(
    "Count sheet",
    section("Counting in progress (scanner ready)", (
      <AuditCountSheet sessionId="s1" lines={sheetLines} readOnly={false} />
    )) +
      section("After counting is closed (read only)", (
        <AuditCountSheet sessionId="s1" lines={sheetLines} readOnly />
      )),
  ),
);

// ---------------------------------------------------------------------------
// 6) THE REVIEW  --  every assessment below comes from the real `assessLine`.
//
// Same discipline as page 04: the harness does NOT write the verdicts. It hands
// real lots and real count lines to the engine and photographs whatever the
// engine concludes. The five lines are chosen to cover every visual state at
// once -- clean, immaterial, a material shortage that must be explained, a lot
// with no cost on file, and one never counted at all.
// ---------------------------------------------------------------------------
function reviewLine(
  l: AuditLot,
  c: AuditCountLine,
  extra: Partial<ReviewLine> = {},
): ReviewLine {
  return {
    lotId: l.lotId,
    lotCode: l.lotCode,
    productName: l.productName,
    systemQty: c.systemQty,
    countedQty: c.countedQty,
    recountQty: c.recountQty ?? null,
    reasonCode: c.reason,
    reasonNote: c.note,
    // NULL when nothing was entered. Migration 0191 gives capture_method no
    // default, so an uncounted line has no capture method - the first version
    // of this fixture stamped "scan" on every line and the screenshot showed a
    // never-counted lot badged SCANNED. A fixture that cannot happen in the
    // database produces a picture that misleads.
    captureMethod: c.countedQty === null ? null : "scan",
    assessment: assessLine(l, c, DEFAULT_MATERIALITY),
    ...extra,
  };
}

const reviewLots: AuditLot[] = [
  lot({ lotId: "r1", lotCode: "LOT-2291", productName: "Blue Dream 3.5g", unitCostMinorUnits: 850 }),
  lot({ lotId: "r2", lotCode: "LOT-2292", productName: "Gelato Cart 1g", unitCostMinorUnits: 1_450 }),
  lot({ lotId: "r3", lotCode: "LOT-3310", productName: "Sour Diesel Pre-roll", unitCostMinorUnits: 320 }),
  lot({ lotId: "r4", lotCode: "LOT-4400", productName: "RSO Syringe 1g", unitCostMinorUnits: null }),
  lot({ lotId: "r5", lotCode: "LOT-5500", productName: "Northern Lights 7g", unitCostMinorUnits: 1_600 }),
];

const reviewCounts: AuditCountLine[] = [
  { lotId: "r1", systemQty: 24, countedQty: 24, recountQty: null, reason: null, note: null },
  { lotId: "r2", systemQty: 40, countedQty: 39, recountQty: null, reason: null, note: null },
  { lotId: "r3", systemQty: 120, countedQty: 96, recountQty: 96, reason: "damaged", note: "Water damage in back room, disposed on camera per WAC 314-55-097.", },
  { lotId: "r4", systemQty: 8, countedQty: 5, recountQty: null, reason: null, note: null },
  { lotId: "r5", systemQty: 14, countedQty: null, recountQty: null, reason: null, note: null },
];

const reviewLines: ReviewLine[] = reviewLots.map((l, i) =>
  reviewLine(l, reviewCounts[i]!, i === 2 ? { captureMethod: "manual" } : {}),
);

writeFileSync(
  join(OUT, "06-review.html"),
  page(
    "Variance review",
    section("Line by line, needing-a-decision first", (
      <AuditVarianceReview sessionId="s1" lines={reviewLines} editable />
    )),
  ),
);

console.log("rendered 6 pages into .render/");
