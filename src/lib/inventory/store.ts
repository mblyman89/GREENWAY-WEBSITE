/**
 * src/lib/inventory/store.ts
 *
 * Server-side read/write helpers for inventory lots, lab results (COA),
 * inbound manifests, and inventory adjustments. Staff-only — all access via the
 * service-role client behind RLS. Part of POS Slice 3 (compliance backbone).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";
import { pagedAll, chunkedIn } from "@/lib/supabase/chunked-in";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import type { ReceivedDateLot } from "@/lib/inventory/received-date-core";
import type { BulkFillLot, BulkFillField } from "@/lib/inventory/bulk-fill-core";
import {
  countLotGaps,
  computeOnHandCost,
  type LotGapKey,
} from "@/lib/inventory/lot-gap-core";
import type { SortColumn } from "@/lib/admin/list-filter-core";
import type {
  InboundManifest,
  InventoryAdjustment,
  InventoryLot,
  LabResult,
  LotWithDetail,
} from "@/lib/inventory/types";

/** Number of days within which an expiry counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

type LotFilter = {
  q?: string;
  status?: string;
  limit?: number;
};

/**
 * Today as an ISO date string for date comparisons.
 *
 * SLICE 2 (Rule 8): this used to be `new Date().toISOString().slice(0,10)`,
 * i.e. the UTC day. This host runs UTC, which is 7–8 hours AHEAD of Port
 * Orchard, so from ~4–5pm Pacific onward the "today" used to bucket expiries
 * was already tomorrow's date. A lot expiring today would flip into the
 * "expired" count most of the evening, every evening. The business clock is
 * America/Los_Angeles.
 */
function todayIso(): string {
  return pacificToday();
}

/** Date N days from now as an ISO date string, on the Pacific calendar (Rule 8). */
function isoDaysFromNow(days: number): string {
  return addPacificDays(pacificToday(), days);
}

/**
 * GW-033: paged inventory read. Returns the page's hydrated lots AND the
 * exact total so the inventory page can show "Showing X–Y of Z" with a real
 * pager instead of silently clipping at 500 rows.
 *
 * SLICE 26: accepts whitelisted sort columns (list-filter-core.LOT_SORTS)
 * plus COA/sample/medical tri-state flags and an expiring-within-days
 * window — every knob validated upstream by the pure grammar.
 */
export async function listLotsPaged(
  opts: Omit<LotFilter, "limit"> & {
    from: number;
    to: number;
    sort?: SortColumn[];
    /** true = has COA, false = missing COA, undefined = off. */
    hasCoa?: boolean;
    /** Tri-state sample / medical flags (undefined = off). */
    isSample?: boolean;
    isMedical?: boolean;
    /** Only lots expiring on/before today+N days (still in date). */
    expiringWithinDays?: number;
    /** SLICE 77: only lots supplied by this vendor (vendors ⇄ inventory link). */
    vendorId?: string;
    /**
     * SLICE 2: only lots with NO evidenced received date (excluding destroyed
     * lots, which are out of inventory). This is the owner's worklist filter,
     * reached from the "Received dates missing" banner.
     */
    needsReceivedDate?: boolean;
    /**
     * SLICE 7 — the enrichment-gap worklist knobs. Each one isolates exactly
     * the rows its counter counts (see lot-gap-core.ts), so the "Fix →" link
     * and the number beside it can never disagree.
     */
    gaps?: readonly LotGapKey[];
  },
): Promise<{ rows: LotWithDetail[]; total: number }> {
  if (!isSupabaseServiceConfigured) return { rows: [], total: 0 };
  const admin = createSupabaseAdminClient();

  let query = admin.from("inventory_lots").select("*", { count: "exact" });

  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.vendorId) {
    query = query.eq("vendor_id", opts.vendorId);
  }
  const like = opts.q ? ilikeContains(opts.q) : null;
  if (like) {
    query = query.or(
      [
        `product_name.ilike.${like}`,
        `lot_code.ilike.${like}`,
        `pos_product_key.ilike.${like}`,
      ].join(","),
    );
  }
  if (opts.hasCoa === true) query = query.not("lab_result_id", "is", null);
  if (opts.hasCoa === false) query = query.is("lab_result_id", null);
  if (opts.needsReceivedDate) {
    // Mirrors the pure core's CLOSED_STATUSES and computeInventoryStats(), so
    // the banner's count and this list can never disagree.
    query = query.is("received_on", null).neq("status", "destroyed");
  }
  // SLICE 7 — enrichment gap filters. Each predicate MIRRORS the pure core's
  // `matches()` for that gap, including its edge cases:
  //   * pos_product_key: the counter uses `!key`, so the EMPTY STRING counts
  //     too. A bare `.is(null)` would under-select and the list would show
  //     fewer rows than the badge promised — the exact SLICE 6A defect.
  //   * on_hand_qty: `not null default 0`, so `<= 0` is the real case and it
  //     also catches negative corrections.
  //   * expires_on / unit_cost_minor_units: NULL is the unknown.
  // Every gap is additionally scoped to active, matching the counter's
  // `if (r.status === "active")` guard.
  for (const key of opts.gaps ?? []) {
    query = query.eq("status", "active");
    if (key === "missingProductLink") {
      query = query.or("pos_product_key.is.null,pos_product_key.eq.");
    } else if (key === "emptyActive") {
      query = query.lte("on_hand_qty", 0);
    } else if (key === "missingExpiry") {
      query = query.is("expires_on", null);
    } else if (key === "unknownCost") {
      query = query.is("unit_cost_minor_units", null);
    }
  }
  if (opts.isSample !== undefined) query = query.eq("is_sample", opts.isSample);
  if (opts.isMedical !== undefined) query = query.eq("is_medical", opts.isMedical);
  if (opts.expiringWithinDays != null) {
    const horizon = new Date(Date.now() + opts.expiringWithinDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    query = query.not("expires_on", "is", null).lte("expires_on", horizon);
  }

  const sort: SortColumn[] = opts.sort ?? [{ column: "created_at", ascending: false }];
  for (const s of sort) {
    query = query.order(s.column, {
      ascending: s.ascending,
      ...(s.nullsFirst !== undefined ? { nullsFirst: s.nullsFirst } : {}),
    });
  }

  const { data, count } = await query.range(opts.from, opts.to);
  const lots = (data as InventoryLot[] | null) ?? [];
  const total = count ?? 0;
  if (lots.length === 0) return { rows: [], total };
  return { rows: await hydrateLots(admin, lots), total };
}

/**
 * SLICE 13 — load EVERY lot, fully hydrated, for the inventory page's
 * filter/sort/search engine.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT WASTEFUL
 * -----------------------------------------------------------------------
 * `listLotsPaged` fetches one 100-row page and then calls `hydrateLots` to
 * resolve vendor name, brand name and the COA for THAT PAGE ONLY. That
 * ordering makes the owner's request impossible to satisfy: you cannot filter
 * or sort by vendor name, brand, THC or CBD when the query that does the
 * filtering and sorting has never seen those values. Pushing them into SQL is
 * not available either — they live in three other tables and the page's
 * "type" column is a derived label, not a column at all.
 *
 * So the whole set is loaded, then filtered, sorted and paginated in pure
 * code. The cost is real but already being paid: `computeInventoryStats()`
 * (store.ts, SLICE 2) and `getInventoryCommandCenter()` each ALREADY walk
 * every lot row via `pagedAll` on every single load of this page. This adds a
 * third walk of the same table plus three small id-keyed lookups, and in
 * exchange every field on the row becomes filterable and sortable.
 *
 * Completeness is not assumed. `pagedAll` walks `.range()` until a short page
 * returns, and the `.order("id")` is required for that walk to be
 * deterministic (chunked-in.ts:33-34) — without a stable sort PostgREST may
 * return rows in an arbitrary order per page and pages can overlap or skip.
 * `hydrateLotsChunked` then resolves the joins in id chunks so a 4,000-lot
 * store cannot overflow the PostgREST query string.
 */
export async function listAllLotsForFiltering(): Promise<LotWithDetail[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  const lots = await pagedAll<InventoryLot>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("*")
      .order("id", { ascending: true })
      .range(from, to);
    return (data as InventoryLot[] | null) ?? [];
  });
  if (lots.length === 0) return [];
  return hydrateLotsChunked(admin, lots);
}

/**
 * `hydrateLots` for an arbitrarily large lot list. Identical resolution rules
 * — same tables, same columns, same "id not found means null" behaviour — but
 * the three lookups are chunked so the id lists cannot overflow the query
 * string (the M-4 truncation family; see chunked-in.ts).
 */
async function hydrateLotsChunked(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lots: InventoryLot[],
): Promise<LotWithDetail[]> {
  const vendorIds = [...new Set(lots.map((l) => l.vendor_id).filter(Boolean))] as string[];
  const brandIds = [...new Set(lots.map((l) => l.brand_id).filter(Boolean))] as string[];
  const labIds = [...new Set(lots.map((l) => l.lab_result_id).filter(Boolean))] as string[];

  const vendorMap = new Map<string, string>();
  const brandMap = new Map<string, string>();
  const labMap = new Map<string, LabResult>();

  if (vendorIds.length > 0) {
    const rows = await chunkedIn<string, { id: string; display_name: string }>(
      vendorIds,
      async (chunk, from, to) => {
        const { data } = await admin
          .from("vendors")
          .select("id, display_name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        return (data as { id: string; display_name: string }[] | null) ?? [];
      },
    );
    for (const v of rows) vendorMap.set(v.id, v.display_name);
  }
  if (brandIds.length > 0) {
    const rows = await chunkedIn<string, { id: string; display_name: string }>(
      brandIds,
      async (chunk, from, to) => {
        const { data } = await admin
          .from("brands")
          .select("id, display_name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        return (data as { id: string; display_name: string }[] | null) ?? [];
      },
    );
    for (const b of rows) brandMap.set(b.id, b.display_name);
  }
  if (labIds.length > 0) {
    const rows = await chunkedIn<string, LabResult>(labIds, async (chunk, from, to) => {
      const { data } = await admin
        .from("lab_results")
        .select("*")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return (data as LabResult[] | null) ?? [];
    });
    for (const r of rows) labMap.set(r.id, r);
  }

  return lots.map((l) => ({
    ...l,
    vendor_name: l.vendor_id ? vendorMap.get(l.vendor_id) ?? null : null,
    brand_name: l.brand_id ? brandMap.get(l.brand_id) ?? null : null,
    lab: l.lab_result_id ? labMap.get(l.lab_result_id) ?? null : null,
  }));
}

export async function listLots(opts?: LotFilter): Promise<LotWithDetail[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("inventory_lots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 500);

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  // GW-021: escape LIKE wildcards + .or() grammar so the term matches literally.
  const like = opts?.q ? ilikeContains(opts.q) : null;
  if (like) {
    query = query.or(
      [
        `product_name.ilike.${like}`,
        `lot_code.ilike.${like}`,
        `pos_product_key.ilike.${like}`,
      ].join(","),
    );
  }

  const { data } = await query;
  const lots = (data as InventoryLot[] | null) ?? [];
  if (lots.length === 0) return [];

  return hydrateLots(admin, lots);
}

/** Resolve vendor names, brand names, and lab results for a set of lots. */
async function hydrateLots(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lots: InventoryLot[],
): Promise<LotWithDetail[]> {
  const vendorIds = [...new Set(lots.map((l) => l.vendor_id).filter(Boolean))] as string[];
  const brandIds = [...new Set(lots.map((l) => l.brand_id).filter(Boolean))] as string[];
  const labIds = [...new Set(lots.map((l) => l.lab_result_id).filter(Boolean))] as string[];

  const vendorMap = new Map<string, string>();
  const brandMap = new Map<string, string>();
  const labMap = new Map<string, LabResult>();

  if (vendorIds.length > 0) {
    const { data } = await admin
      .from("vendors")
      .select("id, display_name")
      .in("id", vendorIds);
    for (const v of (data as { id: string; display_name: string }[] | null) ?? []) {
      vendorMap.set(v.id, v.display_name);
    }
  }
  if (brandIds.length > 0) {
    const { data } = await admin
      .from("brands")
      .select("id, display_name")
      .in("id", brandIds);
    for (const b of (data as { id: string; display_name: string }[] | null) ?? []) {
      brandMap.set(b.id, b.display_name);
    }
  }
  if (labIds.length > 0) {
    const { data } = await admin.from("lab_results").select("*").in("id", labIds);
    for (const r of (data as LabResult[] | null) ?? []) {
      labMap.set(r.id, r);
    }
  }

  return lots.map((l) => ({
    ...l,
    vendor_name: l.vendor_id ? vendorMap.get(l.vendor_id) ?? null : null,
    brand_name: l.brand_id ? brandMap.get(l.brand_id) ?? null : null,
    lab: l.lab_result_id ? labMap.get(l.lab_result_id) ?? null : null,
  }));
}

export type InventoryStats = {
  total: number;
  active: number;
  quarantine: number;
  recalled: number;
  destroyed: number;
  soldOut: number;
  /** Active lots with on-hand quantity at or below zero (need restock/cleanup). */
  emptyActive: number;
  /** Active lots missing a linked COA (compliance gap). */
  missingCoa: number;
  /** Active lots missing a POS product key (won't tie to the catalog). */
  missingProductLink: number;
  /** Active lots expiring within EXPIRING_SOON_DAYS. */
  expiringSoon: number;
  /** Active lots already past their expiry date. */
  expired: number;
  /**
   * SLICE 7 — active lots with NO expiry date on file. Previously counted by
   * NOTHING: the stats loop read `if (r.expires_on)`, so a lot with an unknown
   * expiry fell through both the `expired` and `expiringSoon` branches and was
   * invisible to the "Needs attention" tile. NULL means UNKNOWN, never "fine".
   */
  missingExpiry: number;
  /**
   * SLICE 7 — active lots with NO unit cost on file. These silently contribute
   * 0 to `onHandCostMinor`, which is the remaining half of the owner's original
   * "wrong on-hand cost" report (the other half was the 1,000-row truncation).
   */
  unknownCost: number;
  /** Total inventory cost at hand in MINOR UNITS (sum of on_hand * unit_cost). */
  onHandCostMinor: number;
  /**
   * SLICE 7 — how many IN-STOCK lots were skipped from `onHandCostMinor`
   * because their unit cost is unknown. `0` means the total is complete.
   */
  costSkippedUnknown: number;
  /**
   * SLICE 2 — lots with NO received date on file (excluding destroyed lots).
   * NULL received_on means UNKNOWN, never "today" (migration 0214, following
   * the 0191.last_counted_at doctrine). This is the count the owner is asked
   * to clear, because CCRS Inventory.CreatedDate falls back to the import
   * instant while it is unknown.
   */
  missingReceivedDate: number;
  /** The urgent subset: missing a received date AND still holding sellable stock. */
  missingReceivedDateWithStock: number;
};

export async function computeInventoryStats(): Promise<InventoryStats> {
  const empty: InventoryStats = {
    total: 0,
    active: 0,
    quarantine: 0,
    recalled: 0,
    destroyed: 0,
    soldOut: 0,
    emptyActive: 0,
    missingCoa: 0,
    missingProductLink: 0,
    expiringSoon: 0,
    expired: 0,
    missingExpiry: 0,
    unknownCost: 0,
    onHandCostMinor: 0,
    costSkippedUnknown: 0,
    missingReceivedDate: 0,
    missingReceivedDateWithStock: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;

  const admin = createSupabaseAdminClient();

  // ═══════════════════════════════════════════════════════════════════════
  // SLICE 2 — THE HEADER THAT LIED.
  //
  // This read used to be `.select(...).limit(5000)`. `.limit()` does NOT
  // raise the PostgREST per-response row cap (`db.max_rows`, default 1000);
  // it only lowers it. So with 4,179 lots in the table this returned exactly
  // 1,000 rows, silently, with no error — and every number built from it was
  // wrong: "Total lots" read 1,000 instead of 4,179, and "cost on hand"
  // showed roughly a quarter of the true figure (~$37K against ~$197K).
  // The owner reported exactly that: "the inventory page seems to be capped
  // at 1000 products and shows strange numbers in the header section like
  // the total cost on hand is way off."
  //
  // pagedAll() walks `.range()` until a short page comes back, so the totals
  // are computed over EVERY lot. The `.order("id")` is not decorative — it
  // is what makes pagination deterministic (see chunked-in.ts:33-34); without
  // a stable sort, PostgREST may return rows in an arbitrary order per page
  // and the pages can overlap or skip.
  //
  // `received_on` is selected here so the header can flag lots with no
  // received date on file (migration 0214).
  // ═══════════════════════════════════════════════════════════════════════
  type StatsRow = {
    status: string;
    on_hand_qty: number;
    unit_cost_minor_units: number | null;
    lab_result_id: string | null;
    pos_product_key: string | null;
    expires_on: string | null;
    received_on: string | null;
  };
  const rows = await pagedAll<StatsRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select(
        "status, on_hand_qty, unit_cost_minor_units, lab_result_id, pos_product_key, expires_on, received_on, id",
      )
      .order("id", { ascending: true })
      .range(from, to);
    return (data as StatsRow[] | null) ?? [];
  });

  const today = todayIso();
  const soon = isoDaysFromNow(EXPIRING_SOON_DAYS);
  const stats = { ...empty };
  stats.total = rows.length;

  for (const r of rows) {
    switch (r.status) {
      case "active":
        stats.active += 1;
        break;
      case "quarantine":
        stats.quarantine += 1;
        break;
      case "recalled":
        stats.recalled += 1;
        break;
      case "destroyed":
        stats.destroyed += 1;
        break;
      case "sold_out":
        stats.soldOut += 1;
        break;
    }

    // SLICE 7: on-hand cost is summed by computeOnHandCost() below, which also
    // reports the lots it had to skip. Summing here as well would double-count.

    // SLICE 2: the received-date flag. Destroyed lots are excluded — they are
    // out of inventory and no longer reported, so chasing their paperwork
    // would only bury the rows that still matter. Kept identical to the pure
    // core's CLOSED_STATUSES in received-date-core.ts.
    if (!r.received_on && r.status !== "destroyed") {
      stats.missingReceivedDate += 1;
      if (r.status === "active" && (r.on_hand_qty ?? 0) > 0) {
        stats.missingReceivedDateWithStock += 1;
      }
    }

    if (r.status === "active") {
      if (!r.lab_result_id) stats.missingCoa += 1;
      if (r.expires_on) {
        if (r.expires_on < today) stats.expired += 1;
        else if (r.expires_on <= soon) stats.expiringSoon += 1;
      }
    }
  }

  // SLICE 7: the enrichment gaps are counted by the SHARED pure core, which is
  // the same definition the list filters apply. Hand-writing the predicate here
  // a second time is exactly how SLICE 6A's "Fix →" link came to disagree with
  // the number printed beside it.
  const gapCounts = countLotGaps(rows);
  stats.emptyActive = gapCounts.emptyActive;
  stats.missingProductLink = gapCounts.missingProductLink;
  stats.missingExpiry = gapCounts.missingExpiry;
  stats.unknownCost = gapCounts.unknownCost;

  // SLICE 7: the on-hand total now reports what it could NOT include, instead
  // of printing a confident figure understated by every uncosted lot.
  const cost = computeOnHandCost(rows);
  stats.onHandCostMinor = cost.totalMinor;
  stats.costSkippedUnknown = cost.skippedUnknownCost;

  return stats;
}

export async function getLotById(id: string): Promise<LotWithDetail | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inventory_lots").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [hydrated] = await hydrateLots(admin, [data as InventoryLot]);
  return hydrated ?? null;
}

export async function listLotAdjustments(lotId: string): Promise<InventoryAdjustment[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_adjustments")
    .select("*")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data as InventoryAdjustment[] | null) ?? [];
}

export async function getManifestById(id: string): Promise<InboundManifest | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inbound_manifests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as InboundManifest | null) ?? null;
}

/**
 * Record a manual inventory adjustment and update the lot's on-hand quantity.
 * Reasons: receive | shrink | damage | sample | destruction | count | recall | other.
 */
export async function createAdjustment(
  input: { lotId: string; qtyDelta: number; reason: string; note?: string | null },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: lot } = await admin
    .from("inventory_lots")
    .select("id, on_hand_qty")
    .eq("id", input.lotId)
    .maybeSingle();
  if (!lot) return { ok: false, error: "Lot not found." };

  const { error: insErr } = await admin.from("inventory_adjustments").insert({
    lot_id: input.lotId,
    qty_delta: input.qtyDelta,
    reason: input.reason,
    note: input.note ?? null,
    actor_id: actorId,
  });
  if (insErr) return { ok: false, error: insErr.message };

  const current = (lot as { on_hand_qty: number }).on_hand_qty ?? 0;
  const next = current + input.qtyDelta;
  const { error: updErr } = await admin
    .from("inventory_lots")
    .update({ on_hand_qty: next, updated_by: actorId })
    .eq("id", input.lotId);
  if (updErr) return { ok: false, error: updErr.message };

  return { ok: true };
}

/**
 * SLICE 77 — hand-correct the descriptive linkage on a lot. ONLY the four
 * legally-safe fields (vendor_id, brand_id, strain_name, strain_type) can be
 * written; the patch object's shape is enforced by lot-edit-core's parser and
 * by this signature. Traceability numbers are untouchable here.
 */
export async function updateLotDetails(
  id: string,
  patch: {
    vendor_id: string | null;
    brand_id: string | null;
    strain_name: string | null;
    strain_type: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inventory_lots")
    .update({
      vendor_id: patch.vendor_id,
      brand_id: patch.brand_id,
      strain_name: patch.strain_name,
      strain_type: patch.strain_type,
      updated_by: actorId,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * SLICE 2 — set (or clear) a lot's RECEIVED DATE.
 *
 * Deliberately its own writer rather than another key in `updateLotDetails`,
 * because this field carries provenance and attribution that the four
 * descriptive fields do not. Every write records WHO set it and WHEN, so the
 * date can always be traced back to a person (standing rule 3).
 *
 * `receivedOn` MUST already have passed `parseReceivedDateInput()`. A null
 * clears the value back to unknown, which re-raises the flag — that is a
 * legitimate action, not an error: a known-wrong date is worse than an
 * honest blank.
 *
 * NOTE: this NEVER touches `created_at`. `created_at` is the immutable
 * row-birth timestamp that FIFO costing is ordered by; rewriting it by hand
 * would silently reorder cost layers. CCRS reads the received date through
 * `ccrsInventoryCreatedDate()` instead.
 */
export async function updateLotReceivedDate(
  id: string,
  receivedOn: string | null,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inventory_lots")
    .update({
      received_on: receivedOn,
      // Clearing the date also clears its provenance — an empty value has no
      // source, and leaving a stale "owner_entered" behind would misrepresent
      // the record.
      received_on_source: receivedOn ? "owner_entered" : null,
      received_on_set_by: receivedOn ? actorId : null,
      received_on_set_at: receivedOn ? new Date().toISOString() : null,
      updated_by: actorId,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * SLICE 8 — load the selected lots for a BULK FILL preview.
 *
 * Reads only the columns the pure planner needs. `chunkedIn` keeps this
 * cap-immune: PostgREST's db.max_rows silently truncates at 1000, and a bulk
 * selection can exceed that. Never trust the client's row data — the eligibility
 * decision is made from THESE freshly-read rows, not from what the form posted.
 */
export async function listLotsForBulkFill(ids: readonly string[]): Promise<BulkFillLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  if (ids.length === 0) return [];
  const admin = createSupabaseAdminClient();
  return chunkedIn<string, BulkFillLot>(ids, async (chunk, from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, notes, status, expires_on, unit_cost_minor_units, pos_product_key, product_name")
      .in("id", chunk as string[])
      .order("id", { ascending: true })
      .range(from, to);
    return (data as BulkFillLot[] | null) ?? [];
  });
}

/**
 * SLICE 8 — apply ONE validated bulk fill to ONE lot.
 *
 * Deliberately per-row rather than a single `.in()` update, because the WHERE
 * clause carries the safety property and must be re-asserted for every row:
 *
 *   .is(<field>, null)  — the write only lands if the column is STILL blank.
 *
 * That is the last line of defence against a race: if the owner filled this lot
 * in another tab between the preview and the confirm, the update matches zero
 * rows and we report it as skipped instead of overwriting an evidenced fact.
 * `pos_product_key` additionally treats the empty string as blank (0023:96
 * allows it), so its guard is an `.or()` rather than a plain `.is()`.
 *
 * Provenance is written alongside the value (migration 0215), so every filled
 * field can name the person who supplied it and when.
 */
export async function applyBulkFill(
  lotId: string,
  field: BulkFillField,
  value: string | number,
  actorId: string | null,
): Promise<{ ok: true; filled: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (field === "expires_on") {
    patch.expires_on = value;
    patch.expires_on_source = "owner_entered";
    patch.expires_on_set_by = actorId;
    patch.expires_on_set_at = nowIso;
  } else if (field === "unit_cost_minor_units") {
    patch.unit_cost_minor_units = value;
    patch.unit_cost_source = "owner_entered";
    patch.unit_cost_set_by = actorId;
    patch.unit_cost_set_at = nowIso;
  } else {
    patch.pos_product_key = value;
    patch.pos_product_key_source = "owner_entered";
    patch.pos_product_key_set_by = actorId;
    patch.pos_product_key_set_at = nowIso;
  }

  let q = admin.from("inventory_lots").update(patch).eq("id", lotId).neq("status", "destroyed");
  // Re-assert blankness IN THE WHERE CLAUSE (see doc comment above).
  if (field === "pos_product_key") {
    q = q.or("pos_product_key.is.null,pos_product_key.eq.");
  } else {
    q = q.is(field, null);
  }

  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, filled: ((data as { id: string }[] | null) ?? []).length > 0 };
}

/**
 * SLICE 2 — every lot still missing a received date, for the owner's
 * worklist. Paged: this is exactly the population that was truncated before.
 */
export async function listLotsMissingReceivedDate(): Promise<ReceivedDateLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const rows = await pagedAll<ReceivedDateLot>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, lot_code, product_name, status, on_hand_qty, received_on, created_at")
      .is("received_on", null)
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    return (data as ReceivedDateLot[] | null) ?? [];
  });
  return rows;
}

/**
 * SLICE 77 — all lots supplied by one vendor (newest first, hydrated with
 * names + lab), for the vendor detail page's inventory cross-link panel.
 */
export async function listLotsForVendor(vendorId: string, limit = 50): Promise<LotWithDetail[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const lots = (data as InventoryLot[] | null) ?? [];
  if (lots.length === 0) return [];
  return hydrateLots(admin, lots);
}

/**
 * SLICE 77 — all lots for one POS product key (newest first, hydrated), for
 * the enrichment detail page's inventory cross-link panel.
 */
export async function listLotsForProductKey(posProductKey: string, limit = 20): Promise<LotWithDetail[]> {
  if (!isSupabaseServiceConfigured || !posProductKey) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select("*")
    .eq("pos_product_key", posProductKey)
    .order("created_at", { ascending: false })
    .limit(limit);
  const lots = (data as InventoryLot[] | null) ?? [];
  if (lots.length === 0) return [];
  return hydrateLots(admin, lots);
}

/** Update lifecycle status of a lot (e.g. recall, quarantine, destroy). */
export async function updateLotStatus(
  id: string,
  status: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inventory_lots")
    .update({ status, updated_by: actorId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
