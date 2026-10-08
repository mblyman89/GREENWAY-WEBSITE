"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { runImport, publishMenuVersion, findDuplicateImport, sha256, cleanSlateTestData, backfillImportLots, fillImportLotFacts } from "@/lib/pos/import-service";
import {
  getPublishedVersion,
  diffVersions,
  archiveSupersededStaged,
  getImportDiagnosticsChecked,
  listVersions,
  getVersionItems,
} from "@/lib/pos/menu-version";
import { recordFactReview, listFactReviews, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { removalRefusedCopy } from "@/lib/pos/publish-guard-core";
import { can } from "@/lib/auth/roles";
import { parseAcknowledgedCount } from "@/lib/pos/import-commit-core";
import {
  PUBLISH_NOW_NOT_ALLOWED_COPY,
  PUBLISH_NOW_NOT_TICKED_COPY,
  PUBLISHED_WITH_OPEN_REVIEWS_AUDIT,
} from "@/lib/pos/publish-now-core";
import {
  decideHandPublish,
  readCutoverDone,
  readHeldBeforeRelease,
  rebuildDelivery,
  releaseHeldAfterCutover,
  readCultiveraBlocker,
  readCutoverStatus,
} from "@/lib/pos/cutover-guard";
import {
  CUTOVER_PUBLISH_REFUSED_COPY,
  CUTOVER_REUPLOAD_REFUSED_COPY,
  CUTOVER_STILL_BLOCKED_COPY,
  rebuildNote,
  refuseUpload,
} from "@/lib/inventory/cutover-guard-core";
import {
  parseLowThcClassification,
  parseOtherwiseTakenClassification,
  buildFactReviewBuckets,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
  type FactReviewFacts,
} from "@/lib/pos/fact-review-core";
import {
  groupPendingReviews,
  planBulkDecision,
  bulkDecisionNote,
  type FactReviewGroup,
} from "@/lib/pos/fact-review-bulk-core";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { getOverrideForKey, upsertOverride } from "@/lib/pos/product-classification-overrides";
import { isValidWebsiteCategory } from "@/lib/menu/menu-category-override-core";
import {
  parseTypeCheckRefile,
  typeCheckReturnHref,
  TYPE_CHECK_REFILE_AUDIT,
} from "@/lib/pos/cultivera-type-from-category-core";
import { parseFactFocus, savedRedirectSuffix } from "@/lib/pos/fact-review-focus-core";

const PRODUCTS_HINT = "PRODUCTS.xlsx";
const INVENTORIES_HINT = "INVENTORIES.xlsx";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB safety cap per file

function looksLikeXlsx(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

/**
 * Upload PRODUCTS.xlsx + INVENTORIES.xlsx, run the transform, and stage a new
 * menu version. Redirects to the review screen for that import.
 */
export async function uploadAndStageImport(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");

  // Validate inputs. These redirect() calls throw NEXT_REDIRECT internally,
  // which is expected control flow — they are intentionally outside the
  // try/catch below so Next.js can perform the redirect.
  const productsFile = formData.get("products");
  const inventoriesFile = formData.get("inventories");

  if (!(productsFile instanceof File) || !(inventoriesFile instanceof File)) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Both PRODUCTS and INVENTORIES files are required."));
  }
  if (productsFile.size === 0 || inventoriesFile.size === 0) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("One of the uploaded files is empty. Re-export from your POS and try again."));
  }
  if (productsFile.size > MAX_BYTES || inventoriesFile.size > MAX_BYTES) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("A file exceeds the 25 MB limit."));
  }
  if (!looksLikeXlsx(productsFile) || !looksLikeXlsx(inventoriesFile)) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Both files must be .xlsx spreadsheets. (Tip: don't rename a .csv to .xlsx — export the real Excel file.)"));
  }

  // Everything from reading the buffers onward is wrapped so ANY failure
  // surfaces as a friendly message on the imports page rather than the
  // full-page "did not load correctly" error screen.
  let importId: string;
  try {
    const productsBuffer = Buffer.from(await productsFile.arrayBuffer());
    const inventoriesBuffer = Buffer.from(await inventoriesFile.arrayBuffer());

    // Friendly guard: if these exact two files were already imported, warn but
    // allow re-import (POS can re-export identical files; the manager decides).
    const dup = await findDuplicateImport(sha256(productsBuffer), sha256(inventoriesBuffer));

    const isTest = String(formData.get("test_mode") ?? "") === "on";

    // S18 one-time guard (bible 7.4 "Do not run the Cultivera import a second
    // time after cutover"): once a real Cultivera menu went live AND receiving
    // published on top of it, a second REAL upload would replace the menu with
    // an old POS export. Test-mode rehearsals stay allowed. Flag-gated, and a
    // failed read never refuses (readCutoverDone returns false).
    if (refuseUpload(isTest, await readCutoverDone())) {
      throw new Error(CUTOVER_REUPLOAD_REFUSED_COPY);
    }

    const result = await runImport({
      productsBuffer,
      inventoriesBuffer,
      productsFilename: productsFile.name || PRODUCTS_HINT,
      inventoriesFilename: inventoriesFile.name || INVENTORIES_HINT,
      uploadedBy: session.userId,
      isTest,
    });
    importId = result.import.id;

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.staged",
      entityType: "pos_import",
      entityId: importId,
      after: {
        items: result.version.item_count,
        variants: result.version.variant_count,
        vendors: result.version.vendor_count,
        errors: result.transform.diagnosticCounts.errors,
        warnings: result.transform.diagnosticCounts.warnings,
        duplicateOf: dup?.id ?? null,
        isTest,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed. Please re-check your files and try again.";
    console.error("[menu-imports] upload/stage failed:", err);
    redirect("/admin/menu-imports?error=" + encodeURIComponent(message));
  }

  revalidatePath("/admin/menu-imports");
  redirect(`/admin/menu-imports/${importId}?staged=1`);
}

/** Admin surfaces a publish can return to (never redirect to arbitrary input). */
function publishReturnBase(from: string, importId: string): string {
  if (from === "publish") return "/admin/publish";
  if (from === "publish-draft") return "/admin/publish"; // detail redirects to the center on success/error
  return importId ? `/admin/menu-imports/${importId}` : "/admin/menu-imports";
}

/** Publish a staged menu version (manager approval). */
export async function publishVersion(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const versionId = String(formData.get("versionId") ?? "");
  const importId = String(formData.get("importId") ?? "");
  const from = String(formData.get("from") ?? "");
  const dest = publishReturnBase(from, importId);
  if (!versionId) {
    redirect(dest + "?error=" + encodeURIComponent("Missing version id."));
  }

  // S18 cutover guard (flag INTAKE_CUTOVER_GUARD; one pure verdict,
  // cutover-guard-core decidePublish). Fail-open: an unknown read allows.
  //   refuse  - a real Cultivera upload is staged and this is not it;
  //   rebuild - this is a receiving update held for cutover: it was built
  //             before Cultivera went live, so it is never published itself;
  //             its delivery is rebuilt on the live menu instead;
  //   allow   - as before; release=true when this IS the Cultivera upload.
  // Decided BEFORE the removal gate: a held snapshot predates Cultivera, so
  // the gate would ask to "take off" the Cultivera products - a question
  // whose right answer is never yes.
  const decision = await decideHandPublish(versionId);
  if (decision.kind === "refuse") {
    redirect(dest + "?error=" + encodeURIComponent(CUTOVER_PUBLISH_REFUSED_COPY));
  }
  if (decision.kind === "rebuild") {
    const outcome = await rebuildDelivery(decision.manifestId, [versionId], session.userId);
    const note = rebuildNote(outcome);
    revalidatePath("/admin/menu-imports");
    revalidatePath("/admin/publish");
    redirect(dest + (note.ok ? "?published=1&notice=" : "?notice=") + encodeURIComponent(note.text));
  }
  const release = decision.kind === "allow" && decision.release;
  // Read the waiting receiving updates BEFORE the publish: the RPC archives
  // the ones created before the Cultivera upload.
  const held = release ? await readHeldBeforeRelease() : null;

  // SLICE 76 safety gate (copy softened in S16, logic unchanged): publishing
  // makes this update the live menu. If it would take off products that are live right now,
  // refuse unless the manager explicitly ticked the removal confirmation.
  // (This is what let an old 3-item draft silently wipe an 18-item menu.)
  try {
    const published = await getPublishedVersion();
    if (published && published.id !== versionId) {
      const diff = await diffVersions(versionId, published.id);
      const confirmed = String(formData.get("confirm_removals") ?? "") === "yes";
      if (diff.removed.length > 0 && !confirmed) {
        redirect(
          dest +
            "?error=" +
            encodeURIComponent(
              removalRefusedCopy(diff.removed.length),
            ),
        );
      }
    }
  } catch (err) {
    // redirect() throws NEXT_REDIRECT — rethrow it; only swallow real diff errors.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[menu-imports] publish removal guard diff failed:", err);
  }

  // R14a: "publish now, fix after". The form sends publish_now=yes plus the
  // pending count the owner SAW; the gate honours it only over pending review
  // rows and only when the fresh count is no larger (import-commit-core
  // acknowledgementCovers). Owner/admin only (menu.publish.open_reviews).
  let acknowledgedPendingCount: number | null = null;
  if (String(formData.get("publish_now") ?? "") === "yes") {
    if (!can(session.profile.role, "menu.publish.open_reviews")) {
      redirect(dest + "?error=" + encodeURIComponent(PUBLISH_NOW_NOT_ALLOWED_COPY));
    }
    acknowledgedPendingCount = parseAcknowledgedCount(String(formData.get("seen_pending") ?? ""));
    if (acknowledgedPendingCount === null) {
      redirect(dest + "?error=" + encodeURIComponent(PUBLISH_NOW_NOT_TICKED_COPY));
    }
  } else if (String(formData.get("publish_now_offered") ?? "") === "yes") {
    // The publish-now form was shown and the box was left unticked.
    redirect(dest + "?error=" + encodeURIComponent(PUBLISH_NOW_NOT_TICKED_COPY));
  }

  let openReviewsAcknowledged = 0;
  try {
    const outcome = await publishMenuVersion(versionId, session.userId, { acknowledgedPendingCount });
    openReviewsAcknowledged = outcome?.openReviewsAcknowledged ?? 0;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "menu_version.published",
      entityType: "menu_version",
      entityId: versionId,
    });
    if (openReviewsAcknowledged > 0) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: PUBLISHED_WITH_OPEN_REVIEWS_AUDIT,
        entityType: "menu_version",
        entityId: versionId,
        after: { importId, openReviews: openReviewsAcknowledged, seenWhenTicked: acknowledgedPendingCount },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed.";
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  // S15 housekeeping: the ONE archival rule. With this snapshot live, every
  // staged version of ANY origin created before it is a landmine (publishing
  // one would drop newer products), so it is archived with a reason. Same
  // rule as migration 0236; a zero-write no-op once 0236 is applied.
  await archiveSupersededStaged({ id: versionId });

  // S18 release: Cultivera is live, so every delivery that waited is rebuilt
  // on top of it and publishes itself. If ANOTHER real upload is still staged
  // (a newer one), the rebuilds would only be held again, so say so instead.
  let notice = "";
  if (held && (held.manifests.length > 0 || held.overflow > 0)) {
    const still = await readCultiveraBlocker();
    notice =
      still !== null && still !== "unknown"
        ? CUTOVER_STILL_BLOCKED_COPY
        : await releaseHeldAfterCutover(held, session.userId, session.email ?? null, versionId);
  }

  // Refresh public menu surfaces so they read the new published snapshot.
  // SLICE 59: ONE canonical list (public-surfaces.ts) covers "/", "/menu",
  // "/specials", AND "/vendor-delivery" — the vendor directory is derived
  // from the live menu, so a publish must refresh it too. (SLICE 39: "/shop"
  // was never a route in this app.)
  revalidatePath("/admin/menu-imports");
  revalidatePath("/admin/publish");
  revalidatePublicMenuSurfaces();

  redirect(dest + "?published=1" + (notice ? "&notice=" + encodeURIComponent(notice) : ""));
}

/**
 * S18: rebuild ONE delivery that is still waiting after cutover (listed on
 * /admin/menu-imports/cutover: past the release cap, or a rebuild that did
 * not finish). The pair (manifest, version) must be on the freshly read
 * pending list - never trust the form. Refused while a real Cultivera upload
 * is still staged (the rebuild would only be held again).
 */
export async function rebuildCutoverDeliveryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const manifestId = String(formData.get("manifestId") ?? "").toLowerCase();
  const versionId = String(formData.get("versionId") ?? "");
  const dest = "/admin/menu-imports/cutover";
  const status = await readCutoverStatus();
  if (status.blocking !== null && status.blocking !== "unknown") {
    redirect(dest + "?error=" + encodeURIComponent(CUTOVER_PUBLISH_REFUSED_COPY));
  }
  const listed = status.pending.some((p) => p.manifestId === manifestId && p.versionId === versionId);
  if (!listed) {
    redirect(dest + "?error=" + encodeURIComponent("That delivery is no longer waiting. The list below is up to date."));
  }
  const outcome = await rebuildDelivery(manifestId, [versionId], session.userId);
  const note = rebuildNote(outcome);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "menu_version.cutover_rebuilt",
    entityType: "inbound_manifest",
    entityId: manifestId,
    after: { heldVersionId: versionId, staged: outcome.staged, published: outcome.published, newVersionId: outcome.versionId },
  });
  revalidatePath(dest);
  revalidatePath("/admin/publish");
  revalidatePath("/admin/menu-imports");
  redirect(dest + "?notice=" + encodeURIComponent(note.text));
}

/**
 * R27: "Publish the ready products" - on a receiving update held for a fact
 * check, re-stage THAT delivery so only the flagged products stay off the
 * menu and the register (fact-withhold-core) and everything else publishes.
 * The version id comes from the form; the delivery is read from the stored
 * row itself (never from the form) and must be a staged, receiving-origin,
 * fact-held update (publishReadyEligible). Same permission as Publish.
 */
export async function publishReadyProductsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const dest = "/admin/publish";
  const versionId = String(formData.get("versionId") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    redirect(dest + "?error=" + encodeURIComponent("That update could not be found. Reload the page."));
  }
  const { publishReadyEligible, publishReadyNote } = await import("@/lib/pos/intake-version-copy-core");
  const { data, error } = await createSupabaseAdminClient()
    .from("menu_versions")
    .select("id, status, import_id, summary_json")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) {
    redirect(dest + "?error=" + encodeURIComponent(error ? `The update could not be read (${error.message}).` : "That update no longer exists. Reload the page."));
  }
  const manifestId = publishReadyEligible(data as { status: string | null; import_id: string | null; summary_json: unknown });
  if (!manifestId) {
    redirect(dest + "?error=" + encodeURIComponent("That update is no longer waiting for a fact check. The list below is up to date."));
  }
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  const outcome = await stageIntakeMenuVersionForManifest(manifestId, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "menu_version.publish_ready_products",
    entityType: "inbound_manifest",
    entityId: manifestId,
    after: {
      heldVersionId: versionId,
      staged: outcome.staged,
      published: outcome.published,
      newVersionId: outcome.versionId,
      withheld: outcome.withheld ?? 0,
      reason: outcome.reason ?? null,
    },
  });
  revalidatePath(dest);
  revalidatePath("/admin/menu-imports");
  revalidatePath("/admin/inventory/drafts");
  if (outcome.published) revalidatePublicMenuSurfaces();
  redirect(dest + "?notice=" + encodeURIComponent(publishReadyNote(outcome)));
}

/**
 * T-327 (roadmap Slice 1) — BACKFILL compliance inventory lots for an import
 * that was published before the lot-creation feature existed (so it has a live
 * menu but no inventory_lots). Calls the idempotent backfillImportLots service,
 * which re-runs the exact publish-time routine. Confirm-free (it never removes
 * anything and can be re-clicked safely), permission-gated, audit-logged.
 */
export async function backfillLotsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const importId = String(formData.get("importId") ?? "");
  const from = String(formData.get("from") ?? "");
  const dest = publishReturnBase(from, importId);
  if (!importId) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  }

  let ok: string;
  try {
    const summary = await backfillImportLots(importId, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.backfill_lots",
      entityType: "pos_import",
      entityId: importId,
      after: summary,
    });
    ok =
      summary.created > 0
        ? `Created ${summary.created} inventory lot(s). They now appear in Inventory Manager and Receiving.`
        : `No new lots needed — ${summary.alreadyPresent} lot(s) already exist for this import.`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backfill failed.";
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  revalidatePath(dest);
  redirect(dest + "?backfilled=" + encodeURIComponent(ok));
}

/**
 * R15a — fill received dates + POS cannabinoids onto lots an EARLIER publish
 * created (before the importer wrote them). Fill-only; re-clickable; audited.
 */
export async function fillLotFactsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = String(formData.get("importId") ?? "");
  if (!importId) redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  const dest = `/admin/menu-imports/${importId}`;
  let msg: string;
  try {
    const r = await fillImportLotFacts(importId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.fill_lot_facts",
      entityType: "pos_import",
      entityId: importId,
      after: r,
    });
    msg =
      `Matched ${r.matched} lot(s): filled ${r.datesFilled} received date(s) and cannabinoids on ${r.potencyFilled} lot(s). ` +
      "Values you already set were left alone." +
      (r.potencyColumnsPresent ? "" : " THC/CBD columns need migration 0241 applied — dates and CBN/CBC were filled; click again after applying it.");
  } catch (err) {
    redirect(dest + "?error=" + encodeURIComponent(err instanceof Error ? err.message : "Fill failed."));
  }
  revalidatePath(dest);
  revalidatePath("/admin/inventory");
  redirect(dest + "?backfilled=" + encodeURIComponent(msg) + "#lot-plan");
}

/**
 * PROGRAM 3 / SLICE 57 — record one human decision in the golden-record
 * exception queue (approve / fix / reject) and mirror it onto the STAGED
 * menu_items row (fix writes corrected facts with provenance "reviewer";
 * reject hides the row with a documented reason). Rule 3.1: a human decides —
 * the machine never guesses.
 */
export async function resolveFactReview(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");

  const importId = String(formData.get("importId") ?? "");
  const sourceItemId = String(formData.get("sourceItemId") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const dest = `/admin/menu-imports/${importId}/facts`;

  if (!importId || !sourceItemId) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import or item id."));
  }
  if (action !== "approve" && action !== "fix" && action !== "reject") {
    redirect(dest + "?error=" + encodeURIComponent("Unknown review action."));
  }

  // Inline-fix fields: only what the reviewer actually typed is applied.
  // Numbers are validated (never guess — a bad number is refused, not coerced
  // to something else); text fields pass through as typed.
  let correctedFacts: Partial<FactReviewFacts> | null = null;
  if (action === "fix") {
    const facts: Partial<FactReviewFacts> = {};
    const numberFields: [keyof FactReviewFacts, string][] = [
      ["servingsPerPack", "servingsPerPack"],
      ["mgPerServing", "mgPerServing"],
      ["packageThcMg", "packageThcMg"],
      ["packageCbdMg", "packageCbdMg"],
      ["netWeightGrams", "netWeightGrams"],
      ["netVolumeMl", "netVolumeMl"],
    ];
    for (const [key, field] of numberFields) {
      const raw = String(formData.get(field) ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        redirect(dest + "?error=" + encodeURIComponent(`"${raw}" is not a valid number for ${field}.`));
      }
      (facts as Record<string, number>)[key] = value;
    }
    for (const key of ["thc", "cbd", "ratioLabel"] as const) {
      const raw = String(formData.get(key) ?? "").trim();
      if (raw !== "") (facts as Record<string, string>)[key] = raw;
    }

    // ── SLICE 16: the low-THC beverage classification ──────────────────
    // The rules live in the PURE core so they can be unit-tested; this action
    // only translates a failure into a redirect. See
    // parseLowThcClassification() for why each rule exists — the short version
    // is that a mis-typed per-serving figure would let the register sell 4x
    // the statutory cap.
    const lowThc = parseLowThcClassification(
      String(formData.get("lowThcLiquid") ?? ""),
      String(formData.get("unitThcMg") ?? ""),
    );
    if (!lowThc.ok) {
      redirect(dest + "?error=" + encodeURIComponent(lowThc.error));
    } else {
      Object.assign(facts, lowThc.facts);
    }

    // ── SLICE 17: the "otherwise taken into the body" classification ─────
    // Same shape as the low-THC parse above and for the same reason: the rules
    // live in the pure core so they can be unit-tested, and this action only
    // translates a failure into a redirect. See
    // parseOtherwiseTakenClassification() for why each rule exists — the short
    // version is that a missing units-per-package count would make the register
    // read a box of six as one unit and undercount the statutory limit 6x.
    const otherwiseTaken = parseOtherwiseTakenClassification(
      String(formData.get("otherwiseTaken") ?? ""),
      String(formData.get("unitsPerPackage") ?? ""),
    );
    if (!otherwiseTaken.ok) {
      redirect(dest + "?error=" + encodeURIComponent(otherwiseTaken.error));
    } else {
      Object.assign(facts, otherwiseTaken.facts);
    }

    if (Object.keys(facts).length === 0) {
      redirect(dest + "?error=" + encodeURIComponent("Fix chosen but no corrected values were entered."));
    }
    correctedFacts = facts;
  }

  try {
    await recordFactReview({
      importId,
      sourceItemId,
      action,
      note,
      correctedFacts,
      reviewedBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `fact_review.${action}`,
      entityType: "pos_fact_review",
      entityId: `${importId}:${sourceItemId}`,
      after: { note, correctedFacts },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Saving the review decision failed.";
    console.error("[menu-imports] resolveFactReview failed:", err);
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  revalidatePath(dest);
  // R14a: decisions mirror onto the LIVE menu too (publish now, fix after),
  // so the public pages and the live-menu cache tag are refreshed.
  revalidatePublicMenuSurfaces();
  // R14b: back to the same one-at-a-time focus (sanitised by the pure core).
  const focusSuffix = savedRedirectSuffix(
    parseFactFocus({ group: formData.get("focusGroup"), q: formData.get("focusQ") }),
  );
  if (focusSuffix) redirect(dest + "?saved=1" + focusSuffix);
  redirect(dest + "?saved=1");
}

/**
 * SLICE 6A — decide EVERY pending product that shares one machine-stated
 * reason, in a single named human decision.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * The owner's Sep-1-2026 import left 614 products in needs-review. The publish
 * gate correctly refused ("604 fact-review row(s) still await a human
 * decision"), but the only way to clear it was 614 separate form submissions.
 * A refusal a human cannot physically clear is a broken product, and it kept
 * every product off the customer-facing website.
 *
 * ═══ WHAT IS AND IS NOT DELEGATED ═══
 *
 * Rule 3.1 is fully intact. NOTHING is auto-decided. A human still chooses
 * approve or reject, and that choice is written as ONE `pos_fact_reviews` row
 * PER PRODUCT (exactly what the single-row path writes), each carrying a note
 * that says it was a bulk decision and over which reason. An auditor reading
 * any single row can reconstruct the whole action.
 *
 * Bulk FIX is refused by `planBulkDecision` -- corrected values are
 * per-product facts and applying one typed number across hundreds of products
 * would be inventing data (Rule 2).
 *
 * ═══ WHY THE GROUP IS REBUILT SERVER-SIDE ═══
 *
 * The form posts only a group KEY, never a list of row ids. This action
 * re-reads the diagnostics, re-derives the buckets and re-groups the pending
 * rows itself, so the set of products it writes is the set the SERVER believes
 * is pending right now. A stale or tampered client can never widen the blast
 * radius, and rows decided since the page rendered are simply not in the group.
 *
 * The diagnostics read is the COMPLETENESS-CHECKED one: acting on a truncated
 * view is precisely the bug being fixed, so an incomplete read REFUSES rather
 * than deciding a partial set.
 */
export async function resolveFactReviewGroup(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");

  const importId = String(formData.get("importId") ?? "");
  const groupKey = String(formData.get("groupKey") ?? "");
  const action = String(formData.get("action") ?? "");
  const typedNote = String(formData.get("note") ?? "").trim() || null;
  const dest = `/admin/menu-imports/${importId}/facts`;

  if (!importId || !groupKey) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import or group."));
  }
  if (action !== "approve" && action !== "reject") {
    redirect(dest + "?error=" + encodeURIComponent("A group decision must be approve or reject."));
  }

  let plan: ReturnType<typeof planBulkDecision>;
  let group: FactReviewGroup | undefined;
  try {
    const [versions, diag, reviews] = await Promise.all([
      listVersions(50),
      getImportDiagnosticsChecked(importId),
      listFactReviews(importId),
    ]);
    // Never decide from a partial view -- that is the defect, not the fix.
    if (!diag.verdict.complete) {
      redirect(
        dest +
          "?error=" +
          encodeURIComponent(
            `Refusing a group decision: ${diag.verdict.message} Reload and try again once the list reads complete.`,
          ),
      );
    }
    const version = versions.find((v) => v.import_id === importId) ?? null;
    const items = version ? await getVersionItems(version.id) : [];
    const buckets = buildFactReviewBuckets(
      items.map(menuItemRowToFactReviewItem),
      diag.rows.map(posDiagnosticToFactReviewDiagnostic),
      factReviewsToResolutions(reviews),
    );
    const groups = groupPendingReviews(buckets.needsReview.filter((r) => r.resolution === null));
    group = groups.find((g) => g.key === groupKey);
    plan = planBulkDecision({ groups, groupKey, action, reviewedBy: session.userId });
  } catch (err) {
    // A redirect() inside the try throws NEXT_REDIRECT; never swallow it.
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : "Loading the review group failed.";
    console.error("[menu-imports] resolveFactReviewGroup load failed:", err);
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  if (!plan.ok || !group) {
    redirect(dest + "?error=" + encodeURIComponent(plan.message));
  }

  const note = bulkDecisionNote(group, typedNote);
  let written = 0;
  try {
    // One recorded decision per product -- identical to the single-row path.
    for (const sourceItemId of plan.sourceItemIds) {
      await recordFactReview({
        importId,
        sourceItemId,
        action,
        note,
        correctedFacts: null,
        reviewedBy: session.userId,
      });
      written++;
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `fact_review.bulk_${action}`,
      entityType: "pos_fact_review",
      entityId: `${importId}:group:${groupKey}`,
      after: { reason: group.reason, count: plan.sourceItemIds.length, note },
    });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : "Saving the group decision failed.";
    console.error("[menu-imports] resolveFactReviewGroup failed:", err);
    // Partial progress is REPORTED, never hidden: the rows already written are
    // real decisions and the owner must know the count.
    redirect(
      dest +
        "?error=" +
        encodeURIComponent(
          written > 0
            ? `${message} ${written} of ${plan.sourceItemIds.length} decision(s) were saved before this failed.`
            : message,
        ),
    );
  }

  revalidatePath(dest);
  // R14a: decisions mirror onto the LIVE menu too (publish now, fix after),
  // so the public pages and the live-menu cache tag are refreshed.
  revalidatePublicMenuSurfaces();
  redirect(dest + "?saved=1");
}

/**
 * Clean Slate — delete ONLY test-flagged import/menu data. Confirm-gated
 * (requires typing the exact phrase) and audit-logged. Never touches real data
 * or the validated knowledge base (handled by the DB function in 0066).
 */
export async function cleanSlateTestDataAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");

  const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
  if (confirm !== "DELETE TEST DATA") {
    redirect(
      "/admin/menu-imports?error=" +
        encodeURIComponent('To confirm, type exactly: DELETE TEST DATA'),
    );
  }

  let cleaned: string;
  let livePublishedChanged = false;
  try {
    const summary = await cleanSlateTestData();
    livePublishedChanged = summary.publishedVersionDeleted > 0;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.clean_slate_test_data",
      entityType: "pos_import",
      after: summary,
    });
    // Plain-English result. Call out the LIVE-menu change explicitly (Slice 2):
    // a published test version is removed from the storefront, and the previous
    // real menu is restored if one exists.
    cleaned = `${summary.menuVersionsDeleted} test version(s) and ${summary.posImportsDeleted} test import(s) removed.`;
    if (summary.publishedVersionDeleted > 0) {
      cleaned += summary.restoredVersionId
        ? " A test version was live on the shop — it has been removed and your previous real menu is now live again."
        : " A test version was live on the shop — it has been removed. There was no previous real menu to restore, so the live menu is now empty until you publish a real import.";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean Slate failed.";
    redirect("/admin/menu-imports?error=" + encodeURIComponent(message));
  }

  // If the live published version changed, refresh the public storefront so it
  // reads the restored (or now-empty) snapshot instead of the deleted test one.
  revalidatePath("/admin/menu-imports");
  if (livePublishedChanged) {
    revalidatePath("/admin/publish");
    revalidatePublicMenuSurfaces();
  }
  redirect("/admin/menu-imports?cleaned=" + encodeURIComponent(cleaned));
}

/**
 * R14b — "Re-file as …" from the import page's Type & category check.
 *
 * ONE product, ONE human press (Rule 3.1): writes the same per-product
 * override the lot page writes (product_classification_overrides, keyed by
 * source_item_id; the live menu applies its website category at read time via
 * withCategoryOverride). The CCRS/LCB columns are never touched (E1).
 *
 * Validation, all server-side: the product must belong to THIS import's
 * version (a hidden field is never trusted), the category must be an active
 * registry category the live menu can apply, and the type a registry label
 * that does not contradict the catalog (parseTypeCheckRefile).
 */
export async function refileFromTypeCheck(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = String(formData.get("importId") ?? "").trim();
  const sourceItemId = String(formData.get("sourceItemId") ?? "").trim();
  if (!importId || !sourceItemId) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import or product."));
  }

  const admin = createSupabaseAdminClient();
  const { data: versions, error: vErr } = await admin.from("menu_versions").select("id").eq("import_id", importId);
  if (vErr || !versions || versions.length === 0) {
    redirect(typeCheckReturnHref(importId, "This import has no menu version to re-file from.", true));
  }
  const { data: rows, error: iErr } = await admin
    .from("menu_items")
    .select("source_item_id, name")
    .in("menu_version_id", versions.map((v: { id: string }) => v.id))
    .eq("source_item_id", sourceItemId)
    .limit(1);
  if (iErr || !rows || rows.length === 0) {
    redirect(typeCheckReturnHref(importId, "That product is not part of this import.", true));
  }
  const productName = String((rows[0] as { name?: string }).name ?? sourceItemId);

  const [categoryRegistry, typeRegistry, current] = await Promise.all([
    listWebsiteCategoryTypes({ includeInactive: false }),
    listInventoryTypes({ includeInactive: false }),
    getOverrideForKey(sourceItemId),
  ]);
  // R15b: a per-row select posts one "category|type" value.
  const choice = formData.get("choice");
  const [choiceCategory, choiceType] = typeof choice === "string" && choice ? choice.split("|") : [null, null];
  const parsed = parseTypeCheckRefile(
    {
      website_category: choiceCategory ?? (formData.get("website_category") as string | null),
      house_type: choice ? (choiceType ?? "") : (formData.get("house_type") as string | null),
    },
    {
      // Only categories the live menu can apply (menu-category-override-core).
      validCategoryValues: categoryRegistry.map((c) => c.value).filter((v) => isValidWebsiteCategory(v)),
      validTypeLabels: typeRegistry.map((t) => t.label),
    },
  );
  if (!parsed.ok) {
    redirect(typeCheckReturnHref(importId, parsed.error, true));
  }

  const result = await upsertOverride(
    sourceItemId,
    { website_category: parsed.websiteCategory, house_type: parsed.houseType, note: current?.note ?? null },
    session.userId,
  );
  if (!result.ok) {
    redirect(typeCheckReturnHref(importId, result.error, true));
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: TYPE_CHECK_REFILE_AUDIT,
    entityType: "product_classification_override",
    entityId: sourceItemId,
    before: { website_category: current?.website_category ?? null, house_type: current?.house_type ?? null },
    after: { website_category: parsed.websiteCategory, house_type: parsed.houseType, import_id: importId },
  });

  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory");
  revalidatePublicMenuSurfaces();
  const label = parsed.houseType ? `${parsed.houseType} (${parsed.websiteCategory})` : parsed.websiteCategory;
  redirect(typeCheckReturnHref(importId, `Re-filed "${productName}" as ${label}.`));
}
