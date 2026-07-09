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
 * "live" — pending | in_transit | accepted. A previously "rejected" manifest is
 * NOT blocking (the vendor may legitimately re-send a corrected transfer), so a
 * re-send after a rejection is allowed to stage again.
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
 * re-staging. Live states (pending/in_transit/accepted) block; a rejected row
 * does not (a corrected re-send is allowed). PURE.
 */
export function isBlockingStatus(status: ManifestStatus | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "pending" || s === "in_transit" || s === "accepted";
}

/** A candidate existing row (as selected from inbound_manifests). */
export type ExistingManifestRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  status: string | null;
};

/**
 * Given the new manifest's identity and the set of existing rows that share its
 * manifest_number (already filtered by the DB query), return the id of the FIRST
 * blocking duplicate (same vendorKey + a live status), or null when none blocks.
 * PURE — lets the store decide with a testable rule instead of ad-hoc logic.
 */
export function findBlockingDuplicate(
  identity: ManifestIdentity,
  existing: ExistingManifestRow[],
): string | null {
  for (const row of existing) {
    const rowNumber = norm(row.manifest_number);
    if (rowNumber !== identity.manifestNumber) continue;
    const rowVendor = norm(row.vendor_label);
    // Same number + same vendor (or both vendor-less) + a live status => block.
    if (rowVendor === identity.vendorKey && isBlockingStatus(row.status)) {
      return row.id;
    }
  }
  return null;
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

  if (failed === 0) console.log(`manifest-dedupe-core: all ${passed} tests passed`);
  return { passed, failed };
}
