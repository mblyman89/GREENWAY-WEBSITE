import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Input, Textarea, Button, Field, Select, Badge } from "@/components/admin/ui";
import {
  RECALL_EVENT_TYPE_LABELS,
  RECALL_NOTICE_SOURCE_LABELS,
  RECALL_CONTACT_METHODS,
  RECALL_OUTCOMES,
  RECALL_OUTCOME_LABELS,
  recallDeadline,
  isRecallEventType,
  isRecallOutcome,
  type RecallNoticeSource,
} from "@/lib/inventory/recall-event-core";
import { getRecallEvent, getRecallPlan, searchLotsForRecall } from "@/lib/inventory/recall-event-store";
import { formatPacificDateTime } from "@/lib/inventory/lot-lifecycle-core";
import { pacificToday } from "@/lib/reports/timezone";
import {
  addLotToRecallEventAction,
  recordLcbNotificationAction,
  addRecallWeeklyRowAction,
  closeRecallEventAction,
} from "../actions";

export const dynamic = "force-dynamic";

const SAVED: Record<string, string> = {
  created: "Recall event opened. Now add every affected lot.",
  lot: "Lot added and set Recalled. The register, the website and online ordering no longer sell it.",
  lcb: "LCB notification recorded.",
  weekly: "Weekly row added.",
  closed: "Recall event closed.",
};

/** One recall event (form 8.5), Fix Phase 1.6c (G-25). */
export default async function RecallEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; q?: string }>;
}) {
  const session = await requirePermission("inventory.manage");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [detail, plan] = await Promise.all([getRecallEvent(id), getRecallPlan()]);
  if (!detail) notFound();
  const { event: e, lots, weekly } = detail;
  const q = (sp.q ?? "").trim();
  const found = q ? await searchLotsForRecall(q) : [];
  const onEvent = new Set(lots.map((l) => l.lot_id));
  const isOpen = e.status === "open";
  const coordinator = can(session.profile.role, "inventory.recall.release");
  const d = recallDeadline({ type: e.type, receivedAtIso: e.received_at, lcbNotifiedAtIso: e.lcb_notified_at }, new Date().toISOString());
  const addLot = addLotToRecallEventAction.bind(null, e.id);
  const recordLcb = recordLcbNotificationAction.bind(null, e.id);
  const addWeekly = addRecallWeeklyRowAction.bind(null, e.id);
  const close = closeRecallEventAction.bind(null, e.id);
  const card = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";

  return (
    <div>
      <AdminPageHeader
        title={`Recall event #${e.event_number ?? ""}`}
        subtitle={`${isRecallEventType(e.type) ? RECALL_EVENT_TYPE_LABELS[e.type] : e.type} · ${e.product}`}
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Recalls", href: "/admin/inventory/recalls" }, { label: `#${e.event_number ?? ""}` }]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.saved && SAVED[sp.saved] ? (
          <div className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{SAVED[sp.saved]}</div>
        ) : null}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</div>
        ) : null}

        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={isOpen ? "orange" : "neutral"}>{isOpen ? "Open" : "Closed"}</Badge>
            <Badge tone={d.kind === "notified" ? "green" : d.kind === "withdrawal_due" ? "gold" : "danger"}>{d.label}</Badge>
          </div>
          <h2 className="mb-2 text-base font-semibold">1. Notice</h2>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>Received: {formatPacificDateTime(e.received_at)}</div>
            <div>
              From: {RECALL_NOTICE_SOURCE_LABELS[e.notice_source as RecallNoticeSource] ?? e.notice_source} · by {e.notice_method}
            </div>
            <div>Product(s): {e.product}</div>
            <div>Vendor: {e.vendor_name || "—"}</div>
            <div>Lot / batch #s as given: {e.lot_numbers_given || "—"}</div>
            <div>Recall ref #: {e.recall_reference || "—"}</div>
            <div className="sm:col-span-2">Reason: {e.reason}</div>
          </dl>
        </section>

        <section className={card}>
          <h2 className="mb-2 text-base font-semibold">2. Affected lots ({lots.length})</h2>
          {lots.length ? (
            <table className="mb-4 w-full text-sm">
              <thead className="text-left text-[var(--admin-text-muted)]">
                <tr>
                  <th className="py-1">Lot</th>
                  <th>Status now</th>
                  <th>On hand when added</th>
                  <th>On hand now</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--admin-border)]">
                    <td className="py-1">
                      <Link className="underline" href={`/admin/inventory/${l.lot_id}`}>
                        {l.lot?.product_name ?? l.lot_id}
                        {l.lot?.lot_code ? ` · ${l.lot.lot_code}` : ""}
                      </Link>
                    </td>
                    <td>{l.lot?.status ?? "?"}</td>
                    <td>{l.on_hand_at_add ?? "—"}</td>
                    <td>{l.lot?.on_hand_qty ?? "—"}</td>
                    <td>{formatPacificDateTime(l.added_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mb-4 text-sm text-[var(--admin-text-muted)]">No lots yet. Search below and add every affected lot.</p>
          )}
          {isOpen ? (
            <>
              <form method="get" className="mb-3 flex gap-2">
                <Input name="q" defaultValue={q} placeholder="Product, lot code or POS key" />
                <Button type="submit" variant="neutral">
                  Find lots
                </Button>
              </form>
              {q && found.length === 0 ? <p className="text-sm text-[var(--admin-text-muted)]">No lots match &quot;{q}&quot;.</p> : null}
              {found.length ? (
                <ul className="divide-y divide-[var(--admin-border)] text-sm">
                  {found.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        {l.product_name ?? l.id}
                        {l.lot_code ? ` · ${l.lot_code}` : ""} · {l.status} · on hand {l.on_hand_qty ?? 0}
                      </span>
                      {onEvent.has(l.id) ? (
                        <Badge tone="neutral">On this event</Badge>
                      ) : (
                        <form action={addLot}>
                          <input type="hidden" name="lot_id" value={l.id} />
                          <Button type="submit" size="sm">
                            Add and set Recalled
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
                Adding a lot sets it Recalled with the event as the reason and reference (Status history on the lot page). Then pull the units to a sealed bin and count them.
              </p>
            </>
          ) : null}
        </section>

        <section id="lcb" className={card}>
          <h2 className="mb-2 text-base font-semibold">4. LCB notification</h2>
          <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
            Recall: immediately. Market withdrawal: within 48 hours (WAC 314-55-225(3)(b)(i)(A); (2)(b)).
            {plan?.officerName ? ` Officer on the plan: ${plan.officerName}${plan.officerPhone ? `, ${plan.officerPhone}` : ""}.` : ""}
          </p>
          {e.lcb_notified_at ? (
            <p className="text-sm">
              Told <strong>{e.lcb_officer}</strong> on {formatPacificDateTime(e.lcb_notified_at)} by {e.lcb_method}
              {e.lcb_notes ? ` · ${e.lcb_notes}` : ""}
            </p>
          ) : isOpen && coordinator ? (
            <form action={recordLcb} className="grid gap-3 sm:grid-cols-2">
              <Field label="Officer told">
                <Input name="lcb_officer" required defaultValue={plan?.officerName ?? ""} />
              </Field>
              <Field label="Method">
                <Select name="lcb_method" required defaultValue="phone">
                  {RECALL_CONTACT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date (store)">
                <Input name="lcb_date" type="date" required defaultValue={pacificToday()} />
              </Field>
              <Field label="Time (store, 24-hour)">
                <Input name="lcb_time" type="time" required />
              </Field>
              <Field label="Reference / notes" className="sm:col-span-2">
                <Input name="lcb_notes" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit">Record the LCB notification</Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-[var(--admin-text-muted)]">
              Not recorded yet. The recall coordinator (the admin, D37) or the owner records it. If the admin cannot be reached within 1 hour of a recall, the manager calls the owner.
            </p>
          )}
        </section>

        <section id="weekly" className={card}>
          <h2 className="mb-2 text-base font-semibold">5. Weekly tracking (WAC 314-55-225(3)(f))</h2>
          {weekly.length ? (
            <table className="mb-4 w-full text-sm">
              <thead className="text-left text-[var(--admin-text-muted)]">
                <tr>
                  <th className="py-1">Week of</th>
                  <th>Held</th>
                  <th>Returned by customers</th>
                  <th>Returned to vendor</th>
                  <th>Destroyed</th>
                  <th>Sold before hold</th>
                  <th>Reported to LCB</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => (
                  <tr key={w.id} className="border-t border-[var(--admin-border)]">
                    <td className="py-1">{w.week_of}</td>
                    <td>{w.held}</td>
                    <td>{w.returned_by_customers}</td>
                    <td>{w.returned_to_vendor}</td>
                    <td>{w.destroyed}</td>
                    <td>{w.sold_before_hold}</td>
                    <td>{w.reported_to_lcb_on ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mb-3 text-sm text-[var(--admin-text-muted)]">No weekly rows yet.</p>
          )}
          {isOpen ? (
            <form action={addWeekly} className="grid gap-3 sm:grid-cols-4">
              <Field label="Week of">
                <Input name="week_of" type="date" required defaultValue={pacificToday()} />
              </Field>
              <Field label="Held">
                <Input name="held" type="number" min={0} step="any" defaultValue="0" />
              </Field>
              <Field label="Returned by customers">
                <Input name="returned_by_customers" type="number" min={0} step="any" defaultValue="0" />
              </Field>
              <Field label="Returned to vendor">
                <Input name="returned_to_vendor" type="number" min={0} step="any" defaultValue="0" />
              </Field>
              <Field label="Destroyed (SOP-15)">
                <Input name="destroyed" type="number" min={0} step="any" defaultValue="0" />
              </Field>
              <Field label="Sold before the hold">
                <Input name="sold_before_hold" type="number" min={0} step="any" defaultValue="0" />
              </Field>
              <Field label="Reported to LCB on">
                <Input name="reported_to_lcb_on" type="date" />
              </Field>
              <Field label="Notes">
                <Input name="notes" />
              </Field>
              <div className="sm:col-span-4">
                <Button type="submit" variant="neutral">
                  Add weekly row
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        <section className={card}>
          <h2 className="mb-2 text-base font-semibold">6. Close</h2>
          {!isOpen ? (
            <p className="text-sm">
              {e.outcome && isRecallOutcome(e.outcome) ? RECALL_OUTCOME_LABELS[e.outcome] : e.outcome}
              {e.clearance_reference ? ` · clearance ${e.clearance_reference}` : ""} · closed {e.closed_at ? formatPacificDateTime(e.closed_at) : ""}
              {e.plan_departures ? ` · departures from the plan: ${e.plan_departures}` : ""}
            </p>
          ) : coordinator ? (
            <form action={close} className="grid gap-3 sm:grid-cols-2">
              <Field label="Outcome">
                <Select name="outcome" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {RECALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {RECALL_OUTCOME_LABELS[o]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Written clearance reference" help="Required for Released">
                <Input name="clearance_reference" />
              </Field>
              <Field label="Departures from the recall plan agreed with the LCB" className="sm:col-span-2">
                <Textarea name="plan_departures" rows={2} />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" variant="neutral">
                  Close the event
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-[var(--admin-text-muted)]">The recall coordinator (the admin) or the owner closes the event.</p>
          )}
        </section>
      </div>
    </div>
  );
}
