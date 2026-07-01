/**
 * src/lib/inventory/manifest-pipeline-core.ts  (Slice 74)
 *
 * PURE logic for the inbound manifest PIPELINE — a Cultivera-style
 * "where is every incoming transfer right now" view. No I/O, no server-only
 * imports, so it is unit-testable with tsx.
 *
 * GROUNDING (deep-researched, WSLCB + WCIA + Cultivera, verified):
 *   - CCRS has NO inbound-manifest push/feed/query API. A manifest is a CSV the
 *     SENDING (origin) licensee uploads to CCRS; on success CCRS emails a PDF
 *     confirmation to the sending + receiving licensee, integrator, transporter.
 *   - Receiving-side inbound visibility is therefore a PEER hand-off: the
 *     receiver either (a) imports the WCIA transfer JSON the sender provides, or
 *     (b) manually enters the inbound transfer — then Accepts it.
 *   - "Third-Party Integrator" access only lets a vendor UPLOAD on behalf of a
 *     licensee; it does NOT grant a special inbound-read feed.
 *
 * So this pipeline enhances the EXISTING WCIA-import + manual-entry lifecycle
 * (pending → in_transit → received → accepted | rejected) with grouping,
 * counts, an "awaiting intake" bucket, and ETA/overdue surfacing. It never
 * pretends a live CCRS query exists.
 */

/** The canonical inbound lifecycle stages, in order. */
export const MANIFEST_STAGES = [
  "pending",
  "in_transit",
  "received",
  "accepted",
  "rejected",
] as const;

export type ManifestStage = (typeof MANIFEST_STAGES)[number];

/** Order used to know how far a manifest has progressed. Rejected shares the
 * terminal slot with accepted so the rail renders correctly. */
export const STAGE_ORDER: Record<string, number> = {
  pending: 0,
  in_transit: 1,
  received: 2,
  accepted: 3,
  rejected: 3,
};

/** Human labels + a short "what this means" line for staff. */
export const STAGE_META: Record<
  ManifestStage,
  { label: string; blurb: string; tone: "gold" | "orange" | "green" | "danger" | "neutral" }
> = {
  pending: {
    label: "Pending",
    blurb: "Imported/entered but not yet marked on its way.",
    tone: "gold",
  },
  in_transit: {
    label: "In transit",
    blurb: "The transporter is on the way. Watch the ETA.",
    tone: "orange",
  },
  received: {
    label: "Awaiting intake",
    blurb: "Physically here — verify counts, then accept to activate the lots.",
    tone: "orange",
  },
  accepted: {
    label: "Accepted",
    blurb: "Lots activated and receive adjustments logged.",
    tone: "green",
  },
  rejected: {
    label: "Rejected",
    blurb: "Discarded; lots were destroyed and never sellable.",
    tone: "danger",
  },
};

/** Return the normalized stage for any status string (unknown → pending). */
export function normalizeStage(status: string | null | undefined): ManifestStage {
  const s = (status ?? "").trim().toLowerCase();
  if ((MANIFEST_STAGES as readonly string[]).includes(s)) return s as ManifestStage;
  return "pending";
}

/** True while a manifest is still open (staff can still act on it). */
export function isOpenStage(status: string | null | undefined): boolean {
  const s = normalizeStage(status);
  return s === "pending" || s === "in_transit" || s === "received";
}

/** A manifest is "awaiting intake" once it's physically received but not yet
 * accepted — the highest-priority queue for the receiving team. */
export function isAwaitingIntake(status: string | null | undefined): boolean {
  return normalizeStage(status) === "received";
}

/** Full counts across every lifecycle stage (superset of the old 3). */
export type StageCounts = {
  pending: number;
  in_transit: number;
  received: number;
  accepted: number;
  rejected: number;
  /** Convenience rollup: pending + in_transit + received. */
  open: number;
  /** Convenience: received-but-not-accepted (the intake queue). */
  awaitingIntake: number;
};

export function emptyStageCounts(): StageCounts {
  return {
    pending: 0,
    in_transit: 0,
    received: 0,
    accepted: 0,
    rejected: 0,
    open: 0,
    awaitingIntake: 0,
  };
}

/** Roll a list of status strings up into full stage counts. */
export function countStages(statuses: (string | null | undefined)[]): StageCounts {
  const out = emptyStageCounts();
  for (const raw of statuses) {
    const s = normalizeStage(raw);
    out[s] += 1;
  }
  out.open = out.pending + out.in_transit + out.received;
  out.awaitingIntake = out.received;
  return out;
}

/**
 * ETA classification for an in-transit manifest.
 *   - "none"    → no ETA on file
 *   - "overdue" → ETA date is strictly before today
 *   - "today"   → ETA is today
 *   - "upcoming"→ ETA is in the future
 * `etaDate` is a YYYY-MM-DD string; `now` defaults to the current date.
 */
export type EtaStatus = "none" | "overdue" | "today" | "upcoming";

/** Parse a YYYY-MM-DD into a UTC day number, or null. Avoids TZ drift by
 * comparing calendar dates only. */
function dayNumber(dateStr: string | null | undefined): number | null {
  const t = (dateStr ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const da = Number(m[3]);
  return Math.floor(Date.UTC(y, mo, da) / 86400000);
}

export function classifyEta(
  etaDate: string | null | undefined,
  now: Date = new Date(),
): EtaStatus {
  const eta = dayNumber(etaDate);
  if (eta === null) return "none";
  const today = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000,
  );
  if (eta < today) return "overdue";
  if (eta === today) return "today";
  return "upcoming";
}

/** True when an in-transit manifest's ETA has already passed. */
export function isEtaOverdue(
  status: string | null | undefined,
  etaDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return normalizeStage(status) === "in_transit" && classifyEta(etaDate, now) === "overdue";
}

/** A row shape the pipeline groups on (subset of InboundManifest). */
export type PipelineRow = {
  id: string;
  status: string;
  eta_date?: string | null;
};

/** Group manifests into the pipeline buckets used by the dashboard, in the
 * order staff should work them: awaiting intake first, then in transit,
 * then pending. Accepted/rejected are returned but not prioritized. */
export type GroupedPipeline<T extends PipelineRow> = {
  awaitingIntake: T[];
  inTransit: T[];
  pending: T[];
  accepted: T[];
  rejected: T[];
};

export function groupPipeline<T extends PipelineRow>(rows: T[]): GroupedPipeline<T> {
  const out: GroupedPipeline<T> = {
    awaitingIntake: [],
    inTransit: [],
    pending: [],
    accepted: [],
    rejected: [],
  };
  for (const r of rows) {
    const s = normalizeStage(r.status);
    if (s === "received") out.awaitingIntake.push(r);
    else if (s === "in_transit") out.inTransit.push(r);
    else if (s === "pending") out.pending.push(r);
    else if (s === "accepted") out.accepted.push(r);
    else out.rejected.push(r);
  }
  return out;
}

/**
 * Sanitize a YYYY-MM-DD ETA input into a storable value or null.
 * Rejects empty / malformed strings.
 */
export function normalizeEtaInput(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return t;
}

/** A short, factual note staff can read so they understand there is no magic
 * CCRS feed — inbound comes from the sender's WCIA JSON or manual entry. */
export const INBOUND_SOURCE_NOTE =
  "Washington has no automatic inbound feed. In CCRS, the SENDING licensee " +
  "uploads the manifest and everyone gets an email confirmation — there is no " +
  "live query the receiver can pull. So we build the inbound record two ways: " +
  "import the vendor's WCIA transfer link/JSON, or enter it by hand. Either " +
  "way you then move it along this pipeline and accept it to activate the lots.";

// ---------------------------------------------------------------------------
// Self-tests (run via tsx from a throwaway harness that imports this file).
// ---------------------------------------------------------------------------
export function __runManifestPipelineTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // normalizeStage
  ok(normalizeStage("PENDING") === "pending", "normalizeStage lowercases");
  ok(normalizeStage("in_transit") === "in_transit", "normalizeStage in_transit");
  ok(normalizeStage("weird") === "pending", "normalizeStage unknown → pending");
  ok(normalizeStage(null) === "pending", "normalizeStage null → pending");

  // isOpenStage / isAwaitingIntake
  ok(isOpenStage("pending"), "pending is open");
  ok(isOpenStage("in_transit"), "in_transit is open");
  ok(isOpenStage("received"), "received is open");
  ok(!isOpenStage("accepted"), "accepted not open");
  ok(!isOpenStage("rejected"), "rejected not open");
  ok(isAwaitingIntake("received"), "received awaits intake");
  ok(!isAwaitingIntake("pending"), "pending not awaiting intake");

  // countStages
  const counts = countStages([
    "pending",
    "pending",
    "in_transit",
    "received",
    "received",
    "received",
    "accepted",
    "rejected",
    "GARBAGE",
  ]);
  ok(counts.pending === 3, "counts pending incl. garbage→pending"); // 2 + 1 garbage
  ok(counts.in_transit === 1, "counts in_transit");
  ok(counts.received === 3, "counts received");
  ok(counts.accepted === 1, "counts accepted");
  ok(counts.rejected === 1, "counts rejected");
  ok(counts.open === 3 + 1 + 3, "open rollup = pending+in_transit+received");
  ok(counts.awaitingIntake === 3, "awaitingIntake = received");
  const zero = countStages([]);
  ok(zero.open === 0 && zero.awaitingIntake === 0, "empty counts are zero");

  // ETA
  const now = new Date("2024-06-15T12:00:00Z");
  ok(classifyEta(null, now) === "none", "eta none");
  ok(classifyEta("2024-06-10", now) === "overdue", "eta overdue");
  ok(classifyEta("2024-06-15", now) === "today", "eta today");
  ok(classifyEta("2024-06-20", now) === "upcoming", "eta upcoming");
  ok(isEtaOverdue("in_transit", "2024-06-10", now), "in_transit overdue");
  ok(!isEtaOverdue("in_transit", "2024-06-20", now), "in_transit upcoming not overdue");
  ok(!isEtaOverdue("pending", "2024-06-10", now), "pending never overdue (not moving)");
  ok(!isEtaOverdue("received", "2024-06-10", now), "received never overdue");

  // normalizeEtaInput
  ok(normalizeEtaInput("2024-06-20") === "2024-06-20", "eta input valid");
  ok(normalizeEtaInput(" 2024-06-20 ") === "2024-06-20", "eta input trims");
  ok(normalizeEtaInput("") === null, "eta input empty → null");
  ok(normalizeEtaInput("2024-13-01") === null, "eta input bad month → null");
  ok(normalizeEtaInput("not a date") === null, "eta input garbage → null");

  // groupPipeline priority
  const grouped = groupPipeline([
    { id: "a", status: "received" },
    { id: "b", status: "in_transit" },
    { id: "c", status: "pending" },
    { id: "d", status: "accepted" },
    { id: "e", status: "rejected" },
    { id: "f", status: "received" },
  ]);
  ok(grouped.awaitingIntake.length === 2, "group awaitingIntake");
  ok(grouped.inTransit.length === 1, "group inTransit");
  ok(grouped.pending.length === 1, "group pending");
  ok(grouped.accepted.length === 1, "group accepted");
  ok(grouped.rejected.length === 1, "group rejected");

  // Stage meta completeness
  ok(MANIFEST_STAGES.every((s) => STAGE_META[s] !== undefined), "every stage has meta");
  ok(INBOUND_SOURCE_NOTE.includes("no automatic inbound feed"), "source note grounded");

  console.log(`manifest-pipeline-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
