/**
 * src/lib/purchasing/vendor-menu-link-store.ts
 *
 * D213 — "Link to vendor" for a saved menu the matcher could not place (or
 * placed on the wrong card). The owner picks the vendor; we never guess
 * (rule 3). Two writes, both named and both checked (rule 15):
 *
 *   1. a `vendor_aliases` row (source_system = 'menu', source_name = the
 *      seller name exactly as the menu shows it). The coverage matcher gives
 *      these aliases top priority, so EVERY past and future pull with that
 *      seller name lands on the chosen vendor. unique(source_system,
 *      source_name) means re-linking the same name MOVES it (update), never
 *      duplicates it.
 *   2. `vendor_id` stamped on every saved snapshot of that source whose
 *      seller name is exactly that name, so the menu itself says who it is.
 *
 * Archived cards can't be chosen: a merged card would hide the menu again.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import {
  MENU_LINK_ALIAS_SYSTEM,
  menuLinkSnapshotTable,
  type MenuSource,
} from "@/lib/purchasing/vendor-menu-coverage-core";

export type LinkMenuResult = {
  ok: boolean;
  message: string;
  vendorName?: string;
  snapshotsLinked?: number;
  previousVendorId?: string | null;
};

export async function linkMenuToVendor(input: {
  source: MenuSource;
  sellerName: string;
  vendorId: string;
}): Promise<LinkMenuResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't configured on this site." };
  const sellerName = input.sellerName.trim().slice(0, 300);
  if (!sellerName) return { ok: false, message: "This menu has no seller name to remember." };
  const admin = createSupabaseAdminClient();

  const { data: vRow, error: vErr } = await admin
    .from("vendors")
    .select("id, display_name, status")
    .eq("id", input.vendorId)
    .maybeSingle();
  if (vErr) return { ok: false, message: `Couldn't read that vendor: ${dbErrorForStaff(vErr, "the read failed")}` };
  const vendor = vRow as { id: string; display_name: string; status: string | null } | null;
  if (!vendor) return { ok: false, message: "That vendor no longer exists. Refresh the page and pick again." };
  if ((vendor.status ?? "").toLowerCase() === "archived") {
    return { ok: false, message: `"${vendor.display_name}" is archived (merged into another card). Pick the card it was merged into.` };
  }

  // 1. The alias — insert, or move an existing 'menu' alias of the same name.
  const { data: existing, error: exErr } = await admin
    .from("vendor_aliases")
    .select("id, vendor_id")
    .eq("source_system", MENU_LINK_ALIAS_SYSTEM)
    .eq("source_name", sellerName)
    .maybeSingle();
  if (exErr) return { ok: false, message: `Couldn't check existing links: ${dbErrorForStaff(exErr, "the read failed")}` };
  const prev = existing as { id: string; vendor_id: string } | null;
  if (prev) {
    if (prev.vendor_id !== vendor.id) {
      const { error } = await admin.from("vendor_aliases").update({ vendor_id: vendor.id }).eq("id", prev.id);
      if (error) return { ok: false, message: `Couldn't move the link: ${dbErrorForStaff(error, "the update failed")}` };
    }
  } else {
    const { error } = await admin
      .from("vendor_aliases")
      .insert({ vendor_id: vendor.id, source_name: sellerName, source_system: MENU_LINK_ALIAS_SYSTEM });
    if (error) return { ok: false, message: `Couldn't save the link: ${dbErrorForStaff(error, "the insert failed")}` };
  }

  // 2. Stamp the vendor on this source's saved menus with that exact seller name.
  const t = menuLinkSnapshotTable(input.source);
  const { data: stamped, error: sErr } = await admin
    .from(t.table)
    .update({ vendor_id: vendor.id })
    .eq(t.nameColumn, sellerName)
    .select("id");
  const snapshotsLinked = ((stamped as { id: string }[] | null) ?? []).length;
  if (sErr) {
    // The alias already makes the page match; say what didn't happen (rule 15).
    return {
      ok: true,
      vendorName: vendor.display_name,
      snapshotsLinked: 0,
      previousVendorId: prev?.vendor_id ?? null,
      message: `Linked "${sellerName}" to ${vendor.display_name}. (The saved menus themselves couldn't be stamped: ${dbErrorForStaff(sErr, "the update failed")} — the page still matches them by the saved link.)`,
    };
  }
  return {
    ok: true,
    vendorName: vendor.display_name,
    snapshotsLinked,
    previousVendorId: prev?.vendor_id ?? null,
    message: `Linked "${sellerName}" to ${vendor.display_name}${snapshotsLinked ? ` — ${snapshotsLinked} saved menu${snapshotsLinked === 1 ? "" : "s"} updated` : ""}. Future pulls with this name will match automatically.`,
  };
}
