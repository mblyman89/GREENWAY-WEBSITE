/**
 * tests/compliance/r19-approve-path-compliance-read.test.ts
 *
 * R19 defect (found while building S12): the Product Onboarding approve path
 * (stageIntakeMenuVersionForManifest) never SELECTED the approver's compliance
 * answers (0218) or the measured package volume (0224), so an approved product
 * reached the menu row with every limit column NULL.
 *
 * The s12 suite pins the declaration and the planner. This suite is
 * behavioural: it runs the REAL staging function through the REAL
 * postgrest-js client and reads the select that actually goes on the wire, so
 * declaring COMPLIANCE_COLS and forgetting to use it turns this red. It also
 * proves the graduated fallback: a database without 0218/0224 (42703) is
 * retried WITHOUT only those columns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/pos/menu-version", () => ({ archiveSupersededStaged: async () => 0 }));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) };
});

import { stageIntakeMenuVersionForManifest } from "@/lib/pos/intake-menu-staging";

const M = "aaaaaaaa-0000-4000-8000-0000000000aa";
const COMPLIANCE = ["chosen_otherwise_taken", "chosen_units_per_package", "chosen_low_thc_liquid", "chosen_unit_thc_mg", "chosen_net_volume_ml"];

function draftSelects(db: FakePostgrest): string[][] {
  return db.log
    .filter((r) => r.method === "GET" && r.table === "catalog_product_drafts" && r.url.searchParams.get("status") === "eq.approved")
    .map((r) => (r.url.searchParams.get("select") ?? "").split(",").map((c) => c.trim()));
}

beforeEach(() => {
  st.db = new FakePostgrest();
});

describe("R19 defect: the approve path reads the compliance answers", () => {
  it("the FIRST approved-drafts read selects all five 0218 / 0224 columns, for THIS manifest only", async () => {
    await stageIntakeMenuVersionForManifest(M, null).catch(() => undefined);
    const selects = draftSelects(st.db);
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const c of COMPLIANCE) expect(selects[0], c).toContain(c);
    const first = st.db.log.find((r) => r.table === "catalog_product_drafts")!;
    expect(first.url.searchParams.get("manifest_id")).toBe(`eq.${M}`);
  });

  it("a database without 0218 / 0224 (42703) retries WITHOUT only those columns, keeping the 0141 / 0146 picks", async () => {
    let refused = 0;
    st.db.before = (req) => {
      const sel = req.url.searchParams.get("select") ?? "";
      if (req.method === "GET" && req.table === "catalog_product_drafts" && sel.includes("chosen_otherwise_taken")) {
        refused += 1;
        return { status: 400, body: { code: "42703", details: null, hint: null, message: "column catalog_product_drafts.chosen_otherwise_taken does not exist" } };
      }
    };
    await stageIntakeMenuVersionForManifest(M, null).catch(() => undefined);
    expect(refused).toBe(1);
    const selects = draftSelects(st.db);
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const c of COMPLIANCE) expect(selects[1], c).not.toContain(c);
    for (const c of ["chosen_website_category", "chosen_house_type", "chosen_strain_type"]) expect(selects[1], c).toContain(c);
  });
});
