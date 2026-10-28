import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Input, Button, Field, Select, Badge } from "@/components/admin/ui";
import {
  RECALL_EVENT_TYPES,
  RECALL_EVENT_TYPE_LABELS,
  RECALL_NOTICE_SOURCES,
  RECALL_NOTICE_SOURCE_LABELS,
  RECALL_CONTACT_METHODS,
  RECALL_OUTCOME_LABELS,
  recallDeadline,
  isRecallEventType,
  isRecallOutcome,
} from "@/lib/inventory/recall-event-core";
import { listRecallEvents, getRecallPlan } from "@/lib/inventory/recall-event-store";
import { formatPacificDateTime } from "@/lib/inventory/lot-lifecycle-core";
import { pacificToday } from "@/lib/reports/timezone";
import { createRecallEventAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Inventory → Recalls (Fix Phase 1.6c · G-25; F-05a-15). The app's copy of
 * form 8.5: one event per recall or market withdrawal, with the 48-hour
 * countdown on withdrawals and the "LCB not yet notified" warning on recalls.
 */
export default async function RecallsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("inventory.manage");
  const [{ rows, pending, error }, plan, sp] = await Promise.all([listRecallEvents(), getRecallPlan(), searchParams]);
  const now = new Date().toISOString();
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status !== "open");

  return (
    <div>
      <AdminPageHeader
        title="Recalls"
        subtitle="Recall and market-withdrawal log (WAC 314-55-225). Coordinator: the admin (D37)."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Recalls" }]} />}
        help={
          <HelpPanel
            id="recalls"
            title="How a recall works here"
            steps={[
              "Open an event the hour the notice arrives. Unsure if it is a recall or a withdrawal? Treat it as a Recall.",
              "Add every affected lot. Each one is set Recalled: the register, the website and online ordering stop selling it at once.",
              "Pull the units to a sealed bin and count them (SOP-05a §4.10 step 4).",
              "The coordinator tells the LCB officer: immediately for a recall, within 48 hours for a market withdrawal, and records it on the event.",
              "Add a weekly row while the event is open, and close it when the lots are released or have gone back to the vendor.",
            ]}
          >
            <p>Recalled product is never destroyed by us; it goes back to the vendor with reason Recall (D65, SOP-15 §4.21).</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</div>
        ) : null}
        {pending ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            The recall log needs migration 0311_recall_events.sql. Apply it in the Supabase SQL editor (after 0310), then reload. Until then use form 8.5 on paper. The website and online-order recall filter already work.
          </div>
        ) : error ? (
          <div className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">Could not read the recall log: {error}</div>
        ) : null}
        {!plan || !plan.approvedOn ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            The written recall plan is not complete. <Link className="underline" href="/admin/settings/recall-plan">Open the recall plan</Link>.
          </div>
        ) : (
          <p className="text-sm text-[var(--admin-text-muted)]">
            Coordinator: <strong>{plan.coordinatorName}</strong>
            {plan.coordinatorPhone ? ` · ${plan.coordinatorPhone}` : ""} · LCB officer: <strong>{plan.officerName}</strong>
            {plan.officerPhone ? ` · ${plan.officerPhone}` : ""}
            {plan.officerEmail ? ` · ${plan.officerEmail}` : ""} · <Link className="underline" href="/admin/settings/recall-plan">Recall plan</Link>
          </p>
        )}

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-base font-semibold">Open events ({open.length})</h2>
          {open.length === 0 ? (
            <EmptyState title="No open recall events" description="Open one below the hour a recall or withdrawal notice arrives." />
          ) : (
            <ul className="divide-y divide-[var(--admin-border)]">
              {open.map((e) => {
                const d = recallDeadline({ type: e.type, receivedAtIso: e.received_at, lcbNotifiedAtIso: e.lcb_notified_at }, now);
                const tone = d.kind === "notified" ? "green" : d.kind === "withdrawal_due" ? "gold" : "danger";
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Link className="font-semibold underline" href={`/admin/inventory/recalls/${e.id}`}>
                      #{e.event_number} · {e.product}
                    </Link>
                    <Badge tone={e.type === "recall" ? "danger" : "orange"}>{isRecallEventType(e.type) ? RECALL_EVENT_TYPE_LABELS[e.type] : e.type}</Badge>
                    <Badge tone={tone}>{d.label}</Badge>
                    <span className="text-xs text-[var(--admin-text-muted)]">Notice {formatPacificDateTime(e.received_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-base font-semibold">Open a recall event (form 8.5 §1)</h2>
          <form action={createRecallEventAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" help="Unsure? Recall.">
              <Select name="type" required defaultValue="recall">
                {RECALL_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RECALL_EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product(s), as the notice names them">
              <Input name="product" required />
            </Field>
            <Field label="Vendor">
              <Input name="vendor_name" />
            </Field>
            <Field label="Lot / batch numbers as given">
              <Input name="lot_numbers_given" />
            </Field>
            <Field label="Reason given">
              <Input name="reason" required />
            </Field>
            <Field label="Recall reference #">
              <Input name="recall_reference" />
            </Field>
            <Field label="Notice from">
              <Select name="notice_source" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {RECALL_NOTICE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {RECALL_NOTICE_SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How it arrived">
              <Select name="notice_method" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {RECALL_CONTACT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Received on (store date)">
              <Input name="received_date" type="date" required defaultValue={pacificToday()} />
            </Field>
            <Field label="Received at (store time, 24-hour)">
              <Input name="received_time" type="time" required />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Open the recall event</Button>
            </div>
          </form>
        </section>

        {closed.length > 0 ? (
          <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-3 text-base font-semibold">Closed events ({closed.length})</h2>
            <ul className="divide-y divide-[var(--admin-border)] text-sm">
              {closed.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-3 py-2">
                  <Link className="underline" href={`/admin/inventory/recalls/${e.id}`}>
                    #{e.event_number} · {e.product}
                  </Link>
                  <span className="text-[var(--admin-text-muted)]">
                    {e.outcome && isRecallOutcome(e.outcome) ? RECALL_OUTCOME_LABELS[e.outcome] : e.outcome} · closed{" "}
                    {e.closed_at ? formatPacificDateTime(e.closed_at) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-xs text-[var(--admin-text-muted)]">
          Print an event from its page (browser print) and file it with form 8.5 in the compliance binder.
        </p>
      </div>
    </div>
  );
}
