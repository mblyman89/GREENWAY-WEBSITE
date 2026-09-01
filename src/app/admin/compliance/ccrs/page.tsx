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
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
import { assertCcrsBatchSubmittable } from "@/lib/compliance/ccrs-submit-gate-core";
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
import { resolveWeekAction, unresolveWeekAction, setWeekErrorStatusAction } from "./actions";

export const dynamic = "force-dynamic";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
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
};

export default async function CcrsCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; saved?: string; error?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;
  const todayIso = pacificToday();

  // ── Weekly deadline picture ────────────────────────────────────────────────
  const overview = await getWeeklyOverview({ lookbackWeeks: 6 });
  const ledger = isSupabaseServiceConfigured ? await listWeekSubmissions(12) : [];

  // Selected week: explicit ?week= → most urgent unresolved → last completed.
  const requested = sp.week ? weekFromKey(sp.week) : null;
  const selectedDeadline: WeekDeadline =
    (requested
      ? [...overview.weeks, overview.current].find((w) => w.week.key === requested.key)
      : null) ??
    overview.mostUrgent ??
    overview.weeks[0] ??
    overview.current;
  const week = selectedDeadline.week;
  const weekCompleted = todayIso > week.end;
  const ledgerRow = ledger.find((r) => r.week_key === week.key) ?? null;

  // ── Batch + authoritative gate for the selected week ──────────────────────
  const license = await getCcrsLicenseSettings();
  const range = resolveRange({ from: week.start, to: week.end });
  const batch = isSupabaseServiceConfigured
    ? await buildCcrsBatch(range.fromISO, range.toISO)
    : null;
  const verification = batch
    ? verifyCcrsBatch(batch.files.map((f) => ({ type: f.type, csv: f.csv })))
    : null;
  const verdict = batch
    ? assertCcrsBatchSubmittable({
        syncIssues: batch.syncIssues.map((s) => ({
          severity: s.severity,
          file: String(s.file),
          message: s.message,
          count: s.count,
        })),
        verifierProblems: (verification?.problems ?? []).map((p) => ({
          severity: p.severity,
          file: String(p.file),
          message: p.message,
        })),
        files: batch.files.map((f) => ({ type: f.type, warnings: f.warnings, empty: f.empty })),
        classifyWarning,
      })
    : null;
  const submittable = verdict?.submittable ?? false;
  const errors = verdict?.errors ?? [];
  const warnings = verdict?.warnings ?? [];
  const totalRecords = batch?.totalRecords ?? 0;
  const nothingToReport = totalRecords === 0 && errors.length === 0;
  const qs = `from=${week.start}&to=${week.end}`;

  // ── DOH / medical evidence for the week ────────────────────────────────────
  const EXEMPT_SCAN_MAX_ROWS = 100_000;
  const endorsement = await getEndorsementConfig();
  let medicalExemptCount = 0;
  let medicalExemptMinor = 0;
  // SLICE 5B: this is the WAC 314-55-090(2) excise-exemption evidence (5-year
  // retention duty), and it sat EXACTLY on PostgREST's 1,000-row cap — the one
  // value where `.limit(1000)` looks deliberate but silently becomes a ceiling
  // the moment a busy week crosses it. A short read under-reports exempt
  // excise with no visible sign. Paged completely, and when the read cannot be
  // proven complete the panel says so instead of showing a confident wrong
  // total.
  let medicalExemptComplete = true;
  if (isSupabaseServiceConfigured) {
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
      medicalExemptCount = rows.length;
      medicalExemptMinor = rows.reduce((a, r) => a + (r.excise_amount_exempt_minor ?? 0), 0);
    } catch {
      /* evidence panel is best-effort */
      medicalExemptComplete = false;
    }
  }
  const medicalSaleRows = batch
    ? (() => {
        const sale = batch.files.find((f) => f.type === "Sale");
        if (!sale) return 0;
        // Count RecreationalMedical rows without re-parsing the whole CSV schema:
        // the enum literal only ever appears in the SaleType column.
        return (sale.csv.match(/RecreationalMedical/g) ?? []).length;
      })()
    : 0;

  // ── Monthly LIQ-1295 strip ─────────────────────────────────────────────────
  const filing = await getCcrsFilingOverview(todayIso, { lookbackMonths: 2 });

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

      {sp.saved ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-200">
          ✓ Saved.
        </p>
      ) : null}
      {sp.error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-200">
          {sp.error}
        </p>
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
                href={`/admin/compliance/ccrs?week=${urgent.week.key}`}
                className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-xs font-bold text-black transition hover:opacity-90"
              >
                Jump to that week →
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="text-sm font-bold text-emerald-200">
            ✓ All completed weeks are resolved. Current week ({overview.current.week.start} –{" "}
            {overview.current.week.end}) closes Saturday; its upload is due Sunday{" "}
            {overview.current.week.due}.
          </p>
        )}
      </div>

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
                href={`/admin/compliance/ccrs?week=${w.week.key}`}
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
                  : "✓ Validation passed — the batch is cleared for upload. This is the same hard gate the zip download enforces."
                : "✕ Validation FAILED — the zip download is blocked until these errors are fixed:"}
            </div>
            {errors.length > 0 ? (
              <ul className="space-y-1 text-xs text-red-200">
                {errors.map((e, i) => (
                  <li key={i}>
                    • [{e.file}] {e.message}
                    {e.count ? ` (${e.count})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {warnings.length > 0 ? (
              <details className="text-xs text-white/50">
                <summary className="cursor-pointer font-semibold text-white/60">
                  {warnings.length} warning(s) — non-blocking, worth a skim
                </summary>
                <ul className="mt-2 space-y-1">
                  {warnings.slice(0, 25).map((w, i) => (
                    <li key={i}>
                      • [{w.file}] {w.message}
                      {w.count ? ` (${w.count})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-xs text-white/40">Connect Supabase to generate the CCRS batch.</p>
        )}
      </Section>

      {/* AI helper — drafts-only briefing grounded in this week's batch */}
      {batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={{ from: week.start, to: week.end }} /> : null}

      {/* 4) Guided upload walkthrough */}
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
        />
      ) : null}

      {/* 5) Record the week */}
      <Section
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
                    <Button type="submit" variant="neutral" size="sm">
                      Save error status
                    </Button>
                  </form>
                ) : null}
                <form action={unresolveWeekAction}>
                  <input type="hidden" name="week_key" value={week.key} />
                  <Button type="submit" variant="danger" size="sm">
                    Undo (recorded by mistake)
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        ) : !weekCompleted ? (
          <p className="text-xs text-white/40">
            This week is still in progress — it can be recorded after it closes Saturday night.
          </p>
        ) : canEdit ? (
          <div className="grid gap-3 md:grid-cols-2">
            <form action={resolveWeekAction} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <input type="hidden" name="week_key" value={week.key} />
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
              <Button type="submit" variant="confirm" size="sm" className="mt-3" disabled={!submittable || nothingToReport}>
                Record as SUBMITTED
              </Button>
              {!submittable ? (
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
              <Button type="submit" variant="neutral" size="sm" className="mt-3" disabled={totalRecords > 0}>
                Record as NOTHING TO REPORT
              </Button>
              {totalRecords > 0 ? (
                <p className="mt-2 text-[11px] text-amber-300/80">
                  Blocked: this week has {totalRecords.toLocaleString()} record(s) — it must be
                  uploaded, not skipped.
                </p>
              ) : null}
            </form>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            Recording a week requires the &ldquo;Change settings&rdquo; permission.
          </p>
        )}
      </Section>

      {/* 6) Error triage */}
      <ErrorTriagePanel
        licenseNumber={license.licenseNumber || "(license not set)"}
        licenseeName={license.submittedBy || "Greenway Marijuana"}
        weekStart={week.start}
        weekEnd={week.end}
        fileTypes={(batch?.files ?? []).filter((f) => !f.empty).map((f) => String(f.type))}
      />

      {/* 7) DOH / medical panel */}
      <Section
        title="DOH / Medical sales"
        subtitle="There is no separate DOH report upload — the obligations live inside CCRS + the LIQ-1295. These are the four legs of the tax exemption, checked for this week."
      >
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
                      : "text-white/60";
              return (
                <li key={label} className={tone}>
                  • Sales month <span className="font-bold">{label}</span> — due{" "}
                  <span className="font-bold">{p.dueDate}</span> —{" "}
                  {p.status === "filed" ? "export on record" : p.status.replace("_", " ")}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-white/40">Connect Supabase to track the monthly deadline.</p>
        )}
      </Section>

      {/* 9) Reminders */}
      <PushRemindersPanel />
      <p className="text-[11px] leading-relaxed text-white/35">
        Automatic reminders (daily cron): Thursday heads-up → Saturday week-close → Sunday
        DUE-TODAY → daily OVERDUE escalation until the week is recorded, plus the monthly LIQ-1295
        cadence. Email goes to the staff list; push goes to every enabled device. Recording a week
        above is what stops them — the system never assumes an upload happened.
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
                      <Link href={`/admin/compliance/ccrs?week=${r.week_key}`} className="underline decoration-white/20 hover:text-white">
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
