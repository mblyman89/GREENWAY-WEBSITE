/**
 * D232 M-7 (G-85): the merch alerts inbox. A server component that reads its
 * own rows (0361 merch_alerts), so Orders, the merch order page and Merch
 * Health can each drop it in. Open alerts first, each with Acknowledge;
 * the last few acknowledged ones underneath (who and when).
 */
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { Badge } from "@/components/admin/ui/Badge";
import { SaveButton } from "@/components/admin/orders/SaveButton";
import { listMerchAlerts } from "@/lib/merch/merch-alerts-server";
import { acknowledgeMerchAlertAction } from "@/app/admin/orders/merch-alert-actions";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) : "";

export async function MerchAlertsInbox({ returnTo, orderRef, canAck, hideWhenEmpty = false }: { returnTo: string; orderRef?: string; canAck: boolean; hideWhenEmpty?: boolean }) {
  const { open, recent, error } = await listMerchAlerts({ orderRef });
  if (hideWhenEmpty && !error && open.length === 0) return null;
  return (
    <div id="merch-alerts">
      <Card padding="sm" className="sm:p-5">
        <CardHeader title={`Greenway Merch alerts${open.length ? ` (${open.length} open)` : ""}`} icon="🔔" />
        {error ? <p className="mt-3 text-sm text-[var(--admin-gold)]">{error}</p> : null}
        {!error && open.length === 0 ? <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No open alerts from greenwaymerch.com.</p> : null}
        <ul className="mt-3 space-y-2">
          {open.map((a) => (
            <li key={a.id} className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="gold">Open</Badge>
                <span className="font-semibold">{a.subject}</span>
                {a.repeat_count > 1 ? <span className="text-xs text-[var(--admin-text-faint)]">×{a.repeat_count}</span> : null}
              </div>
              <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
                {when(a.last_seen_at)} PT
                {a.order_ref && !orderRef ? (
                  <>
                    {" · "}
                    <a className="font-bold text-[var(--admin-accent)] underline" href={`/admin/orders/merch/${encodeURIComponent(a.order_ref)}`}>Open {a.order_ref}</a>
                  </>
                ) : null}
              </p>
              {a.lines.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-text-muted)]">
                  {a.lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              ) : null}
              {canAck ? (
                <form action={acknowledgeMerchAlertAction} className="mt-2">
                  <input type="hidden" name="alertId" value={a.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <SaveButton label="Acknowledge" busyLabel="Saving…" variant="neutral" />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {recent.length ? (
          <details className="mt-3 text-xs text-[var(--admin-text-muted)]">
            <summary className="cursor-pointer">Recently acknowledged ({recent.length})</summary>
            <ul className="mt-2 space-y-1">
              {recent.map((a) => (
                <li key={a.id}>{a.subject} · {when(a.acknowledged_at)} PT by {a.acknowledged_by_email || "?"}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">The shop posts every owner alert here and still emails MERCH_ORDER_ALERT_EMAIL. A repeat of the same alert re-opens it. SOP-11 §4.21.</p>
      </Card>
    </div>
  );
}
