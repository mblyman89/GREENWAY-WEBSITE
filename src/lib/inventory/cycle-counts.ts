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
 * Create a new cycle-count session and snapshot the current system on-hand for
 * the selected lots (or all active lots if none specified). Blind: counted_qty
 * stays null until the employee enters it.
 */
export async function createCycleCount(
  input: { label: string; scopeNote?: string | null; lotIds?: string[] | null },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  // Resolve which lots to include.
  let lotQuery = admin.from("inventory_lots").select("id, on_hand_qty").eq("status", "active");
  if (input.lotIds && input.lotIds.length > 0) {
    lotQuery = admin.from("inventory_lots").select("id, on_hand_qty").in("id", input.lotIds);
  }
  const { data: lots, error: lotErr } = await lotQuery;
  if (lotErr) return { ok: false, error: lotErr.message };
  const lotRows = (lots as { id: string; on_hand_qty: number }[] | null) ?? [];
  if (lotRows.length === 0) {
    return { ok: false, error: "No matching lots to count." };
  }

  const { data: session, error: insErr } = await admin
    .from("cycle_counts")
    .insert({
      label: input.label.trim() || "Cycle count",
      scope_note: input.scopeNote ?? null,
      status: "open",
      line_count: lotRows.length,
      variance_count: 0,
      opened_by: actorId,
    })
    .select("id")
    .single();
  if (insErr || !session) return { ok: false, error: insErr?.message ?? "Could not create session." };

  const countId = (session as { id: string }).id;
  const lines = lotRows.map((l) => ({
    count_id: countId,
    lot_id: l.id,
    system_qty: l.on_hand_qty ?? 0,
    counted_qty: null,
    variance_qty: null,
    applied: false,
  }));
  const { error: lineErr } = await admin.from("cycle_count_lines").insert(lines);
  if (lineErr) return { ok: false, error: lineErr.message };

  return { ok: true, id: countId };
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
 * Apply a session: for every line with a non-zero variance that has been
 * counted and not yet applied, write an inventory_adjustments row (reason
 * 'count', qty_delta = variance) and bump the lot's on-hand. Idempotent —
 * already-applied lines are skipped, and re-running an applied session is a
 * no-op. Returns how many adjustments were posted.
 */
export async function applyCycleCount(
  countId: string,
  actorId: string | null,
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const session = await getCycleCount(countId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status === "cancelled") {
    return { ok: false, error: "Cancelled sessions cannot be applied." };
  }

  const { data: lineData } = await admin
    .from("cycle_count_lines")
    .select("id, lot_id, system_qty, counted_qty, variance_qty, note, applied")
    .eq("count_id", countId);
  const lines = (lineData as CycleCountLine[] | null) ?? [];

  let applied = 0;
  for (const line of lines) {
    if (line.applied) continue;
    if (line.counted_qty == null) continue; // never counted
    const variance = Number(line.variance_qty ?? 0);
    if (variance === 0) {
      // Nothing to post, but mark counted lines applied so they're final.
      await admin.from("cycle_count_lines").update({ applied: true }).eq("id", line.id);
      continue;
    }

    // Post the variance as a 'count' adjustment and bump on-hand.
    const { data: lot } = await admin
      .from("inventory_lots")
      .select("on_hand_qty")
      .eq("id", line.lot_id)
      .maybeSingle();
    if (!lot) continue;

    const { error: adjErr } = await admin.from("inventory_adjustments").insert({
      lot_id: line.lot_id,
      qty_delta: variance,
      reason: "count",
      note: line.note ?? `Cycle count: ${session.label}`,
      actor_id: actorId,
    });
    if (adjErr) return { ok: false, error: adjErr.message };

    const current = Number((lot as { on_hand_qty: number }).on_hand_qty) || 0;
    await admin
      .from("inventory_lots")
      .update({ on_hand_qty: current + variance, updated_by: actorId })
      .eq("id", line.lot_id);

    await admin.from("cycle_count_lines").update({ applied: true }).eq("id", line.id);
    applied += 1;
  }

  await admin
    .from("cycle_counts")
    .update({ status: "applied", applied_by: actorId, applied_at: new Date().toISOString() })
    .eq("id", countId);

  return { ok: true, applied };
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
