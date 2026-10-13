/** R50 S2c §1.3b: native readers after Apply (run against the harness with the rebuilt manifests present). */
import { listManifests, countManifestsByStatus } from "@/lib/inventory/intake-store";
(async () => {
  const q = await listManifests();
  const all = await listManifests({ includeMigration: true, limit: 2000 });
  const c = await countManifestsByStatus();
  console.log("LIST", JSON.stringify({ queue: q.length, queueNumbers: q.map((m) => m.manifest_number).sort(), exportAll: all.length }));
  console.log("COUNTS", JSON.stringify(c));
})().catch((e) => console.log("THREW", e.message));
