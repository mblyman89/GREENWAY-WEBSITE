/**
 * /admin/promotions/thursday-planner — the MULTI-WEEK Thursday brand-sale
 * planner (PR-P6).
 *
 * Michael wanted to queue a DIFFERENT brand for each upcoming Thursday up front
 * instead of picking one every week (and risking a stale brand lingering on
 * sale because he forgot). This page lists the next several Thursdays and lets
 * him assign brand(s) + a percent to each. On save, the server creates ONE
 * date-windowed DRAFT per week — each runs only on its Thursday and ends on its
 * own, so next week's brand swaps in automatically.
 *
 * The upcoming Thursdays are computed on the SERVER (store time) so the dates
 * are anchored to America/Los_Angeles and never drift on the client clock.
 * Everything is created as a DRAFT, so the CCRS below-cost publish guard and
 * every other publish-time check stay fully intact.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listMenuBrands } from "@/lib/promotions/promotions-store";
import {
  upcomingThursdays,
  humanThursdayLabel,
} from "@/lib/promotions/thursday-planner-core";
import { ThursdayPlanner } from "@/components/admin/promotions/ThursdayPlanner";

export const dynamic = "force-dynamic";

const HORIZON_WEEKS = 8;

export default async function ThursdayPlannerPage() {
  await requirePermission("promotions.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Thursday brand-sale planner"
          subtitle="Queue a different brand for each upcoming Thursday."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Promotions", href: "/admin/promotions" },
                { label: "Thursday planner" },
              ]}
            />
          }
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            The database isn’t fully set up yet. Once setup is complete you’ll be
            able to plan Thursday brand sales here.
          </div>
        </div>
      </div>
    );
  }

  const brands = await listMenuBrands();
  const thursdays = upcomingThursdays(HORIZON_WEEKS).map((ymd) => ({
    ymd,
    label: humanThursdayLabel(ymd),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Thursday brand-sale planner"
        subtitle="Queue a different brand for each upcoming Thursday — each week swaps in on its own."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Promotions", href: "/admin/promotions" },
              { label: "Thursday planner" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="thursday-planner"
            title="How the planner works"
            steps={[
              "Pick a brand (or a few) for each upcoming Thursday, and optionally a percent for that week.",
              "Leave a Thursday blank to skip it — nothing happens that week.",
              "Click “Schedule” — each planned Thursday is saved as its own draft.",
              "Review and publish the drafts below on the command center. Each one runs ONLY on its Thursday and ends on its own, so next week’s brand takes over automatically.",
            ]}
          >
            <p>
              This means you won’t accidentally leave the same brand on sale for
              weeks — each Thursday is its own dated deal that turns itself off at
              the end of the day. Nothing goes live without you publishing it, and
              the CCRS cost floor is still enforced at publish and at the register.
            </p>
          </HelpPanel>
        }
        action={
          <Link
            href="/admin/promotions"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            ← Back to promotions
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-[var(--admin-purple)]/30 bg-[var(--admin-purple)]/5 p-4 text-sm">
          <p className="font-semibold text-white/90">
            🗓️ Plan the next {HORIZON_WEEKS} Thursdays
          </p>
          <p className="mt-1 text-white/60">
            Assign a brand to any of the upcoming Thursdays below. Each one you
            fill in becomes its own draft promotion, dated to that single
            Thursday — so a brand is on sale for exactly one week and then the
            next week’s brand takes over on its own.
          </p>
        </div>

        <ThursdayPlanner thursdays={thursdays} brands={brands} />
      </div>
    </div>
  );
}
