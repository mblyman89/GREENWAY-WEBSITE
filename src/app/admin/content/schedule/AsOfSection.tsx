/**
 * D234 C-7 (SOP-11b G-102, G-103): on Schedule & Releases,
 *  - one calendar per banner area (home slides, Shop banner slides, type cards);
 *  - "Preview as of": pick a date and time and see which banners will be
 *    showing then, with every scheduled change and timed release before it
 *    applied. Server component; the form is a plain GET (?asof=).
 */
import { BannerScheduleCalendar } from "@/components/admin/BannerScheduleCalendar";
import { formatRunAt, utcToPacificLocal } from "@/lib/cms/content-schedule-core";
import {
  AS_OF_AREAS,
  asOfHeading,
  calendarEntry,
  previewAsOf,
  type AsOfChange,
  type AsOfItem,
  type AsOfRelease,
} from "@/lib/cms/schedule-everywhere-core";
import { editHrefForItem } from "@/lib/cms/schedule-everywhere-server";
import { SCHEDULE_ROUTE } from "./schedule-ui";

const AREA_NOUN: Record<(typeof AS_OF_AREAS)[number], { noun: string; empty: string }> = {
  "Home carousel": { noun: "slide", empty: "the homepage falls back to the built-in starter slides" },
  "Shop banner": { noun: "slide", empty: "the Shop page falls back to its built-in starter banner" },
  "Type cards": { noun: "card", empty: "the type cards row is empty" },
};

export function AsOfSection({
  items,
  changes,
  releases,
  nowIso,
  asOfMs,
  asOfRaw,
}: {
  items: AsOfItem[];
  changes: AsOfChange[];
  releases: AsOfRelease[];
  nowIso: string;
  asOfMs: number | null;
  asOfRaw: string | undefined;
}) {
  const nowMs = Date.parse(nowIso);
  const result = asOfMs !== null ? previewAsOf(items, changes, releases, nowMs, asOfMs) : null;
  const hrefFor = new Map(items.map((i) => [i.key, editHrefForItem(i)]));
  const inputCls = "rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]";

  return (
    <>
      <section id="preview-as-of" className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <h2 className="mb-1 text-lg font-bold text-[var(--admin-text)]">Preview as of</h2>
        <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
          Pick a date and time (Pacific) to see which banners will be showing then: home slides, Shop banner slides and type
          cards. Every scheduled change and every release with a time before then is counted, in order, and then each
          banner&apos;s own days, hours and fallback.
        </p>
        <form method="get" action={`${SCHEDULE_ROUTE}#preview-as-of`} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Date and time (Pacific)
            <input type="datetime-local" name="asof" required step={300} defaultValue={asOfRaw ?? utcToPacificLocal(nowIso)} className={inputCls} />
          </label>
          <button type="submit" className="admin-focus inline-flex items-center rounded-full bg-[var(--admin-accent)] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-black hover:brightness-110">
            Show
          </button>
        </form>
        {asOfRaw && asOfMs === null ? <p className="mt-2 text-sm text-red-400">That date and time could not be read. Pick one with the box.</p> : null}
        {result ? (
          <div className="mt-4 space-y-4">
            <h3 className="text-base font-semibold text-[var(--admin-text)]">{asOfHeading(asOfMs!)}</h3>
            {asOfMs! < nowMs ? <p className="text-xs text-[var(--admin-gold)]">That time is in the past, so no scheduled change is applied; this shows each banner&apos;s own schedule only.</p> : null}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Changes counted ({result.applied.length})</div>
              {result.applied.length === 0 ? (
                <p className="text-sm text-[var(--admin-text-muted)]">No scheduled change runs before then.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm text-[var(--admin-text)]">
                  {result.applied.map((a) => (
                    <li key={a.id}>
                      {formatRunAt(a.runAt)}: {a.action === "publish" ? "Go live" : "Come down"}, {a.label}
                      {a.release ? <span className="text-[var(--admin-text-muted)]"> (release &ldquo;{a.release}&rdquo;)</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {result.notCounted.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--admin-gold)]">
                  {result.notCounted.map((n, i) => (
                    <li key={i}>
                      Not counted: {n.label}. {n.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {result.areas.map((a) => (
                <div key={a.area} className="rounded-md border border-[var(--admin-border)] p-3">
                  <div className="mb-1 text-sm font-semibold text-[var(--admin-text)]">{a.area}</div>
                  {a.live.length === 0 ? (
                    <p className="text-xs text-[var(--admin-gold)]">⚠️ Nothing of yours is showing; {AREA_NOUN[a.area].empty}.</p>
                  ) : (
                    <ul className="space-y-0.5 text-sm">
                      {a.live.map((e) => (
                        <li key={e.key}>
                          <a href={hrefFor.get(e.key)} className="text-[var(--admin-accent)] underline">
                            ✅ {e.label}
                          </a>
                          {e.why !== "Live" ? <span className="text-xs text-[var(--admin-text-muted)]"> ({e.why})</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {a.hidden.length ? (
                    <details className="mt-2 text-xs text-[var(--admin-text-muted)]">
                      <summary className="cursor-pointer">Not showing ({a.hidden.length})</summary>
                      <ul className="mt-1 space-y-0.5">
                        {a.hidden.map((e) => (
                          <li key={e.key}>
                            {e.label}: {e.why}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Page sections, FAQ questions and page wording are listed under Changes counted; check their drafts in Website Sync.
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-[var(--admin-text)]">Calendars</h2>
        <div className="space-y-3">
          {AS_OF_AREAS.map((area) => {
            const list = items.filter((i) => i.area === area && i.enabled);
            if (list.length === 0) return null;
            return (
              <BannerScheduleCalendar
                key={area}
                title={`${area} calendar`}
                banners={list.map((i) => calendarEntry(i.key, i.label, i.fields))}
                anchorPrefix=""
                nowMs={nowMs}
                noun={AREA_NOUN[area].noun}
                emptyFallback={AREA_NOUN[area].empty}
                hrefFor={(id) => hrefFor.get(id) ?? "#"}
              />
            );
          })}
        </div>
      </section>
    </>
  );
}
