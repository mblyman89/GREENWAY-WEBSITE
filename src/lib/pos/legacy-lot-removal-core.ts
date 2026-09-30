/**
 * src/lib/pos/legacy-lot-removal-core.ts — R15b
 *
 * Owner, Round 15: "the inventory without product master, I want to delete
 * from ccrs, so I want a way to bulk adjust those out, they are legacy
 * database items we were never able to clear out."
 *
 * PURE. Plans a CCRS-reportable adjust-out of the lots behind this import's
 * `no_product_master` cards (in the inventory export, not the products
 * export). How it reaches CCRS, all from existing code:
 *   - reason "count" → CCRS AdjustmentReason "Reconciliation"
 *     (ccrs-inventory-adjustment-core.ts mapAdjustmentReason) — the WSLCB
 *     CCRS guide's reason for balancing inventory to what is really there;
 *   - a detail note is always written (≤ 250 chars, the CCRS field limit,
 *     adjustmentDetail) even though Reconciliation does not require one;
 *   - the adjustment export (ccrs-inventory-adjustment.ts) picks the rows up
 *     by date range like every other adjustment — nothing new to upload.
 * Only lots on THIS import's own migration manifest are touched (lots that a
 * later received delivery created are never swept up), and only while they
 * still have stock. A typed confirmation that names the count is required,
 * so a stale preview can never remove more than the owner saw.
 */

export const LEGACY_REMOVAL_REASON = "count";
export const LEGACY_REMOVAL_AUDIT = "inventory.legacy_lots_adjusted_out";
export const LEGACY_REMOVAL_NOTE =
  "Legacy Cultivera record with no product master - balance inventory (record removed from system of record)";

export type LegacyLotInput = {
  id: string;
  posProductKey: string | null;
  onHandQty: number | string | null;
  status: string | null;
  productName?: string | null;
  lotCode?: string | null;
};

export type LegacyRemovalRow = { id: string; qty: number; productName: string; lotCode: string | null };

export type LegacyRemovalPlan = { rows: LegacyRemovalRow[]; lots: number; units: number; skippedEmpty: number };

/** Lots of the flagged cards that still hold stock (the preview and the write use this same plan). */
export function planLegacyRemoval(lots: readonly LegacyLotInput[], flaggedKeys: ReadonlySet<string>): LegacyRemovalPlan {
  const rows: LegacyRemovalRow[] = [];
  let skippedEmpty = 0;
  for (const l of lots) {
    if (!l.posProductKey || !flaggedKeys.has(l.posProductKey)) continue;
    const qty = Number(l.onHandQty);
    if (!Number.isFinite(qty) || qty <= 0 || (l.status ?? "active") !== "active") { skippedEmpty += 1; continue; }
    rows.push({ id: l.id, qty, productName: String(l.productName ?? ""), lotCode: l.lotCode ?? null });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName) || a.id.localeCompare(b.id));
  const units = rows.reduce((n, r) => n + r.qty, 0);
  return { rows, lots: rows.length, units, skippedEmpty };
}

/** The exact phrase the owner types: "REMOVE 42". */
export function legacyRemovalPhrase(lots: number): string {
  return `REMOVE ${lots}`;
}

export function parseLegacyRemovalConfirm(
  typed: string | null | undefined,
  planLots: number,
): { ok: true } | { ok: false; error: string } {
  if (planLots <= 0) return { ok: false, error: "Nothing to remove — every flagged lot is already at zero." };
  const t = String(typed ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (t !== legacyRemovalPhrase(planLots)) {
    return {
      ok: false,
      error: `Type ${legacyRemovalPhrase(planLots)} exactly to confirm. (The count changed or did not match, so nothing was removed.)`,
    };
  }
  return { ok: true };
}

export function legacyRemovalNote(extra?: string | null): string {
  const e = String(extra ?? "").trim();
  return (e ? `${LEGACY_REMOVAL_NOTE}. ${e}` : LEGACY_REMOVAL_NOTE).slice(0, 250);
}

// ── self-tests ────────────────────────────────────────────────────────────
export function __runLegacyLotRemovalCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL legacy-lot-removal-core: " + m);
    passed += 1;
  };
  const keys = new Set(["pos-a", "pos-b"]);
  const plan = planLegacyRemoval(
    [
      { id: "1", posProductKey: "pos-a", onHandQty: "3", status: "active", productName: "B" },
      { id: "2", posProductKey: "pos-b", onHandQty: 0, status: "sold_out" },
      { id: "3", posProductKey: "pos-c", onHandQty: 9, status: "active" },
      { id: "4", posProductKey: "pos-b", onHandQty: 2, status: "active", productName: "A" },
      { id: "5", posProductKey: "pos-a", onHandQty: 4, status: "quarantine" },
    ],
    keys,
  );
  ok(plan.lots === 2 && plan.units === 5 && plan.skippedEmpty === 2, "only flagged active lots with stock");
  ok(plan.rows[0].id === "4", "stable order by name");
  ok(parseLegacyRemovalConfirm(" remove  2 ", 2).ok, "typed phrase normalised");
  ok(!parseLegacyRemovalConfirm("REMOVE 3", 2).ok, "stale count refused");
  ok(!parseLegacyRemovalConfirm("REMOVE 0", 0).ok, "nothing to remove refused");
  ok(legacyRemovalNote("x".repeat(400)).length === 250, "detail clamped to the CCRS 250");
  return { passed, failed: 0 };
}
