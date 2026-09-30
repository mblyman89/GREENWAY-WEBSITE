/**
 * tests/compliance/s32-merge-decision-store.test.ts  (bible S32)
 *
 * The store behind the match review, against a mocked Supabase client:
 *   - a failed read of saved choices (any chunk, or 0239 not applied) is an
 *     EMPTY map - no choice is ever applied from a partial read;
 *   - rows are shaped for the planner (own_card_key carried; a bad row dropped);
 *   - a missing table on save / forget reports migrated:false (the page names
 *     0239) instead of an error; a real error is reported, never swallowed;
 *   - forget says whether a row was actually deleted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  rows: [] as unknown[],
  loadError: null as null | { code?: string; message: string },
  failChunk: -1,
  chunk: 0,
  writeError: null as null | { code?: string; message: string },
  deleted: [] as unknown[],
  upserts: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        in: () => b,
        eq: () => b,
        order: () => b,
        range: () => {
          const i = st.chunk++;
          if (st.loadError || i === st.failChunk) {
            return Promise.resolve({ data: null, error: st.loadError ?? { message: "timeout" } });
          }
          return Promise.resolve({ data: i === 0 ? st.rows : [], error: null });
        },
        upsert: (row: unknown) => {
          st.upserts.push(row);
          return Promise.resolve({ error: st.writeError });
        },
        delete: () => ({
          eq: () => ({
            select: () => Promise.resolve({ data: st.writeError ? null : st.deleted, error: st.writeError }),
          }),
        }),
      };
      return b;
    },
  }),
}));

import { loadMergeDecisions, saveMergeDecision, forgetMergeDecision } from "@/lib/pos/merge-decision-store";

const MISSING = { code: "PGRST205", message: "Could not find the table 'public.intake_merge_decisions' in the schema cache" };
const ROW = {
  identity: "a|flower|b",
  decision: "join",
  target_card_key: "C1",
  candidate_card_keys: ["C1", "C2"],
  own_card_key: "LOT-1",
  decided_by: null,
  decided_at: "2026-09-30T00:00:00Z",
  note: null,
};
const INPUT = {
  manifestId: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
  identity: "a|flower|b",
  decision: "join" as const,
  targetCardKey: "C1",
  candidateCardKeys: ["C1", "C2"],
  ownCardKey: "LOT-1",
  note: null,
};

beforeEach(() => {
  st.rows = [ROW];
  st.loadError = null;
  st.failChunk = -1;
  st.chunk = 0;
  st.writeError = null;
  st.deleted = [];
  st.upserts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadMergeDecisions", () => {
  it("shapes rows for the planner (own_card_key carried)", async () => {
    const m = await loadMergeDecisions(["a|flower|b"]);
    expect(m.get("a|flower|b")).toEqual({
      decision: "join",
      target_card_key: "C1",
      candidate_card_keys: ["C1", "C2"],
      own_card_key: "LOT-1",
    });
  });
  it("no identities = no read", async () => {
    expect((await loadMergeDecisions([])).size).toBe(0);
    expect(st.chunk).toBe(0);
  });
  it("a bad row is dropped, never guessed", async () => {
    st.rows = [{ ...ROW, decision: "maybe" }];
    expect((await loadMergeDecisions(["a|flower|b"])).size).toBe(0);
  });
  it("0239 not applied = empty map", async () => {
    st.loadError = MISSING;
    expect((await loadMergeDecisions(["a|flower|b"])).size).toBe(0);
  });
  it("ANY failed chunk = empty map (never apply choices from a partial read)", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `v|flower|f${i}`);
    ids[0] = "a|flower|b";
    st.failChunk = 1; // chunk 0 returns ROW, a later chunk fails
    const m = await loadMergeDecisions(ids);
    expect(st.chunk).toBeGreaterThan(1);
    expect(m.size).toBe(0);
  });
});

describe("saveMergeDecision / forgetMergeDecision", () => {
  it("save writes one row with own_card_key and the target only on join", async () => {
    expect(await saveMergeDecision(INPUT, "u1")).toEqual({ ok: true, migrated: true });
    expect(st.upserts[0]).toMatchObject({ identity: "a|flower|b", decision: "join", target_card_key: "C1", own_card_key: "LOT-1", decided_by: "u1" });
    await saveMergeDecision({ ...INPUT, decision: "separate", targetCardKey: "C1" }, "u1");
    expect((st.upserts[1] as { target_card_key: unknown }).target_card_key).toBeNull();
  });
  it("missing table on save = migrated:false, not an error", async () => {
    st.writeError = MISSING;
    expect(await saveMergeDecision(INPUT, "u1")).toEqual({ ok: false, migrated: false, error: undefined });
  });
  it("a real write error is reported", async () => {
    st.writeError = { code: "42501", message: "permission denied" };
    expect(await saveMergeDecision(INPUT, "u1")).toEqual({ ok: false, migrated: true, error: "permission denied" });
  });
  it("forget says whether a row was deleted", async () => {
    st.deleted = [{ identity: "a|flower|b" }];
    expect(await forgetMergeDecision("a|flower|b")).toEqual({ ok: true, migrated: true, deleted: true });
    st.deleted = [];
    expect((await forgetMergeDecision("a|flower|b")).deleted).toBe(false);
    st.writeError = MISSING;
    expect((await forgetMergeDecision("a|flower|b")).migrated).toBe(false);
  });
});
