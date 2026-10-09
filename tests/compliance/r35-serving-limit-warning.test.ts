/**
 * tests/compliance/r35-serving-limit-warning.test.ts
 *
 * R35 #4 - WAC 314-55-095 warning on the MANUAL facts forms (Bible R29 "Next
 * slices": "Surface a WAC 314-55-095 warning on the manual facts form when mg
 * per serving > 10 or package THC > 100 for edibles, reusing the COA path's
 * wording and constants").
 *
 *   1. the pure core: the pinned self-test count, and ONE set of constants
 *      shared with the lab-certificate path (coa-facts-core imports them; no
 *      retyped 10 / 100 / 0.5 / 1.0 left behind).
 *   2. the REAL resolveIntakeFactReview action (Product Onboarding / lot / KB
 *      "Product facts" and the Drafts flag panel): an over-limit fix is SAVED
 *      (never refused), the audit row records the warning codes, the
 *      redirect carries ?fact_warn=codes; flower is not checked; a clean fix
 *      has no warning; a failed save never claims a warning-save.
 *   3. the REAL resolveFactReview action (Menu Imports -> Facts): the same.
 *   4. the panels RENDERED: the limits hint (edibles / unknown, not flower),
 *      the saved-facts warning (role="alert"), the hidden limit_category.
 *   5. banners: codes only, fixed wording (a crafted URL cannot add words).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  __runServingLimitWarningCoreTests,
  WA_PACKAGE_MAX_THC_MG,
  WA_SERVING_MAX_THC_MG,
  parseServingLimitCodes,
  servingLimitBannerText,
  servingLimitWarnings,
} from "@/lib/compliance/serving-limit-warning-core";
import { OWNER_FACTS_SIGNATURE } from "@/lib/pos/intake-fact-review-core";
import { factSaveBanner } from "@/lib/inventory/coa-panel-core";

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

beforeEach(() => {
  net.calls.length = 0;
  net.audits.length = 0;
  net.saveApplied = true;
  net.saveThrows = false;
  net.recordFactReviewThrows = false;
});

const redirects = () => net.calls.filter((c) => c.startsWith("redirect:")).map((c) => c.slice("redirect:".length));
const lastUrl = () => new URL("http://x" + redirects().at(-1)!);

// === 1. the core ============================================================
describe("R35 serving-limit-warning-core", () => {
  it("self-tests: exactly 53 pass, 0 fail (the pure runner pins the same floor)", () => {
    expect(__runServingLimitWarningCoreTests()).toEqual({ passed: 53, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("serving-limit-warning-core", __runServingLimitWarningCoreTests\(\), 53\)/);
  });

  it("the limits are the rule text: 10 mg / serving, 100 mg / package", () => {
    expect(WA_SERVING_MAX_THC_MG).toBe(10);
    expect(WA_PACKAGE_MAX_THC_MG).toBe(100);
  });

  it("the lab-certificate path uses the SAME constants (no retyped limits left in coa-facts-core)", () => {
    const src = read("src/lib/inventory/coa-facts-core.ts");
    expect(src).toContain('from "../compliance/serving-limit-warning-core"');
    expect(src).toContain("if (printedThc > WA_SERVING_MAX_THC_MG) {");
    expect(src).toContain("if (out.packageThcMg && out.packageThcMg.value > WA_PACKAGE_MAX_THC_MG) {");
    expect(src).toContain("if (row.mgPerServing > WA_OTHER_THC_EACH_MAX_MG) {");
    expect(src).toContain("if (otherThc > WA_OTHER_THC_TOTAL_MAX_MG) {");
    expect(src).not.toMatch(/printedThc > 10\b|value > 100\b|mgPerServing > 0\.5\b|otherThc > 1\.0\b/);
  });

  it("the owner's real Honeydew figures (11 mg x 10) warn on both limits; a 10 x 10 gummy does not", () => {
    expect(servingLimitWarnings({ mgPerServing: 11, servingsPerPack: 10, category: "edible-solid" }).map((w) => w.code)).toEqual([
      "serving_over_limit",
      "package_over_limit",
    ]);
    expect(servingLimitWarnings({ mgPerServing: 10, servingsPerPack: 10, category: "edible-solid" })).toEqual([]);
  });
});

// === 2. resolveIntakeFactReview =============================================
describe("R35 Product facts / Drafts fix: saved WITH a warning, never refused", () => {
  const form = (extra: Record<string, string>) => {
    const f = new FormData();
    const base: Record<string, string> = { manifestId: MAN, draftId: DRAFT, sourceItemId: "KEY-1", flagSignature: OWNER_FACTS_SIGNATURE, action: "fix", note: "", ...extra };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return f;
  };
  const save = async (extra: Record<string, string>) => {
    const { resolveIntakeFactReview } = await import("@/app/admin/inventory/drafts/actions");
    await expect(resolveIntakeFactReview(form(extra))).rejects.toThrow("NEXT_REDIRECT");
    return lastUrl();
  };

  it("11 mg x 10 on an edible: the facts ARE saved, the audit records both codes, the redirect carries them", async () => {
    const u = await save({ mgPerServing: "11", servingsPerPack: "10", limit_category: "edible-solid" });
    expect(net.calls.some((c) => c.startsWith("save-facts:") && c.includes('"mgPerServing":11') && c.includes('"packageThcMg":110'))).toBe(true);
    expect(u.searchParams.get("fact")).toBe("published");
    expect(u.searchParams.get("fact_warn")).toBe("serving_over_limit,package_over_limit");
    expect(net.audits).toHaveLength(1);
    expect(net.audits[0].after.servingLimitWarnings).toEqual([
      { code: "serving_over_limit", rule: "WAC 314-55-095(1)(a)" },
      { code: "package_over_limit", rule: "WAC 314-55-095(1)(b)" },
    ]);
  });

  it("a typed package of 150 mg (no per-serving) -> package warning only", async () => {
    const u = await save({ packageThcMg: "150", limit_category: "edible-liquid" });
    expect(u.searchParams.get("fact_warn")).toBe("package_over_limit");
  });

  it("no category hint (unknown) is CHECKED; a flower hint is not", async () => {
    expect((await save({ mgPerServing: "12" })).searchParams.get("fact_warn")).toBe("serving_over_limit");
    net.calls.length = 0;
    net.audits.length = 0;
    const u = await save({ mgPerServing: "12", limit_category: "flower" });
    expect(u.searchParams.get("fact_warn")).toBeNull();
    expect(net.audits[0].after.servingLimitWarnings).toBeNull();
  });

  it("a junk category hint is treated as unknown (checked), never as an exemption", async () => {
    expect((await save({ mgPerServing: "12", limit_category: "flower; drop table" })).searchParams.get("fact_warn")).toBe("serving_over_limit");
  });

  it("a topical: serving warns, package does not ((1)(b) covers eaten / swallowed / otherwise taken)", async () => {
    expect((await save({ mgPerServing: "12", servingsPerPack: "20", limit_category: "topical" })).searchParams.get("fact_warn")).toBe("serving_over_limit");
  });

  it("a clean fix (10 x 10) has no warning and the audit says null", async () => {
    const u = await save({ mgPerServing: "10", servingsPerPack: "10", limit_category: "edible-solid" });
    expect(u.searchParams.get("fact_warn")).toBeNull();
    expect(net.audits[0].after.servingLimitWarnings).toBeNull();
  });

  it("the save fails -> 'error', and NEVER a warning-save banner", async () => {
    net.saveThrows = true;
    const u = await save({ mgPerServing: "11", servingsPerPack: "10" });
    expect(u.searchParams.get("fact")).toBe("error");
    expect(u.searchParams.get("fact_warn")).toBeNull();
  });

  it("0237 missing (nothing saved) -> 'migration', no warning param", async () => {
    net.saveApplied = false;
    const u = await save({ mgPerServing: "11" });
    expect(u.searchParams.get("fact")).toBe("migration");
    expect(u.searchParams.get("fact_warn")).toBeNull();
  });

  it("a contradiction is still REFUSED by the shared parser (unchanged) - the warning never weakens a refusal", async () => {
    const u = await save({ mgPerServing: "11", servingsPerPack: "10", packageThcMg: "50" });
    expect(u.searchParams.get("fact")).toBe("error");
    expect(u.searchParams.get("fact_msg")).toContain("does not equal");
    expect(net.calls.some((c) => c.startsWith("save-facts:"))).toBe(false);
  });

  it("from the lot page: back there with fact_warn, and the lot page's banner turns red with the fixed words", async () => {
    const LOT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const u = await save({ mgPerServing: "11", return_to: `/admin/inventory/${LOT}` });
    expect(u.pathname).toBe(`/admin/inventory/${LOT}`);
    expect(u.hash).toBe("#product-facts");
    const b = factSaveBanner(u.searchParams.get("fact"), u.searchParams.get("fact_msg"), u.searchParams.get("fact_warn"));
    expect(b?.tone).toBe("bad");
    expect(b?.text).toContain("WAC 314-55-095(1)(a)");
  });
});

// === 3. resolveFactReview (Menu Imports -> Facts) ===========================
describe("R35 Menu Imports -> Facts fix: same rule", () => {
  const IMP = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
  const press = async (extra: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ importId: IMP, sourceItemId: "pos-1", action: "fix", ...extra })) f.set(k, v);
    const { resolveFactReview } = await import("@/app/admin/menu-imports/actions");
    await expect(resolveFactReview(f)).rejects.toThrow("NEXT_REDIRECT");
    return lastUrl();
  };

  it("over the limit: saved, audited with the codes, ?saved=1&fact_warn=...", async () => {
    const u = await press({ mgPerServing: "11", servingsPerPack: "10", limit_category: "edible-solid" });
    expect(net.calls.some((c) => c.startsWith("save-import-facts:") && c.includes('"packageThcMg":110'))).toBe(true);
    expect(u.pathname).toBe(`/admin/menu-imports/${IMP}/facts`);
    expect(u.searchParams.get("saved")).toBe("1");
    expect(u.searchParams.get("fact_warn")).toBe("serving_over_limit,package_over_limit");
    expect(net.audits[0].after.servingLimitWarnings).toEqual([
      { code: "serving_over_limit", rule: "WAC 314-55-095(1)(a)" },
      { code: "package_over_limit", rule: "WAC 314-55-095(1)(b)" },
    ]);
  });

  it("the one-at-a-time focus is kept AFTER the warning (anchor last)", async () => {
    const u = await press({ mgPerServing: "11", focusQ: "honeydew" });
    expect(u.searchParams.get("fact_warn")).toBe("serving_over_limit");
    expect(u.searchParams.get("q")).toBe("honeydew");
    expect(u.hash.length).toBeGreaterThan(1);
  });

  it("clean / flower / approve: no warning param", async () => {
    expect((await press({ mgPerServing: "5", servingsPerPack: "10" })).searchParams.get("fact_warn")).toBeNull();
    expect((await press({ mgPerServing: "50", limit_category: "flower" })).searchParams.get("fact_warn")).toBeNull();
    expect((await press({ action: "approve" })).searchParams.get("fact_warn")).toBeNull();
  });

  it("a failed save goes to ?error= and never says saved", async () => {
    net.recordFactReviewThrows = true;
    const u = await press({ mgPerServing: "11" });
    expect(u.searchParams.get("error")).toBe("db down");
    expect(u.searchParams.get("saved")).toBeNull();
  });
});

// === 4. the panels, rendered ================================================
describe("R35 the forms state the limits and show saved over-limit facts", () => {
  const saved = (facts: Record<string, unknown>) => ({ manifestId: MAN, key: "KEY-1", facts, note: null, updatedAt: null, owner: true });

  it("Product facts panel: hint + hidden category for an edible; a saved 11 mg serving shows the alert", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const html = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: DRAFT, manifestId: MAN, productKey: "KEY-1", saved: saved({ mgPerServing: 11, servingsPerPack: 10, packageThcMg: 110 }), readOk: true, returnManifest: MAN, returnView: "approved", category: "edible-solid" } as never),
    );
    expect(html).toContain('data-testid="product-facts-limit-hint"');
    expect(html).toContain("at most 10 mg THC per serving (WAC 314-55-095(1)(a)) and 100 mg THC per package (WAC 314-55-095(1)(b))");
    expect(html).toContain('name="limit_category" value="edible-solid"');
    expect(html).toContain('data-testid="product-facts-limit-warning"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-code="serving_over_limit"');
    expect(html).toContain('data-code="package_over_limit"');
  });

  it("Product facts panel: flower shows no hint and no alert even with big numbers; unknown category shows the hint", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const flower = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: DRAFT, manifestId: MAN, productKey: "KEY-1", saved: saved({ mgPerServing: 50 }), readOk: true, returnManifest: MAN, returnView: "approved", category: "flower" } as never),
    );
    expect(flower).not.toContain("product-facts-limit-hint");
    expect(flower).not.toContain("product-facts-limit-warning");
    const unknown = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: DRAFT, manifestId: MAN, productKey: "KEY-1", saved: saved({ mgPerServing: 5 }), readOk: true, returnManifest: MAN, returnView: "approved" } as never),
    );
    expect(unknown).toContain("product-facts-limit-hint");
    expect(unknown).not.toContain("product-facts-limit-warning");
    expect(unknown).not.toContain('name="limit_category"');
  });

  it("Drafts flag panel: hint + hidden category", async () => {
    const { IntakeFactReviewPanel } = await import("@/app/admin/inventory/drafts/IntakeFactReviewPanel");
    const flag = { manifestId: MAN, versionId: "v", draftId: DRAFT, key: "KEY-1", productName: "Gummies", reasons: ["r"], signature: "fx1-abc", withheld: true };
    const html = renderToStaticMarkup(createElement(IntakeFactReviewPanel, { flag, draftId: DRAFT, returnManifest: MAN, category: "tincture" } as never));
    expect(html).toContain('data-testid="intake-fact-limit-hint"');
    expect(html).toContain('name="limit_category" value="tincture"');
    const fl = renderToStaticMarkup(createElement(IntakeFactReviewPanel, { flag, draftId: DRAFT, returnManifest: MAN, category: "flower" } as never));
    expect(fl).not.toContain("intake-fact-limit-hint");
  });
});

// === 5. banners + wiring pins ===============================================
describe("R35 banners: codes only, fixed words", () => {
  it("unknown codes are dropped; no codes -> no banner", () => {
    expect(servingLimitBannerText(parseServingLimitCodes("<img src=x>"))).toBeNull();
    expect(servingLimitBannerText(parseServingLimitCodes("package_over_limit"))).toContain("more than 100 mg THC in the package");
  });

  it("every page reads fact_warn and every caller passes the category", () => {
    const drafts = read("src/app/admin/inventory/drafts/page.tsx");
    expect(drafts).toContain("servingLimitBannerText(parseServingLimitCodes(sp.fact_warn))");
    expect(drafts.match(/category=\{displayCategory\}/g)?.length).toBe(2);
    expect(read("src/app/admin/inventory/[id]/page.tsx")).toContain("factSaveBanner(fact, fact_msg, fact_warn)");
    expect(read("src/app/admin/knowledge-base/products/[id]/page.tsx")).toContain("factSaveBanner(fact, fact_msg, fact_warn)");
    expect(read("src/components/admin/inventory/LabCertificatePanels.tsx")).toContain("category={ctx.draft.chosen_website_category ?? null}");
    expect(read("src/lib/inventory/coa-panel-server.ts")).toContain("inventory_type, chosen_website_category");
    const mi = read("src/app/admin/menu-imports/[id]/facts/page.tsx");
    expect(mi).toContain('data-testid="facts-limit-warning"');
    expect(mi).toContain('data-testid="facts-row-limit-warning"');
    expect(mi.match(/name="limit_category" value=\{row\.category\}/g)?.length).toBe(2);
  });
});
