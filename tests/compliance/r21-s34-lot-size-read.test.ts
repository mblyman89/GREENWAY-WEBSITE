/**
 * Round 21 (D) - S34: each Onboarding row's size label comes from the ONE
 * existing inventory_lots read in loadStrainTypeSignals, driven here through
 * the REAL postgrest-js client against the in-memory FakePostgrest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

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

import { loadStrainTypeSignals } from "@/lib/inventory/catalog-drafts";

const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const L3 = "00000000-0000-4000-8000-000000000003";
const d = (id: string, lot_id: string | null) => ({ id, name: "Blue Dream", strain_name: null, lot_id });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.rows("inventory_lots").push(
    { id: L1, strain_type: "hybrid", unit_weight: 3.5, unit_weight_uom: "g" },
    { id: L2, strain_type: null, unit_weight: 1, unit_weight_uom: null },
    { id: L3, strain_type: "indica", unit_weight: null, unit_weight_uom: "g" },
  );
});

describe("S34 lot size labels from the strain-signal read", () => {
  it("labels exactly like staging; no weight -> no label (never guessed)", async () => {
    const out = await loadStrainTypeSignals([d("a", L1), d("b", L2), d("c", L3), d("x", null)]);
    expect([...out.sizeLabels.entries()]).toEqual([["a", "3.5 g"], ["b", "1"]]);
    expect(out.evidence.get("a")).toEqual({ kb: null, manifest: "hybrid" });
    expect(out.evidence.get("c")).toEqual({ kb: null, manifest: "indica" });
  });

  it("no drafts -> empty labels, no read", async () => {
    const out = await loadStrainTypeSignals([]);
    expect(out.sizeLabels.size).toBe(0);
  });
});
