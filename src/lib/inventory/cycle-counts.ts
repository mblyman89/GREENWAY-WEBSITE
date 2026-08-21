/**
 * src/lib/inventory/cycle-counts.ts  (Run 6 / Slice 30)
 *
 * Server-side helpers for cycle counts (periodic blind physical counts) used
 * for inventory audit & cleanup (Feature C). A session snapshots system on-hand
 * per lot, the employee enters a BLIND physical count, and applying the session
 * posts each non-zero variance as an `inventory_adjustments` row (reason
 * 'count') so on-hand is corrected and the change is CCRS-reportable.
 *
 * Staff-only via the service-role client behind RLS.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
// NOTE: `applyLotDelta` (GW-012, atomic lot quantity writes) is deliberately
// NOT imported any more. This file no longer moves inventory at all — see
// applyCycleCount below. Leaving the import would make re-adding a shelf write
// a one-line change; removing it means anyone doing that has to add an import
// first, which is a visible act in a diff rather than an invisible one.
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";

export type CycleCountStatus = "open" | "applied" | "cancelled";

export type CycleCount = {
  id: string;
  label: string;
  status: CycleCountStatus;
  scope_note: string | null;
  line_count: number;
  variance_count: number;
  opened_by: string | null;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CycleCountLine = {
  id: string;
  count_id: string;
  lot_id: string;
  system_qty: number;
  counted_qty: number | null;
  variance_qty: number | null;
  note: string | null;
  applied: boolean;
  created_at: string;
  updated_at: string;
};

export type CycleCountLineWithLot = CycleCountLine & {
  lot_code: string | null;
  product_name: string | null;
  unit: string | null;
};

/** List sessions, newest first. */
export async function listCycleCounts(limit = 50): Promise<CycleCount[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_counts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as CycleCount[] | null) ?? [];
}

export async function getCycleCount(id: string): Promise<CycleCount | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("cycle_counts").select("*").eq("id", id).maybeSingle();
  return (data as CycleCount | null) ?? null;
}

/** Lines for a session, joined with lot identity, with system_qty as baseline. */
export async function getCycleCountLines(countId: string): Promise<CycleCountLineWithLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_count_lines")
    .select("*, lot:inventory_lots(lot_code, product_name, unit)")
    .eq("count_id", countId)
    .order("created_at", { ascending: true });
  const rows = (data as unknown as (CycleCountLine & { lot: unknown })[] | null) ?? [];
  return rows.map((r) => {
    const lotRel = r.lot;
    const lot = (Array.isArray(lotRel) ? lotRel[0] : lotRel) as
      | { lot_code: string | null; product_name: string | null; unit: string | null }
      | null;
    return {
      ...r,
      lot_code: lot?.lot_code ?? null,
      product_name: lot?.product_name ?? null,
      unit: lot?.unit ?? null,
    };
  });
}

export type CycleCountScanLine = {
  lineId: string;
  lotId: string;
  lotCode: string | null;
  posProductKey: string | null;
  productName: string | null;
};

/**
 * Lines for a session shaped for barcode matching (Slice 68). Includes the
 * lot_code + pos_product_key so a scanned code can be resolved client-side.
 */
export async function getCycleCountScanLines(countId: string): Promise<CycleCountScanLine[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_count_lines")
    .select("id, lot_id, lot:inventory_lots(lot_code, pos_product_key, product_name)")
    .eq("count_id", countId)
    .order("created_at", { ascending: true });
  const rows =
    (data as unknown as { id: string; lot_id: string; lot: unknown }[] | null) ?? [];
  return rows.map((r) => {
    const lotRel = r.lot;
    const lot = (Array.isArray(lotRel) ? lotRel[0] : lotRel) as
      | { lot_code: string | null; pos_product_key: string | null; product_name: string | null }
      | null;
    return {
      lineId: r.id,
      lotId: r.lot_id,
      lotCode: lot?.lot_code ?? null,
      posProductKey: lot?.pos_product_key ?? null,
      productName: lot?.product_name ?? null,
    };
  });
}

/**
 * Rich, enriched lines for the "scan to Excel" round trip (Beautification B5).
 * Joins each line's lot to its identity + classification and resolves vendor /
 * brand display names so the export sheet and the filter/sort UI have every
 * field the owner asked to slice on. Shaped to the PURE core's SheetLine.
 */
export type CycleCountSheetLine = {
  lineId: string;
  lotId: string;
  lotCode: string | null;
  posProductKey: string | null;
  productName: string | null;
  strainName: string | null;
  /** RAW LCB inventory_category as stored (untouched — CCRS truth). */
  category: string | null;
  /** RAW LCB inventory_type as stored (untouched — CCRS truth). */
  inventoryType: string | null;
  /** OUR website category value, resolved for back-office filtering (Request B). */
  websiteCategory: string | null;
  /** Human label for websiteCategory (raw label when unmapped). */
  websiteCategoryLabel: string | null;
  /** true when the raw LCB type could not be mapped to our convention. */
  categoryUnmapped: boolean;
  vendorName: string | null;
  brandName: string | null;
  unit: string | null;
  systemQty: number;
  countedQty: number | null;
  isSample: boolean;
  isMedical: boolean;
};

export async function getCycleCountSheetLines(countId: string): Promise<CycleCountSheetLine[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_count_lines")
    .select(
      "id, lot_id, system_qty, counted_qty, lot:inventory_lots(lot_code, pos_product_key, product_name, strain_name, category, inventory_type, unit, is_sample, is_medical, vendor_id, brand_id)",
    )
    .eq("count_id", countId)
    .order("created_at", { ascending: true });

  type LotRel = {
    lot_code: string | null;
    pos_product_key: string | null;
    product_name: string | null;
    strain_name: string | null;
    category: string | null;
    inventory_type: string | null;
    unit: string | null;
    is_sample: boolean | null;
    is_medical: boolean | null;
    vendor_id: string | null;
    brand_id: string | null;
  };
  const rows =
    (data as unknown as {
      id: string;
      lot_id: string;
      system_qty: number;
      counted_qty: number | null;
      lot: unknown;
    }[] | null) ?? [];

  const lotOf = (r: (typeof rows)[number]): LotRel | null => {
    const rel = r.lot;
    return (Array.isArray(rel) ? rel[0] : rel) as LotRel | null;
  };

  // Resolve vendor + brand display names in one round trip each.
  const vendorIds = [...new Set(rows.map((r) => lotOf(r)?.vendor_id).filter(Boolean))] as string[];
  const brandIds = [...new Set(rows.map((r) => lotOf(r)?.brand_id).filter(Boolean))] as string[];
  const vendorMap = new Map<string, string>();
  const brandMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: v } = await admin.from("vendors").select("id, display_name").in("id", vendorIds);
    for (const row of (v as { id: string; display_name: string }[] | null) ?? []) vendorMap.set(row.id, row.display_name);
  }
  if (brandIds.length > 0) {
    const { data: b } = await admin.from("brands").select("id, display_name").in("id", brandIds);
    for (const row of (b as { id: string; display_name: string }[] | null) ?? []) brandMap.set(row.id, row.display_name);
  }

  // Base lines (raw LCB values kept verbatim).
  const baseLines = rows.map((r) => {
    const lot = lotOf(r);
    return {
      lineId: r.id,
      lotId: r.lot_id,
      lotCode: lot?.lot_code ?? null,
      posProductKey: lot?.pos_product_key ?? null,
      productName: lot?.product_name ?? null,
      strainName: lot?.strain_name ?? null,
      category: lot?.category ?? null,
      inventoryType: lot?.inventory_type ?? null,
      vendorName: lot?.vendor_id ? vendorMap.get(lot.vendor_id) ?? null : null,
      brandName: lot?.brand_id ? brandMap.get(lot.brand_id) ?? null : null,
      unit: lot?.unit ?? null,
      systemQty: Number(r.system_qty) || 0,
      countedQty: r.counted_qty == null ? null : Number(r.counted_qty),
      isSample: Boolean(lot?.is_sample),
      isMedical: Boolean(lot?.is_medical),
    };
  });

  // Convert each raw LCB line onto OUR website category (Request B). Resolver is
  // read-only — it NEVER mutates the stored LCB/CCRS `category`/`inventory_type`.
  const resolutions = await resolveWebsiteCategories(
    baseLines.map((l) => ({
      posProductKey: l.posProductKey,
      productName: l.productName,
      inventoryType: l.inventoryType,
      category: l.category,
    })),
  );

  return baseLines.map((l, i) => {
    const res = resolutions[i];
    return {
      ...l,
      websiteCategory: res?.websiteCategory ?? null,
      websiteCategoryLabel: res?.label ?? null,
      categoryUnmapped: res?.unmapped ?? true,
    };
  });
}

/**
 * Add scanned units to a line's counted quantity. Each scan of a unit bumps the
 * running physical count by `by` (default 1). Session must still be open and the
 * line not yet applied (hardening). Recomputes variance + caches the session's
 * variance count. Returns the new counted quantity.
 */
export async function bumpLineCount(
  input: { lineId: string; by?: number },
): Promise<{ ok: true; countedQty: number; countId: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const by = Number.isFinite(input.by) ? Number(input.by) : 1;

  const { data: line } = await admin
    .from("cycle_count_lines")
    .select("id, count_id, system_qty, counted_qty, applied")
    .eq("id", input.lineId)
    .maybeSingle();
  if (!line) return { ok: false, error: "Count line not found." };
  const l = line as {
    count_id: string;
    system_qty: number;
    counted_qty: number | null;
    applied: boolean;
  };
  if (l.applied) return { ok: false, error: "This line has already been applied." };

  // Guard: the parent session must still be open.
  const { data: parent } = await admin
    .from("cycle_counts")
    .select("status")
    .eq("id", l.count_id)
    .maybeSingle();
  if (!parent || (parent as { status: string }).status !== "open") {
    return { ok: false, error: "This count session is closed." };
  }

  const nextQty = Math.max(0, (l.counted_qty ?? 0) + by);
  const variance = nextQty - (Number(l.system_qty) || 0);
  const { error } = await admin
    .from("cycle_count_lines")
    .update({ counted_qty: nextQty, variance_qty: variance })
    .eq("id", input.lineId);
  if (error) return { ok: false, error: error.message };

  await refreshVarianceCount(l.count_id);
  return { ok: true, countedQty: nextQty, countId: l.count_id };
}

/**
 * RETIRED (slice books-23). Creating a standalone cycle count now refuses.
 *
 * WHY THIS IS REFUSED IN THE LIBRARY AND NOT JUST IN THE USER INTERFACE
 *
 * The two buttons that used to call this (`createCycleCountAction` and
 * `createOverdueCycleCountAction`) were removed from the counting screen in this
 * same slice. Deleting a button does NOT remove the capability: in Next.js an
 * exported `"use server"` function keeps a stable action id and stays reachable
 * by an HTTP POST after its button is gone. So the button removal is cosmetic
 * and this refusal is the actual change.
 *
 * It also has to live here rather than in a database policy for the same reason
 * `applyCycleCount` did: the line below this comment used to call
 * `createSupabaseAdminClient()`, which authenticates with the service-role key.
 * Under that key `auth.uid()` is null and row-level security is bypassed
 * entirely, so no policy on `cycle_counts` can stop this function. A refusal in
 * the function body is the only lock that is actually in the path.
 *
 * WHY A COUNT MAY NO LONGER START HERE
 *
 * The owner's workflow is: the system proposes what it thinks should be counted,
 * the OWNER approves that scope, and only then does the job reach the counting
 * floor. A session created straight from the counting screen skips the approval
 * step, which means product could be recounted and written off without the owner
 * ever having agreed the count should happen. Scope now starts in Inventory
 * Auditing, where approving it is a deliberate act by the one person allowed to
 * make it.
 *
 * The signature is preserved on purpose. Narrowing it would turn a refusal that
 * every existing caller receives at run time into a compile error, and a compile
 * error can be made to go away by deleting the call — which is the one outcome
 * that must not be quiet.
 *
 * The original body that snapshotted on-hand for the selected lots was deleted
 * rather than parked in a helper below. A copy of a retired write path sitting in
 * the same file is an invitation to paste it back, and it would have kept this
 * file importing the service-role client for a purpose that no longer exists. Git
 * history has the old shape if it is ever needed.
 */
export async function createCycleCount(
  input: { label: string; scopeNote?: string | null; lotIds?: string[] | null },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  void input;
  void actorId;
  return {
    ok: false,
    error:
      "CYCLE_COUNT_CREATE_RETIRED: counts no longer start on this screen, on purpose. " +
      "A count that begins here skips your approval, which means product could be " +
      "recounted and written off without you ever agreeing the count should happen. " +
      "Start it in Inventory Auditing instead: the system proposes what it thinks is " +
      "worth counting, you approve the scope, and the job then appears on this screen " +
      "for staff to count. Nothing has been created and nothing has been changed.",
  };
}

/** Record a blind physical count for one line; computes the variance. */
export async function recordLineCount(
  input: { lineId: string; countedQty: number; note?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: line } = await admin
    .from("cycle_count_lines")
    .select("id, count_id, system_qty, applied")
    .eq("id", input.lineId)
    .maybeSingle();
  if (!line) return { ok: false, error: "Count line not found." };
  if ((line as { applied: boolean }).applied) {
    return { ok: false, error: "This line has already been applied." };
  }

  const systemQty = Number((line as { system_qty: number }).system_qty) || 0;
  const variance = input.countedQty - systemQty;

  const { error } = await admin
    .from("cycle_count_lines")
    .update({
      counted_qty: input.countedQty,
      variance_qty: variance,
      note: input.note ?? null,
    })
    .eq("id", input.lineId);
  if (error) return { ok: false, error: error.message };

  // Refresh the session's cached variance count.
  await refreshVarianceCount((line as { count_id: string }).count_id);
  return { ok: true };
}

/** Recompute and cache how many lines have a non-zero variance. */
async function refreshVarianceCount(countId: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_count_lines")
    .select("variance_qty")
    .eq("count_id", countId);
  const rows = (data as { variance_qty: number | null }[] | null) ?? [];
  const variances = rows.filter((r) => (r.variance_qty ?? 0) !== 0).length;
  await admin.from("cycle_counts").update({ variance_count: variances }).eq("id", countId);
}

/**
 * REFUSED. This function used to move inventory and never told the books.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT USED TO DO, AND WHY THAT WAS THE WORST BUG IN THE SYSTEM
 * ───────────────────────────────────────────────────────────────────────────
 * For every counted line with a non-zero variance it inserted an
 * `inventory_adjustments` row, moved `inventory_lots.on_hand_qty` via
 * `applyLotDelta`, marked the line applied, and set the session to 'applied'.
 *
 * It never wrote a journal. There was no journal to write to: migration 0041
 * gave `cycle_counts` no general-ledger column of any kind, and this file never
 * imported `submitJournal`. So product VALUE left the shelf and the general
 * ledger never heard about it. Inventory on the balance sheet stayed too high
 * forever, cost of goods sold stayed too low, and taxable income was overstated
 * by the difference — permanently, and invisibly, because nothing anywhere
 * compared the two.
 *
 * That is not an abstract risk. It is the exact mechanism that produced
 * "20009 LAZY INVENTORY ENTRY" holding +4,624,697.31 in the Sage file — 105.4%
 * of a hole that 8 of 11 inventory accounts were carrying as impossible CREDIT
 * balances. A count that corrects the shelf without correcting the books does
 * not fix a discrepancy; it MOVES the discrepancy somewhere nobody is looking.
 *
 * It was also unguarded in a way nothing else in this system is. It ran on
 * `createSupabaseAdminClient()` — the service-role key — which carries no `sub`
 * claim, so `auth.uid()` is NULL inside the database and Row Level Security is
 * bypassed entirely (see books-client.ts for the full write-up of that class of
 * bug). No database policy could stop it. The only thing between an admin
 * manager and a permanent, unrecorded inventory write-off was one line of
 * application code, `requirePermission("inventory.manage")`, which GRANTS the
 * manager role. And it had zero test coverage.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY IT REFUSES INSTEAD OF BEING DELETED
 * ───────────────────────────────────────────────────────────────────────────
 * Deleting the export would be a compile error at every call site, which sounds
 * like the safer option and is not. A compile error gets "fixed", and the
 * fastest fix available to whoever hits it is to paste the old body back in.
 * A function that is still here and REFUSES, with the reason attached, cannot
 * be repaired by accident — and the refusal is testable, which a deleted
 * function is not (standing rule 43: a refusal code no path emits is
 * decoration; this one is emitted on every call).
 *
 * This is the innermost of three layers, and it is THE GUARANTEE. The button is
 * gone from the page and the server action refuses too, but those are the outer
 * two: a page can be re-added and a server action can be called directly. The
 * database cannot help here, for the service-key reason above. So the lock has
 * to live in this function, and it does.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT REPLACES IT
 * ───────────────────────────────────────────────────────────────────────────
 * The inventory audit path, which was built correctly in books-10/11/12 and
 * was simply never wired to a button:
 *
 *   owner scopes an audit  →  staff count it blind  →  owner reviews every
 *   variance and records a reason  →  owner approves  →  the shelf moves and a
 *   journal entry is DRAFTED for the owner to post.
 *
 * Every step of that is gated in the DATABASE on `is_owner()` (migrations 0191
 * and 0192), not merely in a page. The shelf move and the CCRS adjustment row
 * happen inside one atomic function, so they cannot half-succeed.
 *
 * The historical `cycle_counts` rows are NOT deleted and are still readable.
 * WAC 314-55-087(2)(c) requires these records be keepable for years, and a
 * record of what was counted in 2023 does not become false because the process
 * that produced it was wrong. It stays, as history.
 */
export async function applyCycleCount(
  countId: string,
  actorId: string | null,
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  // The parameters are read so that this refusal cannot be mistaken for an
  // unfinished stub, and so no linter "helpfully" removes them from the
  // signature — the signature is what keeps every caller compiling.
  void countId;
  void actorId;

  return {
    ok: false,
    error:
      "CYCLE_COUNT_APPLY_RETIRED: applying a cycle count directly has been turned off, " +
      "on purpose. It corrected the shelf but never wrote anything to the general ledger, " +
      "so the value of the missing product stayed on the balance sheet forever and cost of " +
      "goods sold was understated by the same amount. That is how the old Sage file " +
      "accumulated a $4,624,697.31 inventory plug that nobody ever decided to make. " +
      "Nothing has been changed. Use Inventory Auditing instead: the owner approves what " +
      "to count, staff count it blind, the owner reviews every difference and records why, " +
      "and only then does the shelf move — with a matching journal entry drafted for the " +
      "owner to approve. Any counts already recorded here are safe and still readable.",
  };
}

/** Cancel an open session (no adjustments posted). */
export async function cancelCycleCount(
  countId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const session = await getCycleCount(countId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status === "applied") {
    return { ok: false, error: "Applied sessions cannot be cancelled." };
  }
  const { error } = await admin.from("cycle_counts").update({ status: "cancelled" }).eq("id", countId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type CycleCountSummary = {
  open: number;
  appliedLast30: number;
  totalAdjustmentsLast30: number;
};

export async function cycleCountSummary(): Promise<CycleCountSummary> {
  const empty: CycleCountSummary = { open: 0, appliedLast30: 0, totalAdjustmentsLast30: 0 };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count: openCount } = await admin
    .from("cycle_counts")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  const { count: appliedCount } = await admin
    .from("cycle_counts")
    .select("id", { count: "exact", head: true })
    .eq("status", "applied")
    .gte("applied_at", since);

  const { count: adjCount } = await admin
    .from("inventory_adjustments")
    .select("id", { count: "exact", head: true })
    .eq("reason", "count")
    .gte("created_at", since);

  return {
    open: openCount ?? 0,
    appliedLast30: appliedCount ?? 0,
    totalAdjustmentsLast30: adjCount ?? 0,
  };
}
