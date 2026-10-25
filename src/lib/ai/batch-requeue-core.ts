/**
 * R74 S45 - Pure rules for "what still needs Google" (Round 25).
 *
 * Root cause fixed: the Smart-batch plan only saw items of the newest 600
 * lookup jobs, while the send-time planner skipped products done in ANY job.
 * Older answered products looked "waiting" forever, every wave picked them
 * first, and each send queued less until it queued nothing. Now "handled" is
 * read across ALL jobs, the wave keeps filling past manifests that turn out
 * to have nothing left, and re-runs never resend a product another job has
 * already answered (or is already asking) - no credits spent twice.
 */

/** Note on a failed / stopped item closed because another lookup already has the product. */
export const ALREADY_ANSWERED_NOTE = "Not resent: another lookup already answered this product (or is asking right now).";

/** An item in one of these states means the product needs nothing more from Google. */
export const HANDLED_ITEM_STATUSES = ["done", "queued", "running"] as const;

export function isHandledStatus(status: unknown): boolean {
  return typeof status === "string" && (HANDLED_ITEM_STATUSES as readonly string[]).includes(status);
}

/** Most manifests a single wave press may try (bounds the server action time). */
export const WAVE_MAX_TRIES = 120;

/**
 * Keep queuing manifests for a wave? Stops once the products queued fill the
 * wanted batches, or after WAVE_MAX_TRIES manifests (most of which may have
 * been "nothing left" on a stale plan).
 */
export function keepQueuing(s: { queuedProducts: number; target: number; tried: number; maxTries?: number }): boolean {
  const max = s.maxTries ?? WAVE_MAX_TRIES;
  if (s.tried >= max) return false;
  return s.queuedProducts < Math.max(1, s.target);
}

/**
 * Split failed / stopped items into the ones to put back in line and the
 * ones to leave: a product another job already answered or is asking about
 * right now must not go to Google a second time.
 */
export function pickRequeue(items: readonly { id: string; draft_id: string }[], busyDraftIds: ReadonlySet<string>): { keep: string[]; skipped: number } {
  const keep: string[] = [];
  const seenDraft = new Set<string>();
  let skipped = 0;
  for (const it of items) {
    const d = String(it.draft_id ?? "").toLowerCase();
    if (!it.id || !d || busyDraftIds.has(d) || seenDraft.has(d)) {
      skipped += 1;
      continue;
    }
    seenDraft.add(d);
    keep.push(it.id);
  }
  return { keep, skipped };
}

/** Plain line for a wave result. */
export function waveSummary(r: { created: number; products: number; already: number; nothing: number; errors: readonly string[] }): string {
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const head = r.created > 0 ? `Queued ${s(r.created, "manifest")} (${r.products} products)` : "Queued nothing new";
  const tail = [r.already ? `${r.already} already in line` : "", r.nothing ? `${r.nothing} skipped because every product on them is already answered` : ""].filter(Boolean).join(", ");
  const err = r.errors.length ? `. Problems: ${r.errors.slice(0, 2).join("; ")}` : "";
  const next = r.created > 0 || r.already > 0 ? ". The engine sends them to Gemini on the next minute." : ". Nothing is left to ask Google about on the manifests tried.";
  return `${head}${tail ? `, ${tail}` : ""}${err}${next}`;
}

export function __runBatchRequeueTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, _n: string) => (c ? (passed += 1) : (failed += 1));
  ok(/Not resent/.test(ALREADY_ANSWERED_NOTE), "note copy");
  ok(isHandledStatus("done") && isHandledStatus("queued") && isHandledStatus("running"), "handled states");
  ok(!isHandledStatus("failed") && !isHandledStatus("canceled") && !isHandledStatus(null), "failed / stopped are not handled");
  ok(keepQueuing({ queuedProducts: 0, target: 200, tried: 47 }), "47 empty manifests: keep going");
  ok(!keepQueuing({ queuedProducts: 200, target: 200, tried: 3 }), "target filled: stop");
  ok(!keepQueuing({ queuedProducts: 0, target: 200, tried: WAVE_MAX_TRIES }), "try cap");
  ok(keepQueuing({ queuedProducts: 0, target: 0, tried: 0 }), "target floor 1");
  const busy = new Set(["d1"]);
  const p = pickRequeue([{ id: "a", draft_id: "D1" }, { id: "b", draft_id: "d2" }, { id: "c", draft_id: "d2" }, { id: "", draft_id: "d3" }], busy);
  ok(p.keep.length === 1 && p.keep[0] === "b", "busy + duplicate draft skipped");
  ok(p.skipped === 3, "skipped count");
  ok(/Queued 2 manifests \(40 products\), 5 skipped/.test(waveSummary({ created: 2, products: 40, already: 0, nothing: 5, errors: [] })), "summary created");
  ok(/Queued nothing new.*Nothing is left/.test(waveSummary({ created: 0, products: 0, already: 0, nothing: 3, errors: [] })), "summary nothing");
  ok(/next minute/.test(waveSummary({ created: 0, products: 0, already: 2, nothing: 0, errors: [] })), "summary already");
  return { passed, failed };
}
