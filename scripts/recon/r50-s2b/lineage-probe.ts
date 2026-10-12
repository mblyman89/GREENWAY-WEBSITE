// R50 S2b: run the REAL lineage readers against the local PG15 + PostgREST harness.
// Copy to the repo root to run (it imports @/), then delete. Never shipped.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadUndatedImportLots, setImportLotsReceivedDate } from "@/lib/inventory/received-date-bulk-store";

const A = "abcd1234-0000-4000-8000-00000000000a";
const B = "abcd1234-9999-4000-8000-00000000000b";
const L = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`;

async function tryIt<T>(label: string, f: () => Promise<T>, show: (v: T) => unknown) {
  try {
    console.log(label, JSON.stringify(show(await f())));
  } catch (e) {
    console.log(label, "THREW", JSON.stringify(e instanceof Error ? e.message : String(e)));
  }
}

(async () => {
  let ids: (a: ReturnType<typeof createSupabaseAdminClient>, i: string) => Promise<string[]>;
  try {
    ids = (await import("@/lib/inventory/import-lineage-store")).importManifestIds;
  } catch {
    ids = async () => ["(no lineage store on this code)"];
  }
  const admin = createSupabaseAdminClient();
  await tryIt("IDS A", () => ids(admin, A), (v) => v);
  await tryIt("IDS B", () => ids(admin, B), (v) => v);
  await tryIt("UNDATED A", () => loadUndatedImportLots(A), (v) => ({ found: v.manifestFound, lots: v.lots.map((l) => l.productName).sort(), dated: v.datedCount }));
  await tryIt("UNDATED B", () => loadUndatedImportLots(B), (v) => ({ found: v.manifestFound, lots: v.lots.map((l) => l.productName).sort(), dated: v.datedCount }));
  // Ask to date EVERY seeded lot under import A: only A's undated, non-foreign lots may change.
  await tryIt("SET A", () => setImportLotsReceivedDate(A, [1, 2, 3, 4, 5, 6].map(L), "2024-06-01", null), (v) => [...v].sort());
  const { data } = await admin.from("inventory_lots").select("product_name, received_on").in("id", [1, 2, 3, 4, 5, 6].map(L)).order("id");
  console.log("AFTER", JSON.stringify((data ?? []).map((r) => [r.product_name, r.received_on])));
})();
