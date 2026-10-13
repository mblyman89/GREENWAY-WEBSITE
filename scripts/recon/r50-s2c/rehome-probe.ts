// R50 S2c: run the REAL re-home store against the local PG15 + PostgREST harness.
// Copy to the repo root to run (it imports @/), then delete. Never shipped.
// Inputs = normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json (rehearsal #2a), seeded by make-seed.py.
import fs from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyRehome, previewRehome, rollbackRehome } from "@/lib/inventory/cultivera-rehome-store";
import type { TransferIndexEntry } from "@/lib/inventory/cultivera-transfer-match-core";

const IMPORT = "5c2c0000-0000-4000-8000-00000000000a";
const FX = JSON.parse(fs.readFileSync("normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json", "utf8")) as {
  rows: [string, string, string | null, number][];
  links: [string, number[]][];
  transfers: TransferIndexEntry[];
};
const sources = {
  lotSources: FX.rows.map(([barcode, vendor, receivedDateRaw, units]) => ({ barcode, vendor, receivedDateRaw, units, productName: "" })),
  transfers: FX.transfers,
  links: new Map(FX.links),
  pacificToday: "2026-10-12",
};
const mode = process.argv[2] ?? "all";

(async () => {
  const admin = createSupabaseAdminClient();
  const t0 = Date.now();
  const p = await previewRehome(admin, IMPORT, sources, { actorId: null });
  console.log("PREVIEW", JSON.stringify({ ok: p.plan.ok, refusals: p.plan.refusals, gate: p.gate.pass, summary: p.plan.summary, totals: p.plan.totals, ms: Date.now() - t0 }));
  console.log("EXCEPTIONS(first 5)", JSON.stringify(p.plan.exceptions.slice(0, 5)));
  if (mode === "preview") return;
  const t1 = Date.now();
  const a = await applyRehome(admin, IMPORT, sources, { actorId: null });
  console.log("APPLY#1", JSON.stringify({ ok: a.ok, created: a.created, reused: a.reused, moved: a.moved, guard: a.skippedByGuard, events: a.eventsLogged, problems: a.problems, ms: Date.now() - t1 }));
  const a2 = await applyRehome(admin, IMPORT, sources, { actorId: null });
  console.log("APPLY#2", JSON.stringify({ ok: a2.ok, created: a2.created, reused: a2.reused, moved: a2.moved, problems: a2.problems }));
  if (mode === "apply") return;
  const r = await rollbackRehome(admin, IMPORT);
  console.log("ROLLBACK", JSON.stringify(r));
  const a3 = await applyRehome(admin, IMPORT, sources, { actorId: null });
  console.log("APPLY#3", JSON.stringify({ ok: a3.ok, created: a3.created, moved: a3.moved, problems: a3.problems }));
})().catch((e) => {
  console.log("THREW", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
