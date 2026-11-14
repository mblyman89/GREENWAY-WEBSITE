/**
 * tests/compliance/d244-r2-strain-potency-edit.test.ts - D244 round 2, slice R-2.
 *
 * Owner (verbatim): "please also include the ai the ability to draft strain
 * type and potency from the lot/ coa, as well as any source available to it
 * to for making drafts. please also include this round the ability to edit a
 * draft directly on the bulk grid." and, for on-hand: "so long as the system
 * thinks we have at least 1 lot in stock, we should consider that to be what
 * I mean by \"on-hand\"."
 *
 * Proven on the REAL generator + REAL actions (provider stubbed) through
 * FakePostgrest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  reply: {} as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  item: null as Record<string, unknown> | null,
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
vi.mock("@/lib/ai/provider", () => ({
  isAiConfigured: true,
  aiModelId: "test-model",
  generateStructured: vi.fn(async (opts: Record<string, unknown>) => {
    st.calls.push(opts);
    return st.reply;
  }),
  generateJSON: vi.fn(),
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "- Blue Dream: hybrid", sources: ["kb:strain:blue dream"], strain: null, category: "flower" }),
}));
vi.mock("@/lib/pos/menu-version", async (orig) => ({
  ...((await orig()) as object),
  getPublishedVersion: async () => ({ id: "v-1" }),
  getItemBySourceKey: async () => st.item,
}));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ userId: "u-1", email: "o@example.com" }) }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: Record<string, unknown>) => void st.audits.push(a) }));
vi.mock("@/lib/ai/kb/writeback", () => ({ writeBackOnPublish: async () => null }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { generateProductAi, acceptAllHighConfidence, acceptSuggestion } from "@/app/admin/products/actions";
import { bulkAcceptEditedAction, bulkRejectDraftAction } from "@/app/admin/products/bulk-ai/actions";
import { parseEvidenceSource } from "@/lib/enrichment/ai-draft-v2-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KEY = "pos-bd";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function run(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) return m.slice(9);
    throw e;
  }
  return "";
}
const meta = (confidence: number, evidence: string[], best_guess = false) => ({ confidence, evidence, best_guess });
const row = (k: string) => st.db.rows("ai_suggestions").find((r) => r.field_key === k)!;
const card = () => st.db.rows("menu_items").find((r) => r.id === "mi-1")!;

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls.length = 0;
  st.audits.length = 0;
  st.item = {
    name: "Phat Panda Blue Dream 3.5g",
    product_name: "Blue Dream",
    brand_name: "Phat Panda",
    vendor_name: "Hollingsworth Cannabis",
    category: "flower",
    strain_type: "unknown",
    strain_name: "Blue Dream",
    thc: null,
    cbd: null,
  };
  st.db.rows("product_enrichments").push({
    id: "e-1",
    pos_product_key: KEY,
    display_name: null,
    description: "Old copy.",
    short_description: null,
    image_media_ids: [],
    primary_media_id: null,
    vendor_id: null,
    tags: [],
    seo_title: null,
    seo_description: null,
    status: "draft",
  });
  // A sold-out older lot and an in-stock newer lot (owner's on-hand rule: in stock first).
  st.db.rows("inventory_lots").push(
    { id: "lot-old", lot_code: "OLD-1", pos_product_key: KEY, strain_type: "sativa", on_hand_qty: 0, lab_result_id: null, created_at: "2025-01-01T00:00:00Z" },
    {
      id: "lot-new",
      lot_code: "NEW-2",
      pos_product_key: KEY,
      strain_type: "indica-hybrid",
      strain_name: "Blue Dream",
      on_hand_qty: 9,
      pos_thc: 24.5,
      pos_cbd: 0.1,
      pos_potency_unit: "%",
      lab_result_id: "lab-1",
      created_at: "2024-12-01T00:00:00Z",
    },
  );
  st.db.rows("lab_results").push({ id: "lab-1", lab_name: "Confidence Analytics", tested_on: "2025-02-01", total_thc_pct: 24.51, total_cbd_pct: 0.08, coa_extract_json: null });
  st.db.rows("menu_versions").push({ id: "v-1", status: "published", import_id: "imp-1" }, { id: "v-2", status: "staged", import_id: null });
  st.db.rows("menu_items").push(
    { id: "mi-1", menu_version_id: "v-1", source_item_id: KEY, strain_type: "unknown", thc: null, cbd: null, fact_provenance: { package_thc_mg: "coa" } },
    { id: "mi-2", menu_version_id: "v-2", source_item_id: KEY, strain_type: "unknown", thc: null, cbd: null, fact_provenance: null },
    { id: "mi-x", menu_version_id: "v-1", source_item_id: "other", strain_type: "sativa", thc: "20%", cbd: null, fact_provenance: null },
  );
  st.reply = {
    display_name: { value: "Phat Panda Blue Dream 3.5g", ...meta(96, ["pos"]) },
    description: { value: "Blue Dream from Phat Panda brings sweet berry aroma in a 3.5 gram jar.", ...meta(90, ["pos"]) },
    short_description: { value: "Sweet berry flower.", ...meta(88, ["pos"]) },
    seo: { title: "Blue Dream 3.5g", meta: "Blue Dream flower from Phat Panda with sweet berry aroma, in a 3.5 gram jar. Order ahead for in-store pickup in Port Orchard today.", ...meta(90, ["pos"]) },
    sensory: { aroma_notes: ["berry"], flavor_notes: ["sweet"], terpenes: [], ...meta(60, ["kb:strain:blue dream"]) },
    effects: { values: ["relaxed"], ...meta(60, ["kb:strain:blue dream"], true) },
    tags: { values: ["local"], ...meta(50, []) },
    strain_type: { value: "indica-hybrid", ...meta(60, ["lot:1", "coa:1"]) },
    potency: { thc: "24.51%", cbd: "0.08%", ...meta(70, ["coa:1"]) },
  };
});

describe("D244 R-2 - strain type + potency drafted from the lot / lab certificate", () => {
  it("offers the in-stock lot and its certificate first, and files strain type + potency", async () => {
    const to = await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    expect(to).toBe(`/admin/products/${KEY}?ai=1#ai`);
    const user = String(st.calls[0]!.user);
    expect(user).toContain("[lot:1] Lot NEW-2 (in stock, 9 on hand): strain type indica-hybrid; strain Blue Dream; manifest potency THC 24.5% CBD 0.1%");
    expect(user).toContain("[coa:1] Lab certificate for lot NEW-2 (Confidence Analytics, tested 2025-02-01): total THC 24.51%; total CBD 0.08%");
    expect(user).toContain("[lot:2] Lot OLD-1 (sold out): strain type sativa");
    expect(user).toContain("never estimate a number");
    expect(row("strain_type").suggested_value).toBe("indica-hybrid");
    // Direct lot/coa evidence calibrates 60 -> 85 (two direct sources).
    expect(row("strain_type").confidence).toBe(0.85);
    expect(row("strain_type").source).toBe("ai2:lot:1,coa:1");
    expect(row("potency").suggested_value).toBe("THC 24.51% · CBD 0.08%");
    expect(row("potency").confidence).toBe(0.8);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_generated" });
  });

  it("a potency number no lab, lot or POS record states is dropped before it is filed", async () => {
    st.reply = { ...st.reply, potency: { thc: "31%", cbd: "0.08%", ...meta(95, ["coa:1"]) } };
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    expect(row("potency").suggested_value).toBe("CBD 0.08%");
    expect(String(row("potency").input_summary)).toContain("dropped (no evidence number): THC 31%");
    st.db.rows("ai_suggestions").length = 0;
    st.reply = { ...st.reply, potency: { thc: "29%", cbd: "", ...meta(95, ["coa:1"]) } };
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    expect(st.db.rows("ai_suggestions").some((r) => r.field_key === "potency")).toBe(false);
  });

  it("Accept all writes strain type + potency to the product's own cards (published + staged), stamped reviewer", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    await run(acceptAllHighConfidence(fd({ key: KEY })));
    expect(row("strain_type").status).toBe("accepted");
    expect(row("potency").status).toBe("accepted");
    expect(card()).toMatchObject({
      strain_type: "indica-hybrid",
      thc: "24.51%",
      cbd: "0.08%",
      total_thc_json: { type: "thc", value: "24.51", unit: "%" },
      fact_provenance: { package_thc_mg: "coa", strain_type: "reviewer", thc: "reviewer", cbd: "reviewer" },
    });
    expect(st.db.rows("menu_items").find((r) => r.id === "mi-2")!.strain_type).toBe("indica-hybrid");
    // Another product's card is never touched.
    expect(st.db.rows("menu_items").find((r) => r.id === "mi-x")).toMatchObject({ strain_type: "sativa", thc: "20%" });
  });

  it("a GUESSED potency is never taken by Accept all (it waits for a person)", async () => {
    st.db.rows("lab_results").length = 0;
    st.item = { ...st.item!, thc: "22%" };
    st.reply = { ...st.reply, potency: { thc: "22%", cbd: "", ...meta(60, ["kb:strain:blue dream"], true) } };
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    expect(parseEvidenceSource(String(row("potency").source)).bestGuess).toBe(true);
    await run(acceptAllHighConfidence(fd({ key: KEY })));
    expect(row("potency").status).toBe("pending");
    expect(card().thc).toBeNull();
  });
});

describe("D244 R-2 - edit a draft directly on the bulk grid", () => {
  it("Save & accept with a typed edit saves the person's text, marks it edited + checked and keeps the filters", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    const id = String(row("description").id);
    const to = await run(
      bulkAcceptEditedAction(fd({ id, key: KEY, vendor_filter: "Hollingsworth Cannabis", min: "70", editedValue: "Hand-written copy about sweet berry Blue Dream." })),
    );
    expect(to).toBe(
      `/admin/products/bulk-ai?vendor=Hollingsworth+Cannabis&min=70&accepted_note=${encodeURIComponent("Saved your edit and accepted it (description).")}#product-${KEY}`,
    );
    expect(st.db.rows("product_enrichments")[0]!.description).toBe("Hand-written copy about sweet berry Blue Dream.");
    const r = row("description");
    expect(r.status).toBe("accepted");
    expect(r.suggested_value).toBe("Hand-written copy about sweet berry Blue Dream.");
    expect(parseEvidenceSource(String(r.source))).toMatchObject({ edited: true, checked: true });
    expect(st.audits.at(-1)).toMatchObject({
      action: "product.bulk_ai_accepted",
      entityId: KEY,
      after: { via: "grid", field: "description", edited: true, original: "Blue Dream from Phat Panda brings sweet berry aroma in a 3.5 gram jar." },
    });
  });

  it("an untouched box is a plain accept; an edit fails the same compliance gate as a draft", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    const sid = String(row("short_description").id);
    await run(bulkAcceptEditedAction(fd({ id: sid, key: KEY, editedValue: "Sweet berry flower." })));
    expect(row("short_description")).toMatchObject({ status: "accepted", source: "ai2:pos" });
    const did = String(row("description").id);
    const to = await run(bulkAcceptEditedAction(fd({ id: did, key: KEY, editedValue: "This flower cures anxiety and treats pain." })));
    expect(decodeURIComponent(to)).toContain("compliance re-scan");
    expect(to.endsWith(`#draft-${did}`)).toBe(true);
    expect(row("description").status).toBe("pending");
    expect(st.db.rows("product_enrichments")[0]!.description).toBe("Old copy.");
  });

  it("typed strain type / potency / tags / effects are read back into their shape and checked", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    await run(bulkAcceptEditedAction(fd({ id: String(row("strain_type").id), key: KEY, editedValue: "sativa dominant hybrid" })));
    expect(card()).toMatchObject({ strain_type: "sativa-hybrid", fact_provenance: { strain_type: "reviewer" } });
    const bad = await run(bulkAcceptEditedAction(fd({ id: String(row("potency").id), key: KEY, editedValue: "THC 140%" })));
    expect(decodeURIComponent(bad)).toContain("over the limit");
    await run(bulkAcceptEditedAction(fd({ id: String(row("potency").id), key: KEY, editedValue: "thc 25.2 %, cbd 0.1%" })));
    expect(card()).toMatchObject({ thc: "25.2%", cbd: "0.1%" });
    const tag = await run(bulkAcceptEditedAction(fd({ id: String(row("tags").id), key: KEY, editedValue: "local, best-ever" })));
    expect(decodeURIComponent(tag)).toContain("Not an allowed tag: best-ever");
    const eff = await run(bulkAcceptEditedAction(fd({ id: String(row("effects").id), key: KEY, editedValue: "relaxed, cures insomnia" })));
    expect(decodeURIComponent(eff)).toContain("Not allowed as an effect");
    expect(row("effects").status).toBe("pending");
  });

  it("Reject on the grid rejects one draft; the product page's edit box uses the same path", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    await run(bulkRejectDraftAction(fd({ id: String(row("tags").id), min: "50" })));
    expect(row("tags").status).toBe("rejected");
    const to = await run(acceptSuggestion(fd({ id: String(row("display_name").id), key: KEY, editedValue: "Blue Dream 3.5g - Phat Panda" })));
    expect(to).toBe(`/admin/products/${KEY}?saved=1#ai`);
    expect(st.db.rows("product_enrichments")[0]!.display_name).toBe("Blue Dream 3.5g - Phat Panda");
    expect(parseEvidenceSource(String(row("display_name").source)).edited).toBe(true);
  });
});

describe("D244 R-2 wiring pins", () => {
  it("the grid and the product page carry the edit box; the help says how it works", () => {
    const g = read("src/app/admin/products/bulk-ai/page.tsx");
    expect(g).toContain('data-testid="bulk-v2-edit"');
    expect(g).toContain('data-testid="bulk-v2-save-accept"');
    expect(g).toContain("formAction={bulkRejectDraftAction}");
    expect(g).toContain("Type over any draft right in its box, then press Save & accept (or Reject).");
    const d = read("src/app/admin/products/[key]/page.tsx");
    expect(d).toContain('data-testid={ev.v2 ? "ai-edit-form" : undefined}');
    expect(d).toContain("defaultValue={editText(s.field_key, s.suggested_value)}");
  });
  it("potency is never auto-accepted as a guess; lots + certificates are direct evidence", () => {
    const c = read("src/lib/enrichment/ai-draft-v2-core.ts");
    expect(c).toContain('export const NEVER_AUTO_GUESS: ReadonlySet<string> = new Set(["potency"]);');
    expect(c).toContain('id.startsWith("lot:") ||');
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("lot-evidence-core", __runLotEvidenceTests(), 26);');
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("draft-edit-core", __runDraftEditTests(), 21);');
  });
});
