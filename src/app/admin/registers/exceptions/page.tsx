/**
 * /admin/registers/exceptions — POS exception queue manager (Slice B12).
 *
 * Every register event the sync ingest could NOT process safely lands here
 * with a staff-actionable reason (nothing is ever silently dropped — the
 * B4 ledger discipline). A manager reads the reason, inspects the full
 * payload, fixes the underlying problem (intake the card, apply the
 * migration, correct the price…), and resolves with a written note. The
 * row stays forever: reason + payload + who resolved it + the note.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { classifyExceptionReason } from "@/lib/pos/exception-retry-core";
import { PendingSubmit } from "@/components/admin/compliance/PendingSubmit";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { backHref } from "@/lib/admin/back-link-core";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  listPosExceptions,
  listResolvedPosExceptions,
  type PosExceptionRow,
} from "@/lib/pos/sync-store";
import { listRegisters } from "@/lib/registers/store";
import { listEmployees } from "@/lib/staffing/store";
import { pacificParts } from "@/lib/reports/timezone";
import { STRANDED_UUID_REASON } from "@/lib/pos/cart-adjust-core";
import { recordStrandedCartAdjustmentsAction, resolvePosExceptionAction, retryPosExceptionAction } from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers/exceptions";

function pacificStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = pacificParts(d);
  const mm = String(p.minute).padStart(2, "0");
  const ampm = p.hour >= 12 ? "PM" : "AM";
  let h = p.hour % 12;
  if (h === 0) h = 12;
  return `${p.month}/${p.day}/${p.year} ${h}:${mm} ${ampm} PT`;
}

function eventBadge(eventType: string) {
  const tone =
    eventType === "sale" ? "gold" : eventType === "medical_card_capture" ? "green" : "neutral";
  return <Badge tone={tone as "gold" | "green" | "neutral"}>{eventType.replace(/_/g, " ")}</Badge>;
}

export default async function PosExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resolved?: string; replayed?: string; rung?: string; back?: string }>;
}) {
  const session = await requirePermission("staffing.manage");
  const isOwner = can(session.profile.role, "registers.warnings");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Register exceptions" subtitle="Events the sync could not process." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the service role key to review register exceptions."
        />
      </div>
    );
  }

  const [open, resolved, registers, employees] = await Promise.all([
    listPosExceptions(200),
    listResolvedPosExceptions(25),
    listRegisters({ includeInactive: true }),
    listEmployees({ includeInactive: true }),
  ]);
  // D178 — a sale that was marked reviewed but never made it into the books
  // (no order) is still money that changed hands: it is offered again here.
  const reviewedNotRung = resolved.filter((r) => r.event_type === "sale" && !r.order_id);
  const stranded = open.filter(
    (r) => r.event_type === "cart_adjustment" && (r.exception_reason ?? "").trim() === STRANDED_UUID_REASON,
  ).length;
  const registerName = new Map(registers.map((r) => [r.id, r.name]));
  const employeeName = new Map(employees.map((e) => [e.id, e.full_name]));

  const who = (row: PosExceptionRow) =>
    `${registerName.get(row.register_id) ?? row.register_id.slice(0, 8)} · ${
      employeeName.get(row.employee_id) ?? row.employee_id.slice(0, 8)
    }`;

  return (
    <div>
      <AdminPageHeader
        title="Register exceptions"
        subtitle="Register events the sync could not process — nothing is ever silently dropped."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Register Activity", href: "/admin/registers" }, { label: "Exceptions" }]}
          />
        }
        action={
          <Button href={backHref("/admin/registers", sp.back)} variant="neutral" size="sm">
            Back to Register Activity
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-exceptions"
          title="How the exception queue works"
          steps={[
            "Every reason is staff-actionable: it tells you exactly what to fix (intake a card, apply a migration, correct a price).",
            "Open the payload to see exactly what the register sent — lines, totals, tender, card facts.",
            "If product left the shop and money changed hands, the sale must be recorded. System faults are retried automatically every few minutes; you can also press Retry this sale.",
            "Record as rung (owner only) accepts the receipt as the truth when a discount setting changed after the register applied it. The law (hours, recall, expired edibles, limits) is never forced.",
            "Mark reviewed only for events that are NOT a sale that happened (for example a test, or a sale you re-rang). Marking reviewed does not record the sale.",
            "Resolved rows keep the reason, payload, resolver, and note forever — that is your paper trail.",
          ]}
        />

        {sp.error ? (
          <Card>
            <p className="text-sm text-red-300">{sp.error}</p>
          </Card>
        ) : null}
        {sp.resolved ? (
          <Card>
            <p className="text-sm text-emerald-300">Exception resolved and recorded.</p>
          </Card>
        ) : null}

        {sp.rung ? (
          <Card>
            <p className="text-sm font-semibold text-emerald-300" role="status">
              {sp.rung === "as_rung"
                ? "Done. The sale is recorded as rung: it is in sales, taxes, inventory, the drawer and CCRS, dated when it happened."
                : "Done. The sale went through and is recorded, dated when it happened."}
            </p>
          </Card>
        ) : null}

        {sp.replayed ? (
          <Card>
            <p className="text-sm text-emerald-300">
              Recorded {sp.replayed} cart adjustment{sp.replayed === "1" ? "" : "s"} in the tracker and resolved them.
            </p>
          </Card>
        ) : null}

        {stranded > 0 ? (
          <Card>
            <h2 className="text-base font-semibold text-white">
              {stranded} cart adjustment{stranded === 1 ? "" : "s"} waiting to be recorded
            </h2>
            <p className="mt-2 text-sm text-[var(--admin-text-dim)]">
              These say <span className="font-mono">variantId must be a UUID</span>. That was a bug in the
              minus / remove tracker, now fixed: the register sends the item&apos;s menu id, which is not a
              UUID. No sale, payment, inventory or CCRS record was affected, and nothing needs to be re-rung.
              Press the button to put them in Reports &rarr; Register Adjustments (who, when, which item) and
              resolve them with a note. Safe to press twice.
            </p>
            <form action={recordStrandedCartAdjustmentsAction} className="mt-3">
              <PendingSubmit
                busy="Recording…"
                className="rounded-lg bg-[var(--admin-gold,#c9a227)] px-3 py-2 text-sm font-semibold text-black"
              >
                Record {stranded} cart adjustment{stranded === 1 ? "" : "s"} and resolve
              </PendingSubmit>
            </form>
          </Card>
        ) : null}

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Open exceptions</h2>
            <Badge tone={open.length > 0 ? "danger" : "green"}>{open.length} open</Badge>
          </div>

          {open.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-dim)]">
              Nothing needs attention — every synced register event processed cleanly.
            </p>
          ) : (
            <ul className="space-y-4">
              {open.map((row) => (
                <li
                  key={row.id}
                  className="rounded-[var(--admin-radius-lg)] border border-red-500/25 bg-red-950/10 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {eventBadge(row.event_type)}
                    <span className="text-xs text-[var(--admin-text-dim)]">
                      {pacificStamp(row.occurred_at)} · {who(row)}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--admin-text-dim)]">
                      {row.client_uuid}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-red-200">{row.exception_reason ?? "No reason recorded."}</p>
                  <RetryControls row={row} isOwner={isOwner} />

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-dim)]">
                      Inspect payload
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {JSON.stringify(row.payload ?? {}, null, 2)}
                    </pre>
                  </details>

                  <form action={resolvePosExceptionAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="exception_id" value={row.id} />
                    <label className="min-w-64 flex-1">
                      <span className="mb-1 block text-xs font-semibold text-[var(--admin-text-dim)]">
                        Resolution note (what you did, at least 5 characters)
                      </span>
                      <input
                        name="note"
                        required
                        minLength={5}
                        placeholder="e.g. Intook UPID WA-1234 in Medical, customer re-rang at Register 1"
                        className="w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <PendingSubmit
                      busy="Saving…"
                      className="rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm font-semibold text-white"
                    >
                      Mark reviewed
                    </PendingSubmit>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {reviewedNotRung.length > 0 ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Reviewed but never recorded</h2>
              <Badge tone="danger">{reviewedNotRung.length} not in the books</Badge>
            </div>
            <p className="mb-3 text-sm text-[var(--admin-text-dim)]">
              These sales were marked reviewed, but no sale was ever recorded for them, so they are missing from
              sales, taxes, inventory, the drawer and CCRS. If the customer paid and left with the product, record it.
            </p>
            <ul className="space-y-3">
              {reviewedNotRung.map((row) => (
                <li key={row.id} className="rounded-[var(--admin-radius-lg)] border border-amber-500/30 bg-amber-950/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {eventBadge(row.event_type)}
                    <span className="text-xs text-[var(--admin-text-dim)]">
                      {pacificStamp(row.occurred_at)} · {who(row)} · {money(row.payload)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--admin-text-dim)]">{row.exception_reason ?? "No reason recorded."}</p>
                  {row.resolution_note ? <p className="mt-1 text-sm text-neutral-200">“{row.resolution_note}”</p> : null}
                  <RetryControls row={row} isOwner={isOwner} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-4 text-base font-semibold text-white">Recently resolved</h2>
          {resolved.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-dim)]">No resolutions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {resolved.map((row) => (
                <li
                  key={row.id}
                  className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {eventBadge(row.event_type)}
                    <span className="text-xs text-[var(--admin-text-dim)]">
                      {pacificStamp(row.occurred_at)} · {who(row)}
                    </span>
                    {row.resolved_at ? (
                      <span className="text-xs text-emerald-300">
                        resolved {pacificStamp(row.resolved_at)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--admin-text-dim)]">
                    {row.exception_reason ?? "No reason recorded."}
                  </p>
                  {row.resolution_note ? (
                    <p className="mt-1 text-sm text-neutral-200">“{row.resolution_note}”</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-dim)]">
                      Inspect payload
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {JSON.stringify(row.payload ?? {}, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-[var(--admin-text-dim)]">
          Queue trims to the oldest 200 open rows. Base path: <span className="font-mono">{BASE}</span>
        </p>
      </div>
    </div>
  );
}

function money(payload: Record<string, unknown> | null): string {
  const t = payload && typeof payload.totalMinor === "number" ? payload.totalMinor : null;
  return t === null ? "" : `$${(t / 100).toFixed(2)}`;
}

/** D178 — the plain-English verdict plus the buttons this person may press. */
function RetryControls({ row, isOwner }: { row: PosExceptionRow; isOwner: boolean }) {
  const cls = classifyExceptionReason(row.exception_reason, { eventType: row.event_type, orderId: row.order_id });
  // A higher-than-allowed discount only clears with "Record as rung", so a
  // plain Retry is not offered for it (it would refuse again).
  const canRetry =
    !row.order_id &&
    cls.kind !== "legal_block" &&
    (cls.kind !== "receipt_drift" || cls.managerRetry) &&
    (isOwner || cls.managerRetry);
  const canRung = !row.order_id && isOwner && row.event_type === "sale" && cls.kind !== "legal_block";
  const tone =
    cls.kind === "legal_block" ? "text-red-300" : cls.kind === "system_fault" ? "text-sky-300" : "text-amber-200";
  return (
    <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-black/20 p-3">
      <p className={`text-sm ${tone}`}>
        <span className="font-semibold">What this means: </span>
        {cls.plain}
      </p>
      {canRetry || canRung ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {canRetry ? (
            <form action={retryPosExceptionAction}>
              <input type="hidden" name="exception_id" value={row.id} />
              <input type="hidden" name="mode" value="retry" />
              <PendingSubmit
                busy="Retrying…"
                className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Retry this sale
              </PendingSubmit>
            </form>
          ) : null}
          {canRung ? (
            <form action={retryPosExceptionAction}>
              <input type="hidden" name="exception_id" value={row.id} />
              <input type="hidden" name="mode" value="record_as_rung" />
              <PendingSubmit
                busy="Recording…"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Record as rung (receipt is the truth)
              </PendingSubmit>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
