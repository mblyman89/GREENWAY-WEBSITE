/**
 * R37 S3 - net volume in ml OR US fl oz (owner: "select between ml and fl oz.
 * And I want standard conversion rates so it's easy to know without needing
 * to google it first").
 *
 * Pins: the shared parser converts fl oz once (29.5735) and stores ml; a
 * missing unit keeps the historic ml meaning; bare "oz" is refused; the REAL
 * resolveIntakeFactReview action saves 12 fl oz as 354.882 ml; the panels
 * render the unit select, the conversion line and the standard-sizes table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
});

import { OWNER_FACTS_SIGNATURE, parseIntakeFactForm } from "@/lib/pos/intake-fact-review-core";

const getter = (m: Record<string, string>) => (k: string) => m[k] ?? "";
const baseForm = { manifestId: MAN, draftId: DRAFT, sourceItemId: "KEY-1", flagSignature: OWNER_FACTS_SIGNATURE, action: "fix" };

describe("R37 S3 the shared parser", () => {
  it("12 fl oz -> 354.882 ml", () => {
    const r = parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "12", netVolumeUnit: "floz" }));
    expect(r.ok && r.form.correctedFacts?.netVolumeMl).toBe(354.882);
  });
  it("ml and a missing unit keep the number as ml", () => {
    const a = parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "355", netVolumeUnit: "ml" }));
    expect(a.ok && a.form.correctedFacts?.netVolumeMl).toBe(355);
    const b = parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "355" }));
    expect(b.ok && b.form.correctedFacts?.netVolumeMl).toBe(355);
  });
  it("bare oz and bad numbers are refused, never coerced", () => {
    expect(parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "12", netVolumeUnit: "oz" })).ok).toBe(false);
    expect(parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "-2", netVolumeUnit: "floz" })).ok).toBe(false);
    expect(parseIntakeFactForm(getter({ ...baseForm, netVolumeMl: "abc", netVolumeUnit: "ml" })).ok).toBe(false);
  });
  it("a unit with no number adds nothing (an empty fix is still refused)", () => {
    expect(parseIntakeFactForm(getter({ ...baseForm, netVolumeUnit: "floz" })).ok).toBe(false);
  });
});

describe("R37 S3 the real action saves fl oz as ml", () => {
  it("12 fl oz on Product facts -> saved netVolumeMl 354.882", async () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...baseForm, note: "", netVolumeMl: "12", netVolumeUnit: "floz" })) f.set(k, v);
    const { resolveIntakeFactReview } = await import("@/app/admin/inventory/drafts/actions");
    await expect(resolveIntakeFactReview(f)).rejects.toThrow("NEXT_REDIRECT");
    expect(net.calls.some((c) => c.startsWith("save-facts:") && c.includes('"netVolumeMl":354.882'))).toBe(true);
  });
});

describe("R37 S3 the panels render the unit select and conversions", () => {
  it("Product facts: unit select (ml / fl oz), saved ml shown with its fl oz, standard sizes table", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const html = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: DRAFT, manifestId: MAN, productKey: "KEY-1", saved: { manifestId: MAN, key: "KEY-1", facts: { netVolumeMl: 355 }, note: null, updatedAt: null, owner: true }, readOk: true, returnManifest: MAN, returnView: "draft", category: "edible-liquid" } as never),
    );
    expect(html).toContain('name="netVolumeUnit"');
    expect(html).toMatch(/<option value="ml" selected="">ml<\/option>/);
    expect(html).toContain('<option value="floz">fl oz</option>');
    expect(html).toMatch(/name="netVolumeMl"[^>]*value="355"/);
    expect(html).toContain("355 ml = 12 fl oz");
    expect(html).toContain('data-testid="volume-reference"');
    expect(html).toContain("2129.29");
    expect(html).not.toMatch(/<label[^>]*>Net volume \(ml\)<\/label>/);
  });
  it("Drafts flag panel: the same field, empty, shows the rate", async () => {
    const { IntakeFactReviewPanel } = await import("@/app/admin/inventory/drafts/IntakeFactReviewPanel");
    const flag = { manifestId: MAN, versionId: "v", draftId: DRAFT, key: "KEY-1", productName: "Soda", reasons: ["r"], signature: "fx1-abc", withheld: true };
    const html = renderToStaticMarkup(createElement(IntakeFactReviewPanel, { flag, draftId: DRAFT, returnManifest: MAN, category: "edible-liquid" } as never));
    expect(html).toContain('name="netVolumeUnit"');
    expect(html).toContain("1 fl oz = 29.5735 ml");
  });
});
