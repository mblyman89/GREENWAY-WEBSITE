import "server-only";

/**
 * src/lib/leafly/readback-proof-server.ts
 *
 * SLICE L-52 -- load the newest stored read-back verdict for the certification
 * gate (criterion 5, "Data quality").
 *
 * WHY A DEDICATED READ: the integrations page loads only the newest 40
 * syndication_logs rows, and every automatic sync writes a row. A read-back
 * pressed in the morning would scroll out of that window by the afternoon and
 * criterion 5 would fall back to "never been read back" -- the exact symptom
 * this slice fixes. So the verdict row is looked up by its marker, not by
 * position, and only the successful live pushes AFTER it are counted.
 *
 * CONTRACT:
 *   * NEVER THROWS. On any read failure it falls back to the rows the page
 *     already has (`fallbackRows`), which is at worst the old behaviour.
 *   * READ ONLY. Explicit columns, bounded limits, newest first.
 *   * All decisions stay in `readback-proof-core` (pure, self-tested).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  READBACK_VERDICT_KIND,
  readReadbackProof,
  type ProofLogRow,
  type ReadbackProof,
} from "./readback-proof-core";

/** Upper bound on pushes counted after a verdict (disclosure only). */
const PUSHES_SINCE_LIMIT = 500;

export async function loadLeaflyReadbackProof(
  fallbackRows: readonly ProofLogRow[],
): Promise<ReadbackProof> {
  const fallback = () => readReadbackProof(fallbackRows);
  if (!isSupabaseServiceConfigured) return fallback();
  try {
    const admin = createSupabaseAdminClient();
    const { data: verdictRows, error } = await admin
      .from("syndication_logs")
      .select("mode,status,payload,created_at")
      .eq("channel", "leafly")
      .eq("mode", "preview")
      .eq("payload->>kind", READBACK_VERDICT_KIND)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[leafly] loadLeaflyReadbackProof verdict read error:", error.message);
      return fallback();
    }
    const verdictRow = (verdictRows ?? [])[0] as ProofLogRow | undefined;
    if (!verdictRow || !verdictRow.created_at) {
      // No verdict row exists at all -- the core reports "none" honestly.
      return readReadbackProof([]);
    }
    const { data: pushRows, error: pushError } = await admin
      .from("syndication_logs")
      .select("mode,status,created_at")
      .eq("channel", "leafly")
      .eq("mode", "live")
      .eq("status", "ok")
      .gt("created_at", verdictRow.created_at)
      .order("created_at", { ascending: false })
      .limit(PUSHES_SINCE_LIMIT);
    // A failed count read only loses the disclosure, never the verdict.
    if (pushError) {
      console.error("[leafly] loadLeaflyReadbackProof push-count read error:", pushError.message);
    }
    const pushes: ProofLogRow[] = pushError
      ? []
      : (pushRows ?? []).map((r) => ({
          mode: String((r as { mode: unknown }).mode),
          status: String((r as { status: unknown }).status),
          payload: null,
          created_at: (r as { created_at: string | null }).created_at,
        }));
    return readReadbackProof([...pushes, verdictRow]);
  } catch (err) {
    console.error(
      "[leafly] loadLeaflyReadbackProof failed:",
      err instanceof Error ? err.message : String(err),
    );
    return fallback();
  }
}
