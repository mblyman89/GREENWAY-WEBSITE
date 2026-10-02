/**
 * R21 — two owner asks on Product Onboarding:
 *
 *   A. "I was not able to find the look up all products from a manifest on
 *      the onboard page. Is the button wired up?"  The button WAS wired
 *      (lookupAllAction -> lookup_jobs -> /api/cron/lookup-jobs) but its
 *      section only rendered with ?manifest= in the URL and rendered NOTHING
 *      in six other states. batchLookupEntry now decides every state.
 *
 *   B. "has the onboard product rows been changed to utilize all available
 *      space?"  S41: the opened row is a second, full-width <tr> with three
 *      zones (What we know | AI lookup | Approve).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  ApproveGroup,
  DETAIL_GRID_CLASS,
  DETAIL_ROW_CLASS,
  FieldLabel,
  OnboardingDetailRow,
} from "@/components/admin/catalog/OnboardingDetailRow";
import { FactsPanel } from "@/components/admin/catalog/FactsPanel";
import { buildFactChips } from "@/lib/catalog/fact-chips-core";
import { DETAIL_ZONES, detailRowId, onboardingColumns } from "@/lib/catalog/onboarding-list-core";
import {
  ALL_DONE_COPY,
  LOOKUP_AI_OFF_COPY,
  LOOKUP_CHOOSE_COPY,
  LOOKUP_FLAG_OFF_COPY,
  LOOKUP_UNKNOWN_COUNT_COPY,
  NOTHING_IN_REVIEW_COPY,
  batchLookupEntry,
  lookupDeliveryChoices,
} from "@/lib/catalog/lookup-job-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = read("src/app/admin/inventory/drafts/page.tsx");

// ═══ A. The batch lookup entry ═════════════════════════════════════════════

describe("R21 A — the batch lookup is never silently absent", () => {
  const base = { focused: true, view: "draft", flagOn: true, aiOn: true, attachOn: true, state: "none" as const, jobActive: false, eligible: { count: 7, skippedDone: 0, truncated: 0 } };

  it("the default view (no delivery focused) offers deliveries to open instead of nothing", () => {
    expect(batchLookupEntry({ ...base, focused: false, state: null, eligible: null })).toEqual({ kind: "choose" });
  });
  it("every state that used to render nothing now says why in plain words", () => {
    const text = (o: Record<string, unknown>) => {
      const e = batchLookupEntry({ ...base, ...o } as Parameters<typeof batchLookupEntry>[0]);
      return e.kind === "reason" ? e.text : e.kind;
    };
    expect(text({ aiOn: false })).toBe(LOOKUP_AI_OFF_COPY);
    expect(text({ flagOn: false })).toBe(LOOKUP_FLAG_OFF_COPY);
    expect(text({ eligible: null })).toBe(LOOKUP_UNKNOWN_COUNT_COPY);
    expect(text({ eligible: { count: 0, skippedDone: 0, truncated: 0 } })).toBe(NOTHING_IN_REVIEW_COPY);
    expect(text({ eligible: { count: 0, skippedDone: 3, truncated: 0 } })).toBe(ALL_DONE_COPY);
  });
  it("the button label is the S13 label, from the same exact count", () => {
    expect(batchLookupEntry(base)).toEqual({ kind: "button", label: "Look up all 7 products on this manifest" });
  });
  it("only the Needs review tab shows the section", () => {
    expect(batchLookupEntry({ ...base, view: "approved" }).kind).toBe("hidden");
  });
  it("the chooser keeps picker order, drops empty deliveries and never invents a count", () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";
    const C = "33333333-3333-4333-8333-333333333333";
    const out = lookupDeliveryChoices([
      { id: A, label: "0421 · Phat Panda", inReview: 0 },
      { id: B, label: "0422 · Agro Couture", inReview: 12 },
      { id: C, label: "0423 · Fifty Fold", inReview: null },
    ]);
    expect(out.map((c) => [c.id, c.countText])).toEqual([[B, "12 in Needs review"], [C, "count not available"]]);
  });

  it("page: the section renders on the decision, not on ?manifest=", () => {
    expect(page).toContain('{batchEntry.kind !== "hidden" && (');
    expect(page).not.toContain("{batchLookupOn && focus.manifestId && batchLookup && (");
    expect(page).toContain("const batchEntry = batchLookupEntry({");
    const call = page.slice(page.indexOf("const batchEntry = batchLookupEntry({"), page.indexOf("});", page.indexOf("const batchEntry = batchLookupEntry({")));
    for (const k of ["focused: Boolean(focus.manifestId),", "view,", "flagOn: lookupJobsOn(),", "aiOn: isAiConfigured,", "attachOn: batchLookupAttachOn,", "state: batchLookup ? batchLookup.state : null,", "jobActive: batchLookupActive,", "eligible: batchLookupEligible,"]) {
      expect(call, k).toContain(k);
    }
  });
  it("page: the chooser links each delivery to its focused list, landing on the button", () => {
    const at = page.indexOf('data-testid="batch-lookup-choose"');
    const block = page.slice(at, page.indexOf("</ul>", at));
    expect(block).toContain("href={`${draftsHref({ manifestId: c.id })}#batch-lookup`}");
    expect(block).toContain("LOOKUP_CHOOSE_COPY");
    expect(page).toContain('id="batch-lookup"');
    expect(LOOKUP_CHOOSE_COPY).toContain("Look up all");
  });
  it("page: the chooser's counts come from the picker the page already loads (no new query)", () => {
    const at = page.indexOf("const batchChoices =");
    const block = page.slice(at, page.indexOf(": [];", at));
    expect(block).toContain("picker.manifests.map((m) => ({");
    expect(block).toContain("inReview: picker.countsComplete ? picker.counts.get(m.id)?.inReview ?? 0 : null,");
  });
  it("page: the button and Stop render only on their decisions, with the S13 actions", () => {
    expect(page).toContain('batchEntry.kind === "button" && focus.manifestId && batchLookupEligible ? (');
    expect(page).toContain('batchEntry.kind === "stop" && focus.manifestId && batchLookupJob ? (');
    expect(page).toContain("<form action={lookupAllAction.bind(null, focus.manifestId)}");
    expect(page).toContain("{batchEntry.label}");
  });
  it("page: progress of the last job still shows when the decision is a reason (e.g. all done)", () => {
    const sec = page.slice(page.indexOf('data-testid="batch-lookup"'), page.indexOf('batchEntry.kind === "reason" ? ('));
    expect(sec).toContain("{focus.manifestId && batchLookupJob && (");
    expect(sec).toContain('data-testid="batch-lookup-progress"');
  });
});

// ═══ B. S41 the full-width detail row ═══════════════════════════════════════

const zonesHtml = () =>
  renderToStaticMarkup(
    createElement(OnboardingDetailRow, {
      id: "draft-x-detail",
      colSpan: onboardingColumns(true).length,
      highlighted: false,
      facts: createElement("p", null, "FACTS"),
      lookup: createElement("p", null, "LOOKUP"),
      approve: createElement("form", null, "APPROVE"),
    }),
  );

describe("R21 B — S41 detail row renders", () => {
  it("one cell spanning every header column (8 with the v2 row)", () => {
    const html = zonesHtml();
    expect(html).toMatch(/^<tr id="draft-x-detail" class="draft-detail-row /);
    expect(html.match(/<td /g)?.length).toBe(1);
    expect(html).toContain('<td colSpan="8"');
    expect(onboardingColumns(true)).toHaveLength(8);
  });
  it("three zones in reading order, each labelled, with their content", () => {
    const html = zonesHtml();
    const order = ["What we know", "AI lookup", "Approve"].map((t) => html.indexOf(`aria-label="${t}"`));
    for (const o of order) expect(o).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf("FACTS")).toBeLessThan(html.indexOf("LOOKUP"));
    expect(html.indexOf("LOOKUP")).toBeLessThan(html.indexOf("APPROVE"));
    expect(html.match(/data-zone="/g)?.length).toBe(3);
    expect(DETAIL_ZONES.map((z) => z.title)).toEqual(["What we know", "AI lookup", "Approve"]);
  });
  it("uses the full width: the researched 3-zone grid, no fixed narrow widths", () => {
    const html = zonesHtml();
    expect(html).toContain(DETAIL_GRID_CLASS);
    expect(DETAIL_GRID_CLASS).toBe("grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(18rem,0.9fr)]");
    expect(html).not.toMatch(/\bw-48\b|\bw-80\b|max-w-\[34rem\]/);
  });
  it("an empty zone says so instead of collapsing", () => {
    const html = renderToStaticMarkup(createElement(OnboardingDetailRow, { id: "d", colSpan: 8, highlighted: true, facts: null, lookup: null, approve: null }));
    expect(html.match(/Nothing to show yet\./g)?.length).toBe(3);
    expect(html).toContain("bg-[var(--admin-gold-soft)]");
  });
  it("the detail row id is the summary row's anchor + -detail (aria-controls)", () => {
    expect(detailRowId("draft-abc")).toBe("draft-abc-detail");
    expect(page).toContain("aria-controls={v2Row ? detailRowId(draftRowAnchorId(d.id)) : undefined}");
    expect(page).toContain("id={detailRowId(draftRowAnchorId(d.id))}");
  });
});

// Children go in as createElement arguments (react/no-children-prop); the
// props are typed as the full prop type so tsc accepts the call.
type AG = Parameters<typeof ApproveGroup>[0];
type FL = Parameters<typeof FieldLabel>[0];

describe("R21 B — flag off is the previous markup", () => {
  it("ApproveGroup / FieldLabel are pass-through / nothing when off", () => {
    const off = renderToStaticMarkup(createElement(ApproveGroup, { on: false, legend: "Classify" } as AG, createElement("i", null, "x")));
    expect(off).toBe("<i>x</i>");
    expect(renderToStaticMarkup(createElement(FieldLabel, { on: false, htmlFor: "a" } as FL, "Label"))).toBe("");
    const on = renderToStaticMarkup(createElement(ApproveGroup, { on: true, legend: "Classify" } as AG, createElement("i", null, "x")));
    expect(on).toContain("<fieldset");
    expect(on).toContain(">Classify</legend>");
    expect(renderToStaticMarkup(createElement(FieldLabel, { on: true, htmlFor: "a" } as FL, "Label"))).toBe('<label for="a" class="text-xs text-[var(--admin-text-muted)]">Label</label>');
  });
  it("FactsPanel keeps its 34rem cap unless wide (golden class)", () => {
    const view = buildFactChips(null, null, { mode: "act" });
    const identity = { ok: true, text: "Remembered as k." };
    const narrow = renderToStaticMarkup(createElement(FactsPanel, { view, identity }));
    const wide = renderToStaticMarkup(createElement(FactsPanel, { view, identity, wide: true }));
    expect(narrow).toContain('<section class="w-full max-w-[34rem] space-y-1.5 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-left text-xs"');
    expect(wide).toContain('<section class="w-full space-y-1.5 rounded-');
    expect(wide).not.toContain("max-w-[34rem]");
    expect(narrow.replace("max-w-[34rem] ", "")).toBe(wide);
  });
  it("every v2 branch keeps the previous literal on its off side", () => {
    for (const lit of [
      'const ctl = v2Row ? "w-full text-sm" : "w-48 text-xs";',
      'const box = v2Row ? "w-full" : "w-48";',
      'className={v2Row ? "flex flex-col gap-3" : "mt-2 flex flex-col items-end gap-2"}',
      'className={v2Row ? "flex flex-wrap items-center gap-2" : "flex items-center gap-2"}',
      '${v2Row ? "text-left" : "max-w-[28rem] text-right"}',
      'id={v2Row ? `website-category-${d.id}` : undefined}',
      'id={v2Row ? `house-type-${d.id}` : undefined}',
      'id={v2Row ? `price-${d.id}` : undefined}',
      'data-testid={v2Row ? "draft-approve-form" : undefined}',
      'aria-label={v2Row ? "Products to onboard" : undefined}',
    ]) expect(page, lit).toContain(lit);
    expect(read("src/app/admin/inventory/drafts/AiLookupPanel.tsx")).toContain('${wide ? "w-full" : "w-80"}');
    expect(onboardingColumns(false).map((c) => c.label)).toEqual(["Product", "Category & Type", "THC", "Cost", "Pricing", "Actions"]);
    // The previous row's form still sits inside <details>, with the lookup inside it.
    const close = page.indexOf("</details>");
    expect(page.slice(page.lastIndexOf("<details", close), close)).toContain("{!v2Row && approveForm}");
    expect(page).toContain("{!v2Row && lookupPanel}");
  });
});

describe("R21 B — S41 page wiring", () => {
  it("the detail row spans the header count from the same list", () => {
    expect(page).toContain("const columns = onboardingColumns(v2Row);");
    expect(page).toContain("colSpan={columns.length}");
    expect(page).not.toMatch(/colSpan=\{\d+\}/);
  });
  it("the detail row renders only on the review tab with the flag, after the summary row, inside one Fragment per draft", () => {
    const at = page.indexOf("<OnboardingDetailRow");
    expect(page.slice(at - 400, at)).toContain('{v2Row && view === "draft" && (');
    expect(page.lastIndexOf("</tr>", at)).toBeGreaterThan(page.lastIndexOf("<Fragment key={d.id}>", at));
    expect(page.indexOf("</Fragment>", at)).toBeGreaterThan(at);
  });
  it("the approve form is built ONCE and mounted in exactly one place per flag state", () => {
    expect(page.match(/<form action=\{approve\}/g)?.length).toBe(1);
    expect(page.match(/approveForm\}/g)?.length).toBe(2);
    expect(page).toContain("approve={approveForm}");
    expect(page).toContain("{!v2Row && approveForm}");
  });
  it("labelled groups in the Approve zone: Classify, Menu card, Size & compliance (only when a block shows)", () => {
    const form = page.slice(page.indexOf("const approveForm = ("), page.indexOf("</form>", page.indexOf("const approveForm = (")));
    const order = ['legend="Classify"', 'legend="Menu card"', 'legend="Size & compliance"', "✓ Approve"].map((s) => form.indexOf(s));
    for (const o of order) expect(o).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(form).toContain("<ApproveGroup on={v2Row && hasSizeBlock}");
    expect(page).toContain('view === "draft" && Boolean(ca?.needsOtherwiseTakenPick || ca?.promptsLowThcLiquid || va?.needsVolumePick);');
    // Real labels for the pickers + price (WCAG 3.3.2); no fixed widths inside the form.
    for (const l of ["Website category</FieldLabel>", "Product type</FieldLabel>", "Strain type</FieldLabel>", "Menu price</FieldLabel>"]) expect(form, l).toContain(l);
    expect(form).not.toMatch(/"w-48|\bw-48 text-xs"|flex w-48/);
    expect(form.match(/className=\{ctl\}/g)?.length).toBe(5);
  });
  it("facts + lookup fill their zones (wide), the price hint repeats floor + suggestion", () => {
    expect(page).toContain("<FactsPanel view={facts} identity={identity} wide />");
    expect(page).toContain("wide={v2Row}");
    expect(page).toContain('data-testid="draft-approve-price-hint"');
  });
  it("Dismiss stays in the summary row (never in the detail row)", () => {
    const dismiss = page.indexOf("<form action={dismiss}");
    expect(dismiss).toBeLessThan(page.indexOf("<OnboardingDetailRow"));
    expect(dismiss).toBeGreaterThan(page.indexOf("</details>"));
  });
  it("globals.css shows the row only while its <details> is open, behind @supports (no :has() = always shown)", () => {
    const css = read("src/app/globals.css");
    const at = css.indexOf("@supports selector(tr:has(details[open]))");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block).toContain(`tr.${DETAIL_ROW_CLASS} {\n    display: none;`);
    expect(block).toContain(`tr:has(details[data-testid="draft-row-details"][open]) + tr.${DETAIL_ROW_CLASS} {\n    display: table-row;`);
    // Outside @supports nothing hides the row.
    expect(css.slice(0, at)).not.toContain(DETAIL_ROW_CLASS);
  });
});
