import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { Breadcrumbs } from "@/components/admin/ux";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import { tillSummaryData } from "@/lib/registers/eod-store";

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
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  if (!isSupabaseServiceConfigured) notFound();

  const data = await tillSummaryData(id);
  if (!data) notFound();
  const { session, registerName, openedByName, closedByName, drops, swaps } = data;

  const revealed = session.status === "reconciled" || session.status === "verified";
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
              value={session.closing_count_minor == null ? "—" : formatCents(session.closing_count_minor)}
            />
            {revealed ? (
              <>
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
              </>
            ) : null}
            {session.tips_minor != null ? (
              <Row label="Tips at close (employee money — not drawer cash)" value={formatCents(session.tips_minor)} />
            ) : null}
          </tbody>
        </table>
        {!revealed ? (
          <p className="mt-1 text-[0.65rem] text-black/50">
            Expected close and over/short print only after a manager reconciles this session — the blind count stays
            blind until then.
          </p>
        ) : null}
        {session.reconciled_at ? (
          <p className="mt-1 text-[0.65rem] text-black/50">Reconciled {fmtTime(session.reconciled_at)}.</p>
        ) : null}
        {session.notes ? <p className="mt-2 text-sm">Notes: {session.notes}</p> : null}

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
    </div>
  );
}
