/**
 * tests/compliance/leafly-l44-preview-tax.test.ts — SLICE L-44.
 *
 * Ben (Leafly integrations), item 8, recorded in
 * docs/leafly-ben-email-integration-round.md:
 *
 *   > "Send the tax-inclusive shelf price as `packagePrice`, with an EMPTY
 *   >  taxes array. The store is configured as "tax included in menu"."
 *   > "If we send `TaxComponent` lines, they will not be added to the
 *   >  shopper's total."
 *
 * What this file proves END TO END. One fake menu feed is used for all three
 * of these, and only the database and the feed loader are faked:
 *   - the REAL menu-push builder (`buildLeaflyItemsResult`, what Leafly's
 *     catalogue holds),
 *   - the REAL preview lookup (`buildLeaflyVariantLookup`),
 *   - the REAL order-preview route with a REAL HMAC signature.
 *
 *   1. Every preview response the route can produce has `taxes: []`: the
 *      priced cart, the menu-unavailable echo, the empty unsigned delivery,
 *      and an all-removed cart.
 *   2. Every `packagePrice` equals the price the menu push sent Leafly for that
 *      variant, to the cent, including fractional feed prices that round.
 *   3. The out-the-door total (the sum of the lines) is exactly the sum of shelf
 *      prices, so it is unchanged from before L-44.
 *   4. The route calls the webhook-only builder and nothing on the webhook path
 *      can select the tax-exclusive presentation.
 */
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const KEY = "l44-test-hmac-key";

// ---------------------------------------------------------------------------
// Fakes: database, credentials, the side-effect modules, and the FEED.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return true;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        eq: () => b,
        abortSignal: async () => ({ error: null }),
      };
      return { insert: () => b, upsert: () => b, update: () => b };
    },
  }),
}));
vi.mock("@/lib/integrations/integration-credentials-store", () => ({
  getLeaflyOverrides: async () => ({ hmacKey: KEY, orderIntegrationKey: "menu-key" }),
}));
vi.mock("@/lib/leafly/order-fetch-server", () => ({ collectLeaflyOrder: async () => ({ ok: true }) }));
vi.mock("@/lib/leafly/bridge-server", () => ({
  onLeaflyOrderArrived: async () => ({ ok: true }),
  onLeaflyOrderCanceled: async () => ({ ok: true, plan: { dispositionRequired: false } }),
}));
vi.mock("@/lib/leafly/auto-ack-server", () => ({ autoAcknowledgeOnArrival: async () => ({ ok: true }) }));
vi.mock("@/lib/leafly/staff-alert-server", () => ({ maybeSendLeaflyStaffAlert: async () => null }));

let feed: SyndicationItem[] = [];
let feedFails = false;
vi.mock("@/lib/syndication/feed-source", () => ({
  loadSyndicationFeed: async () => {
    if (feedFails) throw new Error("feed down");
    return { versionId: "v1", items: feed };
  },
}));
vi.mock("@/lib/syndication/engine-store", () => ({
  getLeaflySyncSettings: async () => ({ sendPickupAvailability: true }),
}));

const { POST: previewRoute } = await import("@/app/api/webhooks/leafly/order-preview/route");
const { buildLeaflyItemsResult } = await import("@/lib/leafly/payload-core");
const { buildLeaflyVariantLookup } = await import("@/lib/leafly/preview-lookup");
const preview = await import("@/lib/leafly/preview-core");

// ---------------------------------------------------------------------------
// The one feed everything reads. Prices are tax-INCLUSIVE shelf prices, and
// two are deliberately fractional, so the "same rounding on both paths" claim
// is actually exercised.
// ---------------------------------------------------------------------------

const item = (
  id: string,
  category: string,
  variants: { id: string; label: string; price: number; qty: number }[],
  priceMinorUnits = variants[0]?.price ?? 1000,
): SyndicationItem => ({
  id,
  name: `Item ${id}`,
  brand: "Greenway",
  category,
  strainType: "hybrid",
  strainName: null,
  thc: category === "flower" ? "22%" : null,
  cbd: null,
  description: "test",
  priceMinorUnits,
  inStock: true,
  variants: variants.map((v) => ({
    id: v.id,
    label: v.label,
    priceMinorUnits: v.price,
    inStock: true,
    inventoryLevel: v.qty,
  })),
});

const FEED: SyndicationItem[] = [
  item("f1", "flower", [
    { id: "f1-eighth", label: "3.5g", price: 5000, qty: 10 },
    { id: "f1-gram", label: "1g", price: 1499.6, qty: 6 }, // rounds to 1500
  ]),
  item("f2", "flower", [{ id: "f2-eighth", label: "3.5g", price: 2999.4, qty: 3 }]), // 2999
  item("e1", "edible", [{ id: "e1-10pk", label: "100mg", price: 1800, qty: 12 }]),
  item("m1", "merch", [], 2500), // no variants -> synthesized "m1-default"
];

function feedPrices(): Map<string, number> {
  // What the menu PUSH told Leafly, read from the real payload builder.
  const { payload } = buildLeaflyItemsResult(FEED, { pickupEnabled: true });
  const m = new Map<string, number>();
  for (const it of payload.items) for (const v of it.variants) m.set(v.id, v.price);
  return m;
}

function signedPreview(cartItems: unknown[]): Request {
  const body = JSON.stringify({
    eventTime: "2026-09-25T12:00:00Z",
    eventType: "order_preview",
    orderIntegrationKey: "menu-key",
    cartItems,
  });
  const sig = createHmac("sha256", KEY).update(body, "utf8").digest("hex");
  return new Request("https://example.test/api/webhooks/leafly/order-preview", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Leafly-Signature": sig },
    body,
  });
}

type PreviewBody = {
  cartItems: { integratorVariantId: string; quantity: number; packagePrice: number }[];
  taxes: unknown[];
};

beforeEach(() => {
  feed = FEED;
  feedFails = false;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// 1-3. Through the real route
// ---------------------------------------------------------------------------

describe("L-44 · the order preview is tax-inclusive with an EMPTY taxes array", () => {
  it("the menu push and the preview lookup agree on every variant price, to the cent", async () => {
    const pushed = feedPrices();
    const { lookup, loaded, variantCount } = await buildLeaflyVariantLookup();
    expect(loaded).toBe(true);
    expect(variantCount).toBe(pushed.size);
    expect(pushed.size).toBe(5);
    for (const [id, price] of pushed) {
      expect(lookup(id)?.priceMinorUnits, id).toBe(price);
    }
    // The fractional ones really did round, so this is not a vacuous check.
    expect(pushed.get("f1-gram")).toBe(1500);
    expect(pushed.get("f2-eighth")).toBe(2999);
    expect(pushed.get("m1-default")).toBe(2500);
  });

  it("a signed preview returns taxes: [] and packagePrice = the pushed menu price, for every line", async () => {
    const pushed = feedPrices();
    const cart = [
      { name: "Eighth", integratorVariantId: "f1-eighth", quantity: 2, packagePrice: 5000 },
      { name: "Gram", integratorVariantId: "f1-gram", quantity: 1, packagePrice: 1500 },
      { name: "Other", integratorVariantId: "f2-eighth", quantity: 1, packagePrice: 2999 },
      { name: "Gummies", integratorVariantId: "e1-10pk", quantity: 3, packagePrice: 1800 },
      { name: "Hat", integratorVariantId: "m1-default", quantity: 1, packagePrice: 2500 },
    ];
    const res = await previewRoute(signedPreview(cart));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.taxes).toEqual([]);
    expect(Object.keys(body).sort()).toEqual(["cartItems", "taxes"]);
    expect(body.cartItems).toHaveLength(5);
    for (const ci of body.cartItems) {
      expect(ci.packagePrice, ci.integratorVariantId).toBe(pushed.get(ci.integratorVariantId));
    }
    // With no tax lines the lines ARE the total: the shelf prices, unchanged.
    const total = body.cartItems.reduce((n, i) => n + i.packagePrice * i.quantity, 0);
    expect(total).toBe(5000 * 2 + 1500 + 2999 + 1800 * 3 + 2500);
  });

  it("a stale Leafly price is CORRECTED to the menu price, still tax-inclusive, still no tax lines", async () => {
    const res = await previewRoute(
      signedPreview([{ name: "Eighth", integratorVariantId: "f1-eighth", quantity: 1, packagePrice: 3418 }]),
    );
    const body = (await res.json()) as PreviewBody;
    // 3418 is what the old tax-EXCLUSIVE presentation would have published for
    // a $50 eighth. The preview must send the inclusive 5000, not echo 3418.
    expect(body.cartItems[0]?.packagePrice).toBe(5000);
    expect(body.taxes).toEqual([]);
  });

  it("quantity clamped to stock is still priced at the menu price with no tax lines", async () => {
    const res = await previewRoute(
      signedPreview([{ name: "Other", integratorVariantId: "f2-eighth", quantity: 9, packagePrice: 2999 }]),
    );
    const body = (await res.json()) as PreviewBody;
    expect(body.cartItems[0]).toEqual({ integratorVariantId: "f2-eighth", quantity: 3, packagePrice: 2999 });
    expect(body.taxes).toEqual([]);
  });

  it("an all-removed cart is { cartItems: [], taxes: [] }", async () => {
    const res = await previewRoute(
      signedPreview([{ name: "Ghost", integratorVariantId: "nope", quantity: 1, packagePrice: 100 }]),
    );
    expect(await res.json()).toEqual({ cartItems: [], taxes: [] });
  });

  it("the menu-unavailable ECHO path also sends taxes: [] and Leafly's own prices", async () => {
    feedFails = true;
    const res = await previewRoute(
      signedPreview([{ name: "Eighth", integratorVariantId: "f1-eighth", quantity: 2, packagePrice: 5000 }]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cartItems: [{ integratorVariantId: "f1-eighth", quantity: 2, packagePrice: 5000 }],
      taxes: [],
    });
  });

  it("an empty menu (published but no items) also echoes with taxes: []", async () => {
    feed = [];
    const res = await previewRoute(
      signedPreview([{ name: "Eighth", integratorVariantId: "f1-eighth", quantity: 1, packagePrice: 5000 }]),
    );
    const body = (await res.json()) as PreviewBody;
    expect(body.taxes).toEqual([]);
    expect(body.cartItems).toHaveLength(1);
  });

  it("the empty unsigned delivery (L-43) answers { cartItems: [], taxes: [] }", async () => {
    const res = await previewRoute(
      new Request("https://example.test/api/webhooks/leafly/order-preview", { method: "POST", body: "" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cartItems: [], taxes: [] });
  });

  it("SWEEP: every variant x quantity through the route has taxes: [] and the menu price", async () => {
    const pushed = feedPrices();
    let checked = 0;
    for (const [id, price] of pushed) {
      for (const q of [1, 2, 5, 50]) {
        const res = await previewRoute(
          signedPreview([{ name: id, integratorVariantId: id, quantity: q, packagePrice: 1 }]),
        );
        const body = (await res.json()) as PreviewBody;
        expect(body.taxes, `${id} x${q}`).toEqual([]);
        expect(body.cartItems[0]?.packagePrice, `${id} x${q}`).toBe(price);
        checked += 1;
      }
    }
    expect(checked).toBe(pushed.size * 4);
  });
});

// ---------------------------------------------------------------------------
// The pure invariant, from the outside
// ---------------------------------------------------------------------------

describe("L-44 · checkTaxInclusivePreview and the webhook-only builder", () => {
  const catalogue: Record<string, import("@/lib/leafly/preview-core").VariantFacts> = {
    a: { inventoryLevel: 10, priceMinorUnits: 5000, category: "flower", orderable: true },
    b: { inventoryLevel: 10, priceMinorUnits: 1200, category: "merch", orderable: true },
  };
  const lookup = (id: string) => catalogue[id] ?? null;
  const cart = [
    { name: "A", integratorVariantId: "a", quantity: 2, packagePrice: 5000 },
    { name: "B", integratorVariantId: "b", quantity: 1, packagePrice: 1200 },
  ];

  it("the flag is down and the answer is recorded", () => {
    expect(preview.LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED).toBe(false);
    expect(preview.LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE).toContain("Ben");
    expect(preview.LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE).toContain("EMPTY taxes");
    expect(preview.LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION).toBe("tax_inclusive_no_tax_lines");
    expect("LEAFLY_PREVIEW_OPEN_QUESTION" in preview).toBe(false);
  });

  it("the webhook builder output is byte-identical to the pre-L-44 default output", () => {
    const hook = preview.buildLeaflyWebhookPreviewResponse({ lines: cart, lookup });
    const legacy = preview.buildLeaflyPreviewResponse({ lines: cart, lookup });
    expect(JSON.stringify(hook.body)).toBe(JSON.stringify(legacy.body));
    expect(hook.outTheDoorTotalMinor).toBe(legacy.outTheDoorTotalMinor);
    expect(hook.outTheDoorTotalMinor).toBe(11200);
  });

  it("the tax-exclusive body is rejected with all four relevant violations", () => {
    const ex = preview.buildLeaflyPreviewResponse({
      lines: cart,
      lookup,
      presentation: "tax_exclusive_with_tax_lines",
    });
    const check = preview.checkTaxInclusivePreview(ex, lookup);
    expect(check.ok).toBe(false);
    expect(new Set(check.violations.map((v) => v.kind))).toEqual(
      new Set(["wrong_presentation", "tax_lines_present", "price_not_feed_price", "total_mismatch"]),
    );
  });

  it("the out-the-door total is identical in both presentations (so L-44 changes no money)", () => {
    const ex = preview.buildLeaflyPreviewResponse({ lines: cart, lookup, presentation: "tax_exclusive_with_tax_lines" });
    const inc = preview.buildLeaflyWebhookPreviewResponse({ lines: cart, lookup });
    expect(inc.outTheDoorTotalMinor).toBe(ex.outTheDoorTotalMinor);
  });

  it("the builder THROWS rather than return a violating body", () => {
    let calls = 0;
    const drifting = (id: string) => {
      calls += 1;
      const f = catalogue[id] ?? null;
      return f && calls > 2 ? { ...f, priceMinorUnits: f.priceMinorUnits + 1 } : f;
    };
    expect(() => preview.buildLeaflyWebhookPreviewResponse({ lines: cart, lookup: drifting })).toThrow(
      preview.LeaflyPreviewTaxInvariantError,
    );
  });

  it("the builder accepts no presentation override (typed and at runtime)", () => {
    // @ts-expect-error -- the webhook builder has no `presentation` parameter.
    const built = preview.buildLeaflyWebhookPreviewResponse({ lines: cart, lookup, presentation: "tax_exclusive_with_tax_lines" });
    expect(built.presentation).toBe("tax_inclusive_no_tax_lines");
    expect(built.body.taxes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Source pins: nothing on the webhook path can choose tax-exclusive
// ---------------------------------------------------------------------------

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("L-44 · source pins", () => {
  const route = strip(readFileSync("src/app/api/webhooks/leafly/order-preview/route.ts", "utf8"));

  it("the preview route calls ONLY the webhook builder", () => {
    expect(route).toMatch(/buildLeaflyWebhookPreviewResponse\(\{ lines, lookup \}\)/);
    expect(route).not.toMatch(/buildLeaflyPreviewResponse\(/);
    expect(route).not.toMatch(/tax_exclusive_with_tax_lines/);
    expect(route).not.toMatch(/presentation/);
  });

  it("every JSON response in the preview route carries taxes: []", () => {
    // Each NextResponse.json either passes a literal with `taxes: []`, the
    // echo helper (which returns `taxes: []`), the built body (proved empty by
    // the invariant), or the 401 error body.
    const calls = route.match(/NextResponse\.json\(([^\n]*)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      expect(
        /taxes: \[\]/.test(c) || /echoCartUnchanged\(/.test(c) || /built\.body/.test(c) || /invalid signature/.test(c),
        c,
      ).toBe(true);
    }
    expect(route).toMatch(/function echoCartUnchanged[\s\S]*?taxes: \[\],/);
  });

  it("no production file outside preview-core names the tax-exclusive presentation", () => {
    const offenders = walk("src")
      .filter((f) => !f.endsWith("preview-core.ts"))
      .filter((f) => strip(readFileSync(f, "utf8")).includes("tax_exclusive_with_tax_lines"));
    expect(offenders).toEqual([]);
  });

  it("no production file outside preview-core calls buildLeaflyPreviewResponse directly", () => {
    const offenders = walk("src")
      .filter((f) => !f.endsWith("preview-core.ts"))
      .filter((f) => /buildLeaflyPreviewResponse\(/.test(strip(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("the preview lookup and the menu push round the feed price the same way", () => {
    const lookupSrc = readFileSync("src/lib/leafly/preview-lookup.ts", "utf8");
    const pushSrc = readFileSync("src/lib/leafly/payload-core.ts", "utf8");
    expect(lookupSrc).toContain("priceMinorUnits: Math.round(v.priceMinorUnits)");
    expect(lookupSrc).toContain("priceMinorUnits: Math.round(item.priceMinorUnits)");
    expect(pushSrc).toContain("price: Math.round(v.priceMinorUnits)");
    expect(pushSrc).toContain("price: Math.round(item.priceMinorUnits)");
  });
});
