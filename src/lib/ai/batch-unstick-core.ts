/**
 * src/lib/ai/batch-unstick-core.ts  (R74 S49)  PURE.
 *
 * "Unstick & re-ask": products the Vendor confidence tab shows as blue (in
 * progress) or red (failed) when no Gemini batch is open. They are orphans:
 * a lookup row still says "queued" / "running" but its job was closed or its
 * batch ended without filing it, so nothing will ever send it; failed rows
 * wait for a re-run.
 *
 * The plan, per manifest (delivery):
 *   - a manifest with a product inside a batch that is STILL OPEN at Google
 *     is left alone (its answer is coming);
 *   - otherwise every queued / running / failed row of that manifest is
 *     closed ("canceled" with UNSTUCK_NOTE) and every open job of it is
 *     closed, so a FRESH lookup can be queued for it (one active job per
 *     manifest). The fresh lookup asks only products still in review that
 *     no earlier lookup answered (answered / "nothing found" are not resent).
 * At most `cap` manifests per press (bounded server-action time); the rest
 * are still stuck and are picked up by the next press.
 */

export const UNSTUCK_NOTE = "Closed by Unstick & re-ask (it was stuck or failed). A fresh lookup was queued for its delivery.";
export const UNSTICK_MANIFEST_CAP = 60;

export type UnstickItem = { id: string; jobId: string; draftId: string; status: string; batchId: string | null };
/** leaseLive: the one-by-one runner holds this job right now (leave it alone). */
export type UnstickJob = { id: string; manifestId: string; status: string; leaseLive?: boolean };

export type UnstickPlan = {
  /** manifests to close + re-queue this press, oldest-first by input order */
  manifests: string[];
  /** lookup_job_items ids to close (queued / running / failed) */
  closeItemIds: string[];
  /** lookup_jobs ids to close (queued / running) */
  closeJobIds: string[];
  /** stuck / failed products counted in this press */
  products: number;
  /** manifests skipped because a product is at Google in an open batch */
  atGoogle: number;
  /** manifests left for the next press (over the cap) */
  remaining: number;
};

const OPEN_JOB = new Set(["queued", "running"]);
const STUCK_ITEM = new Set(["queued", "running", "failed"]);

export function planUnstick(input: {
  items: readonly UnstickItem[];
  jobs: readonly UnstickJob[];
  openBatchIds: ReadonlySet<string>;
  /** only these manifests (a vendor); null = every manifest */
  onlyManifests: ReadonlySet<string> | null;
  cap?: number;
}): UnstickPlan {
  const cap = Math.max(1, input.cap ?? UNSTICK_MANIFEST_CAP);
  const jobById = new Map(input.jobs.map((j) => [j.id, j]));
  const order: string[] = [];
  const byManifest = new Map<string, { items: UnstickItem[]; live: boolean }>();
  for (const it of input.items) {
    if (!STUCK_ITEM.has(it.status)) continue;
    const j = jobById.get(it.jobId);
    if (!j) continue;
    if (input.onlyManifests && !input.onlyManifests.has(j.manifestId)) continue;
    let m = byManifest.get(j.manifestId);
    if (!m) {
      m = { items: [], live: false };
      byManifest.set(j.manifestId, m);
      order.push(j.manifestId);
    }
    m.items.push(it);
    if (it.status === "running" && it.batchId && input.openBatchIds.has(it.batchId)) m.live = true;
    if (j.leaseLive && OPEN_JOB.has(j.status)) m.live = true;
  }
  const ready = order.filter((id) => !byManifest.get(id)!.live);
  const take = ready.slice(0, cap);
  const takeSet = new Set(take);
  const closeItemIds: string[] = [];
  const drafts = new Set<string>();
  for (const id of take) for (const it of byManifest.get(id)!.items) {
    closeItemIds.push(it.id);
    drafts.add(it.draftId.toLowerCase());
  }
  const closeJobIds = input.jobs.filter((j) => takeSet.has(j.manifestId) && OPEN_JOB.has(j.status)).map((j) => j.id);
  return {
    manifests: take,
    closeItemIds,
    closeJobIds,
    products: drafts.size,
    atGoogle: order.length - ready.length,
    remaining: ready.length - take.length,
  };
}

export function unstickSentence(p: UnstickPlan, r: { queuedProducts: number; queuedManifests: number; nothing: number; errors: string[] }): string {
  if (p.manifests.length === 0) {
    return p.atGoogle
      ? `Nothing to unstick right now: ${p.atGoogle} deliver${p.atGoogle === 1 ? "y has" : "ies have"} products inside a batch still open at Google. Their answers are coming; press Check now on the Mission tab.`
      : "Nothing is stuck: no products are in progress or failed.";
  }
  const parts = [
    `Unstuck ${p.products} product${p.products === 1 ? "" : "s"} on ${p.manifests.length} deliver${p.manifests.length === 1 ? "y" : "ies"}.`,
    `Queued ${r.queuedProducts} for a fresh lookup across ${r.queuedManifests} deliver${r.queuedManifests === 1 ? "y" : "ies"}.`,
  ];
  if (r.nothing) parts.push(`${r.nothing} deliver${r.nothing === 1 ? "y had" : "ies had"} nothing left to ask (already answered, or no longer in review).`);
  if (p.atGoogle) parts.push(`${p.atGoogle} left alone: still at Google in an open batch.`);
  if (p.remaining) parts.push(`${p.remaining} more deliveries are stuck: press the button again.`);
  if (r.errors.length) parts.push(`Problems: ${r.errors.slice(0, 2).join(" ")}`);
  parts.push("Now press Send 1 test batch (or Allow) on the Mission tab to send them to Google.");
  return parts.join(" ");
}

export function __runBatchUnstickTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.log("FAIL batch-unstick-core:", m);
    }
  };
  const jobs: UnstickJob[] = [
    { id: "j1", manifestId: "m1", status: "done" },
    { id: "j2", manifestId: "m2", status: "running" },
    { id: "j3", manifestId: "m3", status: "queued" },
    { id: "j4", manifestId: "m4", status: "canceled" },
  ];
  const items: UnstickItem[] = [
    { id: "a", jobId: "j1", draftId: "d1", status: "queued", batchId: null },
    { id: "b", jobId: "j1", draftId: "d2", status: "running", batchId: "dead" },
    { id: "c", jobId: "j2", draftId: "d3", status: "running", batchId: "live" },
    { id: "d", jobId: "j3", draftId: "d4", status: "failed", batchId: null },
    { id: "e", jobId: "j3", draftId: "d5", status: "done", batchId: null },
    { id: "f", jobId: "j4", draftId: "d6", status: "canceled", batchId: null },
  ];
  const p = planUnstick({ items, jobs, openBatchIds: new Set(["live"]), onlyManifests: null });
  ok(p.manifests.join() === "m1,m3", "orphans and failures planned; live batch manifest skipped");
  ok(p.closeItemIds.sort().join() === "a,b,d", "closes queued/running/failed only (never done)");
  ok(p.closeJobIds.join() === "j3", "closes the open job of a taken manifest only");
  ok(p.products === 3 && p.atGoogle === 1 && p.remaining === 0, "counts");
  const v = planUnstick({ items, jobs, openBatchIds: new Set(), onlyManifests: new Set(["m2"]) });
  ok(v.manifests.join() === "m2" && v.closeJobIds.join() === "j2", "vendor filter; dead batch = stuck");
  const c = planUnstick({ items, jobs, openBatchIds: new Set(), onlyManifests: null, cap: 1 });
  ok(c.manifests.length === 1 && c.remaining === 2, "cap leaves the rest for the next press");
  ok(unstickSentence(planUnstick({ items: [], jobs, openBatchIds: new Set(), onlyManifests: null }), { queuedProducts: 0, queuedManifests: 0, nothing: 0, errors: [] }).startsWith("Nothing is stuck"), "empty sentence");
  const leased = planUnstick({ items, jobs: jobs.map((j) => (j.id === "j3" ? { ...j, leaseLive: true } : j)), openBatchIds: new Set(["live"]), onlyManifests: null });
  ok(leased.manifests.join() === "m1" && leased.atGoogle === 2, "a job the runner holds right now is left alone");
  ok(unstickSentence(p, { queuedProducts: 3, queuedManifests: 2, nothing: 0, errors: [] }).includes("Send 1 test batch"), "says what to press next");
  return { passed, failed };
}
