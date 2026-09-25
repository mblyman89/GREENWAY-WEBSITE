import "server-only";

/**
 * src/lib/leafly/certification-proof-server.ts
 *
 * SLICE L-47 — read the five places where our Leafly activity is recorded and
 * hand them to `certification-proof-core`, which decides everything.
 *
 * ── THE CONTRACT ──────────────────────────────────────────────────────────
 *   * NEVER THROWS. It sits in the integrations page's Promise.all, next to
 *     loaders with the same promise. The most likely time to open that page
 *     is when something is broken, so the proof card must not break it too.
 *   * A READ THAT FAILS is reported as `unreadable` and the core shows
 *     "unknown". It is never turned into an empty list, because an empty list
 *     means "never done" and that would be a lie.
 *   * EXPLICIT COLUMNS, BOUNDED LIMITS, NEWEST FIRST. When a read comes back
 *     full, the rows it feeds are marked `saturated`, so the screen can say
 *     "older rows exist beyond what we read" instead of implying there are none.
 *   * READ ONLY. Nothing here writes.
 *   * NO PERSONAL DATA. No order body, no image, no request body, no URL.
 *     The ledger columns read are operation/status/disposition/time, and the
 *     webhook columns are type/verification/status/time.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readHttpStatus } from "./auth-evidence";
import {
  LEAFLY_PROOF_AUDIT_ACTION_NAMES,
  LEAFLY_PROOF_AUDIT_ACTIONS,
  LEAFLY_PROOF_SOURCES_BY_ACTION,
  assessCertificationProof,
  assessWindowCoverage,
  buildCertificationWindowEmail,
  describeYmd,
  recentBusinessWindow,
  suggestCertificationWindow,
  type CertificationProof,
  type ProofActionId,
  type ProofAuditRow,
  type ProofAutoRunRow,
  type ProofInput,
  type ProofOutboundRow,
  type ProofSource,
  type ProofSyncRunRow,
  type ProofWebhookRow,
  type WindowCoverage,
  type WindowSuggestion,
} from "./certification-proof-core";

/** Newest-N per source. Two weeks of a busy sandbox fits well inside these. */
export const PROOF_READ_LIMITS: Readonly<Record<ProofSource, number>> = {
  sync_runs: 500,
  audit: 1000,
  auto_runs: 500,
  webhooks: 1000,
  outbound: 1000,
};

export const PROOF_SYNC_RUN_COLUMNS = "method, disposition, http_status, trigger_source, started_at";
export const PROOF_AUDIT_COLUMNS = "action, after_json, created_at";
export const PROOF_AUTO_RUN_COLUMNS = "status, payload, message, created_at";
export const PROOF_WEBHOOK_COLUMNS =
  "event_type, signature_verified, rejection_reason, response_status, received_at";
export const PROOF_OUTBOUND_COLUMNS =
  "operation, requested_status, disposition, response_status, refusal_code, attempted_at";

export type CertificationProofView = {
  proof: CertificationProof;
  suggestion: WindowSuggestion;
  /** The last two business days up to now: what the owner could email today. */
  recent: WindowCoverage & { startLabel: string; endLabel: string };
  /** A ready-to-edit email draft for `recent`. */
  recentEmail: string;
  unreadable: ProofSource[];
  environment: "sandbox" | "production";
  /** Non-fatal, shown under the card. Null when every read worked. */
  problem: string | null;
  generatedAt: string;
};

type Read<T> = { rows: T[]; ok: boolean; full: boolean };

async function safeRead<T>(
  limit: number,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<Read<T>> {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`[leafly/proof] ${label} read failed:`, error.message);
      return { rows: [], ok: false, full: false };
    }
    const rows = (Array.isArray(data) ? data : []) as T[];
    return { rows, ok: true, full: rows.length >= limit };
  } catch (err) {
    console.error(`[leafly/proof] ${label} read threw:`, err);
    return { rows: [], ok: false, full: false };
  }
}

function readMethod(afterJson: unknown): string | null {
  if (!afterJson || typeof afterJson !== "object") return null;
  const m = (afterJson as Record<string, unknown>).method;
  return typeof m === "string" && m.trim() !== "" ? m.trim().toUpperCase() : null;
}

/** Length of payload.deleteIds, or 0 when absent/malformed. Exported for tests. */
export function readDeleteCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const ids = (payload as Record<string, unknown>).deleteIds;
  return Array.isArray(ids) ? ids.length : 0;
}

/** True for an automatic run's log row (auto-sync-server always sets payload.automatic). */
export function isAutomaticRun(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const a = (payload as Record<string, unknown>).automatic;
  return typeof a === "string" && a.trim() !== "";
}

/** Which rows a saturated source could be hiding older proof for. */
function saturatedActions(full: readonly ProofSource[]): ProofActionId[] {
  const out: ProofActionId[] = [];
  for (const [id, sources] of Object.entries(LEAFLY_PROOF_SOURCES_BY_ACTION) as [
    ProofActionId,
    readonly ProofSource[],
  ][]) {
    if (sources.some((s) => full.includes(s))) out.push(id);
  }
  return out;
}

export async function loadLeaflyCertificationProof(opts: {
  nowIso?: string;
  environment: "sandbox" | "production";
}): Promise<CertificationProofView> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const environment = opts.environment === "production" ? "production" : "sandbox";

  let input: ProofInput = {
    nowIso,
    environment,
    syncRuns: [],
    audits: [],
    autoRuns: [],
    webhooks: [],
    outbound: [],
  };
  const unreadable: ProofSource[] = [];
  const full: ProofSource[] = [];
  let problem: string | null = null;

  if (!isSupabaseServiceConfigured) {
    unreadable.push("sync_runs", "audit", "auto_runs", "webhooks", "outbound");
    problem = "The database is not connected, so no records could be read.";
  } else {
    try {
      const admin = createSupabaseAdminClient();
      const L = PROOF_READ_LIMITS;
      const [sync, audit, auto, hooks, outbound] = await Promise.all([
        safeRead<{
          method: string | null;
          disposition: string | null;
          http_status: number | null;
          trigger_source: string | null;
          started_at: string | null;
        }>(
          L.sync_runs,
          () =>
            admin
              .from("leafly_sync_runs")
              .select(PROOF_SYNC_RUN_COLUMNS)
              .not("method", "is", null)
              .order("started_at", { ascending: false })
              .limit(L.sync_runs),
          "sync runs",
        ),
        safeRead<{ action: string; after_json: unknown; created_at: string | null }>(
          L.audit,
          () =>
            admin
              .from("audit_logs")
              .select(PROOF_AUDIT_COLUMNS)
              .in("action", [...LEAFLY_PROOF_AUDIT_ACTION_NAMES])
              .order("created_at", { ascending: false })
              .limit(L.audit),
          "audit log",
        ),
        safeRead<{ status: string | null; payload: unknown; message: string | null; created_at: string | null }>(
          L.auto_runs,
          () =>
            admin
              .from("syndication_logs")
              .select(PROOF_AUTO_RUN_COLUMNS)
              .eq("channel", "leafly")
              .eq("mode", "live")
              .like("message", "Automatic%")
              .order("created_at", { ascending: false })
              .limit(L.auto_runs),
          "automatic runs",
        ),
        safeRead<{
          event_type: string | null;
          signature_verified: boolean | null;
          rejection_reason: string | null;
          response_status: number | null;
          received_at: string | null;
        }>(
          L.webhooks,
          () =>
            admin
              .from("leafly_webhook_events")
              .select(PROOF_WEBHOOK_COLUMNS)
              .order("received_at", { ascending: false })
              .limit(L.webhooks),
          "webhook deliveries",
        ),
        safeRead<{
          operation: string | null;
          requested_status: string | null;
          disposition: string | null;
          response_status: number | null;
          refusal_code: string | null;
          attempted_at: string | null;
        }>(
          L.outbound,
          () =>
            admin
              .from("leafly_outbound_attempts")
              .select(PROOF_OUTBOUND_COLUMNS)
              .order("attempted_at", { ascending: false })
              .limit(L.outbound),
          "order calls",
        ),
      ]);

      const note = (src: ProofSource, r: Read<unknown>) => {
        if (!r.ok) unreadable.push(src);
        if (r.full) full.push(src);
      };
      note("sync_runs", sync);
      note("audit", audit);
      note("auto_runs", auto);
      note("webhooks", hooks);
      note("outbound", outbound);

      const syncRuns: ProofSyncRunRow[] = sync.rows.map((r) => ({
        method: r.method,
        disposition: r.disposition,
        httpStatus: r.http_status,
        triggerSource: r.trigger_source,
        at: r.started_at,
      }));
      const audits: ProofAuditRow[] = audit.rows
        .filter((r) => r.action in LEAFLY_PROOF_AUDIT_ACTIONS)
        .map((r) => ({
          action: r.action,
          httpStatus: readHttpStatus(r.after_json),
          method: readMethod(r.after_json),
          at: r.created_at,
        }));
      const autoRuns: ProofAutoRunRow[] = auto.rows
        .filter((r) => isAutomaticRun(r.payload))
        .map((r) => ({ status: r.status, deleteCount: readDeleteCount(r.payload), at: r.created_at }));
      const webhooks: ProofWebhookRow[] = hooks.rows.map((r) => ({
        eventType: r.event_type,
        signatureVerified: r.signature_verified === true,
        rejectionReason: r.rejection_reason,
        responseStatus: r.response_status,
        at: r.received_at,
      }));
      const outboundRows: ProofOutboundRow[] = outbound.rows.map((r) => ({
        operation: r.operation,
        requestedStatus: r.requested_status,
        disposition: r.disposition,
        responseStatus: r.response_status,
        refusalCode: r.refusal_code,
        at: r.attempted_at,
      }));

      input = { ...input, syncRuns, audits, autoRuns, webhooks, outbound: outboundRows };
      if (unreadable.length > 0) {
        problem = `Some records could not be read just now (${unreadable.join(", ")}). Rows that depend on them show \u201cunknown\u201d, not \u201cnever done\u201d.`;
      }
    } catch (err) {
      console.error("[leafly/proof] loader threw:", err);
      for (const s of ["sync_runs", "audit", "auto_runs", "webhooks", "outbound"] as ProofSource[]) {
        if (!unreadable.includes(s)) unreadable.push(s);
      }
      problem = "The records could not be read just now. Refresh to try again.";
    }
  }

  input = { ...input, unreadable, saturated: saturatedActions(full) };

  // Every step below is pure; wrapped anyway so a bug there cannot take the page down.
  try {
    const proof = assessCertificationProof(input);
    const suggestion = suggestCertificationWindow(nowIso);
    const rw = recentBusinessWindow(nowIso);
    const coverage = assessWindowCoverage(input, rw.fromIso, rw.toIso);
    const startLabel = describeYmd(rw.start);
    const endLabel = describeYmd(rw.end);
    const recentEmail = buildCertificationWindowEmail({
      coverage,
      windowStartLabel: startLabel,
      windowEndLabel: endLabel,
    });
    return {
      proof,
      suggestion,
      recent: { ...coverage, startLabel, endLabel },
      recentEmail,
      unreadable,
      environment,
      problem,
      generatedAt: nowIso,
    };
  } catch (err) {
    console.error("[leafly/proof] assessment threw:", err);
    const all: ProofSource[] = ["sync_runs", "audit", "auto_runs", "webhooks", "outbound"];
    const empty: ProofInput = {
      nowIso,
      environment,
      syncRuns: [],
      audits: [],
      autoRuns: [],
      webhooks: [],
      outbound: [],
      unreadable: all,
    };
    const rw = recentBusinessWindow(nowIso);
    const coverage = assessWindowCoverage(empty, rw.fromIso, rw.toIso);
    return {
      proof: assessCertificationProof(empty),
      suggestion: suggestCertificationWindow(nowIso),
      recent: { ...coverage, startLabel: describeYmd(rw.start), endLabel: describeYmd(rw.end) },
      recentEmail: "",
      unreadable: all,
      environment,
      problem: "The proof could not be worked out just now. Refresh to try again.",
      generatedAt: nowIso,
    };
  }
}
