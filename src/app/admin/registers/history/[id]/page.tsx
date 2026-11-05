import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { Breadcrumbs } from "@/components/admin/ux";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import { tillSummaryData } from "@/lib/registers/eod-store";
import { compareCounts, secondCountSentence } from "@/lib/registers/second-count-core";
import { can } from "@/lib/auth/roles";
import { OVER_SHORT_REASON_MAX_LEN } from "@/lib/registers/over-short-warning-core";
import { correctReconciledDrawerAction } from "../../actions";
import { getSecondCountBreakdown } from "@/lib/registers/store";
import { countTableRows } from "@/lib/registers/drawer-close-slip-core";
import {
  CLOSER_COUNT_HIDDEN_TEXT,
  cleanFlags,
  closerCountVisible,
  countedCashMinor,
  flagSentence,
  loudFlags,
} from "@/lib/registers/count-integrity-core";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed (blind — awaiting reconcile)",
  reconciled: "Reconciled",
  verified: "Verified",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-black/20" : undefined}>
      <td className={`py-0.5 ${strong ? "font-bold" : ""}`}>{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${strong ? "font-black" : "font-bold"}`}>{value}</td>
    </tr>
  );
}

export default async function TillSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; corrected?: string }>;
}) {
  const staff = await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // Owner D127: owner and admin may correct a reconciled drawer's count.
  const canCorrect = can(staff.profile.role, "registers.warnings");
  if (!isSupabaseServiceConfigured) notFound();

  const data = await tillSummaryData(id);
  if (!data) notFound();
  const { session, registerName, openedByName, closedByName, secondCountedByName, drops, swaps } = data;
  // Owner D154 (2026-11-03): the second count's bill-by-bill table, read only.
  const secondTable =
    session.second_count_minor != null ? await getSecondCountBreakdown(session.id).then((b) => (b ? countTableRows(b.counts) : null)) : null;

  const revealed = session.status === "reconciled" || session.status === "verified";
  // D180 (S3): the closer's blind count stays hidden until the second count is
  // in (everyone is a manager type, so the page itself must not let a second
  // counter peek). The money figure is the count the drawer was reconciled on.
  const closerVisible = closerCountVisible(session);
  const reconciledOn = countedCashMinor(session);
  const reconciledDiffers =
    revealed && typeof session.reconciled_count_minor === "number" && session.reconciled_count_minor !== session.closing_count_minor;
  const flags = cleanFlags(session.second_count_flags);
  const loud = loudFlags(flags);
  const flagSeconds =
    session.second_count_opened_at && session.second_counted_at
      ? Math.max(0, Math.floor((Date.parse(session.second_counted_at) - Date.parse(session.second_count_opened_at)) / 1000))
      : null;
  const dropsTotal = drops.reduce((sum, d) => sum + d.amount_minor, 0);

  return (
    <div>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: "Sell" },
            { label: "Register Activity", href: BASE },
            { label: "Cash drawer reports", href: `${BASE}/history` },
            { label: "Till summary" },
          ]}
        />
      </div>

      {sp.error ? (
        <div className="mx-auto mt-4 max-w-2xl rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">{sp.error}</div>
      ) : null}
      {sp.corrected != null ? (
        <div className="mx-auto mt-4 max-w-2xl rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 print:hidden">
          Drawer corrected · now {overShortLabel(Number(sp.corrected) || 0)}. The old and new figures are in the notes below and in the audit log. The books were not touched.
        </div>
      ) : null}

      <div className="ticket-print mx-auto mt-4 max-w-2xl bg-white px-8 py-8 text-black">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <p className="text-xl font-black uppercase tracking-tight">Greenway Marijuana</p>
            <p className="text-xs uppercase tracking-[0.18em] text-black/60">Till summary — drawer session</p>
          </div>
          <PrintButton />
        </div>

        {/* Register + day + status */}
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-black/50">Register</p>
            <p className="text-2xl font-black leading-tight tracking-tight">{registerName}</p>
            <p className="text-sm font-bold">{session.business_day}</p>
          </div>
          <p className="rounded border-2 border-black px-3 py-1 text-sm font-black uppercase tracking-[0.1em]">
            {STATUS_LABEL[session.status] ?? session.status}
          </p>
        </div>

        {/* The cash story */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Cash accountability
        </h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            <Row
              label={`Opened ${fmtTime(session.opened_at)}${openedByName ? ` by ${openedByName}` : ""}`}
              value={session.opening_count_minor == null ? "—" : formatCents(session.opening_count_minor)}
            />
            <Row label={`Safe drops (${drops.length})`} value={drops.length > 0 ? `−${formatCents(dropsTotal)}` : "—"} />
            <Row
              label={`Closed ${fmtTime(session.closed_at)}${closedByName ? ` by ${closedByName}` : ""} (blind count)`}
              value={
                !closerVisible
                  ? CLOSER_COUNT_HIDDEN_TEXT
                  : session.closing_count_minor == null
                    ? "—"
                    : formatCents(session.closing_count_minor)
              }
            />
            {/* Fix Phase 2.2 (G-01, owner D2): the second person's own count.
                Not blind-sensitive: both people already know their counts. */}
            {session.second_count_minor != null ? (
              <Row
                label={`Second count${secondCountedByName ? ` by ${secondCountedByName}` : ""}`}
                value={formatCents(session.second_count_minor)}
              />
            ) : null}
            {/* D180: when the drawer was reconciled on a different count than the
                closer's (the second count, or a correction), both stay on the sheet. */}
            {reconciledDiffers && reconciledOn != null ? (
              <Row label="Reconciled on (the count the books use)" value={formatCents(reconciledOn)} strong />
            ) : null}
            {revealed ? (
              <>
                {/* Fix Phase 2.1 (G-05): the system figure the reconcile used
                    (migration 0313). Older drawers, reconciled from a typed
                    figure, have no stored split, so the rows are left out. */}
                {session.cash_sales_minor != null ? (
                  <Row label="Cash sales on this drawer (system figure)" value={formatCents(session.cash_sales_minor)} />
                ) : null}
                {session.refunds_paid_minor != null ? (
                  <Row
                    label="Refunds paid from this drawer"
                    value={session.refunds_paid_minor > 0 ? `−${formatCents(session.refunds_paid_minor)}` : "—"}
                  />
                ) : null}
                <Row
                  label="Expected close (manager-revealed)"
                  value={session.expected_close_minor == null ? "—" : formatCents(session.expected_close_minor)}
                  strong
                />
                <Row
                  label="Over/short"
                  value={session.over_short_minor == null ? "—" : overShortLabel(session.over_short_minor)}
                  strong
                />
                {/* Fix Phase 2.3 (G-03, owner D7 / D21): the reason written at
                    reconcile (required when more than $5.00). */}
                {session.over_short_reason ? (
                  <Row label="Over/short reason" value={session.over_short_reason} />
                ) : null}
              </>
            ) : null}
            {session.tips_minor != null ? (
              <Row label="Tips at close: this cashier's own share (employee money — not drawer cash; crew pool split evenly, D89)" value={formatCents(session.tips_minor)} />
            ) : null}
          </tbody>
        </table>
        {canCorrect && loud.length > 0 ? (
          <div className="mt-2 rounded border-2 border-red-700 bg-red-50 px-3 py-2 text-xs text-red-900" data-testid="history-second-count-flags">
            <p className="font-black uppercase tracking-[0.1em]">Second count warning (D180)</p>
            <ul className="mt-1 list-disc pl-4">
              {loud.map((f) => (
                <li key={f}>{flagSentence(f, flagSeconds)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {session.second_count_minor != null ? (
          <p className="mt-1 text-[0.65rem] text-black/50">
            {secondCountSentence(compareCounts(session.closing_count_minor, session.second_count_minor))}
          </p>
        ) : null}
        {secondTable ? (
          <div className="mt-3" data-testid="history-second-count-table">
            <p className="text-[0.7rem] font-semibold">
              Second count table{secondCountedByName ? ` (${secondCountedByName})` : ""}, read only
            </p>
            <table className="mt-1 w-full text-[0.7rem]">
              <thead>
                <tr className="text-left text-black/60">
                  <th className="py-0.5">Bill / coin</th>
                  <th className="py-0.5 text-right">Quantity</th>
                  <th className="py-0.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {secondTable.rows.map((r) => (
                  <tr key={r.key} className={r.qty > 0 ? "border-t border-black/10" : "border-t border-black/10 text-black/40"}>
                    <td className="py-0.5">{r.label}</td>
                    <td className="py-0.5 text-right tabular-nums">{r.qty}</td>
                    <td className="py-0.5 text-right tabular-nums">{formatCents(r.subtotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/30 font-semibold">
                  <td className="py-0.5" colSpan={2}>Second count total</td>
                  <td className="py-0.5 text-right tabular-nums">{formatCents(secondTable.totalMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
        {!revealed ? (
          <p className="mt-1 text-[0.65rem] text-black/50">
            Expected close and over/short print only after a manager reconciles this session — the blind count stays
            blind until then.
          </p>
        ) : null}
        {session.reconciled_at ? (
          <p className="mt-1 text-[0.65rem] text-black/50">Reconciled {fmtTime(session.reconciled_at)}.</p>
        ) : null}
        {session.notes ? <p className="mt-2 whitespace-pre-line text-sm">Notes: {session.notes}</p> : null}

        {/* Drops detail */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Safe drops
        </h2>
        {drops.length === 0 ? (
          <p className="mt-2 text-sm text-black/60">No drops this session.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-black/30 text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/60">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Window</th>
                <th className="py-1 pr-2">By</th>
                <th className="py-1 pr-2">Witness</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((d) => (
                <tr key={d.id} className="border-b border-black/10">
                  <td className="py-1 pr-2 whitespace-nowrap">{fmtTime(d.dropped_at)}</td>
                  <td className="py-1 pr-2 capitalize">{d.drop_window}</td>
                  <td className="py-1 pr-2">{d.droppedByName ?? "—"}</td>
                  <td className="py-1 pr-2">{d.witnessedByName ?? "—"}</td>
                  <td className="py-1 text-right font-bold tabular-nums">{formatCents(d.amount_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Change swaps (0135) */}
        {swaps.length > 0 ? (
          <>
            <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
              Change swaps with the safe (value-neutral)
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-black/30 text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/60">
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1 pr-2">By</th>
                  <th className="py-1 pr-2">Approved by</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {swaps.map((s) => (
                  <tr key={s.id} className="border-b border-black/10">
                    <td className="py-1 pr-2 whitespace-nowrap">{fmtTime(s.occurred_at)}</td>
                    <td className="py-1 pr-2">{s.performedByName ?? "—"}</td>
                    <td className="py-1 pr-2">{s.approvedByName ?? "—"}</td>
                    <td className="py-1 text-right font-bold tabular-nums">{formatCents(s.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[0.65rem] text-black/50">
              Swaps trade big bills for equal change — they never move the drawer total.
            </p>
          </>
        ) : null}

        {/* Sign-off */}
        <div className="mt-8 grid grid-cols-2 gap-8 border-t-2 border-black pt-4">
          <div>
            <div className="h-10 border-b border-black/60" />
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">Manager (signature)</p>
          </div>
          <div>
            <div className="h-10 border-b border-black/60" />
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">Date / time</p>
          </div>
        </div>
        <p className="mt-3 text-center text-[0.6rem] uppercase tracking-[0.15em] text-black/40">
          Greenway Marijuana · WA license 413541 · file with the day&apos;s physical records
        </p>
      </div>

      {/* Owner D127: correct a reconciled drawer (owner / admin). Not printed. */}
      {canCorrect && session.status === "reconciled" && reconciledOn != null && session.expected_close_minor != null ? (
        <details className="mx-auto mt-4 max-w-2xl rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm print:hidden">
          <summary className="cursor-pointer font-semibold text-[var(--admin-text)]">Correct this drawer&apos;s count (owner / admin)</summary>
          <form action={correctReconciledDrawerAction} className="mt-3 space-y-2 text-xs text-[var(--admin-text)]">
            <input type="hidden" name="session_id" value={session.id} />
            <p className="text-[var(--admin-text-muted)]">
              Reconciled on {formatCents(reconciledOn)} against an expected {formatCents(session.expected_close_minor)} (
              {overShortLabel(session.over_short_minor ?? 0)}). Choose the right count. Over / short is worked out again against the same
              expected figure. The old figures stay in the notes and the audit log. This does not change the books; a drawer that already
              has a ledger entry, or whose cash is in a sealed deposit bag, cannot be corrected here.
            </p>
            {session.second_count_minor != null ? (
              <label className="flex items-center gap-2">
                <input type="radio" name="basis" value="second" required />
                Use the second count ({formatCents(session.second_count_minor)}
                {secondCountedByName ? `, ${secondCountedByName}` : ""}) → {overShortLabel(session.second_count_minor - session.expected_close_minor)}
              </label>
            ) : null}
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="basis" value="typed" required={session.second_count_minor == null} />
              Type the correct count: $
              <input
                name="typed_count"
                inputMode="decimal"
                placeholder="0.00"
                className="w-28 rounded border border-[var(--admin-border)] bg-transparent px-2 py-0.5"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">Reason (required)</span>
              <textarea
                name="reason"
                required
                maxLength={OVER_SHORT_REASON_MAX_LEN}
                rows={2}
                placeholder="For example: the closer entered $0 by mistake; the second count is right."
                className="w-full rounded border border-[var(--admin-border)] bg-transparent px-2 py-1"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Save correction
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
