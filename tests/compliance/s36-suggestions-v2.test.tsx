/**
 * tests/compliance/s36-suggestions-v2.test.tsx   (bible S36 — Suggestions v2)
 *
 * Explainable additive match weights, negative evidence, and remembered
 * rejections that re-open on change, proven four ways:
 *   1. the pure core's embedded self-tests (exact count, registered);
 *   2. the STORE against FakePostgrest through the real postgrest-js client:
 *      a real published menu → scored suggestions with their waterfall saved
 *      in evidence_json; same-name cards from two vendors are never Strong;
 *      a medical card never joins an adult group; an alias-resolved strain is
 *      Strong; Reject writes one pair row per member pair; the next run holds
 *      them back; changing one card's sizes re-opens exactly its pairs;
 *      everything is no-op-safe before 0243 (missing table / column);
 *      a real read/write failure is never mistaken for "not migrated";
 *   3. AI is only a Review-band second opinion and never changes a score;
 *   4. the REAL page and actions: band badge, waterfall, reject help, banners.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  ai: false,
  aiCalls: [] as string[],
  aiAnswer: { should_group: true, display_name: "x", member_keys: [] as string[], rationale: "Same grower and cultivar.", confidence: 0.99 },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/ai/provider", () => {
  class AiNotConfiguredError extends Error {}
  return {
    get isAiConfigured() {
      return st.ai;
    },
    AiNotConfiguredError,
    generateStructured: async (o: { user: string }) => {
      st.aiCalls.push(o.user);
      return st.aiAnswer;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) throw err;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/admin/products/masters",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "00000000-0000-4000-8000-0000000000aa", email: "o@x", profile: { role: "owner" } }),
}));
const audits = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void audits.push(e) }));

import { __runMatchWeightsCoreTests, readEvidence, pairFingerprint, BAND_LIKELY, REJECT_HELP } from "@/lib/products/match-weights-core";
import { generateGroupingSuggestions, rejectSuggestion, loadPairDecisions } from "@/lib/products/masters-store";
import { toMatchRecord } from "@/lib/products/masters-cluster";
import MastersPage from "@/app/admin/products/masters/page";
import { rejectSuggestionAction, generateSuggestions } from "@/app/admin/products/masters/actions";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const REVIEWER = "00000000-0000-4000-8000-0000000000aa";

let seq = 0;
function seedVersion() {
  st.db.rows("menu_versions").push({ id: "v-live", status: "published", item_count: 9 }, { id: "v-old", status: "archived", item_count: 1 });
}
function card(id: string, over: Record<string, unknown> = {}, sizes: Array<[string, number, boolean?]> = []) {
  seq += 1;
  st.db.rows("menu_items").push({
    id,
    menu_version_id: "v-live",
    source_item_id: `K-${id}`,
    name: `Card ${id}`,
    product_name: null,
    brand_name: "Acme",
    vendor_name: "Acme Farms",
    category: "flower",
    strain_type: "hybrid",
    strain_name: "Gelato",
    thc: "24%",
    hidden: false,
    sort_order: seq,
    price_minor_units: sizes[0]?.[1] ?? 1000,
    ...over,
  });
  sizes.forEach(([label, price, medical], i) =>
    st.db.rows("menu_variants").push({
      id: `${id}-v${i}`,
      menu_item_id: id,
      source_variant_id: `${id}-v${i}`,
      label,
      price_minor_units: price,
      inventory_level: 3,
      medical: !!medical,
      sort_order: i,
    }),
  );
}
/** Three sizes of one Acme Gelato. */
function seedGelato() {
  seedVersion();
  card("a", { name: "Gelato 1g" }, [["1g", 1200]]);
  card("b", { name: "Gelato 3.5g" }, [["3.5g", 3500]]);
  card("c", { name: "Gelato 7g" }, [["7g", 6300]]);
}
const suggestions = () => st.db.rows("product_master_suggestions");
const keysOf = (s: Record<string, unknown>) =>
  (s.members_json as Array<{ pos_product_key: string }>).map((m) => m.pos_product_key).sort();

beforeEach(() => {
  st.db = new FakePostgrest();
  st.ai = false;
  st.aiCalls = [];
  audits.length = 0;
  seq = 0;
});

// ---------------------------------------------------------------------------
describe("S36 match-weights-core self-tests", () => {
  it("runs every embedded assertion (exact count, matches the runner floor)", () => {
    const r = __runMatchWeightsCoreTests();
    expect(r).toEqual({ passed: 130, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("match-weights-core", __runMatchWeightsCoreTests(), 130);');
  });
});

// ---------------------------------------------------------------------------
describe("S36 store — scored generation", () => {
  it("three sizes of one product from one vendor: ONE Strong suggestion with its waterfall saved", async () => {
    seedGelato();
    const r = await generateGroupingSuggestions({ generatedBy: REVIEWER });
    expect(r).toMatchObject({ created: 1, migrated: true, suppressed: 0 });
    expect(suggestions()).toHaveLength(1);
    const row = suggestions()[0];
    expect(keysOf(row)).toEqual(["K-a", "K-b", "K-c"]);
    const ev = readEvidence(row.evidence_json);
    expect(ev?.band).toBe("strong");
    expect(ev?.pairs).toHaveLength(3);
    expect(row.confidence).toBe(ev?.probability);
    expect(ev!.probability).toBeGreaterThanOrEqual(0.95);
    const notes = ev!.contributions.map((c) => c.note);
    expect(notes).toEqual(expect.arrayContaining(["same vendor", "same brand", "same strain name (not verified)", "different sizes"]));
    expect(String(row.rationale)).toMatch(/^Same vendor, same brand/);
    expect(row.status).toBe("pending");
    expect(row.generated_by).toBe(REVIEWER);
  });

  it("an alias-resolved strain (kb_strains) scores higher and says 'verified'", async () => {
    seedVersion();
    st.db.rows("kb_strains").push({ slug: "gelato-33", name: "Gelato #33", aliases: ["gelato 33", "larry bird"], active: true });
    card("a", { name: "Gelato #33 1g", strain_name: "Gelato #33" }, [["1g", 1200]]);
    card("b", { name: "Larry Bird 3.5g", strain_name: "Larry Bird" }, [["3.5g", 3500]]);
    await generateGroupingSuggestions();
    const ev = readEvidence(suggestions()[0].evidence_json)!;
    expect(ev.band).toBe("strong");
    expect(ev.contributions.find((c) => c.field === "strain")?.note).toBe("same strain (verified)");
  });

  it("the same card name from two different vendors (and brands) is never proposed as Strong or Likely", async () => {
    seedVersion();
    card("a", { name: "Blue Dream 1g", strain_name: "Blue Dream", vendor_name: "Acme Farms", brand_name: "Acme" }, [["1g", 1200]]);
    card("b", { name: "Blue Dream 3.5g", strain_name: "Blue Dream", vendor_name: "Zen Growers", brand_name: "Zen" }, [["3.5g", 3500]]);
    await generateGroupingSuggestions();
    for (const s of suggestions()) expect(readEvidence(s.evidence_json)!.probability).toBeLessThan(BAND_LIKELY);
  });

  it("same brand through two vendors is not Strong (vendor disagreement subtracts)", async () => {
    seedVersion();
    card("a", { name: "Gelato 1g", vendor_name: "Acme Farms" }, [["1g", 1200]]);
    card("b", { name: "Gelato 3.5g", vendor_name: "Northwest Distro" }, [["3.5g", 3500]]);
    await generateGroupingSuggestions();
    for (const s of suggestions()) expect(readEvidence(s.evidence_json)!.band).not.toBe("strong");
  });

  it("a medical card never joins the adult group", async () => {
    seedGelato();
    card("m", { name: "Gelato 14g" }, [["14g", 11000, true]]);
    await generateGroupingSuggestions();
    for (const s of suggestions()) expect(keysOf(s)).not.toContain("K-m");
    expect(suggestions().some((s) => keysOf(s).join() === "K-a,K-b,K-c")).toBe(true);
  });

  it("the same size twice subtracts (shown as a minus line)", async () => {
    seedVersion();
    card("a", { name: "Gelato 3.5g" }, [["3.5g", 3500]]);
    card("b", { name: "Gelato 3.5g batch 2" }, [["3.5g", 3600]]);
    await generateGroupingSuggestions();
    const ev = readEvidence(suggestions()[0]?.evidence_json);
    const line = ev?.contributions.find((c) => c.field === "sizes");
    expect(line?.note).toBe("same size twice");
    expect(line!.weight).toBeLessThan(0);
    expect(ev!.band).not.toBe("strong");
  });

  it("cards already in a master are not proposed; an identical pending set is not proposed twice", async () => {
    seedGelato();
    st.db.rows("product_master_members").push({ id: "mm1", master_id: "m1", pos_product_key: "K-c" });
    await generateGroupingSuggestions();
    expect(suggestions().map(keysOf)).toEqual([["K-a", "K-b"]]);
    const again = await generateGroupingSuggestions();
    expect(again.created).toBe(0);
    expect(suggestions()).toHaveLength(1);
  });

  it("toMatchRecord: license suffix stripped from the vendor; sizes from variants; % THC only", () => {
    const rec = toMatchRecord(
      { key: "k", name: "X 1g", brand: "B", category: "flower", strainName: "X", priceMinor: 1, vendor: "CERES - 435011", strainType: "Indica", thc: "100mg", sizes: [{ label: "1 G", priceMinor: 1500 }] },
      { brandIdentity: "b", categoryFamily: "flower", strainIdentity: "x", strainVerified: false, market: "adult" },
    );
    expect(rec).toMatchObject({ vendor: "ceres", strainType: "indica", thcPct: null, sizes: ["1g"], pricePerGramMinor: 1500, brand: "b" });
    const fallback = toMatchRecord(
      { key: "k", name: "X 3.5g", brand: "", category: "flower", strainName: null, priceMinor: 3500 },
      { brandIdentity: "unknown-brand", categoryFamily: "flower", strainIdentity: "x", strainVerified: false, market: "medical" },
    );
    expect(fallback).toMatchObject({ vendor: "", brand: "", sizes: ["3.5g"], pricePerGramMinor: 1000, market: "medical", strainType: null });
  });
});

// ---------------------------------------------------------------------------
describe("S36 store — remembered rejections re-open on change", () => {
  it("Reject writes one pair row per member pair with the scored fingerprint; the next run holds them back", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const s = suggestions()[0];
    const ev = readEvidence(s.evidence_json)!;
    const r = await rejectSuggestion(String(s.id), REVIEWER);
    expect(r).toEqual({ ok: true, remembered: 3, migrated: true });
    const rows = st.db.rows("product_master_pair_decisions");
    expect(rows.map((x) => `${x.key_a}|${x.key_b}`).sort()).toEqual(["K-a|K-b", "K-a|K-c", "K-b|K-c"]);
    for (const x of rows) {
      expect(String(x.key_a) < String(x.key_b)).toBe(true);
      expect(x.decision).toBe("not_a_match");
      expect(x.decided_by).toBe(REVIEWER);
      expect(x.fingerprint).toBe(ev.pairs.find((p) => [p.a, p.b].sort().join() === [x.key_a, x.key_b].join())?.fingerprint);
    }
    expect(s.status).toBe("rejected");
    expect(s.reviewed_by).toBe(REVIEWER);

    const again = await generateGroupingSuggestions();
    expect(again).toMatchObject({ created: 0, suppressed: 3 });
    expect(suggestions()).toHaveLength(1);
  });

  it("changing one card's sizes re-opens exactly its pairs; the untouched rejected pair stays apart", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    // Card c now also sells a 14g: its fingerprint changes.
    st.db.rows("menu_variants").push({ id: "c-v1", menu_item_id: "c", source_variant_id: "c-v1", label: "14g", price_minor_units: 11000, inventory_level: 1, medical: false, sort_order: 1 });
    const r = await generateGroupingSuggestions();
    expect(r.created).toBe(1);
    const fresh = suggestions()[1];
    expect(keysOf(fresh)).toContain("K-c");
    expect(keysOf(fresh)).toHaveLength(2);
    for (const s of suggestions().slice(1)) expect(keysOf(s).includes("K-a") && keysOf(s).includes("K-b")).toBe(false);
  });

  it("a fingerprint that no longer matches is not a suppression (stale row from an older card)", async () => {
    seedGelato();
    st.db.rows("product_master_pair_decisions").push({ key_a: "K-a", key_b: "K-b", decision: "not_a_match", fingerprint: "fp1#stale" });
    const r = await generateGroupingSuggestions();
    expect(r.suppressed).toBe(0);
    expect(keysOf(suggestions()[0])).toEqual(["K-a", "K-b", "K-c"]);
  });

  it("a matching fingerprint suppresses even inside a larger group (cannot-link through a third card)", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const ev = readEvidence(suggestions()[0].evidence_json)!;
    const ac = ev.pairs.find((p) => [p.a, p.b].sort().join() === "K-a,K-c")!;
    st.db.tables.set("product_master_suggestions", []);
    st.db.rows("product_master_pair_decisions").push({ key_a: "K-a", key_b: "K-c", decision: "not_a_match", fingerprint: ac.fingerprint });
    await generateGroupingSuggestions();
    for (const s of suggestions()) expect(keysOf(s).includes("K-a") && keysOf(s).includes("K-c")).toBe(false);
    expect(suggestions()).toHaveLength(1);
  });

  it("the fingerprint the store writes is the core's pairFingerprint of the two records", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const ev = readEvidence(suggestions()[0].evidence_json)!;
    const p = ev.pairs.find((x) => [x.a, x.b].sort().join() === "K-a,K-b")!;
    const id = { brandIdentity: "acme", categoryFamily: "flower", strainIdentity: "gelato", strainVerified: false, market: "adult" };
    const a = toMatchRecord({ key: "K-a", name: "Gelato 1g", brand: "Acme", category: "flower", strainName: "Gelato", priceMinor: 1200, vendor: "Acme Farms", sizes: [{ label: "1g", priceMinor: 1200 }] }, id);
    const b = toMatchRecord({ key: "K-b", name: "Gelato 3.5g", brand: "Acme", category: "flower", strainName: "Gelato", priceMinor: 3500, vendor: "Acme Farms", sizes: [{ label: "3.5g", priceMinor: 3500 }] }, id);
    expect(p.fingerprint).toBe(pairFingerprint(a, b));
  });

  it("the SAME set re-opens after a change: a rejected S36 row does not block its set once a card changes", async () => {
    seedVersion();
    card("a", { name: "Gelato 1g" }, [["1g", 1200]]);
    card("b", { name: "Gelato 3.5g" }, [["3.5g", 3500]]);
    await generateGroupingSuggestions();
    expect(keysOf(suggestions()[0])).toEqual(["K-a", "K-b"]);
    await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    expect(await generateGroupingSuggestions()).toMatchObject({ created: 0, suppressed: 1 });
    st.db.rows("menu_variants").push({ id: "b-v1", menu_item_id: "b", source_variant_id: "b-v1", label: "7g", price_minor_units: 6300, inventory_level: 1, medical: false, sort_order: 1 });
    const r = await generateGroupingSuggestions();
    expect(r).toMatchObject({ created: 1, suppressed: 0 });
    expect(keysOf(suggestions()[1])).toEqual(["K-a", "K-b"]);
    expect(suggestions()[1].status).toBe("pending");
  });

  it("Reject stores keys in byte order even when the saved evidence lists them reversed", async () => {
    seedVersion();
    await generateGroupingSuggestions();
    const ev = { v: 1, band: "strong", probability: 0.97, weight: 5, prior: -6.63, contributions: [], pairs: [{ a: "K-b", b: "K-a", fingerprint: "fp1#x", probability: 0.97 }], ai: null };
    suggestions().push({ id: "rev", display_name: "G", members_json: [{ pos_product_key: "K-b", name: "b", variant_label: null }, { pos_product_key: "K-a", name: "a", variant_label: null }], status: "pending", confidence: 0.97, evidence_json: ev });
    expect(await rejectSuggestion("rev", REVIEWER)).toMatchObject({ ok: true, remembered: 1 });
    expect(st.db.rows("product_master_pair_decisions").map((x) => [x.key_a, x.key_b])).toEqual([["K-a", "K-b"]]);
  });

  it("Reject of a pair already remembered with an OLD fingerprint updates it in place (upsert on the primary key)", async () => {
    st.db.uniques.push({ table: "product_master_pair_decisions", name: "product_master_pair_decisions_pkey", columns: ["key_a", "key_b"] });
    seedGelato();
    st.db.rows("product_master_pair_decisions").push({ key_a: "K-a", key_b: "K-b", decision: "not_a_match", fingerprint: "fp1#stale" });
    await generateGroupingSuggestions();
    const ev = readEvidence(suggestions()[0].evidence_json)!;
    const r = await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    expect(r).toMatchObject({ ok: true, remembered: 3 });
    const ab = st.db.rows("product_master_pair_decisions").filter((x) => x.key_a === "K-a" && x.key_b === "K-b");
    expect(ab).toHaveLength(1);
    expect(ab[0].fingerprint).toBe(ev.pairs.find((p) => [p.a, p.b].sort().join() === "K-a,K-b")!.fingerprint);
  });

  it("a rejected suggestion made BEFORE S36 (no evidence) keeps blocking its exact set", async () => {
    seedGelato();
    suggestions().push({ id: "old", display_name: "Gelato", members_json: ["K-a", "K-b", "K-c"].map((k) => ({ pos_product_key: k, name: k, variant_label: null })), status: "rejected", confidence: 0.9 });
    const r = await generateGroupingSuggestions();
    expect(r.created).toBe(0);
  });

  it("rejecting a suggestion that is not pending changes nothing", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const id = String(suggestions()[0].id);
    await rejectSuggestion(id, REVIEWER);
    const n = st.db.rows("product_master_pair_decisions").length;
    expect(await rejectSuggestion(id, REVIEWER)).toMatchObject({ ok: false, error: "Suggestion already reviewed." });
    expect(await rejectSuggestion("nope", REVIEWER)).toMatchObject({ ok: false, error: "Suggestion not found." });
    expect(st.db.rows("product_master_pair_decisions")).toHaveLength(n);
  });
});

// ---------------------------------------------------------------------------
describe("S36 store — no-op-safe before 0243, honest on real failures", () => {
  it("pair table missing: suggestions still made (migrated:false); Reject still rejects but remembers nothing", async () => {
    seedGelato();
    st.db.missing.add("product_master_pair_decisions");
    const r = await generateGroupingSuggestions();
    expect(r).toMatchObject({ created: 1, migrated: false });
    expect(await loadPairDecisions()).toMatchObject({ ok: true, migrated: false });
    const rej = await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    expect(rej).toEqual({ ok: true, remembered: 0, migrated: false });
    expect(suggestions()[0].status).toBe("rejected");
    // Before 0243 a rejected set keeps blocking its exact set (today's behaviour).
    expect((await generateGroupingSuggestions()).created).toBe(0);
  });

  it("evidence_json column missing: saved WITHOUT the waterfall, after exactly one retry", async () => {
    seedGelato();
    const posts: unknown[] = [];
    st.db.before = (req) => {
      if (req.method === "POST" && req.table === "product_master_suggestions") {
        posts.push(req.body);
        const rows = req.body as Array<Record<string, unknown>>;
        if (rows.some((x) => "evidence_json" in x)) {
          return { status: 400, body: { code: "PGRST204", details: null, hint: null, message: "Could not find the 'evidence_json' column of 'product_master_suggestions' in the schema cache" } };
        }
      }
    };
    const r = await generateGroupingSuggestions();
    expect(r).toMatchObject({ created: 1, migrated: false });
    expect(posts).toHaveLength(2);
    expect(suggestions()).toHaveLength(1);
    expect(suggestions()[0].evidence_json).toBeUndefined();
    expect(suggestions()[0].confidence).toBeGreaterThanOrEqual(0.95);
    expect(String(suggestions()[0].rationale)).toMatch(/^Same vendor/);
  });

  it("any OTHER insert error is thrown, not retried", async () => {
    seedGelato();
    let n = 0;
    st.db.before = (req) => {
      if (req.method === "POST" && req.table === "product_master_suggestions") {
        n += 1;
        return { status: 400, body: { code: "23514", details: null, hint: null, message: "new row violates check constraint" } };
      }
    };
    await expect(generateGroupingSuggestions()).rejects.toThrow("check constraint");
    expect(n).toBe(1);
  });

  it("pair decisions unreadable for a real reason: NO suggestions are made (never propose an unchecked pair)", async () => {
    seedGelato();
    st.db.before = (req) => {
      if (req.table === "product_master_pair_decisions") return { status: 500, body: { code: "57014", message: "canceling statement due to statement timeout" } };
    };
    await expect(generateGroupingSuggestions()).rejects.toThrow(/rejections could not be read/);
    expect(suggestions()).toHaveLength(0);
  });

  it("pair write fails for a real reason: the suggestion stays PENDING (nothing half-done)", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    st.db.before = (req) => {
      if (req.table === "product_master_pair_decisions" && req.method === "POST") return { status: 500, body: { code: "57014", message: "timeout" } };
    };
    const r = await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    expect(r).toMatchObject({ ok: false, remembered: 0 });
    expect(suggestions()[0].status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
describe("S36 — AI is a Review-band second opinion only", () => {
  it("Strong suggestions never call the AI", async () => {
    seedGelato();
    st.ai = true;
    const r = await generateGroupingSuggestions();
    expect(st.aiCalls).toHaveLength(0);
    expect(r.aiUsed).toBe(false);
  });

  it("a Review suggestion gets the note but keeps its rule score and band", async () => {
    seedVersion();
    // Same brand, no vendor on either card, unverified strain, no strain type/THC, price per gram agrees: lands in Review (P ~0.62).
    card("a", { name: "GMO 1g", strain_name: "GMO", strain_type: "unknown", thc: null, vendor_name: null }, [["1g", 1200]]);
    card("b", { name: "GMO 3.5g", strain_name: "GMO", strain_type: "unknown", thc: null, vendor_name: null }, [["3.5g", 3500]]);
    st.ai = false;
    await generateGroupingSuggestions();
    const before = readEvidence(suggestions()[0].evidence_json)!;
    expect(before.band).toBe("review");
    st.db.tables.set("product_master_suggestions", []);
    st.ai = true;
    st.aiAnswer = { ...st.aiAnswer, should_group: false, confidence: 0.99, rationale: "Different price tiers." };
    await generateGroupingSuggestions();
    const after = readEvidence(suggestions()[0].evidence_json)!;
    expect(st.aiCalls).toHaveLength(1);
    expect(after.ai).toEqual({ agrees: false, note: "Different price tiers." });
    expect(after.probability).toBe(before.probability);
    expect(after.band).toBe("review");
    expect(suggestions()[0].confidence).toBe(before.probability);
    expect(suggestions()[0].model).toBe("ai-tiebreak");
    // An AGREEING answer is also only a note: band and score stay the rule's.
    st.db.tables.set("product_master_suggestions", []);
    st.aiAnswer = { ...st.aiAnswer, should_group: true, confidence: 0.99, rationale: "Same grower." };
    await generateGroupingSuggestions();
    const agreed = readEvidence(suggestions()[0].evidence_json)!;
    expect(agreed.ai).toEqual({ agrees: true, note: "Same grower." });
    expect(agreed.band).toBe("review");
    expect(agreed.probability).toBe(before.probability);
  });

  it("source: the store never reads the model's confidence and the AI never creates a suggestion", () => {
    const src = read("src/lib/products/masters-store.ts");
    const gen = src.slice(src.indexOf("export async function generateGroupingSuggestions"), src.indexOf("// Accept / reject + manual master mutations"));
    expect(gen).not.toMatch(/result\.confidence/);
    expect(gen).not.toMatch(/result\.member_keys/);
    expect(gen).toContain('if (isAiConfigured && reviewRows.length > 0) {');
    expect(gen).not.toMatch(/0\.97|0\.9\b/);
  });
});

// ---------------------------------------------------------------------------
describe("S36 page + actions", () => {
  async function renderPage(sp: Record<string, string> = {}) {
    const el = await MastersPage({ searchParams: Promise.resolve(sp) });
    return renderToStaticMarkup(el);
  }

  it("a scored suggestion shows 'Strong · n%', the waterfall lines and the reject help", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const html = await renderPage({ tab: "suggestions" });
    const ev = readEvidence(suggestions()[0].evidence_json)!;
    expect(html).toContain(`Strong · ${Math.round(ev.probability * 100)}%`);
    expect(html).toContain('data-testid="suggestion-waterfall"');
    expect(html).toMatch(/\+1\.7 same vendor/);
    expect(html).toMatch(/\+2\.9 same strain name \(not verified\)/);
    expect(html).toContain(REJECT_HELP);
    expect(REJECT_HELP).toBe("Rejected pairs stay hidden until one of them changes (vendor, brand, strain, market or size).");
    expect(html).toContain("weakest of 3 pairs shown");
    // Biggest pushes first: +2.9 strain line before +1.7 vendor before +1.5 brand.
    const iStrain = html.indexOf("+2.9 same strain name");
    const iVendor = html.indexOf("+1.7 same vendor");
    const iBrand = html.indexOf("+1.5 same brand");
    expect(iStrain).toBeGreaterThan(-1);
    expect(iStrain).toBeLessThan(iVendor);
    expect(iVendor).toBeLessThan(iBrand);
    expect(html).not.toContain("exact name");
  });

  it("a minus line is shown with a real minus sign", async () => {
    seedVersion();
    card("a", { name: "Gelato 3.5g" }, [["3.5g", 3500]]);
    card("b", { name: "Gelato 3.5g b" }, [["3.5g", 3600]]);
    await generateGroupingSuggestions();
    const html = await renderPage({ tab: "suggestions" });
    expect(html).toContain("\u22122.6 same size twice");
  });

  it("an older suggestion (no evidence) keeps its saved reason and percent", async () => {
    seedVersion();
    suggestions().push({ id: "old", display_name: "Old one", members_json: [{ pos_product_key: "K-x", name: "X", variant_label: null }], status: "pending", confidence: 0.9, rationale: "Same brand, category, and product name across multiple sizes/forms.", model: null, created_at: "2025-01-01" });
    const html = await renderPage({ tab: "suggestions" });
    expect(html).toContain("90% match");
    expect(html).toContain("older suggestion");
    expect(html).toContain("Same brand, category, and product name across multiple sizes/forms.");
    expect(html).not.toContain('data-testid="suggestion-waterfall"');
  });

  it("banners say what happened: remembered pairs, not-yet-migrated, suppressed", async () => {
    seedVersion();
    expect(await renderPage({ tab: "suggestions", rejected: "1", remembered: "3" })).toContain("Suggestion rejected. 3 pair(s) will stay hidden until one of the products changes.");
    expect(await renderPage({ tab: "suggestions", rejected: "1", unmigrated: "1" })).toContain("run migration 0243");
    const gen = await renderPage({ tab: "suggestions", generated: "2", clusters: "2", suppressed: "4", unmigrated: "1" });
    expect(gen).toContain("4 pair(s) you rejected stayed hidden.");
    expect(gen).toContain("Migration 0243 is not applied yet");
  });

  it("rejectSuggestionAction: remembers the pairs, audits the count, redirects with it", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    const fd = new FormData();
    fd.set("id", String(suggestions()[0].id));
    await expect(rejectSuggestionAction(fd)).rejects.toThrow("NEXT_REDIRECT /admin/products/masters?tab=suggestions&rejected=1&remembered=3");
    expect(audits.at(-1)).toMatchObject({ action: "product_master.suggestion_rejected", after: { pairs_remembered: 3, migrated: true } });
  });

  it("rejectSuggestionAction before 0243 says so; a failed save is an error, not a success banner", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    st.db.missing.add("product_master_pair_decisions");
    const fd = new FormData();
    fd.set("id", String(suggestions()[0].id));
    await expect(rejectSuggestionAction(fd)).rejects.toThrow("rejected=1&unmigrated=1");
    const fd2 = new FormData();
    fd2.set("id", "missing-id");
    await expect(rejectSuggestionAction(fd2)).rejects.toThrow("error=Suggestion%20not%20found.");
  });

  it("generateSuggestions surfaces suppressed pairs and a read failure as plain messages", async () => {
    seedGelato();
    await generateGroupingSuggestions();
    await rejectSuggestion(String(suggestions()[0].id), REVIEWER);
    await expect(generateSuggestions()).rejects.toThrow("generated=0&clusters=0&suppressed=3");
    st.db.before = (req) => {
      if (req.table === "product_master_pair_decisions") return { status: 500, body: { code: "57014", message: "timeout" } };
    };
    await expect(generateSuggestions()).rejects.toThrow(/error=Your%20earlier%20rejections%20could%20not%20be%20read/);
  });
});

// ---------------------------------------------------------------------------
describe("S36 schema wiring", () => {
  it("0243 is additive, idempotent, RLS on with no policy, ordered pair keys in byte order", () => {
    const sql = read("supabase/migrations/0243_master_suggestions_v2.sql");
    expect(sql).toContain("add column if not exists evidence_json jsonb");
    expect(sql).toContain("create table if not exists public.product_master_pair_decisions");
    expect(sql).toContain("decision text not null check (decision in ('not_a_match'))");
    expect(sql).toContain("fingerprint text not null");
    expect(sql).toContain("primary key (key_a, key_b)");
    expect(sql).toContain('check (key_a < key_b collate "C")');
    expect(sql).toContain("alter table public.product_master_pair_decisions enable row level security;");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
    const rb = read("supabase/rollbacks/0243_master_suggestions_v2.rollback.sql");
    expect(rb).toContain("drop table if exists public.product_master_pair_decisions;");
    expect(rb).toContain("drop column if exists evidence_json");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0243_master_suggestions_v2.sql");
  });

  it("the new table is KEPT by the factory reset and listed in schema-tables", () => {
    expect(read("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "product_master_pair_decisions", disposition: "KEEP"/);
    expect(read("src/lib/admin/schema-tables.ts")).toContain('"product_master_pair_decisions"');
  });
});
