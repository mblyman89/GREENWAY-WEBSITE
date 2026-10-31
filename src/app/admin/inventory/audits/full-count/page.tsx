/**
 * src/app/admin/inventory/audits/full-count/page.tsx   (Fix Phase 4.4d · G-41 · D58)
 *
 * YEAR-END FULL COUNT: plan one, and the list of every full count.
 *
 *   "we do a full inventory audit once per year at the end of the year." (D58)
 *
 * Every active lot, no cap, split into sections one employee counts each
 * (D56). The plan is shown before anything is created; creating makes one
 * draft audit per section, released together from the full count's page.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button } from "@/components/admin/ui";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import {
  DEFAULT_SECTION_LOTS,
  FULL_COUNT_STAGE_LABEL,
  MAX_SECTION_LOTS,
  MIN_SECTION_LOTS,
  checkSectionLots,
  fullCountReminderPreview,
  fullCountYear,
} from "@/lib/inventory/full-count-core";
import { hasFullCountForYear, listFullCounts, previewFullCount } from "@/lib/inventory/full-count-store";
import {
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  checkSessionMinutes,
  formatMinutes,
  lotsForMinutes,
  minutesForLots,
  paceSentence,
} from "@/lib/inventory/count-time-core";
import { getCountPace } from "@/lib/inventory/count-time-store";
import { WhyBlockedPanel } from "../WhyBlockedPanel";
import { createFullCountAction } from "./actions";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-xs leading-relaxed text-[var(--admin-text-muted)]";

export default async function FullCountPage({
  searchParams,
}: {
  searchParams: Promise<{ size?: string; minutes?: string; refusal?: string; notice?: string }>;
}) {
  await requirePermission("inventory.audit");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return <div className={CARD}>Supabase isn&apos;t configured in this environment.</div>;
  }

  const today = pacificToday();
  const year = fullCountYear(today);
  // Fix Phase 4.5c: a section can be sized in MINUTES of counting time
  // (?minutes=), turned into lots at the store's pace; lots stay the unit.
  const pace = await getCountPace();
  const minutesCheck = sp.minutes ? checkSessionMinutes(sp.minutes) : null;
  const sizeCheck = minutesCheck?.ok
    ? checkSectionLots(lotsForMinutes(minutesCheck.value, pace, MIN_SECTION_LOTS, MAX_SECTION_LOTS))
    : checkSectionLots(sp.size ?? DEFAULT_SECTION_LOTS);
  const size = sizeCheck.ok ? sizeCheck.value : DEFAULT_SECTION_LOTS;

  // Fix Phase 4.5d: the December cockpit reminder, checkable in any month.
  // Same function and same year the cockpit uses; a failed read shows nothing.
  const reminderYear = Number(today.slice(0, 4));
  const [list, preview, decemberPlanned] = await Promise.all([
    listFullCounts(),
    previewFullCount(size),
    hasFullCountForYear(reminderYear).catch(() => null),
  ]);
  const reminder =
    decemberPlanned === null
      ? null
      : fullCountReminderPreview({ todayPacific: today, hasCountForDecemberYear: decemberPlanned });
  const counts = list.ok ? list.data : [];
  const thisYear = counts.find((c) => c.year === year && c.rollup.stage !== "cancelled");

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Inventory audits", href: "/admin/inventory/audits" },
          { label: "Year-end full count" },
        ]}
      />
      <AdminPageHeader
        title="Year-end full count"
        subtitle="Every active lot, once a year at the end of the year, split into sections one person counts each. One release, one review, one work paper."
      />

      {sp.refusal ? <WhyBlockedPanel blockers={[sp.refusal]} title="That could not be done" /> : null}
      {!list.ok ? <WhyBlockedPanel blockers={[list.refusal.message]} title="The full counts could not be read" /> : null}

      {/* ── Existing full counts ── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">Full counts</h2>
        {counts.length === 0 ? (
          <p className={`mt-1 ${P}`}>No full count has been planned yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="py-1.5 pr-3">Year-end</th>
                <th className="py-1.5 pr-3">Stage</th>
                <th className="py-1.5 pr-3 text-right">Sections</th>
                <th className="py-1.5 pr-3 text-right">Lots counted</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.id} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-semibold text-white">{c.year}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={c.rollup.stage === "posted" ? "green" : c.rollup.stage === "cancelled" ? "neutral" : "gold"}>
                      {FULL_COUNT_STAGE_LABEL[c.rollup.stage]}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c.rollup.live}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {c.rollup.countedLots} / {c.rollup.plannedLots}
                  </td>
                  <td className="py-2 text-right">
                    <Button href={`/admin/inventory/audits/full-count/${c.id}`} variant="neutral" size="sm">
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Fix Phase 4.5d: the December reminder, previewed ── */}
      <section className={CARD} data-testid="full-count-reminder-preview">
        <h2 className="text-sm font-bold text-white">
          December cockpit reminder {reminder?.live ? <Badge tone="gold">Live now</Badge> : <Badge tone="neutral">Preview</Badge>}
        </h2>
        {reminder === null ? (
          <p className={`mt-1 ${P}`}>Could not check whether the {reminderYear} full count is planned. Try again later.</p>
        ) : reminder.text ? (
          <p className={`mt-1 ${P}`} data-testid="full-count-reminder-text">
            {reminder.live ? "The owner cockpit is saying today:" : `On December 1, ${reminder.year} the owner cockpit will say:`}{" "}
            <span className="font-semibold text-white">&ldquo;{reminder.text}&rdquo;</span> It links back to this page, and
            it stops as soon as the {reminder.year} full count is planned.
          </p>
        ) : (
          <p className={`mt-1 ${P}`} data-testid="full-count-reminder-quiet">
            {reminder.live ? "The owner cockpit is quiet" : "In December the owner cockpit will stay quiet"} because the{" "}
            {reminder.year} full count is already planned.
          </p>
        )}
      </section>

      {/* ── Plan a new one ── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">Plan the {year} year-end full count</h2>
        {thisYear ? (
          <p className={`mt-1 ${P}`}>
            The {year} full count is already planned (one a year). Open it above. To start again, cancel it there
            first.
          </p>
        ) : !preview.ok ? (
          <WhyBlockedPanel blockers={[preview.refusal.message]} title="The lots could not be read" />
        ) : (
          <>
            <p className={`mt-1 ${P}`}>
              {preview.data.plan.lotCount} active lots from {preview.data.plan.vendorCount} vendors, split into{" "}
              {preview.data.plan.sections.length} sections of up to {size} lots. A vendor stays together where it fits;
              a product&apos;s lots are never split between two counters. There is no 400-lot limit here.
            </p>
            <p className={`mt-1 ${P}`} data-testid="full-count-minutes">
              Each section is {formatMinutes(minutesForLots(size, pace))} of counting; the whole store is{" "}
              {formatMinutes(minutesForLots(preview.data.plan.lotCount, pace))} of counting time, shared between the counters.
              Pace: {paceSentence(pace)}
            </p>
            {minutesCheck && !minutesCheck.ok ? (
              <p className="mt-1 text-xs text-red-200">{minutesCheck.message} The default size is shown.</p>
            ) : null}

            <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--admin-text-muted)]">
                Lots per section ({MIN_SECTION_LOTS}&ndash;{MAX_SECTION_LOTS})
                <input
                  name="size"
                  type="number"
                  min={MIN_SECTION_LOTS}
                  max={MAX_SECTION_LOTS}
                  defaultValue={size}
                  className="ml-2 w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"
                />
              </label>
              <Button type="submit" variant="neutral" size="sm">
                Re-plan
              </Button>
            </form>
            <form method="get" className="mt-2 flex flex-wrap items-end gap-2" data-testid="full-count-minutes-form">
              <label className="text-xs text-[var(--admin-text-muted)]">
                Or minutes per section ({MIN_SESSION_MINUTES}&ndash;{MAX_SESSION_MINUTES})
                <input
                  name="minutes"
                  type="number"
                  min={MIN_SESSION_MINUTES}
                  max={MAX_SESSION_MINUTES}
                  defaultValue={minutesForLots(size, pace)}
                  className="ml-2 w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"
                />
              </label>
              <Button type="submit" variant="neutral" size="sm">
                Re-plan by time
              </Button>
            </form>

            {preview.data.onOpenCount.length > 0 ? (
              <WhyBlockedPanel
                title="Finish the open counts first"
                blockers={[
                  `${preview.data.onOpenCount.length} lot(s) are on another open count (for example ${preview.data.onOpenCount
                    .slice(0, 3)
                    .map((h) => `${h.lotCode ?? "no code"} on \u201c${h.label}\u201d`)
                    .join(", ")}). A lot is on one open count at a time: post or cancel those counts, then plan the full count.`,
                ]}
              />
            ) : null}

            <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-black/60">
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--admin-text-muted)]">
                    <th className="px-2 py-1.5">Section</th>
                    <th className="px-2 py-1.5 text-right">Lots</th>
                    <th className="px-2 py-1.5 text-right">Counting time</th>
                    <th className="px-2 py-1.5">Vendors</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.plan.sections.map((s) => (
                    <tr key={s.no} className="border-t border-white/5 align-top">
                      <td className="px-2 py-1.5 font-semibold text-white">{s.no}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.lotIds.length}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatMinutes(minutesForLots(s.lotIds.length, pace))}</td>
                      <td className="px-2 py-1.5 text-white/80">{s.vendors.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={createFullCountAction} className="mt-4 flex flex-wrap items-center gap-3">
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="sectionLots" value={size} />
              <Button
                type="submit"
                variant="confirm"
                size="md"
                disabled={preview.data.plan.lotCount === 0 || preview.data.onOpenCount.length > 0}
              >
                Create the {year} full count ({preview.data.plan.sections.length} sections)
              </Button>
              <span className={P}>
                Creates one draft audit per section. Nothing reaches Cycle Counts until you press Release all sections.
                The books quantity of each lot is captured when that lot is first counted, so the store can stay open.
              </span>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
