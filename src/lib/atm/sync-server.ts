/**
 * src/lib/atm/sync-server.ts — ATM/PAI Slice A-2c (server-only)
 *
 * The server orchestrator that turns PAI report CSVs into rows in the
 * atm_settlements / atm_cash_loads tables. It is the thin I/O seam between the
 * VERIFIED pure pieces:
 *
 *   atm-core.ts       parses the CSVs → mapper rows (+ per-row problems)
 *   atm-sync-core.ts  turns mapper rows → idempotent UPSERT plans (pure)
 *   store.ts          writes the plans via upsert on the tables' unique keys
 *
 * Two entry points:
 *   • ingestAtmCsvs()  — MANUAL import: Michael pastes/uploads the three PAI
 *     report CSVs and this writes them. Available TODAY; no guessed HTTP.
 *   • runAtmLiveSync() — the automatic pull. HONEST STUB for now: until the
 *     exact PAI live-login form fields + DownloadCSV .event URLs are confirmed
 *     with PAI (Monday), this returns ok:false with a plain-English reason
 *     rather than guessing a single endpoint. The cron + "Sync now" button call
 *     it so the wiring is proven end-to-end; A-2c-2 fills in pai-client.ts.
 *
 * STANDING RULES honored:
 *   • NEVER GUESS — no fabricated PAI endpoints; unknown values stay null.
 *   • MONEY IN CENTS — all amounts are integer cents throughout.
 *   • Errors are recorded (setAtmSyncResult) and RETURNED, never thrown, so the
 *     Health chip and the import result tell the truth instead of 500ing.
 */
import "server-only";
import {
  mapCashLoadCsv,
  mapSimpleSummaryCsv,
  mapFundsMovementCsv,
} from "./atm-core";
import {
  planCashLoadUpserts,
  planSettlementUpserts,
  summarizeIngest,
  ingestResultMessage,
  type IngestSummary,
} from "./atm-sync-core";
import {
  upsertAtmSettlements,
  upsertAtmCashLoads,
  setAtmSyncResult,
} from "./store";

export type IngestAtmCsvsInput = {
  /** ATM Cash Load Report CSV (Trx Time / Cash Load / Balance). */
  cashLoadCsv?: string | null;
  /** Simple Summary Report CSV (counts + surcharge + settlement total). */
  simpleSummaryCsv?: string | null;
  /** Bank Deposits / Funds Movement CSV (the two deposit legs). */
  fundsMovementCsv?: string | null;
};

export type IngestAtmCsvsResult = {
  ok: boolean;
  message: string;
  summary: IngestSummary;
  error?: string;
};

/**
 * Import one or more PAI report CSVs. Any subset may be provided. Blank inputs
 * are skipped. Returns a plain-English message + the structured summary, and
 * records the outcome on the connection health chip. Never throws.
 */
export async function ingestAtmCsvs(
  input: IngestAtmCsvsInput,
): Promise<IngestAtmCsvsResult> {
  const cashLoadCsv = (input.cashLoadCsv ?? "").trim();
  const simpleSummaryCsv = (input.simpleSummaryCsv ?? "").trim();
  const fundsMovementCsv = (input.fundsMovementCsv ?? "").trim();

  if (cashLoadCsv === "" && simpleSummaryCsv === "" && fundsMovementCsv === "") {
    const summary = summarizeIngest({});
    return { ok: false, message: "No report files provided.", summary };
  }

  const mapProblems: string[] = [];

  // 1) Parse each provided CSV via the verified mappers.
  const cashLoadMap = cashLoadCsv ? mapCashLoadCsv(cashLoadCsv) : { rows: [], problems: [] };
  const summaryMap = simpleSummaryCsv ? mapSimpleSummaryCsv(simpleSummaryCsv) : { rows: [], problems: [] };
  const fundsMap = fundsMovementCsv ? mapFundsMovementCsv(fundsMovementCsv) : { rows: [], problems: [] };

  for (const p of cashLoadMap.problems) mapProblems.push(`cash-load row ${p.row}: ${p.message}`);
  for (const p of summaryMap.problems) mapProblems.push(`simple-summary row ${p.row}: ${p.message}`);
  for (const p of fundsMap.problems) mapProblems.push(`funds-movement row ${p.row}: ${p.message}`);

  // 2) Build the deterministic upsert plans (pure).
  const cashLoadPlan = cashLoadCsv ? planCashLoadUpserts(cashLoadMap.rows) : null;
  const settlementPlan =
    simpleSummaryCsv || fundsMovementCsv
      ? planSettlementUpserts(summaryMap.rows, fundsMap.rows)
      : null;

  // 3) Write them (idempotent upserts). Collect any DB error into problems.
  let writeError: string | null = null;

  if (settlementPlan && settlementPlan.upserts.length > 0) {
    const res = await upsertAtmSettlements(settlementPlan.upserts);
    if (!res.ok) {
      writeError = res.error;
      mapProblems.push(`settlements not saved: ${res.error}`);
    }
  }
  if (cashLoadPlan && cashLoadPlan.upserts.length > 0) {
    const res = await upsertAtmCashLoads(cashLoadPlan.upserts);
    if (!res.ok) {
      writeError = res.error;
      mapProblems.push(`cash loads not saved: ${res.error}`);
    }
  }

  const summary = summarizeIngest({ cashLoadPlan, settlementPlan, mapProblems });
  const ok = writeError === null && summary.didSomething;
  const message = writeError
    ? `Import failed: ${writeError}`
    : ingestResultMessage(summary);

  // 4) Record health so the chip reflects this run.
  await setAtmSyncResult({ ok, error: ok ? null : (writeError ?? "No rows imported.") });

  return { ok, message, summary, error: writeError ?? undefined };
}

/**
 * Automatic live pull from PAI. HONEST STUB.
 *
 * The exact PAI live-login form fields and the DownloadCSV `.event` URLs (with
 * date-filter params) are NOT yet confirmed — Michael reaches PAI support
 * Monday, and we will NOT guess a single HTTP detail. Until then this returns a
 * clear, non-alarming message and does NOT flip the health chip to error (this
 * is "not configured yet", not "broken"). A-2c-2 replaces this body with the
 * real pai-client.ts login + DownloadCSV → ingestAtmCsvs() call.
 */
export async function runAtmLiveSync(): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      "Live PAI sync isn’t connected yet. For now, use “Import PAI report CSVs” to " +
      "upload your Cash Load, Simple Summary, and Bank Deposits exports — those load " +
      "instantly. We’ll switch on the automatic daily pull once PAI confirms the exact " +
      "download links (planned after you speak with their support).",
  };
}
