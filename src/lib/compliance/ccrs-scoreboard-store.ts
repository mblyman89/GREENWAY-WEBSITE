/**
 * src/lib/compliance/ccrs-scoreboard-store.ts  (R74 S48, Round 29). I/O.
 *
 * Reads the evidence for the CCRS test scoreboard (ccrs-scoreboard-core.ts)
 * from the hub's own record: `ccrs_file_rows` joined to `ccrs_files`. Two
 * small, bounded reads per test (never .limit(>=1000)):
 *   1. the newest rows of this kind CCRS ACCEPTED (file answered, row
 *      submitted/confirmed), so an old pass is never hidden by new traffic;
 *   2. the newest rows of this kind in ANY state (waiting / refused).
 * Read-only. Fault-tolerant: any error returns { available: false } so the
 * hub page never breaks because of the scoreboard.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LedgerEnv } from "./ccrs-ledger-core";
import { buildScoreboard, SCORE_TESTS, type Scoreboard, type ScoreRow, type ScoreTest } from "./ccrs-scoreboard-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ScoreboardRead = { available: true; board: Scoreboard } | { available: false; message: string };

type Raw = {
  state: string;
  operation: string | null;
  payload: Record<string, unknown> | null;
  ccrs_files: { file_name: string; state: string; success_email_at: string | null; error_email_at: string | null } | null;
};

const ANSWERED = ["succeeded", "errored", "reconciling", "closed"];

async function readOne(admin: Admin, env: LedgerEnv, t: ScoreTest, acceptedOnly: boolean): Promise<ScoreRow[]> {
  let q = admin
    .from("ccrs_file_rows")
    .select("state, operation, payload, ccrs_files!inner(file_name, file_type, env, state, success_email_at, error_email_at)")
    .eq("ccrs_files.env", env)
    .eq("ccrs_files.file_type", t.query.fileType);
  if (t.query.operation) q = q.eq("operation", t.query.operation);
  for (const [k, v] of Object.entries(t.query.eq ?? {})) q = q.eq(`payload->>${k}`, v);
  for (const [k, v] of Object.entries(t.query.neq ?? {})) q = q.neq(`payload->>${k}`, v);
  if (acceptedOnly) q = q.in("state", ["submitted", "confirmed"]).in("ccrs_files.state", ANSWERED);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(t.match ? 300 : acceptedOnly ? 20 : 60);
  if (error) throw new Error(`${t.id}: ${error.message}`);
  return ((data as unknown as Raw[] | null) ?? []).map((r) => ({
    rowState: r.state,
    fileState: r.ccrs_files?.state ?? "",
    fileName: r.ccrs_files?.file_name ?? "",
    operation: r.operation,
    payload: r.payload ?? {},
    answeredAt: r.ccrs_files?.success_email_at ?? r.ccrs_files?.error_email_at ?? null,
  }));
}

/**
 * W-2: `acceptedOnly` skips the second read of every test (waiting / refused
 * rows). The Production page shows only the one-line "N of M passed" strip,
 * which needs nothing else, so it makes half the queries. The full PREprod
 * board still reads both.
 */
export async function readCcrsScoreboard(
  admin: Admin,
  env: LedgerEnv = "preprod",
  opts: { acceptedOnly?: boolean } = {},
): Promise<ScoreboardRead> {
  try {
    const pairs = await Promise.all(
      SCORE_TESTS.map(async (t) => {
        const [ok, any] = await Promise.all([
          readOne(admin, env, t, true),
          opts.acceptedOnly ? Promise.resolve([] as ScoreRow[]) : readOne(admin, env, t, false),
        ]);
        return [t.id, [...ok, ...any]] as const;
      }),
    );
    return { available: true, board: buildScoreboard(new Map(pairs)) };
  } catch (e) {
    return { available: false, message: e instanceof Error ? e.message : String(e) };
  }
}
