/**
 * tests/compliance/r50-rehome-readers.test.ts   (R50 S2c, bible §1.3b)
 *
 * The ~700 manifests rebuilt from Cultivera's transfers are HISTORY, not work.
 * The native readers must leave them out:
 *
 *   - listManifests()            the Receiving work queue (unless includeMigration),
 *   - countManifestsByStatus()   stage counts (they go to `migrated`, never Accepted),
 *   - getDockToShelfMetrics()    their received_at = accepted_at is a fake 0-min dock time,
 *
 * while the full intake export still includes them, and the single POS-IMPORT
 * manifest (SLICE 58) and null-kind native manifests are unchanged.
 *
 * Runs the REAL PostgrestClient over an in-memory fetch so the actual
 * `or=(raw_payload->>kind.is.null,raw_payload->>kind.neq.cultivera-reconstructed)`
 * URL is what gets evaluated. Real-DB numbers: scripts/recon/r50-s2c/README.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

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

const store = await import("@/lib/inventory/intake-store");
const dock = await import("@/lib/catalog/dock-to-shelf");
const core = await import("@/lib/inventory/cultivera-rehome-core");
const group = await import("@/lib/inventory/cultivera-manifest-group-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const recent = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function seed(db: FakePostgrest) {
  const m = db.rows("inbound_manifests");
  // native, no payload at all (WCIA/manual intake predating raw_payload)
  m.push({ id: "a1", manifest_number: "NOKIND-1", status: "received", created_at: recent(10), raw_payload: null, received_at: recent(300), accepted_at: null });
  // native WCIA with a payload kind
  m.push({ id: "a2", manifest_number: "WCIA-NATIVE-1", status: "accepted", created_at: recent(20), raw_payload: { kind: "wcia" }, received_at: recent(400), accepted_at: recent(100) });
  // the single POS-IMPORT manifest: unchanged (SLICE 58)
  m.push({ id: "a3", manifest_number: "POS-IMPORT-x", status: "accepted", created_at: recent(30), raw_payload: { kind: group.POS_IMPORT_MANIFEST_KIND }, received_at: recent(500), accepted_at: recent(500) });
  // three rebuilt Cultivera manifests (history): accepted, received_at = accepted_at
  for (let i = 0; i < 3; i++) {
    m.push({
      id: `r${i}`,
      manifest_number: `CV-${i}`,
      status: "accepted",
      created_at: recent(1 + i),
      raw_payload: { kind: group.RECONSTRUCTED_MANIFEST_KIND, barcodes: [] },
      received_at: recent(60 + i),
      accepted_at: recent(60 + i),
    });
  }
  // one rebuilt manifest left in transit (still history, never queue work)
  m.push({ id: "r9", manifest_number: "CV-9", status: "in_transit", created_at: recent(5), raw_payload: { kind: group.RECONSTRUCTED_MANIFEST_KIND }, received_at: null, accepted_at: null });
}

beforeEach(() => {
  st.db = new FakePostgrest();
  seed(st.db);
});

describe("R50 S2c: native readers leave the rebuilt Cultivera manifests out", () => {
  it("the filter constant is the null-safe PostgREST or= (NULL <> 'x' is NULL in SQL)", () => {
    expect(core.NOT_REBUILT_OR).toBe(
      `raw_payload->>kind.is.null,raw_payload->>kind.neq.${group.RECONSTRUCTED_MANIFEST_KIND}`,
    );
    expect(core.isRebuiltKind(group.RECONSTRUCTED_MANIFEST_KIND)).toBe(true);
    expect(core.isRebuiltKind(group.POS_IMPORT_MANIFEST_KIND)).toBe(false);
    expect(core.isRebuiltKind(null)).toBe(false);
  });

  it("listManifests: the Receiving queue keeps native + POS-IMPORT, drops every rebuilt manifest", async () => {
    const rows = await store.listManifests();
    expect(rows.map((r) => r.manifest_number).sort()).toEqual(["NOKIND-1", "POS-IMPORT-x", "WCIA-NATIVE-1"]);
    const sent = st.db.log.find((r) => r.table === "inbound_manifests")!;
    expect(sent.url.searchParams.get("or")).toBe(`(${core.NOT_REBUILT_OR})`);
  });

  it("listManifests by status: an in-transit rebuilt manifest never shows as work", async () => {
    expect(await store.listManifests({ status: "in_transit" })).toEqual([]);
    expect((await store.listManifests({ status: "accepted" })).map((r) => r.id).sort()).toEqual(["a2", "a3"]);
  });

  it("listManifests: the code filter backs up the server filter (a server that ignored or= still hides them)", async () => {
    st.db.before = (req) => {
      if (req.table === "inbound_manifests") req.url.searchParams.delete("or");
    };
    const rows = await store.listManifests();
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("listManifests({includeMigration}) returns everything (the full intake export)", async () => {
    const rows = await store.listManifests({ includeMigration: true, limit: 50_000 });
    expect(rows).toHaveLength(7);
    const sent = st.db.log.find((r) => r.table === "inbound_manifests")!;
    expect(sent.url.searchParams.has("or")).toBe(false);
  });

  it("countManifestsByStatus: rebuilt manifests are counted apart as `migrated`, never Accepted/In transit", async () => {
    const c = await store.countManifestsByStatus();
    expect(c.received).toBe(1);
    expect(c.accepted).toBe(2);
    expect(c.in_transit).toBe(0);
    expect(c.migrated).toBe(4);
  });

  it("countManifestsByStatus with no rebuilt manifests: migrated is 0 and the native counts are unchanged", async () => {
    st.db.tables.set(
      "inbound_manifests",
      st.db.rows("inbound_manifests").filter((r) => !String(r.id).startsWith("r")),
    );
    const c = await store.countManifestsByStatus();
    expect(c).toMatchObject({ received: 1, accepted: 2, migrated: 0 });
  });

  it("dock-to-shelf: rebuilt manifests' fake 0-minute dock times are excluded", async () => {
    await dock.getDockToShelfMetrics();
    const sent = st.db.log.find((r) => r.table === "inbound_manifests")!;
    expect(sent.url.searchParams.get("or")).toBe(`(${core.NOT_REBUILT_OR})`);
    // Evaluate exactly what the server would return for that request.
    st.db.log = [];
    const { PostgrestClient } = await import("@supabase/postgrest-js");
    const c = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
    const { data } = await c
      .from("inbound_manifests")
      .select("id, payload_kind:raw_payload->>kind")
      .not("received_at", "is", null)
      .not("accepted_at", "is", null)
      .or(core.NOT_REBUILT_OR);
    expect((data as { id: string }[]).map((r) => r.id).sort()).toEqual(["a2", "a3"]);
  });

  it("wiring: the intake export opts in; the intake page shows the moved-from-Cultivera note", () => {
    expect(read("src/app/admin/inventory/intake/export/route.ts")).toMatch(/includeMigration: true/);
    const page = read("src/app/admin/inventory/intake/page.tsx");
    expect(page).toMatch(/counts\.migrated > 0/);
    expect(page).toMatch(/Moved from Cultivera/);
    // the hub reads the same filtered store functions (no second, unfiltered reader)
    const hub = read("src/lib/catalog/hub.ts");
    expect(hub).toMatch(/countManifestsByStatus\(\)/);
    expect(hub).not.toMatch(/from\("inbound_manifests"\)/);
  });
});
