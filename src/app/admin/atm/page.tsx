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
 * Gate: settings.manage = owner + admin ONLY (same as Banking/Payroll).
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
import { getAtmConnection, listAtmSettlements, listAtmCashLoads } from "@/lib/atm/store";
import {
  resolveAtmTab,
  atmConnectionStatusLine,
  atmSecurityPosture,
  passwordHint,
  buildSettlementRowView,
  summarizeSettlements,
  buildCashLoadsView,
  type AtmTab,
} from "@/lib/atm/atm-ui-core";
import {
  saveAtmConnectionAction,
  clearAtmCredentialsAction,
  recordManualCashLoadAction,
  importAtmCsvsAction,
  runAtmLiveSyncAction,
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

export default async function AtmPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab: AtmTab = resolveAtmTab(sp.tab);

  const conn = await getAtmConnection();
  // Only pull the data a given tab needs (keeps the health tab snappy).
  const settlements = tab === "transactions" ? await listAtmSettlements() : [];
  const cashLoads = tab === "loads" ? await listAtmCashLoads() : [];
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
              "The bank receives TWO separate deposits per settlement (one for cash withdrawn, one for your surcharge). The Transactions tab will show both, and a later step will match them against your bank feed.",
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
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
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
        </div>

        {tab === "health" ? (
          <HealthTab conn={conn} />
        ) : tab === "transactions" ? (
          <SettlementsTab settlements={settlements} />
        ) : (
          <CashLoadsTab cashLoads={cashLoads} terminalId={conn.terminalId} />
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
        <form action={runAtmLiveSyncAction} className="mt-4 border-t border-white/10 pt-4">
          <button type="submit" className={btnGhost}>
            Sync now (live)
          </button>
          <p className="mt-2 text-xs text-white/40">
            This signs in to PAI with your saved login and pulls your three reports automatically (it also runs once
            daily). If PAI hands back a web page instead of a CSV, you&rsquo;ll see a note here &mdash; capture the exact
            download command once and we&rsquo;ll set it. You can always use &ldquo;Import PAI report CSVs&rdquo; below.
          </p>
        </form>
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
  terminalId,
}: {
  cashLoads: Awaited<ReturnType<typeof listAtmCashLoads>>;
  terminalId: string;
}) {
  const view = buildCashLoadsView(cashLoads);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Expected cash in machine"
          value={view.expectedInMachineUsd}
          hint={
            view.expectedInMachineCents === null
              ? "PAI hasn't reported a balance yet"
              : "From the most recent reported balance"
          }
          tone="green"
        />
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
          matching bank debit. &ldquo;Expected cash in machine&rdquo; uses PAI&rsquo;s own reported balance.
        </p>
      </div>
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
