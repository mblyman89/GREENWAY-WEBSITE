/**
 * tests/compliance/r23-waiting-facts-server.test.ts  (Round 23, items 2 + 6)
 *
 * The READ half of "Facts waiting for you": one bounded read for the page,
 * only pending + row-attachable suggestions on this page's keys, and a
 * failed read is reported (ok:false) - never shown as "nothing waiting".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  calls: [] as string[],
  result: { data: [] as unknown, error: null as null | { message: string } },
  throws: false,
}));

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    net.calls.push(`${table}.${name}(${JSON.stringify(args)})`);
    return b;
  };
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = rec(m);
  b.maybeSingle = async () => {
    net.calls.push(`${table}.maybeSingle()`);
    const d = net.result.data;
    return { data: Array.isArray(d) ? d[0] ?? null : d, error: net.result.error };
  };
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(net.result).then(res, rej);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (net.throws) throw new Error("boom");
    return { from: (t: string) => builder(t) };
  },
}));
vi.mock("@/lib/enrichment/enrichment-identity-server", () => ({ enrichmentFollowsIdentityOn: () => true }));

const srv = await import("@/lib/catalog/waiting-facts-server");

beforeEach(() => {
  net.calls = [];
  net.result = { data: [], error: null };
  net.throws = false;
});

describe("R23 waiting-facts-server", () => {
  it("ONE bounded read: pending, product, this page's unique keys, row-attachable field keys, newest first", async () => {
    net.result = { data: [{ id: "a", entity_id: "K1", field_key: "effects", suggested_value: "relaxed" }], error: null };
    const r = await srv.loadWaitingSuggestions(["K1", " K1 ", null, "", "K2"]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(net.calls).toEqual([
      `ai_suggestions.select(${JSON.stringify([srv.WAITING_SUGGESTION_SELECT])})`,
      'ai_suggestions.eq(["entity_type","product"])',
      'ai_suggestions.eq(["status","pending"])',
      'ai_suggestions.in(["entity_id",["K1","K2"]])',
      'ai_suggestions.in(["field_key",["description","short_description","effects","sensory"]])',
      'ai_suggestions.order(["created_at",{"ascending":false}])',
      `ai_suggestions.limit([${srv.WAITING_SUGGESTION_LIMIT}])`,
    ]);
    expect(srv.WAITING_SUGGESTION_SELECT).not.toContain("*");
  });

  it("no keys: no read at all", async () => {
    const r = await srv.loadWaitingSuggestions([null, "", "  "]);
    expect(r).toEqual({ ok: true, rows: [] });
    expect(net.calls).toEqual([]);
  });

  it("a failed or throwing read is ok:false (the panel says 'could not check')", async () => {
    net.result = { data: null, error: { message: "nope" } };
    expect(await srv.loadWaitingSuggestions(["K1"])).toEqual({ ok: false, rows: [] });
    net.throws = true;
    expect(await srv.loadWaitingSuggestions(["K1"])).toEqual({ ok: false, rows: [] });
  });

  it("the single re-read is by id AND entity_type product; an error is null (never trusted)", async () => {
    net.result = { data: { id: "s1", entity_id: "K1", field_key: "effects", suggested_value: "x", status: "pending" }, error: null };
    expect((await srv.readWaitingSuggestion(" s1 "))?.id).toBe("s1");
    expect(net.calls).toContain('ai_suggestions.eq(["id","s1"])');
    expect(net.calls).toContain('ai_suggestions.eq(["entity_type","product"])');
    net.result = { data: null, error: { message: "x" } };
    expect(await srv.readWaitingSuggestion("s1")).toBeNull();
    net.calls = [];
    expect(await srv.readWaitingSuggestion("  ")).toBeNull();
    expect(net.calls).toEqual([]);
  });

  it("the draft re-read derives the SAME suggestion key the door files under (restock card key when following identity)", async () => {
    net.result = { data: { id: "d1", status: "approved", pos_product_key: "LOT-1", restock_of_card_key: "CARD-9" }, error: null };
    const r = await srv.readDraftForWaiting("d1");
    expect(r?.status).toBe("approved");
    expect(r?.key).toBe("CARD-9");
    net.result = { data: { id: "d1", status: "draft", pos_product_key: " LOT-1 ", restock_of_card_key: null }, error: null };
    expect((await srv.readDraftForWaiting("d1"))?.key).toBe("LOT-1");
    net.result = { data: null, error: { message: "x" } };
    expect(await srv.readDraftForWaiting("d1")).toBeNull();
  });
});
