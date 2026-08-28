/**
 * /admin/atm — ATM/PAI back office (Slice A-2a: page shell + Health tab).
 *
 * Owner (Michael, Greenway Marijuana) runs one PAI ATM (terminal HG26499) on
 * the PAI Reports portal (paireports.com). This page is its single home:
 *   Tab 1 — Health (opens first): PAI connection status, honest security
 *           posture, and the credential/setup form (encrypted at rest).
 *   Tab 2 — Transactions & Fees: settlement/surcharge tables  → built in A-2b.
 *   Tab 3 — Cash Loads: physical cash loads + expected-in-machine → A-2b.
 *
 * Gate: finances.view = OWNER ONLY (slice books-06). Was settings.manage
 * (owner+admin) until migration 0190 re-gated the six atm_* tables behind this
 * page from is_staff() to is_owner(). The page gate and the database gate now
 * say the same word: owner.
 * Renders even when the DB/PAI isn't configured (unconfigured-friendly card).
 *
 * A-2a deliberately ships NO network code — the live PAI login/download and
 * the sync engine come in A-2b, once Michael sends real report CSVs so the
 * column mappers are written against real headers (never guessed).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import {
  getAtmConnection,
  listAtmSettlements,
  listAtmCashLoads,
  getAtmReconcileInputs,
  getLatestAtmTerminalStatus,
} from "@/lib/atm/store";
import { buildTerminalStatusView } from "@/lib/atm/terminal-status-core";
import {
  resolveAtmTab,
  atmConnectionStatusLine,
  atmSecurityPosture,
  passwordHint,
  buildSettlementRowView,
  summarizeSettlements,
  buildCashLoadsView,
  centsToUsd,
  atmReconcileChip,
  atmReconcileHeadline,
  type AtmTab,
} from "@/lib/atm/atm-ui-core";
import { reconcileSettlements, formatDiff } from "@/lib/atm/atm-reconcile-core";
import { parseLastProbe, parseReportSelection } from "@/lib/atm/pai-discovery";
import {
  saveAtmConnectionAction,
  clearAtmCredentialsAction,
  recordManualCashLoadAction,
  importAtmCsvsAction,
  runAtmLiveSyncAction,
  runAtmBackfillAction,
  discoverPaiReportFieldsAction,
  probeReportCandidatesAction,
  selectPaiReportAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary =
  "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost =
  "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";
const cardCls =
  "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const selectInput =
  "mt-1 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-emerald-400/50 focus:outline-none";
const textInput =
  "mt-1 w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

function tabCls(active: boolean): string {
  return `rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
    active ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
  }`;
}

function chipCls(tone: "neutral" | "green" | "orange"): string {
  if (tone === "green") return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (tone === "orange") return "border-amber-500/40 bg-amber-500/[0.08] text-amber-300";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

import PostAtmSettlementsPanel from "@/components/admin/atm/PostAtmSettlementsPanel";

export default async function AtmPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string }>;
}) {
  await requirePermission("finances.view");
  const sp = await searchParams;
  const tab: AtmTab = resolveAtmTab(sp.tab);

  const conn = await getAtmConnection();
  // Only pull the data a given tab needs (keeps the health tab snappy).
  // The loads tab also needs settlements: the machine's reported balance is only
  // true as of the last load, so it must be aged forward by what was dispensed
  // since. Without them the card would show stale cash.
  const settlements =
    tab === "transactions" || tab === "loads" ? await listAtmSettlements() : [];
  const cashLoads = tab === "loads" ? await listAtmCashLoads() : [];
  // PAI's Realtime "Terminal Status" snapshot — the machine's OWN reading of how
  // much cash it is holding right now. When present it supersedes the derived
  // estimate; when absent the estimate still shows (clearly labelled).
  const liveStatus = tab === "loads" ? await getLatestAtmTerminalStatus(conn.terminalId) : null;
  const reconcileInputs = tab === "reconcile" ? await getAtmReconcileInputs() : null;
  const encryptionOn = isAtRestEncryptionConfigured();
  const posture = atmSecurityPosture({ encryptionOn });
  const statusView = atmConnectionStatusLine({
    status: conn.status,
    terminalId: conn.terminalId,
    lastSyncAt: conn.lastSyncAt,
    lastError: conn.lastError,
    hasCredentials: conn.hasUsername || conn.hasPassword,
  });

  return (
    <div>
      <AdminPageHeader
        title="ATM"
        subtitle="Your PAI ATM (terminal HG26499) on paireports.com — connection health, transactions & surcharge revenue, and cash loads, all in one place. Owner/admin eyes only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "ATM" }]} />}
        help={
          <HelpPanel
            id="atm-home"
            title="How the ATM page works"
            steps={[
              "Health (this first tab) is where you connect the app to your PAI Reports portal. Your PAI username and password are encrypted before they're stored and are never shown back to the screen.",
              "Once connected, the app will pull your settlement report (money withdrawn + your surcharge revenue) and your cash-load report automatically — so you can see everything without logging into PAI.",
              "The bank receives TWO separate deposits per settlement (one for cash withdrawn, one for your surcharge). The Transactions tab shows both, and the Reconcile tab matches each one against the real deposit in your ATM bank account — line by line.",
              "Reconcile is your at-a-glance verdict: green means every expected deposit arrived and ties out; anything off or missing is highlighted so you can chase it. Tag your ATM account under Bank Feeds → Health first so it knows where to look.",
              "Cash Loads will track the physical cash you put into the machine and tell you how much should be inside right now.",
              "The security strip at the top tells the truth: if at-rest encryption isn't turned on yet, it says so and names the exact fix.",
            ]}
          >
            <p>
              This is built the same way as the Banking vault: encrypt at rest, mask everywhere,
              audit every change, and never send a secret back to the browser. The Transactions and
              Cash Loads tabs, plus the automatic daily pull from PAI, arrive in the next slice once
              your real report exports confirm the exact columns.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div className="mb-4 whitespace-pre-line rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
            {sp.msg}
          </div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {sp.error}
          </div>
        ) : null}

        {/* Connection status chip */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(statusView.tone)}`}
          >
            ● {statusView.label}
          </span>
          <span className="text-xs text-white/50">{statusView.detail}</span>
        </div>

        {/* Security posture strip — honest, computed */}
        <div className="mb-6 flex flex-wrap gap-2">
          {posture.map((item) => (
            <span
              key={item.key}
              title={item.note}
              className={`inline-flex cursor-help items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                item.ok
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
              }`}
            >
              {item.ok ? "✓" : "⚠"} {item.label}
            </span>
          ))}
        </div>
        {posture.some((p) => !p.ok) ? (
          <div className="mb-6 rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            {posture
              .filter((p) => !p.ok)
              .map((p) => (
                <p key={p.key} className="py-0.5">
                  <span className="font-semibold">{p.label}:</span> {p.note}
                </p>
              ))}
          </div>
        ) : null}

        {/* Tabs — Health opens first */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/admin/atm?tab=health" className={tabCls(tab === "health")}>
            Health
          </Link>
          <Link href="/admin/atm?tab=transactions" className={tabCls(tab === "transactions")}>
            Transactions &amp; Fees
          </Link>
          <Link href="/admin/atm?tab=loads" className={tabCls(tab === "loads")}>
            Cash Loads
          </Link>
          <Link href="/admin/atm?tab=reconcile" className={tabCls(tab === "reconcile")}>
            Reconcile
          </Link>
        </div>

        {tab === "health" ? (
          <HealthTab conn={conn} />
        ) : tab === "transactions" ? (
          <SettlementsTab settlements={settlements} />
        ) : tab === "loads" ? (
          <CashLoadsTab
            cashLoads={cashLoads}
            settlements={settlements}
            liveStatus={liveStatus}
            terminalId={conn.terminalId}
          />
        ) : (
          <ReconcileTab inputs={reconcileInputs} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health tab — connection/config (the only fully-built tab in A-2a)
// ---------------------------------------------------------------------------

function HealthTab({
  conn,
}: {
  conn: Awaited<ReturnType<typeof getAtmConnection>>;
}) {
  // The most-recent probe's ranked candidates per kind, so we can offer a
  // one-click "pick this report" list (no typing GUIDs).
  const lastProbe = parseLastProbe((conn.reportConfig as Record<string, unknown> | null)?.lastProbe);
  // The report Michael has CHOSEN for each kind (what the sync downloads). Once
  // these are set, the "test / pick" tools below are just for changing his mind.
  const savedSelection = parseReportSelection(
    (conn.reportConfig as Record<string, unknown> | null)?.reportSelection,
  );
  const reportKinds = [
    { kind: "simpleSummary", label: "Simple Summary" },
    { kind: "fundsMovement", label: "Bank Deposits" },
    { kind: "cashLoad", label: "Cash Loads" },
  ] as const;
  const allChosen = reportKinds.every((k) => {
    const sel = savedSelection[k.kind];
    return Boolean(sel && (sel.reportGuid || sel.name));
  });
  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={cardCls}>
        <h2 className="mb-1 text-sm font-bold text-white">PAI Reports connection</h2>
        <p className="mb-4 text-xs text-white/50">
          Enter the login for your PAI Reports portal (paireports.com). Best practice: use a
          <span className="font-semibold text-white/70"> read-only sub-user</span> from PAI support, not your main
          owner login. Your password is encrypted before it is stored and is never shown back here.
        </p>

        <form action={saveAtmConnectionAction} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="portal_base_url">
              Portal base URL
            </label>
            <input
              id="portal_base_url"
              name="portal_base_url"
              className={inputCls}
              defaultValue={conn.portalBaseUrl}
              placeholder="https://paireports.com/myreports/"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="terminal_id">
                Terminal number
              </label>
              <input
                id="terminal_id"
                name="terminal_id"
                className={inputCls}
                defaultValue={conn.terminalId}
                placeholder="HG26499"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="company_label">
                Company / portfolio label
              </label>
              <input
                id="company_label"
                name="company_label"
                className={inputCls}
                defaultValue={conn.companyLabel}
                placeholder="CASCADE GENERAL PARTNERS"
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="pai_username">
              PAI username
            </label>
            <input
              id="pai_username"
              name="pai_username"
              className={inputCls}
              autoComplete="off"
              defaultValue=""
              placeholder={conn.hasUsername ? `Saved (${conn.usernameHint}) — type to replace` : "you@example.com"}
            />
            {conn.hasUsername ? (
              <p className="mt-1 text-xs text-white/40">A username is saved. Leave blank to keep it, or type a new one.</p>
            ) : null}
          </div>

          <div>
            <label className={labelCls} htmlFor="pai_password">
              PAI password
            </label>
            <input
              id="pai_password"
              name="pai_password"
              type="password"
              className={inputCls}
              autoComplete="new-password"
              placeholder={conn.hasPassword ? "•••••••• (saved) — type to replace" : "Enter password"}
            />
            <p className="mt-1 text-xs text-white/40">{passwordHint(conn.hasPassword)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" className={btnPrimary}>
              Save connection
            </button>
          </div>
        </form>

        {conn.hasUsername || conn.hasPassword ? (
          <form action={clearAtmCredentialsAction} className="mt-4 border-t border-white/10 pt-4">
            <button type="submit" className={btnGhost}>
              Clear saved credentials
            </button>
          </form>
        ) : null}
      </div>

      <div className={cardCls}>
        <h2 className="mb-1 text-sm font-bold text-white">Status</h2>
        <dl className="divide-y divide-white/5 text-sm">
          <Row label="Connection" value={conn.status === "ok" ? "Connected" : conn.status === "error" ? "Error" : "Not connected"} />
          <Row label="Terminal" value={conn.terminalId || "—"} />
          <Row label="Company" value={conn.companyLabel || "—"} />
          <Row label="Portal" value={conn.portalBaseUrl} />
          <Row label="Username on file" value={conn.hasUsername ? conn.usernameHint : "—"} />
          <Row label="Password on file" value={conn.hasPassword ? "Yes (encrypted)" : "—"} />
          <Row label="Last sync" value={conn.lastSyncAt || "Never"} />
          <Row label="Last error" value={conn.lastError || "—"} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <form action={runAtmLiveSyncAction}>
            <button type="submit" className={btnPrimary}>
              Sync now
            </button>
          </form>
          <form action={runAtmBackfillAction}>
            <button type="submit" className={btnGhost}>
              Backfill history (from 2/29/24)
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-white/40">
          &ldquo;Sync now&rdquo; signs in to PAI and pulls your reports for the recent window (it also runs once daily).
          &ldquo;Backfill history&rdquo; loads everything back to 2/29/2024 &mdash; run it once, then the daily sync keeps
          it current. Re-importing is always safe: the same rows update instead of duplicating.
        </p>
      </div>

      <div className={cardCls}>
        <h2 className="mb-1 text-sm font-bold text-white">Reports in use</h2>
        <p className="mb-3 text-xs text-white/40">
          {allChosen
            ? "These are the reports your sync downloads. You\u2019re all set \u2014 use \u201cSync now\u201d or \u201cBackfill history\u201d above."
            : "Choose the correct report for each row below so the sync knows exactly what to download."}
        </p>
        <dl className="divide-y divide-white/5 text-sm">
          {reportKinds.map((k) => {
            const sel = savedSelection[k.kind];
            const chosen = Boolean(sel && (sel.reportGuid || sel.name));
            return (
              <div key={k.kind} className="flex items-start justify-between gap-3 py-2">
                <dt className="text-white/50">{k.label}</dt>
                <dd className="text-right">
                  {chosen ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={chipCls("green")}>Chosen</span>
                      <span className="text-white/80">{sel?.name || sel?.reportGuid}</span>
                    </span>
                  ) : (
                    <span className={chipCls("orange")}>Not chosen yet</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <details className="mt-4 border-t border-white/10 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-white/80">
            {allChosen ? "Change which report is used (advanced)" : "Find & choose the right report"}
          </summary>

          <p className="mt-3 text-xs text-white/40">
            When PAI lists several look-alike reports, click a &ldquo;Test&rdquo; button to <em>try each candidate and
            see which one actually returns data</em> (read-only &mdash; it downloads a small sample and ranks them). If
            one clearly wins it&rsquo;s saved automatically; otherwise pick it from the ranked list. After a report is
            chosen, run &ldquo;Discover report fields&rdquo; then &ldquo;Backfill history&rdquo;.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {reportKinds.map((k) => (
              <form key={k.kind} action={probeReportCandidatesAction}>
                <input type="hidden" name="kind" value={k.kind} />
                <button type="submit" className={btnGhost}>
                  Test: {k.label}
                </button>
              </form>
            ))}
            <form action={discoverPaiReportFieldsAction}>
              <button type="submit" className={btnGhost}>
                Discover report fields (no F12)
              </button>
            </form>
          </div>

          {reportKinds.map(({ kind, label: kindLabel }) => {
            const probe = lastProbe[kind];
            if (!probe || probe.candidates.length === 0) return null;
            return (
              <form key={kind} action={selectPaiReportAction} className="mt-4 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
                <input type="hidden" name="kind" value={kind} />
                <p className="text-xs font-semibold text-white/70">
                  Pick the correct <span className="text-emerald-300">{kindLabel}</span> report (from your last test):
                </p>
                <div className="mt-2 space-y-1.5">
                  {probe.candidates.map((c, i) => (
                    <label key={c.reportGuid} className="flex cursor-pointer items-start gap-2 text-xs text-white/70">
                      <input
                        type="radio"
                        name="reportGuid"
                        value={c.reportGuid}
                        defaultChecked={c.reportGuid === probe.winnerGuid || (probe.winnerGuid === null && i === 0)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-white/85">{c.label}</span>
                        <span className="text-white/40">
                          {" "}
                          — {c.hasData ? `${c.rowCount} row(s)` : "no data"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <button type="submit" className={`${btnGhost} mt-2`}>
                  Save this {kindLabel} report
                </button>
              </form>
            );
          })}

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-white/60">
              Pick a report by name (if you already know which one)
            </summary>
            <form action={selectPaiReportAction} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-white/50">
                Report
                <select name="kind" className={selectInput} defaultValue="simpleSummary">
                  <option value="simpleSummary">Simple Summary</option>
                  <option value="fundsMovement">Bank Deposits</option>
                  <option value="cashLoad">Cash Loads</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col text-xs text-white/50">
                Exact report name (paste from the list above)
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Default Simple Summary Report"
                  className={textInput}
                />
              </label>
              <button type="submit" className={btnGhost}>
                Save this report
              </button>
            </form>
            <p className="mt-1 text-xs text-white/40">
              Paste the report name exactly as shown in the list (the part in parentheses is the internal name; either
              the internal name or the display name works). I&rsquo;ll match it to PAI and save it &mdash; and I&rsquo;ll
              never guess between two that share a name.
            </p>
          </details>
        </details>
      </div>

      <div className={`${cardCls} lg:col-span-2`}>
        <h2 className="mb-1 text-sm font-bold text-white">Import PAI report CSVs</h2>
        <p className="mb-4 text-xs text-white/50">
          Download your reports from paireports.com and paste each CSV below (or copy the file contents). You can import
          any one, two, or all three &mdash; and it&rsquo;s safe to re-import: the same report updates the existing rows
          instead of duplicating them. Amounts are read straight from your files; nothing is guessed.
        </p>

        <form action={importAtmCsvsAction} className="grid gap-4 lg:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="cash_load_csv">
              ATM Cash Load Report
            </label>
            <textarea
              id="cash_load_csv"
              name="cash_load_csv"
              rows={7}
              className={`${inputCls} font-mono text-xs`}
              placeholder="Paste the Cash Load Report CSV here (Trx Time, Cash Load, Balance)…"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="simple_summary_csv">
              Simple Summary Report
            </label>
            <textarea
              id="simple_summary_csv"
              name="simple_summary_csv"
              rows={7}
              className={`${inputCls} font-mono text-xs`}
              placeholder="Paste the Simple Summary Report CSV here (counts, surcharge, settlement)…"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="funds_movement_csv">
              Bank Deposits (Funds Movement)
            </label>
            <textarea
              id="funds_movement_csv"
              name="funds_movement_csv"
              rows={7}
              className={`${inputCls} font-mono text-xs`}
              placeholder="Paste the Bank Deposits / Funds Movement CSV here (the two deposit legs)…"
            />
          </div>
          <div className="lg:col-span-3 flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" className={btnPrimary}>
              Import reports
            </button>
            <span className="text-xs text-white/40">
              After importing, check the Transactions &amp; Fees and Cash Loads tabs to see your data.
            </span>
          </div>
        </form>
      </div>
    </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-white/50">{label}</dt>
      <dd className="truncate text-right font-medium text-white/80">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions & Fees tab — settlement table + fee-totals card
// ---------------------------------------------------------------------------

function SettlementsTab({
  settlements,
}: {
  settlements: Awaited<ReturnType<typeof listAtmSettlements>>;
}) {
  const summary = summarizeSettlements(settlements);
  const rows = settlements.map((s) => buildSettlementRowView(s));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No settlements yet"
        lines={[
          "This tab lists each settlement day: how many cash withdrawals happened, your surcharge revenue (you keep 100%), and the two deposits your bank should receive — one for the cash withdrawn, one for your surcharge.",
          "It fills in automatically once the daily PAI pull runs (the next step, A-2c). Nothing is missing on your end — there's just no synced data yet.",
        ]}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Fee-totals summary card */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Surcharge revenue"
          value={summary.totalSurchargeUsd}
          hint={`${summary.count} settlement day${summary.count === 1 ? "" : "s"} — you keep 100%`}
          tone="green"
        />
        <StatCard
          label="Cash withdrawn (re-deposit leg)"
          value={summary.totalTxnUsd}
          hint="Vault cash returned to the bank"
        />
        <StatCard
          label="Total expected at bank"
          value={summary.totalExpectedUsd}
          hint={
            summary.earliestDate && summary.latestDate
              ? `${summary.earliestDate} → ${summary.latestDate}`
              : "Across both deposit legs"
          }
        />
      </div>

      {/* ── FILE THESE DAYS INTO THE BOOKS (books-89, D-40) ────────────────
          books-69 built the entry for a settled day and nothing ever filed it,
          so the surcharge income of an entire separate business had never
          reached the ledger. This is the missing button. It sits directly above
          the table it acts on, because the days listed below are exactly the
          days it files. */}
      <div className={cardCls}>
        <h2 className="mb-1 text-sm font-bold text-white">File these days into the books</h2>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-white/55">
          Each settled day below becomes one journal entry: the money that arrived in
          the ATM account, split between the surcharge you earned and the cash the
          machine handed out. The fee is income of the ATM business, which is a
          separate trade from the store and is not subject to 280E.
        </p>
        <PostAtmSettlementsPanel />
      </div>

      <div className={cardCls}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Settlements by day</h2>
          <span className="text-xs text-white/40">{rows.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3 font-semibold">Settlement date</th>
                <th className="py-2 pr-3 font-semibold">Withdrawals</th>
                <th className="py-2 pr-3 text-right font-semibold">Cash withdrawn</th>
                <th className="py-2 pr-3 text-right font-semibold">Surcharge</th>
                <th className="py-2 pl-3 text-right font-semibold">Expected deposit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.settlementDate}-${r.terminalId}-${i}`} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-medium text-white/80">{r.settlementDate}</td>
                  <td className="py-2 pr-3 text-white/60">{r.withdrawalsLabel}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-white/80">{r.txnUsd}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{r.surchargeUsd}</td>
                  <td className="py-2 pl-3 text-right font-semibold tabular-nums text-white">{r.expectedDepositUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-white/40">
          The bank receives TWO separate deposits per settlement — one for the cash withdrawn, one for your
          surcharge. Matching each deposit against your bank feed arrives with reconciliation (Slice A-3).
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Loads tab — expected-in-machine card + manual entry + load history
// ---------------------------------------------------------------------------

function CashLoadsTab({
  cashLoads,
  settlements,
  liveStatus,
  terminalId,
}: {
  cashLoads: Awaited<ReturnType<typeof listAtmCashLoads>>;
  settlements: Awaited<ReturnType<typeof listAtmSettlements>>;
  liveStatus: Awaited<ReturnType<typeof getLatestAtmTerminalStatus>>;
  terminalId: string;
}) {
  const view = buildCashLoadsView(cashLoads, settlements);

  // PAI's live snapshot beats our derived estimate whenever we have one. The
  // estimate is a conservative upper bound (settlements land as whole days);
  // the live reading is the machine's own count, so it needs no caveat.
  const status = buildTerminalStatusView(
    liveStatus
      ? {
          terminalId: liveStatus.terminalId,
          location: liveStatus.location,
          groupName: liveStatus.groupName,
          status: liveStatus.status,
          daysUntilCashOut: liveStatus.daysUntilCashOut,
          lastTrxRaw: liveStatus.lastTrxRaw,
          lastWithdrawalTrxRaw: liveStatus.lastWdTrxRaw,
          lastReversalTrxRaw: liveStatus.lastRevTrxRaw,
          trxsSinceSettlement: liveStatus.trxsSinceSettlement,
          balancePrevEodCents: liveStatus.balancePrevEodCents,
          balanceCents: liveStatus.balanceCents,
          raw: {},
        }
      : null,
    { capturedAt: liveStatus?.capturedAt ?? null, estimateCents: view.currentInMachineCents },
  );

  // Plain-English hint for the headline number. It must never imply more
  // precision than the underlying data supports.
  const estimateHint =
    view.currentInMachineCents !== null
      ? `Balance at the ${view.lastLoadDate ?? "last"} load, minus ${view.dispensedSinceLoadUsd} dispensed through ${view.dispensedThroughDate}${
          view.sameDayLoadCaveat ? ". Load-day withdrawals aren't split out, so treat this as a high estimate" : ""
        }`
      : view.expectedInMachineCents === null
        ? "PAI hasn't reported a balance yet"
        : "No settled withdrawals since the last load yet — sync to update";

  const currentHint =
    status.currentCashSource === "live"
      ? `Read live from the machine${status.capturedAt ? ` on ${fmtLocalDateTime(status.capturedAt)}` : ""} — the exact cash on hand, not an estimate`
      : estimateHint;

  return (
    <div className="space-y-6">
      {/* Live machine status — only shown when PAI actually gave us one. */}
      {status.hasSnapshot ? (
        <div className={cardCls}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white">
              Live machine status{status.terminalId ? ` — ${status.terminalId}` : ""}
            </h2>
            <div className="flex items-center gap-2">
              {status.status ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    status.statusTone === "green"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : status.statusTone === "orange"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-white/10 text-white/60"
                  }`}
                >
                  {status.status}
                </span>
              ) : null}
              {status.capturedAt ? (
                <span className="text-xs text-white/40">as of {fmtLocalDateTime(status.capturedAt)}</span>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <MiniStat
              label="Withdrawals since settlement"
              value={status.trxsSinceSettlement === null ? "—" : String(status.trxsSinceSettlement)}
            />
            <MiniStat
              label="Days until cash out"
              value={status.daysUntilCashOut === null ? "—" : String(status.daysUntilCashOut)}
            />
            <MiniStat label="Last withdrawal" value={status.lastWithdrawalTrxRaw ?? "—"} />
            <MiniStat
              label="Balance at previous end of day"
              value={centsToUsd(status.balancePrevEodCents)}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Current cash in machine"
          value={
            status.currentCashCents !== null
              ? centsToUsd(status.currentCashCents)
              : view.expectedInMachineUsd
          }
          hint={currentHint}
          tone="green"
        />
        <StatCard
          label="Balance at last load"
          value={view.expectedInMachineUsd}
          hint={
            view.expectedInMachineCents === null
              ? "PAI hasn't reported a balance yet"
              : `What PAI reported on ${view.lastLoadDate ?? "the last load"} — before any withdrawals since`
          }
        />
        <StatCard
          label="Dispensed since last load"
          value={view.dispensedSinceLoadUsd}
          hint={
            view.dispensedSinceLoadCents === null
              ? "No settled withdrawals since that load"
              : `Settled withdrawals through ${view.dispensedThroughDate}`
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-1">
        <StatCard
          label="Total cash loaded"
          value={view.totalLoadedUsd}
          hint={`${view.loadCount} load${view.loadCount === 1 ? "" : "s"} on record`}
        />
      </div>

      {/* Manual entry fallback */}
      <div className={cardCls}>
        <h2 className="mb-1 text-sm font-bold text-white">Record a cash load (manual)</h2>
        <p className="mb-4 text-xs text-white/50">
          Cash loads normally pull in automatically from PAI. Use this only if you need to log a load by
          hand — for example, before the next automatic sync runs. Amounts are stored exactly, in cents.
        </p>
        <form action={recordManualCashLoadAction} className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-1">
            <label className={labelCls} htmlFor="cl_terminal">Terminal</label>
            <input
              id="cl_terminal"
              name="terminal_id"
              className={inputCls}
              defaultValue={terminalId || "HG26499"}
              placeholder="HG26499"
            />
          </div>
          <div className="sm:col-span-1">
            <label className={labelCls} htmlFor="cl_amount">Amount (USD)</label>
            <input id="cl_amount" name="amount" className={inputCls} inputMode="decimal" placeholder="2000.00" />
          </div>
          <div className="sm:col-span-1">
            <label className={labelCls} htmlFor="cl_date">Load date</label>
            <input id="cl_date" name="load_date" type="date" className={inputCls} />
          </div>
          <div className="sm:col-span-1 flex items-end">
            <button type="submit" className={`${btnPrimary} w-full`}>Record load</button>
          </div>
          <div className="sm:col-span-4">
            <label className={labelCls} htmlFor="cl_note">Note (optional)</label>
            <input id="cl_note" name="note" className={inputCls} placeholder="e.g. loaded before morning open" />
          </div>
        </form>
      </div>

      <div className={cardCls}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Load history</h2>
          <span className="text-xs text-white/40">{view.rows.length} shown</span>
        </div>
        {view.rows.length === 0 ? (
          <p className="text-sm text-white/60">
            No cash loads recorded yet. They&rsquo;ll appear here automatically once the daily PAI pull runs
            (Slice A-2c), or you can log one by hand above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                  <th className="py-2 pr-3 font-semibold">Loaded</th>
                  <th className="py-2 pr-3 text-right font-semibold">Cash load</th>
                  <th className="py-2 pr-3 text-right font-semibold">Balance after</th>
                  <th className="py-2 pl-3 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r, i) => (
                  <tr key={`${r.loadedAt}-${i}`} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-medium text-white/80">{r.loadedAt}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white/80">{r.cashLoadUsd}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white/60">{r.balanceAfterUsd}</td>
                    <td className="py-2 pl-3 text-white/50">{r.sourceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-white/40">
          You load the machine with physical cash (not from the ATM bank account), so loads do not expect a
          matching bank debit. &ldquo;Balance at last load&rdquo; is PAI&rsquo;s own reported figure at that
          moment. &ldquo;Current cash in machine&rdquo; prefers PAI&rsquo;s live Terminal Status reading &mdash;
          the machine&rsquo;s own count of what it is holding right now. If that live reading isn&rsquo;t
          available it falls back to the last load balance minus the cash settled since; because
          withdrawals settle as whole days, that fallback is a high estimate, never a low one. The card
          always tells you which of the two you are looking at.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconcile tab (P6a) — match each settlement's two deposit legs against the
// deposits that actually posted in the ATM bank account. Built to be wielded by
// a novice: a plain-English verdict banner up top, then a line-item table where
// anything needing attention is highlighted.
// ---------------------------------------------------------------------------

function todayIsoUtc(): string {
  const d = new Date();
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

function ReconcileTab({
  inputs,
}: {
  inputs: Awaited<ReturnType<typeof getAtmReconcileInputs>> | null;
}) {
  // DB unconfigured (inputs === null only when not the reconcile tab; guard anyway).
  if (!inputs) {
    return <EmptyState title="Reconciliation" lines={["Loading reconciliation…"]} />;
  }

  // Guidance when the ATM bank account hasn't been tagged yet — the #1 setup step.
  if (!inputs.hasAtmAccount) {
    return (
      <EmptyState
        title="Tag your ATM bank account first"
        lines={[
          "Reconciliation matches your ATM settlements against the deposits that land in your dedicated ATM bank account. First, tell the app which connected account that is.",
          'Go to Bank Feeds → the Health tab, find your ATM account, and set its job to "ATM deposits." Then come back here and your deposits will match up automatically.',
          "You only do this once. After that, every settlement's two deposits (cash withdrawn + your surcharge) are matched here line by line.",
        ]}
      />
    );
  }

  if (inputs.settlements.length === 0) {
    return (
      <EmptyState
        title="No settlements to reconcile yet"
        lines={[
          "Your ATM bank account is connected — nice. Once your PAI settlements sync in (Transactions & Fees tab), each one's two deposits will be matched against your bank feed right here.",
          "Nothing is wrong; there's just no settlement data to match yet.",
        ]}
      />
    );
  }

  // SCOPE TO THE CURRENT YEAR (owner defect, 2026-08-15).
  // Michael: "the system thinks the full history is the picture we should be
  // looking at, when we really only care about the current year." The ATM data
  // reaches back to 2024 but the bank feed does not, so evaluating all history
  // produced a large phantom shortage out of settlements that simply have no
  // bank records to match. The engine also now reports pre-feed legs as
  // `no_bank_data` and keeps them out of the totals, so this is belt AND braces.
  const today = todayIsoUtc();
  const currentYearStart = `${today.slice(0, 4)}-01-01`;
  const result = reconcileSettlements(inputs.settlements, inputs.deposits, {
    todayIso: today,
    fromDateIso: currentYearStart,
  });
  const { legs, summary, unexplainedDeposits } = result;
  const headline = atmReconcileHeadline({
    allClear: summary.allClear,
    legCount: summary.legCount,
    mismatch: summary.mismatch,
    unmatched: summary.unmatched,
    awaiting: summary.awaiting,
    late: summary.late,
    bundled: summary.bundled,
    noBankData: summary.noBankData,
  });

  return (
    <div className="space-y-6">
      {/* Verdict banner — the whole point, in one glance. */}
      <div
        className={`rounded-[var(--admin-radius)] border p-5 ${
          headline.tone === "green"
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : headline.tone === "orange"
              ? "border-amber-500/40 bg-amber-500/[0.08]"
              : "border-white/10 bg-white/[0.02]"
        }`}
      >
        <h2
          className={`text-lg font-bold ${
            headline.tone === "green" ? "text-emerald-300" : headline.tone === "orange" ? "text-amber-300" : "text-white"
          }`}
        >
          {headline.title}
        </h2>
        <p className="mt-1 text-sm text-white/70">{headline.detail}</p>
      </div>

      {/* Count + money summary. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Matched" value={String(summary.matched)} hint="Deposits that arrived & tie out" tone="green" />
        <StatCard label="Awaiting" value={String(summary.awaiting)} hint="Still within the bank's posting window" />
        <StatCard label="Amount off" value={String(summary.mismatch)} hint="Posted, but not the expected amount" />
        <StatCard label="Not deposited" value={String(summary.unmatched)} hint="Window passed — please chase" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total expected at bank" value={centsToUsd(summary.totalExpectedCents)} hint="Across all matched/expected legs" />
        <StatCard label="Total matched" value={centsToUsd(summary.totalMatchedCents)} hint="Actually posted so far" />
        <StatCard
          label="Difference"
          value={formatDiff(summary.netDifferenceCents)}
          hint={summary.netDifferenceCents === 0 ? "Ties out to the penny" : "Matched minus expected"}
          tone={summary.netDifferenceCents === 0 ? "green" : "neutral"}
        />
      </div>

      {/* Line-item reconciliation table — two legs per settlement, as the bank shows them. */}
      <div className={cardCls}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Deposit-by-deposit match</h2>
          <span className="text-xs text-white/40">{legs.length} legs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3 font-semibold">Settlement date</th>
                <th className="py-2 pr-3 font-semibold">Deposit</th>
                <th className="py-2 pr-3 text-right font-semibold">Expected</th>
                <th className="py-2 pr-3 text-right font-semibold">Posted</th>
                <th className="py-2 pr-3 font-semibold">Posted on</th>
                <th className="py-2 pl-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => {
                const chip = atmReconcileChip(l.status);
                return (
                  <tr
                    key={l.key}
                    className={`border-b border-white/5 ${chip.needsAttention ? "bg-amber-500/[0.04]" : ""}`}
                  >
                    <td className="py-2 pr-3 font-medium text-white/80">{l.settlementDate}</td>
                    <td className="py-2 pr-3 text-white/70">{l.legLabel}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white/80">
                      {l.expectedCents === null ? "—" : centsToUsd(l.expectedCents)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white/80">
                      {l.matchedCents === null ? "—" : centsToUsd(l.matchedCents)}
                    </td>
                    <td className="py-2 pr-3 text-white/50">{l.bankPostedDate ?? "—"}</td>
                    <td className="py-2 pl-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chipCls(chip.tone)}`}
                        title={l.message}
                      >
                        ● {chip.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-white/40">
          Each settlement lands as TWO separate deposits — the cash withdrawn from your machine and your surcharge —
          so we match them line by line, exactly as your bank shows them. Hover a status for the details.
        </p>
      </div>

      {/* Rows that need action, spelled out. */}
      {legs.some((l) => atmReconcileChip(l.status).needsAttention) ? (
        <div className={`${cardCls} border-amber-500/30`}>
          <h2 className="mb-2 text-sm font-bold text-amber-300">What to check</h2>
          <ul className="space-y-2">
            {legs
              .filter((l) => atmReconcileChip(l.status).needsAttention)
              .map((l) => (
                <li key={`act-${l.key}`} className="text-sm text-white/70">
                  <span className="font-semibold text-white/85">{l.settlementDate} · {l.legLabel}:</span> {l.message}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {/* Deposits we couldn't tie to any settlement leg. */}
      {unexplainedDeposits.length > 0 ? (
        <div className={cardCls}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">Deposits we couldn&apos;t match</h2>
            <span className="text-xs text-white/40">
              {unexplainedDeposits.length} · {centsToUsd(summary.unexplainedDepositCents)}
            </span>
          </div>
          <p className="mb-3 text-xs text-white/50">
            These deposits landed in the ATM account but don&apos;t line up with any settlement leg (yet). That&apos;s
            usually a manual transfer, or settlement data that hasn&apos;t synced. Nothing here is lost — it&apos;s just
            not explained by ATM settlements.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                  <th className="py-2 pr-3 font-semibold">Posted on</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pl-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unexplainedDeposits.map((d) => (
                  <tr key={`ux-${d.transactionId}`} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-white/60">{d.date}</td>
                    <td className="py-2 pr-3 text-white/70">{d.description ?? "Deposit"}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-white/80">{centsToUsd(d.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small building blocks
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "green";
}) {
  return (
    <div className={cardCls}>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === "green" ? "text-emerald-300" : "text-white"}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-white/40">{hint}</p> : null}
    </div>
  );
}

/** A compact readout inside the live-status card (smaller than StatCard). */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}

/**
 * Render a stored ISO timestamp in the store's Pacific business clock, so "as
 * of" always reads in the owner's own time rather than UTC.
 */
function fmtLocalDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "numeric",
      day: "numeric",
      year: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EmptyState({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className={cardCls}>
      <h2 className="mb-2 text-sm font-bold text-white">{title}</h2>
      {lines.map((l, i) => (
        <p key={i} className="mb-2 text-sm text-white/60">
          {l}
        </p>
      ))}
    </div>
  );
}
