/**
 * src/lib/inventory/cultivera-wcia-backfill.ts   (R50 S12b)
 *
 * The I/O half of "Attach vendor lab results to every Cultivera manifest".
 * Walks the rebuilt manifests in id order (keyset, `id > cursor`), runs the
 * SAME `attachWciaLabResults` Start runs (fill-only, never a destroyed lot,
 * never replaces a certificate), writes the same timeline note per manifest,
 * stops before the time budget and returns the checkpoint. One audit row per
 * click. Never throws to the caller.
 *
 * Writes (all inside attachWciaLabResults, plus the notes): lab_results
 * inserts, inventory_lots.lab_result_id where EMPTY (+ updated_by),
 * manifest_events, one audit row. Nothing else - no status, quantity, cost,
 * CCRS field, price, menu card, draft or accounting row.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import { attachWciaLabResults } from "@/lib/inventory/cultivera-wcia-store";
import { CULTIVERA_WCIA_EVENT, emptyWciaResult, wciaAttachNote, type WciaAttachResult } from "@/lib/inventory/cultivera-wcia-core";
import {
  WCIA_BACKFILL_AUDIT,
  WCIA_BACKFILL_BUDGET_MS,
  WCIA_BACKFILL_PAGE,
  addBackfillResult,
  canStartNext,
  emptyBackfillTotals,
  parseBackfillCursor,
  type WciaBackfillRun,
} from "@/lib/inventory/cultivera-wcia-backfill-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

type ManifestRow = { id: string; manifest_number: string | null; import_id: string | null; cultivera_transfer_id: string | null };

export type WciaBackfillOptions = {
  admin?: Admin;
  now?: () => number;
  budgetMs?: number;
  pageSize?: number;
};

export async function runWciaBackfill(cursorIn: unknown, actorId: string | null, opts: WciaBackfillOptions = {}): Promise<WciaBackfillRun> {
  let totals = emptyBackfillTotals();
  const cursor = parseBackfillCursor(cursorIn);
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: false, error: "the database is not configured", next: cursor, totals };
  const admin = opts.admin ?? createSupabaseAdminClient();
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? WCIA_BACKFILL_BUDGET_MS;
  const pageSize = opts.pageSize ?? WCIA_BACKFILL_PAGE;
  const t0 = now();
  let last = cursor;

  const finish = async (run: WciaBackfillRun): Promise<WciaBackfillRun> => {
    try {
      await recordAudit({
        actorId,
        action: WCIA_BACKFILL_AUDIT,
        entityType: "inbound_manifest",
        entityId: null,
        after: {
          from: cursor,
          next: run.next,
          done: run.ok ? run.done : false,
          error: run.ok ? null : run.error,
          manifests: run.totals.manifests,
          linked: run.totals.linked,
          created: run.totals.created,
          reused: run.totals.reused,
          no_file: run.totals.noFile,
          unreadable: run.totals.unreadable,
          errored: run.totals.errored,
        },
      });
    } catch (err) {
      console.error("[wcia-backfill] audit failed:", err);
    }
    return run;
  };

  for (;;) {
    if (!canStartNext(now() - t0, budget)) return finish({ ok: true, done: false, next: last, totals, elapsedMs: now() - t0 });
    let q = admin
      .from("inbound_manifests")
      .select("id, manifest_number, import_id:raw_payload->>import_id, cultivera_transfer_id:raw_payload->>cultivera_transfer_id")
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND);
    if (last) q = q.gt("id", last);
    const { data, error } = await q.order("id", { ascending: true }).limit(pageSize);
    if (error) return finish({ ok: false, error: `the Cultivera manifests could not be read (${short(error)})`, next: last, totals });
    const rows = (data as ManifestRow[] | null) ?? [];
    for (const m of rows) {
      if (!canStartNext(now() - t0, budget)) return finish({ ok: true, done: false, next: last, totals, elapsedMs: now() - t0 });
      const r: WciaAttachResult = await attachWciaLabResults(admin, m.id, m, actorId).catch(
        (reason: unknown) => emptyWciaResult("error", [short(reason)]),
      );
      totals = addBackfillResult(totals, m.manifest_number || m.id.slice(0, 8), r);
      const note = wciaAttachNote(r);
      // Only a run that changed something (or failed) earns a timeline line: a re-run that links nothing stays quiet.
      if (note && (r.linked > 0 || r.created > 0 || r.status !== "attached" || r.errors.length > 0)) {
        try {
          await admin.from("manifest_events").insert({ manifest_id: m.id, event_type: CULTIVERA_WCIA_EVENT, note, actor_id: actorId });
        } catch (err) {
          console.error("[wcia-backfill] timeline note failed:", err);
        }
      }
      last = m.id.toLowerCase();
    }
    if (rows.length < pageSize) return finish({ ok: true, done: true, next: null, totals, elapsedMs: now() - t0 });
  }
}
