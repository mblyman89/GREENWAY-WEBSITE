"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { runImport, publishMenuVersion, findDuplicateImport, sha256, cleanSlateTestData } from "@/lib/pos/import-service";

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

/** Publish a staged menu version (manager approval). */
export async function publishVersion(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const versionId = String(formData.get("versionId") ?? "");
  const importId = String(formData.get("importId") ?? "");
  if (!versionId) {
    redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing version id."));
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
    const dest = importId ? `/admin/menu-imports/${importId}` : "/admin/menu-imports";
    redirect(dest + "?error=" + encodeURIComponent(message));
  }

  // Refresh public menu surfaces so they read the new published snapshot.
  revalidatePath("/admin/menu-imports");
  revalidatePath("/menu");
  revalidatePath("/shop");
  revalidatePath("/");

  const dest = importId ? `/admin/menu-imports/${importId}` : "/admin/menu-imports";
  redirect(dest + "?published=1");
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
