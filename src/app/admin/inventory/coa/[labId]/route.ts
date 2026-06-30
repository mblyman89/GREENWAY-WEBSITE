import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { signedCoaUrl, archiveCoasForManifest } from "@/lib/inventory/coa-archive";

/**
 * GET /admin/inventory/coa/[labId]
 * Mints a short-lived signed URL for the archived COA PDF and redirects to it.
 * Falls back to the vendor's coa_url if the file isn't archived yet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ labId: string }> },
) {
  await requirePermission("inventory.manage");
  const { labId } = await params;

  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Storage not configured." }, { status: 503 });
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("lab_results")
    .select("coa_storage_path, coa_url")
    .eq("id", labId)
    .maybeSingle();
  const lab = data as { coa_storage_path: string | null; coa_url: string | null } | null;
  if (!lab) {
    return NextResponse.json({ error: "Lab result not found." }, { status: 404 });
  }

  if (lab.coa_storage_path) {
    const signed = await signedCoaUrl(lab.coa_storage_path, 600);
    if (signed) return NextResponse.redirect(signed);
  }

  // Not archived yet — fall back to vendor link (and the next accept will archive it).
  if (lab.coa_url) {
    return NextResponse.redirect(lab.coa_url);
  }
  return NextResponse.json({ error: "No COA available for this lab result." }, { status: 404 });
}

/**
 * POST /admin/inventory/coa/[labId]
 * Treat labId as a manifestId and force a (re)archive pass. Used by the
 * "Archive COAs" backfill button on accepted manifests.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ labId: string }> },
) {
  await requirePermission("inventory.manage");
  const { labId: manifestId } = await params;
  const count = await archiveCoasForManifest(manifestId);
  return NextResponse.json({ ok: true, archived: count });
}
