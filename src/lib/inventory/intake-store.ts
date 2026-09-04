/**
 * src/lib/inventory/intake-store.ts
 *
 * POS Slice 4 — persists a parsed vendor manifest as DRAFT rows for review,
 * and accepts/rejects a staged manifest.
 *
 * Draft model (standing rule: machine output is never auto-live):
 *   - inbound_manifests.status = 'pending'
 *   - lab_results inserted (one per line that has a COA)
 *   - inventory_lots.status   = 'quarantine'  (held until accepted)
 * On accept: manifest → 'accepted', its quarantine lots → 'active', and a
 * 'receive' adjustment is logged per lot for the audit trail.
 * On reject: manifest → 'rejected', its lots → 'destroyed' (never sellable).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { ParsedManifest, ParsedTransport } from "@/lib/inventory/intake-parser";
import { extractCoaLinks, transportHasData } from "@/lib/inventory/intake-parser";
import { planTransportBackfill } from "@/lib/inventory/manifest-merge-core";
import type { InboundManifest, ManifestTransportInput } from "@/lib/inventory/types";
import { seedDraftsForManifest } from "@/lib/inventory/catalog-drafts";
import { archiveCoasForManifest } from "@/lib/inventory/coa-archive";
import { promoteManifestToKb } from "@/lib/inventory/manifest-kb-bridge";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import {
  normalizeLicense,
  pickVendorByNormalizedName,
  vendorSlugCandidate,
  stripLicenseSuffix,
  extractLicenseFromLabel,
  type VendorNameCandidate,
} from "@/lib/inventory/vendor-resolve-core";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import type { ReadCompletenessVerdict } from "@/lib/supabase/read-completeness-core";
import {
  decideVendorCreate,
  licenseFilterCandidates,
} from "@/lib/inventory/vendor-search-safety-core";
import { quarterKeyFromYmd } from "@/lib/compliance/trade-samples-core";
import { getSampleSettings, incomingUnitsForProcessor } from "@/lib/compliance/trade-samples";
import { sampleProductTypeForLine } from "@/lib/compliance/sample-product-type-core";
import type { SampleCapNoticeInput } from "@/lib/compliance/sample-cap-notice-core";
import {
  evaluateIntakeSampleCap,
  type IntakeSampleLine,
} from "@/lib/inventory/sample-intake-cap-core";
import {
  countStages,
  emptyStageCounts,
  normalizeEtaInput,
  type StageCounts,
} from "@/lib/inventory/manifest-pipeline-core";
import {
  evaluateLotBatchActivation,
  type LotGateFacts,
  type LotGateVerdict,
} from "@/lib/inventory/lot-activation-gate-core";
import {
  usualTransportFromManifest,
  parseUsualTransport,
  mergeUsualTransport,
} from "@/lib/inventory/vendor-transport-core";
import {
  buildManifestIdentity,
  findBlockingDuplicate,
  type ExistingManifestRow,
} from "@/lib/inventory/manifest-dedupe-core";
import { autoReceiveManifestPo } from "@/lib/inventory/po-receive-store";
import { stageIntakeMenuVersionForManifest } from "@/lib/pos/intake-menu-staging";
import {
  deriveManifestStatus,
  normalizePartialNote,
} from "@/lib/inventory/intake-disposition-core";

/**
 * Memory ceiling for a full vendors scan. `vendors` held 1,775 rows when last
 * measured (docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30); reaching this
 * ceiling is REPORTED as an incomplete search (which blocks vendor
 * auto-creation) rather than silently accepted.
 */
const VENDOR_SCAN_MAX_ROWS = 50_000;

/** Memory ceiling for a full inbound_manifests scan (stage counts). */
const MANIFEST_SCAN_MAX_ROWS = 100_000;

export async function listManifests(opts?: {
  status?: string;
  limit?: number;
}): Promise<InboundManifest[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("inbound_manifests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as InboundManifest[] | null) ?? [];
}

/**
 * Full lifecycle counts across every stage (pending / in_transit / received /
 * accepted / rejected) plus the `open` and `awaitingIntake` rollups. This is a
 * superset of the old {pending, accepted, rejected} return, so existing callers
 * keep working while the pipeline dashboard gets the interim states too.
 */
export async function countManifestsByStatus(): Promise<StageCounts> {
  if (!isSupabaseServiceConfigured) return emptyStageCounts();
  const admin = createSupabaseAdminClient();
  // SLICE 5B: `.limit(2000)` could not exceed PostgREST's 1,000-row cap, so
  // every dashboard stage count silently stopped at 1,000 manifests. Paged
  // completely instead. A per-status `count:"exact"` would be cheaper but
  // would NOT be equivalent: countStages() routes unrecognised statuses
  // through normalizeStage() (manifest-pipeline-core.ts:135-144), so counting
  // only the known enum values would silently drop rows. Reading the statuses
  // and rolling them up preserves that behaviour exactly.
  const { rows } = await pagedAllChecked<{ id: string; status: string }>(
    async (from, to) => {
      const { data, error } = await admin
        .from("inbound_manifests")
        .select("id, status")
        // Stable UNIQUE ordering — REQUIRED for deterministic paging.
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as { id: string; status: string }[] | null) ?? [], ok: true };
    },
    { maxRows: MANIFEST_SCAN_MAX_ROWS },
  );
  return countStages(rows.map((r) => r.status));
}

/**
 * H17 — resolve the manifest's sender to a vendors row, CREATING a draft
 * vendor when none exists. The old resolver was a bare
 * `ilike(display_name, label)` — case-insensitive EQUALITY — so any spelling
 * drift (or simply a vendor we hadn't added yet, like Seattles Private
 * Reserve) silently left vendor_id NULL: lots and catalog drafts carried no
 * vendor and vendor-axis product mastering had nothing to group on.
 *
 * Resolution ladder (most-authoritative first, all read-only until the last):
 *   1. LICENSE NUMBER — the manifest's from_license_number vs
 *      vendors.license_number (digits-only compare). The WA license is the
 *      stable public id; names drift, licenses don't.
 *   2. Exact ilike on display_name (the old behavior, kept).
 *   3. vendor_aliases (source_name, any source_system) — the alias-merge tool
 *      already maintains these.
 *   4. Normalized-name scan of display_name/dba/legal_name
 *      ("Seattle's Private-Reserve" === "seattles private reserve").
 *   5. AUTO-CREATE a status='draft' vendors row from the manifest header
 *      (display_name = label, license_number when present) + a vendor_aliases
 *      row (source_system 'manifest') so the next delivery hits step 3.
 *      Drafts-only rule respected: a draft vendor is back-office bookkeeping,
 *      not a published website page — vendor surfaces filter by status.
 *
 * Best-effort: any step's failure degrades to the next; a total failure
 * returns null exactly like before (staging never breaks on vendor lookup).
 */
export async function resolveOrCreateVendor(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string | null,
  license: string | null,
  actorId: string | null,
): Promise<string | null> {
  const cleanLabel = (label ?? "").trim();
  const licenseKey = normalizeLicense(license);

  // SLICE 5B — evidence that the SEARCH steps below actually read everything.
  // Step 5 auto-creates a vendor, which is irreversible without a merge, so it
  // may only run when a MISS was genuinely established. See
  // vendor-search-safety-core.ts for the full reasoning.
  let searchComplete = true;
  let incompleteStep: string | null = null;
  let incompleteVerdict: ReadCompletenessVerdict | null = null;
  const noteIncomplete = (step: string, verdict: ReadCompletenessVerdict) => {
    if (searchComplete) {
      searchComplete = false;
      incompleteStep = step;
      incompleteVerdict = verdict;
    }
  };

  // 1) License number — the stable identifier.
  //
  // SLICE 5B: this used to fetch up to 2,000 vendors and filter in JS. The
  // table holds 1,775 rows, PostgREST caps the response at 1,000, and
  // `.limit(2000)` cannot raise that cap — so ~775 vendors were invisible and
  // (with no .order()) which 775 was arbitrary. A miss then fell through to
  // step 5 and DUPLICATED an existing vendor.
  //
  // Fixed in two parts:
  //   (a) a targeted DB filter as a FAST PATH — the server finds the row
  //       instead of us downloading the table. `license_number` is free-form
  //       text (migration 0064, no normalizing constraint), so a single .eq()
  //       could miss "417-068"; we try the known formattings.
  //   (b) on a miss, a COMPLETE paged scan preserving the original digits-only
  //       JS comparison EXACTLY, so matching semantics never regress.
  if (licenseKey) {
    try {
      const candidates = licenseFilterCandidates(licenseKey);
      if (candidates.length) {
        const { data } = await admin
          .from("vendors")
          .select("id, license_number")
          .in("license_number", candidates)
          .limit(1);
        const row = (data as { id: string }[] | null)?.[0];
        if (row) return row.id;
      }

      // Fast path missed — scan every vendor that has a license, completely.
      const { rows, verdict } = await pagedAllChecked<{ id: string; license_number: string | null }>(
        async (from, to) => {
          const { data, error } = await admin
            .from("vendors")
            .select("id, license_number")
            .not("license_number", "is", null)
            // Stable UNIQUE ordering — REQUIRED for deterministic paging.
            .order("id", { ascending: true })
            .range(from, to);
          if (error) return { rows: [], ok: false };
          return {
            rows: (data as { id: string; license_number: string | null }[] | null) ?? [],
            ok: true,
          };
        },
        { maxRows: VENDOR_SCAN_MAX_ROWS },
      );
      const hit = rows.find((r) => normalizeLicense(r.license_number) === licenseKey);
      if (hit) return hit.id;
      if (!verdict.complete) noteIncomplete("license lookup", verdict);
    } catch (err) {
      console.error("[intake-store] vendor license lookup failed:", err);
      searchComplete = false;
      incompleteStep = incompleteStep ?? "license lookup";
    }
  }

  if (!cleanLabel) return null;

  // 2) Exact ilike on display_name (previous behavior).
  {
    const { data } = await admin
      .from("vendors")
      .select("id, display_name")
      .ilike("display_name", cleanLabel)
      .limit(1);
    const row = (data as { id: string }[] | null)?.[0];
    if (row) return row.id;
  }

  // 3) vendor_aliases by source_name (case-insensitive equality).
  try {
    const { data } = await admin
      .from("vendor_aliases")
      .select("vendor_id, source_name")
      .ilike("source_name", cleanLabel)
      .limit(1);
    const row = (data as { vendor_id: string }[] | null)?.[0];
    if (row) return row.vendor_id;
  } catch (err) {
    console.error("[intake-store] vendor alias lookup failed:", err);
  }

  // 4) Normalized-name scan (pure core decides; we just fetch candidates).
  //
  // SLICE 5B: same 1,775-vs-1,000 truncation as step 1 — this scan could not
  // see every vendor, so a name that DID exist was reported missing and step 5
  // duplicated it. Now paged completely. The rows are still sorted by
  // display_name before matching, because pickVendorByNormalizedName returns
  // the FIRST match and its callers pass rows in a stable order
  // (vendor-resolve-core.ts:66-67) — preserved exactly.
  try {
    const { rows: scanned, verdict } = await pagedAllChecked<VendorNameCandidate & { id: string }>(
      async (from, to) => {
        const { data, error } = await admin
          .from("vendors")
          .select("id, display_name, dba, legal_name")
          // Stable UNIQUE ordering — REQUIRED for deterministic paging.
          .order("id", { ascending: true })
          .range(from, to);
        if (error) return { rows: [], ok: false };
        return {
          rows: (data as (VendorNameCandidate & { id: string })[] | null) ?? [],
          ok: true,
        };
      },
      { maxRows: VENDOR_SCAN_MAX_ROWS },
    );
    const rows = [...scanned].sort((a, b) =>
      (a.display_name ?? "").localeCompare(b.display_name ?? ""),
    );
    const hit = pickVendorByNormalizedName(cleanLabel, rows);
    if (hit) return hit.id;
    if (!verdict.complete) noteIncomplete("normalized name scan", verdict);
  } catch (err) {
    console.error("[intake-store] vendor normalized scan failed:", err);
    searchComplete = false;
    incompleteStep = incompleteStep ?? "normalized name scan";
  }

  // SLICE 5B — the create guard. Steps 1–4 all missed. That is only a genuine
  // "this vendor does not exist" if every search READ EVERYTHING; otherwise
  // "not found" is merely unknown, and creating a row here is how an existing
  // vendor gets duplicated (splitting its lots, drafts and CCRS lineage).
  // Leaving vendor_id null is recoverable and visible; a duplicate is neither.
  {
    const decision = decideVendorCreate({
      searchComplete,
      incompleteStep,
      verdict: incompleteVerdict,
    });
    if (!decision.mayCreate) {
      console.error(`[intake-store] vendor auto-create SKIPPED: ${decision.message}`);
      return null;
    }
  }

  // 5) Auto-create a DRAFT vendor from the manifest header.
  try {
    // SLICE 66 (owner D1): the row is born CLEAN — a manifest header like
    // "CERES - 435011" becomes display_name "CERES", and the trailing digits
    // land in license_number when the document itself carried none. The
    // verbatim header is still preserved as the vendor_aliases source_name
    // below, so future manifests keep matching at step 3.
    const displayLabel = stripLicenseSuffix(cleanLabel) || cleanLabel;
    const labelLicense = licenseKey ?? normalizeLicense(extractLicenseFromLabel(cleanLabel));
    const baseSlug = vendorSlugCandidate(displayLabel) || "vendor";
    let slug = baseSlug;
    {
      const { data } = await admin.from("vendors").select("id").eq("slug", slug).limit(1);
      if (((data as { id: string }[] | null) ?? []).length > 0) {
        slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`.slice(0, 80);
      }
    }
    const { data: created, error } = await admin
      .from("vendors")
      .insert({
        display_name: displayLabel,
        slug,
        license_number: labelLicense,
        status: "draft",
        internal_notes:
          "Auto-created from an inbound manifest header (intake vendor resolution). Verify details, then publish when ready.",
        created_by: actorId,
        updated_by: actorId,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[intake-store] vendor auto-create failed:", error?.message);
      return null;
    }
    const vendorId = (created as { id: string }).id;
    // Alias so future manifests hit step 3 even if the display name is edited.
    // Best-effort: a duplicate alias (unique source_system+source_name) just
    // returns an error object — PostgREST never throws here.
    await admin
      .from("vendor_aliases")
      .insert({ vendor_id: vendorId, source_name: cleanLabel, source_system: "manifest" });
    return vendorId;
  } catch (err) {
    console.error("[intake-store] vendor auto-create threw:", err);
    return null;
  }
}

/** Try to match a brand label (optionally within a vendor). */
export async function resolveBrandId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string | null,
  vendorId: string | null,
): Promise<string | null> {
  if (!label) return null;
  let q = admin.from("brands").select("id, display_name, vendor_id").ilike("display_name", label).limit(1);
  if (vendorId) q = q.eq("vendor_id", vendorId);
  const { data } = await q;
  const row = (data as { id: string }[] | null)?.[0];
  return row?.id ?? null;
}

/**
 * Stage a parsed manifest as DRAFT rows. Returns the new manifest id.
 */
export async function stageManifest(
  parsed: ParsedManifest,
  rawPayload: unknown,
  actorId: string | null,
  meta?: { sourceUrl?: string | null },
): Promise<
  | { ok: true; manifestId: string }
  | { ok: false; error: string; duplicate?: true; existingManifestId?: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const vendorId = await resolveOrCreateVendor(
    admin,
    parsed.vendor_label,
    parsed.vendor_license,
    actorId,
  );

  // H16b-7 DEDUPE: prevent the SAME manifest entering the table twice (owner:
  // "if for what ever reason the vendor sends us the email twice or something, I
  // dont want to accidentally accept the manifest twice"). Identity = normalized
  // manifest_number + vendor. We query the rows that share this manifest_number
  // and let the PURE findBlockingDuplicate decide: a LIVE row (pending /
  // in_transit / accepted) with the same vendor blocks re-staging; a previously
  // REJECTED row does NOT (a corrected re-send is allowed). A manifest with no
  // number has no reliable identity and is never deduped (staging proceeds so we
  // never silently drop a real, distinct transfer).
  const identity = buildManifestIdentity({
    manifest_number: parsed.manifest_number,
    vendor_label: parsed.vendor_label,
  });
  if (identity) {
    const { data: dupRows } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, vendor_label, status")
      .eq("manifest_number", parsed.manifest_number)
      .limit(50);
    const existing = (dupRows as ExistingManifestRow[] | null) ?? [];
    const blockingId = findBlockingDuplicate(identity, existing);
    if (blockingId) {
      return {
        ok: false,
        duplicate: true,
        existingManifestId: blockingId,
        error: `Duplicate manifest ${parsed.manifest_number} from ${
          parsed.vendor_label ?? "this vendor"
        } is already in intake (manifest ${blockingId}); not staged again.`,
      };
    }
  }

  // Snapshot the COA references so they're preserved in our KB even if the
  // vendor's links later expire. De-duplicated by coa_url.
  const coaLinks = extractCoaLinks(parsed);

  // 1) manifest (pending)
  const { data: mData, error: mErr } = await admin
    .from("inbound_manifests")
    .insert({
      manifest_number: parsed.manifest_number,
      vendor_id: vendorId,
      vendor_label: parsed.vendor_label,
      transfer_date: parsed.transfer_date,
      raw_payload: rawPayload,
      source_url: meta?.sourceUrl ?? null,
      source_format: parsed.source_format,
      coa_links: coaLinks,
      status: "pending",
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (mErr || !mData) {
    return { ok: false, error: mErr?.message ?? "Failed to create manifest." };
  }
  const manifestId = (mData as { id: string }).id;

  // H15a: seed transport / ETA drafts when the parser lifted them from the
  // document (WCIA est_*/route/transporter, PDF Depart/Arrive, CCRS header).
  // Best-effort — never blocks staging.
  await seedTransportFromParsed(manifestId, parsed, actorId);

  // Dedupe lab_results within this manifest by external id (the WCIA file shares
  // one lab_result_id across multiple lots — items 17/18, 27/28 in the example).
  const labIdCache = new Map<string, string>();

  // 2) per line: lab_result (if any) + quarantine lot
  for (const line of parsed.lines) {
    let labId: string | null = null;
    if (line.lab) {
      const extId = line.lab.labtest_external_identifier;
      if (extId && labIdCache.has(extId)) {
        labId = labIdCache.get(extId)!;
      } else {
        const { data: lData } = await admin
          .from("lab_results")
          .insert({
            labtest_external_identifier: extId,
            lab_name: line.lab.lab_name,
            tested_on: line.lab.tested_on,
            thc_pct: line.lab.thc_pct,
            cbd_pct: line.lab.cbd_pct,
            thca_pct: line.lab.thca_pct,
            cbda_pct: line.lab.cbda_pct,
            total_thc_pct: line.lab.total_thc_pct,
            total_cbd_pct: line.lab.total_cbd_pct,
            total_cannabinoids_pct: line.lab.total_cannabinoids_pct,
            potency_json: line.lab.potency_json,
            terpenes_json: line.lab.terpenes_json,
            analytes_json: line.lab.analytes_json,
            passed: line.lab.passed,
            source:
              parsed.source_format === "wcia"
                ? "wcia-transfer"
                : parsed.source_format === "ccrs-csv"
                  ? "ccrs-manifest-csv"
                  : "vendor-json",
            coa_url: line.lab.coa_url,
            coa_release_date: line.lab.coa_release_date,
            coa_expire_date: line.lab.coa_expire_date,
            raw_payload: line.lab.raw,
            created_by: actorId,
            updated_by: actorId,
          })
          .select("id")
          .single();
        labId = (lData as { id: string } | null)?.id ?? null;
        if (extId && labId) labIdCache.set(extId, labId);
      }
    }

    const brandId = await resolveBrandId(admin, line.brand_name, vendorId);

    await admin.from("inventory_lots").insert({
      lot_code: line.lot_code,
      vendor_id: vendorId,
      brand_id: brandId,
      manifest_id: manifestId,
      lab_result_id: labId,
      pos_product_key: line.pos_product_key,
      // Canonical CCRS InventoryExternalIdentifier, assigned once and reused
      // across Inventory/LabTest/Sale/Transfer/Adjustment files (CCRS spec).
      ccrs_inventory_external_id: deriveInventoryExternalId({
        pos_product_key: line.pos_product_key,
        lot_code: line.lot_code,
      }),
      product_name: line.product_name,
      strain_name: line.strain_name,
      // Rule 1.4 (docs/data-governance.md): strain TYPE lives in its own box,
      // split from the strain name at the parser door (migration 0138).
      strain_type: line.strain_type,
      category: line.category,
      inventory_type: line.inventory_type,
      unit_weight: line.unit_weight,
      unit_weight_uom: line.unit_weight_uom,
      is_sample: line.is_sample,
      is_medical: line.is_medical,
      received_qty: line.received_qty,
      on_hand_qty: line.received_qty,
      unit: line.unit,
      unit_cost_minor_units: line.unit_cost_minor_units,
      expires_on: line.expires_on,
      // SLICE 18-0 — the compliance classification columns (migrations 0216 /
      // 0217) were added to inventory_lots but nothing on the receiving path
      // ever wrote them, so they were dead on every received lot. They are
      // carried here rather than derived: the parser always sets them null
      // (a WA manifest has no such field), and the real answer arrives later
      // from the Product Onboarding gate. Writing them explicitly means the
      // column is part of the row's shape from day one instead of appearing
      // only after somebody classifies, which keeps the "has anyone looked at
      // this?" query honest.
      low_thc_liquid: line.low_thc_liquid,
      unit_thc_mg: line.unit_thc_mg,
      otherwise_taken: line.otherwise_taken,
      units_per_package: line.units_per_package,
      status: "quarantine", // held until the manifest is accepted
      created_by: actorId,
      updated_by: actorId,
    });
  }

  return { ok: true, manifestId };
}

// S-11 (GAP M-8): the legacy acceptManifest() helper was DELETED. It activated
// every quarantined lot with NO compliance gate. The only activation path is
// finalizeManifestDispositions() below, which runs evaluateLotBatchActivation
// on every accepted lot (CCRS id + COA + passing lab result) and HOLDS dirty
// lots in quarantine.

/**
 * Reject the WHOLE manifest (refuse-at-dock).
 *
 * RESEARCH-GROUNDED (docs/ccrs-rejection-and-returns.md): refused product stays
 * on the truck and never enters our reported inventory. We therefore mark its
 * quarantine lots `rejected` (NOT `destroyed`) with a mandatory reason, and file
 * NOTHING with CCRS — the VENDOR corrects their own manifest via CCRS
 * Update/Delete. This intentionally no longer destroys product.
 */
export async function rejectManifest(
  manifestId: string,
  actorId: string | null,
  rejection?: { reasonCode: string; reasonText: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: lots } = await admin
    .from("inventory_lots")
    .select("id, status")
    .eq("manifest_id", manifestId);
  const rows = (lots as { id: string; status: string }[] | null) ?? [];
  let rejected = 0;
  for (const lot of rows) {
    // Only reject lots not already active/sold (don't claw back accepted stock).
    if (lot.status === "active" || lot.status === "sold_out") continue;
    await admin
      .from("inventory_lots")
      .update({
        status: "rejected",
        disposition: "rejected_at_dock",
        reject_reason_code: rejection?.reasonCode ?? null,
        reject_reason: rejection?.reasonText ?? "Whole manifest rejected at dock.",
        dispositioned_by: actorId,
        dispositioned_at: nowIso,
        updated_by: actorId,
      })
      .eq("id", lot.id);
    rejected += 1;
  }

  const { error } = await admin
    .from("inbound_manifests")
    .update({
      status: "rejected",
      rejected_at: nowIso,
      accepted_lot_count: 0,
      rejected_lot_count: rejected,
      updated_by: actorId,
    })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  await logManifestEvent(
    manifestId,
    "rejected",
    `Manifest rejected at dock (${rejection?.reasonText ?? "no reason given"}); ${rejected} lot(s) refused — never received. No CCRS filing; vendor to Update/Delete their manifest.`,
    actorId,
  );
  return { ok: true };
}

/**
 * Set a SINGLE lot's disposition (accepted | rejected_at_dock). Rejection needs
 * a normalized reason. This only records the decision; inventory side-effects
 * happen in finalizeManifestDispositions so accept/COA/drafts run once.
 */
export async function setLotDisposition(
  lotId: string,
  disposition: "accepted" | "rejected_at_dock",
  actorId: string | null,
  rejection?: { reasonCode: string; reasonText: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    disposition,
    dispositioned_by: actorId,
    dispositioned_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (disposition === "rejected_at_dock") {
    patch.reject_reason_code = rejection?.reasonCode ?? null;
    patch.reject_reason = rejection?.reasonText ?? null;
  } else {
    patch.reject_reason_code = null;
    patch.reject_reason = null;
  }
  const { error } = await admin.from("inventory_lots").update(patch).eq("id", lotId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * H16b Samples Slice B — PRE-FLIGHT incoming trade-sample cap check.
 *
 * WAC 314-55-096(1)(f)(ii): a processor may transfer no more than 120 sample
 * units per quarter to a given retailer. Slice A auto-records EVERY accepted
 * sample line as an incoming trade_sample_events row, so we cannot partially
 * accept sample lines through this flow — the only way to guarantee the cap is
 * never breached is to refuse the WHOLE finalize BEFORE anything activates when
 * accepting this manifest would push the vendor over 120 units this quarter.
 *
 * This mirrors EXACTLY what Slice A will seed, so the pre-flight and the ledger
 * never disagree:
 *   • only is_sample = true lots that are being ACCEPTED (disposition is not
 *     rejected_at_dock) count;
 *   • a "dirty" lot that the activation gate would HOLD in quarantine never goes
 *     live and Slice A never seeds it, so it does NOT count here either;
 *   • a line whose LCB type/name doesn't map to a lawful cannabis sample product
 *     (accessory/merch) is skipped (product_type null), matching Slice A;
 *   • a lot that ALREADY has an incoming event (idempotent re-finalize) is NOT
 *     re-counted, so re-running finalize on an already-accepted manifest never
 *     falsely blocks.
 *
 * The block honors the owner-tunable settings: it only hard-blocks when
 * `enforce && hardBlock` are on (evaluateCap.block). Warn-only mode never blocks.
 * A manifest with zero addable sample units is never blocked.
 *
 * Returns the cap evaluation (or null when there is nothing to check / Supabase
 * is not configured). `blocked` is true only when the finalize must be refused.
 */
export async function preflightManifestSampleCap(
  manifestId: string,
): Promise<{
  blocked: boolean;
  addUnits: number;
  message: string | null;
  /** H16b vendor-notice: numbers + identity the notice/email needs. Additive. */
  usedUnits: number;
  capUnits: number;
  processorName: string | null;
  quarterKey: string;
  vendorId: string | null;
} | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  // Supplying processor (vendor) + the quarter this accept would land in.
  const { data: m } = await admin
    .from("inbound_manifests")
    .select("vendor_id, vendor_label, accepted_at")
    .eq("id", manifestId)
    .maybeSingle();
  const processorName: string = ((m?.vendor_label as string | null) ?? "").trim();
  const vendorId = (m?.vendor_id as string | null) ?? null;
  // Quarter of the (pending) accept date: use the manifest's accepted_at if it
  // already has one (re-finalize), else today — the same rule Slice A uses.
  const acceptedIso = (m?.accepted_at as string | null) ?? new Date().toISOString();
  const quarterKey = quarterKeyFromYmd(acceptedIso.slice(0, 10));

  // Every sample line on this manifest, with the fields the activation gate and
  // the product-type mapper need. We look at ALL non-terminal lots (the ones a
  // finalize could still flip to active), not just those already active.
  const { data: lots } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, inventory_type, received_qty, is_sample, status, disposition, ccrs_inventory_external_id, lab_result_id, lab_results ( passed )",
    )
    .eq("manifest_id", manifestId)
    .eq("is_sample", true);
  type PreflightLotRow = {
    id: string;
    product_name: string | null;
    inventory_type: string | null;
    received_qty: number | null;
    is_sample: boolean;
    status: string;
    disposition: string | null;
    ccrs_inventory_external_id: string | null;
    lab_result_id: string | null;
    lab_results: { passed: boolean | null } | { passed: boolean | null }[] | null;
  };
  const rows = (lots as PreflightLotRow[] | null) ?? [];
  // Nothing addable → never blocked; identity fields carried for a uniform shape.
  const nothingToAdd = {
    blocked: false,
    addUnits: 0,
    message: null,
    usedUnits: 0,
    capUnits: 0,
    processorName: processorName || null,
    quarterKey,
    vendorId,
  };
  if (rows.length === 0) return nothingToAdd;

  // Only lines that will actually be ACCEPTED (not refused at dock).
  const accepting = rows.filter((r) => r.disposition !== "rejected_at_dock");
  if (accepting.length === 0) return nothingToAdd;

  // A dirty lot the activation gate would HOLD never goes live — exclude it, so
  // the pre-flight counts exactly what Slice A will seed (clean, activatable).
  const facts: LotGateFacts[] = accepting.map((r) => {
    const lab = Array.isArray(r.lab_results) ? r.lab_results[0] : r.lab_results;
    return {
      id: r.id,
      label: r.product_name || null,
      ccrsExternalId: r.ccrs_inventory_external_id,
      hasLabResult: r.lab_result_id != null,
      labPassed: lab ? lab.passed : null,
    };
  });
  const canActivate = new Map<string, boolean>();
  for (const v of evaluateLotBatchActivation(facts).verdicts) canActivate.set(v.lotId, v.canActivate);

  // Idempotency: lots that already have an incoming event were counted before —
  // never re-count them (re-finalize must not falsely block).
  const acceptIds = accepting.map((r) => r.id);
  const { data: existing } = await admin
    .from("trade_sample_events")
    .select("lot_id")
    .eq("direction", "incoming")
    .in("lot_id", acceptIds);
  const alreadySeeded = new Set(
    ((existing as { lot_id: string | null }[] | null) ?? [])
      .map((e) => e.lot_id)
      .filter((x): x is string => !!x),
  );

  // Reduce each accepting sample lot to the fields the PURE cap core needs, then
  // let the core do the deterministic summation + block decision (same rules the
  // Slice A ledger uses, so pre-flight and ledger can never disagree).
  const lines: IntakeSampleLine[] = accepting.map((lot) => ({
    receivedQty: Number(lot.received_qty) || 0,
    rejectedAtDock: false, // `accepting` already excludes rejected_at_dock
    canActivate: canActivate.get(lot.id) !== false,
    alreadyRecorded: alreadySeeded.has(lot.id),
    productType: sampleProductTypeForLine({
      productName: lot.product_name,
      inventoryType: lot.inventory_type,
    }),
  }));

  // Evaluate against the vendor's existing quarter usage + owner settings.
  const settings = await getSampleSettings();
  const usedUnits = await incomingUnitsForProcessor(processorName, quarterKey);
  const verdict = evaluateIntakeSampleCap({ lines, usedUnits, settings });
  return {
    blocked: verdict.blocked,
    addUnits: verdict.addUnits,
    message: verdict.message,
    usedUnits,
    capUnits: verdict.capUnits,
    processorName: processorName || null,
    quarterKey,
    vendorId,
  };
}

/**
 * H16b Samples vendor-notice: gather everything the processor-facing sample-cap
 * notice + its email need for a manifest whose finalize was refused by the
 * incoming cap. Reuses preflightManifestSampleCap (single source of truth for
 * the numbers) and looks up the vendor's email + the manifest number.
 *
 * Returns null when Supabase is not configured. `blocked` echoes the pre-flight
 * so the caller can refuse to send a notice for a manifest that would not
 * actually be over cap (defense against a stale banner / double click).
 */
export async function gatherSampleCapNotice(manifestId: string): Promise<
  | {
      blocked: boolean;
      vendorEmail: string | null;
      notice: SampleCapNoticeInput;
    }
  | null
> {
  if (!isSupabaseServiceConfigured) return null;
  const cap = await preflightManifestSampleCap(manifestId);
  if (!cap) return null;
  const admin = createSupabaseAdminClient();

  // Manifest number (vendor's reference) for the notice.
  const { data: m } = await admin
    .from("inbound_manifests")
    .select("manifest_number")
    .eq("id", manifestId)
    .maybeSingle();
  const manifestNumber = ((m?.manifest_number as string | null) ?? "").trim() || null;

  // Vendor email (owner-approved: TO the vendor when on file, else internal only).
  let vendorEmail: string | null = null;
  if (cap.vendorId) {
    const { data: v } = await admin
      .from("vendors")
      .select("email")
      .eq("id", cap.vendorId)
      .maybeSingle();
    vendorEmail = ((v?.email as string | null) ?? "").trim() || null;
  }

  return {
    blocked: cap.blocked,
    vendorEmail,
    notice: {
      processorName: cap.processorName,
      usedUnits: cap.usedUnits,
      capUnits: cap.capUnits,
      addUnits: cap.addUnits,
      quarterKey: cap.quarterKey,
      manifestNumber,
    },
  };
}

/**
 * Finalize a manifest after per-lot dispositions are set: activate ACCEPTED lots
 * (quarantine → active + a `receive` adjustment), leave REJECTED lots out of
 * inventory (status `rejected`, never destroyed), seed drafts + archive COAs for
 * the accepted set only, and stamp the manifest's derived status + counts
 * (accepted | rejected | partially_accepted).
 *
 * Any lot left `pending` is treated as ACCEPTED by default (an employee who
 * finalizes without explicitly rejecting a line is accepting it). Callers that
 * want stricter behavior can require all lots to be dispositioned first.
 *
 * H16b Samples Slice B: BEFORE any lot is activated, a pre-flight incoming
 * trade-sample cap check runs (preflightManifestSampleCap). If accepting this
 * manifest would push the supplying processor over the 120-unit/quarter cap AND
 * enforcement is on (enforce && hardBlock), the ENTIRE finalize is refused
 * (returns ok:false) so nothing activates and no sample event is recorded.
 */
export async function finalizeManifestDispositions(
  manifestId: string,
  actorId: string | null,
  opts?: {
    /**
     * SLICE 101 — the owner's rule: when the finalize is PARTIAL (some lines
     * refused at dock or held dirty in quarantine) a note explaining why is
     * MANDATORY for the audit trail. Validated BEFORE any lot is touched.
     */
    partialNote?: string | null;
  },
): Promise<
  | {
      ok: true;
      derivedStatus: "accepted" | "rejected" | "partially_accepted";
      activated: number;
      rejected: number;
      draftsCreated: number;
      /** Slice 107: accepted lots BLOCKED from going live because they were dirty. */
      blocked: LotGateVerdict[];
    }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // H17 — accept-time vendor repair. Manifests staged BEFORE the resolver
  // upgrade (or while the vendors table was missing the sender) carry
  // vendor_id NULL, so their lots → catalog drafts would get no vendor_name
  // and vendor-axis mastering couldn't group them. Re-run the full resolution
  // ladder now (license → name → alias → normalized → auto-create draft
  // vendor) and back-fill the manifest + its lots. Best-effort — a lookup
  // hiccup never blocks the finalize.
  try {
    const { data: mv } = await admin
      .from("inbound_manifests")
      .select("vendor_id, vendor_label")
      .eq("id", manifestId)
      .maybeSingle();
    const mvRow = mv as { vendor_id: string | null; vendor_label: string | null } | null;
    if (mvRow && !mvRow.vendor_id && (mvRow.vendor_label ?? "").trim()) {
      const repairedId = await resolveOrCreateVendor(admin, mvRow.vendor_label, null, actorId);
      if (repairedId) {
        await admin
          .from("inbound_manifests")
          .update({ vendor_id: repairedId, updated_by: actorId })
          .eq("id", manifestId);
        await admin
          .from("inventory_lots")
          .update({ vendor_id: repairedId, updated_by: actorId })
          .eq("manifest_id", manifestId)
          .is("vendor_id", null);
        await logManifestEvent(
          manifestId,
          "vendor_link",
          `Vendor linked at accept time: "${mvRow.vendor_label}" → vendors row ${repairedId} (was unlinked at staging).`,
          actorId,
        );
      }
    }
  } catch (err) {
    console.error("[intake-store] accept-time vendor repair failed:", err);
  }

  // H16b Samples Slice B: HARD-BLOCK the whole finalize BEFORE touching any lot
  // if accepting this manifest's sample lines would exceed the supplying
  // processor's 120-unit/quarter incoming cap (WAC 314-55-096(1)(f)(ii)).
  // Nothing activates and no sample event is recorded when this trips. A
  // best-effort guard failure never breaks a normal (non-sample) finalize.
  try {
    const capCheck = await preflightManifestSampleCap(manifestId);
    if (capCheck?.blocked) {
      await logManifestEvent(
        manifestId,
        "sample_cap_block",
        `Finalize refused: accepting would exceed the processor's quarterly sample cap. ${capCheck.message ?? ""}`.trim(),
        actorId,
      );
      return {
        ok: false,
        error: capCheck.message ?? "Blocked: this would exceed the processor's quarterly sample cap.",
      };
    }
  } catch (err) {
    console.error("[intake-store] preflightManifestSampleCap failed:", err);
  }

  // Slice 107: pull the compliance-critical fields so a "dirty" lot (no CCRS
  // identifier, no COA on record, or a FAILED lab result) can NEVER be flipped
  // to active/sellable. lab_results is joined for its pass/fail flag.
  const { data: lots } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, lot_code, received_qty, status, disposition, ccrs_inventory_external_id, lab_result_id, lab_results ( passed )",
    )
    .eq("manifest_id", manifestId);
  type LotRow = {
    id: string;
    product_name: string | null;
    lot_code: string | null;
    received_qty: number;
    status: string;
    disposition: string | null;
    ccrs_inventory_external_id: string | null;
    lab_result_id: string | null;
    lab_results: { passed: boolean | null } | { passed: boolean | null }[] | null;
  };
  const rows = (lots as LotRow[] | null) ?? [];

  // Evaluate every lot the reviewer is ACCEPTING against the activation gate.
  const gateByLotId = new Map<string, LotGateVerdict>();
  {
    const acceptedRows = rows.filter(
      (r) => (r.disposition === "rejected_at_dock" ? "rejected_at_dock" : "accepted") === "accepted",
    );
    const facts: LotGateFacts[] = acceptedRows.map((r) => {
      const lab = Array.isArray(r.lab_results) ? r.lab_results[0] : r.lab_results;
      return {
        id: r.id,
        label: r.product_name || r.lot_code || null,
        ccrsExternalId: r.ccrs_inventory_external_id,
        hasLabResult: r.lab_result_id != null,
        labPassed: lab ? lab.passed : null,
      };
    });
    for (const v of evaluateLotBatchActivation(facts).verdicts) gateByLotId.set(v.lotId, v);
  }
  const blocked: LotGateVerdict[] = [];
  let partialNote: string | null = null;

  // SLICE 101 — PREDICT the outcome from the same facts the loop below uses,
  // BEFORE any lot is touched: a partial finalize (mixed accept/refuse, or any
  // dirty lot held) requires the mandatory why-partial note. Failing validation
  // here leaves every lot and the manifest completely untouched.
  {
    let willActivate = 0;
    let willReject = 0;
    let willBlock = 0;
    for (const lot of rows) {
      const decided = lot.disposition === "rejected_at_dock" ? "rejected_at_dock" : "accepted";
      if (decided === "accepted") {
        const gate = gateByLotId.get(lot.id);
        if (gate && !gate.canActivate) willBlock += 1;
        else willActivate += 1;
      } else {
        willReject += 1;
      }
    }
    const predictedStatus = deriveManifestStatus(willActivate, willReject, willBlock);
    const noteCheck = normalizePartialNote(
      opts?.partialNote,
      predictedStatus === "partially_accepted",
    );
    if (!noteCheck.ok) return { ok: false, error: noteCheck.error };
    partialNote = noteCheck.note;
  }

  let activated = 0;
  let rejected = 0;
  // W6: lots flipped quarantine/pending → active IN THIS RUN. A lot leaves
  // quarantine exactly once, so auto-receiving only THESE ids keeps the linked
  // PO's received quantities idempotent across re-finalizes.
  const activatedLotIds: string[] = [];
  const rejectedLotIds: string[] = [];
  // SLICE 103 — the old loop awaited TWO round-trips PER LOT (update +
  // adjustment insert), so a 28-line manifest paid ~56 sequential database
  // trips before the follow-up chores even started (the owner: "the finalize
  // button takes a few minutes to process"). This pass only CLASSIFIES; the
  // identical-payload writes are batched below (one .in() update for the
  // activations, ONE bulk adjustments insert, one .in() update for the
  // rejections). Blocked lots keep per-lot updates because each carries its
  // own gate-reason note — and a blocked lot is the rare case.
  for (const lot of rows) {
    const decided = lot.disposition === "rejected_at_dock" ? "rejected_at_dock" : "accepted";
    if (decided === "accepted") {
      const gate = gateByLotId.get(lot.id);
      // HARD GATE (Slice 107): a dirty lot is held in quarantine, never activated.
      if (gate && !gate.canActivate) {
        blocked.push(gate);
        if (lot.status === "quarantine" || lot.status === "pending") {
          await admin
            .from("inventory_lots")
            .update({
              // Keep it OUT of sellable inventory. Record the accept intent but
              // do not change status to active.
              disposition: "accepted",
              updated_by: actorId,
              notes: `Held in quarantine — cannot go live: ${gate.reasons
                .map((r) => r.message)
                .join(" ")}`.slice(0, 2000),
            })
            .eq("id", lot.id);
        }
        continue;
      }
      // Only activate CLEAN lots that are still in quarantine (idempotent).
      if (lot.status === "quarantine" || lot.status === "pending") {
        activatedLotIds.push(lot.id);
      }
      activated += 1;
    } else {
      // Refused at dock: never received. Mark rejected; never destroy.
      if (lot.status !== "active" && lot.status !== "sold_out") {
        rejectedLotIds.push(lot.id);
      }
      rejected += 1;
    }
  }

  // SLICE 103 — batched writes: the payloads are identical per group, so one
  // .in() statement replaces N sequential .eq() statements, and the receive
  // adjustments land as a SINGLE bulk insert (per-lot qty preserved).
  if (activatedLotIds.length > 0) {
    const qtyByLot = new Map(rows.map((r) => [r.id, r.received_qty]));
    await admin
      .from("inventory_lots")
      .update({ status: "active", disposition: "accepted", updated_by: actorId })
      .in("id", activatedLotIds);
    await admin.from("inventory_adjustments").insert(
      activatedLotIds.map((lotId) => ({
        lot_id: lotId,
        qty_delta: qtyByLot.get(lotId) ?? 0,
        reason: "receive",
        note: "Accepted from vendor manifest intake (partial-accept flow).",
        actor_id: actorId,
      })),
    );
  }
  if (rejectedLotIds.length > 0) {
    await admin
      .from("inventory_lots")
      .update({ status: "rejected", dispositioned_at: nowIso, updated_by: actorId })
      .in("id", rejectedLotIds);
  }

  // derivedStatus reflects what actually happened. If lots were accepted but
  // HELD (blocked) while nothing cleanly activated or was refused, the manifest
  // is only "partially_accepted" (some product is stuck in quarantine awaiting a
  // fix) rather than being falsely stamped "rejected". SLICE 101: the shared
  // pure derivation (intake-disposition-core) — the SAME function the pre-flight
  // note check used above, so prediction and outcome can never disagree.
  const derivedStatus = deriveManifestStatus(activated, rejected, blocked.length);

  const { error } = await admin
    .from("inbound_manifests")
    .update({
      status: derivedStatus,
      accepted_at: activated > 0 ? nowIso : null,
      rejected_at: rejected > 0 ? nowIso : null,
      accepted_lot_count: activated,
      rejected_lot_count: rejected,
      updated_by: actorId,
      // SLICE 101 — the why-partial note also lives on the manifest row itself
      // (existing notes column, no migration); only written when present so a
      // clean accept never touches whatever notes the row already carries.
      ...(partialNote ? { notes: `Partial acceptance: ${partialNote}`.slice(0, 2000) } : {}),
    })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  const blockedNote =
    blocked.length > 0
      ? ` ${blocked.length} accepted lot(s) HELD in quarantine (cannot go live): ${blocked
          .map((v) => `${v.label ?? v.lotId} [${v.reasons.map((r) => r.code).join(",")}]`)
          .join("; ")}.`
      : "";
  // SLICE 101 — the mandatory why-partial note lands on the permanent timeline
  // (audit trail), attributed to the reviewer.
  const whyPartial = partialNote ? ` Why partial: ${partialNote}` : "";
  await logManifestEvent(
    manifestId,
    derivedStatus,
    `Finalized: ${activated} activated, ${rejected} refused at dock.${blockedNote}${whyPartial} Refused lots never entered inventory; no CCRS filing (vendor to Update/Delete their manifest).`,
    actorId,
  );

  // Seed drafts + archive COAs only when something was accepted. Best-effort.
  // Task AK: report VERIFIED draft writes (not attempts) and surface real
  // insert failures on the manifest timeline — the old code counted unmatched
  // lots as "drafts created" even while every insert silently failed.
  let draftsCreated = 0;
  if (activated > 0) {
    // SLICE 103 — these six follow-up chores are independent of each other
    // (they only depend on the lot activations above, which are already
    // committed): drafts, COA archive (network!), KB write-back, usual
    // transport, sample ledger, PO auto-receive. The old code awaited them
    // one after another, so the finalize's wall-clock time was the SUM of
    // all six — with the COA downloads alone able to take 20s per
    // certificate. Now they run CONCURRENTLY (Promise.allSettled): the
    // finalize takes as long as the slowest chore instead of all of them
    // stacked, and every chore keeps its own best-effort error isolation —
    // one failing never touches the others, exactly like before.
    const [draftsRes, coasRes, kbRes, transportRes, samplesRes, poRes] =
      await Promise.allSettled([
        seedDraftsForManifest(manifestId, actorId),
        archiveCoasForManifest(manifestId),
        promoteManifestToKb(manifestId, actorId),
        rememberVendorUsualTransport(manifestId, actorId),
        seedIncomingSampleEvents(manifestId, actorId),
        autoReceiveManifestPo(manifestId, activatedLotIds),
      ]);
    if (draftsRes.status === "fulfilled") {
      const match = draftsRes.value;
      draftsCreated = match.draftsCreated;
      if (match.draftsFailed > 0) {
        await logManifestEvent(
          manifestId,
          "draft_seed_error",
          `Onboarding draft creation FAILED for ${match.draftsFailed} product(s): ${
            match.firstError ?? "unknown error"
          }. These received products will NOT appear under Inventory → Product Onboarding until re-finalized successfully.`,
          actorId,
        );
      }
    } else {
      console.error("[intake-store] seedDraftsForManifest failed:", draftsRes.reason);
    }
    if (coasRes.status === "rejected") {
      console.error("[intake-store] archiveCoasForManifest failed:", coasRes.reason);
    }
    // Slice H11a: KB write-back (name/strain/category/vendor + COA potency)
    // as DRAFTS via the non-destructive merge. Best-effort.
    if (kbRes.status === "rejected") {
      console.error("[intake-store] promoteManifestToKb failed:", kbRes.reason);
    }
    // Slice H15e: remember this vendor's usual carrier/driver/vehicle.
    if (transportRes.status === "rejected") {
      console.error("[intake-store] rememberVendorUsualTransport failed:", transportRes.reason);
    }
    // H16b Samples Slice A: incoming trade-sample ledger (WAC 314-55-096).
    if (samplesRes.status === "rejected") {
      console.error("[intake-store] seedIncomingSampleEvents failed:", samplesRes.reason);
    }
    // W6: PO auto-receive for THIS run's activated lots (idempotent).
    if (poRes.status === "fulfilled") {
      if (poRes.value.attempted) {
        await logManifestEvent(manifestId, "po_auto_receive", poRes.value.note, actorId);
      }
    } else {
      console.error("[intake-store] autoReceiveManifestPo failed:", poRes.reason);
    }
    // Intake auto-carry + auto-publish (owner-approved Option 1): if this
    // manifest's products have already been APPROVED (priced) as onboarding
    // drafts, stage an intake-origin menu version (current live menu carried
    // forward + the new approved products) and publish it immediately — the
    // item-by-item human review already happened at draft approval. On a
    // publish hiccup the staged version lands on Menu Imports as the manual
    // fallback. No-op when there are no approved drafts yet (the usual case at
    // first finalize — the owner approves prices afterward and the approval
    // flow triggers this). Best-effort: a staging/publish hiccup must never
    // break intake finalization.
    try {
      const carry = await stageIntakeMenuVersionForManifest(manifestId, actorId);
      if (carry.staged) {
        const what = [
          carry.added > 0 ? `${carry.added} new product card(s)` : "",
          carry.merged > 0 ? `${carry.merged} restock/size option(s) merged into existing cards` : "",
        ]
          .filter(Boolean)
          .join(" and ");
        await logManifestEvent(
          manifestId,
          "menu_auto_carry",
          carry.published
            ? `Menu updated automatically: ${what} on top of ${carry.carried} live item(s) — live on the website + sellable at the register.`
            : `Staged a menu version for review: ${what} on top of ${carry.carried} live item(s). Publish it on Admin → Menu Imports to make them sellable on the website + POS.`,
          actorId,
        );
      }
    } catch (err) {
      console.error("[intake-store] stageIntakeMenuVersionForManifest failed:", err);
    }
  }

  return { ok: true, derivedStatus, activated, rejected, draftsCreated, blocked };
}

/**
 * H16b Samples Slice A — after a manifest is finalized, record every ACCEPTED
 * sample line as an INCOMING trade sample event (WAC 314-55-096). A sample line
 * is an inventory_lot with is_sample = true that is now `active` (accepted &
 * clean). Each becomes one trade_sample_events row:
 *   • direction     = 'incoming'
 *   • category      = 'trade' (a retailer's only sample category; IQC retired)
 *   • processor_name= the manifest's supplying vendor label
 *   • vendor_id     = the linked vendor (when known)
 *   • unit_count    = received_qty (the number of sample PACKAGES/units)
 *   • product_type  = mapped from the LCB inventory_type + name via the H16b-9
 *                     resolver (useable | concentrate | infused); lines that do
 *                     not map to a lawful cannabis sample product are skipped.
 *   • quarter_key   = the calendar quarter of the accept date
 *   • lot_id        = the source lot (also the IDEMPOTENCY key)
 *
 * DRAFTS-ONLY / SAFE: this writes to the sample LEDGER only; it does not touch
 * CCRS. It is idempotent — a lot that already has an incoming event is skipped —
 * so re-running finalize never double-counts. Slice A does NOT hard-block on the
 * 120/qtr cap; that enforcement is Slice B.
 */
export async function seedIncomingSampleEvents(
  manifestId: string,
  actorId: string | null,
): Promise<{ seeded: number; skipped: number }> {
  if (!isSupabaseServiceConfigured) return { seeded: 0, skipped: 0 };
  const admin = createSupabaseAdminClient();

  // Supplying processor (vendor) for the incoming rows.
  const { data: m } = await admin
    .from("inbound_manifests")
    .select("vendor_id, vendor_label, accepted_at")
    .eq("id", manifestId)
    .maybeSingle();
  const processorName: string | null = (m?.vendor_label as string | null) ?? null;
  const vendorId: string | null = (m?.vendor_id as string | null) ?? null;
  // Quarter is derived from the accept date (Pacific YMD slice of accepted_at),
  // falling back to today if the manifest has no accepted_at yet.
  const acceptedIso = (m?.accepted_at as string | null) ?? new Date().toISOString();
  const quarterKey = quarterKeyFromYmd(acceptedIso.slice(0, 10));

  // Only ACCEPTED (active) sample lots for this manifest.
  const { data: lots } = await admin
    .from("inventory_lots")
    .select("id, product_name, inventory_type, received_qty, is_sample, status")
    .eq("manifest_id", manifestId)
    .eq("is_sample", true)
    .eq("status", "active");
  type SampleLotRow = {
    id: string;
    product_name: string | null;
    inventory_type: string | null;
    received_qty: number | null;
    is_sample: boolean;
    status: string;
  };
  const rows = (lots as SampleLotRow[] | null) ?? [];
  if (rows.length === 0) return { seeded: 0, skipped: 0 };

  // Idempotency: which of these lots already have an incoming sample event?
  const lotIds = rows.map((r) => r.id);
  const { data: existing } = await admin
    .from("trade_sample_events")
    .select("lot_id")
    .eq("direction", "incoming")
    .in("lot_id", lotIds);
  const alreadySeeded = new Set(
    ((existing as { lot_id: string | null }[] | null) ?? [])
      .map((e) => e.lot_id)
      .filter((x): x is string => !!x),
  );

  let seeded = 0;
  let skipped = 0;
  for (const lot of rows) {
    if (alreadySeeded.has(lot.id)) {
      skipped += 1;
      continue;
    }
    const productType = sampleProductTypeForLine({
      productName: lot.product_name,
      inventoryType: lot.inventory_type,
    });
    // A line that isn't a lawful cannabis sample product (accessory/merch, or
    // an unmappable type) is not recorded to the sample ledger.
    if (!productType) {
      skipped += 1;
      continue;
    }
    const unitCount = Math.max(1, Math.trunc(Number(lot.received_qty) || 0));
    const { error } = await admin.from("trade_sample_events").insert({
      category: "trade",
      direction: "incoming",
      product_type: productType,
      unit_count: unitCount,
      quarter_key: quarterKey,
      processor_name: processorName,
      vendor_id: vendorId,
      lot_id: lot.id,
      from_sample_jar: false,
      note: "Auto-recorded from accepted vendor manifest sample line (H16b Slice A).",
      created_by: actorId,
    });
    if (error) {
      console.error("[intake-store] seedIncomingSampleEvents insert failed:", error.message);
      skipped += 1;
      continue;
    }
    seeded += 1;
  }
  return { seeded, skipped };
}

/**
 * Slice H15e — write an accepted manifest's carrier/driver/vehicle back to the
 * linked vendor as their "usual transport" (vendors.usual_transport, migration
 * 0100), merged so a field this manifest left blank keeps the previously-known
 * value. Per-shipment facts (departed/arrived/eta/route) are never remembered.
 * Best-effort by contract: callers wrap in try/catch; a missing column (0100
 * not applied yet) or a missing vendor link just logs a timeline note-free
 * no-op and must never break intake finalization.
 */
export async function rememberVendorUsualTransport(
  manifestId: string,
  actorId: string | null,
): Promise<{ remembered: boolean }> {
  if (!isSupabaseServiceConfigured) return { remembered: false };
  const admin = createSupabaseAdminClient();

  const { data: m } = await admin
    .from("inbound_manifests")
    .select(
      "vendor_id, vendor_label, transporter_name, transporter_license, driver_name, driver_license_number, vehicle_description, vehicle_plate, vehicle_vin",
    )
    .eq("id", manifestId)
    .maybeSingle();
  if (!m || !m.vendor_id) return { remembered: false };

  const incoming = usualTransportFromManifest(m);
  if (!incoming) return { remembered: false }; // nothing rememberable recorded

  const { data: v, error: vErr } = await admin
    .from("vendors")
    .select("usual_transport")
    .eq("id", m.vendor_id)
    .maybeSingle();
  // Column missing (migration 0100 not applied) or vendor gone: quiet no-op.
  if (vErr || !v) return { remembered: false };

  const merged = mergeUsualTransport(parseUsualTransport(v.usual_transport), incoming);
  const { error } = await admin
    .from("vendors")
    .update({
      usual_transport: merged,
      usual_transport_updated_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq("id", m.vendor_id);
  if (error) return { remembered: false };

  await logManifestEvent(
    manifestId,
    "note",
    `Saved this delivery's carrier/driver/vehicle to ${m.vendor_label ?? "the vendor"}'s profile as their usual transport — it will be pre-suggested on their next manifest.`,
    actorId,
  );
  return { remembered: true };
}

/** Lots tied to a manifest, for the review screen. */
export async function listManifestLots(manifestId: string) {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      // SLICE 39: + unit_cost_minor_units for the intake review summary
      // (honest "confirm pricing" flags instead of a hardcoded null).
      // SLICE 18-0: + otherwise_taken so the review summary can tell "nobody
      // has classified this suppository yet" apart from "somebody already
      // answered". Without it the dock would nag about every lot forever,
      // which is how a compliance checklist becomes noise people scroll past.
      "id, product_name, lot_code, received_qty, unit, pos_product_key, lab_result_id, status, expires_on, is_sample, strain_name, strain_type, category, inventory_type, disposition, reject_reason, reject_reason_code, unit_cost_minor_units, otherwise_taken",
    )
    .eq("manifest_id", manifestId)
    .order("product_name", { ascending: true });
  return (
    (data as
      | {
          id: string;
          product_name: string | null;
          lot_code: string | null;
          received_qty: number;
          unit: string;
          pos_product_key: string | null;
          lab_result_id: string | null;
          status: string;
          expires_on: string | null;
          is_sample: boolean;
          strain_name: string | null;
          strain_type: string | null;
          // RAW LCB/CCRS classification as stored (untouched — for display/resolve only).
          category: string | null;
          inventory_type: string | null;
          disposition: string | null;
          reject_reason: string | null;
          reject_reason_code: string | null;
          unit_cost_minor_units: number | null;
          // SLICE 18-0: the human's answer to "is this taken otherwise into the
          // body?" — or null when nobody has been asked yet. The review summary
          // treats null as "still needs classifying" and a real boolean as
          // "answered, stop nagging". Keep it nullable: collapsing null into
          // false would silently mark every unasked lot as ordinary.
          otherwise_taken: boolean | null;
        }[]
      | null) ?? []
  );
}

/**
 * SLICE 39: lab facts for the manifest review page's intake-review summary
 * (COA / failed-lab detection per staged lot). Only the columns the pure
 * adapter (intake-review-adapter.ts) needs. Read-only.
 */
export async function listLabFactsByIds(
  labIds: readonly string[],
): Promise<
  Map<
    string,
    {
      id: string;
      labtest_external_identifier: string | null;
      coa_url: string | null;
      thc_pct: number | null;
      total_thc_pct: number | null;
      cbd_pct: number | null;
      total_cbd_pct: number | null;
      potency_json: Record<string, number> | null;
      passed: boolean | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      id: string;
      labtest_external_identifier: string | null;
      coa_url: string | null;
      thc_pct: number | null;
      total_thc_pct: number | null;
      cbd_pct: number | null;
      total_cbd_pct: number | null;
      potency_json: Record<string, number> | null;
      passed: boolean | null;
    }
  >();
  if (!isSupabaseServiceConfigured || labIds.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const rows = await chunkedIn(labIds, async (chunk, from, to) => {
    const { data } = await admin
      .from("lab_results")
      .select(
        "id, labtest_external_identifier, coa_url, thc_pct, total_thc_pct, cbd_pct, total_cbd_pct, potency_json, passed",
      )
      .in("id", chunk as string[])
      .range(from, to);
    return (
      (data as
        | {
            id: string;
            labtest_external_identifier: string | null;
            coa_url: string | null;
            thc_pct: number | null;
            total_thc_pct: number | null;
            cbd_pct: number | null;
            total_cbd_pct: number | null;
            potency_json: Record<string, number> | null;
            passed: boolean | null;
          }[]
        | null) ?? []
    );
  });
  for (const r of rows) out.set(r.id, r);
  return out;
}

/**
 * Every lot line across ALL manifests, joined to its manifest number/vendor and
 * lab COA fields, for the intake Excel export (Slice 82 — "every field"). This
 * is a read-only reporting query; it is NOT paginated because the export is a
 * point-in-time snapshot the owner reconciles against CCRS.
 */
export type ManifestLotExportRow = {
  manifest_id: string | null;
  manifest_number: string | null;
  vendor_label: string | null;
  lot_id: string;
  product_name: string | null;
  strain_name: string | null;
  lot_code: string | null;
  category: string | null;
  inventory_type: string | null;
  pos_product_key: string | null;
  received_qty: number;
  on_hand_qty: number;
  unit: string;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  unit_cost_minor_units: number | null;
  is_sample: boolean;
  is_medical: boolean;
  status: string;
  disposition: string | null;
  reject_reason_code: string | null;
  reject_reason: string | null;
  expires_on: string | null;
  lab_result_id: string | null;
  created_at: string;
};

export async function listAllManifestLotsForExport(
  limit = 5000,
): Promise<ManifestLotExportRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      "id, manifest_id, product_name, strain_name, lot_code, category, inventory_type, pos_product_key, received_qty, on_hand_qty, unit, unit_weight, unit_weight_uom, unit_cost_minor_units, is_sample, is_medical, status, disposition, reject_reason, reject_reason_code, expires_on, lab_result_id, created_at, inbound_manifests(manifest_number, vendor_label)",
    )
    .not("manifest_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows =
    (data as
      | (Record<string, unknown> & {
          inbound_manifests?: { manifest_number: string | null; vendor_label: string | null } | null;
        })[]
      | null) ?? [];
  return rows.map((r) => ({
    manifest_id: (r.manifest_id as string | null) ?? null,
    manifest_number: r.inbound_manifests?.manifest_number ?? null,
    vendor_label: r.inbound_manifests?.vendor_label ?? null,
    lot_id: r.id as string,
    product_name: (r.product_name as string | null) ?? null,
    strain_name: (r.strain_name as string | null) ?? null,
    lot_code: (r.lot_code as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    inventory_type: (r.inventory_type as string | null) ?? null,
    pos_product_key: (r.pos_product_key as string | null) ?? null,
    received_qty: (r.received_qty as number) ?? 0,
    on_hand_qty: (r.on_hand_qty as number) ?? 0,
    unit: (r.unit as string) ?? "",
    unit_weight: (r.unit_weight as number | null) ?? null,
    unit_weight_uom: (r.unit_weight_uom as string | null) ?? null,
    unit_cost_minor_units: (r.unit_cost_minor_units as number | null) ?? null,
    is_sample: Boolean(r.is_sample),
    is_medical: Boolean(r.is_medical),
    status: (r.status as string) ?? "",
    disposition: (r.disposition as string | null) ?? null,
    reject_reason_code: (r.reject_reason_code as string | null) ?? null,
    reject_reason: (r.reject_reason as string | null) ?? null,
    expires_on: (r.expires_on as string | null) ?? null,
    lab_result_id: (r.lab_result_id as string | null) ?? null,
    created_at: (r.created_at as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Manifest lifecycle (Slice 18) — Cultivera-style status timeline.
//
// Vendors generate a manifest; the owner wants to watch it move:
//   pending → in_transit → received → accepted | rejected
// accept/reject keep their existing inventory side-effects (above); these
// helpers handle the interim states + a manifest_events timeline. Setting a
// status is idempotent-ish: it stamps the matching timestamp and logs an event.
// ---------------------------------------------------------------------------

export type ManifestLifecycleStatus =
  | "pending"
  | "in_transit"
  | "received"
  | "accepted"
  | "rejected";

const LIFECYCLE_TIMESTAMP: Partial<Record<ManifestLifecycleStatus, string>> = {
  in_transit: "in_transit_at",
  received: "received_at",
  accepted: "accepted_at",
  rejected: "rejected_at",
};

/** Record a manifest_events row (best-effort timeline). */
export async function logManifestEvent(
  manifestId: string,
  eventType: string,
  note: string | null,
  actorId: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("manifest_events").insert({
      manifest_id: manifestId,
      event_type: eventType,
      note,
      actor_id: actorId,
    });
  } catch (err) {
    console.error("[intake-store] logManifestEvent failed:", err);
  }
}

/**
 * Move a manifest to an interim lifecycle state (in_transit or received).
 * Does NOT touch inventory lots — that happens on accept/reject. Stamps the
 * matching timestamp and logs a timeline event.
 */
export async function setManifestLifecycle(
  manifestId: string,
  status: "in_transit" | "received",
  actorId: string | null,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  const tsCol = LIFECYCLE_TIMESTAMP[status];
  if (tsCol) patch[tsCol] = new Date().toISOString();

  const { error } = await admin.from("inbound_manifests").update(patch).eq("id", manifestId);
  if (error) return { ok: false, error: error.message };
  await logManifestEvent(manifestId, status, note ?? null, actorId);
  return { ok: true };
}

/**
 * Save transport / chain-of-custody details (Slice 33). Only the editable
 * transport fields are touched; stamps who recorded them and logs a timeline
 * event so the chain of custody is auditable. Empty strings are normalised to
 * null so the form can clear a value.
 */
export async function updateManifestTransport(
  manifestId: string,
  input: ManifestTransportInput,
  actorId: string | null,
  noteOverride?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const clean = (v: string | null): string | null => {
    const t = (v ?? "").trim();
    return t.length === 0 ? null : t;
  };
  const cleanTs = (v: string | null): string | null => {
    const t = (v ?? "").trim();
    if (t.length === 0) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const admin = createSupabaseAdminClient();
  const patch = {
    transporter_name: clean(input.transporter_name),
    transporter_license: clean(input.transporter_license),
    driver_name: clean(input.driver_name),
    driver_license_number: clean(input.driver_license_number),
    vehicle_description: clean(input.vehicle_description),
    vehicle_plate: clean(input.vehicle_plate),
    vehicle_vin: clean(input.vehicle_vin),
    departed_at: cleanTs(input.departed_at),
    arrived_at: cleanTs(input.arrived_at),
    route_notes: clean(input.route_notes),
    eta_date: normalizeEtaInput(input.eta_date),
    transport_recorded_by: actorId,
    transport_recorded_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const { error } = await admin
    .from("inbound_manifests")
    .update(patch)
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  const who = patch.driver_name ?? patch.transporter_name ?? "transport";
  await logManifestEvent(
    manifestId,
    "transport",
    noteOverride ?? `Transport details recorded (${who}).`,
    actorId,
  );
  return { ok: true };
}

/**
 * Set (or clear) the owner's Invoice/Order # correction for one manifest
 * (migration 0151). Additive-only: it writes ONLY the invoice_number_override
 * column and never touches classification, line items, or lifecycle. A blank
 * value clears the override so the intake UI reverts to the derived value.
 * Audited via manifest_events. Scoped to a single manifestId.
 */
export async function setManifestInvoiceOverride(
  manifestId: string,
  value: string | null,
  actorId: string | null,
): Promise<{ ok: true; cleared: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const trimmed = (value ?? "").trim();
  const next = trimmed.length === 0 ? null : trimmed;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inbound_manifests")
    .update({ invoice_number_override: next, updated_by: actorId })
    .eq("id", manifestId);
  if (error) return { ok: false, error: error.message };

  await logManifestEvent(
    manifestId,
    "invoice_number_override",
    next ? `Invoice # corrected to "${next}".` : "Invoice # correction cleared.",
    actorId,
  );
  return { ok: true, cleared: next === null };
}

/**
 * H15a — seed transport / ETA drafts from the parsed document at staging time.
 * Best-effort: skips silently when the parser found nothing; never fails the
 * stage (staging already succeeded — transport is enrichment, not a gate).
 * Uses updateManifestTransport so the same normalisation + audit-trail path
 * applies whether a human or the parser recorded the details.
 */
export async function seedTransportFromParsed(
  manifestId: string,
  parsed: ParsedManifest,
  actorId: string | null,
): Promise<void> {
  const t = parsed.transport;
  if (!transportHasData(t)) return;
  try {
    await updateManifestTransport(
      manifestId,
      {
        transporter_name: t.transporter_name,
        transporter_license: t.transporter_license,
        driver_name: t.driver_name,
        driver_license_number: t.driver_license_number,
        vehicle_description: t.vehicle_description,
        vehicle_plate: t.vehicle_plate,
        vehicle_vin: t.vehicle_vin,
        departed_at: t.departed_at,
        arrived_at: t.arrived_at,
        route_notes: t.route_notes,
        eta_date: t.eta_date,
      },
      actorId,
      `Transport details auto-filled from the ${parsed.source_format} document (draft — verify during review).`,
    );
  } catch {
    // best-effort: a transport-seed failure must never break staging
  }
}

/**
 * H18 — TRANSPORT BACKFILL for an ALREADY-staged manifest (fill-only-empty).
 *
 * WHY: the H16b-7 dedupe rightly refuses to stage the same manifest twice, but
 * it used to discard the re-send entirely — so a manifest whose transport
 * seeded empty (the SPR case: the enricher didn't fetch the manifest PDF the
 * first time) could never be repaired by re-forwarding the vendor email. This
 * reads the existing row's transport columns, lets the PURE
 * planTransportBackfill decide which EMPTY fields the newly parsed document can
 * fill (existing values are never overwritten; arrived_at never doc-sourced),
 * and writes only when something would change. Logs a "transport" event naming
 * the filled fields so the review screen's audit trail shows the repair.
 * Best-effort: returns 0 on any failure, never throws.
 */
export async function backfillManifestTransport(
  manifestId: string,
  incoming: ParsedTransport | null | undefined,
  actorId: string | null,
  sourceLabel: string,
): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  if (!transportHasData(incoming)) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("inbound_manifests")
      .select(
        "transporter_name, transporter_license, driver_name, driver_license_number, vehicle_description, vehicle_plate, vehicle_vin, departed_at, arrived_at, route_notes, eta_date",
      )
      .eq("id", manifestId)
      .maybeSingle();
    if (!data) return 0;
    const existing = data as Partial<Record<keyof ParsedTransport, string | null>>;
    const plan = planTransportBackfill(existing, incoming);
    if (!plan) return 0;

    const merged: ManifestTransportInput = {
      transporter_name: existing.transporter_name ?? null,
      transporter_license: existing.transporter_license ?? null,
      driver_name: existing.driver_name ?? null,
      driver_license_number: existing.driver_license_number ?? null,
      vehicle_description: existing.vehicle_description ?? null,
      vehicle_plate: existing.vehicle_plate ?? null,
      vehicle_vin: existing.vehicle_vin ?? null,
      departed_at: existing.departed_at ?? null,
      arrived_at: existing.arrived_at ?? null,
      route_notes: existing.route_notes ?? null,
      eta_date: existing.eta_date ?? null,
      ...plan.patch,
    };
    const res = await updateManifestTransport(
      manifestId,
      merged,
      actorId,
      `Transport details backfilled from ${sourceLabel}: ${plan.filledFields.join(", ")} (existing values kept; verify during review).`,
    );
    return res.ok ? plan.filledFields.length : 0;
  } catch (err) {
    console.error("[intake-store] transport backfill failed:", err);
    return 0;
  }
}

/** The lifecycle timeline for a manifest, oldest first. */
export async function listManifestEvents(manifestId: string) {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("manifest_events")
    .select("id, event_type, note, created_at")
    .eq("manifest_id", manifestId)
    .order("created_at", { ascending: true });
  return (
    (data as { id: string; event_type: string; note: string | null; created_at: string }[] | null) ?? []
  );
}
