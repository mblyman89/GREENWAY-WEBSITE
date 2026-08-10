"use server";

/**
 * /admin/atm server actions — ATM/PAI Slice A-2a (settings.manage = owner + admin).
 *
 * Mirrors src/app/admin/settings/banking/vault-actions.ts: gate with
 * requirePermission, do the work in the server-only store (secrets encrypted
 * there), write an audit entry with NO secret in it, then revalidate + redirect
 * back to the page with a friendly msg/error.
 *
 * A-2a only saves/clears the PAI connection config. "Test connection" and the
 * live sync arrive in A-2b (pai-client.ts / sync-server.ts).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  saveAtmConnection,
  clearAtmCredentials,
  insertManualCashLoad,
  mergeAtmReportConfig,
} from "@/lib/atm/store";
import { ingestAtmCsvs, runAtmLiveSync } from "@/lib/atm/sync-server";
import { discoverReportFilterFields } from "@/lib/atm/pai-client";
import { validateManualCashLoad } from "@/lib/atm/atm-ui-core";

const ROOT = "/admin/atm";

function back(qs: { tab?: string; msg?: string; error?: string }): never {
  const p = new URLSearchParams({ tab: qs.tab ?? "health" });
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  redirect(`${ROOT}?${p.toString()}`);
}

export async function saveAtmConnectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const portalBaseUrl = String(formData.get("portal_base_url") ?? "").trim();
  const terminalId = String(formData.get("terminal_id") ?? "").trim();
  const companyLabel = String(formData.get("company_label") ?? "").trim();
  const username = String(formData.get("pai_username") ?? "").trim();
  const password = String(formData.get("pai_password") ?? ""); // may be blank = keep existing

  const result = await saveAtmConnection({
    portalBaseUrl,
    terminalId,
    companyLabel,
    username,
    password,
  });

  if (!result.ok) back({ error: result.error });

  // Audit: record WHAT changed, never the secret. We log only non-sensitive
  // identity fields + whether a new password was set.
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.credentials.saved",
    entityType: "atm_connection",
    entityId: terminalId || null,
    after: {
      portal_base_url: portalBaseUrl,
      terminal_id: terminalId,
      company_label: companyLabel,
      username_set: username.length > 0,
      password_changed: password.length > 0,
    },
  });

  back({ msg: "PAI connection saved." });
}

export async function clearAtmCredentialsAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const result = await clearAtmCredentials();
  if (!result.ok) back({ error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.credentials.cleared",
    entityType: "atm_connection",
    entityId: null,
  });

  back({ msg: "PAI credentials cleared." });
}

/**
 * Record a hand-entered cash load (Cash Loads tab, optional owner fallback per
 * the bible). Cash loads normally pull automatically from PAI; this is here for
 * the rare case Michael loads cash before the auto-pull runs. Amount is parsed
 * to integer CENTS by the pure validator (never guessed). Audit `atm.load.recorded`
 * carries the amount + date but no secret.
 */
export async function recordManualCashLoadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const terminalId = String(formData.get("terminal_id") ?? "").trim();
  const amount = String(formData.get("amount") ?? "");
  const date = String(formData.get("load_date") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const parsed = validateManualCashLoad({ amount, date });
  if (!parsed.ok) back({ tab: "loads", error: parsed.error });
  if (!terminalId) back({ tab: "loads", error: "Enter the terminal number (e.g. HG26499)." });

  const result = await insertManualCashLoad({
    terminalId,
    loadedAtIso: parsed.isoDate,
    cents: parsed.cents,
    note,
  });
  if (!result.ok) back({ tab: "loads", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.load.recorded",
    entityType: "atm_cash_loads",
    entityId: terminalId,
    after: {
      terminal_id: terminalId,
      load_date: parsed.isoDate,
      cash_load_cents: parsed.cents,
      source: "manual",
      has_note: note.length > 0,
    },
  });

  back({ tab: "loads", msg: "Cash load recorded." });
}

/**
 * Manually import PAI report CSVs (Health tab). Michael pastes/uploads any of
 * the three exports (Cash Load, Simple Summary, Bank Deposits) and this ingests
 * them via the server orchestrator (parse → plan → idempotent upsert). Safe to
 * re-run: the same report overwrites rather than duplicating. Audit
 * `atm.sync.manual` records counts + problem count, never file contents.
 */
export async function importAtmCsvsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const cashLoadCsv = String(formData.get("cash_load_csv") ?? "");
  const simpleSummaryCsv = String(formData.get("simple_summary_csv") ?? "");
  const fundsMovementCsv = String(formData.get("funds_movement_csv") ?? "");

  const result = await ingestAtmCsvs({ cashLoadCsv, simpleSummaryCsv, fundsMovementCsv });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.sync.manual",
    entityType: "atm_connection",
    entityId: null,
    after: {
      ok: result.ok,
      settlements_upserted: result.summary.settlementsUpserted,
      cash_loads_upserted: result.summary.cashLoadsUpserted,
      problem_count: result.summary.problems.length,
    },
  });

  if (result.ok) back({ tab: "health", msg: result.message });
  back({ tab: "health", error: result.message });
}

/**
 * "Sync now (live)" button (Health tab). Attempts the automatic PAI pull. Until
 * the live login/download is wired (A-2c-2, after PAI support confirms the
 * exact endpoints), this returns an honest "not connected yet" message pointing
 * Michael at the manual import above. Never guesses an endpoint.
 */
export async function runAtmLiveSyncAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const result = await runAtmLiveSync();

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.sync.live",
    entityType: "atm_connection",
    entityId: null,
    after: {
      ok: result.ok,
      settlements_upserted: result.summary?.settlementsUpserted ?? 0,
      cash_loads_upserted: result.summary?.cashLoadsUpserted ?? 0,
      report_diagnostics: (result.diagnostics ?? []).map((d) => ({
        kind: d.kind,
        downloaded: d.downloaded,
        rows: d.rowCount,
        min_date: d.minDate,
        max_date: d.maxDate,
        date_filter_applied: d.dateFilterApplied,
        using_default_date_field: d.usingDefaultDateField,
        note: d.note,
      })),
    },
  });

  if (result.ok) back({ tab: "health", msg: result.message });
  back({ tab: "health", error: result.error });
}

/**
 * "Backfill history" button (Health tab). Same live PAI pull, but requests the
 * FULL history window — from the earliest available date (2/29/2024, confirmed
 * by Michael; overridable via report_config.historyStart) through today —
 * instead of PAI's small default window. Use this once to load everything, then
 * the daily sync keeps it current. Audit: atm.sync.backfill.
 */
export async function runAtmBackfillAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const result = await runAtmLiveSync({ history: true });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.sync.backfill",
    entityType: "atm_connection",
    entityId: null,
    after: {
      ok: result.ok,
      settlements_upserted: result.summary?.settlementsUpserted ?? 0,
      cash_loads_upserted: result.summary?.cashLoadsUpserted ?? 0,
      // Durable per-report record so we can see (without guessing) whether Bank
      // Deposits / Cash Loads simply lack older PAI history vs. need a different
      // date field vs. failed to parse: row count + date span per report.
      report_diagnostics: (result.diagnostics ?? []).map((d) => ({
        kind: d.kind,
        downloaded: d.downloaded,
        rows: d.rowCount,
        min_date: d.minDate,
        max_date: d.maxDate,
        date_filter_applied: d.dateFilterApplied,
        using_default_date_field: d.usingDefaultDateField,
        note: d.note,
      })),
    },
  });

  if (result.ok) back({ tab: "health", msg: result.message });
  back({ tab: "health", error: result.error });
}

/**
 * "Discover report fields (no F12)" button (Health tab). Signs in to PAI with
 * the saved credentials and asks PAI itself for each report's REAL date-filter
 * column name — the no-F12 answer to why Bank Deposits / Cash Loads only pulled
 * PAI's default window. It ONLY READS from PAI. When PAI confidently reports a
 * real date column for a report, we store it as the per-report
 * report_config.dateFieldName override (a data change), so the next Backfill
 * pulls that report's FULL history. Ambiguous/failed reports are reported, never
 * guessed. Audit: atm.discover.fields (records the discovered names, no secrets).
 */
export async function discoverPaiReportFieldsAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const result = await discoverReportFilterFields();

  if (!result.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.profile.email,
      action: "atm.discover.fields",
      entityType: "atm_connection",
      entityId: null,
      after: { ok: false, error: result.error },
    });
    back({ tab: "health", error: result.error });
  }

  // Apply the confident per-report overrides (merge — never clobber other keys).
  let applied = false;
  if (Object.keys(result.override).length > 0) {
    const saved = await mergeAtmReportConfig({ dateFieldName: result.override });
    applied = saved.ok;
    if (!saved.ok) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.profile.email,
        action: "atm.discover.fields",
        entityType: "atm_connection",
        entityId: null,
        after: { ok: true, applied: false, save_error: saved.error, discovered: result.override },
      });
      back({ tab: "health", error: `Discovered the fields but couldn’t save them: ${saved.error}` });
    }
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "atm.discover.fields",
    entityType: "atm_connection",
    entityId: null,
    after: {
      ok: true,
      applied,
      discovered: result.override,
      reports: result.discoveries.map((d) => ({
        kind: d.kind,
        matched_name: d.matched?.name ?? null,
        date_field: d.datePick.fieldName || null,
        filter_key: d.datePick.filterKey || null,
        reason: d.datePick.reason,
        confident: d.datePick.confident,
        date_candidates: d.datePick.dateCandidates,
      })),
    },
  });

  const appliedCount = Object.keys(result.override).length;
  const lead = applied
    ? `Discovered and saved ${appliedCount} report date field(s). Now click “Backfill history” to pull full history for all three.`
    : "Discovery finished — but I didn’t save anything automatically (see the per-report notes).";
  // The multi-line summary is passed through as the friendly message.
  back({ tab: "health", msg: `${lead}\n${result.summary}` });
}
