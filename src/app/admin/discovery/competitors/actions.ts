"use server";

/**
 * Server actions for the owner-managed competitor roster.
 *
 * OWNER REQUEST (verbatim, standing rule 1):
 *   "I have the a list of competitors, is their a way for me to give the system
 *    a competitor specifically like I did to get the curated list, baked into
 *    the back office, so we don't have to make code edits to find other
 *    specific retailers and producer processors? I think that would be
 *    fantastic!"
 *
 * Every write goes through the PURE validator in competitor-roster-core.ts
 * BEFORE it reaches the database. Nothing here guesses or repairs a value: a
 * bad row comes back to the human with a precise message (standing rules 2/3).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  getCompetitor,
  listAllCompetitors,
  setCompetitorActive,
  upsertCompetitor,
} from "@/lib/discovery/competitors";
import { validateRosterUpsert } from "@/lib/discovery/competitor-roster-core";

const BASE = "/admin/discovery/competitors";

function back(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(qs ? `${BASE}?${qs}` : BASE);
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * Add or edit one roster entry.
 *
 * `editing_license` is present on an edit so the duplicate-license and
 * single-self rules don't fire against the row being edited itself.
 */
export async function saveCompetitorAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");

  const editingLicense = field(formData, "editing_license") || null;
  const existing = await listAllCompetitors();

  const validation = validateRosterUpsert(
    {
      license_number: field(formData, "license_number"),
      tradename: field(formData, "tradename"),
      city: field(formData, "city"),
      county: field(formData, "county"),
      area: field(formData, "area"),
      kind: field(formData, "kind"),
      is_self: formData.get("is_self"),
      is_active: formData.has("is_active_present") ? formData.get("is_active") : undefined,
      note: field(formData, "note"),
    },
    existing,
    editingLicense,
  );

  if (!validation.ok) {
    back({ error: validation.errors.join(" ") });
  }

  const before = editingLicense ? await getCompetitor(editingLicense) : null;

  // Editing a row and CHANGING its license number would orphan the original.
  // Handle it explicitly rather than silently leaving a duplicate behind.
  const licenseChanged =
    editingLicense !== null && editingLicense !== validation.value.license_number;

  const saved = await upsertCompetitor(validation.value);
  if (!saved.ok) {
    back({ error: saved.error });
  }

  if (licenseChanged) {
    // Deactivate the old entry instead of deleting it: benchmark history that
    // already references the old license stays intelligible.
    await setCompetitorActive(editingLicense as string, false);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: editingLicense ? "discovery.competitor.update" : "discovery.competitor.create",
    entityType: "discovery_competitors",
    entityId: validation.value.license_number,
    before,
    after: validation.value,
  });

  revalidatePath(BASE);
  revalidatePath("/admin/discovery/ccrs");
  back({
    saved: validation.value.license_number,
    ...(validation.warnings.length ? { warn: validation.warnings.join(" ") } : {}),
    ...(licenseChanged ? { moved: editingLicense as string } : {}),
  });
}

/** Turn a roster entry on or off. We never hard-delete (history stays valid). */
export async function setCompetitorActiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");

  const license = field(formData, "license_number");
  if (!license) back({ error: "No license number was supplied." });

  const active = field(formData, "active") === "1";
  const before = await getCompetitor(license);

  const result = await setCompetitorActive(license, active);
  if (!result.ok) {
    back({ error: result.error });
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: active ? "discovery.competitor.activate" : "discovery.competitor.deactivate",
    entityType: "discovery_competitors",
    entityId: license,
    before,
    after: { is_active: active },
  });

  revalidatePath(BASE);
  revalidatePath("/admin/discovery/ccrs");
  back({ [active ? "activated" : "deactivated"]: license });
}
