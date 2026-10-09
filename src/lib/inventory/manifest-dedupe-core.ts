/**
 * src/lib/inventory/manifest-dedupe-core.ts  (H16b-7)
 *
 * PURE dedupe logic that prevents the SAME manifest entering the intake table
 * twice. A vendor sometimes re-sends the same email, or two body links resolve
 * to the same transfer — the owner does not want to accidentally accept the same
 * manifest twice. This module decides the dedupe IDENTITY of a parsed manifest
 * and whether an already-present row with that identity should block re-staging.
 *
 * No I/O, no server-only: the DB lookup lives in intake-store.ts's stageManifest,
 * which builds the identity here, queries inbound_manifests for a match, and uses
 * isBlockingStatus() to decide. Unit-testable with vitest.
 *
 * IDENTITY (verified against the real formats, never guessed):
 *   - The manifest_number is the transfer identifier issued by the originating
 *     system: Cultivera "ORD-7208", GrowFlow "GF42612700007100-1633182-1", the
 *     old-method real LCB Manifest ID "603353555", or a WCIA/CCRS number. It is
 *     stable across a re-send of the same transfer.
 *   - We scope the identity by vendor (label, normalized) so two DIFFERENT
 *     vendors that happen to reuse a short order number ("ORD-1") never collide.
 *   - When manifest_number is null we DO NOT dedupe (no reliable identity) —
 *     staging proceeds so we never silently drop a real, distinct transfer.
 *
 * BLOCKING STATUS: a duplicate is blocked only when the existing row is still
 * "live" — pending | in_transit | received | accepted | partially_accepted.
 * (R36: received and partially_accepted were missing, so a re-send of a
 * manifest that had already been marked received - or partially accepted -
 * staged a SECOND row; those stages are as live as accepted.) A previously
 * "rejected" manifest is NOT blocking (the vendor may legitimately re-send a
 * corrected transfer), and neither is a "dismissed" duplicate (R36: it never
 * was a real arrival), so a re-send after either is allowed to stage again.
 *
 * WHICH ROW IS "THE" ONE (R36): when several live rows share the identity
 * (the owner's duplicate pair), the OLDEST live row wins (created_at, then id)
 * - the same row the owner's "Dismiss duplicate" keeps - so the invoice #,
 * documents and transport a re-send carries always land on the row that stays,
 * never on whichever row the database happened to return first.
 */

/** The normalized identity used to detect a re-sent/duplicate manifest. */
export type ManifestIdentity = {
  /** Normalized manifest/transfer number (uppercased, whitespace-collapsed). */
  manifestNumber: string;
  /** Normalized vendor label used to scope the number, or "" when unknown. */
  vendorKey: string;
};

/** Collapse whitespace, trim, uppercase. PURE. */
function norm(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Build the dedupe identity for a parsed manifest, or null when there is no
 * reliable identity to dedupe on (no manifest number). PURE.
 */
export function buildManifestIdentity(parsed: {
  manifest_number: string | null;
  vendor_label: string | null;
}): ManifestIdentity | null {
  const manifestNumber = norm(parsed.manifest_number);
  if (!manifestNumber) return null;
  return { manifestNumber, vendorKey: norm(parsed.vendor_label) };
}

/** Manifest lifecycle statuses. */
export type ManifestStatus = "pending" | "in_transit" | "accepted" | "rejected" | (string & {});

/**
 * True when an EXISTING manifest row with the same identity should BLOCK
 * re-staging. Live states (BLOCKING_STATUSES) block; a rejected or dismissed
 * row does not (a corrected re-send is allowed). PURE.
 */
export function isBlockingStatus(status: ManifestStatus | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return (BLOCKING_STATUSES as readonly string[]).includes(s);
}

/**
 * R36 - every LIVE stage. A row in one of these is a real, still-counted
 * manifest. rejected (refused at the dock) and dismissed (a duplicate the
 * owner dismissed) are the only non-live stages.
 */
export const BLOCKING_STATUSES = [
  "pending",
  "in_transit",
  "received",
  "accepted",
  "partially_accepted",
] as const;

/** A candidate existing row (as selected from inbound_manifests). */
export type ExistingManifestRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  status: string | null;
  /** R36: used to pick the OLDEST live twin. Optional for older callers. */
  created_at?: string | null;
};

/**
 * Given the new manifest's identity and the set of existing rows that share its
 * manifest_number (already filtered by the DB query), return the id of the
 * OLDEST blocking duplicate (same vendorKey + a live status; ties and missing
 * timestamps broken by id), or null when none blocks. PURE — lets the store
 * decide with a testable rule instead of ad-hoc logic. Input order no longer
 * matters (R36: it used to return whichever row the query listed first).
 */
export function findBlockingDuplicate(
  identity: ManifestIdentity,
  existing: ExistingManifestRow[],
): string | null {
  let best: ExistingManifestRow | null = null;
  for (const row of existing) {
    const rowNumber = norm(row.manifest_number);
    if (rowNumber !== identity.manifestNumber) continue;
    const rowVendor = norm(row.vendor_label);
    // Same number + same vendor (or both vendor-less) + a live status => block.
    if (rowVendor !== identity.vendorKey || !isBlockingStatus(row.status)) continue;
    if (!best || compareOldestFirst(row, best) < 0) best = row;
  }
  return best ? best.id : null;
}

/** Epoch ms of an ISO timestamp, or +Infinity when missing/unparseable. PURE. */
function tsMs(v: string | null | undefined): number {
  const t = Date.parse(v ?? "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Oldest-first ordering for manifest rows: created_at ascending (missing last),
 * then id ascending so the answer is deterministic. PURE.
 */
export function compareOldestFirst(
  a: { id: string; created_at?: string | null },
  b: { id: string; created_at?: string | null },
): number {
  const ta = tsMs(a.created_at);
  const tb = tsMs(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * R36 - the value stored in inbound_manifests.dedupe_key (migration 0255,
 * UNIQUE while not null): "<MANIFEST #>|<VENDOR>" from the SAME normalization
 * as the identity above, so the atomic DB guard and the read-then-check can
 * never disagree. null when there is no identity (no manifest number) - such
 * a manifest is never deduped. PURE.
 */
export function dedupeKeyFor(identity: ManifestIdentity | null): string | null {
  if (!identity) return null;
  return `${identity.manifestNumber}|${identity.vendorKey}`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by the vitest harness).
// ---------------------------------------------------------------------------
export function __runManifestDedupeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // identity
  ok(
    JSON.stringify(buildManifestIdentity({ manifest_number: " ord-7208 ", vendor_label: "Lilac Labs" })) ===
      JSON.stringify({ manifestNumber: "ORD-7208", vendorKey: "LILAC LABS" }),
    "identity normalizes number + vendor",
  );
  ok(buildManifestIdentity({ manifest_number: null, vendor_label: "X" }) === null, "no number -> no identity");
  ok(buildManifestIdentity({ manifest_number: "   ", vendor_label: "X" }) === null, "blank number -> no identity");

  // blocking status
  ok(isBlockingStatus("pending") === true, "pending blocks");
  ok(isBlockingStatus("in_transit") === true, "in_transit blocks");
  ok(isBlockingStatus("accepted") === true, "accepted blocks");
  ok(isBlockingStatus("received") === true, "R36: received blocks");
  ok(isBlockingStatus("partially_accepted") === true, "R36: partially_accepted blocks");
  ok(isBlockingStatus(" Received ") === true, "R36: status is trimmed + case-folded");
  ok(isBlockingStatus("dismissed") === false, "R36: a dismissed duplicate does NOT block");
  ok(isBlockingStatus("rejected") === false, "rejected does NOT block (re-send allowed)");
  ok(isBlockingStatus(null) === false, "null status does not block");

  const idLilac = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;

  // exact live duplicate blocks
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "m1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "pending" },
    ]) === "m1",
    "live same-vendor same-number duplicate is blocked",
  );

  // rejected prior does NOT block
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "m1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "rejected" },
    ]) === null,
    "rejected prior does not block a corrected re-send",
  );

  // same number but DIFFERENT vendor does NOT block
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "m1", manifest_number: "ORD-7208", vendor_label: "Mako Farms", status: "pending" },
    ]) === null,
    "same number different vendor is NOT a duplicate",
  );

  // whitespace/case-insensitive match still blocks
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "m9", manifest_number: " ord-7208 ", vendor_label: "lilac  labs", status: "in_transit" },
    ]) === "m9",
    "case/whitespace-insensitive duplicate is blocked",
  );

  // first blocking row wins even if a non-blocking row precedes
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "r0", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "rejected" },
      { id: "r1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "accepted" },
    ]) === "r1",
    "skips rejected, blocks on the live accepted row",
  );

  // R36: the OLDEST live twin wins, whatever order the query returned
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "b", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "in_transit", created_at: "2026-08-05T10:00:05Z" },
      { id: "a", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "in_transit", created_at: "2026-08-05T10:00:00Z" },
    ]) === "a",
    "R36: oldest live twin is the duplicate target",
  );
  ok(
    findBlockingDuplicate(idLilac, [
      { id: "z", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "pending", created_at: null },
      { id: "y", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "pending", created_at: null },
    ]) === "y",
    "R36: no timestamps -> lowest id (deterministic)",
  );
  ok(dedupeKeyFor(idLilac) === "ORD-7208|LILAC LABS", "R36: dedupe key = NUMBER|VENDOR");
  ok(dedupeKeyFor(null) === null, "R36: no identity -> no dedupe key");

  if (failed === 0) console.log(`manifest-dedupe-core: all ${passed} tests passed`);
  return { passed, failed };
}
