/**
 * tests/compliance/d244-r5-copilot.test.ts - D244 round 2, slice R-5
 * (strategy slice E-6, the Enrichment Copilot).
 *
 * Owner (verbatim): "please finish the last 2 slices." and "a product should
 * be publish once it has a picture. the other important details like
 * description and facts can come later." and "so long as the system thinks
 * we have at least 1 lot in stock, we should consider that to be what I mean
 * by \"on-hand\"."
 *
 * Proven on the REAL actions + REAL accept path (provider stubbed) through
 * FakePostgrest: the chat only proposes (nothing stored), "Use this" passes
 * the same gates as every draft (compliance, potency evidence), and Publish
 * needs a photo and nothing else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  reply: {} as Record<string, unknown>,
  vision: "",
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
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/ai/provider", async (orig) => ({
  ...((await orig()) as object),
  isAiConfigured: true,
  aiModelId: "test-model",
  generateStructured: vi.fn(async (opts: Record<string, unknown>) => {
    st.calls.push(opts);
    return st.reply;
  }),
  generateVisionJson: vi.fn(async (opts: Record<string, unknown>) => {
    st.calls.push(opts);
    return { content: st.vision, model: "vision", usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, real: true } };
  }),
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "- Blue Dream: hybrid", sources: ["kb:strain:blue dream"], strain: null, category: "flower" }),
}));
vi.mock("@/lib/enrichment/image-recommend-v3-server", () => ({
  loadRecommendPanel: async () => ({
    tiles: [
      { id: "m-att", url: "https://cdn/att.jpg", label: "Attached", alt: "", confidence: 99, chips: [], attached: true },
      { id: "m-jar", url: "https://cdn/jar.jpg", label: "Blue Dream jar", alt: "", confidence: 92, chips: ["Same vendor", "3.5g"], attached: false },
    ],
    considered: 2,
    matched: 2,
    emptyText: null,
    libraryOk: true,
    memoryMissing: false,
    identityKey: "phat panda|blue dream",
    vendorId: "ven-1",
  }),
}));
vi.mock("@/lib/pos/menu-version", async (orig) => ({
  ...((await orig()) as object),
  getPublishedVersion: async () => ({ id: "v-1" }),
  getItemBySourceKey: async () => st.item,
}));
vi.mock("@/lib/media/store", async (orig) => ({
  ...((await orig()) as object),
  resolveMediaUrls: async (ids: string[]) => new Map(ids.map((i) => [i, `https://cdn/${i}.jpg`])),
  getMedia: async (id: string) => ({ id, status: "published" }),
  recordUsage: async () => undefined,
}));
vi.mock("@/lib/catalog/image-memory-server", () => ({ rememberImageAttach: async () => ({ ok: true }) }));
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

import {
  copilotAskAction,
  copilotUseProposalAction,
  copilotPublishAction,
  copilotSkipAction,
  copilotAttachPhotoAction,
} from "@/app/admin/products/copilot/actions";
import { COPILOT_SOURCE } from "@/lib/enrichment/copilot-server";

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
    if (m.startsWith("REDIRECT:")) return decodeURIComponent(m.slice(9));
    throw e;
  }
  return "";
}
const empty = { display_name: "", description: "", short_description: "", seo_title: "", seo_meta: "", sensory: "", effects: "", tags: "", strain_type: "", potency: "" };
const enr = () => st.db.rows("product_enrichments").find((r) => r.pos_product_key === KEY)!;
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
    description: null,
    short_description: null,
    image_media_ids: [],
    primary_media_id: null,
    vendor_id: null,
    identity_key: null,
    tags: [],
    seo_title: null,
    seo_description: null,
    status: "draft",
  });
  st.db.rows("inventory_lots").push({
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
  });
  st.db.rows("lab_results").push({ id: "lab-1", lab_name: "Confidence Analytics", tested_on: "2025-02-01", total_thc_pct: 24.51, total_cbd_pct: 0.08, coa_extract_json: null });
  st.db.rows("menu_versions").push({ id: "v-1", status: "published", import_id: "imp-1" });
  st.db.rows("menu_items").push({ id: "mi-1", menu_version_id: "v-1", source_item_id: KEY, strain_type: "unknown", thc: null, cbd: null, fact_provenance: null });
  st.db.rows("media_assets").push({ id: "m-jar", status: "published", storage_key: "jar.jpg" });
  st.reply = {
    reply: "From the lab certificate: Indica-Hybrid, THC 24.51%. Photo 1 is this jar.",
    changes: { ...empty, strain_type: "Indica-Hybrid", potency: "THC 24.51% · CBD 0.08%" },
    why: "[lot:1], [coa:1]",
    photo_pick: 1,
  };
});

describe("D244 R-5 - the chat proposes, it never writes", () => {
  it("one turn: the prompt carries the lot + lab certificate + numbered photos; the answer is proposals; nothing is filed", async () => {
    const out = await copilotAskAction({ turns: [] }, fd({ key: KEY, vendor: "ven-1", message: "Draft the strain type and potency from the lab certificate." }));
    const user = String(st.calls[0]!.user);
    expect(user).toContain("[coa:1] Lab certificate for lot NEW-2");
    expect(user).toContain("## Numbered photo choices on screen\n1. Blue Dream jar (92% match; Same vendor, 3.5g)");
    expect(user).not.toContain("Attached (99%"); // attached photos are not offered again
    expect(user.endsWith("Draft the strain type and potency from the lab certificate.")).toBe(true);
    expect((st.calls[0]!.context as Record<string, unknown>).feature).toBe("product.copilot");
    expect(out.turns).toHaveLength(2);
    expect(out.turns[1]!.answer!.proposals.map((p) => p.field)).toEqual(["strain_type", "potency"]);
    expect(out.turns[1]!.answer!.photoPick).toBe(1);
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.copilot_asked" });
  });

  it("the conversation carries forward (bounded), and a failed turn is not replayed as context", async () => {
    const one = await copilotAskAction({ turns: [] }, fd({ key: KEY, vendor: "ven-1", message: "first" }));
    const two = await copilotAskAction({ turns: [...one.turns, { role: "assistant", content: "boom", error: true }] }, fd({ key: KEY, vendor: "ven-1", message: "second" }));
    const user = String(st.calls[1]!.user);
    expect(user).toContain("Owner: first");
    expect(user).not.toContain("Copilot: boom");
    expect(two.turns.at(-2)!.content).toBe("second");
  });

  it("a starter chip sends its text; an empty message does nothing", async () => {
    const out = await copilotAskAction({ turns: [] }, fd({ key: KEY, vendor: "ven-1", message: "", starter: "Which photo is this product?" }));
    expect(out.turns[0]!.content).toBe("Which photo is this product?");
    const none = await copilotAskAction({ turns: [] }, fd({ key: KEY, vendor: "ven-1", message: "  " }));
    expect(none.turns).toHaveLength(0);
  });

  it("Look closely reads one photo with the vision model and answers in the chat", async () => {
    st.vision = '{"label_text":"Phat Panda Blue Dream 3.5g","brand":"Phat Panda","strain":"Blue Dream","size":"3.5g","format":"jar","matches":"yes","notes":""}';
    const out = await copilotAskAction({ turns: [] }, fd({ key: KEY, vendor: "ven-1", inspect: "m-jar|photo 1" }));
    expect(st.calls[0]!.imageUrl).toBe("https://cdn/m-jar.jpg");
    expect((st.calls[0]!.context as Record<string, unknown>).feature).toBe("product.copilot.inspect");
    expect(out.turns[0]!.content).toBe("Look closely at photo 1.");
    expect(out.turns[1]!.content).toContain("It looks like this product.");
  });
});

describe("D244 R-5 - Use this goes through the same gates as every draft", () => {
  it("strain type: filed as a checked copilot draft and written to the card", async () => {
    const to = await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "strain_type", value: "Indica-Hybrid" })));
    expect(to).toContain("/admin/products/copilot?vendor=ven-1&key=pos-bd&saved=1");
    const s = st.db.rows("ai_suggestions")[0]!;
    expect(s).toMatchObject({ field_key: "strain_type", status: "accepted", source: COPILOT_SOURCE, confidence: 1 });
    expect(card().strain_type).toBe("indica-hybrid");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.copilot_used" });
  });

  it("potency: a number the lab / lot / POS backs is written; one they do not is refused", async () => {
    const bad = await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "potency", value: "THC 31% · CBD 0.08%" })));
    expect(bad).toContain("error=No lab, lot or POS number says THC 31%");
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
    expect(card().thc).toBeNull();
    await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "potency", value: "THC 24.51% · CBD 0.08%" })));
    expect(card().thc).toBe("24.51%");
  });

  it("a medical claim is refused by the compliance re-scan (nothing applied)", async () => {
    const to = await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "description", value: "Blue Dream cures anxiety and treats insomnia." })));
    expect(to).toContain("error=");
    expect(enr().description).toBeNull();
    expect(st.audits.at(-1)).toMatchObject({ action: "product.copilot_use_blocked" });
  });

  it("an unknown field or a bad tag is refused before anything is filed", async () => {
    expect(await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "price", value: "$5" })))).toContain("error=That is not a field");
    expect(await run(copilotUseProposalAction(fd({ key: KEY, vendor: "ven-1", field: "tags", value: "best-seller, cheap" })))).toContain("Not an allowed tag: cheap");
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
  });
});

describe("D244 R-5 - photo first, then publish (owner: publish once it has a picture)", () => {
  it("Publish is refused without a photo", async () => {
    const to = await run(copilotPublishAction(fd({ key: KEY, vendor: "ven-1", nextKey: "pos-next" })));
    expect(to).toContain("error=Attach a photo first.");
    expect(enr().status).toBe("draft");
  });

  it("attaching a recommended photo makes it the cover, and the photo-publish rule runs", async () => {
    const to = await run(copilotAttachPhotoAction(fd({ key: KEY, vendor: "ven-1", mediaId: "m-jar", identityKey: "phat panda|blue dream" })));
    expect(enr()).toMatchObject({ image_media_ids: ["m-jar"], primary_media_id: "m-jar" });
    expect(to).toContain("saved=1");
    expect(st.audits.find((a) => a.action === "product.match_image_attached")).toMatchObject({ after: { source: "copilot", becamePrimary: true } });
  });

  it("with a photo, Publish publishes and moves to the next card", async () => {
    Object.assign(enr(), { image_media_ids: ["m-jar"], primary_media_id: "m-jar" });
    const to = await run(copilotPublishAction(fd({ key: KEY, vendor: "ven-1", nextKey: "pos-next", skip: "a,b" })));
    expect(enr().status).toBe("published");
    expect(to).toContain("vendor=ven-1&key=pos-next&skip=a,b&saved=1");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.published", after: { via: "copilot" } });
  });

  it("Skip moves the card to the back (kept in the URL) and opens the next one", async () => {
    const to = await run(copilotSkipAction(fd({ key: KEY, vendor: "ven-1", nextKey: "pos-next", skip: "a" })));
    expect(to).toBe("/admin/products/copilot?vendor=ven-1&key=pos-next&skip=a,pos-bd");
  });
});

describe("D244 R-5 - wiring", () => {
  const page = read("src/app/admin/products/copilot/page.tsx");
  const chat = read("src/components/admin/products/CopilotChat.tsx");
  it("the page guards on products.enrich, every action too", () => {
    expect(page).toContain('await requirePermission("products.enrich")');
    const actions = read("src/app/admin/products/copilot/actions.ts");
    const exported = actions.match(/export async function \w+/g) ?? [];
    expect(exported.length).toBeGreaterThanOrEqual(9);
    expect(actions.match(/requirePermission\("products\.enrich"\)/g)!.length).toBeGreaterThanOrEqual(exported.length - 0);
  });
  it("every keyboard key has a target on the page", () => {
    for (const k of ['data-copilot-key="p"', 'data-copilot-key="n"', 'data-copilot-key="s"', 'data-copilot-key="d"', 'data-copilot-key="a"', "data-copilot-key={`photo-${p.n}`}"]) expect(page).toContain(k);
    expect(chat).toContain('data-copilot-key="/"');
    expect(read("src/components/admin/products/CopilotKeys.tsx")).toContain("copilotKeyTarget(e, typing)");
  });
  it("Publish is disabled without a photo and says why", () => {
    expect(page).toContain("disabled={!hasImage} title={blocked ??");
  });
  it("the chat's busy buttons are disabled while it thinks", () => {
    expect(chat.match(/disabled=\{pending\}/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it("linked from the worklist vendor strip, the Bulk AI banner, the product page and help", () => {
    const list = read("src/app/admin/products/page.tsx");
    expect(list).toContain('href={copilotUrl({ vendor: currentVendor.id })}');
    expect(list).toContain('href="/admin/products/copilot"');
    expect(read("src/app/admin/products/[key]/page.tsx")).toContain('data-testid="detail-copilot-link"');
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/products/copilot"');
  });
  it("the chat model is AI_COPILOT_MODEL, else the enrichment model", () => {
    expect(read("src/lib/ai/enrich-model.ts")).toContain("enrichModel: process.env.AI_COPILOT_MODEL");
    expect(read(".env.example")).toContain("# AI_COPILOT_MODEL=gpt-6-astra");
  });
});
