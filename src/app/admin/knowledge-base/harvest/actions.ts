"use server";

/**
 * /admin/knowledge-base/harvest — server actions (Slice H4).
 *
 * The console submits BATCH jobs to the crawler worker (H1 endpoints). The
 * worker does the honest pipeline per site and writes pending drafts; these
 * actions only start/stop jobs and never write content themselves.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  startHarvest,
  cancelHarvestJob,
  resumeHarvestJob,
  isCrawlerConfigured,
  CrawlerNotConfiguredError,
  type HarvestTargetInput,
} from "@/lib/ai/crawler-client";

const BASE = "/admin/knowledge-base/harvest";

/** Tier presets — depths straight from the harvest strategy. */
const TIERS: Record<string, { maxPages: number; delay: number; label: string }> = {
  "1": { maxPages: 25, delay: 0, label: "Tier 1 — current vendors (deep)" },
  "2": { maxPages: 10, delay: 0, label: "Tier 2 — prospects (medium)" },
  "3": { maxPages: 3, delay: 60, label: "Tier 3 — whole market (shallow trickle)" },
};

function fail(msg: string): never {
  redirect(`${BASE}?error=` + encodeURIComponent(msg));
}

/**
 * Start a harvest job from the selected targets. Each selected checkbox
 * carries a packed value `entityType|entityId|url|displayName` (all our own
 * data — vendor/lead rows the page itself rendered).
 */
export async function startHarvestAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  if (!isCrawlerConfigured()) fail("Crawler isn't set up (CRAWLER_BASE_URL / CRAWLER_SHARED_SECRET).");

  const tier = String(formData.get("tier") ?? "1");
  const preset = TIERS[tier] ?? TIERS["1"];

  const targets: HarvestTargetInput[] = [];
  for (const raw of formData.getAll("target")) {
    const [entityType, entityId, url, displayName = ""] = String(raw).split("|");
    if (!entityId || !/^https?:\/\//i.test(url ?? "")) continue;
    if (entityType !== "vendor" && entityType !== "brand" && entityType !== "product") continue;
    targets.push({ entityType, entityId, url, displayName });
  }
  if (targets.length === 0) fail("Pick at least one target with a website.");
  if (targets.length > 500) fail("Too many targets for one job (max 500).");

  try {
    const job = await startHarvest({
      targets,
      maxPagesPerSite: preset.maxPages,
      delayBetweenTargets: preset.delay,
      label: `${preset.label} · ${targets.length} site${targets.length === 1 ? "" : "s"}`,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.harvest_started",
      entityType: "harvest_job",
      entityId: job.id,
      after: { tier, targets: targets.length, maxPages: preset.maxPages },
    });
    revalidatePath(BASE);
    redirect(
      `${BASE}?msg=` +
        encodeURIComponent(
          `Harvest started — ${targets.length} site${targets.length === 1 ? "" : "s"} queued (${preset.label}).`,
        ),
    );
  } catch (err) {
    unstable_rethrow(err);
    const msg =
      err instanceof CrawlerNotConfiguredError
        ? "Crawler isn't set up yet."
        : `Couldn't start the harvest: ${err instanceof Error ? err.message : "please try again"}`;
    fail(msg);
  }
}

/** Ask a running job to stop after the current site. */
export async function cancelHarvestAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) fail("Missing job id.");
  try {
    const job = await cancelHarvestJob(jobId);
    if (!job) fail("Job not found on the worker.");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.harvest_cancelled",
      entityType: "harvest_job",
      entityId: jobId,
    });
    revalidatePath(BASE);
    redirect(`${BASE}?msg=` + encodeURIComponent("Cancel requested — the job stops after the current site."));
  } catch (err) {
    unstable_rethrow(err);
    fail(`Couldn't cancel: ${err instanceof Error ? err.message : "please try again"}`);
  }
}

/** Resume a job that was interrupted (e.g. the worker restarted). */
export async function resumeHarvestAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) fail("Missing job id.");
  try {
    const job = await resumeHarvestJob(jobId);
    if (!job) fail("Job not found on the worker.");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.harvest_resumed",
      entityType: "harvest_job",
      entityId: jobId,
    });
    revalidatePath(BASE);
    redirect(`${BASE}?msg=` + encodeURIComponent("Resume requested — unfinished sites are re-queued."));
  } catch (err) {
    unstable_rethrow(err);
    fail(`Couldn't resume: ${err instanceof Error ? err.message : "please try again"}`);
  }
}
