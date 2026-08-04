"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { runImport, publishMenuVersion, findDuplicateImport, sha256, cleanSlateTestData, backfillImportLots } from "@/lib/pos/import-service";
import { getPublishedVersion, diffVersions, archiveStaleIntakeDrafts } from "@/lib/pos/menu-version";
import { recordFactReview } from "@/lib/pos/fact-review-store";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import type { FactReviewFacts } from "@/lib/pos/fact-review-core";

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

  // SLICE 76 safety gate: the live menu is a SNAPSHOT — publishing REPLACES it
  // wholesale. If this draft would REMOVE products that are live right now,
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
              `Not published: this draft would REMOVE ${diff.removed.length} product(s) from the live menu. Review the "will be removed" list and tick the confirmation box if that's really what you want — or publish the newest draft instead.`,
            ),
        );
      }
    }
  } catch (err) {
    // redirect() throws NEXT_REDIRECT — rethrow it; only swallow real diff errors.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[menu-imports] publish removal guard diff failed:", err);
  }

  try {
    await publishMenuVersion(versionId, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "menu_version.published",
      entityType: "menu_version",
      entityId: versionId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed.";
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  // SLICE 76 housekeeping: with this snapshot live, intake drafts staged
  // BEFORE it are landmines (publishing one would drop newer products) —
  // archive them so they can't be published by mistake. Best-effort.
  await archiveStaleIntakeDrafts(versionId);

  // Refresh public menu surfaces so they read the new published snapshot.
  // SLICE 59: ONE canonical list (public-surfaces.ts) covers "/", "/menu",
  // "/specials", AND "/vendor-delivery" — the vendor directory is derived
  // from the live menu, so a publish must refresh it too. (SLICE 39: "/shop"
  // was never a route in this app.)
  revalidatePath("/admin/menu-imports");
  revalidatePath("/admin/publish");
  revalidatePublicMenuSurfaces();

  redirect(dest + "?published=1");
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
  try {
    const summary = await cleanSlateTestData();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.clean_slate_test_data",
      entityType: "pos_import",
      after: summary,
    });
    cleaned = `${summary.menuVersionsDeleted} test version(s) and ${summary.posImportsDeleted} test import(s) removed.`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clean Slate failed.";
    redirect("/admin/menu-imports?error=" + encodeURIComponent(message));
  }

  revalidatePath("/admin/menu-imports");
  redirect("/admin/menu-imports?cleaned=" + encodeURIComponent(cleaned));
}
