/**
 * src/lib/inbound-email/llamaparse-status-server.ts  (PR-A — observability)
 *
 * SERVER-ONLY read layer for the LlamaParse parse status. Reads the `ai_usage`
 * ledger (staff RLS, no migration) and hands the raw rows to the PURE
 * llamaparse-status-core to decide what they MEAN.
 *
 * The intake logs one authoritative row per parse tagged with:
 *   feature   = "llamaparse-intake"
 *   entity_type = "manifest"
 *   entity_id = <manifest_number>   (the join key)
 *   ok / error_note / model         (engine + reason)
 *   model prefix "llamaparse" | "unpdf" | "none" encodes the engine that won.
 *
 * READ-ONLY. Never mutates. Returns a neutral status on any failure so the UI
 * degrades to "no AI record" rather than throwing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { logAiUsage } from "@/lib/ai/usage";
import {
  deriveParseStatus,
  type ParseStatus,
  type ParseLedgerRow,
} from "@/lib/inbound-email/llamaparse-status-core";
import type { RecoveryOutcome } from "@/lib/inbound-email/llamaparse-recovery";

/** The feature tag the intake parse writes (see inbound-store). */
const INTAKE_FEATURE = "llamaparse-intake";

/**
 * Write ONE authoritative parse-status row tagged to a staged manifest so the
 * table badge + detail statement can join by manifest_number. Best-effort;
 * never throws (mirrors logAiUsage). The engine is encoded in `model` so the
 * pure core can read it back without a new column (no migration).
 */
export async function recordManifestParseStatus(
  manifestNumber: string | null | undefined,
  outcome: RecoveryOutcome | null,
  actor?: { actorId?: string | null; actorEmail?: string | null },
): Promise<void> {
  if (!manifestNumber || !outcome) return;
  await logAiUsage({
    feature: INTAKE_FEATURE,
    entityType: "manifest",
    entityId: manifestNumber,
    // Engine prefix the reader decodes: "llamaparse" | "unpdf" | "none".
    model: outcome.engine,
    ok: outcome.ok,
    errorNote: outcome.ok ? null : outcome.error ?? outcome.note ?? "parse did not run",
    actorId: actor?.actorId ?? null,
    actorEmail: actor?.actorEmail ?? null,
  });
}

/** Neutral "no record" status (mirrors the pure core's empty case). */
function emptyStatus(): ParseStatus {
  return deriveParseStatus([]);
}

/**
 * Row shape as stored: `model` carries the engine prefix ("llamaparse-max",
 * "unpdf", "none"), so the pure core can infer the engine even without a
 * dedicated column. We ALSO pass `model` through so classification works.
 */
type RawRow = {
  created_at: string;
  ok: boolean | null;
  error_note: string | null;
  model: string | null;
  entity_id: string | null;
};

function toLedgerRow(r: RawRow): ParseLedgerRow {
  const model = r.model ?? "";
  const engine =
    model.startsWith("llamaparse") || model.includes("llama")
      ? "llamaparse"
      : model.startsWith("unpdf")
      ? "unpdf"
      : model.startsWith("none")
      ? "none"
      : null;
  return {
    created_at: r.created_at,
    ok: Boolean(r.ok),
    error_note: r.error_note,
    model: r.model,
    engine,
  };
}

/**
 * Parse status for MANY manifests at once (the intake table). Returns a Map
 * keyed by manifest_number. Manifests with no ledger row simply don't appear
 * in the map (the UI treats "missing" the same as the neutral empty status).
 */
export async function getParseStatusByManifestNumber(
  manifestNumbers: (string | null | undefined)[],
): Promise<Map<string, ParseStatus>> {
  const out = new Map<string, ParseStatus>();
  const ids = Array.from(
    new Set(manifestNumbers.filter((n): n is string => typeof n === "string" && n.length > 0)),
  );
  if (ids.length === 0 || !isSupabaseServiceConfigured) return out;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ai_usage")
      .select("created_at, ok, error_note, model, entity_id")
      .eq("feature", INTAKE_FEATURE)
      .eq("entity_type", "manifest")
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return out;

    // Group rows by manifest number, newest first (query already ordered).
    const byId = new Map<string, ParseLedgerRow[]>();
    for (const r of data as RawRow[]) {
      const key = r.entity_id ?? "";
      if (!key) continue;
      const arr = byId.get(key) ?? [];
      arr.push(toLedgerRow(r));
      byId.set(key, arr);
    }
    for (const [key, rows] of byId) out.set(key, deriveParseStatus(rows));
    return out;
  } catch {
    return out;
  }
}

/** Parse status for a SINGLE manifest (the detail page). */
export async function getParseStatusForManifestNumber(
  manifestNumber: string | null | undefined,
): Promise<ParseStatus> {
  if (!manifestNumber) return emptyStatus();
  const map = await getParseStatusByManifestNumber([manifestNumber]);
  return map.get(manifestNumber) ?? emptyStatus();
}
