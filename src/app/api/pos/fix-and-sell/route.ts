/**
 * POST /api/pos/fix-and-sell  (register-sell-everything-fix-later)
 *
 * The owner, verbatim: "I need ways of fixing a lot from the register, let
 * the system fix it for me so it can be sold, then set that item aside so I
 * can fix it properly. Everything must sell. No exceptions. We will fix it
 * all later."
 *
 * When a scanned package matches nothing in the register's cached menu, the
 * budtender presses "Fix & sell". This route finds the LOT by its package
 * code (lot code, CCRS id or product key), builds a register line for it from
 * the lot itself (name, size, category, 2x-cost auto price), records a
 * `register.fix_and_sell` audit row (that is what puts it on the back office
 * Fix later list) and returns the line. The register adds it to the cart and
 * to its cached menu.
 *
 * It never changes the lot's status: Active, Sold out and Quarantine lots all
 * sell and draw stock at the register already (sale-lot-read
 * SALE_DRAW_LOT_STATUSES), so nothing is "unlocked" behind the compliance
 * go-live gate. Missing paperwork (no COA, no menu product, no price) never
 * refuses. The ONLY refusals are the real stops: a recall, a FAILED lab, a
 * scheduled destruction, a destroyed lot, a trade sample, an expired edible.
 * The sale itself is still re-checked by the completion gate at sync.
 *
 * Device-authenticated (same headers as /api/pos/stock-flag) and online-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { OPEN_DESTRUCTION_STATUSES } from "@/lib/inventory/destruction-lot-status-core";
import { expiryKindFor, isExpiredOn } from "@/lib/inventory/expired-stock-core";
import { sellableQty } from "@/lib/inventory/held-stock-core";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { pacificToday } from "@/lib/reports/timezone";
import {
  REGISTER_FIX_AND_SELL_AUDIT_ACTION,
  decideFixAndSell,
  fixAndSellMessage,
  parseFixAndSellRequest,
  type FixLaterLot,
} from "@/lib/pos/register-fix-later-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  ccrs_inventory_external_id: string | null;
  status: string | null;
  on_hand_qty: number | string | null;
  held_qty?: number | string | null;
  product_name: string | null;
  unit_weight: number | string | null;
  unit_weight_uom: string | null;
  unit_cost_minor_units: number | null;
  category: string | null;
  inventory_type: string | null;
  lab_result_id: string | null;
  is_sample: boolean | null;
  expires_on: string | null;
};

const COLS =
  "id, lot_code, pos_product_key, ccrs_inventory_external_id, status, on_hand_qty, product_name, unit_weight, unit_weight_uom, unit_cost_minor_units, category, inventory_type, lab_result_id, is_sample, expires_on, held_qty";

/** The spellings a package code may be stored under (scanners differ in case). */
function codeVariants(code: string): string[] {
  return [...new Set([code, code.toUpperCase(), code.toLowerCase()])];
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
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
  const parsed = parseFixAndSellRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { code, employeeName } = parsed.request;

  const admin = createSupabaseAdminClient();
  const variants = codeVariants(code);
  const found = new Map<string, LotRow>();
  for (const column of ["lot_code", "ccrs_inventory_external_id", "pos_product_key"] as const) {
    const { data, error } = await admin.from("inventory_lots").select(COLS).in(column, variants).limit(50);
    if (error) {
      return NextResponse.json({ error: `Could not read the lot: ${error.message}` }, { status: 503 });
    }
    for (const r of (data as unknown as LotRow[] | null) ?? []) found.set(r.id, r);
    if (found.size > 0) break;
  }
  const rows = [...found.values()];

  // The real stops, read fail-closed: a failed recall read refuses.
  let recalled: Set<string>;
  try {
    recalled = await recalledProductKeys({ failClosed: true });
  } catch {
    return NextResponse.json(
      { error: "Could not confirm the recall status right now. Try again in a moment." },
      { status: 503 },
    );
  }
  const ids = rows.map((r) => r.id);
  const destruction = new Set<string>();
  if (ids.length > 0) {
    const { data: dRows, error: dErr } = await admin
      .from("destruction_events")
      .select("lot_id")
      .in("lot_id", ids)
      .in("status", [...OPEN_DESTRUCTION_STATUSES]);
    if (dErr) {
      return NextResponse.json({ error: "Could not confirm the destruction status right now. Try again." }, { status: 503 });
    }
    for (const d of (dRows as { lot_id: string | null }[] | null) ?? []) if (d.lot_id) destruction.add(d.lot_id);
  }
  const labIds = [...new Set(rows.map((r) => r.lab_result_id).filter((v): v is string => !!v))];
  const labPassed = new Map<string, boolean | null>();
  if (labIds.length > 0) {
    const { data: labs, error: labErr } = await admin.from("lab_results").select("id, passed").in("id", labIds);
    if (labErr) {
      return NextResponse.json({ error: "Could not confirm the lab result right now. Try again." }, { status: 503 });
    }
    for (const l of (labs as { id: string; passed: boolean | null }[] | null) ?? []) labPassed.set(l.id, l.passed);
  }
  const today = pacificToday();

  const facts = rows.map((r) => {
    const key = (r.pos_product_key ?? "").trim();
    const fact: FixLaterLot & { expiredHardBlock?: boolean } = {
      id: r.id,
      posProductKey: key || null,
      lotCode: r.lot_code,
      ccrsExternalId: deriveInventoryExternalId(r),
      productName: r.product_name,
      status: r.status,
      onHandQty: sellableQty(r.on_hand_qty, r.held_qty ?? 0),
      category: r.category,
      inventoryType: r.inventory_type,
      unitCostMinor: typeof r.unit_cost_minor_units === "number" ? r.unit_cost_minor_units : null,
      unitWeight: r.unit_weight,
      unitWeightUom: r.unit_weight_uom,
      hasLabResult: !!r.lab_result_id,
      labPassed: r.lab_result_id ? (labPassed.get(r.lab_result_id) ?? null) : null,
      isSample: r.is_sample === true,
      recalled: key ? recalled.has(key) : false,
      scheduledForDestruction: destruction.has(r.id),
      expiredHardBlock:
        isExpiredOn(r.expires_on, today) &&
        expiryKindFor({ category: r.category, inventoryType: r.inventory_type, productName: r.product_name }) === "block",
    };
    return fact;
  });

  const decision = decideFixAndSell(facts, code);
  if (!decision.ok) {
    await recordAudit({
      actorId: auth.device.id,
      actorEmail: employeeName || `device:${auth.device.id}`,
      action: `${REGISTER_FIX_AND_SELL_AUDIT_ACTION}_refused`,
      entityType: "inventory_lot",
      entityId: rows[0]?.id ?? code,
      after: { via: "register", code, stop: decision.stop, registerId: auth.device.register_id, employeeName },
    });
    return NextResponse.json({ fixed: false, stop: decision.stop, error: decision.message }, { status: 409 });
  }

  const lot = rows.find((r) => r.id === decision.lotId) ?? null;
  await recordAudit({
    actorId: auth.device.id,
    actorEmail: employeeName || `device:${auth.device.id}`,
    action: REGISTER_FIX_AND_SELL_AUDIT_ACTION,
    entityType: "inventory_lot",
    entityId: decision.lotId,
    before: lot ? { status: lot.status, on_hand_qty: lot.on_hand_qty } : null,
    after: {
      via: "register",
      code,
      deviceId: auth.device.id,
      registerId: auth.device.register_id,
      employeeName,
      productId: decision.product.productId,
      variantId: decision.product.variantId,
      productName: decision.product.name,
      category: decision.product.category,
      priceMinor: decision.product.regularPriceMinor,
      fixLater: decision.reasons,
    },
  });

  return NextResponse.json({
    fixed: true,
    product: decision.product,
    barcode: code,
    reasons: decision.reasons,
    message: fixAndSellMessage(decision.product),
  });
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handlePost(req));
}
