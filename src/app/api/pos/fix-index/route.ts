/**
 * GET /api/pos/fix-index  (D170 O9 — Fix & sell with no internet)
 *
 * The owner, verbatim (2026-11-04): "finish all remaining offline mode tasks
 * ... I want to make sure we are fully hardened and prepared for any
 * situation."
 *
 * Returns a compact LOT INDEX the register saves (encrypted) so "Fix & sell"
 * keeps working when the internet is down. Each row carries the SAME facts
 * /api/pos/fix-and-sell reads for one lot (status, sellable stock, cost, size,
 * lab passed, recalled, scheduled for destruction, expired edible), so the
 * iPad runs the SAME pure decideFixAndSell and can never sell what the route
 * would refuse, as of the index's age. Lots sell from Active, Sold out and
 * Quarantine (the SALE_DRAW statuses), so those are the rows returned.
 *
 * Device-authenticated (same headers as /api/pos/fix-and-sell). Read-only:
 * no audit row (the fix itself is audited when the queued Fix & sell reaches
 * /api/pos/fix-and-sell). Any read error answers 503 so the register keeps
 * its previous copy rather than saving a partial index.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { OPEN_DESTRUCTION_STATUSES } from "@/lib/inventory/destruction-lot-status-core";
import { expiryKindFor, isExpiredOn } from "@/lib/inventory/expired-stock-core";
import { sellableQty } from "@/lib/inventory/held-stock-core";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { pacificToday } from "@/lib/reports/timezone";
import { FIX_INDEX_MAX_ROWS, type FixIndexRow } from "@/lib/pos/fix-index-core";

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

/** The statuses a register sale may draw from (sale-lot-read SALE_DRAW_LOT_STATUSES). */
const INDEX_STATUSES = ["active", "sold_out", "quarantine"];
const PAGE = 1000;
const LAB_CHUNK = 200;

function unavailable(what: string): NextResponse {
  return NextResponse.json({ error: `Could not read ${what} right now.` }, { status: 503 });
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  const admin = createSupabaseAdminClient();

  const lots: LotRow[] = [];
  for (let from = 0; from < FIX_INDEX_MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select(COLS)
      .in("status", INDEX_STATUSES)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return unavailable("the lots");
    const page = (data as unknown as LotRow[] | null) ?? [];
    lots.push(...page);
    if (page.length < PAGE) break;
  }

  let recalled: Set<string>;
  try {
    recalled = await recalledProductKeys({ failClosed: true });
  } catch {
    return unavailable("the recall status");
  }

  const destruction = new Set<string>();
  {
    const { data, error } = await admin
      .from("destruction_events")
      .select("lot_id")
      .in("status", [...OPEN_DESTRUCTION_STATUSES])
      .limit(10_000);
    if (error) return unavailable("the destruction status");
    for (const d of (data as { lot_id: string | null }[] | null) ?? []) if (d.lot_id) destruction.add(d.lot_id);
  }

  const labIds = [...new Set(lots.map((r) => r.lab_result_id).filter((v): v is string => !!v))];
  const labPassed = new Map<string, boolean | null>();
  for (let i = 0; i < labIds.length; i += LAB_CHUNK) {
    const { data, error } = await admin
      .from("lab_results")
      .select("id, passed")
      .in("id", labIds.slice(i, i + LAB_CHUNK));
    if (error) return unavailable("the lab results");
    for (const l of (data as { id: string; passed: boolean | null }[] | null) ?? []) labPassed.set(l.id, l.passed);
  }

  const today = pacificToday();
  const rows: FixIndexRow[] = lots.map((r) => {
    const key = (r.pos_product_key ?? "").trim();
    return {
      i: r.id,
      k: key || null,
      c: r.lot_code,
      x: deriveInventoryExternalId(r),
      n: r.product_name,
      s: r.status,
      q: sellableQty(r.on_hand_qty, r.held_qty ?? 0),
      g: r.category,
      t: r.inventory_type,
      u: typeof r.unit_cost_minor_units === "number" ? r.unit_cost_minor_units : null,
      w: r.unit_weight,
      wu: r.unit_weight_uom,
      hl: !!r.lab_result_id,
      lp: r.lab_result_id ? (labPassed.get(r.lab_result_id) ?? null) : null,
      sm: r.is_sample === true,
      r: key ? recalled.has(key) : false,
      d: destruction.has(r.id),
      e:
        isExpiredOn(r.expires_on, today) &&
        expiryKindFor({ category: r.category, inventoryType: r.inventory_type, productName: r.product_name }) ===
          "block",
    };
  });

  return NextResponse.json({ rows, at: new Date().toISOString() });
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}
