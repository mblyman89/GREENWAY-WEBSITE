/**
 * R37 S2 - the system works out serving facts (owner: "if a product has
 * 100mg thc in it, it becomes blatantly obvious that the product has 10
 * servings ... There shouldn't be any product that the system can't figure
 * out on its own").
 *
 * Pins: the Product facts panel pre-fills EMPTY fields with the solver's
 * figures and says how (worked out / assumed), never over a saved value or a
 * lab-certificate value; the page and the lot/KB panels pass the view; and
 * the fact engine's 10 mg rule flows to the staged menu row.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MAN = "cccccccc-3333-4333-8333-cccccccccccc";
const DRAFT = "dddddddd-4444-4444-8444-dddddddddddd";

const net = vi.hoisted(() => ({
  calls: [] as string[],
  audits: [] as { action: string; after: Record<string, unknown> }[],
  saveApplied: true,
  saveThrows: false,
  recordFactReviewThrows: false,
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
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    net.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; after: Record<string, unknown> }) => {
    net.audits.push(a);
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => net.calls.push("public-surfaces") }));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async () => ({ staged: true, published: true, withheld: 0 }),
}));
vi.mock("@/lib/pos/fact-review-store", () => ({
  recordIntakeFactReview: async (i: { correctedFacts: unknown }) => {
    if (net.saveThrows) throw new Error("db down");
    net.calls.push(`save-facts:${JSON.stringify(i.correctedFacts)}`);
    return { applied: net.saveApplied };
  },
  mirrorIntakeFixToLive: async () => ({ items: 0, errors: [] }),
  recordFactReview: async (i: { correctedFacts: unknown }) => {
    if (net.recordFactReviewThrows) throw new Error("db down");
    net.calls.push(`save-import-facts:${JSON.stringify(i.correctedFacts)}`);
  },
  listFactReviews: async () => [],
  factReviewsToResolutions: () => new Map(),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify(null), { status: 200, headers: { "content-type": "application/json" } });
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }) };
});


import { servingFactsView } from "@/lib/catalog/serving-facts-view-core";
import { buildDraftInjectionPlan, examineDraftFacts, type ApprovedDraftForInjection } from "@/lib/pos/draft-injection-core";

const base = { inventoryType: "Solid Edible", category: "edible-solid", saved: null, coa: null } as const;
const saved = (facts: Record<string, unknown>) => ({ manifestId: MAN, key: "KEY-1", facts, note: null, updatedAt: null, owner: true });
const props = (over: Record<string, unknown>) => ({ draftId: DRAFT, manifestId: MAN, productKey: "KEY-1", saved: null, readOk: true, returnManifest: MAN, returnView: "draft", category: "edible-solid", ...over }) as never;

async function render(over: Record<string, unknown>): Promise<string> {
  const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
  return renderToStaticMarkup(createElement(ProductFactsPanel, props(over)));
}

const inputOf = (html: string, name: string): string => {
  const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
  return m ? m[0] : "";
};

describe("R37 S2 Product facts panel fills serving facts by itself", () => {
  it("100 mg THC in the name -> servings 10 and 10 mg per serving pre-filled, labelled worked out, with the WAC", async () => {
    const serving = servingFactsView({ ...base, name: "Gummies - 100mg THC" });
    const html = await render({ serving });
    expect(inputOf(html, "servingsPerPack")).toContain('value="10"');
    expect(inputOf(html, "servingsPerPack")).toContain('data-prefill="derived"');
    expect(inputOf(html, "mgPerServing")).toContain('value="10"');
    expect(html).toContain('data-testid="product-facts-worked"');
    expect(html).toContain("worked out: ");
    expect(html).toContain('data-testid="product-facts-serving"');
    expect(html).toContain('data-testid="product-facts-serving-headline"');
    expect(html).toContain("WAC 314-55-095");
    // the panel opens itself when it has something to show
    expect(html).toMatch(/<details[^>]*open/);
  });

  it("a saved value is never replaced by a worked-out one", async () => {
    const serving = servingFactsView({ ...base, name: "Gummies - 100mg THC", saved: { servingsPerPack: 20 } as never });
    const html = await render({ serving, saved: saved({ servingsPerPack: 20 }) });
    expect(inputOf(html, "servingsPerPack")).toContain('value="20"');
    expect(inputOf(html, "servingsPerPack")).not.toContain("data-prefill");
  });

  it("a saved per-serving dose alone -> the count is an ASSUMED figure, labelled check the package", async () => {
    const serving = servingFactsView({ ...base, name: "Mints", saved: { mgPerServing: 5 } as never });
    const html = await render({ serving, saved: saved({ mgPerServing: 5 }) });
    const sp = inputOf(html, "servingsPerPack");
    expect(sp).toContain('data-prefill="assumed"');
    expect(sp).toContain('value="20"');
    expect(html).toContain("assumed \u2014 check the package: ");
    expect(inputOf(html, "mgPerServing")).toContain('value="5"');
    expect(inputOf(html, "mgPerServing")).not.toContain("data-prefill");
  });

  it("a bare 5 mg in the name is the package -> one serving of 5 mg, worked out", async () => {
    const html = await render({ serving: servingFactsView({ ...base, name: "Mints 5mg" }) });
    expect(inputOf(html, "servingsPerPack")).toContain('value="1"');
    expect(inputOf(html, "mgPerServing")).toContain('value="5"');
  });

  it("no serving view -> the panel renders exactly as before (no worked-out spans)", async () => {
    const html = await render({});
    expect(html).not.toContain("product-facts-worked");
    expect(html).not.toContain("product-facts-serving");
  });

  it("a topical never gets a serving count", async () => {
    const serving = servingFactsView({ ...base, inventoryType: "Topical Ointment", category: "topical", name: "Balm 500mg THC" });
    const html = await render({ serving, category: "topical" });
    expect(inputOf(html, "servingsPerPack")).not.toContain("data-prefill");
  });
});

describe("R37 S2 wiring", () => {
  it("the Onboarding page and the lot/KB panels pass the serving view", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toMatch(/serving=\{servingFactsView\(/);
    expect(page).toContain("unitWeightsG: lotUnitWeightsG");
    const lab = read("src/components/admin/inventory/LabCertificatePanels.tsx");
    expect(lab).toMatch(/serving=\{servingFactsView\(/);
    expect(read("src/lib/pos/draft-injection-core.ts")).toContain("mergeCoaIntoExam(exam, coaFacts ?? null, invType)");
  });
});

describe("R37 S2 the 10 mg rule reaches the menu row when the total is confirmed", () => {
  const draft = (over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection => ({
    id: "d1", pos_product_key: "K1", name: "X", brand_name: "B", vendor_name: "V", strain_name: null,
    thc_pct: null, cbd_pct: null, total_thc_pct: null, potency_json: null, inventory_type: "Solid Edible",
    price_minor_units: 2000, updated_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as ApprovedDraftForInjection;

  it("a COA-confirmed 55 mg total with no count -> rule figures on the exam (verified)", () => {
    const e = examineDraftFacts(draft({ name: "Chews 55mg THC" }), {
      usable: true, servingWeightG: null, thcMgPerServing: null, cbdMgPerServing: null, cbdNotDetected: false,
      servingsPerPack: null, packageThcMg: { value: 55, confidence: "verified", note: "COA" }, packageCbdMg: null,
      minors: [], ratioCheck: null, reasons: [], notes: [],
    } as never)!;
    expect(e.packageThcMg?.value).toBe(55);
    expect(e.servingsPerPack?.value).toBe(6);
    expect(e.servingsPerPack?.source).toBe("wa-rule");
    expect(e.mgPerServing?.value).toBe(9.17);
  });

  it("a name-only total stays off the menu (single-source rule figures are never staged)", () => {
    const p = buildDraftInjectionPlan({
      drafts: [draft({ name: "Gummies - 100mg THC" })],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", { websiteCategory: "edibles", strainType: null, onHandQty: 5, packageLabel: null }]]),
      baseSortOrder: 0,
    });
    expect(p.items[0].servings_per_pack ?? null).toBeNull();
    expect(p.items[0].mg_per_serving ?? null).toBeNull();
  });
});
