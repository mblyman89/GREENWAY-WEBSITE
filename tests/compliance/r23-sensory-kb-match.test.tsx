/**
 * tests/compliance/r23-sensory-kb-match.test.tsx - R23 owner fixes 3 + 10.
 *
 *   3  "after attaching all the facts I can, checking off all the boxes ...
 *       above it however, it shows a warning, 'Still missing: effects,
 *       terpenes, aroma, flavor.'"
 *  10  The Banana Cream Pie screenshot: KB badge "ENRICHMENT", a 100% KB
 *       suggested match with no actions - "how do we link the suggestions?"
 *
 * Proven on the REAL command center + the REAL attach module through
 * FakePostgrest (only the ladder, media and image resolver are stubbed):
 *   - the Banana Cream Pie shape: rung "enrichment" (no sensory) + a full KB
 *     row -> before the click: four missing AND an open "Sensory facts"
 *     checklist row (header and checklist agree), the match offers "Use
 *     these facts (adds ...)";
 *   - the click: accepted sensory/effects rows (source kb:<id>), the card's
 *     link, a compliance-refused term and effect never written, curated
 *     prose never overwritten;
 *   - after the click: nothing missing, the checklist complete, the match
 *     says "Linked to this card", the origins say "Accepted here";
 *   - each fill layer alone (linked KB, onboarding provenance, strain
 *     library) and the precedence between them;
 *   - every read failing soft, and the refusals (bad id, gone row,
 *     unreadable accepted facts -> nothing written).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  knowledge: null as unknown as Record<string, unknown>,
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
// The ladder is not under test here (menu-knowledge-batch pins it); it
// returns whatever rung the test sets - "enrichment" = the screenshot.
vi.mock("@/lib/ai/kb/product-lookup", () => ({ lookupProductKnowledge: async () => st.knowledge }));
vi.mock("@/lib/enrichment/image-resolver", () => ({ resolveProductImage: async () => null }));
vi.mock("@/lib/ai/kb/image-substitutes", () => ({ resolveSubstituteFor: async () => null }));
vi.mock("@/lib/media/store", () => ({ listMedia: async () => [], resolveMediaUrls: async () => new Map() }));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [] }));

import { getEnrichmentCommandCenter } from "@/lib/enrichment/command-center";
import { attachKbMatchFacts, kbMatchMessage } from "@/lib/enrichment/kb-match-attach";
import { __runSensoryFillCoreTests } from "@/lib/enrichment/sensory-fill-core";
import { checklistComplete } from "@/lib/enrichment/match-core";
import { gapHeadline } from "@/lib/enrichment/gap-vector-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const KEY = "pos-bcp";

const ladder = (over: Record<string, unknown> = {}) => ({
  source: "enrichment",
  displayName: "Banana Cream Pie",
  description: "Our copy.",
  shortDescription: null,
  aromaNotes: [],
  flavorNotes: [],
  terpenes: [],
  effects: [],
  imageMediaIds: ["m1"],
  primaryMediaId: "m1",
  imageHint: "exact",
  needsOnline: false,
  ...over,
});

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: "mi-1",
    menu_version_id: "v",
    source_item_id: KEY,
    name: "Banana Cream Pie",
    product_name: "Banana Cream Pie",
    brand_name: "Easy Peasy",
    vendor_name: "Easy Peasy",
    category: "flower",
    strain_type: "Hybrid",
    strain_name: null,
    description: null,
    pos_inventory_category: null,
    pos_inventory_type: null,
    variants: [],
    ...over,
  }) as unknown as Parameters<typeof getEnrichmentCommandCenter>[0]["item"];

function seedEnrichment(over: Record<string, unknown> = {}) {
  st.db.rows("product_enrichments").push({
    id: "e-1",
    pos_product_key: KEY,
    description: "Our curated copy.",
    short_description: null,
    image_media_ids: ["m1"],
    primary_media_id: "m1",
    brand_id: "b-1",
    tags: ["staff-pick"],
    status: "published",
    kb_product_id: null,
    ...over,
  });
}
function seedKb(over: Record<string, unknown> = {}) {
  st.db.rows("kb_products").push({
    id: KB,
    brand_slug: "easy-peasy",
    product_slug: "easy-peasy-no-stress-just-sesh-flower-banana-cream-pie-28g",
    variant_label: "28 g",
    display_name: "EASY PEASY - NO STRESS, JUST SESH - Flower - Banana Cream Pie - 28g",
    category: "flower",
    aroma_notes: ["Banana", "cream"],
    flavor_notes: ["sweet"],
    terpenes: ["Myrcene", "cure cancer"],
    effects: ["relaxed", "Happy", "pain relief"],
    description: "KB prose.",
    short_description: "Creamy banana flower.",
    image_media_ids: [],
    primary_media_id: null,
    source: "enrichment",
    confidence: null,
    status: "draft",
    active: false,
    updated_at: "2026-04-01T00:00:00Z",
    ...over,
  });
}
const sensoryMissing = (c: Awaited<ReturnType<typeof getEnrichmentCommandCenter>>) =>
  c.gapVector.missing.filter((f) => ["effects", "terpenes", "aroma", "flavor"].includes(f));
const sensoryRow = (c: Awaited<ReturnType<typeof getEnrichmentCommandCenter>>) =>
  c.checklist.find((x) => x.label === "Sensory facts");

// The vendor-menu candidate search uses an or=(ilike...) filter the fake does
// not emulate; vendor candidates are not under test here, so those reads
// answer an honest empty list (otherwise the client retries until timeout).
const vendorMenuEmpty = (req: import("./helpers/fake-postgrest").FakeRequest) =>
  req.method === "GET" && /_menu_items$/.test(req.table) && req.url.searchParams.has("or")
    ? { status: 200, body: [] }
    : undefined;

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.before = vendorMenuEmpty;
  st.knowledge = ladder();
});

describe("R23 sensory-fill-core", () => {
  it("runs exactly 54 assertions, none failing, registered at that floor", () => {
    expect(__runSensoryFillCoreTests()).toEqual({ passed: 54, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("sensory-fill-core", __runSensoryFillCoreTests(), 54);',
    );
  });
});

describe("R23 fix 3 - header and checklist agree", () => {
  it("the screenshot: rung 'enrichment', no layers -> 4 missing AND the Sensory facts row is open", async () => {
    seedEnrichment();
    seedKb();
    const c = await getEnrichmentCommandCenter({ item: item() });
    expect(sensoryMissing(c)).toEqual(["effects", "terpenes", "aroma", "flavor"]);
    const row = sensoryRow(c)!;
    expect(row.done).toBe(false);
    expect(row.detail).toContain("effects, terpenes, aroma, flavor");
    // The bug: "Fully enriched" next to a red header. Now impossible.
    expect(checklistComplete(c.checklist)).toBe(false);
    // The fuzzy suggestion is NOT a fill layer (never guess).
    expect(c.sensoryOrigins).toEqual({});
  });

  it("non-cannabis: no Sensory facts row (the fields do not apply)", async () => {
    seedEnrichment();
    const c = await getEnrichmentCommandCenter({ item: item({ category: "merch" }) });
    expect(sensoryRow(c)).toBeUndefined();
  });

  it("ladder lists are never replaced by a layer", async () => {
    seedEnrichment({ kb_product_id: KB });
    seedKb();
    st.knowledge = ladder({ source: "kb-exact", aromaNotes: ["ladder aroma"] });
    const c = await getEnrichmentCommandCenter({ item: item() });
    expect(c.knowledge.aromaNotes).toEqual(["ladder aroma"]);
    expect(c.sensoryOrigins.aroma).toBeUndefined();
    expect(c.sensoryOrigins.flavor).toBe("Linked KB");
  });
});

describe("R23 fix 10 - the KB suggested match is actionable", () => {
  it("offers 'Use these facts' naming exactly what it adds", async () => {
    seedEnrichment();
    seedKb();
    const c = await getEnrichmentCommandCenter({ item: item() });
    const m = c.kbSuggestions.find((x) => x.candidate.id === KB)!;
    expect(m).toBeDefined();
    expect(m.action).toEqual({
      kind: "use",
      label: "Use these facts (adds effects, terpenes, aroma, flavor and short description)",
    });
  });

  it("the click: compliance-gated accepted facts, the link, curated prose kept; then nothing missing", async () => {
    seedEnrichment();
    seedKb();
    const res = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u-1" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.linked).toBe("linked");
    // "cure cancer" (a blocking claim) and "pain relief" (not an allowed effect) are refused.
    expect(res.plan.refused).toEqual(expect.arrayContaining(["cure cancer", "pain relief"]));
    const acc = st.db.rows("ai_suggestions");
    expect(acc.map((r) => [r.field_key, r.status, r.source, r.reviewed_by])).toEqual([
      ["sensory", "accepted", `kb:${KB}`, "u-1"],
      ["effects", "accepted", `kb:${KB}`, "u-1"],
    ]);
    expect(JSON.parse(String(acc[0]!.suggested_value))).toEqual({ aroma_notes: ["Banana", "cream"], flavor_notes: ["sweet"], terpenes: ["Myrcene"] });
    expect(acc[1]!.suggested_value).toBe("relaxed, happy");
    const e = st.db.rows("product_enrichments")[0]!;
    expect(e.kb_product_id).toBe(KB);
    expect(e.description).toBe("Our curated copy."); // never overwritten
    expect(e.short_description).toBe("Creamy banana flower."); // empty slot filled
    expect(res.message).toContain("Added effects, terpenes, aroma, flavor and short description");
    expect(res.message).toContain("Left out by the compliance check");

    const c = await getEnrichmentCommandCenter({ item: item() });
    expect(sensoryMissing(c)).toEqual([]);
    expect(sensoryRow(c)!.done).toBe(true);
    expect(checklistComplete(c.checklist)).toBe(true);
    expect(gapHeadline(c.gapVector)).not.toMatch(/effects|terpenes|aroma|flavor/);
    expect(c.sensoryOrigins).toEqual({ effects: "Accepted here", terpenes: "Accepted here", aroma: "Accepted here", flavor: "Accepted here" });
    expect(c.gapVector.entries.find((x) => x.field === "aroma")!.seenIn).toBe("Accepted here");
    expect(c.linkedKb).toEqual({ id: KB, displayName: expect.stringContaining("Banana Cream Pie"), status: "draft" });
    expect(c.kbSuggestions.find((x) => x.candidate.id === KB)!.action.kind).toBe("linked");
  });

  it("a second click is idempotent: no new rows, 'already linked'", async () => {
    seedEnrichment();
    seedKb();
    await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u-1" } });
    const before = st.db.rows("ai_suggestions").length;
    const res = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u-1" } });
    expect(res.ok && res.linked).toBe("already");
    expect(st.db.rows("ai_suggestions").length).toBe(before);
    expect(res.ok && res.plan.adds).toEqual([]);
  });

  it("unions with facts the card already accepted (an older aroma is never lost)", async () => {
    seedEnrichment();
    seedKb({ aroma_notes: ["banana"], flavor_notes: [], terpenes: [], effects: [] });
    st.db.rows("ai_suggestions").push({
      id: "s-old",
      entity_type: "product",
      entity_id: KEY,
      field_key: "sensory",
      suggested_value: JSON.stringify({ aroma_notes: ["vanilla"], flavor_notes: ["custard"], terpenes: [] }),
      status: "accepted",
      created_at: "2026-01-01T00:00:00Z",
    });
    await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u-1" } });
    const newest = st.db.rows("ai_suggestions").filter((r) => r.source === `kb:${KB}`);
    expect(newest).toHaveLength(1);
    expect(JSON.parse(String(newest[0]!.suggested_value))).toEqual({ aroma_notes: ["vanilla", "banana"], flavor_notes: ["custard"], terpenes: [] });
  });

  it("pre-0234 (no kb_product_id column): the facts still land, the link is reported as skipped", async () => {
    seedEnrichment();
    seedKb();
    st.db.before = (req) =>
      vendorMenuEmpty(req) ??
      (req.method === "PATCH" && req.table === "product_enrichments" && (req.body as Record<string, unknown>)?.kb_product_id
        ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'kb_product_id' column of 'product_enrichments' in the schema cache" } }
        : undefined);
    const res = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u-1" } });
    expect(res.ok && res.linked).toBe("skipped-pre-0234");
    expect(res.ok && res.message).toContain("0234");
    expect(st.db.rows("ai_suggestions")).toHaveLength(2);
  });

  it("refusals write nothing: bad id, gone row, unreadable KB, unreadable accepted facts", async () => {
    seedEnrichment();
    expect(await attachKbMatchFacts({ posKey: KEY, kbId: "not-a-uuid", actor: { userId: "u" } })).toEqual({ ok: false, error: "That knowledge-base match is not valid." });
    expect(await attachKbMatchFacts({ posKey: " ", kbId: KB, actor: { userId: "u" } })).toEqual({ ok: false, error: "Missing product key." });
    const gone = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u" } });
    expect(gone.ok).toBe(false);
    expect(!gone.ok && gone.error).toContain("no longer exists");
    seedKb();
    st.db.missing.add("ai_suggestions");
    const unread = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u" } });
    expect(!unread.ok && unread.error).toContain("accepted facts could not be read");
    st.db.missing.clear();
    st.db.missing.add("kb_products");
    const kbDown = await attachKbMatchFacts({ posKey: KEY, kbId: KB, actor: { userId: "u" } });
    expect(!kbDown.ok && kbDown.error).toContain("could not be read");
    st.db.missing.clear();
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
    expect(st.db.rows("product_enrichments")[0]!.kb_product_id).toBe(null);
  });

  it("kbMatchMessage covers every link outcome", () => {
    const plan = { sensoryJson: null, effectsCsv: null, description: null, shortDescription: null, adds: [], refused: [] };
    expect(kbMatchMessage("X", plan, "linked")).toBe("\u201cX\u201d had nothing new for this card. The card is now linked to it, so it keeps filling this card's gaps.");
    expect(kbMatchMessage("X", plan, "already")).toContain("already linked");
    expect(kbMatchMessage("X", plan, "failed")).toContain("could not be saved just now");
  });
});

describe("R23 fill layers, one at a time", () => {
  it("onboarding-attached facts (provenance) fill the card and are named", async () => {
    seedEnrichment();
    st.db.rows("product_fact_provenance").push(
      { id: "p1", identity_key: null, pos_product_key: KEY, field: "aroma", value_json: ["citrus"], source: "gemini", confidence: 0.9, created_at: "2026-02-01T00:00:00Z" },
      { id: "p2", identity_key: null, pos_product_key: KEY, field: "effects", value_json: ["calm"], source: "human", confidence: null, created_at: "2026-02-01T00:00:00Z" },
    );
    const c = await getEnrichmentCommandCenter({ item: item() });
    expect(c.knowledge.aromaNotes).toEqual(["citrus"]);
    expect(c.knowledge.effects).toEqual(["calm"]);
    expect(c.sensoryOrigins).toEqual({ aroma: "Attached at onboarding", effects: "Attached at onboarding" });
    // provenance chips win in the header ("attached at onboarding: aroma (Gemini 90%)").
    expect(c.gapVector.entries.find((x) => x.field === "aroma")!.attachedBy).toBe("Gemini 90%");
    expect(sensoryMissing(c)).toEqual(["terpenes", "flavor"]);
  });

  it("the ACTIVE strain library fills last; an inactive strain never does", async () => {
    seedEnrichment();
    st.db.rows("kb_strains").push({ slug: "banana cream pie", aroma_notes: ["banana"], flavor_notes: ["pie"], terpenes: ["limonene"], effects: ["happy"], active: true });
    st.db.rows("kb_strains").push({ slug: "inactive one", aroma_notes: ["x"], flavor_notes: [], terpenes: [], effects: [], active: false });
    const c = await getEnrichmentCommandCenter({ item: item({ strain_name: "  Banana   Cream Pie " }) });
    expect(c.sensoryOrigins).toEqual({ effects: "Strain library", terpenes: "Strain library", aroma: "Strain library", flavor: "Strain library" });
    const c2 = await getEnrichmentCommandCenter({ item: item({ strain_name: "Inactive One" }) });
    expect(c2.sensoryOrigins).toEqual({});
  });

  it("precedence: accepted here > linked KB > onboarding > strain", async () => {
    seedEnrichment({ kb_product_id: KB });
    seedKb({ aroma_notes: ["kb aroma"], flavor_notes: ["kb flavor"], terpenes: [], effects: [] });
    st.db.rows("ai_suggestions").push({ id: "s1", entity_type: "product", entity_id: KEY, field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["mine"] }), status: "accepted", created_at: "2026-03-01T00:00:00Z" });
    st.db.rows("product_fact_provenance").push({ id: "p1", identity_key: null, pos_product_key: KEY, field: "flavor", value_json: ["onb"], source: "gemini", confidence: 0.9, created_at: "2026-02-01T00:00:00Z" });
    st.db.rows("product_fact_provenance").push({ id: "p2", identity_key: null, pos_product_key: KEY, field: "terpenes", value_json: ["onb terp"], source: "gemini", confidence: 0.9, created_at: "2026-02-01T00:00:00Z" });
    st.db.rows("kb_strains").push({ slug: "bcp", aroma_notes: [], flavor_notes: [], terpenes: ["strain terp"], effects: ["calm"], active: true });
    const c = await getEnrichmentCommandCenter({ item: item({ strain_name: "BCP" }) });
    expect(c.knowledge.aromaNotes).toEqual(["mine"]);
    expect(c.knowledge.flavorNotes).toEqual(["kb flavor"]);
    expect(c.knowledge.terpenes).toEqual(["onb terp"]);
    expect(c.knowledge.effects).toEqual(["calm"]);
    expect(c.sensoryOrigins).toEqual({ aroma: "Accepted here", flavor: "Linked KB", terpenes: "Attached at onboarding", effects: "Strain library" });
  });

  it("every layer read failing soft: the page still renders the ladder result", async () => {
    seedEnrichment({ kb_product_id: KB });
    for (const t of ["ai_suggestions", "kb_strains", "product_fact_provenance"]) st.db.missing.add(t);
    const c = await getEnrichmentCommandCenter({ item: item({ strain_name: "BCP" }) });
    expect(c.sensoryOrigins).toEqual({});
    expect(c.linkedKb).toBe(null); // the linked row is not in kb_products
    expect(sensoryMissing(c)).toEqual(["effects", "terpenes", "aroma", "flavor"]);
  });
});

describe("R23 page wiring (source)", () => {
  const page = read("src/app/admin/products/[key]/page.tsx");
  const actions = read("src/app/admin/products/actions.ts");
  it("every KB match row carries the action; the badge is plain English", () => {
    expect(page).toContain('<input type="hidden" name="kbId" value={m.candidate.id} />');
    expect(page).toContain("<form action={attachKbMatchFacts}>");
    expect(page).toContain('data-testid="kb-match-linked"');
    expect(page).toContain("{knowledgeSourceLabel(center.knowledge.source)}");
    expect(page).toContain('data-testid="kb-sensory-origins"');
  });
  it("the action is permission-gated, audited, writes back, and never trusts form values", () => {
    const body = actions.slice(actions.indexOf("export async function attachKbMatchFacts"));
    expect(body).toContain('await requirePermission("products.enrich")');
    expect(body).toContain("action: KB_MATCH_AUDIT_ACTION");
    expect(body).toContain("await writeBackOnPublish(key, session.userId)");
    expect(body.slice(0, body.indexOf("\n}\n"))).not.toMatch(/formData\.get\("(aroma|effects|value|description)"/);
  });
});
