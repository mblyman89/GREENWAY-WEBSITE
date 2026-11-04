/**
 * tests/compliance/menu-description-nul-fix.test.ts  (2026-11-04 owner fix)
 *
 *   "I can fetch the menu items, and I can save the images. It fails to save
 *    the descriptions, it says so under the save all assets button."
 *
 * Root cause (proven in prod audit_logs + a live SQL probe): vendor-menu KB
 * identities are NUL-joined ("brand\u0000product\u0000"), and PostgreSQL text
 * refuses U+0000 (22P05). The kb_products upsert carried that key in
 * pos_product_key, so EVERY menu description write was refused and the button
 * could only say "The Knowledge Base write did not complete."
 *
 * Proven on the REAL writeBackProductFacts through FakePostgrest, with the fake
 * refusing any body containing U+0000 exactly as Postgres does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";
import {
  __runWritebackTextCoreTests,
  hasNul,
  kbWriteErrorReason,
  pgSafeText,
  posKeyForStorage,
  usageEntityId,
} from "@/lib/ai/kb/writeback-text-core";
import { kbIdentityForItem } from "@/lib/purchasing/cultivera-kb-link-core";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
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
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "", sources: [] }),
}));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));

const NUL = "\u0000";
const DESC = "A bright citrus-forward hybrid with a smooth finish.";

function postgresRefusesNul(db: FakePostgrest) {
  db.before = (req) => {
    if (req.body != null && JSON.stringify(req.body).includes("\\u0000")) {
      return {
        status: 400,
        body: {
          code: "22P05",
          message: "unsupported Unicode escape sequence",
          details: "\\u0000 cannot be converted to text.",
          hint: null,
        },
      };
    }
  };
}

describe("writeback-text-core (pure)", () => {
  it("self-tests pass", () => {
    const r = __runWritebackTextCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(17);
  });
  it("menu identities really are NUL-joined (the trigger)", () => {
    const id = kbIdentityForItem({ name: "Blue Dream", brand: "Acme Farms" });
    expect(hasNul(id.posProductKey)).toBe(true);
    expect(posKeyForStorage(id.posProductKey)).toBeNull();
    expect(usageEntityId(id.posProductKey)).toBe("acme-farms/blue-dream/");
    expect(posKeyForStorage(" 123456 ")).toBe("123456");
    expect(pgSafeText(`a${NUL}b`)).toBe("ab");
    expect(pgSafeText(null)).toBeNull();
  });
  it("error reason carries the database code", () => {
    expect(kbWriteErrorReason({ code: "22P05", message: "unsupported Unicode escape sequence" })).toContain("22P05");
    expect(kbWriteErrorReason(null)).toBe("The Knowledge Base write did not complete.");
  });
});

describe("writeBackProductFacts with a vendor-menu identity", () => {
  beforeEach(() => {
    st.db = new FakePostgrest();
    postgresRefusesNul(st.db);
  });

  it("saves the description (pos_product_key stored NULL, no NUL anywhere)", async () => {
    const { writeBackProductFacts } = await import("@/lib/ai/kb/writeback");
    const id = kbIdentityForItem({ name: "Blue Dream", brand: "Acme Farms" });
    const r = await writeBackProductFacts(
      {
        posProductKey: id.posProductKey,
        productName: "Blue Dream",
        brandName: "Acme Farms",
        variantLabel: id.variantLabel,
        description: DESC,
        source: "cultivera_menu",
      },
      "00000000-0000-4000-8000-0000000000aa",
    );
    expect(r.skippedReason).toBeUndefined();
    expect(r.wroteProduct).toBe(true);
    expect(r.descriptionOutcome).toBe("saved");
    const rows = st.db.rows("kb_products");
    expect(rows).toHaveLength(1);
    expect(rows[0].pos_product_key).toBeNull();
    expect(rows[0].description).toBe(DESC);
    expect(rows[0].brand_slug).toBe("acme-farms");
    expect(rows[0].product_slug).toBe("blue-dream");
    expect(rows[0].status).toBe("draft");
    for (const req of st.db.log) expect(JSON.stringify(req.body ?? "")).not.toContain("\\u0000");
  });

  it("re-saving is idempotent and keeps the curated description", async () => {
    const { writeBackProductFacts } = await import("@/lib/ai/kb/writeback");
    const id = kbIdentityForItem({ name: "Blue Dream", brand: "Acme Farms" });
    const facts = { posProductKey: id.posProductKey, productName: "Blue Dream", brandName: "Acme Farms", description: DESC };
    await writeBackProductFacts(facts, null);
    const again = await writeBackProductFacts({ ...facts, description: "Other text." }, null);
    expect(again.wroteProduct).toBe(true);
    expect(again.descriptionOutcome).toBe("kept_existing");
    expect(st.db.rows("kb_products")).toHaveLength(1);
    expect(st.db.rows("kb_products")[0].description).toBe(DESC);
  });

  it("strips a stray NUL out of the description text itself", async () => {
    const { writeBackProductFacts } = await import("@/lib/ai/kb/writeback");
    const r = await writeBackProductFacts(
      { posProductKey: "998877", productName: "Gelato", brandName: "Acme", description: `Sweet${NUL} and creamy.` },
      null,
    );
    expect(r.descriptionOutcome).toBe("saved");
    expect(st.db.rows("kb_products")[0].description).toBe("Sweet and creamy.");
    expect(st.db.rows("kb_products")[0].pos_product_key).toBe("998877");
  });

  it("a refused write now reports the database's reason (never silent)", async () => {
    const { writeBackProductFacts } = await import("@/lib/ai/kb/writeback");
    st.db.before = (req) => {
      if (req.method === "POST" && req.table === "kb_products") {
        return { status: 403, body: { code: "42501", message: "permission denied for table kb_products" } };
      }
    };
    const r = await writeBackProductFacts({ posProductKey: "1", productName: "X", description: DESC }, null);
    expect(r.wroteProduct).toBe(false);
    expect(r.descriptionOutcome).toBe("kb_unavailable");
    expect(r.skippedReason).toContain("42501");
    expect(r.skippedReason).toContain("permission denied");
  });
});

describe("media usage ledger no longer drops NUL-keyed rows", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/media/store.ts"), "utf8");
  it("recordUsage and clearUsage normalise the entity id", () => {
    expect(src).toMatch(/import \{ usageEntityId \} from "@\/lib\/ai\/kb\/writeback-text-core"/);
    const rec = src.slice(src.indexOf("export async function recordUsage"), src.indexOf("export async function clearUsage"));
    expect(rec).toContain("usageEntityId(rawEntityId)");
    const clr = src.slice(src.indexOf("export async function clearUsage"));
    expect(clr.slice(0, 400)).toContain("usageEntityId(rawEntityId)");
  });
  it("writeback stores a safe key and surfaces the reason", () => {
    const wb = readFileSync(join(process.cwd(), "src/lib/ai/kb/writeback.ts"), "utf8");
    expect(wb).toContain("pos_product_key: posKeyForStorage(");
    expect(wb).toContain("result.skippedReason = kbWriteErrorReason(error)");
  });
});
