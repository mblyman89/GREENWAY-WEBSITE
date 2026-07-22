/**
 * /admin/knowledge-base/harvest/history — Past crawls (Task D).
 *
 * The Harvest Console's main page shows only ACTIVE jobs so it stays clean.
 * This sibling tab shows the HISTORY of finished crawls (completed / cancelled
 * / failed), newest first, reusing the same live job cards (so a job that
 * finishes while you're here still lands here on the next poll). Resume is
 * still available from a failed/cancelled card; the jump-to-vendor links (Task
 * C) make it easy to revisit what a past crawl produced.
 *
 * Drafts-only, read-mostly: nothing publishes from here.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs } from "@/components/admin/ux";
import { HarvestJobsLive } from "@/components/admin/kb/HarvestJobsLive";
import { cancelHarvestAction, resumeHarvestAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function HarvestHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  await requirePermission("vendors.manage");

  return (
    <div>
      <AdminPageHeader
        title="Past crawls"
        subtitle="History of finished harvest jobs — newest first. Revisit what each crawl produced or resume an unfinished one."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Harvest Console", href: "/admin/knowledge-base/harvest" },
              { label: "Past crawls" },
            ]}
          />
        }
        action={
          <BackLink
            fallback="/admin/knowledge-base/harvest"
            back={back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:border-[#7ed957] hover:text-[#7ed957]"
          >
            ← Back to Harvest Console
          </BackLink>
        }
      />

      <div className="px-5 py-6 sm:px-8 space-y-6">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
            Finished crawls
          </h2>
          <HarvestJobsLive
            cancelAction={cancelHarvestAction}
            resumeAction={resumeHarvestAction}
            filter="history"
          />
        </section>
      </div>
    </div>
  );
}
