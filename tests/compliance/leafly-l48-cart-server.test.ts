/**
 * SLICE L-48 — "Update Order's Cart", the SERVER layer, actually run.
 *
 * The pure core is exercised by its own 128 self-tests. What those cannot see
 * is the shell: does it re-read the order rather than trust the form, does it
 * send through the ONE authorized transport, does it record every attempt
 * (refusals included) in the ledger the certification proof screen reads,
 * does it rebuild the register copy INSERT-THEN-DELETE, and does it tell the
 * truth when Leafly does not answer.
 *
 * Everything below runs the REAL order-cart-server, order-cart-core,
 * order-ack-server (transport + ledger), order-ack-core and bridge-core. Only
 * the edges are faked: the database, the token mint, the network, the menu
 * feed, the register-claim reader and Leafly's GET order.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── The database fake ──────────────────────────────────────────────────────
type Op = { table: string; op: "select" | "insert" | "update" | "delete"; payload?: unknown; filters: [string, string, unknown][]; columns?: string };
const ops: Op[] = [];
let tables: {
  leaflyRow: Record<string, unknown> | null;
  localOrder: { id: string; status: string } | null;
  oldLineIds: string[];
  failInsertLines: string | null;
  failDeleteLines: string | null;
};

function resolveOp(o: Op, single: boolean): { data: unknown; error: { message: string } | null } {
  if (o.op === "select") {
    if (o.table === "leafly_orders") {
      const byLocal = o.filters.some(([, col]) => col === "local_order_id");
      if (byLocal) return { data: tables.leaflyRow ? { leafly_order_id: tables.leaflyRow.leafly_order_id } : null, error: null };
      return { data: tables.leaflyRow, error: null };
    }
    if (o.table === "orders") return { data: tables.localOrder, error: null };
    if (o.table === "order_lines") return { data: tables.oldLineIds.map((id) => ({ id })), error: null };
    return { data: single ? null : [], error: null };
  }
  if (o.op === "insert" && o.table === "order_lines" && tables.failInsertLines) return { data: null, error: { message: tables.failInsertLines } };
  if (o.op === "delete" && o.table === "order_lines" && tables.failDeleteLines) return { data: null, error: { message: tables.failDeleteLines } };
  return { data: null, error: null };
}

function builder(table: string) {
  const o: Op = { table, op: "select", filters: [] };
  const q: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
    fn(...a);
    return q;
  };
  q.select = chain((cols) => { if (o.op === "select") o.columns = String(cols); });
  q.insert = chain((p) => { o.op = "insert"; o.payload = p; });
  q.update = chain((p) => { o.op = "update"; o.payload = p; });
  q.delete = chain(() => { o.op = "delete"; });
  q.eq = chain((c, v) => o.filters.push(["eq", String(c), v]));
  q.in = chain((c, v) => o.filters.push(["in", String(c), v]));
  q.limit = chain(() => {});
  q.order = chain(() => {});
  q.abortSignal = chain(() => {});
  q.maybeSingle = async () => { ops.push(o); return resolveOp(o, true); };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    ops.push(o);
    return Promise.resolve(resolveOp(o, false)).then(res, rej);
  };
  return q;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("@/lib/leafly/runtime", () => ({ refreshLeaflyConfig: async () => ({}) }));
vi.mock("@/lib/leafly/config", () => ({ getLeaflyConfig: () => ({ environment: "sandbox" }) }));
vi.mock("@/lib/leafly/token", () => ({ getLeaflyAccessToken: async () => "tok", resetLeaflyTokenCache: () => {} }));
let integrationKey: string | null = "key-1";
vi.mock("@/lib/leafly/webhook-server", () => ({
  loadLeaflyOrderIntegrationKey: async () => integrationKey,
  markLeaflyOrderAcknowledged: async () => ({ ok: true }),
}));

// ── The network fake: what Leafly answers, and what we sent ────────────────
type Reply = { status: number; body: unknown } | { network: string };
let reply: Reply;
const sent: { op: string; url: string; body: unknown; auth: string | null }[] = [];
vi.mock("@/lib/leafly/deadline-fetch", () => ({
  leaflyFetchWithDeadline: async (op: string, url: string, init: { body?: string; headers?: Record<string, string> }) => {
    sent.push({ op, url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization ?? null });
    if ("network" in reply) return { ok: false, verdict: { message: reply.network } };
    const text = reply.body === null ? "" : JSON.stringify(reply.body);
    return { ok: true, response: new Response(text, { status: reply.status }) };
  },
}));

const stored: unknown[] = [];
let collectResult: { ok: boolean; order: unknown } = { ok: false, order: null };
vi.mock("@/lib/leafly/order-fetch-server", () => ({
  storeFetchedLeaflyOrder: async (i: { order: unknown }) => { stored.push(i.order); return { ok: true }; },
  collectLeaflyOrder: async () => collectResult,
}));
let claim = { registerSaleOpen: false, whereItIs: "" };
vi.mock("@/lib/leafly/register-claim-server", () => ({ readRegisterClaim: async () => claim }));

type Opt = { integratorVariantId: string; productName: string; brand: string | null; variantLabel: string | null; category: string; priceMinorUnits: number; inventoryLevel: number; orderable: boolean };
let menu: Opt[] = [];
let menuLoaded = true;
vi.mock("@/lib/leafly/preview-lookup", () => ({
  buildLeaflyVariantCatalog: async () => {
    const m = new Map(menu.map((o) => [o.integratorVariantId, o]));
    return {
      lookup: (id: string) => {
        const o = m.get(id);
        return o ? { inventoryLevel: o.inventoryLevel, priceMinorUnits: o.priceMinorUnits, orderable: o.orderable } : null;
      },
      options: menu,
      variantCount: menu.length,
      loaded: menuLoaded,
    };
  },
}));

const server = await import("@/lib/leafly/order-cart-server");
const { cartSignature, readEditableLeaflyCart } = await import("@/lib/leafly/order-cart-core");

// ── Fixtures ──────────────────────────────────────────────────────────────
const item = (over: Record<string, unknown> = {}) => ({
  id: "ci-1", name: "Blue Dream", brandName: "Acme", integratorVariantId: "v1", quantity: 2,
  packageSize: "3.5", packageUnit: "g", packagePrice: 3000, priceCents: 6000, discountedPriceCents: 6000, ...over,
});
const leaflyOrder = (items: unknown[], over: Record<string, unknown> = {}) => ({
  id: "ord-1", status: "confirmed", fulfillmentMechanism: "pickup", subtotal: 7500, total: 7500, taxes: [], cartItems: items, ...over,
});
const twoItems = () => [item(), item({ id: "ci-2", name: "OG Kush", integratorVariantId: "v2", quantity: 1, packagePrice: 1500, priceCents: 1500, discountedPriceCents: 1500 })];
const row = (over: Record<string, unknown> = {}) => ({
  leafly_order_id: "ord-1", leafly_status: "confirmed", acknowledged_at: "2025-01-01T00:00:00Z",
  fulfillment_mechanism: "pickup", local_order_id: "local-1", raw_order: leaflyOrder(twoItems()), ...over,
});
const sig = () => cartSignature(readEditableLeaflyCart(tables.leaflyRow?.raw_order ?? null).lines);
const keepAll = () => [
  { cartItemId: "ci-1", integratorVariantId: "v1", quantity: 2, packagePriceMinor: null },
  { cartItemId: "ci-2", integratorVariantId: "v2", quantity: 1, packagePriceMinor: null },
];
const ledger = () => ops.filter((o) => o.table === "leafly_outbound_attempts" && o.op === "insert").map((o) => o.payload as Record<string, unknown>);
const update = (desired: unknown, over: Record<string, unknown> = {}) =>
  server.updateLeaflyOrderCart({
    leaflyOrderId: "ord-1",
    desired: desired as never,
    expectedSignature: sig(),
    priceOverridesApproved: true,
    staffId: null,
    actorLabel: "Sam at Front iPad",
    ...over,
  });

beforeEach(() => {
  ops.length = 0;
  sent.length = 0;
  stored.length = 0;
  tables = { leaflyRow: row(), localOrder: { id: "local-1", status: "acknowledged" }, oldLineIds: ["old-a", "old-b"], failInsertLines: null, failDeleteLines: null };
  integrationKey = "key-1";
  claim = { registerSaleOpen: false, whereItIs: "" };
  menuLoaded = true;
  menu = [
    { integratorVariantId: "v1", productName: "Blue Dream", brand: "Acme", variantLabel: "3.5g", category: "flower", priceMinorUnits: 3000, inventoryLevel: 10, orderable: true },
    { integratorVariantId: "v2", productName: "OG Kush", brand: null, variantLabel: "1g", category: "flower", priceMinorUnits: 1500, inventoryLevel: 10, orderable: true },
    { integratorVariantId: "v3", productName: "Gelato", brand: "Z", variantLabel: "3.5g", category: "flower", priceMinorUnits: 3500, inventoryLevel: 4, orderable: true },
    { integratorVariantId: "v4", productName: "Sold Out", brand: null, variantLabel: null, category: "edible", priceMinorUnits: 900, inventoryLevel: 0, orderable: true },
  ];
  collectResult = { ok: false, order: null };
  reply = { status: 200, body: null };
});

// ── The editor loader ──────────────────────────────────────────────────────
describe("L-48 loadLeaflyCartEditor", () => {
  it("an acknowledged, confirmed pickup order is editable, with its signature and an in-stock menu", async () => {
    const d = await server.loadLeaflyCartEditor("ord-1");
    expect(d.found).toBe(true);
    expect(d.editable).toBe(true);
    expect(d.blockedReason).toBeNull();
    expect(d.localOrderId).toBe("local-1");
    expect(d.signature).toBe(sig());
    expect(d.reading.lines.map((l) => l.cartItemId)).toEqual(["ci-1", "ci-2"]);
    // Out-of-stock sizes are never offered.
    expect(d.options.map((o) => o.integratorVariantId)).not.toContain("v4");
    expect(d.options.map((o) => o.integratorVariantId).sort()).toEqual(["v1", "v2", "v3"]);
    expect(sent).toHaveLength(0);
  });

  it("says WHY it cannot be edited, in words, using the core's reason", async () => {
    tables.leaflyRow = row({ acknowledged_at: null });
    const a = await server.loadLeaflyCartEditor("ord-1");
    expect(a.editable).toBe(false);
    expect(a.blockedCode).toBe("not_acknowledged");
    expect(a.blockedReason).toBeTruthy();

    tables.leaflyRow = row({ leafly_status: "picked_up" });
    expect((await server.loadLeaflyCartEditor("ord-1")).blockedCode).toBe("order_closed");

    tables.leaflyRow = row();
    claim = { registerSaleOpen: true, whereItIs: "Front iPad" };
    expect((await server.loadLeaflyCartEditor("ord-1")).blockedCode).toBe("register_holds_order");
  });

  it("an order we do not have is not_found_locally and nothing is sent", async () => {
    tables.leaflyRow = null;
    const d = await server.loadLeaflyCartEditor("nope");
    expect(d.found).toBe(false);
    expect(d.blockedCode).toBe("not_found_locally");
    expect(sent).toHaveLength(0);
  });
});

// ── The dry run ────────────────────────────────────────────────────────────
describe("L-48 previewLeaflyOrderCart (dry run)", () => {
  it("returns the change sentences and sends NOTHING, records NOTHING", async () => {
    const p = await server.previewLeaflyOrderCart({ leaflyOrderId: "ord-1", desired: [keepAll()[0]!], expectedSignature: sig() });
    expect(p.allowed).toBe(true);
    expect(p.summary.removed).toBe(1);
    expect(p.changes.find((c) => c.kind === "removed")?.sentence).toMatch(/OG Kush/);
    expect(sent).toHaveLength(0);
    expect(ledger()).toHaveLength(0);
  });

  it("REPORTS a hand-set price (needsManagerApproval) rather than refusing it", async () => {
    const p = await server.previewLeaflyOrderCart({
      leaflyOrderId: "ord-1",
      desired: [{ ...keepAll()[0]!, packagePriceMinor: 2500 }, keepAll()[1]!],
      expectedSignature: sig(),
    });
    expect(p.allowed).toBe(true);
    expect(p.needsManagerApproval).toBe(true);
  });

  it("an unreadable list is bad_request", async () => {
    const p = await server.previewLeaflyOrderCart({ leaflyOrderId: "ord-1", desired: null, expectedSignature: sig() });
    expect(p.allowed).toBe(false);
    expect(p.code).toBe("bad_request");
  });
});

// ── The send ──────────────────────────────────────────────────────────────
describe("L-48 updateLeaflyOrderCart — refusals send nothing but ARE recorded", () => {
  it("a stale screen (signature moved) is refused, recorded as operation 'cart', nothing sent", async () => {
    const r = await update([keepAll()[0]], { expectedSignature: "stale" });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(true);
    expect(r.code).toBe("cart_changed_since_opened");
    expect(sent).toHaveLength(0);
    const l = ledger();
    expect(l).toHaveLength(1);
    expect(l[0]!.operation).toBe("cart");
    expect(l[0]!.refusal_code).toBe("cart_changed_since_opened");
  });

  it("an unapproved hand-set price is refused (the register without a PIN)", async () => {
    const r = await update([{ ...keepAll()[0], packagePriceMinor: 2500 }, keepAll()[1]], { priceOverridesApproved: false });
    expect(r.code).toBe("price_override_not_approved");
    expect(r.needsManagerApproval).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("an order we do not have is recorded and refused", async () => {
    tables.leaflyRow = null;
    const r = await update([keepAll()[0]]);
    expect(r.code).toBe("not_found_locally");
    expect(ledger()[0]!.refusal_code).toBe("not_found_locally");
    expect(sent).toHaveLength(0);
  });

  it("an unparseable list is recorded as bad_request", async () => {
    const r = await update(null);
    expect(r.code).toBe("bad_request");
    expect(ledger()[0]!.refusal_code).toBe("bad_request");
    expect(sent).toHaveLength(0);
  });

  it("an out-of-stock swap is refused before Leafly is asked", async () => {
    const r = await update([{ ...keepAll()[0], integratorVariantId: "v4" }, keepAll()[1]]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("variant_out_of_stock");
    expect(sent).toHaveLength(0);
  });
});

describe("L-48 updateLeaflyOrderCart — the 200 path", () => {
  const afterRemoval = () => leaflyOrder([item()], { subtotal: 6000, total: 5400 });

  it("POSTs the spec body to /{key}/orders/{id}/cart via the bearer transport with the cart_update deadline", async () => {
    reply = { status: 200, body: afterRemoval() };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.op).toBe("cart_update");
    expect(sent[0]!.url).toMatch(/\/key-1\/orders\/ord-1\/cart$/);
    expect(sent[0]!.auth).toBe("Bearer tok");
    // Spec: {cartItems (min 1), taxes, deliveryFee}. Removal = omission.
    expect(sent[0]!.body).toEqual({
      cartItems: [{ id: "ci-1", integratorVariantId: "v1", quantity: 2, packagePrice: 3000 }],
      taxes: [],
      deliveryFee: 0,
    });
  });

  it("records the exchange as a SUCCESSFUL 'cart' attempt (the proof card turns green)", async () => {
    reply = { status: 200, body: afterRemoval() };
    await update([keepAll()[0]]);
    const l = ledger();
    expect(l).toHaveLength(1);
    expect(l[0]!.operation).toBe("cart");
    expect(l[0]!.response_status).toBe(200);
    expect(l[0]!.disposition).toBe("success");
    expect(l[0]!.request_body).toEqual(sent[0]!.body);
  });

  it("stores Leafly's returned order and says the new total", async () => {
    reply = { status: 200, body: afterRemoval() };
    const r = await update([keepAll()[0]]);
    expect(stored).toEqual([afterRemoval()]);
    expect(r.verified).toBe(true);
    expect(r.message).toMatch(/1 removed/);
    expect(r.message).toMatch(/\$54\.00/);
    expect(r.warning).toBeNull();
  });

  it("rebuilds the register copy INSERT-THEN-DELETE, updates totals, and leaves a timeline note", async () => {
    reply = { status: 200, body: afterRemoval() };
    await update([keepAll()[0]]);
    const w = ops.filter((o) => o.op !== "select" && o.table !== "leafly_outbound_attempts");
    const ins = w.findIndex((o) => o.table === "order_lines" && o.op === "insert");
    const del = w.findIndex((o) => o.table === "order_lines" && o.op === "delete");
    expect(ins).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(ins);
    expect(w[del]!.filters).toContainEqual(["in", "id", ["old-a", "old-b"]]);
    const lines = w[ins]!.payload as Record<string, unknown>[];
    expect(lines).toEqual([{ order_id: "local-1", product_name: "Blue Dream", variant_label: "3.5g", quantity: 2, price_minor_units: 3000 }]);
    const tot = w.find((o) => o.table === "orders" && o.op === "update")!;
    expect(tot.payload).toMatchObject({ subtotal_minor_units: 6000, total_minor_units: 5400, item_count: 2 });
    const note = w.find((o) => o.table === "order_events")!;
    expect((note.payload as Record<string, unknown>).actor_label).toBe("Sam at Front iPad");
    expect(String((note.payload as Record<string, unknown>).note)).toMatch(/OG Kush/);
  });

  it("if inserting the new lines fails, the OLD lines are NOT deleted (never an empty bag) and it is a warning, not a failure", async () => {
    reply = { status: 200, body: afterRemoval() };
    tables.failInsertLines = "boom";
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(true);
    expect(ops.some((o) => o.table === "order_lines" && o.op === "delete")).toBe(false);
    expect(r.warning).toMatch(/old items/);
  });

  it("a closed register copy is left alone", async () => {
    reply = { status: 200, body: afterRemoval() };
    tables.localOrder = { id: "local-1", status: "completed" };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(true);
    expect(ops.some((o) => o.table === "order_lines" && o.op !== "select")).toBe(false);
    expect(r.warning).toMatch(/left as it is/);
  });

  it("a 200 whose cart differs from what we sent is still OK, but WARNS and is unverified", async () => {
    reply = { status: 200, body: leaflyOrder(twoItems()) }; // Leafly kept the removed line
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.warning).toMatch(/differs from what we asked for/);
  });

  it("an addition is sent with id null at the menu price; a substitution keeps the id with the new variant", async () => {
    reply = { status: 200, body: leaflyOrder([item({ integratorVariantId: "v3", packagePrice: 3500 }), twoItems()[1], item({ id: "ci-9", integratorVariantId: "v1", quantity: 1 })]) };
    await update([
      { cartItemId: "ci-1", integratorVariantId: "v3", quantity: 2, packagePriceMinor: null },
      keepAll()[1],
      { cartItemId: null, integratorVariantId: "v1", quantity: 1, packagePriceMinor: null },
    ]);
    const body = sent[0]!.body as { cartItems: Record<string, unknown>[] };
    expect(body.cartItems).toContainEqual({ id: "ci-1", integratorVariantId: "v3", quantity: 2, packagePrice: 3500 });
    expect(body.cartItems).toContainEqual({ id: null, integratorVariantId: "v1", quantity: 1, packagePrice: 3000 });
  });
});

describe("L-48 updateLeaflyOrderCart — Leafly refuses or does not answer", () => {
  it("a 400 is a failure that says nothing changed, re-reads the order, and is recorded", async () => {
    reply = { status: 400, body: { message: "variant out of stock" } };
    collectResult = { ok: true, order: leaflyOrder(twoItems()) };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.httpStatus).toBe(400);
    expect(r.message).toMatch(/Nothing on the order was changed/);
    expect(r.message).toMatch(/re-read the order/);
    expect(ledger()[0]!.response_status).toBe(400);
    expect(ops.some((o) => o.table === "order_lines" && o.op !== "select")).toBe(false);
  });

  it("no answer + the re-read PROVES it landed → ok, success_after_reread, register copy rebuilt", async () => {
    reply = { network: "timed out" };
    const landed = leaflyOrder([item()], { subtotal: 6000, total: 6000 });
    collectResult = { ok: true, order: landed };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("success_after_reread");
    expect(r.verified).toBe(true);
    expect(r.message).toMatch(/HAS the new items/);
    expect(ledger()[0]!.disposition).toBe("retry");
  });

  it("no answer + the re-read shows the OLD cart → not ok, safe to retry", async () => {
    reply = { network: "timed out" };
    collectResult = { ok: true, order: leaflyOrder(twoItems()) };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("network_error");
    expect(r.verified).toBe(false);
    expect(r.message).toMatch(/safe to try again/);
  });

  it("no answer + no re-read → not ok, and says do NOT send again", async () => {
    reply = { network: "timed out" };
    collectResult = { ok: false, order: null };
    const r = await update([keepAll()[0]]);
    expect(r.ok).toBe(false);
    expect(r.verified).toBeNull();
    expect(r.message).toMatch(/Do NOT send it again/);
  });
});
