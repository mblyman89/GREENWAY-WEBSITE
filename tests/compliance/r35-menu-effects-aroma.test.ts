/**
 * tests/compliance/r35-menu-effects-aroma.test.ts  (R35 #6 - migration 0254)
 *
 * Owner (R35, verbatim): "I only want to build #4 and #6." #6 = the open R19
 * line "Effects and aroma columns on the menu row" (S12.2 / S12.3, F-046).
 *
 * Proven by EXECUTING the real code wherever it can run without a database
 * (real postgrest-js client over FakePostgrest, the REAL compliance gate):
 *   A. schema contract: the migration's columns / cap / checks match
 *      menu-sensory-core, the rollback undoes exactly them, the pure core is
 *      registered in the runner at its floor;
 *   B. golden-record server: counted lists only, effects through
 *      checkEffects, aroma through lintTerms + the owner's banned phrases,
 *      flag off = nothing;
 *   C. insertMenuItemsWithKbLink: a pre-0254 table retries once WITHOUT the
 *      two columns (and only then), composes with the 0234 retry, never
 *      retries an unrelated error;
 *   D. product page: own list first, re-gated at render time, KB fallback on
 *      nothing / pre-0254 / any failure;
 *   E. the fill-only backfill: fills NULL only, never overwrites, racing
 *      writer kept, gate applied, refuses partial reads / missing column;
 *   F. wiring pins: writers, carry-forward, menu-columns, action + button.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import { PostgrestClient } from "@supabase/postgrest-js";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  version: { id: "V1" } as { id: string } | null,
  banned: [] as { phrase: string; severity: "block" | "warn"; reason: string | null }[],
  bannedThrows: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => st.version }));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => {
    if (st.bannedThrows) throw new Error("banned table down");
    return st.banned;
  },
}));

const core = await import("@/lib/pos/menu-sensory-core");
const golden = await import("@/lib/catalog/golden-record-server");
const goldenCore = await import("@/lib/catalog/golden-record-core");
const kbLink = await import("@/lib/catalog/menu-kb-link-server");
const page = await import("@/lib/menu/product-sensory-server");
const backfill = await import("@/lib/pos/menu-sensory-backfill-server");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
type Admin = Parameters<typeof kbLink.insertMenuItemsWithKbLink>[0];
const client = () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Admin;

const at = "2026-01-01T00:00:00Z";
const fact = (value: unknown, source: string, confidence: number | null = null) => ({ value, source, confidence, at });
const PGRST204_EFFECTS = { code: "PGRST204", details: null, hint: null, message: "Could not find the 'effects' column of 'menu_items' in the schema cache" };
const PGRST204_KB = { code: "PGRST204", details: null, hint: null, message: "Could not find the 'kb_product_id' column of 'menu_items' in the schema cache" };
const KB1 = "11111111-1111-4111-8111-111111111111";

const savedFlag = process.env[goldenCore.GOLDEN_RECORD_ENV];
beforeEach(() => {
  st.db = new FakePostgrest();
  st.version = { id: "V1" };
  st.banned = [];
  st.bannedThrows = false;
  delete process.env[goldenCore.GOLDEN_RECORD_ENV];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[goldenCore.GOLDEN_RECORD_ENV];
  else process.env[goldenCore.GOLDEN_RECORD_ENV] = savedFlag;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("A. schema contract (migration 0254 <-> menu-sensory-core)", () => {
  const mig = read("supabase/migrations/0254_menu_item_effects_aroma.sql");
  const rb = read("supabase/rollbacks/0254_menu_item_effects_aroma.rollback.sql");
  const sqlOnly = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("the pure core runs green at its floor (67) and is registered in the runner at 67", () => {
    expect(core.__runMenuSensoryCoreTests()).toEqual({ passed: 67, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("menu-sensory-core", __runMenuSensoryCoreTests\(\), 67\)/);
  });
  it("adds exactly the two columns the core names, as nullable text[]", () => {
    const body = sqlOnly(mig);
    for (const c of core.MENU_SENSORY_COLUMNS) expect(body).toMatch(new RegExp(`add column if not exists ${c} text\\[\\]`));
    expect(core.MENU_SENSORY_COLUMNS).toEqual(["effects", "aroma_notes"]);
    expect(body).not.toMatch(/not null/i);
    expect(body).not.toMatch(/\bdefault\b/i);
  });
  it("each CHECK uses the core's cap and refuses empty lists and NULL elements", () => {
    const body = sqlOnly(mig);
    for (const c of core.MENU_SENSORY_COLUMNS) {
      expect(body).toContain(
        `check (${c} is null or (cardinality(${c}) between 1 and ${core.MENU_SENSORY_MAX} and array_position(${c}, null) is null))`,
      );
      expect(body).toContain(`drop constraint if exists menu_items_${c}_shape_chk`);
    }
    expect(core.MENU_SENSORY_MAX).toBe(8);
  });
  it("writes NO data (no backfill in SQL: the compliance gate cannot run there) and reloads PostgREST", () => {
    const body = sqlOnly(mig);
    expect(body).not.toMatch(/\bupdate\b|\binsert\b|\bdelete\b/i);
    expect(body).toMatch(/notify pgrst, 'reload schema'/);
    expect(core.MENU_SENSORY_MIGRATION).toBe("0254_menu_item_effects_aroma.sql");
  });
  it("the rollback drops exactly the two checks and the two columns", () => {
    const body = sqlOnly(rb);
    expect(body).toContain("drop constraint if exists menu_items_effects_shape_chk");
    expect(body).toContain("drop constraint if exists menu_items_aroma_notes_shape_chk");
    expect(body).toMatch(/drop column if exists effects,\s*drop column if exists aroma_notes;/);
    expect(body).not.toMatch(/drop table|truncate|delete/i);
  });
  it("the core's app-side mirror agrees with the CHECK on the edge shapes", () => {
    expect(core.satisfiesSensoryCheck(null)).toBe(true);
    expect(core.satisfiesSensoryCheck([])).toBe(false);
    expect(core.satisfiesSensoryCheck(["a"])).toBe(true);
    expect(core.satisfiesSensoryCheck(Array.from({ length: 8 }, (_, i) => `t${i}`))).toBe(true);
    expect(core.satisfiesSensoryCheck(Array.from({ length: 9 }, (_, i) => `t${i}`))).toBe(false);
    expect(core.satisfiesSensoryCheck(["a", null])).toBe(false);
    // sensoryForStorage never produces a shape the CHECK refuses.
    for (const raw of [[], ["", " "], Array.from({ length: 20 }, (_, i) => `t${i}`), ["a", null, "A", "b"], "x", null]) {
      expect(core.satisfiesSensoryCheck(core.sensoryForStorage(raw))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("B. golden-record server: counted + compliance-cleared lists only", () => {
  const draft = (id: string, facts: Row) => ({ id, attached_facts: facts });

  it("a person's effects and an AI aroma at >= 90% travel, cleaned and gated", async () => {
    st.db.rows("catalog_product_drafts").push(
      draft("D1", {
        effects: fact(["Relaxed", "happy", "relaxed", "cures anxiety", "glowing"], "human"),
        aroma: fact(["citrus", "pine"], "gemini", 0.93),
      }),
    );
    const m = await golden.loadGoldenInputs(client(), ["D1"]);
    const g = m.get("D1");
    // checkEffects lowercases, keeps only the experiential allow-list, drops the claim.
    expect(g?.goldenEffects?.values).toEqual(["relaxed", "happy"]);
    expect(g?.goldenEffects?.source).toBe("human");
    expect(g?.goldenAroma?.values).toEqual(["citrus", "pine"]);
    expect(g?.goldenAroma?.confidence).toBe(0.93);
  });
  it("an AI value at 89% and a remembered value never travel", async () => {
    st.db.rows("catalog_product_drafts").push(
      draft("D1", { effects: fact(["relaxed"], "gemini", 0.89), aroma: fact(["pine"], "remembered") }),
    );
    const m = await golden.loadGoldenInputs(client(), ["D1"]);
    expect(m.get("D1")).toBeUndefined();
  });
  it("the owner's banned phrases remove an aroma term (block) and an effect", async () => {
    st.banned = [
      { phrase: "skunk", severity: "block", reason: "owner" },
      { phrase: "giggly", severity: "block", reason: "owner" },
    ];
    st.db.rows("catalog_product_drafts").push(
      draft("D1", { effects: fact(["giggly", "calm"], "human"), aroma: fact(["skunk", "earthy"], "human") }),
    );
    const g = (await golden.loadGoldenInputs(client(), ["D1"])).get("D1");
    expect(g?.goldenEffects?.values).toEqual(["calm"]);
    expect(g?.goldenAroma?.values).toEqual(["earthy"]);
  });
  it("a list with nothing left after the gate is null, never [] (the CHECK refuses [])", () => {
    const r = golden.gateGoldenSensory(
      { values: ["treats pain"], source: "human", confidence: null },
      { values: ["cures cancer"], source: "human", confidence: null },
      [],
    );
    expect(r).toEqual({ goldenEffects: null, goldenAroma: null });
  });
  it("the gate never widens: values it did not return never appear", () => {
    const r = golden.gateGoldenSensory({ values: ["relaxed", "not-a-real-effect"], source: "coa", confidence: null }, null, []);
    expect(r.goldenEffects?.values).toEqual(["relaxed"]);
    expect(r.goldenAroma).toBeNull();
  });
  it("GOLDEN_RECORD_ON_APPROVE=off: no read, nothing travels", async () => {
    process.env[goldenCore.GOLDEN_RECORD_ENV] = "off";
    st.db.rows("catalog_product_drafts").push(draft("D1", { effects: fact(["relaxed"], "human") }));
    const m = await golden.loadGoldenInputs(client(), ["D1"]);
    expect(m.size).toBe(0);
    expect(st.db.log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("C. insertMenuItemsWithKbLink: pre-0254 safety net", () => {
  it("rows without lists carry NO sensory keys (byte-identical to before 0254)", async () => {
    const rows = [{ source_item_id: "S1", name: "One", ...core.sensoryRowFields(null, []) }];
    expect(Object.keys(rows[0])).toEqual(["source_item_id", "name"]);
    const r = await kbLink.insertMenuItemsWithKbLink(client(), rows, new Map());
    expect(r.error).toBeNull();
    expect(r.retriedWithoutSensory).toBe(false);
  });
  it("lists are written when present", async () => {
    const rows = [{ source_item_id: "S1", name: "One", ...core.sensoryRowFields(["relaxed"], ["pine"]) }];
    const r = await kbLink.insertMenuItemsWithKbLink(client(), rows, new Map());
    expect(r.error).toBeNull();
    expect(st.db.rows("menu_items")[0]).toMatchObject({ effects: ["relaxed"], aroma_notes: ["pine"] });
  });
  it("PGRST204 naming effects retries ONCE without the two columns, keeping everything else", async () => {
    st.db.before = (req) => {
      if (req.method === "POST" && (req.body as Row[]).some((x) => "effects" in x || "aroma_notes" in x)) return { status: 400, body: PGRST204_EFFECTS };
    };
    const rows = [
      { source_item_id: "S1", name: "One", ...core.sensoryRowFields(["relaxed"], ["pine"]) },
      { source_item_id: "S2", name: "Two" },
    ];
    const r = await kbLink.insertMenuItemsWithKbLink(client(), rows, new Map([["S1", KB1]]));
    expect(r.error).toBeNull();
    expect(r.retriedWithoutSensory).toBe(true);
    expect(r.retriedWithoutLink).toBe(false);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(2);
    const saved = st.db.rows("menu_items");
    expect(saved).toHaveLength(2);
    expect("effects" in saved[0]).toBe(false);
    expect(saved[0].kb_product_id).toBe(KB1);
  });
  it("42703 'column \"aroma_notes\" ... does not exist' also retries", async () => {
    st.db.before = (req) => {
      if (req.method === "POST" && (req.body as Row[]).some((x) => "aroma_notes" in x))
        return { status: 400, body: { code: "42703", message: 'column "aroma_notes" of relation "menu_items" does not exist' } };
    };
    const r = await kbLink.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1", aroma_notes: ["pine"] }], new Map());
    expect(r.retriedWithoutSensory).toBe(true);
    expect(r.error).toBeNull();
  });
  it("a database missing BOTH 0234 and 0254 is retried twice, each time stripping only what the error named", async () => {
    st.db.before = (req) => {
      if (req.method !== "POST") return;
      const body = req.body as Row[];
      if (body.some((x) => "kb_product_id" in x)) return { status: 400, body: PGRST204_KB };
      if (body.some((x) => "effects" in x)) return { status: 400, body: PGRST204_EFFECTS };
    };
    const r = await kbLink.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1", effects: ["calm"] }], new Map([["S1", KB1]]));
    expect(r.error).toBeNull();
    expect(r.retriedWithoutLink).toBe(true);
    expect(r.retriedWithoutSensory).toBe(true);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(3);
    expect(st.db.rows("menu_items")[0]).toEqual(expect.objectContaining({ source_item_id: "S1" }));
  });
  it("an unrelated error is returned unchanged and never retried", async () => {
    st.db.before = (req) => (req.method === "POST" ? { status: 400, body: { code: "23514", message: 'new row violates check constraint "menu_items_effects_shape_chk"' } } : undefined);
    const r = await kbLink.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1", effects: ["calm"] }], new Map());
    expect(r.error?.code).toBe("23514");
    expect(r.retriedWithoutSensory).toBe(false);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(1);
  });
  it("a missing-column error naming side_effects (not ours) is not retried", async () => {
    st.db.before = (req) =>
      req.method === "POST" ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'side_effects' column of 'menu_items' in the schema cache" } } : undefined;
    const r = await kbLink.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1", effects: ["calm"] }], new Map());
    expect(r.retriedWithoutSensory).toBe(false);
    expect(r.error?.code).toBe("PGRST204");
  });
  it("a sensory missing-column error on a batch WITHOUT sensory keys is not retried", async () => {
    st.db.before = (req) => (req.method === "POST" ? { status: 400, body: PGRST204_EFFECTS } : undefined);
    const r = await kbLink.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1" }], new Map());
    expect(r.retriedWithoutSensory).toBe(false);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("D. product page: own list first, re-gated, KB fallback", () => {
  const publish = (row: Row) => {
    st.db.rows("menu_versions").push({ id: "V1", status: "published" });
    st.db.rows("menu_items").push({ id: "I1", menu_version_id: "V1", source_item_id: "P1", ...row });
  };
  const kb = { effects: ["sleepy"], aroma: ["skunk"] };

  it("the product's own lists win, per list", async () => {
    publish({ effects: ["relaxed", "happy"], aroma_notes: null });
    const r = await page.resolvePageSensory("P1", kb);
    expect(r).toEqual({ effects: ["relaxed", "happy"], aroma: ["skunk"], effectsOrigin: "product", aromaOrigin: "knowledge" });
  });
  it("a phrase the owner bans AFTER the write disappears on the next render (re-gate)", async () => {
    publish({ effects: ["relaxed", "giggly"], aroma_notes: ["pine"] });
    st.banned = [{ phrase: "giggly", severity: "block", reason: "owner" }];
    const r = await page.resolvePageSensory("P1", kb);
    expect(r.effects).toEqual(["relaxed"]);
    expect(r.aroma).toEqual(["pine"]);
  });
  it("an own list that the re-gate empties falls back to the KB list", async () => {
    publish({ effects: ["giggly"], aroma_notes: null });
    st.banned = [{ phrase: "giggly", severity: "block", reason: "owner" }];
    const r = await page.resolvePageSensory("P1", kb);
    expect(r.effects).toEqual(["sleepy"]);
    expect(r.effectsOrigin).toBe("knowledge");
  });
  it("pre-0254 (the select names unknown columns) = exactly the KB lists, no error logged as a failure", async () => {
    st.db.rows("menu_versions").push({ id: "V1", status: "published" });
    st.db.before = (req) => (req.method === "GET" && req.table === "menu_items" ? { status: 400, body: PGRST204_EFFECTS } : undefined);
    const err = vi.spyOn(console, "error");
    const r = await page.resolvePageSensory("P1", kb);
    expect(r).toEqual({ effects: ["sleepy"], aroma: ["skunk"], effectsOrigin: "knowledge", aromaOrigin: "knowledge" });
    expect(err).not.toHaveBeenCalled();
  });
  it("the banned-phrase list failing = KB lists (fail closed: own lists cannot be cleared)", async () => {
    publish({ effects: ["relaxed"], aroma_notes: ["pine"] });
    st.bannedThrows = true;
    const r = await page.resolvePageSensory("P1", kb);
    expect(r.effectsOrigin).toBe("knowledge");
    expect(r.aromaOrigin).toBe("knowledge");
  });
  it("no published version / unknown card / blank id = KB lists", async () => {
    expect((await page.resolvePageSensory("P1", kb)).effectsOrigin).toBe("knowledge");
    publish({ effects: ["relaxed"] });
    expect((await page.resolvePageSensory("NOPE", kb)).effectsOrigin).toBe("knowledge");
    expect((await page.resolvePageSensory("  ", kb)).effectsOrigin).toBe("knowledge");
  });
  it("reads ONE row of the PUBLISHED version by key, naming only the two columns", async () => {
    publish({ effects: ["relaxed"] });
    await page.readOwnSensoryUncached("P1");
    const get = st.db.log.find((q) => q.table === "menu_items")!;
    expect(get.url.searchParams.get("select")).toBe("effects,aroma_notes");
    expect(get.url.searchParams.get("menu_version_id")).toBe("eq.V1");
    expect(get.url.searchParams.get("source_item_id")).toBe("eq.P1");
  });
  it("malformed stored values are treated as nothing (never coerced)", async () => {
    publish({ effects: "relaxed", aroma_notes: [42, ""] });
    expect(await page.readOwnSensoryUncached("P1")).toEqual({ effects: null, aroma: null });
  });
});

// ---------------------------------------------------------------------------
describe("E. Fill effects and aroma on live cards (fill-only backfill)", () => {
  const card = (id: string, sid: string, over: Row = {}) => ({ id, menu_version_id: "V1", source_item_id: sid, effects: null, aroma_notes: null, ...over });
  const approved = (key: string, facts: Row, over: Row = {}) => ({
    id: `D-${key}-${String(over.updated_at ?? "1")}`,
    pos_product_key: key,
    status: "approved",
    attached_facts: facts,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("fills NULL lists from the card's own key and from an onboarded lot; leaves full cards alone", async () => {
    st.db.rows("menu_items").push(
      card("I1", "P1"),
      card("I2", "LIVE-2"),
      card("I3", "P3", { effects: ["calm"], aroma_notes: ["earthy"] }),
      card("I4", "P4"),
    );
    st.db.rows("menu_variants").push({ id: "MV1", menu_item_id: "I2", source_variant_id: "LOTB-onboarded" });
    st.db.rows("catalog_product_drafts").push(
      approved("P1", { effects: fact(["relaxed"], "human"), aroma: fact(["pine"], "coa") }),
      approved("LOTB", { aroma: fact(["citrus"], "gemini", 0.95) }),
      approved("P3", { effects: fact(["happy"], "human") }),
    );
    const r = await backfill.runMenuSensoryBackfill(client());
    expect(r).toMatchObject({ ok: true, filled: 2, alreadyFilled: 1, nothingCounted: 1, failed: 0 });
    const rows = st.db.rows("menu_items");
    expect(rows.find((x) => x.id === "I1")).toMatchObject({ effects: ["relaxed"], aroma_notes: ["pine"] });
    expect(rows.find((x) => x.id === "I2")).toMatchObject({ effects: null, aroma_notes: ["citrus"] });
    expect(rows.find((x) => x.id === "I3")).toMatchObject({ effects: ["calm"], aroma_notes: ["earthy"] });
    expect(rows.find((x) => x.id === "I4")).toMatchObject({ effects: null, aroma_notes: null });
    if (r.ok) expect(r.message).toContain("Filled effects and/or aroma on 2 live cards.");
  });
  it("never overwrites: a card with effects only gets aroma only", async () => {
    st.db.rows("menu_items").push(card("I1", "P1", { effects: ["calm"] }));
    st.db.rows("catalog_product_drafts").push(approved("P1", { effects: fact(["relaxed"], "human"), aroma: fact(["pine"], "human") }));
    await backfill.runMenuSensoryBackfill(client());
    expect(st.db.rows("menu_items")[0]).toMatchObject({ effects: ["calm"], aroma_notes: ["pine"] });
    const patches = st.db.log.filter((q) => q.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url.searchParams.get("aroma_notes")).toBe("is.null");
  });
  it("a racing writer who filled the list first is kept (UPDATE repeats is null) and is not a failure", async () => {
    st.db.rows("menu_items").push(card("I1", "P1"));
    st.db.rows("catalog_product_drafts").push(approved("P1", { effects: fact(["relaxed"], "human") }));
    st.db.before = (req) => {
      if (req.method === "PATCH") st.db.rows("menu_items")[0].effects = ["sleepy"];
    };
    const r = await backfill.runMenuSensoryBackfill(client());
    expect(st.db.rows("menu_items")[0].effects).toEqual(["sleepy"]);
    expect(r).toMatchObject({ ok: true, filled: 0, failed: 0 });
  });
  it("runs every word through the compliance gate (claims and banned phrases never land)", async () => {
    st.banned = [{ phrase: "skunk", severity: "block", reason: "owner" }];
    st.db.rows("menu_items").push(card("I1", "P1"));
    st.db.rows("catalog_product_drafts").push(
      approved("P1", { effects: fact(["relieves pain", "calm"], "human"), aroma: fact(["skunk"], "human") }),
    );
    const r = await backfill.runMenuSensoryBackfill(client());
    expect(st.db.rows("menu_items")[0]).toMatchObject({ effects: ["calm"], aroma_notes: null });
    expect(r).toMatchObject({ ok: true, filled: 1 });
  });
  it("only APPROVED drafts count, and the newest approved answer per product decides", async () => {
    st.db.rows("menu_items").push(card("I1", "P1"));
    st.db.rows("catalog_product_drafts").push(
      approved("P1", { effects: fact(["happy"], "human") }, { status: "draft", updated_at: "2026-09-01T00:00:00Z" }),
      approved("P1", { effects: fact(["calm"], "human") }, { updated_at: "2026-02-01T00:00:00Z" }),
      approved("P1", { effects: fact(["relaxed"], "human") }, { updated_at: "2026-03-01T00:00:00Z" }),
    );
    await backfill.runMenuSensoryBackfill(client());
    expect(st.db.rows("menu_items")[0].effects).toEqual(["relaxed"]);
  });
  it("only the PUBLISHED version is touched", async () => {
    st.db.rows("menu_items").push(card("I1", "P1"), { ...card("I9", "P1"), menu_version_id: "V0" });
    st.db.rows("catalog_product_drafts").push(approved("P1", { effects: fact(["calm"], "human") }));
    await backfill.runMenuSensoryBackfill(client());
    expect(st.db.rows("menu_items").find((x) => x.id === "I9")?.effects).toBeNull();
  });
  it("pre-0254 refuses with the migration named and writes nothing", async () => {
    st.db.before = (req) => (req.method === "GET" && req.table === "menu_items" ? { status: 400, body: PGRST204_EFFECTS } : undefined);
    const r = await backfill.runMenuSensoryBackfill(client());
    expect(r).toEqual({ ok: false, error: expect.stringContaining("migration 0254") });
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
  });
  it("a failed variant / draft read or a failed banned-phrase load refuses with nothing written", async () => {
    st.db.rows("menu_items").push(card("I1", "P1"));
    st.db.rows("catalog_product_drafts").push(approved("P1", { effects: fact(["calm"], "human") }));
    for (const table of ["menu_variants", "catalog_product_drafts"]) {
      st.db.log = [];
      st.db.before = (req) => (req.table === table ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
      const r = await backfill.runMenuSensoryBackfill(client());
      expect(r.ok).toBe(false);
      expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
    }
    st.db.before = null;
    st.db.log = [];
    st.bannedThrows = true;
    const r = await backfill.runMenuSensoryBackfill(client());
    expect(r).toEqual({ ok: false, error: expect.stringContaining("banned phrases") });
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
  });
  it("no published menu refuses plainly", async () => {
    st.version = null;
    expect(await backfill.runMenuSensoryBackfill(client())).toEqual({ ok: false, error: expect.stringContaining("No published menu") });
  });
  it("pressing twice is safe: the second press fills nothing", async () => {
    st.db.rows("menu_items").push(card("I1", "P1"));
    st.db.rows("catalog_product_drafts").push(approved("P1", { effects: fact(["calm"], "human"), aroma: fact(["pine"], "human") }));
    await backfill.runMenuSensoryBackfill(client());
    const r2 = await backfill.runMenuSensoryBackfill(client());
    expect(r2).toMatchObject({ ok: true, filled: 0, alreadyFilled: 1 });
  });
});

// ---------------------------------------------------------------------------
describe("F. wiring pins", () => {
  it("both menu writers spread sensoryRowFields onto the INSERTed row", () => {
    expect(read("src/lib/pos/draft-injection.ts")).toMatch(/\.\.\.sensoryRowFields\(it\.effects, it\.aroma_notes\)/);
    const staging = read("src/lib/pos/intake-menu-staging.ts");
    expect(staging).toMatch(/\.\.\.sensoryRowFields\(it\.effects, it\.aroma_notes\)/);
    // Carry-forward keeps a live card's lists through every re-stage.
    expect(staging).toMatch(/effects: Array\.isArray\(it\.effects\) \? it\.effects : null/);
    expect(staging).toMatch(/aroma_notes: Array\.isArray\(it\.aroma_notes\) \? it\.aroma_notes : null/);
  });
  it("the full-menu select never names the two columns (the public menu works before 0254)", async () => {
    const cols = await import("@/lib/pos/menu-columns-core");
    expect(cols.isMenuItemColumnFetched("effects")).toBe(false);
    expect(cols.isMenuItemColumnFetched("aroma_notes")).toBe(false);
    expect(cols.MENU_ITEM_COLUMNS).not.toMatch(/\beffects\b|aroma_notes/);
  });
  it("the product page reads own-first through resolvePageSensory and keeps the KB fallback", () => {
    const src = read("src/app/menu/products/[id]/page.tsx");
    expect(src).toMatch(/import \{ resolvePageSensory \} from "@\/lib\/menu\/product-sensory-server"/);
    expect(src).toMatch(/resolvePageSensory\(item\.id, \{ effects: knowledge\?\.effects \?\? \[\], aroma: knowledge\?\.aromaNotes \?\? \[\] \}\)/);
    expect(src).toMatch(/const kbEffects = pageSensory\.effects;/);
    expect(src).toMatch(/const kbAroma = pageSensory\.aroma;/);
  });
  it("the owner action requires products.enrich, audits with the pinned action, and the button exists", () => {
    const a = read("src/app/admin/products/actions.ts");
    const fn = a.slice(a.indexOf("export async function fillMenuSensoryAction"));
    expect(fn).toMatch(/requirePermission\("products\.enrich"\)/);
    expect(fn).toMatch(/action: MENU_SENSORY_BACKFILL_AUDIT_ACTION/);
    expect(backfill.MENU_SENSORY_BACKFILL_AUDIT_ACTION).toBe("menu.sensory_backfill");
    const p = read("src/app/admin/products/page.tsx");
    expect(p).toMatch(/action=\{fillMenuSensoryAction\}/);
    expect(p).toContain('data-testid="fill-menu-sensory"');
    expect(p).toContain("Fill effects and aroma on live cards");
  });
  it("the golden-record server gates effects with checkEffects and aroma with lintTerms", () => {
    const s = read("src/lib/catalog/golden-record-server.ts");
    expect(s).toMatch(/sensoryForStorage\(checkEffects\(effects\.values, banned\)\.allowed\)/);
    expect(s).toMatch(/sensoryForStorage\(lintTerms\(aroma\.values, banned\)\.safe\)/);
  });
  it("MIGRATIONS_TO_RUN lists 0253 and 0254 with their rollbacks and the button", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("0253_inventory_expiry_rules.sql");
    expect(d).toContain("0254_menu_item_effects_aroma.sql");
    expect(d).toContain("supabase/rollbacks/0254_menu_item_effects_aroma.rollback.sql");
    expect(d).toContain("Fill effects and aroma on live");
  });
});
