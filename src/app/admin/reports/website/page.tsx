/**
 * src/app/admin/reports/website/page.tsx  (R47-S2)
 *
 * Reports > Website: which banners and buttons customers press.
 *
 * Michael, verbatim: "I only want google store listing, clicks and reports,
 * the image picker for the seo editor."
 *
 * Numbers come from our own website_click_events table (migration 0268),
 * written by the ClickTracker on the public site. No cookies, IP addresses
 * or customer ids are stored. Staff previews and visitors with Global
 * Privacy Control are not counted.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { BarList, DayBarChart, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { readClicksSince, CLICK_REPORT_MAX_ROWS } from "@/lib/analytics/click-events-store";
import {
  CLICK_RANGES,
  clickReportWindow,
  PLACEMENT_LABELS,
  deadSlots,
  parseClickRange,
  summarizeClicks,
  type LiveSlot,
} from "@/lib/analytics/click-events-core";
import { listCarouselSlides } from "@/lib/cms/carousel-store";
import { listShopCarouselSlides } from "@/lib/cms/shop-carousel-store";
import { isSlideLiveAt } from "@/lib/cms/shop-carousel-core";
import { isHomeSlideLiveAt, normalizeHomeSlideAdvanced } from "@/lib/cms/home-slide-advanced-core";
import { listSchedules } from "@/lib/cms/content-schedule-server";
import { TARGET_KIND_LABEL } from "@/lib/cms/content-schedule-core";

export const dynamic = "force-dynamic";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Home + shop slides customers can see right now that have buttons. */
async function liveSlots(nowMs: number): Promise<LiveSlot[]> {
  const out: LiveSlot[] = [];
  try {
    for (const s of await listCarouselSlides()) {
      if (!s.enabled || s.status !== "published") continue;
      const adv = normalizeHomeSlideAdvanced(s.advanced ?? null);
      if (!isHomeSlideLiveAt(adv, nowMs)) continue;
      const designButtons = adv?.design?.enabled ? adv.design.buttons.filter((b) => b.label && b.href).length : 0;
      out.push({
        placement: "home_hero",
        slotKey: s.slide_key,
        label: s.title || s.eyebrow || s.slide_key,
        hasButtons: adv?.design?.enabled ? designButtons > 0 : (s.ctas ?? []).length > 0,
      });
    }
  } catch {
    /* table missing: skip */
  }
  try {
    for (const s of await listShopCarouselSlides()) {
      if (!s.enabled || s.status !== "published") continue;
      const p = s.presentation;
      if (!p || !isSlideLiveAt(p, nowMs)) continue;
      const designButtons = p.design?.enabled ? p.design.buttons.filter((b) => b.label && b.href).length : 0;
      out.push({
        placement: "shop_banner",
        slotKey: s.slide_key,
        label: p.title.text || p.eyebrow.text || s.slide_key,
        hasButtons: p.design?.enabled ? designButtons > 0 : p.ctas.length > 0,
      });
    }
  } catch {
    /* table missing: skip */
  }
  return out;
}

export default async function WebsiteReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requirePermission("reports.view");
  const { days: rawDays } = await searchParams;
  const days = parseClickRange(rawDays);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-[var(--admin-gold)]">The database isn&apos;t set up yet.</p>;
  }

  const { nowMs, sinceIso } = clickReportWindow(days);
  const [clicks, live, schedules] = await Promise.all([
    readClicksSince(sinceIso),
    liveSlots(nowMs),
    listSchedules({ recentDays: days }),
  ]);
  const summary = summarizeClicks(clicks.rows, days, nowMs);
  const dead = deadSlots(live, clicks.rows);
  const doneSchedules = schedules.rows
    .filter((r) => r.status === "done" && r.ran_at && Date.parse(r.ran_at) >= Date.parse(sinceIso))
    .sort((a, b) => Date.parse(b.ran_at ?? "") - Date.parse(a.ran_at ?? ""))
    .slice(0, 25);
  const pct = (n: number) => (summary.total ? `${Math.round((n / summary.total) * 100)}%` : "0%");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">🌐 Website: banner &amp; button clicks</h2>
          <p className="text-xs text-white/45">
            Which slides and buttons customers press. No cookies or personal details are stored; your own
            preview clicks and visitors who ask not to be tracked are not counted.
          </p>
        </div>
        <div className="flex gap-1.5">
          {CLICK_RANGES.map((d) => (
            <Link
              key={d}
              href={`/admin/reports/website?days=${d}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                d === days ? "bg-[var(--admin-accent)] text-black" : "border border-white/15 text-white/60 hover:bg-white/5"
              }`}
            >
              Last {d} days
            </Link>
          ))}
        </div>
      </div>

      {clicks.missingTable ? (
        <div className="rounded-xl border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          Click counting needs database update <strong>0268</strong>. Open the Supabase SQL editor, paste the
          contents of <code className="font-mono">supabase/migrations/0268_home_slide_advanced_click_events.sql</code>,
          and run it. Clicks start counting right after.
        </div>
      ) : null}
      {clicks.truncated ? (
        <p className="text-xs text-[var(--admin-gold)]">
          Showing the most recent {CLICK_REPORT_MAX_ROWS.toLocaleString()} clicks for this period.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Button clicks" value={summary.total.toLocaleString()} accent="green" hint={`Last ${days} days`} />
        <StatCard label="Phone" value={summary.byDevice.phone.toLocaleString()} hint={pct(summary.byDevice.phone)} />
        <StatCard label="Tablet" value={summary.byDevice.tablet.toLocaleString()} hint={pct(summary.byDevice.tablet)} />
        <StatCard label="Computer" value={summary.byDevice.desktop.toLocaleString()} hint={pct(summary.byDevice.desktop)} />
      </div>

      <Section title="Clicks per day" subtitle="Pacific time">
        <DayBarChart data={summary.daily} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Top slides & banners" subtitle="Which banner the pressed button sat on">
          <BarList
            data={summary.topSlots.map((s) => ({
              label: `${s.label} · ${PLACEMENT_LABELS[s.placement]}`,
              value: s.clicks,
            }))}
            emptyLabel="No clicks yet in this period."
          />
        </Section>
        <Section title="Top buttons" subtitle="Button words → where it goes">
          <BarList data={summary.topButtons} color={REPORT_COLORS.GOLD} emptyLabel="No clicks yet in this period." />
        </Section>
        <Section title="Where on the site" subtitle="Banner type">
          <BarList data={summary.byPlacement} color={REPORT_COLORS.ORANGE} emptyLabel="No clicks yet in this period." />
        </Section>
        <Section title="By page" subtitle="The page the click happened on">
          <BarList data={summary.byPage} emptyLabel="No clicks yet in this period." />
        </Section>
      </div>

      <Section
        title="Banners nobody pressed"
        subtitle="Live home slides and shop banners that have a button but got no clicks in this period. Consider new art, clearer words or a stronger offer."
      >
        {clicks.missingTable ? (
          <p className="text-sm text-white/40">Available once update 0268 is applied.</p>
        ) : dead.length === 0 ? (
          <p className="text-sm text-white/40">Every live banner with a button got at least one click. 🎉</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-white/75">
            {dead.map((s) => (
              <li key={`${s.placement}|${s.slotKey}`} className="flex items-center justify-between gap-3">
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 text-xs text-white/40">{PLACEMENT_LABELS[s.placement]}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Scheduled changes that went live" subtitle="From Content → Schedule, in this period">
        {!schedules.ready ? (
          <p className="text-sm text-white/40">Scheduling isn&apos;t set up yet (database update 0267).</p>
        ) : doneSchedules.length === 0 ? (
          <p className="text-sm text-white/40">No scheduled changes ran in this period.</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-white/75">
            {doneSchedules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate">
                  {r.action === "publish" ? "Went live" : "Taken down"}: {r.target_label || r.target_key}
                  <span className="ml-2 text-xs text-white/40">{TARGET_KIND_LABEL[r.target_kind] ?? r.target_kind}</span>
                </span>
                <span className="shrink-0 text-xs text-white/40">{fmtWhen(r.ran_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Page speed" subtitle="How fast the site loads for real customers">
        <p className="text-sm text-white/60">
          Speed is measured by Vercel Speed Insights on real visits. Open{" "}
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--admin-accent)] underline"
          >
            your Vercel dashboard ↗
          </a>
          , pick the Greenway project, then <strong>Speed Insights</strong>. Green scores (90+) are good.
        </p>
        <p className="mt-2 text-xs text-white/40">
          For visitor counts, traffic sources and search terms, use Google Analytics and Google Search Console.
        </p>
      </Section>
    </div>
  );
}
