/**
 * src/lib/cms/this-week-feed-server.ts
 *
 * D237 N-4 (SOP-22 G-114, F-22-11): loads the rows for the "This week at
 * Greenway" feed and hands them to the pure builder. Read-only, except the
 * owner's local-events list (site_settings `blog_calendar_events`).
 *
 * Every read is bounded: lots are paged with a unique order and a
 * date filter (pagedAllChecked, no `.limit(>=1000)`), vendors are filtered to
 * the week, promotions are the published ones.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked, chunkedIn } from "@/lib/supabase/chunked-in";
import { lotTypeLabel } from "@/lib/inventory/lot-table-core";
import { auditPublishedPromotions } from "@/lib/promotions/promo-guard";
import {
  BLOG_CALENDAR_KEY,
  buildThisWeekFeed,
  feedWindow,
  addDays,
  normalizeLocalEvents,
  type FeedLot,
  type FeedPromotion,
  type FeedVendor,
  type LocalEvent,
  type ThisWeekFeed,
} from "./this-week-feed-core";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

export type ThisWeekFeedResult = { feed: ThisWeekFeed; partial: boolean; belowCostChecked: boolean };

/** Lots are bounded so a bad week never loads the whole history. */
const MAX_FEED_LOTS = 5000;

export async function getLocalEvents(): Promise<LocalEvent[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", BLOG_CALENDAR_KEY).maybeSingle();
    return normalizeLocalEvents((data?.value_json as { events?: unknown } | null)?.events ?? data?.value_json ?? []);
  } catch {
    return [];
  }
}

export async function saveLocalEvents(events: LocalEvent[], updatedBy: string | null): Promise<{ error?: string }> {
  const clean = normalizeLocalEvents(events);
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: BLOG_CALENDAR_KEY,
        label: "Blog & newsletter: local events for the This week feed (D237 N-4)",
        value_json: { events: clean } as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    return error ? { error: error.message } : {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed." };
  }
}

type LotRow = {
  id: string;
  vendor_id: string | null;
  received_on: string | null;
  created_at: string;
  status: string | null;
  product_name: string | null;
  category: string | null;
  inventory_type: string | null;
};

type PromoRow = {
  id: string;
  title: string;
  status: string;
  weekday: number | null;
  starts_at: string | null;
  ends_at: string | null;
  discount_type: string;
  discount_percent: number | null;
  discount_fixed: number | null;
  bonus_note: string | null;
  config: Record<string, unknown> | null;
};

/** Build this week's feed. `withBelowCost` re-runs the promotion below-cost check (slower). */
export async function getThisWeekFeed(opts: { nowIso?: string; withBelowCost?: boolean } = {}): Promise<ThisWeekFeedResult> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const empty = buildThisWeekFeed({ nowIso, vendors: [], lots: [], promotions: [] });
  if (!isSupabaseServiceConfigured) return { feed: empty, partial: false, belowCostChecked: false };

  const admin = createSupabaseAdminClient();
  const { fromDay } = feedWindow(nowIso);
  // One day of slack on the created_at side; the pure core decides by Pacific day.
  const fromIso = pacificWallTimeToUtcISO(addDays(fromDay, -1), { h: 0, m: 0, s: 0, ms: 0 });

  const [lotsRes, vendorsRes, promosRes, localEvents, audit] = await Promise.all([
    pagedAllChecked<LotRow>(
      async (from, to) => {
        const { data, error } = await admin
          .from("inventory_lots")
          .select("id, vendor_id, received_on, created_at, status, product_name, category, inventory_type")
          .or(`received_on.gte.${fromDay},and(received_on.is.null,created_at.gte.${fromIso})`)
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: (data as LotRow[] | null) ?? [], ok: !error };
      },
      { maxRows: MAX_FEED_LOTS },
    ),
    admin.from("vendors").select("id, display_name, created_at").gte("created_at", fromIso).order("id", { ascending: true }).range(0, 499),
    admin
      .from("promotions")
      .select("id, title, status, weekday, starts_at, ends_at, discount_type, discount_percent, discount_fixed, bonus_note, config")
      .eq("status", "published")
      .order("priority", { ascending: false })
      .range(0, 499),
    getLocalEvents(),
    opts.withBelowCost ? auditPublishedPromotions().catch(() => null) : Promise.resolve(null),
  ]);

  const vendors: FeedVendor[] = ((vendorsRes.data as FeedVendor[] | null) ?? []).map((v) => ({
    id: v.id,
    display_name: v.display_name,
    created_at: v.created_at,
  }));
  // Names for the vendors of this week's lots (older vendors are not "new",
  // so their created_at is not passed on).
  const known = new Set(vendors.map((v) => v.id));
  const lotVendorIds = [...new Set(lotsRes.rows.map((l) => l.vendor_id).filter((x): x is string => !!x && !known.has(x)))];
  if (lotVendorIds.length > 0) {
    const named = await chunkedIn<string, { id: string; display_name: string }>(lotVendorIds, async (chunk, from, to) => {
      const { data } = await admin.from("vendors").select("id, display_name").in("id", chunk).order("id", { ascending: true }).range(from, to);
      return (data as { id: string; display_name: string }[] | null) ?? [];
    });
    for (const v of named) vendors.push({ id: v.id, display_name: v.display_name, created_at: null });
  }
  const lots: FeedLot[] = lotsRes.rows.map((l) => {
    const label = lotTypeLabel({ category: l.category, inventory_type: l.inventory_type, product_name: l.product_name });
    return {
      vendor_id: l.vendor_id,
      received_on: l.received_on,
      created_at: l.created_at,
      status: l.status,
      product_name: l.product_name,
      type_label: label === "\u2014" ? null : label,
    };
  });
  const promotions: FeedPromotion[] = ((promosRes.data as PromoRow[] | null) ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    weekday: p.weekday,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    discount_type: p.discount_type,
    discount_percent: Number(p.discount_percent ?? 0),
    discount_fixed: Math.round(Number(p.discount_fixed ?? 0)),
    bonus_note: p.bonus_note,
    markdown_only: (p.config as { markdownOnly?: unknown } | null)?.markdownOnly === true,
  }));
  const belowCost: Record<string, number> = {};
  for (const e of audit?.entries ?? []) belowCost[e.promotionId] = e.belowCost.length;

  const feed = buildThisWeekFeed({ nowIso, vendors, lots, promotions, belowCost, localEvents });
  return {
    feed,
    partial: !lotsRes.verdict.complete || !!vendorsRes.error || !!promosRes.error,
    belowCostChecked: audit != null,
  };
}
