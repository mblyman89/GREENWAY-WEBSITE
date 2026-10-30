/**
 * src/app/admin/compliance/ccrs/page.tsx  (Task W)
 *
 * THE CCRS COMPLIANCE REPORTING COMMAND CENTER — the owner's hand-held,
 * hardened weekly upload cockpit:
 *
 *   1. Weekly deadline banner (Sun–Sat week, due the following Sunday) with the
 *      most-urgent unresolved week front and center.
 *   2. Week picker → activity review → validation gate verdict (the SAME
 *      authoritative gate the zip download enforces).
 *   3. Guided upload walkthrough with the CCRS dependency order and built-in
 *      10-minute wait timers.
 *   4. Record the week (submitted / nothing-to-report) → submission ledger with
 *      who/when/on-time evidence.
 *   5. Error-email triage + DRAFTS-ONLY examiner escalation.
 *   6. DOH / medical panel (4-leg exemption checkpoints + weekly exempt-sale
 *      evidence) — there is no separate DOH upload; the legs live in CCRS + LIQ.
 *   7. Monthly LIQ-1295 deadline strip + reminders status (email/push, daily cron).
 *
 * Everything mutating is permission-gated + audited; AI is drafts-only.
 */
import Link from "next/link";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { StatCard } from "@/components/admin/StatCard";
import { SaveButton } from "@/components/admin/orders/SaveButton";
import { PendingSubmit } from "@/components/admin/compliance/PendingSubmit";
import { pacificToday } from "@/lib/reports/timezone";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
import { assertCcrsBatchSubmittable, toGateInput } from "@/lib/compliance/ccrs-submit-gate-core";
import { CcrsIssueList } from "@/components/admin/compliance/CcrsIssueList";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import { getCcrsFilingOverview } from "@/lib/compliance/ccrs-filing-status";
import { weekFromKey, type WeekDeadline } from "@/lib/compliance/ccrs-week-core";
import { getWeeklyOverview, listWeekSubmissions } from "@/lib/compliance/ccrs-week-store";
import { getEndorsementConfig } from "@/lib/medical/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { CcrsAdvisorPanel } from "@/components/admin/reports/CcrsAdvisorPanel";
import { PushRemindersPanel } from "@/components/admin/compliance/PushRemindersPanel";
import { UploadWalkthrough } from "@/components/admin/compliance/UploadWalkthrough";
import { ErrorTriagePanel } from "@/components/admin/compliance/ErrorTriagePanel";
import {
  resolveWeekAction,
  unresolveWeekAction,
  setWeekErrorStatusAction,
  assignProductIdsAction,
  markUploadedAction,
  recordSuccessAction,
  recordErrorAction,
  recordNoEmailAction,
  abandonFileAction,
  startPreprodLedgerAction,
  settlePreprodDuplicatesAction,
  assignPreprodProductIdsAction,
  setObligationStartAction,
  setHandoverFactsAction,
  dismissPeriodAction,
  undoDismissalAction,
  ccrsCleanupAction,
} from "./actions";
import { getObligationContext, listRecentWaivers } from "@/lib/compliance/obligation-waiver-store";
import { getHandoverFacts } from "@/lib/compliance/ccrs-handover-store";
import { planHandover } from "@/lib/compliance/ccrs-handover-core";
import { HandoverPlanCard } from "@/components/admin/compliance/HandoverPlanCard";
import { validateDismissal, REASON_MIN, REASON_MAX } from "@/lib/compliance/obligation-waiver-core";
import { CcrsFilesPanel } from "@/components/admin/compliance/CcrsFilesPanel";
import { CcrsMailPanel, type CcrsMailPanelRow } from "@/components/admin/compliance/CcrsMailPanel";
import { flashFrom, hubWeekLink } from "@/lib/compliance/ccrs-hub-flow-core";
import { listRecentCcrsMail } from "@/lib/compliance/ccrs-mail-store";
import { readCcrsScoreboard } from "@/lib/compliance/ccrs-scoreboard-store";
import { CcrsScoreboardPanel } from "@/components/admin/compliance/CcrsScoreboardPanel";
import { buildCcrsStrategy } from "@/lib/compliance/ccrs-strategy-core";
import { errorsFromStored, mailConfigFromEnv } from "@/lib/compliance/ccrs-mail-core";
import { parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";
import {
  applyAllCcrsMailAction,
  applyCcrsErrorMailAction,
  applyCcrsNotProcessedMailAction,
  applyCcrsSuccessMailAction,
  dismissCcrsMailAction,
  pollCcrsMailNowAction,
} from "./mail-actions";
import { MigrationGarbagePanel } from "@/components/admin/compliance/MigrationGarbagePanel";
import { CcrsIdentityProofPanel } from "@/components/admin/compliance/CcrsIdentityProofPanel";
import { loadMigrationGarbage } from "@/lib/compliance/ccrs-migration-garbage-store";
import { listCcrsFiles, listCcrsFilesLite } from "@/lib/compliance/ccrs-ledger-store";
import { medicalSaleRowCount, pickSelectedWeek, recordGate, settle, waitingFilesOfEnv, WAITING_STATES } from "@/lib/compliance/ccrs-hub-view-core";
import { CCRS_UPLOAD_ORDER } from "@/lib/compliance/ccrs-batch-core";
import type { CcrsBatch } from "@/lib/compliance/ccrs-batch";
import { readOwed } from "@/lib/compliance/ccrs-held-store";
import { owedByWeek, owedSentence } from "@/lib/compliance/ccrs-held-back-core";
import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
import { ccrsPortalUrl } from "@/lib/compliance/ccrs-lifecycle-core";
import { isUnansweredState, unansweredWarningLines } from "@/lib/compliance/ccrs-answer-core";

export const dynamic = "force-dynamic";
// W-1 (2026-10-30): the page builds the week's batch, and its server actions
// (email Apply, week sign-off) re-read files and rows. A page-level
// maxDuration also covers every server action posted from this page
// (Next docs: route-segment-config/maxDuration). Same ceiling as /records.
export const maxDuration = 300;

function Section({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const STATUS_META: Record<
  WeekDeadline["status"],
  { label: string; pill: string }
> = {
  in_progress: { label: "In progress", pill: "bg-white/10 text-white/60" },
  open: { label: "Ready to submit", pill: "bg-sky-500/20 text-sky-200" },
  due_today: { label: "DUE TODAY", pill: "bg-orange-500/25 text-orange-200" },
  overdue: { label: "OVERDUE", pill: "bg-red-500/25 text-red-200" },
  submitted: { label: "Submitted", pill: "bg-emerald-500/20 text-emerald-200" },
  nothing_to_report: { label: "Nothing to report", pill: "bg-emerald-500/15 text-emerald-200/80" },
  // S-12d
  before_start: { label: "Before sales start", pill: "bg-white/5 text-white/40" },
  dismissed: { label: "Dismissed", pill: "bg-violet-500/15 text-violet-200/80" },
};

/** S-12d: monthly LIQ-1295 status words for the owner. */
const MONTH_STATUS_LABEL: Record<string, string> = {
  filed: "export on record",
  before_start: "before sales start (not tracked)",
  dismissed: "dismissed",
  overdue: "overdue",
  due_today: "due today",
  due_soon: "due soon",
  upcoming: "upcoming",
};

/** S-12d: the small "dismiss with a reason" form, used for weeks and months. */
function DismissForm({
  obligation,
  periodKey,
  weekKey,
  env,
  label,
}: {
  obligation: "ccrs_weekly" | "liq1295";
  periodKey: string;
  weekKey: string;
  env: string;
  label: string;
}) {
  return (
    <form action={dismissPeriodAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="obligation" value={obligation} />
      <input type="hidden" name="period_key" value={periodKey} />
      <input type="hidden" name="week_key" value={weekKey} />
      <input type="hidden" name="env" value={env} />
      <label className="min-w-[16rem] flex-1 text-[11px] text-white/50">
        Reason ({REASON_MIN} to {REASON_MAX} characters, kept forever)
        <input
          name="reason"
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          placeholder="e.g. Filed by Cultivera, our integrator, before we took over"
          className="mt-1 block w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
        />
      </label>
      <SaveButton variant="neutral" size="sm" label={label} busyLabel="Saving..." />
    </form>
  );
}

function UndoDismissForm({ waiverId, weekKey, env }: { waiverId: string; weekKey: string; env: string }) {
  return (
    <form action={undoDismissalAction} className="inline">
      <input type="hidden" name="waiver_id" value={waiverId} />
      <input type="hidden" name="week_key" value={weekKey} />
      <input type="hidden" name="env" value={env} />
      <SaveButton variant="danger" size="sm" label="Undo dismissal" busyLabel="Undoing..." />
    </form>
  );
}

/**
 * W-2: an async server component that waits for ONE promise and renders its
 * children with the value. Wrapped in <Suspense>, it lets the page shell show
 * at once while the heavy panels (the week's batch build, the scoreboard, the
 * files list, the clean-up scan) stream in. Every promise handed to it is
 * settled first (ccrs-hub-view-core `settle`), so it never throws.
 */
async function Await<T>({ p, children }: { p: Promise<T>; children: (v: T) => React.ReactNode }) {
  return <>{children(await p)}</>;
}

/** W-2: what a streamed panel shows while it loads. */
function Pending({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 text-xs text-white/40 ${tall ? "py-8" : "py-3"}`}
      data-testid="ccrs-pending"
      aria-busy="true"
    >
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      Loading {label}... the rest of the page already works.
    </div>
  );
}

/** W-2: a streamed panel whose read failed. The page around it keeps working. */
function PanelFailed({ what, error }: { what: string; error: string }) {
  return (
    <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-100" data-testid="ccrs-panel-failed">
      Could not load {what}: {error}. Everything else on this page still works; reload to try again.
    </p>
  );
}

/** W-2: everything Step 2, Step 3 and the upload panels need from the week's build. */
type WeekView = {
  batch: CcrsBatch | null;
  buildError: string | null;
  verdict: ReturnType<typeof assertCcrsBatchSubmittable> | null;
  submittable: boolean;
  errors: ReturnType<typeof assertCcrsBatchSubmittable>["errors"];
  warnings: ReturnType<typeof assertCcrsBatchSubmittable>["warnings"];
  held: ReturnType<typeof assertCcrsBatchSubmittable>["held"];
  totalRecords: number;
  nothingToReport: boolean;
  medicalSaleRows: number;
};

function weekViewOf(batch: CcrsBatch | null, buildError: string | null): WeekView {
  const verification = batch
    ? verifyCcrsBatch(batch.files.map((f) => ({ type: f.type, csv: f.csv })))
    : null;
  const verdict = batch
    ? assertCcrsBatchSubmittable({
        syncIssues: batch.syncIssues.map(toGateInput),
        verifierProblems: (verification?.problems ?? []).map((p) => ({
          severity: p.severity,
          file: String(p.file),
          message: p.message,
        })),
        files: batch.files.map((f) => ({ type: f.type, warnings: f.warnings, empty: f.empty })),
        classifyWarning,
      })
    : null;
  const errors = verdict?.errors ?? [];
  const totalRecords = batch?.totalRecords ?? 0;
  return {
    batch,
    buildError,
    verdict,
    submittable: verdict?.submittable ?? false,
    errors,
    warnings: verdict?.warnings ?? [],
    // R74 S39: records left out of the files (still owed) never block the good rows.
    held: verdict?.held ?? [],
    totalRecords,
    nothingToReport: totalRecords === 0 && errors.length === 0,
    medicalSaleRows: medicalSaleRowCount(batch?.files ?? null),
  };
}

export default async function CcrsCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; saved?: string; error?: string; note?: string; env?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;
  const todayIso = pacificToday();
  // S-12c: which CCRS the page works against. Anything but "preprod" is prod.
  const env = parseLedgerEnv(sp.env);
  const envQ = env === "preprod" ? "&env=preprod" : "";
  // W-1: one flash for the whole page (top, sticky) and the email panel.
  const flash = flashFrom(sp);

  // ── Weekly deadline picture ────────────────────────────────────────────────
  // W-2 (2026-10-30): the page used to wait for EVERYTHING (the full batch
  // build, the 36-query scoreboard, every file's issues, the clean-up scan)
  // before it showed a single button. Now only the small reads below are
  // awaited (one wave); the heavy ones START here and stream into their own
  // <Suspense> panels. Each heavy promise is settled, so a failed panel says
  // so in place and never blanks the page.
  // S-12d: first day of sales + dismissals (fails safe: empty = nags as before).
  const obligationCtxP = getObligationContext();
  const admin0 = isSupabaseServiceConfigured ? createSupabaseAdminClient() : null;
  const [
    overview,
    obligationCtx,
    handoverFacts,
    waiverHistory,
    ledger,
    license,
    waitingFiles,
    ccrsMail,
    endorsement,
    filing,
  ] = await Promise.all([
    getWeeklyOverview({ lookbackWeeks: 6 }),
    obligationCtxP,
    // S-17d: the integrator hand-over plan (first upload date, overlap and lateness warnings).
    getHandoverFacts(),
    isSupabaseServiceConfigured ? listRecentWaivers(20) : Promise.resolve([]),
    isSupabaseServiceConfigured ? listWeekSubmissions(12) : Promise.resolve([]),
    getCcrsLicenseSettings(),
    // W-2: the files still waiting for CCRS's answer, BOTH envs, one light query
    // (no issues). The email picker filters per email; the warning shows this env's.
    admin0
      ? settle(listCcrsFilesLite(admin0, ["prod", "preprod"], WAITING_STATES, CCRS_UPLOAD_ORDER, 200))
      : Promise.resolve({ ok: true as const, value: [] }),
    // S-18a: CCRS emails read from the submitting mailbox (drafts until the owner applies them).
    listRecentCcrsMail(25),
    getEndorsementConfig(),
    // Monthly LIQ-1295 strip.
    obligationCtxP.then((ctx) => getCcrsFilingOverview(todayIso, { lookbackMonths: 2, ctx })),
  ]);
  const handoverPlan = planHandover({ greenwayFirstSaleDate: obligationCtx.startDate, facts: handoverFacts, todayIso });
  const waitingAll = waitingFiles.ok ? waitingFiles.value : [];
  const waitingHere = waitingFilesOfEnv(waitingAll, env);

  // Selected week: explicit ?week= → most urgent unresolved → last completed.
  const requested = sp.week ? weekFromKey(sp.week) : null;
  const selectedDeadline: WeekDeadline = pickSelectedWeek(overview, requested?.key ?? null);
  const week = selectedDeadline.week;
  const weekCompleted = todayIso > week.end;
  const ledgerRow = ledger.find((r) => r.week_key === week.key) ?? null;

  // ── Heavy reads: started now, streamed into their panels ──────────────────
  // Batch + authoritative gate for the selected week (built ONCE per render;
  // every panel that needs it awaits the same promise).
  const range = resolveRange({ from: week.start, to: week.end });
  const weekP: Promise<WeekView> = settle(() =>
    isSupabaseServiceConfigured
      ? buildCcrsBatch(range.fromISO, range.toISO, { env })
      : Promise.resolve(null),
  ).then((r) => (r.ok ? weekViewOf(r.value, null) : weekViewOf(null, r.error)));
  // S-12c: every file of this env with its issues (only the files panel needs the issues).
  const filesP = settle(() =>
    admin0
      ? listCcrsFiles(admin0, env)
      : Promise.resolve({ available: false, files: [], issues: [], error: null }),
  );
  // R74 S39: every record an earlier upload held back and still owes CCRS.
  const owedP = settle(() =>
    admin0 ? readOwed(admin0, env) : Promise.resolve({ available: false, rows: [], error: null }),
  );
  // R74 S48: the PREprod test scoreboard. On Production only the one-line
  // strip shows, which needs only the ACCEPTED reads (W-2: half the queries).
  const scoreboardP = admin0
    ? readCcrsScoreboard(admin0, "preprod", { acceptedOnly: env !== "preprod" })
    : Promise.resolve({ available: false as const, message: "database not configured" });
  // R50 S10c (D-15): dead records the Cultivera migration brought in. Read-only.
  const migrationGarbageP = settle(async () => (isSupabaseServiceConfigured ? await loadMigrationGarbage(env) : null));

  // ── DOH / medical evidence for the week (streams with the medical panel) ──
  const EXEMPT_SCAN_MAX_ROWS = 100_000;
  // SLICE 5B: this is the WAC 314-55-090(2) excise-exemption evidence (5-year
  // retention duty), and it sat EXACTLY on PostgREST's 1,000-row cap — the one
  // value where `.limit(1000)` looks deliberate but silently becomes a ceiling
  // the moment a busy week crosses it. A short read under-reports exempt
  // excise with no visible sign. Paged completely, and when the read cannot be
  // proven complete the panel says so instead of showing a confident wrong
  // total.
  const medicalP = (async (): Promise<{ count: number; minor: number; complete: boolean }> => {
    let medicalExemptComplete = true;
    if (!isSupabaseServiceConfigured) return { count: 0, minor: 0, complete: medicalExemptComplete };
    try {
      const admin = createSupabaseAdminClient();
      type ExemptRow = {
        id: string;
        sales_price_minor: number;
        excise_amount_exempt_minor: number;
      };
      const { rows, verdict } = await pagedAllChecked<ExemptRow>(
        async (from, to) => {
          const { data, error } = await admin
            .from("medical_exempt_sales")
            .select("id, sales_price_minor, excise_amount_exempt_minor")
            .gte("sale_date", week.start)
            .lte("sale_date", week.end)
            // Stable UNIQUE ordering — REQUIRED for deterministic paging.
            .order("id", { ascending: true })
            .range(from, to);
          if (error) return { rows: [], ok: false };
          return { rows: (data as ExemptRow[] | null) ?? [], ok: true };
        },
        { maxRows: EXEMPT_SCAN_MAX_ROWS },
      );
      medicalExemptComplete = verdict.complete;
      return {
        count: rows.length,
        minor: rows.reduce((a, r) => a + (r.excise_amount_exempt_minor ?? 0), 0),
        complete: medicalExemptComplete,
      };
    } catch {
      /* evidence panel is best-effort */
      medicalExemptComplete = false;
      return { count: 0, minor: 0, complete: medicalExemptComplete };
    }
  })();
  const medicalViewP = Promise.all([medicalP, weekP]);

  const qs = `from=${week.start}&to=${week.end}${envQ}`;
  const mailCfg = mailConfigFromEnv(process.env);
  const mailSetup = mailCfg.configured
    ? { configured: true as const, mode: mailCfg.mode, mailbox: mailCfg.mailbox }
    : { configured: false as const, mailbox: mailCfg.mailbox, missing: mailCfg.missing, problem: mailCfg.problem };
  // S-18b: a strategy report for every open error email, from the CSVs CCRS attached.
  // The week stays a placeholder in the examiner draft: an error file does not say which week it answers.
  const ccrsMailRows = ccrsMail.rows.map((r) => ({
    ...r,
    // R74 S47: a body-only "has not been processed" email (whole file refused, no CSV).
    notProcessed: r.kind === "unknown" && r.state === "new" ? parseNotProcessed(r.body_text ?? "") : [],
    strategy:
      r.kind === "error" && r.state === "new"
        ? buildCcrsStrategy(errorsFromStored(r.csvs ?? []), {
            licenseNumber: license.licenseNumber || "(license not set)",
            licenseeName: license.submittedBy || "Greenway Marijuana",
            contactEmail: mailCfg.mailbox,
          })
        : null,
  }));

  // ── Banner tone ────────────────────────────────────────────────────────────
  const urgent = overview.mostUrgent;
  const bannerTone = urgent
    ? urgent.status === "overdue"
      ? "border-red-500/40 bg-red-500/10"
      : urgent.status === "due_today"
        ? "border-orange-500/40 bg-orange-500/10"
        : "border-sky-500/30 bg-sky-500/5"
    : "border-emerald-500/30 bg-emerald-500/5";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black tracking-tight text-white">
            🛡️ CCRS Compliance Command Center
          </h1>
          <p className="mt-0.5 text-xs text-white/40">
            Weekly WSLCB reporting, hand-held from generation to upload to evidence. Week runs
            Sunday–Saturday; the upload is due the following Sunday.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/admin/compliance/ccrs/records" className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 font-semibold text-emerald-100 transition hover:bg-emerald-400/20">
            CCRS Records (State copy)
          </Link>
          <Link href="/admin/compliance/health" className="rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-white/60 transition hover:bg-white/5">
            Compliance Health
          </Link>
          <Link href="/admin/compliance/regulatory" className="rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-white/60 transition hover:bg-white/5">
            Regulatory Watch
          </Link>
          <Link href="/admin/reports/compliance" className="rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-white/60 transition hover:bg-white/5">
            Classic CCRS tab
          </Link>
        </div>
      </div>

      {/* S-12c: environment switch. PREprod is LCB's test site; nothing here touches production. */}
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2 text-xs ${env === "preprod" ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100" : "border-white/10 bg-white/[0.02] text-white/60"}`}>
        <span className="font-bold uppercase tracking-wide">CCRS:</span>
        <Link href={hubWeekLink(week.key, "prod")} className={`rounded-lg px-3 py-1 font-semibold ${env === "prod" ? "bg-emerald-500/25 text-emerald-100" : "border border-white/15 hover:bg-white/5"}`}>
          Production
        </Link>
        <Link href={hubWeekLink(week.key, "preprod")} className={`rounded-lg px-3 py-1 font-semibold ${env === "preprod" ? "bg-fuchsia-500/30 text-fuchsia-50" : "border border-white/15 hover:bg-white/5"}`}>
          PREprod (test site)
        </Link>
        {env === "preprod" ? (
          <span>
            Every export, upload and answer below is PREprod only. Upload at{" "}
            <a href={ccrsPortalUrl("preprod")} target="_blank" rel="noreferrer" className="underline">precannabisreporting.lcb.wa.gov</a>, never production.
          </span>
        ) : null}
      </div>

      {/* R74 S48: the CCRS test scoreboard. Full on PREprod; a one-line strip on Production. */}
      <Suspense fallback={<Pending label="the PREprod test scoreboard" />}>
        <Await p={scoreboardP}>
          {(scoreboard) => <CcrsScoreboardPanel read={scoreboard} compact={env !== "preprod"} />}
        </Await>
      </Suspense>

      {/* W-1: the result of the last action stays in view (sticky) wherever the redirect scrolled to. */}
      {flash ? (
        <div
          role={flash.tone === "error" ? "alert" : "status"}
          data-testid="ccrs-hub-flash"
          className={`sticky top-2 z-30 flex items-start gap-3 whitespace-pre-wrap rounded-xl border px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur ${flash.tone === "error" ? "border-red-400/40 bg-red-950/90 text-red-100" : "border-emerald-400/40 bg-emerald-950/90 text-emerald-100"}`}
        >
          <span className="flex-1">{flash.tone === "error" ? flash.text : `✓ ${flash.text}`}</span>
          <Link href={hubWeekLink(week.key, env)} className="shrink-0 underline opacity-70 hover:opacity-100" aria-label="Dismiss this message">
            Dismiss
          </Link>
        </div>
      ) : null}

      {/* 1) Deadline banner */}
      <div className={`rounded-2xl border p-5 ${bannerTone}`}>
        {urgent ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-white">
                {urgent.status === "overdue"
                  ? `⚠ Week ${urgent.week.start} – ${urgent.week.end} is OVERDUE by ${Math.abs(urgent.daysUntilDue)} day(s)`
                  : urgent.status === "due_today"
                    ? `⏰ Week ${urgent.week.start} – ${urgent.week.end} is DUE TODAY`
                    : `Week ${urgent.week.start} – ${urgent.week.end} is ready — due Sunday ${urgent.week.due}`}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {overview.overdueCount > 0
                  ? `${overview.overdueCount} week(s) overdue in the lookback window. Work oldest-first.`
                  : "Generate, validate, upload, then record it below — the reminders stop once it's on the ledger."}
              </p>
            </div>
            {urgent.week.key !== week.key ? (
              <Link
                href={hubWeekLink(urgent.week.key, env)}
                className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-xs font-bold text-black transition hover:opacity-90"
              >
                Jump to that week →
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="text-sm font-bold text-emerald-200">
            ✓ All completed weeks are resolved{overview.beforeStartCount + overview.dismissedCount > 0
              ? ` (${overview.beforeStartCount} before sales start, ${overview.dismissedCount} dismissed with a reason)`
              : ""}. Current week ({overview.current.week.start} –{" "}
            {overview.current.week.end}) closes Saturday; its upload is due Sunday{" "}
            {overview.current.week.due}.
          </p>
        )}
      </div>

      {/* S-12d) First day of sales */}
      <Section
        title="First day of sales"
        subtitle="Weeks and months before this date stop nagging you. Your integrator (Cultivera) files those; this system does not."
      >
        <div className="space-y-2 text-xs text-white/60">
          <p>
            {obligationCtx.startDate ? (
              <>
                Set to <strong className="text-white">{obligationCtx.startDate}</strong>. CCRS weeks that end before it show
                as &ldquo;Before sales start&rdquo; and send no reminders. LIQ-1295 months that end before it go quiet only
                after their due date, so a real upcoming LIQ-1295 is still reminded.
              </>
            ) : (
              <>Not set. Every past week and month is treated as yours to file, so the backlog nags.</>
            )}
          </p>
          {canEdit ? (
            <form action={setObligationStartAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="week_key" value={week.key} />
              <input type="hidden" name="env" value={env} />
              <label className="text-[11px] text-white/50">
                First day of sales (YYYY-MM-DD)
                <input
                  type="date"
                  name="start_date"
                  defaultValue={obligationCtx.startDate ?? "2026-11-01"}
                  className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
                />
              </label>
              <SaveButton variant="save" size="sm" label="Save first day of sales" busyLabel="Saving..." />
              {obligationCtx.startDate ? (
                <span className="text-[11px] text-white/35">Clear the box and save to remove it.</span>
              ) : null}
            </form>
          ) : (
            <p className="text-white/40">Changing it requires the &ldquo;Change settings&rdquo; permission.</p>
          )}
        </div>
      </Section>

      {/* S-17d) Hand-over from the integrator */}
      <Section
        title="Hand-over from Cultivera: your first upload"
        subtitle="Worked out from the first day of sales and the dates Cultivera gives you in writing. CCRS weeks run Sunday to Saturday and are due the next Sunday."
      >
        <HandoverPlanCard
          plan={handoverPlan}
          facts={handoverFacts}
          canEdit={canEdit}
          weekKey={week.key}
          env={env}
          action={setHandoverFactsAction}
        />
      </Section>

      {/* 2) Week picker */}
      <Section
        title="Step 1 — Pick the reporting week"
        subtitle="Sunday–Saturday, Pacific. A week can be recorded once it has completed."
      >
        <div className="flex flex-wrap gap-2">
          {[overview.current, ...overview.weeks].map((w) => {
            const meta = STATUS_META[w.status];
            const selected = w.week.key === week.key;
            return (
              <Link
                key={w.week.key}
                href={hubWeekLink(w.week.key, env)}
                className={`rounded-xl border px-3 py-2 text-xs transition ${
                  selected
                    ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                }`}
              >
                <span className="font-bold text-white/80">
                  {w.week.start} – {w.week.end}
                </span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.pill}`}>
                  {meta.label}
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* 3) Activity + validation for the selected week */}
      <Section
        title={`Step 2 — Review week ${week.start} – ${week.end}`}
        subtitle={`Due Sunday ${week.due}. ${weekCompleted ? "" : "This week is still in progress — you can preview, but record it after Saturday."}`}
      >
        <Suspense fallback={<Pending label={`week ${week.start} to ${week.end}: building the CCRS files and checking every row`} tall />}>
          <Await p={Promise.all([weekP, owedP])}>
            {([wv, owedRead]) => {
              const { batch, verdict, submittable, errors, warnings, held, totalRecords, nothingToReport, medicalSaleRows } = wv;
              const owed = owedRead.ok ? owedRead.value : { available: true, rows: [], error: owedRead.error };
              const owedWeeks = owedByWeek(owed.rows);
              return (
                <>
                  {wv.buildError ? <PanelFailed what={`the CCRS files for week ${week.start} to ${week.end}`} error={wv.buildError} /> : null}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Total records" value={totalRecords.toLocaleString()} accent="green" />
              <StatCard
                label="Blocking errors"
                value={String(errors.length)}
                accent={errors.length > 0 ? "orange" : "muted"}
              />
              <StatCard label="Warnings" value={String(warnings.length)} accent="muted" />
              <StatCard
                label="Medical sale rows"
                value={String(medicalSaleRows)}
                accent={medicalSaleRows > 0 ? "gold" : "muted"}
              />
            </div>
    
            {batch ? (
              <div className="mt-4 space-y-3">
                {/* S-12b: ledger status + GWP- id assignment (D-01a) */}
                {!batch.ledger.view ? (
                  <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[11px] text-amber-100">
                    {env === "preprod"
                      ? `PREprod ledger not started (${batch.ledger.absentReason}). Start it in the CCRS files section below so PREprod exports are recorded.`
                      : `CCRS ledger not loaded (${batch.ledger.absentReason}). Files are built the old way (every row Insert) and are NOT recorded. Do not upload to production until migration 0248 is applied and the seed is finalized.`}
                  </p>
                ) : env === "prod" && batch.ledger.unassignedProductKeys.length > 0 ? (
                  <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-[11px] text-sky-100">
                    <p className="font-semibold">
                      {batch.ledger.unassignedProductKeys.length} product(s) have no CCRS Product id yet, so they (and their lots)
                      are withheld.
                    </p>
                    {canEdit ? (
                      <form action={assignProductIdsAction} className="mt-2">
                        <input type="hidden" name="week_key" value={week.key} />
                        <input type="hidden" name="env" value={env} />
                        <SaveButton variant="confirm" size="sm" label={`Assign CCRS Product ids (GWP-) to these ${batch.ledger.unassignedProductKeys.length}`} busyLabel="Assigning ids..." />
                        <p className="mt-1 text-white/50">Permanent: an assigned id is never changed or reused. Production only.</p>
                      </form>
                    ) : null}
                  </div>
                ) : null}
                {/* R74 S25: which CCRS ids this file uses (Cultivera's filed ids vs ours) */}
                {batch.identity ? (
                  <details className="rounded-xl border border-white/10 bg-white/5 px-4 py-3" open={batch.identity.rows.held.length > 0}>
                    <summary className="cursor-pointer text-xs font-semibold text-white/80">
                      CCRS ids in this file: Cultivera&apos;s filed ids vs ours
                    </summary>
                    <div className="mt-3">
                      <CcrsIdentityProofPanel proof={batch.identity} />
                    </div>
                  </details>
                ) : null}
                <div
                  className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
                    submittable
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                      : "border-red-400/30 bg-red-400/10 text-red-200"
                  }`}
                >
                  {submittable
                    ? nothingToReport
                      ? "✓ Validation passed — but this week has ZERO records. If there was truly no activity, no upload is needed: record it as “nothing to report” below."
                      : held.length > 0
                        ? `✓ Validation passed for the records in these files — upload them. ${verdict?.heldCount ?? 0} record(s) in ${held.length} group(s) are HELD BACK (not in the files) and listed below as still owed to CCRS; fix them and rebuild to send them.`
                        : "✓ Validation passed — the batch is cleared for upload. This is the same hard gate the zip download enforces."
                    : "✕ Validation FAILED — the zip download is blocked until these errors are fixed:"}
                </div>
                {/* S-17a: every row of every issue, with the next step per reason (Part 17 §C.4 defect 1). */}
                <CcrsIssueList
                  issues={errors}
                  env={env}
                  tone="error"
                  copyTitle={`CCRS blocking errors — ${env} — week ${week.start} to ${week.end}`}
                />
                {held.length > 0 ? (
                  <div
                    className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3"
                    data-testid="ccrs-held-back"
                  >
                    <p className="text-xs font-semibold text-amber-200">
                      Held back — not in these files, still owed to CCRS ({verdict?.heldCount ?? 0} record(s))
                    </p>
                    <p className="mt-1 text-[11px] text-amber-100/70">
                      These rows were left out so the good records can upload now. Nothing is sent on a guess. Fix each
                      group with its next step, rebuild this week, and upload again: the rebuilt files carry them.
                    </p>
                    <div className="mt-2">
                      <CcrsIssueList
                        issues={held}
                        env={env}
                        tone="held"
                        copyTitle={`CCRS held back (still owed) — ${env} — week ${week.start} to ${week.end}`}
                        cleanup={canEdit ? { action: ccrsCleanupAction, weekKey: week.key } : undefined}
                      />
                    </div>
                  </div>
                ) : null}
                {owed && owed.available && (owedWeeks.length > 0 || owed.error) ? (
                  <details className="rounded-xl border border-amber-400/20 bg-white/5 px-4 py-3" data-testid="ccrs-still-owed">
                    <summary className="cursor-pointer text-xs font-semibold text-amber-200">
                      Still owed to CCRS from earlier uploads — {owedSentence(owedWeeks)}
                    </summary>
                    {owed.error ? <p className="mt-2 text-xs text-red-200">Could not read the full list: {owed.error}</p> : null}
                    <ul className="mt-2 space-y-2 text-xs text-white/70">
                      {owedWeeks.map((w) => (
                        <li key={w.weekStart}>
                          <span className="font-semibold">Week of {w.weekStart}</span> — {w.total} record(s):{" "}
                          {w.byType.map((t) => `${t.count} ${t.type}${t.rebuildWeek ? " (rebuild this week after fixing)" : ""}`).join(", ")}
                          {w.byType.some((t) => t.rebuildWeek) ? (
                            <>
                              {" "}
                              <Link className="underline" href={hubWeekLink(`W-${w.weekStart}`, env)}>
                                Open this week
                              </Link>
                            </>
                          ) : null}
                          <details className="mt-1 pl-4">
                            <summary className="cursor-pointer opacity-80">Show all {w.rows.length}</summary>
                            <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-mono text-[11px]">
                              {w.rows.map((r) => (
                                <li key={`${r.record_type}-${r.record_id}`}>
                                  {r.record_type} {r.label ?? r.record_id} [{r.code}] {r.reason ?? ""} (held since {r.first_held_at.slice(0, 10)})
                                </li>
                              ))}
                            </ol>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {warnings.length > 0 ? (
                  <details className="text-xs text-white/50">
                    <summary className="cursor-pointer font-semibold text-white/60">
                      {warnings.length} warning(s) — non-blocking, worth a skim
                    </summary>
                    <div className="mt-2">
                      <CcrsIssueList
                        issues={warnings}
                        env={env}
                        tone="warning"
                        copyTitle={`CCRS warnings — ${env} — week ${week.start} to ${week.end}`}
                        cleanup={canEdit ? { action: ccrsCleanupAction, weekKey: week.key } : undefined}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-xs text-white/40">Connect Supabase to generate the CCRS batch.</p>
            )}
                </>
              );
            }}
          </Await>
        </Suspense>
      </Section>

      {/* AI helper — drafts-only briefing grounded in this week's batch */}
      <Suspense fallback={null}>
        <Await p={weekP}>
          {({ batch }) => (batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={{ from: week.start, to: week.end }} /> : null)}
        </Await>
      </Suspense>

      {/* R74 S48 (Round 28, item 2): earlier files still waiting for their CCRS answer */}
      {unansweredWarningLines(waitingHere).length > 0 ? (
        <div className="rounded-2xl border-2 border-amber-400/60 bg-amber-400/10 p-4 text-sm text-amber-100" data-testid="ccrs-unanswered-warning">
          <p className="font-black uppercase tracking-wide">Before you export again: answer the earlier files</p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {unansweredWarningLines(waitingHere).map((l, i) => (
              <li key={i} className={i === 0 ? "font-bold" : ""}>
                {l}
              </li>
            ))}
          </ul>
          <a href="#ccrs-mail" className="mt-2 inline-block rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-bold text-black">
            Go to the CCRS emails &rarr;
          </a>
        </div>
      ) : null}

      {/* 4) Guided upload walkthrough */}
      <Suspense fallback={<Pending label="the upload walkthrough" />}>
        <Await p={weekP}>
          {({ batch, nothingToReport, submittable }) => (
            <>
            {batch && !nothingToReport ? (
            <UploadWalkthrough
              weekKey={week.key}
              files={batch.files.map((f) => ({
                type: String(f.type),
                fileName: f.fileName,
                recordCount: f.recordCount,
                empty: f.empty,
              }))}
              batchZipHref={`/admin/reports/compliance/batch-export?${qs}`}
              submittable={submittable}
              portalUrl={ccrsPortalUrl(env)}
            />
          ) : null}
            </>
          )}
        </Await>
      </Suspense>

      {/* S-18a: CCRS's answers, read from the submitting mailbox */}
      <Section
        title="CCRS email: confirmations and error files"
        subtitle="Read from the mailbox that uploads the files. Nothing is recorded until you press Apply; the server re-checks every row first."
      >
        <CcrsMailPanel
          available={ccrsMail.available}
          loadError={ccrsMail.error ?? (waitingFiles.ok ? null : `waiting files: ${waitingFiles.error}`)}
          setup={mailSetup}
          heartbeat={ccrsMail.heartbeat}
          rows={ccrsMailRows as unknown as CcrsMailPanelRow[]}
          uploadedFiles={waitingAll.filter((f) => isUnansweredState(f.state))}
          canEdit={canEdit}
          weekKey={week.key}
          nowISO={new Date().toISOString()}
          env={env}
          flash={flash}
          actions={{
            poll: pollCcrsMailNowAction,
            applySuccess: applyCcrsSuccessMailAction,
            applyError: applyCcrsErrorMailAction,
            applyNotProcessed: applyCcrsNotProcessedMailAction,
            applyAll: applyAllCcrsMailAction,
            dismiss: dismissCcrsMailAction,
          }}
        />
      </Section>

      {/* S-12c: every emitted file, its state, and what to do next */}
      <Suspense fallback={<Pending label="the CCRS files list" tall />}>
        <Await p={Promise.all([weekP, filesP])}>
          {([{ batch }, filesRead]) => {
            const ccrsFiles = filesRead.ok
              ? filesRead.value
              : { available: true, files: [], issues: [], error: filesRead.error };
            return (
              <>
              {batch ? (
            <CcrsFilesPanel
              env={env}
              weekKey={week.key}
              canEdit={canEdit}
              available={ccrsFiles.available}
              loadError={ccrsFiles.error}
              files={ccrsFiles.files}
              issues={ccrsFiles.issues}
              ledgerLoaded={!!batch.ledger.view}
              unassignedProductCount={batch.ledger.unassignedProductKeys.length}
              nowISO={new Date().toISOString()}
              suggestedRun={`P${todayIso.replaceAll("-", "")}A`}
              actions={{
                markUploaded: markUploadedAction,
                recordSuccess: recordSuccessAction,
                recordError: recordErrorAction,
                recordNoEmail: recordNoEmailAction,
                abandon: abandonFileAction,
                startPreprod: startPreprodLedgerAction,
                assignPreprodIds: assignPreprodProductIdsAction,
                settlePreprodDuplicates: settlePreprodDuplicatesAction,
              }}
            />
          ) : null}
              </>
            );
          }}
        </Await>
      </Suspense>

      {/* R50 S10c: migration clean-up (D-15) */}
      <Suspense fallback={<Pending label="the migration clean-up list" />}>
        <Await p={migrationGarbageP}>
          {(g) => {
            if (!g.ok) return <PanelFailed what="the migration clean-up list" error={g.error} />;
            const migrationGarbage = g.value;
            return migrationGarbage ? <MigrationGarbagePanel load={migrationGarbage} /> : null;
          }}
        </Await>
      </Suspense>

      {/* 5) Record the week */}
      <Section
        id="ccrs-week"
        title="Step 3 — Record this week"
        subtitle="The ledger is your compliance evidence (who, when, on time or late) and it silences the reminders."
      >
        {ledgerRow ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-4 py-3 text-xs text-emerald-200">
              ✓ Recorded as{" "}
              <strong>{ledgerRow.resolution === "submitted" ? "SUBMITTED" : "NOTHING TO REPORT"}</strong>{" "}
              {ledgerRow.on_time ? "(on time)" : "(late)"} by {ledgerRow.resolved_by_email ?? "staff"} on{" "}
              {new Date(ledgerRow.resolved_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}{" "}
              PT.
              {ledgerRow.resolution === "submitted"
                ? ` ${ledgerRow.total_records.toLocaleString()} record(s) across ${(ledgerRow.files_json ?? []).length} file(s).`
                : ""}
              {ledgerRow.notes ? ` Notes: ${ledgerRow.notes}` : ""}
            </div>

            {canEdit ? (
              <div className="flex flex-wrap items-end gap-3">
                {/* Error status on a submitted week */}
                {ledgerRow.resolution === "submitted" ? (
                  <form action={setWeekErrorStatusAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="week_key" value={week.key} />
                    <input type="hidden" name="env" value={env} />
                    <label className="text-xs text-white/50">
                      CCRS error email status
                      <select
                        name="error_status"
                        defaultValue={ledgerRow.error_status}
                        className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
                      >
                        <option value="clean">No errors received</option>
                        <option value="errors_reported">Errors reported — working it</option>
                        <option value="resolved">Errors resolved</option>
                      </select>
                    </label>
                    <label className="text-xs text-white/50">
                      Notes
                      <input
                        name="error_notes"
                        defaultValue={ledgerRow.error_notes ?? ""}
                        placeholder="e.g. duplicate strain — benign"
                        className="mt-1 block w-64 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
                      />
                    </label>
                    <SaveButton variant="neutral" size="sm" label="Save error status" busyLabel="Saving..." />
                  </form>
                ) : null}
                <form action={unresolveWeekAction}>
                  <input type="hidden" name="week_key" value={week.key} />
                  <input type="hidden" name="env" value={env} />
                  <SaveButton variant="danger" size="sm" label="Undo (recorded by mistake)" busyLabel="Undoing..." />
                </form>
              </div>
            ) : null}
          </div>
        ) : selectedDeadline.status === "before_start" ? (
          <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/50">
            This week ends before your first day of sales ({obligationCtx.startDate}). It is not tracked here and sends
            no reminders. You can still record it if you uploaded it yourself.
          </p>
        ) : selectedDeadline.status === "dismissed" && selectedDeadline.waiver ? (
          <div className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-400/5 px-4 py-3 text-xs text-violet-100">
            <p>
              Dismissed by {selectedDeadline.waiver.waivedByEmail ?? "staff"}
              {selectedDeadline.waiver.waivedAt
                ? ` on ${new Date(selectedDeadline.waiver.waivedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`
                : ""}
              . Reason: <strong>{selectedDeadline.waiver.reason}</strong>
            </p>
            <p className="text-violet-100/60">No reminders are sent for this week. Undo it if it was a mistake; it shows as due again.</p>
            {canEdit && selectedDeadline.waiver.id ? (
              <UndoDismissForm waiverId={selectedDeadline.waiver.id} weekKey={week.key} env={env} />
            ) : null}
          </div>
        ) : !weekCompleted ? (
          <p className="text-xs text-white/40">
            This week is still in progress — it can be recorded after it closes Saturday night.
          </p>
        ) : canEdit ? (
          <Suspense fallback={<Pending label="the week's record count and validation" />}>
            <Await p={weekP}>
              {({ batch, submittable, totalRecords, nothingToReport }) => {
                const gate = recordGate({ built: !!batch, submittable, totalRecords, nothingToReport });
                return (
                <div className="grid gap-3 md:grid-cols-2">
                  <form action={resolveWeekAction} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <input type="hidden" name="week_key" value={week.key} />
                    <input type="hidden" name="env" value={env} />
                    <input type="hidden" name="resolution" value="submitted" />
                    <p className="text-xs font-bold text-white/80">I uploaded the files to CCRS</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      Records the submission with the file manifest ({totalRecords.toLocaleString()}{" "}
                      record(s)) as evidence and stops the reminders for this week.
                    </p>
                    <input
                      name="notes"
                      placeholder="Optional note (e.g. re-uploaded Sale.csv after fix)"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
                    />
                    <PendingSubmit className="mt-3 admin-focus inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-black uppercase tracking-[0.1em] transition px-3.5 py-1.5 text-[0.7rem] bg-[var(--admin-accent)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110" disabled={!gate.submitted} busy="Recording...">
                      Record as SUBMITTED
                    </PendingSubmit>
                    {gate.submittedWhy === "build-failed" ? (
                      <p className="mt-2 text-[11px] text-red-300/80">
                        Blocked: this week&apos;s files could not be built (see Step 2). Reload once it builds.
                      </p>
                    ) : !submittable ? (
                      <p className="mt-2 text-[11px] text-red-300/80">
                        Blocked: fix the validation errors above first — you shouldn&apos;t have been able
                        to upload a failing batch.
                      </p>
                    ) : nothingToReport ? (
                      <p className="mt-2 text-[11px] text-white/40">
                        Zero records this week — use &ldquo;nothing to report&rdquo; instead.
                      </p>
                    ) : null}
                  </form>
      
                  <form action={resolveWeekAction} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <input type="hidden" name="week_key" value={week.key} />
                    <input type="hidden" name="env" value={env} />
                    <input type="hidden" name="resolution" value="nothing_to_report" />
                    <p className="text-xs font-bold text-white/80">Nothing to report this week</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      Per the LCB FAQ there is no &ldquo;no change&rdquo; report — a week with no new
                      activity simply isn&apos;t uploaded. Recording it here logs WHY no upload exists and
                      stops the reminders.
                    </p>
                    <input
                      name="notes"
                      placeholder="Optional note (e.g. store closed, no deliveries)"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
                    />
                    <PendingSubmit className="mt-3 admin-focus inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-black uppercase tracking-[0.1em] transition px-3.5 py-1.5 text-[0.7rem] bg-[var(--admin-orange-soft)] text-[var(--admin-orange)] ring-1 ring-[var(--admin-orange)]/40 shadow-[var(--admin-shadow-sm)] hover:bg-[var(--admin-orange)] hover:text-black" disabled={!gate.nothing} busy="Recording...">
                      Record as NOTHING TO REPORT
                    </PendingSubmit>
                    {gate.nothingWhy === "build-failed" ? (
                      <p className="mt-2 text-[11px] text-red-300/80">
                        Blocked: this week&apos;s files could not be built, so it is not known to be empty.
                      </p>
                    ) : totalRecords > 0 ? (
                      <p className="mt-2 text-[11px] text-amber-300/80">
                        Blocked: this week has {totalRecords.toLocaleString()} record(s) — it must be
                        uploaded, not skipped.
                      </p>
                    ) : null}
                  </form>
      
                  {/* S-12d: check it off with a reason (for example the integrator filed it) */}
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 md:col-span-2">
                    <p className="text-xs font-bold text-white/80">Someone else handled this week (dismiss with a reason)</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      Use this when the week was filed outside this system, for example by Cultivera. It does NOT tell the
                      State anything; it only stops the reminders here and keeps your reason, name and time as evidence.
                    </p>
                    <DismissForm obligation="ccrs_weekly" periodKey={week.key} weekKey={week.key} env={env} label="Dismiss this week" />
                  </div>
                </div>
                );
              }}
            </Await>
          </Suspense>
        ) : (
          <p className="text-xs text-white/40">
            Recording a week requires the &ldquo;Change settings&rdquo; permission.
          </p>
        )}
      </Section>

      {/* 6) Error triage */}
      <Suspense fallback={<Pending label="the error triage helper" />}>
        <Await p={weekP}>
          {({ batch }) => (
            <ErrorTriagePanel
              licenseNumber={license.licenseNumber || "(license not set)"}
              licenseeName={license.submittedBy || "Greenway Marijuana"}
              weekStart={week.start}
              weekEnd={week.end}
              fileTypes={(batch?.files ?? []).filter((f) => !f.empty).map((f) => String(f.type))}
            />
          )}
        </Await>
      </Suspense>

      {/* 7) DOH / medical panel */}
      <Section
        title="DOH / Medical sales"
        subtitle="There is no separate DOH report upload — the obligations live inside CCRS + the LIQ-1295. These are the four legs of the tax exemption, checked for this week."
      >
        <Suspense fallback={<Pending label="this week's medical evidence" />}>
          <Await p={medicalViewP}>
            {([medical, { medicalSaleRows }]) => {
              const medicalExemptCount = medical.count;
              const medicalExemptMinor = medical.minor;
              const medicalExemptComplete = medical.complete;
              return (
                  <div className="grid gap-2 text-xs md:grid-cols-2">
                <div className={`rounded-xl border p-3 ${endorsement?.isMedicallyEndorsed ? "border-emerald-400/25 bg-emerald-400/5" : "border-red-400/25 bg-red-400/5"}`}>
                  <p className="font-bold text-white/80">1. Medical endorsement</p>
                  <p className="mt-1 text-white/55">
                    {endorsement?.isMedicallyEndorsed
                      ? `✓ Store holds an LCB medical endorsement${endorsement.endorsementNumber ? ` (#${endorsement.endorsementNumber})` : ""}. Excise exemption sunsets ${endorsement.exciseExemptionUntil}.`
                      : "✕ No medical endorsement on record — medical tax exemptions are NOT lawful without it."}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="font-bold text-white/80">2. DOH database check — every transaction</p>
                  <p className="mt-1 text-white/55">
                    Patient/designated-provider status must be verified in the DOH Medical Cannabis
                    Authorization Database at EVERY sale — a valid-looking card is not enough (status can
                    change). {medicalExemptCount} exempt sale line(s) recorded this week
                    {medicalExemptMinor > 0 ? ` ($${(medicalExemptMinor / 100).toFixed(2)} excise exempted)` : ""}.
                  </p>
                  {!medicalExemptComplete ? (
                    <p className="mt-1 font-semibold text-amber-300">
                      ⚠ This count could not be read completely, so it is a MINIMUM — the real figure may
                      be higher. Do not rely on it as WAC 314-55-090(2) evidence until it reads clean.
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="font-bold text-white/80">3. IsMedical=TRUE inventory</p>
                  <p className="mt-1 text-white/55">
                    Only DOH medically-compliant lots (passing WAC 246-70-050 tests) may be reported
                    IsMedical=TRUE in Inventory.csv — that flag is one leg of the exemption, not a label
                    choice.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="font-bold text-white/80">4. RecreationalMedical in Sale.csv</p>
                  <p className="mt-1 text-white/55">
                    {medicalSaleRows > 0
                      ? `${medicalSaleRows} sale row(s) this week are SaleType=RecreationalMedical — both tax columns must be $0.00 on those rows (the validator enforces the 37% excise on all others).`
                      : "No RecreationalMedical rows this week. If a DOH patient purchase happened, verify it was rung up as a medical sale — the exemption is mandatory when the four legs are met, not a discount."}
                  </p>
                </div>
              </div>
              );
            }}
          </Await>
        </Suspense>
        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
          Also exempt: CHABA products (sales + excise) and DOH high-CBD compliant products
          (sales tax, to any customer). Endorsement duties: certified medical cannabis consultant
          on staff, employee training (RCW 69.50.375), enter patients into the DOH database and
          retain card/transaction records — see the Compliance Calendar for the recurring tasks.
          Medical endorsement questions: cannabisendorsement@lcb.wa.gov.
        </p>
      </Section>

      {/* 8) Monthly LIQ-1295 strip */}
      <Section
        title="Monthly LIQ-1295 (tax report)"
        subtitle="Due the 20th of the following month — even with no sales. 2% late penalty after the due date."
      >
        {filing.available && filing.periods.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {filing.periods.map((p) => {
              const label = `${p.period.year}-${String(p.period.month).padStart(2, "0")}`;
              const tone =
                p.status === "overdue"
                  ? "text-red-200"
                  : p.status === "due_today" || p.status === "due_soon"
                    ? "text-orange-200"
                    : p.status === "filed"
                      ? "text-emerald-200/80"
                      : p.status === "dismissed"
                        ? "text-violet-200/80"
                        : p.status === "before_start"
                          ? "text-white/35"
                          : "text-white/60";
              const canDismiss =
                canEdit &&
                p.status !== "filed" &&
                p.status !== "before_start" &&
                p.status !== "dismissed" &&
                validateDismissal("liq1295", label, todayIso).ok;
              return (
                <li key={label} className={tone}>
                  • Sales month <span className="font-bold">{label}</span> — due{" "}
                  <span className="font-bold">{p.dueDate}</span> — {MONTH_STATUS_LABEL[p.status] ?? p.status}
                  {p.status === "dismissed" && p.waiver ? (
                    <span className="ml-1 text-violet-100/70">
                      (by {p.waiver.waivedByEmail ?? "staff"}: &ldquo;{p.waiver.reason}&rdquo;){" "}
                      {canEdit && p.waiver.id ? <UndoDismissForm waiverId={p.waiver.id} weekKey={week.key} env={env} /> : null}
                    </span>
                  ) : null}
                  {canDismiss ? (
                    <details className="ml-3 mt-1 text-white/50">
                      <summary className="cursor-pointer text-[11px] underline">Already filed elsewhere? Dismiss with a reason</summary>
                      <DismissForm obligation="liq1295" periodKey={label} weekKey={week.key} env={env} label={`Dismiss ${label}`} />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-white/40">Connect Supabase to track the monthly deadline.</p>
        )}
        <p className="mt-2 text-[11px] text-white/35">
          The LIQ-1295 is required every month even with no sales, so a month only goes quiet once it is filed
          (export on record), dismissed with your reason, or before your first day of sales AND past its due date.
        </p>
      </Section>

      {/* S-12d: dismissal history (evidence) */}
      {waiverHistory.length > 0 ? (
        <Section title="Dismissed deadlines" subtitle="Every check-off with its reason, newest first. Never edited or deleted; undo keeps the record.">
          <ul className="space-y-1 text-xs text-white/60">
            {waiverHistory.map((w) => (
              <li key={w.id}>
                • {w.obligation === "ccrs_weekly" ? "CCRS week" : "LIQ-1295 month"}{" "}
                <span className="font-bold text-white/80">{w.period_key}</span> by {w.waived_by_email ?? "staff"} on{" "}
                {new Date(w.waived_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT: &ldquo;{w.reason}&rdquo;
                {w.revoked_at
                  ? ` (undone by ${w.revoked_by_email ?? "staff"} on ${new Date(w.revoked_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT)`
                  : ""}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* 9) Reminders */}
      <PushRemindersPanel />
      <p className="text-[11px] leading-relaxed text-white/35">
        Automatic reminders (daily cron): Thursday heads-up → Saturday week-close → Sunday
        DUE-TODAY → daily OVERDUE escalation until the week is recorded, plus the monthly LIQ-1295
        cadence. Email goes to the staff list; push goes to every enabled device. Recording a week
        above is what stops them — the system never assumes an upload happened. Weeks before your
        first day of sales and anything you dismissed with a reason are quiet too.
      </p>

      {/* 10) Ledger */}
      <Section title="Submission ledger" subtitle="Newest first. This is the evidence trail.">
        {ledger.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-white/40">
                <tr>
                  <th className="py-1.5 pr-3">Week</th>
                  <th className="py-1.5 pr-3">Resolution</th>
                  <th className="py-1.5 pr-3">On time</th>
                  <th className="py-1.5 pr-3">Records</th>
                  <th className="py-1.5 pr-3">Errors</th>
                  <th className="py-1.5 pr-3">By</th>
                </tr>
              </thead>
              <tbody className="text-white/70">
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5 pr-3">
                      <Link href={hubWeekLink(r.week_key, env)} className="underline decoration-white/20 hover:text-white">
                        {r.week_start} – {r.week_end}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      {r.resolution === "submitted" ? "Submitted" : "Nothing to report"}
                    </td>
                    <td className="py-1.5 pr-3">{r.on_time ? "✓" : "LATE"}</td>
                    <td className="py-1.5 pr-3">{r.total_records.toLocaleString()}</td>
                    <td className="py-1.5 pr-3">
                      {r.error_status === "clean"
                        ? "—"
                        : r.error_status === "errors_reported"
                          ? "⚠ reported"
                          : "resolved"}
                    </td>
                    <td className="py-1.5 pr-3">{r.resolved_by_email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            No weeks recorded yet. Resolve your first week above to start the evidence trail.
          </p>
        )}
      </Section>
    </div>
  );
}
