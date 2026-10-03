/**
 * SLICE S11 -- the onboarding row redesign (bible S11).
 *
 *   1. Pure core: fact-chips-core self-tests run with an exact count, are
 *      registered with that floor, and the headline behaviours are re-proven
 *      here through the public API (source labels, confidence formatting, the
 *      missing list, survivorship, guesses never counted, the flag idiom).
 *   2. FactsPanel renders every chip with its source, a <details> "why"
 *      (not a title= tooltip), the red missing line, the empty copy, the
 *      identity line and the ring note - escaped, never raw HTML.
 *   3. Row-level error anchoring (F-033), BEHAVIOURAL: approve / dismiss /
 *      restore failures redirect pinned to the failed row
 *      (?draft=<id>&error=...#draft-<id>); successes and the batch action do
 *      not pin; ONBOARDING_V2_ROW=off keeps the previous redirect.
 *   4. Save re-renders the page only when something landed (flag on).
 *   5. Page wiring: Facts + Manifest columns, the panel and the lookup OUTSIDE
 *      the approve form (F-020) with the flag on, inside with it off, one
 *      Approve button, the in-row error, no new query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  EMPTY_FACTS_COPY,
  NO_VENDOR_IDENTITY_COPY,
  ONBOARDING_V2_ROW_ENV,
  ROW_FACT_FIELDS,
  attachedFactsOf,
  buildFactChips,
  chipSourceLabel,
  confidenceText,
  identityLine,
  isCountedSource,
  manifestCell,
  onboardingV2RowEnabled,
  rowRecordFacts,
  __runFactChipsCoreTests,
} from "@/lib/catalog/fact-chips-core";
import { FactsPanel } from "@/components/admin/catalog/FactsPanel";
import { onboardingColumns } from "@/lib/catalog/onboarding-list-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const D = "22222222-2222-4222-8222-222222222222";
const M = "11111111-1111-4111-8111-111111111111";

// -- Mocks for the REAL server actions ----------------------------------------
const net = vi.hoisted(() => ({
  calls: [] as string[],
  approve: { ok: true } as { ok: boolean; error?: string },
  status: { ok: true } as { ok: boolean },
  attach: null as null | Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => net.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    net.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "m@x", profile: { role: "owner" } }),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/inventory/catalog-drafts", () => ({
  setCatalogDraftStatus: async () => net.status,
  approveDraftWithPrice: async () => net.approve,
  approveAllPricedForManifest: async () => ({ ok: false, error: "nope" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/pos/types-store", () => ({ listWebsiteCategoryTypes: async () => [], listInventoryTypes: async () => [] }));
vi.mock("@/lib/pos/fact-review-store", () => ({ recordIntakeFactReview: async () => ({ ok: true }) }));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [] }));
vi.mock("@/lib/ai/kb/store", () => ({ upsertKbStrain: async () => ({}) }));
vi.mock("@/lib/ai/suggestions", () => ({ listSuggestions: async () => [], persistSuggestion: async () => {} }));
vi.mock("@/lib/catalog/attach-facts", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    attachFactsV2Enabled: () => true,
    attachProductFacts: async () => net.attach,
  };
});

const savedFlag = process.env[ONBOARDING_V2_ROW_ENV];
beforeEach(() => {
  net.calls = [];
  net.approve = { ok: true };
  net.status = { ok: true };
  net.attach = null;
  delete process.env[ONBOARDING_V2_ROW_ENV];
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[ONBOARDING_V2_ROW_ENV];
  else process.env[ONBOARDING_V2_ROW_ENV] = savedFlag;
});

const lastRedirect = () => [...net.calls].reverse().find((c) => c.startsWith("redirect:"));

// === 1. Pure core =============================================================
describe("S11 pure core (fact-chips-core)", () => {
  it("self-tests pass with an exact count and are registered with that floor", () => {
    const r = __runFactChipsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(119);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("fact-chips-core", __runFactChipsCoreTests(), 119);',
    );
  });

  it("flag idiom: unset/junk = on; off/0/false/no/disabled = off", () => {
    expect(ONBOARDING_V2_ROW_ENV).toBe("ONBOARDING_V2_ROW");
    for (const v of [undefined, null, "", "on", "1", "yes", "anything"]) expect(onboardingV2RowEnabled(v), String(v)).toBe(true);
    for (const v of ["off", "OFF", " 0 ", "false", "no", "disabled"]) expect(onboardingV2RowEnabled(v), v).toBe(false);
  });

  it("source labels and confidence text (the bible's chip vocabulary)", () => {
    expect(chipSourceLabel("gemini", 94)).toBe("Gemini 94%");
    expect(chipSourceLabel("human")).toBe("You");
    expect(chipSourceLabel("manifest")).toBe("Manifest");
    expect(chipSourceLabel("coa")).toBe("COA");
    expect(chipSourceLabel("menu")).toBe("Live menu");
    expect(confidenceText(93.6)).toBe("94%");
    expect(confidenceText(null)).toBe("");
    expect(isCountedSource("gemini", 90)).toBe(true);
    expect(isCountedSource("gemini", 89)).toBe(false);
    expect(isCountedSource("kb_draft", 100)).toBe(false);
    expect(isCountedSource("name", 99)).toBe(false);
  });

  it("nine fields; empty row gives the bible's empty copy and lists all nine", () => {
    expect(ROW_FACT_FIELDS.length).toBe(9);
    const v = buildFactChips(null, null, { mode: "act" });
    expect(v.emptyLine).toBe(EMPTY_FACTS_COPY);
    expect(EMPTY_FACTS_COPY).toBe(
      "Nothing attached yet \u2014 press Look up to fetch from the web, or approve and fill it in on Enrichment.",
    );
    expect(v.countLabel).toBe("0/9");
    expect(v.missingLine?.startsWith("Enrichment will ask for: category, strain type")).toBe(true);
    expect(v.modeNote).toBeNull();
  });

  it("attached facts: 0..1 stored confidence shown as %, survivorship human > gemini, guesses not counted", () => {
    const row = {
      attached_facts: {
        description: { value: "Bright citrus.", source: "gemini", confidence: 0.94, at: "2026-05-01T00:00:00Z" },
        aroma: { value: ["pine"], source: "gemini", confidence: 0.72, at: "2026-05-01T00:00:00Z" },
        category: { value: "flower", source: "gemini", confidence: 0.99, at: "2026-05-01T00:00:00Z" },
        bogus: { value: "x", source: "nope", confidence: 2, at: "" },
      },
    };
    const facts = attachedFactsOf(row);
    expect(facts && Object.keys(facts).sort()).toEqual(["aroma", "category", "description"]);
    const records = rowRecordFacts({
      chosenWebsiteCategory: "flower",
      resolvedWebsiteCategory: null,
      resolutionSource: null,
      categoryLabel: (x) => (x === "flower" ? "Flower" : x),
      chosenStrainType: null,
      strainSuggestion: null,
      strainLabel: (x) => x,
      totalThcPct: 24.5,
      thcPct: null,
      labResultId: "lab-1",
    });
    const v = buildFactChips(facts, null, { mode: "act" }, records);
    const by = Object.fromEntries(v.chips.map((c) => [c.field, c]));
    expect(by.description.sourceLabel).toBe("Gemini 94%");
    expect(by.description.counted).toBe(true);
    expect(by.aroma.counted).toBe(false);
    expect(by.aroma.why).toContain("below the 90% bar");
    expect(by.category.sourceLabel).toBe("You");
    expect(by.category.also).toEqual(["Gemini 99%"]);
    expect(by.potency.sourceLabel).toBe("COA");
    expect(v.countLabel).toBe("3/9");
    expect(v.missing).not.toContain("description");
    expect(v.missing).toContain("aroma");
  });

  it("identity line: the bible's 'no vendor' copy; manifest cell", () => {
    expect(identityLine("", { vendor_name: "", brand_name: " ", name: "Blue Dream" }, true)).toEqual({
      ok: false,
      text: NO_VENDOR_IDENTITY_COPY,
    });
    expect(NO_VENDOR_IDENTITY_COPY).toBe("Cannot remember this product: manifest has no vendor");
    expect(identityLine("acme|flower|blue dream", {}, true).text.startsWith("Remembered as acme|flower|blue dream.")).toBe(true);
    expect(manifestCell({ manifest_number: "0012345", received_at: "2026-05-01T10:00:00Z", accepted_at: null, transfer_date: null })).toEqual({
      number: "#0012345",
      date: "received 2026-05-01",
    });
    expect(manifestCell(null)).toBeNull();
  });
});

// === 2. FactsPanel ============================================================
describe("S11 survivorship: counted beats source rank", () => {
  it("a confirmed remembered fact (counted) beats a 70% Gemini guess (uncounted) though Gemini ranks higher", () => {
    const remembered = {
      field: "effects" as const,
      value: ["calm"],
      origin: "history" as const,
      source: "human" as const,
      confidence: null,
      at: "2026-04-01T00:00:00Z",
      covered: true,
      reason: "You entered it.",
    };
    const memory = {
      identityKey: "k",
      facts: [remembered],
      covered: ["effects"],
      missing: [],
      complete: false,
      lastSeen: null,
    } as unknown as Parameters<typeof buildFactChips>[1];
    const v = buildFactChips(
      { effects: { value: ["sleepy"], source: "gemini", confidence: 0.7, at: "2026-05-01T00:00:00Z" } },
      memory,
      { mode: "act" },
    );
    const chip = v.chips.find((c) => c.field === "effects");
    expect(chip?.counted).toBe(true);
    expect(chip?.source).toBe("remembered");
    expect(chip?.value).toBe("calm");
    expect(chip?.also).toEqual(["Gemini 70%"]);
  });
});

describe("FactsPanel renders", () => {
  const render = (view: ReturnType<typeof buildFactChips>, identity = { ok: true, text: "Remembered as k." }) =>
    renderToStaticMarkup(createElement(FactsPanel, { view, identity }));

  it("chips with source label, a <details> why (never title=), counted flags, missing line in red", () => {
    const v = buildFactChips(
      { description: { value: "<b>x</b>", source: "gemini", confidence: 0.95, at: "2026-05-01T00:00:00Z" } },
      null,
      { mode: "act" },
      { category: { value: "flower", label: "Flower", via: "heuristic" } },
    );
    const html = render(v);
    expect(html).toContain('data-testid="facts-panel"');
    expect(html).toContain("1/9 facts");
    expect(html.match(/data-testid="fact-chip"/g)?.length).toBe(2);
    expect(html).toContain('data-field="description" data-counted="true"');
    expect(html).toContain('data-field="category" data-counted="false"');
    expect(html).toContain("Gemini 95%");
    expect(html).toContain("Product name");
    expect(html).toContain("not counted");
    expect(html).toMatch(/<details><summary[^>]*>/);
    expect(html).toContain('data-testid="fact-chip-why"');
    expect(html).not.toContain("title=");
    // Escaped, never raw HTML.
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain('data-testid="facts-panel-missing"');
    expect(html).toContain("text-[var(--admin-danger)]");
    expect(html).toContain("Enrichment will ask for: category, strain type");
    expect(html).not.toContain('data-testid="facts-panel-mode"');
  });

  it("empty row shows the empty copy (no chip list); shadow ring shows its note; failed identity is highlighted", () => {
    const html = render(buildFactChips(null, null, { mode: "shadow" }), { ok: false, text: NO_VENDOR_IDENTITY_COPY });
    expect(html).toContain('data-testid="facts-panel-empty"');
    expect(html).toContain("Nothing attached yet");
    expect(html).not.toContain('data-testid="facts-panel-chips"');
    expect(html).toContain('data-testid="facts-panel-mode"');
    expect(html).toContain("ATTACH_POLICY_RING=1");
    expect(html).toContain(NO_VENDOR_IDENTITY_COPY);
    expect(html).toMatch(/font-semibold text-\[var\(--admin-gold\)\]" data-testid="facts-panel-identity"/);
  });

  it("the ' \u00b7 not counted' badge sits on exactly the uncounted chips (not just in the why text)", () => {
    const v = buildFactChips(
      { description: { value: "d", source: "gemini", confidence: 0.95, at: "2026-05-01T00:00:00Z" } },
      null,
      { mode: "act" },
      { category: { value: "flower", label: "Flower", via: "heuristic" } },
    );
    const html = render(v);
    // One uncounted chip (the name guess) -> one badge, in the summary.
    expect(html.match(/> \u00b7 not counted<\/span>/g)?.length).toBe(1);
    const summaries = html.match(/<summary[\s\S]*?<\/summary>/g) ?? [];
    expect(summaries.length).toBe(2);
    const cat = summaries.find((x) => x.includes(">category<")); // ROW_FACT_LABEL is lowercase
    const desc = summaries.find((x) => x.includes(">description<"));
    expect(cat).toContain("\u00b7 not counted");
    expect(desc).not.toContain("not counted");
  });

  it("'also known from' lists the losing sources", () => {
    const v = buildFactChips(
      { category: { value: "flower", source: "gemini", confidence: 0.99, at: "2026-05-01T00:00:00Z" } },
      null,
      { mode: "act" },
      { category: { value: "flower", label: "Flower", via: "human" } },
    );
    expect(render(v)).toContain("Also known from: Gemini 99%.");
  });
});

// === 3. Row-level error anchoring (behavioural) ===============================
describe("F-033: a failed row action comes back pinned to that row", () => {
  const form = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("return_manifest", M);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  it("approve with a bad price -> ?manifest&draft&error=price#draft-<id>", async () => {
    const { approveDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(approveDraftAction(D, form({ price: "" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&draft=${D}&error=price#draft-${D}`);
  });

  it("approve refused by the gate -> pinned, with the message", async () => {
    const { approveDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    net.approve = { ok: false, error: "Pick a category" };
    await expect(approveDraftAction(D, form({ price: "20" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(
      `redirect:/admin/inventory/drafts?manifest=${M}&draft=${D}&error=floor&msg=Pick+a+category#draft-${D}`,
    );
  });

  it("approve success is NOT pinned (the row has left the review tab) - R23: it names the draft for the banner link", async () => {
    const { approveDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(approveDraftAction(D, form({ price: "20" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&approved=1&approved_draft=${D}`);
    expect(lastRedirect()).not.toContain("&draft=");
    expect(lastRedirect()).not.toContain("#draft-");
  });

  it("dismiss / restore failures are pinned; their successes are not", async () => {
    const { dismissDraftAction, restoreDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    net.status = { ok: false };
    await expect(dismissDraftAction(D, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&draft=${D}&error=update#draft-${D}`);
    await expect(restoreDraftAction(D, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&draft=${D}&error=update#draft-${D}`);
    net.status = { ok: true };
    await expect(dismissDraftAction(D, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&dismissed=1`);
    await expect(restoreDraftAction(D, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&restored=1`);
  });

  it("the batch action (no single row) is never pinned", async () => {
    const { approveAllPricedAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(approveAllPricedAction(M, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&error=floor&msg=nope`);
  });

  it("a forged draft id is dropped (draftsHref re-validates it as a UUID)", async () => {
    const { approveDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(approveDraftAction("not-a-uuid", form({ price: "" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&error=price`);
  });

  it("ONBOARDING_V2_ROW=off keeps the previous (unpinned) redirect", async () => {
    process.env[ONBOARDING_V2_ROW_ENV] = "off";
    const { approveDraftAction, dismissDraftAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(approveDraftAction(D, form({ price: "" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&error=price`);
    net.status = { ok: false };
    await expect(dismissDraftAction(D, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/drafts?manifest=${M}&error=update`);
  });

  it("every approve / dismiss / restore error redirect passes the draft id (static count)", () => {
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    const fn = (name: string, next: string) => actions.slice(actions.indexOf(`export async function ${name}`), actions.indexOf(`export async function ${next}`));
    const approve = fn("approveDraftAction", "approveAllPricedAction");
    expect(approve.match(/redirect\(backTo\(formData, \{ error: [^\n]*\}, draftId\)\);/g)?.length).toBe(6);
    expect(approve).not.toMatch(/redirect\(backTo\(formData, \{ error: [^\n]*\}\)\);/);
    // R23: the success redirect also names the approved draft for the banner link (still unpinned).
    expect(approve).toContain('redirect(backTo(formData, { approved: "1", approved_draft: draftId }));');
    expect(fn("dismissDraftAction", "restoreDraftAction")).toContain('redirect(backTo(formData, { error: "update" }, draftId));');
    expect(fn("restoreDraftAction", "resolveIntakeFactReview")).toContain('redirect(backTo(formData, { error: "update" }, draftId));');
    expect(fn("approveAllPricedAction", "dismissDraftAction")).not.toContain(", draftId)");
    expect(actions).toContain(
      "const anchor = failedDraftId && onboardingV2RowOn() ? failedDraftId : null;",
    );
    expect(actions).toContain('return draftsHref({ manifestId: typeof raw === "string" ? raw : null, draftId: anchor, extra });');
  });
});

// === 4. Save re-renders the row only when something landed ===================
describe("Save selected refreshes the row's Facts panel from server state", () => {
  const save = async () => {
    const { saveLookupToKbAction } = await import("@/app/admin/inventory/drafts/ai-lookup-actions");
    const f = new FormData();
    f.set("draft_id", D);
    f.set("payload", JSON.stringify({ name: "Blue Dream", description: "Bright citrus." }));
    return saveLookupToKbAction(f);
  };
  const receipt = (attached: number) => ({
    attached: Array.from({ length: attached }, () => ({ field: "description", to: ["product record"], source: "gemini", confidence: 94 })),
    queued: [],
    skipped: [],
  });

  it("attached > 0 -> revalidates the onboarding page", async () => {
    net.attach = { ok: true, mode: "act", receipt: receipt(1), sentence: "s", notes: [] };
    const r = await save();
    expect(r.ok).toBe(true);
    expect(net.calls).toContain("revalidate:/admin/inventory/drafts");
  });

  it("nothing attached (shadow ring) -> no revalidate", async () => {
    net.attach = { ok: true, mode: "shadow", receipt: receipt(0), sentence: "s", notes: [] };
    await save();
    expect(net.calls).not.toContain("revalidate:/admin/inventory/drafts");
  });

  it("ONBOARDING_V2_ROW=off -> no revalidate (previous behaviour)", async () => {
    process.env[ONBOARDING_V2_ROW_ENV] = "off";
    net.attach = { ok: true, mode: "act", receipt: receipt(1), sentence: "s", notes: [] };
    await save();
    expect(net.calls).not.toContain("revalidate:/admin/inventory/drafts");
  });
});

// === 5. Page wiring ===========================================================
describe("page wiring (ONBOARDING_V2_ROW)", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");

  it("reads the flag once; policy mode from the SAME ring the page already has", () => {
    expect(page).toContain("const v2Row = onboardingV2RowEnabled(process.env[ONBOARDING_V2_ROW_ENV]);");
    expect(page).toContain("const policyMode = attachPolicyMode(attachRing);");
    expect(page.match(/currentAttachPolicyRing\(\)/g)?.length).toBe(1);
  });

  it("adds Manifest and Facts columns only with the flag on (header + cells)", () => {
    // S41: the header cells come from ONE list (onboardingColumns), so the
    // detail row's colSpan can never drift from the header count.
    const ths = page.slice(page.indexOf("<thead"), page.indexOf("</thead>"));
    expect(ths).toContain("{columns.map((c) => (");
    expect(page).toContain("const columns = onboardingColumns(v2Row);");
    expect(onboardingColumns(true).map((c) => c.label)).toEqual(["Product", "Manifest", "Category & Type", "Facts", "THC", "Cost", "Pricing", "Actions"]);
    expect(onboardingColumns(false).map((c) => c.label)).toEqual(["Product", "Category & Type", "THC", "Cost", "Pricing", "Actions"]);
    // Cells in the same order as the headers.
    const body = page.slice(page.indexOf("<tbody"));
    const order = ['<KnownProductChip', 'data-testid="draft-row-manifest"', "OUR labels on screen", 'data-testid="draft-row-facts"', "fmtPct(d.total_thc_pct ?? d.thc_pct)"].map((s) => body.indexOf(s));
    for (const o of order) expect(o).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain("{v2Row && (");
    expect(body).toContain("{v2Row && facts && (");
    expect(body).toContain("{facts.countLabel}");
  });

  it("the manifest cell reuses the picker's already-loaded deliveries (no new query)", () => {
    expect(page).toContain("const manifestById = new Map((picker?.manifests ?? []).map((m) => [m.id, m]));");
    expect(page).toContain("manifestCell(d.manifest_id ? manifestById.get(d.manifest_id) : null)");
    expect(page).not.toMatch(/from\("inbound_manifests"\)/);
  });

  it("chips are built from the three sources the page already holds", () => {
    const at = page.indexOf("const facts = v2Row");
    const call = page.slice(at, page.indexOf("const identity = v2Row", at));
    expect(call).toContain("buildFactChips(attachedFactsOf(d as unknown as Record<string, unknown>), productMemories?.get(d.id) ?? null, { mode: policyMode }, rowRecordFacts({");
    for (const k of [
      "chosenWebsiteCategory: d.chosen_website_category,",
      "resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,",
      "resolutionSource: resolutions[i]?.source ?? null,",
      "chosenStrainType: d.chosen_strain_type,",
      "strainSuggestion: strainSuggestions.get(d.id) ?? null,",
      "totalThcPct: d.total_thc_pct,",
      "thcPct: d.thc_pct,",
      "labResultId: d.lab_result_id,",
    ]) expect(call, k).toContain(k);
    expect(page).toContain("{drafts.map((d, i) => {");
    // The identity shown is the SAME key S09 recalls under.
    expect(page).toContain("identityLine(identityForDraft(d, { websiteCategory: resolutions[i]?.websiteCategory ?? null }).identityKey, d, kbFirst)");
  });

  it("F-020 (S41): with the flag on the facts and the lookup sit in their own zones of the detail row, OUTSIDE the approve form", () => {
    const form = page.indexOf("<form action={approve}");
    const formEnd = page.indexOf("</form>", form);
    const row = page.indexOf("<OnboardingDetailRow");
    expect(row).toBeGreaterThan(formEnd);
    const props = page.slice(row, page.indexOf("approve={approveForm}", row));
    expect(props).toContain('data-testid="draft-row-detail"');
    expect(props).toContain("<FactsPanel view={facts} identity={identity} wide />");
    expect(props).toContain("facts && identity ? (");
    expect(props).toContain("lookup={lookupPanel}");
    // The zones are in reading order: facts -> lookup -> approve.
    expect(props.indexOf("facts={")).toBeLessThan(props.indexOf("lookup={lookupPanel}"));
    // Inside the form the lookup renders ONLY when the flag is off.
    const inForm = page.slice(form, formEnd);
    expect(inForm).toContain("{!v2Row && lookupPanel}");
    expect(inForm).not.toContain("<AiLookupPanel");
    // Exactly one AiLookupPanel element, mounted once per row via lookupPanel.
    expect(page.match(/<AiLookupPanel\b/g)?.length).toBe(1);
    expect(page.match(/lookup=\{lookupPanel\}|\{!v2Row && lookupPanel\}/g)?.length).toBe(2);
  });

  it("Approve remains ONE button, inside the approve form", () => {
    expect(page.match(/✓ Approve<\/Button>/g)?.length).toBe(1);
    const form = page.indexOf("<form action={approve}");
    expect(page.indexOf("✓ Approve</Button>")).toBeGreaterThan(form);
    expect(page.indexOf("✓ Approve</Button>")).toBeLessThan(page.indexOf("</form>", form));
  });

  it("in-row error: the SAME sentence as the banner, only on the pinned row, only with the flag", () => {
    expect(page).toContain("const rowError = v2Row && pinned?.id === d.id ? errorText : null;");
    expect(page).toContain(": errorText;");
    const copy = page.slice(page.indexOf("const errorText ="), page.indexOf("const banner ="));
    expect(copy).toContain('error === "floor" ? (msg || "Price is below the cost floor.")');
    expect(copy).toContain('error === "price" ? "Enter a valid price before approving."');
    expect(copy).toContain('error ? "Something went wrong updating that draft."');
    const cell = page.indexOf('data-testid="draft-row-error"');
    expect(cell).toBeGreaterThan(-1);
    expect(page.slice(cell - 200, cell)).toContain('role="alert"');
    expect(page.slice(cell - 300, cell)).toContain("{rowError && (");
  });

  it("the strain autofill + S10 corroboration props are unchanged on the moved panel", () => {
    const at = page.indexOf("<AiLookupPanel");
    const el = page.slice(at, page.indexOf("/>", at));
    expect(el).toContain("strainSelectId={`strain-type-${d.id}`}");
    expect(el).toContain("kbStrainType={strainEvidence.get(d.id)?.kb ?? null}");
    expect(el).toContain("manifestStrainType={strainEvidence.get(d.id)?.manifest ?? null}");
    // The select it autofills keeps its id (inside the approve form).
    expect(page).toMatch(/id=\{`strain-type-\$\{d\.id\}`\}\s+name="strain_type"\s+defaultValue=""/);
  });

  it("the lookup panel posts no named inputs (moving it changes nothing Approve sends)", () => {
    // Code only: the header comment talks ABOUT <form>s.
    const panel = read("src/app/admin/inventory/drafts/AiLookupPanel.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(panel).toContain("<button");
    expect(panel).not.toMatch(/\sname=["{]/);
    expect(panel).not.toMatch(/<form[\s>]/);
  });
});
