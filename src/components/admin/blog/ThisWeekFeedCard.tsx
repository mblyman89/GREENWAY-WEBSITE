/**
 * D237 N-4 (SOP-22 G-114, F-22-11): the "This week at Greenway" card on Blog &
 * Newsletter. Server component; shows the facts the AI is allowed to use.
 */
import Link from "next/link";
import type { ThisWeekFeed, LocalEvent } from "@/lib/cms/this-week-feed-core";
import { Button } from "@/components/admin/ui/Button";
import { Textarea } from "@/components/admin/ui/Field";

export function ThisWeekFeedCard({
  feed,
  partial,
  belowCostChecked,
  localEvents,
  saveEventsAction,
}: {
  feed: ThisWeekFeed;
  partial: boolean;
  belowCostChecked: boolean;
  localEvents: LocalEvent[];
  saveEventsAction: (formData: FormData) => Promise<void>;
}) {
  const muted = "text-xs text-[var(--admin-text-muted)]";
  const head = "text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";
  return (
    <section
      id="this-week"
      data-testid="blog-this-week-feed"
      className="space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--admin-text)]">This week at Greenway</p>
        <p className={muted}>
          {feed.fromDay} to {feed.toDay} (Pacific). Real facts from Vendors, Inventory and Promotions. The AI writer uses
          only these.
        </p>
        {partial ? (
          <p className="mt-1 text-xs text-[var(--admin-gold)]">Some rows could not be read. The list may be short; reload to try again.</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className={head}>New vendors ({feed.newVendors.length})</p>
          {feed.newVendors.length === 0 ? (
            <p className={muted}>None added this week.</p>
          ) : (
            <ul className={`${muted} mt-1 space-y-0.5`}>
              {feed.newVendors.map((v) => (
                <li key={v.id}>
                  <Link href={`/admin/vendors/${v.id}`} className="text-[var(--admin-accent)] hover:underline">{v.name}</Link> · added {v.addedOn}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={head}>Fresh drops ({feed.freshLotCount} lots)</p>
          {feed.freshDrops.length === 0 ? (
            <p className={muted}>No lots received this week.</p>
          ) : (
            <ul className={`${muted} mt-1 space-y-0.5`}>
              {feed.freshDrops.slice(0, 12).map((g) => (
                <li key={g.vendorId ?? "none"}>
                  <span className="text-[var(--admin-text)]">{g.vendorName}</span>: {g.types.map((t) => `${t.type} ×${t.lots}`).join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={head}>Deals running now ({feed.runningNow.length})</p>
          {feed.runningNow.length === 0 ? (
            <p className={muted}>No published deals running.</p>
          ) : (
            <ul className={`${muted} mt-1 space-y-0.5`}>
              {feed.runningNow.slice(0, 12).map((d) => (
                <li key={d.id}>
                  <span className="text-[var(--admin-text)]">{d.title}</span>: {d.offer}, {d.when}
                  {d.markdown ? " · vendor day / clearance" : ""}
                  {d.belowCost > 0 ? <span className="text-[var(--admin-orange)]"> · {d.belowCost} item(s) below cost, left out of AI posts</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={head}>Coming up, next 14 days ({feed.comingUp.length})</p>
          {feed.comingUp.length === 0 ? (
            <p className={muted}>No dated deals start in the next 14 days.</p>
          ) : (
            <ul className={`${muted} mt-1 space-y-0.5`}>
              {feed.comingUp.map((d) => (
                <li key={d.id}>
                  <span className="text-[var(--admin-text)]">{d.title}</span>: {d.offer}, {d.when}
                  {d.markdown ? " · vendor day / clearance" : ""}
                  {d.belowCost > 0 ? <span className="text-[var(--admin-orange)]"> · {d.belowCost} item(s) below cost</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="md:col-span-2">
          <p className={head}>Dates ahead, next 30 days</p>
          {feed.calendar.length === 0 ? (
            <p className={muted}>Nothing on the calendar.</p>
          ) : (
            <p className={`${muted} mt-1`}>
              {feed.calendar.map((c) => `${c.date} ${c.name}${c.kind === "local" ? " (local)" : ""}`).join(" · ")}
            </p>
          )}
          {!belowCostChecked ? (
            <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">The below-cost check runs when the AI writes a post.</p>
          ) : null}
        </div>
      </div>

      <details className="border-t border-[var(--admin-border)] pt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--admin-accent)]">Local events ({localEvents.length})</summary>
        <form action={saveEventsAction} className="mt-2 space-y-2">
          <p className={muted}>
            One per line: <code>YYYY-MM-DD Name</code> for one day, or <code>MM-DD Name</code> for every year. Example:
            <code> 12-05 Port Orchard tree lighting</code>.
          </p>
          <Textarea
            name="events"
            rows={4}
            defaultValue={localEvents.map((e) => `${e.date} ${e.name}`).join("\n")}
          />
          <Button type="submit" variant="neutral" size="sm">Save local events</Button>
        </form>
      </details>
    </section>
  );
}
