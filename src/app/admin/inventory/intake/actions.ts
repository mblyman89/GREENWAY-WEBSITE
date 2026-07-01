"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseVendorJson, type ParsedManifest } from "@/lib/inventory/intake-parser";
import { fetchTransferJson } from "@/lib/inventory/transfer-fetch";
import {
  stageManifest,
  acceptManifest,
  rejectManifest,
  setLotDisposition,
  finalizeManifestDispositions,
  updateManifestTransport,
} from "@/lib/inventory/intake-store";
import { normalizeRejection } from "@/lib/inventory/intake-disposition-core";
import {
  parseCcrsManifestCsv,
  ccrsToParsedManifest,
} from "@/lib/inventory/ccrs-manifest-csv-core";

/** Shared: parse + stage a JSON payload, redirect on each failure mode. */
async function stageJsonText(
  jsonText: string,
  actorId: string,
  sourceUrl: string | null,
) {
  const parsed = parseVendorJson(jsonText);
  if (!parsed.ok) {
    redirect(`/admin/inventory/intake?error=parse`);
  }
  if (parsed.manifest.lines.length === 0) {
    redirect(`/admin/inventory/intake?error=nolines`);
  }

  let rawPayload: unknown = jsonText;
  try {
    rawPayload = JSON.parse(jsonText);
  } catch {
    rawPayload = jsonText;
  }

  const staged = await stageManifest(parsed.manifest, rawPayload, actorId, {
    sourceUrl,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect(`/admin/inventory/intake?error=save`);
  }
  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1`);
}

export async function importManifestAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const jsonText = (formData.get("json_text") as string | null)?.trim() ?? "";
  if (!jsonText) {
    redirect("/admin/inventory/intake?error=empty");
  }
  await stageJsonText(jsonText, session.userId, null);
}

/**
 * Import by pasting the WCIA "Transfer Data Link" URL from the order email.
 * We fetch the JSON server-side (collapsing the doubled-prefix link bug) so the
 * employee never has to open and copy the raw JSON — and never has to click each
 * per-product COA link, since the transfer JSON already embeds them all.
 */
export async function importManifestFromUrlAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const url = (formData.get("transfer_url") as string | null)?.trim() ?? "";
  if (!url) {
    redirect("/admin/inventory/intake?error=emptyurl");
  }

  const fetched = await fetchTransferJson(url);
  if (!fetched.ok) {
    redirect(`/admin/inventory/intake?error=fetch`);
  }

  await stageJsonText(fetched.jsonText, session.userId, fetched.finalUrl);
}

/**
 * Import the OFFICIAL Washington CCRS Transportation Manifest CSV (the file the
 * sending licensee uploads to CCRS, or its downloadable template). Grounded in
 * the LCB spec (see src/lib/inventory/ccrs-manifest-csv-core.ts). CCRS carries
 * only identifiers + quantities + lab-test id — NOT product names/prices/COAs —
 * so the staged lines are sparse DRAFTS that staff enrich during review. We also
 * seed the transport chain-of-custody + ETA from the manifest header.
 */
export async function importManifestCsvAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const csvText = (formData.get("csv_text") as string | null)?.trim() ?? "";
  if (!csvText) {
    redirect("/admin/inventory/intake?error=emptycsv");
  }

  const parsed = parseCcrsManifestCsv(csvText);
  if (!parsed.ok) {
    redirect("/admin/inventory/intake?error=csvparse");
  }
  const mapped = ccrsToParsedManifest(parsed);
  if (mapped.lines.length === 0) {
    redirect("/admin/inventory/intake?error=nolines");
  }

  // Adapt to the shared ParsedManifest shape stageManifest expects.
  const manifest: ParsedManifest = {
    manifest_number: mapped.manifest_number,
    vendor_label: mapped.vendor_label,
    vendor_license: mapped.vendor_license,
    transfer_date: mapped.transfer_date,
    source_format: "ccrs-csv",
    lines: mapped.lines,
    warnings: mapped.warnings,
  };

  const staged = await stageManifest(manifest, csvText, session.userId, {
    sourceUrl: null,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect("/admin/inventory/intake?error=save");
  }

  // Seed transport chain-of-custody + ETA from the CCRS header (best-effort).
  const t = mapped.transport;
  if (
    t.driver_name ||
    t.vehicle_plate ||
    t.vehicle_vin ||
    t.vehicle_description ||
    t.transporter_license ||
    t.departed_at ||
    t.arrived_at ||
    t.eta_date
  ) {
    await updateManifestTransport(
      staged.manifestId,
      {
        transporter_name: null,
        transporter_license: t.transporter_license,
        driver_name: t.driver_name,
        driver_license_number: null,
        vehicle_description: t.vehicle_description,
        vehicle_plate: t.vehicle_plate,
        vehicle_vin: t.vehicle_vin,
        departed_at: t.departed_at,
        arrived_at: t.arrived_at,
        route_notes: null,
        eta_date: t.eta_date,
      },
      session.userId,
    );
  }

  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1&csv=1`);
}

export async function acceptManifestAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await acceptManifest(manifestId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=accept`);
  }
  redirect(
    `/admin/inventory/intake/${manifestId}?accepted=${result.activated}&drafts=${result.draftsCreated}`,
  );
}

export async function setManifestLifecycleAction(manifestId: string, status: "in_transit" | "received") {
  const session = await requirePermission("inventory.manage");
  const { setManifestLifecycle } = await import("@/lib/inventory/intake-store");
  const result = await setManifestLifecycle(manifestId, status, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=lifecycle`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?lifecycle=${status}`);
}

export async function archiveCoasAction(manifestId: string) {
  await requirePermission("inventory.manage");
  const { archiveCoasForManifest } = await import("@/lib/inventory/coa-archive");
  const count = await archiveCoasForManifest(manifestId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  redirect(`/admin/inventory/intake/${manifestId}?archived=${count}`);
}

export async function updateManifestTransportAction(
  manifestId: string,
  formData: FormData,
) {
  const session = await requirePermission("inventory.manage");
  const { updateManifestTransport } = await import("@/lib/inventory/intake-store");
  const str = (k: string) => ((formData.get(k) as string | null) ?? "").trim() || null;
  const result = await updateManifestTransport(
    manifestId,
    {
      transporter_name: str("transporter_name"),
      transporter_license: str("transporter_license"),
      driver_name: str("driver_name"),
      driver_license_number: str("driver_license_number"),
      vehicle_description: str("vehicle_description"),
      vehicle_plate: str("vehicle_plate"),
      vehicle_vin: str("vehicle_vin"),
      departed_at: str("departed_at"),
      arrived_at: str("arrived_at"),
      route_notes: str("route_notes"),
      eta_date: str("eta_date"),
    },
    session.userId,
  );
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=transport`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?transport=1`);
}

/**
 * Reject the WHOLE manifest at the dock. Requires a reason (guard rail).
 * Refused product never enters inventory and is NEVER destroyed; we file
 * nothing with CCRS (the vendor corrects their own manifest).
 */
export async function rejectManifestAction(manifestId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const norm = normalizeRejection(
    formData.get("reason_code") as string | null,
    formData.get("reason_text") as string | null,
  );
  if (!norm.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=reason`);
  }
  const result = await rejectManifest(manifestId, session.userId, {
    reasonCode: norm.value.reasonCode,
    reasonText: norm.value.reasonText,
  });
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=reject`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?rejected=1`);
}

/**
 * Set a single lot's disposition. Reject requires a reason. Used by the
 * per-line accept/reject controls on the manifest review screen.
 */
export async function setLotDispositionAction(
  manifestId: string,
  lotId: string,
  disposition: "accepted" | "rejected_at_dock",
  formData: FormData,
) {
  const session = await requirePermission("inventory.manage");
  if (disposition === "rejected_at_dock") {
    const norm = normalizeRejection(
      formData.get("reason_code") as string | null,
      formData.get("reason_text") as string | null,
    );
    if (!norm.ok) {
      redirect(`/admin/inventory/intake/${manifestId}?error=reason`);
    }
    await setLotDisposition(lotId, "rejected_at_dock", session.userId, {
      reasonCode: norm.value.reasonCode,
      reasonText: norm.value.reasonText,
    });
  } else {
    await setLotDisposition(lotId, "accepted", session.userId);
  }
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  redirect(`/admin/inventory/intake/${manifestId}?lot=${disposition}`);
}

/**
 * Finalize the manifest after per-lot decisions: activate accepted lots, leave
 * refused ones out of inventory, and stamp the derived status
 * (accepted | rejected | partially_accepted).
 */
export async function finalizeManifestAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await finalizeManifestDispositions(manifestId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=finalize`);
  }
  redirect(
    `/admin/inventory/intake/${manifestId}?finalized=${result.derivedStatus}&accepted=${result.activated}&rejected=${result.rejected}&drafts=${result.draftsCreated}&held=${result.blocked.length}`,
  );
}
