/**
 * POST /api/pos/stock-flag  (POS Slice B43)
 *
 * Toast-style "86 it" from the register: flip a published menu item to
 * inventory_status = "unavailable" so it leaves every register's next menu
 * download and the website. ONE-WAY by design — the register can kill a
 * phantom listing but can never invent inventory; bringing an item back is
 * a back-office action (intake/receiving or menu edit).
 *
 * Writes the SAME field the B19 sale-decrement flips when a sale empties an
 * item ("menu_items"."inventory_status" on the PUBLISHED version), so every
 * downstream consumer already honors it. Device-authenticated + audited
 * (device id is server-verified; the session employee rides as context the
 * same way sale events carry their employeeId).
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { validateStockFlag } from "@/lib/pos/stock-flag-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = validateStockFlag(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { productId, reason } = parsed.request;
  // Session-owner context for the audit row (client-asserted, like the
  // employeeId sale events carry; the DEVICE identity is server-verified).
  const flaggedBy = typeof (body as Record<string, unknown>).flaggedByName === "string"
    ? ((body as Record<string, unknown>).flaggedByName as string).slice(0, 120)
    : "";

  const version = await getPublishedVersion();
  if (!version) {
    return NextResponse.json({ error: "No published menu to update." }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error: readError } = await admin
    .from("menu_items")
    .select("id, name, inventory_status")
    .eq("menu_version_id", version.id)
    .eq("source_item_id", productId);
  if (readError) {
    return NextResponse.json({ error: `Could not read the menu item: ${readError.message}` }, { status: 503 });
  }
  const item = ((rows as { id: string; name: string; inventory_status: string }[] | null) ?? [])[0];
  if (!item) {
    return NextResponse.json({ error: "Item not found on the published menu — refresh and try again." }, { status: 404 });
  }
  if (item.inventory_status === "unavailable") {
    // Another register beat us to it — that's success, not an error.
    return NextResponse.json({ flagged: true, alreadyOut: true });
  }

  const { error: updateError } = await admin
    .from("menu_items")
    .update({ inventory_status: "unavailable" })
    .eq("id", item.id);
  if (updateError) {
    return NextResponse.json({ error: `Could not update the item: ${updateError.message}` }, { status: 503 });
  }

  await recordAudit({
    actorId: auth.device.id,
    actorEmail: flaggedBy || `device:${auth.device.id}`,
    action: "pos.stock_flag",
    entityType: "menu_item",
    entityId: item.id,
    after: {
      via: "register",
      deviceId: auth.device.id,
      registerId: auth.device.register_id,
      productId,
      productName: item.name,
      reason,
      flaggedByName: flaggedBy || null,
      previousStatus: item.inventory_status,
      newStatus: "unavailable",
    },
  });

  return NextResponse.json({ flagged: true, alreadyOut: false });
}
