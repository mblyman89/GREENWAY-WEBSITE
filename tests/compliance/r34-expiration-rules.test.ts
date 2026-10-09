/**
 * tests/compliance/r34-expiration-rules.test.ts  (R34, T-330)
 *
 * Owner request: "add an expiration date to all the products that do not
 * have one ... a list of every one of our types and categories ... skipping
 * the ones that have a json set date ... a setting that allows me to
 * override all manually set dates ... tie in everywhere applicable ... a
 * report tab." Follow-up: "have the page be dynamic as well so new types and
 * categories get added there automatically."
 *
 * REAL store + REAL postgrest-js over the in-memory FakePostgrest:
 *   1. Rules CRUD: missing table -> migrated:false; insert, update (key
 *      normalized), delete.
 *   2. loadExpiryLots: fails closed on a failed lot read; a category the
 *      owner CREATED in Settings -> Types (and an owner type mapped to it)
 *      resolves on the lot with the owner's label - and does NOT without
 *      the registry row (never invented).
 *   3. applyExpiryRules: blank filled, manifest/COA/legacy never touched,
 *      owner date only with override, a lot that changed after the preview
 *      is reported (guarded UPDATE missed) and NOT counted as written.
 *   4. Actions: save writes + audits, apply refuses a stale fingerprint
 *      (writes nothing), a fresh one writes and audits per-lot from/to.
 *   5. Export route: CSV of the watchlist; 503 (no partial file) when the
 *      lot read fails.
 *   6. Wiring/source guards: the rules page reads the LIVE registry, the
 *      report tab, the soon-days constant, factory reset, the issues link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  calls: [] as string[],
  audits: [] as Array<{ action: string; entityId: string; before: unknown; after: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`),
  revalidateTag: (t: string) => st.calls.push(`tag:${t}`),
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; before: unknown; after: unknown }) => {
    st.audits.push({ action: a.action, entityId: a.entityId, before: a.before, after: a.after });
  },
}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});

import {
  applyExpiryRules,
  deleteExpiryRule,
  listExpiryRules,
  loadExpiryLots,
  previewExpiryRules,
  saveExpiryRule,
} from "@/lib/inventory/expiry-rules-store";
import { saveExpiryRulesAction, applyExpiryRulesAction } from "@/app/admin/inventory/expiration-rules/actions";
import { GET as exportGET } from "@/app/admin/reports/expiration/export/route";
import { planFingerprint, EXPIRY_SOON_DAYS, rulePageCategoriesFrom, buildRulePage } from "@/lib/inventory/expiry-rules-core";
import { REPORT_TABS } from "@/components/admin/reports/ReportTabs";
import { EXPIRATION_RULES_HREF } from "@/lib/admin/issues-core";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

function lotRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    lot_code: `LC-${id.slice(-3)}`,
    product_name: "Blue Dream 3.5g",
    status: "active",
    expires_on: null,
    expires_on_source: null,
    expires_on_rule_id: null,
    expires_on_rule_note: null,
    received_on: "2026-03-01",
    lab_result_id: null,
    category: null,
    inventory_type: "Flower",
    pos_product_key: null,
    on_hand_qty: 10,
    unit_cost_minor_units: 500,
    ...over,
  };
}

function ruleRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    scope: "category",
    scope_key: "flower",
    scope_label: "Flower",
    mode: "months",
    amount: 12,
    fixed_date: null,
    basis: "received_on",
    override_manual: false,
    enabled: true,
    notes: null,
    citation_key: null,
    set_by: null,
    set_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const L_BLANK = "00000000-0000-4000-8000-00000000a001";
const L_MANIFEST = "00000000-0000-4000-8000-00000000a002";
const L_OWNER = "00000000-0000-4000-8000-00000000a003";
const L_LEGACY = "00000000-0000-4000-8000-00000000a004";
const L_DESTROYED = "00000000-0000-4000-8000-00000000a005";
const R_FLOWER = "00000000-0000-4000-8000-00000000f001";

function seed() {
  st.db = new FakePostgrest();
  st.calls = [];
  st.audits = [];
  st.db.uniques.push({ table: "inventory_expiry_rules", columns: ["scope", "scope_key"], name: "inventory_expiry_rules_scope_key_uq" });
  st.db.rows("inventory_lots").push(
    lotRow(L_BLANK),
    lotRow(L_MANIFEST, { expires_on: "2026-08-01", expires_on_source: "manifest" }),
    lotRow(L_OWNER, { expires_on: "2026-06-15", expires_on_source: "owner_entered" }),
    lotRow(L_LEGACY, { expires_on: "2026-07-04", expires_on_source: null }),
    lotRow(L_DESTROYED, { status: "destroyed" }),
  );
  st.db.rows("inventory_expiry_rules").push(ruleRow(R_FLOWER));
}

const lot = (id: string) => st.db.rows("inventory_lots").find((r) => r.id === id)!;

async function expectRedirect(p: Promise<unknown>): Promise<URL> {
  await expect(p).rejects.toThrow("NEXT_REDIRECT");
  const last = [...st.calls].reverse().find((c) => c.startsWith("redirect:"))!;
  return new URL(last.slice("redirect:".length), "http://x");
}

beforeEach(seed);

describe("R34 store: rules CRUD", () => {
  it("missing table -> migrated:false with the 0253 message, never a crash", async () => {
    st.db.missing.add("inventory_expiry_rules");
    const r = await listExpiryRules();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.migrated).toBe(false);
      expect(r.error).toMatch(/0253/);
    }
  });

  it("insert, then update the SAME row by (scope, normalized key), then delete", async () => {
    const value = { mode: "months" as const, amount: 6, fixed_date: null, basis: "received_on" as const };
    const a = await saveExpiryRule(
      { scope: "type", scopeKey: "  BHO ", scopeLabel: "BHO", value, overrideManual: false, enabled: true, notes: null, citationKey: null },
      "u1",
    );
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.before).toBeNull();
    expect(a.after.scope_key).toBe("bho");
    const b = await saveExpiryRule(
      { scope: "type", scopeKey: "bho", scopeLabel: "BHO", value: { ...value, amount: 9 }, overrideManual: true, enabled: true, notes: null, citationKey: null },
      "u1",
    );
    expect(b.ok && b.before?.id === a.after.id && b.after.amount === 9 && b.after.override_manual).toBe(true);
    expect(st.db.rows("inventory_expiry_rules").filter((r) => r.scope === "type")).toHaveLength(1);
    const d = await deleteExpiryRule(a.after.id);
    expect(d.ok && d.before?.id === a.after.id).toBe(true);
    expect(st.db.rows("inventory_expiry_rules").some((r) => r.id === a.after.id)).toBe(false);
    // Deleting an id that is already gone is a no-op, not an error.
    const again = await deleteExpiryRule(a.after.id);
    expect(again.ok && again.before === null).toBe(true);
  });

  it("refuses an unusable key without touching the table", async () => {
    const before = st.db.log.length;
    const r = await saveExpiryRule(
      { scope: "category", scopeKey: "   ", scopeLabel: null, value: { mode: "exempt", amount: null, fixed_date: null, basis: "received_on" }, overrideManual: false, enabled: true, notes: null, citationKey: null },
      "u1",
    );
    expect(r.ok).toBe(false);
    expect(st.db.log.length).toBe(before);
  });
});

describe("R34 store: loadExpiryLots", () => {
  it("fails CLOSED when the lot read fails (no partial list)", async () => {
    st.db.before = (req) => (req.table === "inventory_lots" && req.method === "GET" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const r = await loadExpiryLots();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Nothing was changed/);
  });

  it("an owner-CREATED category (Settings -> Types) resolves on its lots with the owner's label", async () => {
    st.db.rows("website_category_types").push(
      { value: "flower", label: "Flower", helper: "", sort_order: 10, is_active: true, is_system: true },
      { value: "functional", label: "Functional Gummies", helper: "", sort_order: 15, is_active: true, is_system: false },
    );
    st.db.rows("inventory_types").push({ id: "t1", key: "mood chews", label: "Mood Chews", notes: null, website_category: "functional", is_active: true, is_system: false });
    const L = "00000000-0000-4000-8000-00000000b001";
    st.db.rows("inventory_lots").push(lotRow(L, { inventory_type: "Mood Chews" }));
    const r = await loadExpiryLots([L]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lots[0].category).toBe("functional");
    expect(r.lots[0].category_label).toBe("Functional Gummies");
    expect(r.lots[0].type_key).toBe("mood chews");
  });

  it("...and does NOT resolve to it when the registry has no such category (never invented)", async () => {
    st.db.rows("inventory_types").push({ id: "t1", key: "mood chews", label: "Mood Chews", notes: null, website_category: "functional", is_active: true, is_system: false });
    const L = "00000000-0000-4000-8000-00000000b002";
    st.db.rows("inventory_lots").push(lotRow(L, { inventory_type: "Mood Chews" }));
    const r = await loadExpiryLots([L]);
    expect(r.ok && r.lots[0].category).toBe(null);
  });

  it("a renamed built-in category shows the owner's new label", async () => {
    st.db.rows("website_category_types").push({ value: "flower", label: "Premium Flower", helper: "", sort_order: 10, is_active: true, is_system: true });
    const r = await loadExpiryLots([L_BLANK]);
    expect(r.ok && r.lots[0].category === "flower" && r.lots[0].category_label === "Premium Flower").toBe(true);
  });
});

describe("R34 store: applyExpiryRules", () => {
  it("fills the blank lot only; document, legacy, owner and destroyed lots untouched", async () => {
    const r = await applyExpiryRules({ overrideManual: false }, "u1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.written).toBe(1);
    expect(r.writtenDecisions.map((d) => d.lotId)).toEqual([L_BLANK]);
    expect(lot(L_BLANK)).toMatchObject({ expires_on: "2027-03-01", expires_on_source: "rule", expires_on_rule_id: R_FLOWER, expires_on_set_by: "u1" });
    expect(String(lot(L_BLANK).expires_on_rule_note)).toMatch(/12 months/);
    expect(lot(L_MANIFEST)).toMatchObject({ expires_on: "2026-08-01", expires_on_source: "manifest" });
    expect(lot(L_LEGACY)).toMatchObject({ expires_on: "2026-07-04", expires_on_source: null });
    expect(lot(L_OWNER)).toMatchObject({ expires_on: "2026-06-15", expires_on_source: "owner_entered" });
    expect(lot(L_DESTROYED).expires_on).toBeNull();
  });

  it("override replaces the owner date - and still never a document or legacy date", async () => {
    const r = await applyExpiryRules({ overrideManual: true }, "u1");
    expect(r.ok && r.written).toBe(2);
    expect(lot(L_OWNER)).toMatchObject({ expires_on: "2027-03-01", expires_on_source: "rule" });
    expect(lot(L_MANIFEST).expires_on).toBe("2026-08-01");
    expect(lot(L_LEGACY).expires_on).toBe("2026-07-04");
  });

  it("a lot dated by hand AFTER the preview is reported as changed, not overwritten, not audited as written", async () => {
    st.db.before = (req) => {
      if (req.table === "inventory_lots" && req.method === "PATCH") {
        Object.assign(lot(L_BLANK), { expires_on: "2026-09-09", expires_on_source: "owner_entered" });
      }
    };
    const r = await applyExpiryRules({ overrideManual: false }, "u1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.written).toBe(0);
    expect(r.changed).toBe(1);
    expect(r.changedLotIds).toEqual([L_BLANK]);
    expect(r.writtenDecisions).toEqual([]);
    expect(lot(L_BLANK)).toMatchObject({ expires_on: "2026-09-09", expires_on_source: "owner_entered" });
  });

  it("a lot DESTROYED between the read and the write is never dated (DB-level guard)", async () => {
    st.db.before = (req) => {
      if (req.table === "inventory_lots" && req.method === "PATCH") {
        lot(L_BLANK).status = "destroyed";
      }
    };
    const r = await applyExpiryRules({ overrideManual: false }, "u1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.written).toBe(0);
    expect(r.changed).toBe(1);
    expect(r.writtenDecisions).toEqual([]);
    expect(lot(L_BLANK).expires_on).toBeNull();
    expect(lot(L_BLANK).expires_on_source).toBeNull();
  });

  it("preview writes nothing", async () => {
    const r = await previewExpiryRules({ overrideManual: true });
    expect(r.ok && r.plan.writes.length).toBe(2);
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
  });

  it("deleting a rule then re-applying clears the dates only that rule set", async () => {
    await applyExpiryRules({ overrideManual: false }, "u1");
    st.db.rows("inventory_expiry_rules").length = 0;
    const r = await applyExpiryRules({ overrideManual: false }, "u1");
    expect(r.ok && r.byKind.clear).toBe(1);
    expect(lot(L_BLANK)).toMatchObject({ expires_on: null, expires_on_source: null, expires_on_rule_id: null, expires_on_rule_note: null });
    expect(lot(L_MANIFEST).expires_on).toBe("2026-08-01");
  });

  it("fill-only (intake) never recomputes or overrides", async () => {
    Object.assign(lot(L_BLANK), { expires_on: "2026-12-31", expires_on_source: "rule", expires_on_rule_id: R_FLOWER });
    const r = await applyExpiryRules({ overrideManual: true, fillOnly: true }, "u1");
    expect(r.ok && r.written).toBe(0);
    expect(lot(L_BLANK).expires_on).toBe("2026-12-31");
    expect(lot(L_OWNER).expires_on).toBe("2026-06-15");
  });
});

describe("R34 actions", () => {
  function form(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  }

  it("save: creates a rule for a NEW owner category, audits it, redirects with counts", async () => {
    const u = await expectRedirect(
      saveExpiryRulesAction(
        form({
          row_count: "2",
          row_0_scope: "category",
          row_0_key: "functional",
          row_0_label: "Functional Gummies",
          row_0_mode: "months",
          row_0_amount: "9",
          row_1_scope: "category",
          row_1_key: "flower",
          row_1_label: "Flower",
          row_1_mode: "",
        }),
      ),
    );
    expect(u.searchParams.get("saved")).toBe("1");
    expect(u.searchParams.get("removed")).toBe("1");
    const rows = st.db.rows("inventory_expiry_rules");
    expect(rows.map((r) => r.scope_key)).toEqual(["functional"]);
    expect(st.audits.map((a) => a.action).sort()).toEqual(["inventory_expiry_rule.created", "inventory_expiry_rule.deleted"]);
    expect(st.calls).toContain("perm:inventory.manage");
  });

  it("save: a bad row refuses the whole form (nothing written)", async () => {
    const u = await expectRedirect(
      saveExpiryRulesAction(form({ row_count: "1", row_0_scope: "category", row_0_key: "flower", row_0_label: "Flower", row_0_mode: "months", row_0_amount: "0" })),
    );
    expect(u.searchParams.get("error")).toBeTruthy();
    expect(st.db.rows("inventory_expiry_rules")[0].amount).toBe(12);
    expect(st.audits).toHaveLength(0);
  });

  it("apply: a stale fingerprint bounces to a fresh preview and writes NOTHING", async () => {
    const u = await expectRedirect(applyExpiryRulesAction(form({ fp: "0-deadbeef", override_manual: "0" })));
    expect(u.searchParams.get("stale")).toBe("1");
    expect(u.searchParams.get("preview")).toBe("1");
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
    expect(st.audits).toHaveLength(0);
  });

  it("apply: a fresh fingerprint writes and audits per-lot from/to", async () => {
    const p = await previewExpiryRules({ overrideManual: false });
    if (!p.ok) throw new Error("preview failed");
    const fp = planFingerprint(p.plan.writes);
    const u = await expectRedirect(applyExpiryRulesAction(form({ fp, override_manual: "0" })));
    expect(u.searchParams.get("applied")).toBe("1");
    expect(lot(L_BLANK).expires_on).toBe("2027-03-01");
    const a = st.audits.find((x) => x.action === "inventory_lot.expiry_rules_applied")!;
    const after = a.after as { lots: { id: string; from: string | null; to: string | null }[]; written: number };
    expect(after.written).toBe(1);
    expect(after.lots).toEqual([{ id: L_BLANK, kind: "fill", from: null, to: "2027-03-01", rule: R_FLOWER }]);
    expect(st.calls).toContain("revalidate:/admin/reports/expiration");
  });

  it("apply: the audit lists only lots ACTUALLY written - a lot dated by hand mid-apply is listed as changed", async () => {
    const p = await previewExpiryRules({ overrideManual: false });
    if (!p.ok) throw new Error("preview failed");
    const fp = planFingerprint(p.plan.writes);
    st.db.before = (req) => {
      if (req.table === "inventory_lots" && req.method === "PATCH") {
        Object.assign(lot(L_BLANK), { expires_on: "2026-09-09", expires_on_source: "owner_entered" });
      }
    };
    await expectRedirect(applyExpiryRulesAction(form({ fp, override_manual: "0" })));
    const a = st.audits.find((x) => x.action === "inventory_lot.expiry_rules_applied")!;
    expect(a).toBeTruthy();
    const after = a.after as { lots: unknown[]; written: number; changed_since_preview: number; changed_lot_ids: string[] };
    expect(after.written).toBe(0);
    expect(after.changed_since_preview).toBe(1);
    expect(after.lots).toEqual([]);
    expect(after.changed_lot_ids).toEqual([L_BLANK]);
    expect(lot(L_BLANK)).toMatchObject({ expires_on: "2026-09-09", expires_on_source: "owner_entered" });
  });
});

describe("R34 export route", () => {
  it("CSV watchlist with headers; requires reports.view", async () => {
    Object.assign(lot(L_BLANK), { expires_on: "2000-01-01", expires_on_source: "rule", expires_on_rule_id: R_FLOWER });
    const res = await exportGET(new Request("http://x/admin/reports/expiration/export?sheet=watchlist&format=csv"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/expiring within 90 days/);
    expect(text).toMatch(/^Lot,Product,Category,Date,Days from today,Status,Date source,On hand,Value at cost,Cost known$/m);
    // 2000-01-01 is expired on any clock; 10 x $5.00 at cost.
    expect(text).toMatch(/^LC-001,Blue Dream 3\.5g,Flower,2000-01-01,-\d+,Expired,Expiration rule,10,50\.00,Yes$/m);
    // The destroyed lot is never on a watchlist.
    expect(text).not.toMatch(/LC-005/);
    expect(st.calls).toContain("perm:reports.view");
  });

  it("503, no partial file, when the lot read fails", async () => {
    st.db.before = (req) => (req.table === "inventory_lots" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const res = await exportGET(new Request("http://x/admin/reports/expiration/export?format=xlsx"));
    expect(res.status).toBe(503);
  });
});

describe("R34 dynamic categories (pure, through the real page model)", () => {
  it("a category + type created in Settings -> Types appear on the rules page with no code change", () => {
    const cats = rulePageCategoriesFrom([
      { value: "flower", label: "Flower", sort_order: 10, is_active: true, is_system: true },
      { value: "functional", label: "Functional Gummies", sort_order: 20, is_active: true, is_system: false },
    ]);
    const page = buildRulePage({
      categories: cats,
      catalogTypes: [],
      ownerTypes: [{ key: "mood chews", label: "Mood Chews", website_category: "functional", is_system: false }],
      lots: [],
      rules: [],
    });
    const fn = page.categories.find((c) => c.value === "functional");
    expect(fn?.custom).toBe(true);
    expect(fn?.types.map((t) => t.key)).toEqual(["mood chews"]);
    expect(fn?.types[0].custom).toBe(true);
  });
});

describe("R34 wiring guards", () => {
  it("the rules page reads the LIVE registry, not the hardcoded taxonomy", () => {
    const page = src("src/app/admin/inventory/expiration-rules/page.tsx");
    expect(page).toMatch(/listWebsiteCategoryTypes\(\{ includeInactive: true \}\)/);
    expect(page).toMatch(/listInventoryTypes\(\{ includeInactive: true \}\)/);
    expect(page).toMatch(/rulePageCategoriesFrom\(/);
    expect(page).not.toMatch(/websiteCategoryDefinitions/);
    expect(page).toMatch(/force-dynamic/);
    expect(page).toMatch(/\/admin\/settings\/types/);
  });

  it("lot loading opts in to owner-created categories; other callers unchanged by default", () => {
    expect(src("src/lib/inventory/expiry-rules-store.ts")).toMatch(/includeCustomCategories: true/);
    expect(src("src/lib/inventory/website-category-resolver-server.ts")).toMatch(/opts\.includeCustomCategories \? loadCustomCategoryMap\(\)/);
  });

  it("report tab is registered next to Inventory & COGS", () => {
    const i = REPORT_TABS.findIndex((t) => t.href === "/admin/reports/expiration");
    expect(i).toBeGreaterThan(-1);
    expect(REPORT_TABS[i - 1].href).toBe("/admin/reports/cogs");
    expect(src("src/app/admin/reports/expiration/page.tsx")).toMatch(/requirePermission\("reports\.view"\)/);
  });

  it("'expiring soon' means the same number of days everywhere", () => {
    const m = /export const EXPIRING_SOON_DAYS = (\d+);/.exec(src("src/lib/inventory/store.ts"));
    expect(Number(m?.[1])).toBe(EXPIRY_SOON_DAYS);
  });

  it("factory reset KEEPs the rules (configuration, not history)", () => {
    expect(src("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "inventory_expiry_rules", disposition: "KEEP"/);
  });

  it("the missing-expiry issue links to the rules page", () => {
    expect(EXPIRATION_RULES_HREF).toBe("/admin/inventory/expiration-rules");
  });

  it("intake auto-apply is fill-only, scoped to the delivery's lots, and best-effort", () => {
    const s = src("src/lib/inventory/intake-store.ts");
    expect(s).toMatch(/applyExpiryRules\(\s*\{\s*overrideManual: false,\s*fillOnly: true,\s*lotIds:/);
    expect(s).toMatch(/intakeExpiryNote\(/);
  });

  it("cycle-count export keeps Expires as reference only (never imported back)", () => {
    const s = src("src/lib/inventory/cycle-count-sheet-core.ts");
    expect(s).toMatch(/"Expires"/);
  });
});
