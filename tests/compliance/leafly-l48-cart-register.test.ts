/**
 * SLICE L-48 — "Change items" at the FRONT REGISTER, plus the spec pins and
 * the wiring that no runtime test can see.
 *
 * 1. The REAL /api/pos/pickup route's `cartLoad` and `cart` modes, against
 *    fakes for device auth, the PIN lookup/throttle, the store and the cart
 *    server. Pins the gate order that matters: a hand-set price must never
 *    reach the send without a verified MANAGER/LEAD PIN, and an ordinary
 *    change must never ask for one.
 * 2. The REAL updatePickupCartAtRegister: website orders refused, the Leafly
 *    order resolved, the actor named, and an audit row either way.
 * 3. The vendored Leafly spec, so a spec change that invalidates our body
 *    fails here rather than at Leafly.
 * 4. Source wiring: the dashboard editor, the register editor, the audit
 *    names, the lookup-surface anchor, the transport door.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

// ── Fakes ────────────────────────────────────────────────────────────────
vi.mock("server-only", () => ({}));
vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({ ok: true, device: { id: "dev-1", name: "Front iPad", register_id: "reg-1" } }),
}));
vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));

type Emp = { id: string; full_name: string; job_role: string } | null;
let employee: Emp = null;
let locked: string | null = null;
const pinEvents: string[] = [];
vi.mock("@/lib/staffing/store", () => ({ getEmployeeByPin: async () => employee }));
vi.mock("@/lib/security/pin-throttle-store", () => ({
  deviceThrottleScope: (id: string) => `device:${id}`,
  pinPadBlocked: async () => locked,
  notePinFailure: async () => void pinEvents.push("fail"),
  notePinSuccess: async () => void pinEvents.push("ok"),
}));

// The store: the route's view of it. `updatePickupCartAtRegister` is tested
// for real in section 2 through `realStore`.
let target: Record<string, unknown> = { ok: true, leaflyOrderId: "ord-1", orderNumber: "GWY-000042", displayName: "Purple Rain" };
const storeCalls: Record<string, unknown>[] = [];
let storeResult: Record<string, unknown> = { ok: true, orderNumber: "GWY-000042", displayName: "Purple Rain", message: "Purple Rain: Leafly updated the order's items (1 removed).", summary: { removed: 1 } };
vi.mock("@/lib/pos/pickup-store", () => ({
  listRegisterPickupQueue: async () => ({ ok: true, queue: [] }),
  getRegisterPickupOrder: async () => ({ ok: true, order: {} }),
  loadOrderIntoRegister: async () => ({ ok: false, error: "unused" }),
  resolvePickupCartTarget: async () => target,
  updatePickupCartAtRegister: async (input: Record<string, unknown>) => {
    storeCalls.push(input);
    return storeResult;
  },
}));

let review: Record<string, unknown> = { allowed: true, code: "ok", reason: "ok", changes: [], summary: {}, estimatedTopLineMinor: 3000, needsManagerApproval: false };
const reviewCalls: Record<string, unknown>[] = [];
const updateCalls: Record<string, unknown>[] = [];
let updateResult: Record<string, unknown> = {};
vi.mock("@/lib/leafly/order-cart-server", () => ({
  loadLeaflyCartEditor: async (id: string) => ({
    found: true, leaflyOrderId: id, localOrderId: "local-1", leaflyStatus: "confirmed",
    reading: { lines: [{ cartItemId: "ci-1", integratorVariantId: "v1", name: "Blue Dream", brandName: null, variantLabel: "3.5g", quantity: 2, packagePriceMinor: 3000, discountedLineMinor: null, dealTitle: null }], unreadable: [], editable: true, status: "confirmed", fulfillmentMechanism: "pickup", subtotalMinor: 6000, totalMinor: 6000, taxesMinor: 0 },
    signature: "sig-1", editable: true, blockedReason: null, blockedCode: null,
    options: [{ integratorVariantId: "v3", productName: "Gelato", brand: null, variantLabel: "3.5g", category: "flower", priceMinorUnits: 3500, inventoryLevel: 4, orderable: true }],
    menuLoaded: true,
  }),
  previewLeaflyOrderCart: async (input: Record<string, unknown>) => {
    reviewCalls.push(input);
    return review;
  },
  updateLeaflyOrderCart: async (input: Record<string, unknown>) => {
    updateCalls.push(input);
    return updateResult;
  },
  leaflyOrderIdForLocalOrder: async () => "ord-1",
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LINES = [{ cartItemId: "ci-1", integratorVariantId: "v1", quantity: 1, packagePriceMinor: null }];

async function post(body: Record<string, unknown>) {
  const mod = await import("@/app/api/pos/pickup/route");
  const res = await mod.POST(
    new Request("https://example.test/api/pos/pickup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-id": "dev-1", "x-pos-device-key": "k" },
      body: JSON.stringify({ orderId: ORDER_ID, ...body }),
    }) as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const cart = (over: Record<string, unknown> = {}) => post({ cart: { lines: LINES, signature: "sig-1", employeeName: "Sam B.", ...over } });

beforeEach(() => {
  employee = { id: "e1", full_name: "Morgan Manager", job_role: "manager" };
  locked = null;
  pinEvents.length = 0;
  storeCalls.length = 0;
  reviewCalls.length = 0;
  updateCalls.length = 0;
  target = { ok: true, leaflyOrderId: "ord-1", orderNumber: "GWY-000042", displayName: "Purple Rain" };
  review = { allowed: true, code: "ok", reason: "ok", changes: [], summary: {}, estimatedTopLineMinor: 3000, needsManagerApproval: false };
  storeResult = { ok: true, orderNumber: "GWY-000042", displayName: "Purple Rain", message: "Purple Rain: Leafly updated the order's items (1 removed).", summary: { removed: 1 } };
});

// ── 1. The route ─────────────────────────────────────────────────────────
describe("L-48 register route — cartLoad", () => {
  it("returns the editor for a Leafly order", async () => {
    const r = await post({ cartLoad: {} });
    expect(r.status).toBe(200);
    const e = r.json.cartEditor as Record<string, unknown>;
    expect(e.editable).toBe(true);
    expect(e.signature).toBe("sig-1");
    expect((e.lines as unknown[]).length).toBe(1);
    expect((e.options as unknown[]).length).toBe(1);
    expect(e.displayName).toBe("Purple Rain");
  });

  it("a website order (or anything unresolvable) is a 422 with the store's words", async () => {
    target = { ok: false, error: "Changing items is for Leafly orders." };
    const r = await post({ cartLoad: {} });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/Leafly orders/);
  });
});

describe("L-48 register route — cart", () => {
  it("requires an employee name and a signature", async () => {
    expect((await cart({ employeeName: "" })).status).toBe(400);
    expect((await cart({ signature: "" })).status).toBe(400);
    expect(reviewCalls).toHaveLength(0);
    expect(storeCalls).toHaveLength(0);
  });

  it("review:true is a dry run — the store's send is never called", async () => {
    const r = await cart({ review: true });
    expect(r.status).toBe(200);
    expect(r.json.cartReview).toBeTruthy();
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]).toMatchObject({ leaflyOrderId: "ord-1", expectedSignature: "sig-1" });
    expect(storeCalls).toHaveLength(0);
  });

  it("a review refusal is a 422 and nothing is sent", async () => {
    review = { ...review, allowed: false, code: "cart_changed_since_opened", reason: "The order changed." };
    const r = await cart();
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("cart_changed_since_opened");
    expect(storeCalls).toHaveLength(0);
  });

  it("an ordinary change (menu price) is sent WITHOUT a PIN and without approval", async () => {
    const r = await cart();
    expect(r.status).toBe(200);
    expect(r.json.cartUpdated).toBeTruthy();
    expect(pinEvents).toHaveLength(0);
    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0]).toMatchObject({ priceOverridesApproved: false, approverName: null, deviceName: "Front iPad", employeeName: "Sam B.", signature: "sig-1" });
  });

  it("a hand-set price with NO PIN is 403 needsManagerApproval and NOTHING is sent", async () => {
    review = { ...review, needsManagerApproval: true };
    const r = await cart();
    expect(r.status).toBe(403);
    expect(r.json.needsManagerApproval).toBe(true);
    expect(storeCalls).toHaveLength(0);
  });

  it("a hand-set price with a BUDTENDER's PIN is 403 and NOTHING is sent", async () => {
    review = { ...review, needsManagerApproval: true };
    employee = { id: "e2", full_name: "Sam Budtender", job_role: "budtender" };
    const r = await cart({ pin: "1234" });
    expect(r.status).toBe(403);
    expect(String(r.json.error)).toMatch(/not a manager or lead/);
    expect(storeCalls).toHaveLength(0);
  });

  it("a wrong PIN is 401, counts against the throttle, and NOTHING is sent", async () => {
    review = { ...review, needsManagerApproval: true };
    employee = null;
    const r = await cart({ pin: "9999" });
    expect(r.status).toBe(401);
    expect(pinEvents).toEqual(["fail"]);
    expect(storeCalls).toHaveLength(0);
  });

  it("a locked PIN pad is 429 and NOTHING is sent", async () => {
    review = { ...review, needsManagerApproval: true };
    locked = "Too many tries.";
    const r = await cart({ pin: "1234" });
    expect(r.status).toBe(429);
    expect(storeCalls).toHaveLength(0);
  });

  it("a malformed PIN is 400 and NOTHING is sent", async () => {
    review = { ...review, needsManagerApproval: true };
    const r = await cart({ pin: "12" });
    expect(r.status).toBe(400);
    expect(storeCalls).toHaveLength(0);
  });

  it("a hand-set price with a MANAGER's PIN is sent with approval and the approver named", async () => {
    review = { ...review, needsManagerApproval: true };
    const r = await cart({ pin: "1234" });
    expect(r.status).toBe(200);
    expect(pinEvents).toEqual(["ok"]);
    expect(storeCalls[0]).toMatchObject({ priceOverridesApproved: true, approverName: "Morgan Manager" });
  });

  it("a LEAD's PIN is accepted too", async () => {
    review = { ...review, needsManagerApproval: true };
    employee = { id: "e3", full_name: "Lee Lead", job_role: "lead" };
    expect((await cart({ pin: "1234" })).status).toBe(200);
    expect(storeCalls[0]).toMatchObject({ approverName: "Lee Lead" });
  });

  it("a store / Leafly failure is a 422, never a success", async () => {
    storeResult = { ok: false, error: "Leafly refused.", code: "fix_request", needsManagerApproval: false };
    const r = await cart();
    expect(r.status).toBe(422);
    expect(r.json.cartUpdated).toBeUndefined();
    expect(r.json.error).toBe("Leafly refused.");
  });
});

// ── 2. The store function, for real ───────────────────────────────────────
describe("L-48 updatePickupCartAtRegister (real store)", () => {
  it("resolves the Leafly order, names the actor, and audits both outcomes", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/pos/pickup-store");
    const audits: { action: string; actorEmail: string; after: Record<string, unknown> }[] = [];
    vi.doMock("@/lib/auth/audit", () => ({ recordAudit: async (a: never) => void audits.push(a) }));
    vi.doMock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
    vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
    let order: Record<string, unknown> | null = { id: ORDER_ID, order_number: "GWY-000042", display_name: "Purple Rain", status: "acknowledged", origin: "leafly", staff_note: null };
    vi.doMock("@/lib/orders/orders-store", () => ({ listOrders: async () => [], getOrder: async () => order, setOrderStatus: async () => ({ ok: true }) }));
    const store = await import("@/lib/pos/pickup-store");

    updateResult = {
      ok: true, refused: false, code: "success", message: "Leafly updated the order's items (1 removed).", httpStatus: 200,
      assessment: null, warning: null, changes: [{ kind: "removed", sentence: "Remove OG Kush." }, { kind: "unchanged", sentence: "Keep." }],
      summary: { added: 0, removed: 1, changed: 0, substituted: 0, unchanged: 1, priceOverrides: 0 }, needsManagerApproval: false,
      verified: true, localOrderId: ORDER_ID, sentBody: null,
    };
    const ok = await store.updatePickupCartAtRegister({
      orderId: ORDER_ID, desired: LINES, signature: "sig-1", priceOverridesApproved: false, approverName: null, deviceName: "Front iPad", employeeName: "Sam B.",
    });
    expect(ok.ok).toBe(true);
    expect(updateCalls.at(-1)).toMatchObject({ leaflyOrderId: "ord-1", expectedSignature: "sig-1", priceOverridesApproved: false, staffId: null, actorLabel: "Sam B. at Front iPad" });
    expect(audits.at(-1)).toMatchObject({ action: "order.cart_updated_at_register", actorEmail: "pos-cart:Front iPad" });
    expect(audits.at(-1)!.after.changes).toEqual(["Remove OG Kush."]);

    updateResult = { ...updateResult, ok: false, code: "price_override_not_approved", message: "Needs a manager.", needsManagerApproval: true };
    const bad = await store.updatePickupCartAtRegister({
      orderId: ORDER_ID, desired: LINES, signature: "sig-1", priceOverridesApproved: true, approverName: "Morgan Manager", deviceName: "Front iPad", employeeName: "Sam B.",
    });
    expect(bad.ok).toBe(false);
    expect(updateCalls.at(-1)).toMatchObject({ actorLabel: "Sam B. at Front iPad (price approved by Morgan Manager)" });
    expect(audits.at(-1)).toMatchObject({ action: "order.register_cart_failed" });

    // A website order is refused before Leafly is ever involved.
    order = { ...order!, origin: "greenway" };
    const before = updateCalls.length;
    const web = await store.updatePickupCartAtRegister({
      orderId: ORDER_ID, desired: LINES, signature: "s", priceOverridesApproved: false, approverName: null, deviceName: "Front iPad", employeeName: "Sam B.",
    });
    expect(web.ok).toBe(false);
    expect(web.ok ? "" : web.error).toMatch(/Changing items is for Leafly orders/);
    expect(updateCalls.length).toBe(before);

    // A register sale is refused too.
    order = { ...order!, origin: "leafly", staff_note: "[pos-sale] x" };
    const { POS_SALE_STAFF_NOTE_PREFIX } = await import("@/lib/pos/pickup-core");
    order.staff_note = `${POS_SALE_STAFF_NOTE_PREFIX} x`;
    const pos = await store.resolvePickupCartTarget(ORDER_ID);
    expect(pos.ok).toBe(false);
    expect(pos.ok ? "" : pos.error).toMatch(/register sale/);

    // And the happy target resolves to the linked Leafly id.
    order = { ...order, staff_note: null };
    const good = await store.resolvePickupCartTarget(ORDER_ID);
    expect(good).toMatchObject({ ok: true, leaflyOrderId: "ord-1", orderNumber: "GWY-000042" });
  });
});

// ── 3. The vendored spec ─────────────────────────────────────────────────
describe("L-48 the vendored Leafly spec still says what our body assumes", () => {
  const spec = JSON.parse(read("docs/leafly-specs/order-api-v1.openapi.json")) as {
    paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown>; requestBody?: unknown }>>;
    components: { schemas: Record<string, { required?: string[]; properties?: Record<string, Record<string, unknown>> }> };
  };
  const path = spec.paths["/{order_integration_key}/orders/{id}/cart"];

  it("POST /{key}/orders/{id}/cart is updateCartItems and answers 200", () => {
    expect(path?.post?.operationId).toBe("updateCartItems");
    expect(Object.keys(path?.post?.responses ?? {})).toContain("200");
    expect(JSON.stringify(path?.post?.requestBody)).toContain("OrderCartUpdate");
  });

  it("OrderCartUpdate requires exactly cartItems (min 1), taxes, deliveryFee (min 0)", () => {
    const s = spec.components.schemas.OrderCartUpdate!;
    expect([...(s.required ?? [])].sort()).toEqual(["cartItems", "deliveryFee", "taxes"]);
    expect(s.properties?.cartItems?.minItems).toBe(1);
    expect(s.properties?.deliveryFee?.minimum).toBe(0);
  });

  it("CartItemIncoming requires id (nullable), integratorVariantId, quantity ≥ 1, packagePrice ≥ 1", () => {
    const s = spec.components.schemas.CartItemIncoming!;
    expect([...(s.required ?? [])].sort()).toEqual(["id", "integratorVariantId", "packagePrice", "quantity"]);
    expect(JSON.stringify(s.properties?.id)).toContain("null");
    expect(s.properties?.quantity?.minimum).toBe(1);
    expect(s.properties?.packagePrice?.minimum).toBe(1);
    expect(s.properties?.quantity?.type).toBe("integer");
    expect(s.properties?.packagePrice?.type).toBe("integer");
  });

  it("the spec's words about removal, addition and substitution are the ones the core implements", () => {
    const d = JSON.stringify(path?.post);
    expect(d).toMatch(/Removals are applied by leaving an item absent/);
    expect(d).toMatch(/Additions are applied by including a new entry/);
    expect(d).toMatch(/all-succeed or all-fail/);
  });
});

// ── 4. Wiring ───────────────────────────────────────────────────────────
describe("L-48 wiring", () => {
  it("the cart POST goes through the ONE authorized transport with the cart_update deadline", () => {
    const ack = read("src/lib/leafly/order-ack-server.ts");
    expect(ack).toMatch(/export async function postLeaflyCartUpdate\([^)]*\)[^{]*\{\s*return orderApiPost\(url, body, "cart_update"\);/);
    const srv = read("src/lib/leafly/order-cart-server.ts");
    expect(srv).not.toMatch(/\bfetch\(/);
    expect(srv).toContain("postLeaflyCartUpdate(url, body)");
    expect(srv.match(/operation: "cart"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("the lookup-surface anchor still points at the catalog build line", () => {
    const core = read("src/lib/leafly/setup-cache-core.ts");
    const m = core.match(/anchor: "src\/lib\/leafly\/order-cart-server\.ts:(\d+)"/);
    expect(m).not.toBeNull();
    const line = read("src/lib/leafly/order-cart-server.ts").split("\n")[Number(m![1]) - 1];
    expect(line).toContain("buildLeaflyVariantCatalog()");
  });

  it("the dashboard actions guard orders.manage, audit, and pass approval only on the dashboard", () => {
    const a = read("src/app/admin/orders/leafly-actions.ts");
    const upd = a.slice(a.indexOf("export async function updateLeaflyOrderCartAction"));
    expect(upd).toContain('requirePermission("orders.manage")');
    expect(upd).toContain("priceOverridesApproved: true");
    for (const name of ["leafly.order_cart_updated", "leafly.order_cart_failed", "leafly.order_cart_timeout"]) expect(a).toContain(name);
    for (const fn of ["loadLeaflyCartEditorAction", "previewLeaflyCartAction"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}`), a.indexOf(`export async function ${fn}`) + 900);
      expect(body).toContain('requirePermission("orders.manage")');
    }
  });

  it("the dashboard editor is rendered only for acknowledged, editable orders and posts the REVIEWED lines", () => {
    const w = read("src/components/admin/orders/LeaflyOrderWorkflow.tsx");
    expect(w).toContain("<LeaflyCartEditor");
    expect(w).toMatch(/!!order\.acknowledged_at/);
    expect(w).toContain("LEAFLY_CART_EDITABLE_STATUSES");
    const e = read("src/components/admin/orders/LeaflyCartEditor.tsx");
    expect(e).toContain('name="cartLines" value={JSON.stringify(reviewed.lines)}');
    expect(e).toContain('name="cartSignature"');
    // Every edit discards the review, so a stale preview can't be confirmed.
    expect(e).toMatch(/function edit\(next: Row\[\]\) \{\s*setRows\(next\);\s*setReviewed\(null\);/);
    // useFormStatus only in the child button, never beside the <form>.
    const confirm = e.slice(e.indexOf("function ConfirmButton"));
    expect(confirm).toContain("useFormStatus()");
    expect(e.slice(0, e.indexOf("function ConfirmButton"))).not.toContain("useFormStatus()");
  });

  it("the register editor is offered for marketplace orders and blocks handover while open", () => {
    const s = read("src/app/pos/RegisterShell.tsx");
    expect(s).toContain("<RegisterCartEditor");
    expect(s).toMatch(/detail\.isMarketplace \? \(\s*cartOpen \?/);
    expect(s).toContain("disabled={busy || cancelOpen || cartOpen}");
    const r = read("src/app/pos/RegisterCartEditor.tsx");
    expect(r).toContain("cartLoad: {}");
    expect(r).toContain("review: true");
    // The PIN is only sent when the server's review asked for one.
    expect(r).toContain("reviewed.review.needsManagerApproval ? { pin } : {}");
    // Sends the reviewed lines, not the live rows.
    expect(r).toContain("post(reviewed.lines,");
  });

  it("the route documents both modes and gates the PIN on the review's verdict", () => {
    const route = read("src/app/api/pos/pickup/route.ts");
    expect(route).toContain("POST { orderId, cartLoad: {} }   (SLICE L-48)");
    expect(route).toContain("if (review.needsManagerApproval) {");
    expect(route).toContain("priceOverridesApproved: approverName !== null,");
  });

  it("the store audits under pos-cart:<device> with both action names", () => {
    const st = read("src/lib/pos/pickup-store.ts");
    expect(st).toContain("actorEmail: `pos-cart:${input.deviceName}`");
    expect(st).toContain('"order.cart_updated_at_register"');
    expect(st).toContain('"order.register_cart_failed"');
  });
});
