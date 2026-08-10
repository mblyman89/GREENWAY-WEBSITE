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
  buildReportDiagnostic,
  summarizeReportDiagnostics,
  PAI_REPORT_LABEL,
  type PaiReportDiagnostic,
} from "./atm-report-diagnostics";
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
  getAtmConnectionSecrets,
  mergeAtmReportConfig,
} from "./store";
import { pullAllPaiReports, discoverReportFilterFields, verifyDateFieldsByProbe } from "./pai-client";
import { reportKindsMissingDateField, type PaiReportKind } from "./pai-endpoints";
import { mergeDateFieldOverride } from "./pai-discovery";

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
  | { ok: true; message: string; summary: IngestSummary; diagnostics?: PaiReportDiagnostic[] }
  | { ok: false; error: string; summary?: IngestSummary; diagnostics?: PaiReportDiagnostic[] };

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
export async function runAtmLiveSync(options?: {
  /** When true, backfill from the earliest available date (2/29/24) instead of PAI's default window. */
  history?: boolean;
}): Promise<LiveSyncResult> {
  // ------------------------------------------------------------------------
  // SELF-HEAL (history pulls only): make Backfill "just work". PAI only honors
  // our date range when we send each report's EXACT date-column name; any report
  // still on the guessed default is silently un-filtered and returns only PAI's
  // small default window (this is why Cash Loads / Bank Deposits stalled). So
  // before a full-history pull, if any report still lacks a CONFIRMED date
  // column, ask PAI for the real names (read-only) and SAVE them first \u2014 no
  // separate button, no ordering. We DEEP-MERGE so existing confirmations are
  // never clobbered, and we only ever save CONFIDENT picks (ambiguous reports
  // are left alone and reported by the pull's per-report diagnostics, never
  // guessed). Best-effort: a discovery hiccup never blocks the pull itself.
  let selfHealNote = "";
  if (options?.history) {
    selfHealNote = await selfHealDateFields();
  }

  const pull = await pullAllPaiReports(options?.history ? { history: true } : undefined);

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
  // ALSO build an honest PER-REPORT DIAGNOSTIC (row count + earliest→latest date
  // + whether the backfill date filter was applied) so a single backfill run
  // shows exactly what each of the three reports returned — this is how we tell,
  // WITHOUT GUESSING, whether the Bank Deposits / Cash Loads reports simply have
  // shorter PAI history vs. need a different date field vs. failed to parse.
  const csvs: { cashLoadCsv?: string; simpleSummaryCsv?: string; fundsMovementCsv?: string } = {};
  const problems: string[] = [];
  const diagnostics: PaiReportDiagnostic[] = [];
  for (const r of pull.reports) {
    if (r.ok) {
      if (r.kind === "cashLoad") csvs.cashLoadCsv = r.csv;
      else if (r.kind === "simpleSummary") csvs.simpleSummaryCsv = r.csv;
      else if (r.kind === "fundsMovement") csvs.fundsMovementCsv = r.csv;

      // Parse (again, cheaply) just to read out the dates present for the
      // diagnostic. The authoritative write still goes through ingestAtmCsvs.
      let dates: (string | null)[] = [];
      let problemCount = 0;
      if (r.kind === "cashLoad") {
        const m = mapCashLoadCsv(r.csv);
        dates = m.rows.map((x) => x.loadDate);
        problemCount = m.problems.length;
      } else if (r.kind === "simpleSummary") {
        const m = mapSimpleSummaryCsv(r.csv);
        dates = m.rows.map((x) => x.settlementDate);
        problemCount = m.problems.length;
      } else {
        const m = mapFundsMovementCsv(r.csv);
        dates = m.rows.map((x) => x.settlementDate);
        problemCount = m.problems.length;
      }
      diagnostics.push(
        buildReportDiagnostic({
          kind: r.kind,
          downloaded: true,
          dates,
          problemCount,
          dateFilterApplied: r.dateFilterApplied,
          usingDefaultDateField: r.usingDefaultDateField,
        }),
      );
    } else {
      problems.push(`${r.kind} not downloaded: ${r.error}`);
      diagnostics.push(
        buildReportDiagnostic({
          kind: r.kind,
          downloaded: false,
          dates: [],
          problemCount: 0,
          dateFilterApplied: r.dateFilterApplied,
          usingDefaultDateField: r.usingDefaultDateField,
          downloadError: r.error,
        }),
      );
    }
  }

  // Reuse the verified ingest path (it also records health on completion).
  const ingest = await ingestAtmCsvs(csvs);

  // Fold download-level problems AND the per-report diagnostics into the
  // message so nothing is hidden — Michael sees each report's row count + span.
  const diagLine = summarizeReportDiagnostics(diagnostics);
  const skipped = problems.length > 0 ? ` (${problems.length} report(s) skipped)` : "";
  const healPrefix = selfHealNote ? `${selfHealNote} ` : "";
  const message = `${healPrefix}${ingest.message}${skipped} — ${diagLine}`;

  if (!ingest.ok) return { ok: false, error: message, summary: ingest.summary, diagnostics };
  return { ok: true, message, summary: ingest.summary, diagnostics };
}

/**
 * Before a full-history pull, ensure every report has a CONFIRMED date-filter
 * column saved. Returns a short, plain-English note describing what it did (or
 * "" when nothing was needed / possible) \u2014 folded into the pull message so
 * Michael sees it. NEVER throws and NEVER blocks the pull: a discovery/network
 * hiccup just means we proceed with whatever is saved. NEVER guesses \u2014 only
 * PAI-confirmed, confident column names are saved (deep-merged, never clobbering
 * an existing confirmation).
 */
async function selfHealDateFields(): Promise<string> {
  try {
    const secrets = await getAtmConnectionSecrets();
    if (!secrets) return ""; // no creds \u2192 the pull itself returns the helpful message

    const missing = reportKindsMissingDateField(secrets.reportConfig);
    if (missing.length === 0) return ""; // all three already confirmed \u2014 nothing to do

    // We save ONLY keys we can PROVE work. Two evidence sources, in order:
    //   1) EMPIRICAL probe — try each candidate F_ key over the full window and
    //      keep the one that demonstrably widens the returned history. This is
    //      the decisive, no-guess source (works even without Data-API access).
    //   2) FIND_CONFIG discovery — a secondary confirmation for any report the
    //      probe couldn't verify (e.g. a report whose baseline had no rows).
    const toSave: Record<string, string> = {};
    // Per-report probe evidence (which keys were tried + the span each returned),
    // keyed by report kind so we can surface it precisely for whatever stays
    // unconfirmed at the end. `probeError` holds a login/network failure note.
    const probeNoteByKind: Partial<Record<PaiReportKind, string>> = {};
    let probeError = "";

    // 1) PRIMARY: empirical verification.
    const probe = await verifyDateFieldsByProbe(missing);
    if (probe.ok) {
      for (const kind of missing) {
        const v = probe.override[kind];
        if (typeof v === "string" && v.trim() !== "") toSave[kind] = v.trim();
      }
      // Keep each report's note so unconfirmed ones can report exactly why.
      for (const r of probe.reports) probeNoteByKind[r.kind] = r.note;
    } else {
      probeError = probe.error;
    }

    // 2) FALLBACK: FIND_CONFIG for anything still unverified.
    const stillMissing = missing.filter((k) => !(k in toSave));
    if (stillMissing.length > 0) {
      const discovery = await discoverReportFilterFields();
      if (discovery.ok) {
        for (const kind of stillMissing) {
          const v = discovery.override[kind];
          if (typeof v === "string" && v.trim() !== "") toSave[kind] = v.trim();
        }
      }
    }

    if (Object.keys(toSave).length === 0) {
      // Nothing could be PROVEN. Be honest — never guess, never claim a fix.
      const noteParts = missing
        .map((k) => (probeNoteByKind[k] ? `${PAI_REPORT_LABEL[k]}: ${probeNoteByKind[k]}` : ""))
        .filter((s) => s !== "");
      if (probeError !== "") noteParts.unshift(`probe couldn’t run (${probeError})`);
      const detail = noteParts.length > 0 ? ` (${noteParts.join(" | ")})` : "";
      return (
        `Couldn’t confirm a working date filter for ${missing
          .map((k) => PAI_REPORT_LABEL[k])
          .join(", ")} — the report(s) still return only recent data.${detail} ` +
        `Open “Change which report is used (advanced)” to set the column, or share one screenshot ` +
        `of the report’s date-filter box so we can capture the exact field name.`
      );
    }

    const existing = (secrets.reportConfig as Record<string, unknown> | null)?.dateFieldName;
    const merged = mergeDateFieldOverride(existing, toSave);
    const saved = await mergeAtmReportConfig({ dateFieldName: merged });
    if (!saved.ok) {
      return `Confirmed the report date columns but couldn’t save them (${saved.error}); pulling with current settings.`;
    }

    const fixedLabels = Object.keys(toSave).map((k) => PAI_REPORT_LABEL[k as PaiReportKind]);
    const stillUnfixed = missing.filter((k) => !(k in toSave));
    // Surface the EXACT probe evidence for any report we couldn't confirm, even
    // on a partial success, so we can diagnose it (which keys were tried + what
    // date span each returned) instead of guessing why it stayed narrow.
    const unfixedDetail = stillUnfixed
      .map((k) => (probeNoteByKind[k] ? `${PAI_REPORT_LABEL[k]}: ${probeNoteByKind[k]}` : PAI_REPORT_LABEL[k]))
      .join(" | ");
    const tail = stillUnfixed.length > 0 ? ` — still couldn’t confirm ${unfixedDetail}` : "";
    return `Confirmed the date column for ${fixedLabels.join(", ")} by verifying full history was returned — pulling it now.${tail}`;
  } catch {
    // Absolutely never let a self-heal problem break the pull.
    return "";
  }
}
