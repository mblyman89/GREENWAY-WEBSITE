/**
 * tests/compliance/s37-lot-link.test.tsx   (bible S37 — Inventory fix-everything)
 *
 * The two new lot doors — "Link this lot to a product" and "Attach a lab
 * result" — proven four ways:
 *   1. the pure core's embedded self-tests (exact count, registered in the
 *      pure runner at that floor);
 *   2. the STORE against the in-memory FakePostgrest driven through the real
 *      postgrest-js client: the compare-and-set guard is in the UPDATE (a lot
 *      filled by a racing writer is NOT overwritten), '' counts as blank,
 *      destroyed lots never match, evidence is read from the PUBLISHED
 *      version only, and every read error fails closed;
 *   3. the REAL server actions: every refusal writes nothing and audits
 *      nothing; a success writes provenance + one audit event and redirects
 *      to the door's anchor;
 *   4. the rendered panels: the form field names the actions read, the
 *      refusal states, FAIL / expired warnings shown (never hidden).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  calls: [] as string[],
  audits: [] as { action: string; entityId?: string | null; before?: unknown; after?: unknown }[],
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
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u-owner", email: "o@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: { action: string; entityId?: string | null; before?: unknown; after?: unknown }) => {
    st.audits.push(e);
  },
}));
// getLotById hydrates vendor/brand/lab joins; the action only needs the lot
// row's status / key / lab link, so read the row straight from the fake DB.
vi.mock("@/lib/inventory/store", async (orig) => ({
  ...((await orig()) as object),
  getLotById: async (id: string) => {
    const row = st.db.rows("inventory_lots").find((r) => r.id === id);
    return row ? { ...row } : null;
  },
}));

import {
  __runLotLinkCoreTests,
  refusalMessage,
  coaCandidateView,
} from "@/lib/inventory/lot-link-core";
import {
  loadProductKeyEvidence,
  linkLotProductKey,
  linkLotLabResult,
  labResultExists,
  findLabResultsByLabtestId,
  listDraftHintsForLot,
  COA_SEARCH_LIMIT,
} from "@/lib/inventory/lot-link-store";
import { linkLotProductAction, linkLotCoaAction } from "@/app/admin/inventory/actions";
import {
  LotProductLinkPanel,
  LotCoaAttach,
  PRODUCT_LINK_TITLE,
  COA_ATTACH_TITLE,
} from "@/components/admin/inventory/LotLinkPanels";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const LOT = "lot-1";
const LAB = "aaaaaaaa-1111-4111-8111-111111111111";
const LAB2 = "bbbbbbbb-2222-4222-8222-222222222222";

function lot(over: Record<string, unknown> = {}) {
  return { id: LOT, status: "active", pos_product_key: null, lab_result_id: null, ...over };
}
function seedPublished() {
  st.db.rows("menu_versions").push({ id: "v-live", status: "published" }, { id: "v-draft", status: "staged" });
}
function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const patches = () => st.db.log.filter((r) => r.method === "PATCH");
const lastRedirect = () => st.calls.filter((c) => c.startsWith("redirect:")).pop() ?? "";

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls = [];
  st.audits = [];
});

// ---------------------------------------------------------------------------
// 1. pure core
// ---------------------------------------------------------------------------
describe("S37 lot-link-core self-tests", () => {
  it("runs exactly 59 assertions with none failing", () => {
    expect(__runLotLinkCoreTests()).toEqual({ passed: 59, failed: 0 });
  });
  it("is registered in the pure runner at its exact floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runLotLinkCoreTests } from "../../src/lib/inventory/lot-link-core"');
    expect(runner).toContain('assertRan("lot-link-core", __runLotLinkCoreTests(), 59);');
  });
});

// ---------------------------------------------------------------------------
// 2. store against FakePostgrest
// ---------------------------------------------------------------------------
describe("S37 store — guarded product-key write", () => {
  it("fills a NULL key with owner_entered provenance in one guarded PATCH", async () => {
    st.db.rows("inventory_lots").push(lot());
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: true, linked: true });
    const row = st.db.rows("inventory_lots")[0];
    expect(row.pos_product_key).toBe("K1");
    expect(row.pos_product_key_source).toBe("owner_entered");
    expect(row.pos_product_key_set_by).toBe("u1");
    expect(typeof row.pos_product_key_set_at).toBe("string");
    expect(row.updated_by).toBe("u1");
    expect(patches()).toHaveLength(1);
    const q = patches()[0].url.search;
    expect(q).toContain("id=eq.lot-1");
    expect(q).toContain("status=neq.destroyed");
    expect(q).toContain("pos_product_key=is.null");
  });

  it("treats '' as blank: the second guarded PATCH (= '') fills it", async () => {
    st.db.rows("inventory_lots").push(lot({ pos_product_key: "" }));
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: true, linked: true });
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("K1");
    expect(patches()).toHaveLength(2);
    expect(patches()[1].url.search).toContain("pos_product_key=eq.");
  });

  it("never overwrites an existing key (linked:false, row unchanged)", async () => {
    st.db.rows("inventory_lots").push(lot({ pos_product_key: "OLD" }));
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: true, linked: false });
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("OLD");
    expect(st.db.rows("inventory_lots")[0].pos_product_key_source).toBeUndefined();
  });

  it("never writes a destroyed lot even when its key is blank", async () => {
    st.db.rows("inventory_lots").push(lot({ status: "destroyed" }));
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: true, linked: false });
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBeNull();
  });

  it("loses a race safely: a writer who fills the key first is not overwritten", async () => {
    st.db.rows("inventory_lots").push(lot());
    st.db.before = (req) => {
      if (req.method === "PATCH") {
        st.db.rows("inventory_lots")[0].pos_product_key = "RACER";
        st.db.before = null;
      }
    };
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: true, linked: false });
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("RACER");
  });

  it("surfaces a write error as ok:false", async () => {
    st.db.rows("inventory_lots").push(lot());
    st.db.before = () => ({ status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } });
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r.ok).toBe(false);
  });

  it("a write error on the NULL pass stops: the '' pass never runs, nothing is written", async () => {
    // A lot stored with '' would be filled by the second pass; an error on the
    // first pass must be reported, not skipped over into the second write.
    st.db.rows("inventory_lots").push(lot({ pos_product_key: "" }));
    let n = 0;
    st.db.before = (req) => {
      if (req.method !== "PATCH") return;
      n += 1;
      if (n === 1) return { status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } };
    };
    const r = await linkLotProductKey(LOT, "K1", "u1");
    expect(r).toEqual({ ok: false, error: "boom" });
    expect(patches()).toHaveLength(1);
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("");
  });
});

describe("S37 store — guarded lab-result write", () => {
  it("fills an empty lab_result_id with a guarded PATCH", async () => {
    st.db.rows("inventory_lots").push(lot());
    expect(await linkLotLabResult(LOT, LAB, "u1")).toEqual({ ok: true, linked: true });
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe(LAB);
    const q = patches()[0].url.search;
    expect(q).toContain("lab_result_id=is.null");
    expect(q).toContain("status=neq.destroyed");
  });
  it("never replaces an existing COA, never writes a destroyed lot", async () => {
    st.db.rows("inventory_lots").push(lot({ lab_result_id: LAB2 }), lot({ id: "lot-d", status: "destroyed" }));
    expect(await linkLotLabResult(LOT, LAB, "u1")).toEqual({ ok: true, linked: false });
    expect(await linkLotLabResult("lot-d", LAB, "u1")).toEqual({ ok: true, linked: false });
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe(LAB2);
    expect(st.db.rows("inventory_lots")[1].lab_result_id).toBeNull();
  });
  it("labResultExists answers from lab_results", async () => {
    st.db.rows("lab_results").push({ id: LAB });
    expect(await labResultExists(LAB)).toEqual({ ok: true, exists: true });
    expect(await labResultExists(LAB2)).toEqual({ ok: true, exists: false });
  });
});

describe("S37 store — key evidence (published version only, fail closed)", () => {
  it("finds a published card", async () => {
    seedPublished();
    st.db.rows("menu_items").push({ id: "mi-1", menu_version_id: "v-live", source_item_id: "K1" });
    const r = await loadProductKeyEvidence("K1");
    expect(r).toEqual({ ok: true, evidence: { publishedCard: true, publishedSize: false, draftStatuses: [] } });
  });
  it("ignores a card that exists only on a non-published version", async () => {
    seedPublished();
    st.db.rows("menu_items").push({ id: "mi-1", menu_version_id: "v-draft", source_item_id: "K1" });
    const r = await loadProductKeyEvidence("K1");
    expect(r).toEqual({ ok: true, evidence: { publishedCard: false, publishedSize: false, draftStatuses: [] } });
  });
  it("finds an onboarded size only when its card is on the published version", async () => {
    seedPublished();
    st.db.rows("menu_items").push(
      { id: "mi-live", menu_version_id: "v-live", source_item_id: "OTHER" },
      { id: "mi-old", menu_version_id: "v-draft", source_item_id: "OTHER2" },
    );
    st.db.rows("menu_variants").push({ id: "mv-1", menu_item_id: "mi-old", source_variant_id: "K2-onboarded" });
    let r = await loadProductKeyEvidence("K2");
    expect(r.ok && r.evidence.publishedSize).toBe(false);
    st.db.rows("menu_variants").push({ id: "mv-2", menu_item_id: "mi-live", source_variant_id: "K2-onboarded" });
    r = await loadProductKeyEvidence("K2");
    expect(r.ok && r.evidence.publishedSize).toBe(true);
  });
  it("reads Product Onboarding draft statuses for the key", async () => {
    seedPublished();
    st.db.rows("catalog_product_drafts").push(
      { id: "d1", pos_product_key: "K3", status: "dismissed" },
      { id: "d2", pos_product_key: "K3", status: "approved" },
      { id: "d3", pos_product_key: "ZZ", status: "draft" },
    );
    const r = await loadProductKeyEvidence("K3");
    expect(r.ok && [...r.evidence.draftStatuses].sort()).toEqual(["approved", "dismissed"]);
  });
  it("still reads drafts when there is no published version", async () => {
    st.db.rows("catalog_product_drafts").push({ id: "d1", pos_product_key: "K3", status: "draft" });
    const r = await loadProductKeyEvidence("K3");
    expect(r).toEqual({ ok: true, evidence: { publishedCard: false, publishedSize: false, draftStatuses: ["draft"] } });
  });
  it.each(["menu_items", "menu_variants", "catalog_product_drafts"])("fails closed when %s cannot be read", async (t) => {
    seedPublished();
    st.db.missing.add(t);
    const r = await loadProductKeyEvidence("K9");
    expect(r.ok).toBe(false);
  });
});

describe("S37 store — exact Lab test ID search", () => {
  it("matches exactly (no partials) and counts OTHER lots already linked", async () => {
    st.db.rows("lab_results").push(
      { id: LAB, labtest_external_identifier: "LT-1", lab_name: "Confidence" },
      { id: LAB2, labtest_external_identifier: "LT-10", lab_name: "Other" },
    );
    st.db.rows("inventory_lots").push(
      lot({ lab_result_id: LAB }),
      lot({ id: "lot-2", lab_result_id: LAB }),
      lot({ id: "lot-3", lab_result_id: LAB }),
      lot({ id: "lot-4", lab_result_id: LAB2 }),
    );
    const r = await findLabResultsByLabtestId("LT-1", LOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.id)).toEqual([LAB]);
    expect(r.linkedLots.get(LAB)).toBe(2);
    const q = st.db.log.find((x) => x.table === "lab_results")!.url.search;
    expect(q).toContain("labtest_external_identifier=eq.LT-1");
    expect(q).toContain(`limit=${COA_SEARCH_LIMIT}`);
  });
  it("reports zero linked lots and does not read lots when nothing matches", async () => {
    const r = await findLabResultsByLabtestId("NOPE", LOT);
    expect(r.ok && r.rows.length).toBe(0);
    expect(st.db.log.some((x) => x.table === "inventory_lots")).toBe(false);
  });
  it("counts linked lots past PostgREST's 1000-row cap (paged on id), and fails closed if that read fails", async () => {
    st.db.rows("lab_results").push({ id: LAB, labtest_external_identifier: "LT-1" });
    for (let i = 0; i < 1105; i += 1) st.db.rows("inventory_lots").push(lot({ id: `l-${String(i).padStart(5, "0")}`, lab_result_id: LAB }));
    const r = await findLabResultsByLabtestId("LT-1", "l-00000");
    expect(r.ok && r.linkedLots.get(LAB)).toBe(1104);
    const lotReads = st.db.log.filter((x) => x.table === "inventory_lots");
    expect(lotReads.length).toBeGreaterThan(1);
    expect(lotReads[0].url.searchParams.get("order")).toBe("id.asc");
    st.db.missing.add("inventory_lots");
    const failed = await findLabResultsByLabtestId("LT-1", LOT);
    expect(failed.ok).toBe(false);
  });
  it("fails closed when lab_results cannot be read", async () => {
    st.db.missing.add("lab_results");
    expect((await findLabResultsByLabtestId("LT-1", LOT)).ok).toBe(false);
  });
  it("draft hints read by lot_id and return [] on error", async () => {
    st.db.rows("catalog_product_drafts").push(
      { id: "d1", lot_id: LOT, pos_product_key: "K1", name: "Gelato 3.5g", status: "draft" },
      { id: "d2", lot_id: "other", pos_product_key: "K2", name: "x", status: "draft" },
    );
    expect(await listDraftHintsForLot(LOT)).toEqual([{ pos_product_key: "K1", name: "Gelato 3.5g", status: "draft" }]);
    st.db.missing.add("catalog_product_drafts");
    expect(await listDraftHintsForLot(LOT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. the REAL server actions
// ---------------------------------------------------------------------------
describe("S37 linkLotProductAction", () => {
  it("links a key that a published card uses: provenance, one audit, redirect to #product-link", async () => {
    seedPublished();
    st.db.rows("menu_items").push({ id: "mi-1", menu_version_id: "v-live", source_item_id: "K1" });
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: " K1 " }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.calls[0]).toBe("perm:inventory.manage");
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("K1");
    expect(st.db.rows("inventory_lots")[0].pos_product_key_source).toBe("owner_entered");
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0]).toMatchObject({
      action: "inventory_lot.product_linked",
      entityId: LOT,
      before: { pos_product_key: null },
      after: { pos_product_key: "K1", pos_product_key_source: "owner_entered", resolved_from: "published_card" },
    });
    expect(st.calls).toContain(`revalidate:/admin/inventory/${LOT}`);
    expect(st.calls).toContain("revalidate:/admin/inventory");
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/${LOT}?saved=1#product-link`);
  });

  it("refuses when the lot already has a key: no write, no audit", async () => {
    seedPublished();
    st.db.rows("menu_items").push({ id: "mi-1", menu_version_id: "v-live", source_item_id: "K1" });
    st.db.rows("inventory_lots").push(lot({ pos_product_key: "OLD" }));
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(patches()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
    expect(lastRedirect()).toBe(
      `redirect:/admin/inventory/${LOT}?error=${encodeURIComponent(refusalMessage("key_already_set"))}#product-link`,
    );
  });

  it("refuses an unknown key (no card, no size, no draft): no write, no audit", async () => {
    seedPublished();
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "GHOST" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(patches()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain("No published menu card, menu size or Product Onboarding draft");
  });

  it("refuses a key only a dismissed draft uses", async () => {
    st.db.rows("catalog_product_drafts").push({ id: "d1", pos_product_key: "K5", status: "dismissed" });
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K5" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(patches()).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain("Restore the draft");
  });

  it("refuses a size id typed instead of the key, before any read", async () => {
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K1-onboarded" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.log).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain('Enter the product key "K1" instead.');
  });

  it("refuses a destroyed lot and fails closed on an evidence read error", async () => {
    st.db.rows("inventory_lots").push(lot({ status: "destroyed" }));
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(decodeURIComponent(lastRedirect())).toContain(refusalMessage("destroyed"));
    st.db.rows("inventory_lots")[0].status = "active";
    st.db.missing.add("catalog_product_drafts");
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(decodeURIComponent(lastRedirect())).toContain("Could not check Product Onboarding");
    expect(patches()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });

  it("reports a lost race as already linked and audits nothing", async () => {
    st.db.rows("catalog_product_drafts").push({ id: "d1", pos_product_key: "K1", status: "draft" });
    st.db.rows("inventory_lots").push(lot());
    st.db.before = (req) => {
      if (req.method === "PATCH") {
        st.db.rows("inventory_lots")[0].pos_product_key = "RACER";
        st.db.before = null;
      }
    };
    await expect(linkLotProductAction(LOT, fd({ pos_product_key: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.rows("inventory_lots")[0].pos_product_key).toBe("RACER");
    expect(st.audits).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain("never re-points");
  });
});

describe("S37 linkLotCoaAction", () => {
  it("attaches an existing lab result: one audit, redirect to #coa", async () => {
    st.db.rows("lab_results").push({ id: LAB });
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotCoaAction(LOT, fd({ lab_result_id: LAB.toUpperCase() }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe(LAB);
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0]).toMatchObject({
      action: "inventory_lot.coa_linked",
      entityId: LOT,
      before: { lab_result_id: null },
      after: { lab_result_id: LAB },
    });
    expect(lastRedirect()).toBe(`redirect:/admin/inventory/${LOT}?saved=1#coa`);
  });
  it("refuses when a COA is already linked: no write, no audit", async () => {
    st.db.rows("lab_results").push({ id: LAB });
    st.db.rows("inventory_lots").push(lot({ lab_result_id: LAB2 }));
    await expect(linkLotCoaAction(LOT, fd({ lab_result_id: LAB }))).rejects.toThrow("NEXT_REDIRECT");
    expect(patches()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain("never replaces");
  });
  it("refuses a non-UUID choice and a lab result that no longer exists", async () => {
    st.db.rows("inventory_lots").push(lot());
    await expect(linkLotCoaAction(LOT, fd({ lab_result_id: "nope" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect()).toContain("#coa");
    await expect(linkLotCoaAction(LOT, fd({ lab_result_id: LAB }))).rejects.toThrow("NEXT_REDIRECT");
    expect(decodeURIComponent(lastRedirect())).toContain("That lab result no longer exists. Search again.");
    expect(patches()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });
  it("reports a lost race as already linked", async () => {
    st.db.rows("lab_results").push({ id: LAB });
    st.db.rows("inventory_lots").push(lot());
    st.db.before = (req) => {
      if (req.method === "PATCH") {
        st.db.rows("inventory_lots")[0].lab_result_id = LAB2;
        st.db.before = null;
      }
    };
    await expect(linkLotCoaAction(LOT, fd({ lab_result_id: LAB }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe(LAB2);
    expect(st.audits).toHaveLength(0);
    expect(decodeURIComponent(lastRedirect())).toContain("never replaces");
  });
});

// ---------------------------------------------------------------------------
// 4. rendered panels
// ---------------------------------------------------------------------------
const noop = async () => {};

describe("S37 LotProductLinkPanel", () => {
  it("open: one-click suggestions + manual input both post pos_product_key", () => {
    const html = renderToStaticMarkup(
      <LotProductLinkPanel
        currentKey={null}
        keySourceLabel={null}
        refusal={null}
        drafts={[
          { pos_product_key: "K1", name: "Gelato 3.5g", status: "draft" },
          { pos_product_key: "K1", name: "dup", status: "approved" },
          { pos_product_key: "K9", name: "gone", status: "dismissed" },
        ]}
        action={noop}
      />,
    );
    expect(html).toContain(PRODUCT_LINK_TITLE);
    expect(html).toContain('data-testid="lot-product-link-suggestions"');
    expect(html).toContain('data-testid="lot-product-link-form"');
    expect((html.match(/name="pos_product_key"/g) ?? []).length).toBe(2);
    expect(html).toContain("Link to K1");
    expect(html).not.toContain("K9");
    expect(html).toContain("/admin/inventory/drafts?status=draft");
  });
  it("already linked: explains, shows provenance, offers no form", () => {
    const html = renderToStaticMarkup(
      <LotProductLinkPanel
        currentKey="OLD"
        keySourceLabel="from the POS import"
        refusal="key_already_set"
        drafts={[]}
        action={noop}
      />,
    );
    expect(html).not.toContain('data-testid="lot-product-link-form"');
    expect(html).not.toContain('name="pos_product_key"');
    expect(html).toContain("from the POS import");
  });
  it("destroyed: refused, no form", () => {
    const html = renderToStaticMarkup(
      <LotProductLinkPanel currentKey={null} keySourceLabel={null} refusal="destroyed" drafts={[]} action={noop} />,
    );
    expect(html).toContain('data-testid="lot-product-link-refused"');
    expect(html).not.toContain('name="pos_product_key"');
  });
});

describe("S37 LotCoaAttach", () => {
  const today = "2026-06-01";
  const failedExpired = coaCandidateView(
    {
      id: LAB,
      labtest_external_identifier: "LT-1",
      lab_name: "Confidence",
      tested_on: "2025-01-01",
      total_thc_pct: 24.3,
      thc_pct: null,
      passed: false,
      coa_release_date: null,
      coa_expire_date: "2026-01-01",
      created_at: "2025-01-02T00:00:00Z",
    },
    today,
    2,
  );
  it("search form is a GET named coaSearch; each candidate posts lab_result_id; warnings are shown", () => {
    const html = renderToStaticMarkup(
      <LotCoaAttach
        lotId={LOT}
        back=""
        refusal={null}
        search="LT-1"
        candidates={[failedExpired]}
        searchError={null}
        action={noop}
      />,
    );
    expect(html).toContain(COA_ATTACH_TITLE);
    expect(html).toContain('name="coaSearch"');
    expect(html).toContain(`action="/admin/inventory/${LOT}#coa"`);
    expect(html).toContain('data-testid="lot-coa-candidate"');
    expect(html).toContain(`name="lab_result_id" value="${LAB}"`);
    expect(html).toContain("Attach this lab result");
    expect(html).toContain("LT-1 · Confidence");
    expect(html).toContain("Total THC 24.3%");
    for (const w of failedExpired.warnings) expect(html).toContain(w.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"));
    expect(failedExpired.warnings.length).toBe(3);
    expect(html).toContain("WAC 314-55-102");
    expect(html).toContain("cannot be activated for sale");
  });
  it("refused when a COA is linked: no search, no attach", () => {
    const html = renderToStaticMarkup(
      <LotCoaAttach lotId={LOT} back="" refusal="coa_already_linked" search={null} candidates={[]} searchError={null} action={noop} />,
    );
    expect(html).toContain('data-testid="lot-coa-attach-refused"');
    expect(html).not.toContain('name="coaSearch"');
    expect(html).not.toContain('name="lab_result_id"');
  });
  it("shows a search error instead of results", () => {
    const html = renderToStaticMarkup(
      <LotCoaAttach lotId={LOT} back="" refusal={null} search={null} candidates={[]} searchError="Could not search" action={noop} />,
    );
    expect(html).toContain('data-testid="lot-coa-search-error"');
    expect(html).not.toContain('data-testid="lot-coa-results"');
  });
});
