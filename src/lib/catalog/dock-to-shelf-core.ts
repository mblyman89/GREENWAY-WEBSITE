/**
 * src/lib/catalog/dock-to-shelf-core.ts
 *
 * W12 — PURE dock-to-shelf lead-time math (audit gap G9).
 *
 * PO cycle-time (sent→received) already exists on Purchasing. What was
 * missing is the number that tells the owner whether the WEAPON is fast:
 * once product hits the dock, how long until it's sellable? Three hops,
 * each measured from timestamps that already exist:
 *
 *   1. Receive → Accept   inbound_manifests.received_at → accepted_at
 *   2. Accept  → Approve  manifest accepted_at → its approved draft's
 *                         updated_at (the approval write touches it)
 *   3. Approve → Live     draft approval → the FIRST menu version published
 *                         AFTER it (drafts ride the next staged import, W7)
 *
 * We report MEDIANS (robust to one weird weekend) with honest sample counts.
 * NEVER GUESS: a hop with no complete timestamp pairs reports null — the
 * card says "no data yet", never a made-up number.
 */

/** A completed interval: both ends are ISO timestamps. */
export type StampPair = { startIso: string; endIso: string };

/** Median hours across pairs; null when there is nothing to measure. */
export function medianHours(pairs: StampPair[]): number | null {
  const hours: number[] = [];
  for (const p of pairs) {
    const start = Date.parse(p.startIso);
    const end = Date.parse(p.endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const h = (end - start) / 3_600_000;
    if (h < 0) continue; // clock skew / bad data — never counted, never guessed
    hours.push(h);
  }
  if (hours.length === 0) return null;
  hours.sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 === 1 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/**
 * The first publish timestamp AT or AFTER an approval — how an approved
 * draft actually reaches customers (it rides the next published version).
 * `publishedAtsAsc` MUST be sorted ascending. Null when nothing published
 * after the approval yet (the hop is still open — not measured).
 */
export function nextPublishAfter(
  approvedAtIso: string,
  publishedAtsAsc: string[],
): string | null {
  const approved = Date.parse(approvedAtIso);
  if (!Number.isFinite(approved)) return null;
  for (const iso of publishedAtsAsc) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t >= approved) return iso;
  }
  return null;
}

export type DockToShelfMetrics = {
  /** Median hours received→accepted; null = no completed pairs. */
  receiveToAcceptHours: number | null;
  receiveToAcceptCount: number;
  /** Median hours accepted→draft approved. */
  acceptToApproveHours: number | null;
  acceptToApproveCount: number;
  /** Median hours draft approved→first publish after. */
  approveToLiveHours: number | null;
  approveToLiveCount: number;
};

export type DockToShelfInputs = {
  /** Manifests with BOTH received_at and accepted_at. */
  manifestPairs: StampPair[];
  /** Approved drafts joined to their manifest's accepted_at. */
  approvalPairs: StampPair[];
  /** Approved drafts' approval timestamps (ISO). */
  approvalTimes: string[];
  /** Published menu versions' published_at, ANY order (sorted internally). */
  publishedAts: string[];
};

/** Compute all three hop medians. Pure and deterministic. */
export function buildDockToShelfMetrics(inputs: DockToShelfInputs): DockToShelfMetrics {
  const publishedAsc = [...inputs.publishedAts]
    .filter((iso) => Number.isFinite(Date.parse(iso)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  const livePairs: StampPair[] = [];
  for (const approvedAt of inputs.approvalTimes) {
    const publish = nextPublishAfter(approvedAt, publishedAsc);
    if (publish) livePairs.push({ startIso: approvedAt, endIso: publish });
  }

  return {
    receiveToAcceptHours: medianHours(inputs.manifestPairs),
    receiveToAcceptCount: inputs.manifestPairs.length,
    acceptToApproveHours: medianHours(inputs.approvalPairs),
    acceptToApproveCount: inputs.approvalPairs.length,
    approveToLiveHours: medianHours(livePairs),
    approveToLiveCount: livePairs.length,
  };
}

/** "—" when unmeasured; minutes under 1h; hours under 48h; days after. */
export function formatHopHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
  const days = hours / 24;
  return `${days >= 10 ? Math.round(days) : Math.round(days * 10) / 10}d`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runDockToShelfCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL dock-to-shelf-core: " + msg);
    passed += 1;
  };

  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();

  // Median: empty → null (never a guessed number).
  assert(medianHours([]) === null, "empty → null");
  // Odd count → middle value.
  assert(
    medianHours([
      { startIso: at(0), endIso: at(2) },
      { startIso: at(0), endIso: at(4) },
      { startIso: at(0), endIso: at(10) },
    ]) === 4,
    "odd median",
  );
  // Even count → mean of middle two.
  assert(
    medianHours([
      { startIso: at(0), endIso: at(2) },
      { startIso: at(0), endIso: at(4) },
    ]) === 3,
    "even median",
  );
  // Negative intervals (clock skew) and junk are dropped, not counted.
  assert(
    medianHours([
      { startIso: at(5), endIso: at(1) },
      { startIso: "junk", endIso: at(1) },
      { startIso: at(0), endIso: at(6) },
    ]) === 6,
    "bad pairs dropped",
  );

  // nextPublishAfter: first publish at-or-after approval; none → null.
  assert(nextPublishAfter(at(3), [at(1), at(5), at(9)]) === at(5), "next publish found");
  assert(nextPublishAfter(at(5), [at(1), at(5)]) === at(5), "same-instant publish counts");
  assert(nextPublishAfter(at(10), [at(1), at(5)]) === null, "no publish yet → null");

  // Full build: approve→live joins approvals to the next publish only.
  {
    const m = buildDockToShelfMetrics({
      manifestPairs: [{ startIso: at(0), endIso: at(2) }],
      approvalPairs: [{ startIso: at(2), endIso: at(6) }],
      approvalTimes: [at(6), at(20)], // second approval has no publish after it
      publishedAts: [at(8)],
      // unsorted publishes tolerated:
    });
    assert(m.receiveToAcceptHours === 2 && m.receiveToAcceptCount === 1, "hop1");
    assert(m.acceptToApproveHours === 4 && m.acceptToApproveCount === 1, "hop2");
    assert(m.approveToLiveHours === 2 && m.approveToLiveCount === 1, "hop3 only closed pairs");
  }

  // Formatting: honest units at each scale.
  assert(formatHopHours(null) === "—", "null → em dash");
  assert(formatHopHours(0.5) === "30m", "minutes");
  assert(formatHopHours(4.26) === "4.3h", "sub-10h one decimal");
  assert(formatHopHours(23) === "23h", "hours rounded");
  assert(formatHopHours(72) === "3d", "days");

  return { passed };
}
