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
import { pullAllPaiReports } from "./pai-client";

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

export type LiveSyncResult =
  | { ok: true; message: string; summary: IngestSummary }
  | { ok: false; error: string; summary?: IngestSummary };

/**
 * Automatic live pull from PAI (Slice A-2c-2).
 *
 * Logs into paireports.com with the saved (encrypted) credentials, downloads
 * the three report CSVs, and feeds them through the SAME verified ingest engine
 * the manual import uses. Report .event paths are confirmed from Michael's
 * portal; the one still-unconfirmed bit (the exact CSV custom-command value) is
 * an OVERRIDABLE default in pai-endpoints.ts — if PAI's account differs, the
 * client detects the HTML-instead-of-CSV response and returns a helpful message
 * rather than importing garbage. Never guesses; never throws to the UI.
 *
 * Works identically with Michael's MAIN login or a future READ-ONLY sub-user.
 */
export async function runAtmLiveSync(): Promise<LiveSyncResult> {
  const pull = await pullAllPaiReports();

  if (!pull.ok) {
    // Record the failure on the health chip and surface the reason plainly.
    await setAtmSyncResult({ ok: false, error: pull.error });
    // Bubble up any per-report reasons we did collect (e.g. one report failed).
    const detail = (pull.reports ?? [])
      .filter((r) => !r.ok)
      .map((r) => (r.ok ? "" : `${r.kind}: ${r.error}`))
      .filter(Boolean)
      .join(" · ");
    return { ok: false, error: detail ? `${pull.error} (${detail})` : pull.error };
  }

  // Collect the CSVs we did get; note any report that failed as a problem.
  const csvs: { cashLoadCsv?: string; simpleSummaryCsv?: string; fundsMovementCsv?: string } = {};
  const problems: string[] = [];
  for (const r of pull.reports) {
    if (r.ok) {
      if (r.kind === "cashLoad") csvs.cashLoadCsv = r.csv;
      else if (r.kind === "simpleSummary") csvs.simpleSummaryCsv = r.csv;
      else if (r.kind === "fundsMovement") csvs.fundsMovementCsv = r.csv;
    } else {
      problems.push(`${r.kind} not downloaded: ${r.error}`);
    }
  }

  // Reuse the verified ingest path (it also records health on completion).
  const ingest = await ingestAtmCsvs(csvs);

  // Fold any download-level problems into the message so nothing is hidden.
  const message = problems.length > 0 ? `${ingest.message} (${problems.length} report(s) skipped)` : ingest.message;

  if (!ingest.ok) return { ok: false, error: message, summary: ingest.summary };
  return { ok: true, message, summary: ingest.summary };
}
