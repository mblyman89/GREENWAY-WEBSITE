/**
 * src/lib/inventory/expired-stock-store.ts  (Fix Phase 1.6b, G-24)
 *
 * Server wrapper for expired-stock-core.ts.
 *
 *   readExpiredActiveLots(today)  one paged read of Active lots whose
 *     expires_on is before the store's Pacific day. A read that fails or is
 *     incomplete is REPORTED (ok: false); the completion gate then refuses the
 *     sale (fail-closed, same posture as recall-hold-store.ts) and the menu
 *     download carries on without the filter (advisory).
 *
 *   quarantineExpiredHardBlockLots(today)  the nightly job: every Active,
 *     expired edible / liquid edible / tincture / capsule / RSO lot is set to
 *     Quarantine with a compare-and-set on "active" (so a Recalled or already
 *     moved lot is never overwritten, and a doubled cron tick writes once),
 *     and each lot it actually moved gets an audit row.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { isMissingHeldQtyColumnError, sellableQty } from "@/lib/inventory/held-stock-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildExpiredKeyIndex,
  planExpiredQuarantine,
  EXPIRED_QUARANTINE_AUDIT_ACTION,
  EXPIRED_QUARANTINE_REASON,
  type ExpiredKeyIndex,
  type ExpiryLot,
} from "@/lib/inventory/expired-stock-core";

type Row = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  status: string | null;
  expires_on: string | null;
  on_hand_qty: number | string | null;
  held_qty?: number | string | null;
  category: string | null;
  inventory_type: string | null;
  is_sample: boolean | null;
};

const COLS = "id, pos_product_key, product_name, status, expires_on, on_hand_qty, category, inventory_type, is_sample";
const MAX_ROWS = 50_000;

export type ExpiredLotRead = { ok: true; lots: ExpiryLot[] } | { ok: false; error: string };

export async function readExpiredActiveLots(today: string): Promise<ExpiredLotRead> {
  if (!isSupabaseServiceConfigured) return { ok: true, lots: [] };
  try {
    const admin = createSupabaseAdminClient();
    let withHeld = true;
    const page = (from: number, to: number) =>
      admin
        .from("inventory_lots")
        .select(withHeld ? `${COLS}, held_qty` : COLS)
        // register-sell-sold-out-stock: Sold out lots are register-sellable now.
        // register-sell-everything-fix-later: so are Quarantine lots, so an
        // expired edible in Quarantine is blocked exactly like an Active one.
        .in("status", ["active", "sold_out", "quarantine"])
        .lt("expires_on", today)
        .order("id", { ascending: true })
        .range(from, to);
    const probe = await page(0, 0);
    if (probe.error && isMissingHeldQtyColumnError(probe.error)) withHeld = false;
    else if (probe.error) return { ok: false, error: probe.error.message };
    const { rows, verdict } = await pagedAllChecked<Row>(
      async (from, to) => {
        const { data, error } = await page(from, to);
        if (error) return { rows: [], ok: false };
        return { rows: (data as unknown as Row[] | null) ?? [], ok: true };
      },
      { maxRows: MAX_ROWS },
    );
    if (!verdict.complete) return { ok: false, error: `expired lot read incomplete: ${verdict.message}` };
    return {
      ok: true,
      lots: rows.map((r) => ({
        id: r.id,
        posProductKey: r.pos_product_key,
        productName: r.product_name,
        status: r.status,
        expiresOn: r.expires_on,
        sellableQty: sellableQty(r.on_hand_qty, withHeld ? r.held_qty : 0),
        category: r.category,
        inventoryType: r.inventory_type,
        isSample: r.is_sample,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The expired-key index for the register menu (advisory: empty on failure). */
export async function expiredKeyIndexForMenu(today: string): Promise<ExpiredKeyIndex> {
  const read = await readExpiredActiveLots(today);
  if (!read.ok) {
    console.warn(`[expired-stock] menu filter skipped: ${read.error}`);
    return { blocked: new Map(), warned: new Map() };
  }
  return buildExpiredKeyIndex(read.lots, today);
}

export type ExpiredQuarantineResult = {
  ok: boolean;
  considered: number;
  quarantined: { id: string; productName: string | null; expiresOn: string | null }[];
  skipped: number;
  error?: string;
};

export async function quarantineExpiredHardBlockLots(today: string): Promise<ExpiredQuarantineResult> {
  const read = await readExpiredActiveLots(today);
  if (!read.ok) return { ok: false, considered: 0, quarantined: [], skipped: 0, error: read.error };
  const plan = planExpiredQuarantine(read.lots, today);
  const admin = createSupabaseAdminClient();
  const quarantined: ExpiredQuarantineResult["quarantined"] = [];
  let skipped = 0;
  for (const lot of plan) {
    const { data, error } = await admin
      .from("inventory_lots")
      .update({ status: "quarantine" })
      .eq("id", lot.id)
      .eq("status", "active")
      .select("id");
    if (error || !data || data.length === 0) {
      skipped++;
      continue;
    }
    quarantined.push({ id: lot.id, productName: lot.productName, expiresOn: lot.expiresOn });
    await recordAudit({
      actorId: null,
      actorEmail: "cron:expired-quarantine",
      action: EXPIRED_QUARANTINE_AUDIT_ACTION,
      entityType: "inventory_lot",
      entityId: lot.id,
      before: { status: lot.status },
      after: {
        status: "quarantine",
        reason: EXPIRED_QUARANTINE_REASON,
        expires_on: lot.expiresOn,
        inventory_type: lot.inventoryType,
        category: lot.category,
        store_day: today,
      },
    });
  }
  return { ok: true, considered: plan.length, quarantined, skipped };
}
