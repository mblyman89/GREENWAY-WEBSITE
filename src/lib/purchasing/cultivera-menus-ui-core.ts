/**
 * src/lib/purchasing/cultivera-menus-ui-core.ts
 *
 * CV-4 — PURE display/selection helpers for the Cultivera vendor menus
 * command center (/admin/purchasing/menus). No imports, no I/O, no Date.now()
 * (callers pass `now`), so everything here is deterministically testable.
 *
 * These helpers work over the SAVED rows (cultivera_menu_items /
 * cultivera_menu_snapshots via cultivera-store.ts) and over the tolerant
 * market records the worker returns for a vendor search. Field access on
 * market records stays DEFENSIVE (multi-key getters) because Cultivera's real
 * response shapes are pinned only when live credentials exist — never guess.
 */

/** The subset of a saved menu-item row the UI helpers need (structural). */
export type MenuItemLike = {
  name: string | null;
  brand: string | null;
  category: string | null;
  strain_type: string | null;
  size_label: string | null;
  wholesale_price_minor: number | null;
  available_qty: number | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_cannabinoids_pct: number | null;
  image_url: string | null;
  coa_url: string | null;
};

/** The subset of a snapshot row the UI helpers need (structural). */
export type SnapshotLike = {
  seller_name: string | null;
  cultivera_market_slug: string | null;
  status: string;
  item_count: number;
  fetched_at: string;
};

/* ------------------------------------------------------------------
 * Money + potency labels
 * ------------------------------------------------------------------ */

/** "$12.50" from integer cents; "—" for null/invalid. Money is CENTS. */
export function priceLabel(minor: number | null): string {
  if (minor == null || !Number.isFinite(minor)) return "—";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const dollars = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${cents}`;
}

/** One number → "24.5%" (trims trailing zeros: 21 → "21%", 0.3 → "0.3%"). */
export function pctLabel(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

/**
 * "THC 24.5% · CBD 0.3%" from whichever potency numbers exist. Falls back to
 * total cannabinoids when THC/CBD are absent; "" when nothing is known.
 */
export function potencyLabel(item: Pick<MenuItemLike, "thc_pct" | "cbd_pct" | "total_cannabinoids_pct">): string {
  const parts: string[] = [];
  if (item.thc_pct != null && Number.isFinite(item.thc_pct)) parts.push(`THC ${pctLabel(item.thc_pct)}`);
  if (item.cbd_pct != null && Number.isFinite(item.cbd_pct)) parts.push(`CBD ${pctLabel(item.cbd_pct)}`);
  if (parts.length === 0 && item.total_cannabinoids_pct != null && Number.isFinite(item.total_cannabinoids_pct)) {
    parts.push(`Total ${pctLabel(item.total_cannabinoids_pct)}`);
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------
 * Filtering + grouping saved menu items
 * ------------------------------------------------------------------ */

/** Case-insensitive substring filter over name/brand/category/strain/size. */
export function filterMenuItems<T extends MenuItemLike>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) =>
    [it.name, it.brand, it.category, it.strain_type, it.size_label].some(
      (v) => typeof v === "string" && v.toLowerCase().includes(q),
    ),
  );
}

/** Restrict to one category ("" = all). Exact match, case-insensitive. */
export function filterByCategory<T extends MenuItemLike>(items: T[], category: string): T[] {
  const c = category.trim().toLowerCase();
  if (!c) return items;
  return items.filter((it) => (it.category ?? "").toLowerCase() === c);
}

/** Sorted unique category names present in a menu (empty/null skipped). */
export function distinctCategories(items: MenuItemLike[]): string[] {
  const seen = new Set<string>();
  for (const it of items) {
    const c = (it.category ?? "").trim();
    if (c) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Sorted unique brand names present in a menu (empty/null skipped). */
export function distinctBrands(items: MenuItemLike[]): string[] {
  const seen = new Set<string>();
  for (const it of items) {
    const b = (it.brand ?? "").trim();
    if (b) seen.add(b);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------
 * Snapshot summary
 * ------------------------------------------------------------------ */

/** "3h ago" / "2d ago" / "just now" from an ISO timestamp and `now` (ms). */
export function agoLabel(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** "Acme Farms — 42 items · 3h ago" (parts that exist only). */
export function snapshotSummary(snap: SnapshotLike, nowMs: number): string {
  const who = (snap.seller_name ?? "").trim() || (snap.cultivera_market_slug ?? "").trim() || "Unknown vendor";
  const items = `${snap.item_count} item${snap.item_count === 1 ? "" : "s"}`;
  const when = agoLabel(snap.fetched_at, nowMs);
  return when ? `${who} — ${items} · ${when}` : `${who} — ${items}`;
}

/* ------------------------------------------------------------------
 * Tolerant market-record readers (worker /cultivera/markets results).
 * DEFENSIVE multi-key getters — real field names get pinned from a live
 * authenticated probe once credentials exist.
 * ------------------------------------------------------------------ */

const NAME_KEYS = ["displayName", "display_name", "name", "sellerName", "seller_name", "businessName", "business_name", "title"] as const;
const SLUG_KEYS = ["slug", "marketSlug", "market_slug"] as const;
const ID_KEYS = ["id", "marketId", "market_id", "uuid"] as const;

function firstString(rec: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** Best display name for a market record ("" when nothing recognizable). */
export function marketName(rec: Record<string, unknown>): string {
  return firstString(rec, NAME_KEYS) || firstString(rec, SLUG_KEYS);
}

/** Best slug for a market record ("" when absent). */
export function marketSlug(rec: Record<string, unknown>): string {
  return firstString(rec, SLUG_KEYS);
}

/** Best id for a market record ("" when absent). */
export function marketId(rec: Record<string, unknown>): string {
  return firstString(rec, ID_KEYS);
}

/**
 * A market record is fetchable when we found EITHER a slug or an id to hand to
 * POST /cultivera/menu. The UI disables the button otherwise.
 */
export function isFetchableMarket(rec: Record<string, unknown>): boolean {
  return Boolean(marketSlug(rec) || marketId(rec));
}

/* ------------------------------------------------------------------
 * CH-3 — badge flags read from a saved item row's raw jsonb.
 *
 * Cultivera's LIVE-probed menu list items carry `IsSale` and `IsDOHComplaint`
 * booleans (see probe/CULTIVERA_PINNED.md); we preserved them untouched in the
 * item row's raw column. These tolerant readers surface them for the grid's
 * SALE / DOH COMPLIANT badges — mirroring Cultivera's own storefront.
 * ------------------------------------------------------------------ */

function truthyFlag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1";
  }
  return false;
}

/** True when the saved raw payload flags the listing as on sale. */
export function saleFlagFromRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  for (const k of ["IsSale", "isSale", "is_sale", "onSale", "on_sale"]) {
    if (k in o) return truthyFlag(o[k]);
  }
  return false;
}

/** True when the saved raw payload flags the listing as WA-DOH compliant. */
export function dohFlagFromRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  for (const k of ["IsDOHComplaint", "IsDohCompliant", "isDohCompliant", "is_doh_compliant"]) {
    if (k in o) return truthyFlag(o[k]);
  }
  return false;
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cultivera-menus-ui-core self-test failed: ${msg}`);
}

const T_ITEM: MenuItemLike = {
  name: "Blue Dream",
  brand: "Acme",
  category: "Flower",
  strain_type: "hybrid",
  size_label: "3.5g",
  wholesale_price_minor: 1250,
  available_qty: 10,
  thc_pct: 24.5,
  cbd_pct: 0.3,
  total_cannabinoids_pct: null,
  image_url: null,
  coa_url: null,
};

export function __runCultiveraMenusUiCoreTests(): void {
  // priceLabel — cents in, dollars out; null-safe
  assert(priceLabel(1250) === "$12.50", "priceLabel 1250");
  assert(priceLabel(0) === "$0.00", "priceLabel 0");
  assert(priceLabel(5) === "$0.05", "priceLabel 5");
  assert(priceLabel(-995) === "-$9.95", "priceLabel negative");
  assert(priceLabel(null) === "—", "priceLabel null");
  assert(priceLabel(Number.NaN) === "—", "priceLabel NaN");

  // pctLabel — trims, one decimal max
  assert(pctLabel(24.5) === "24.5%", "pctLabel 24.5");
  assert(pctLabel(21) === "21%", "pctLabel 21");
  assert(pctLabel(0.34) === "0.3%", "pctLabel rounds to 1dp");
  assert(pctLabel(null) === "", "pctLabel null");

  // potencyLabel — THC/CBD, fallback to total, empty when nothing
  assert(potencyLabel(T_ITEM) === "THC 24.5% · CBD 0.3%", "potency thc+cbd");
  assert(
    potencyLabel({ thc_pct: null, cbd_pct: null, total_cannabinoids_pct: 27.1 }) === "Total 27.1%",
    "potency total fallback",
  );
  assert(potencyLabel({ thc_pct: null, cbd_pct: null, total_cannabinoids_pct: null }) === "", "potency empty");
  assert(potencyLabel({ thc_pct: 20, cbd_pct: null, total_cannabinoids_pct: 25 }) === "THC 20%", "potency thc only, no total");

  // filterMenuItems — matches across fields, case-insensitive, empty = all
  const other: MenuItemLike = { ...T_ITEM, name: "Sour Diesel", brand: "Rebel", category: "Pre-Rolls", strain_type: "sativa", size_label: "1g" };
  const items = [T_ITEM, other];
  assert(filterMenuItems(items, "").length === 2, "filter empty keeps all");
  assert(filterMenuItems(items, "blue").length === 1, "filter by name");
  assert(filterMenuItems(items, "REBEL").length === 1, "filter by brand ci");
  assert(filterMenuItems(items, "pre-rolls").length === 1, "filter by category");
  assert(filterMenuItems(items, "sativa").length === 1, "filter by strain");
  assert(filterMenuItems(items, "zzz").length === 0, "filter no match");

  // filterByCategory — exact ci match, "" = all
  assert(filterByCategory(items, "").length === 2, "cat empty keeps all");
  assert(filterByCategory(items, "flower").length === 1, "cat exact ci");
  assert(filterByCategory(items, "flow").length === 0, "cat no substring");

  // distinct — sorted, unique, skips empties
  const three = [T_ITEM, other, { ...T_ITEM, category: null, brand: "" }];
  assert(JSON.stringify(distinctCategories(three)) === JSON.stringify(["Flower", "Pre-Rolls"]), "distinct categories");
  assert(JSON.stringify(distinctBrands(three)) === JSON.stringify(["Acme", "Rebel"]), "distinct brands");

  // agoLabel — deterministic with injected now
  const now = new Date("2026-01-10T12:00:00Z").getTime();
  assert(agoLabel("2026-01-10T11:59:40Z", now) === "just now", "ago just now");
  assert(agoLabel("2026-01-10T11:45:00Z", now) === "15m ago", "ago 15m");
  assert(agoLabel("2026-01-10T09:00:00Z", now) === "3h ago", "ago 3h");
  assert(agoLabel("2026-01-08T12:00:00Z", now) === "2d ago", "ago 2d");
  assert(agoLabel("not-a-date", now) === "", "ago invalid");

  // snapshotSummary — name fallback chain + counts
  assert(
    snapshotSummary({ seller_name: "Acme Farms", cultivera_market_slug: "acme", status: "fetched", item_count: 42, fetched_at: "2026-01-10T09:00:00Z" }, now)
      === "Acme Farms — 42 items · 3h ago",
    "summary named",
  );
  assert(
    snapshotSummary({ seller_name: null, cultivera_market_slug: "acme", status: "fetched", item_count: 1, fetched_at: "bad" }, now)
      === "acme — 1 item",
    "summary slug fallback, singular, no time",
  );
  assert(
    snapshotSummary({ seller_name: "", cultivera_market_slug: null, status: "fetched", item_count: 0, fetched_at: "bad" }, now)
      === "Unknown vendor — 0 items",
    "summary unknown vendor",
  );

  // market record readers — tolerant multi-key
  assert(marketName({ displayName: "Acme Farms" }) === "Acme Farms", "marketName displayName");
  assert(marketName({ seller_name: "Acme" }) === "Acme", "marketName seller_name");
  assert(marketName({ slug: "acme" }) === "acme", "marketName slug fallback");
  assert(marketName({}) === "", "marketName empty");
  assert(marketSlug({ slug: "acme" }) === "acme", "marketSlug");
  assert(marketSlug({ market_slug: "acme2" }) === "acme2", "marketSlug variant");
  assert(marketId({ id: "m1" }) === "m1", "marketId");
  assert(marketId({ market_id: 42 }) === "42", "marketId numeric");
  assert(isFetchableMarket({ slug: "acme" }) === true, "fetchable via slug");
  assert(isFetchableMarket({ id: "m1" }) === true, "fetchable via id");
  assert(isFetchableMarket({ name: "No handles" }) === false, "not fetchable");

  // CH-3 — raw badge flags (live-probed IsSale / IsDOHComplaint)
  assert(saleFlagFromRaw({ IsSale: true }) === true, "saleFlag true");
  assert(saleFlagFromRaw({ IsSale: false }) === false, "saleFlag false");
  assert(saleFlagFromRaw({ isSale: "true" }) === true, "saleFlag string");
  assert(saleFlagFromRaw({}) === false, "saleFlag absent");
  assert(saleFlagFromRaw(null) === false, "saleFlag null safe");
  assert(saleFlagFromRaw([1]) === false, "saleFlag array safe");
  assert(dohFlagFromRaw({ IsDOHComplaint: true }) === true, "dohFlag true");
  assert(dohFlagFromRaw({ IsDOHComplaint: 1 }) === true, "dohFlag numeric");
  assert(dohFlagFromRaw({ IsDOHComplaint: false }) === false, "dohFlag false");
  assert(dohFlagFromRaw(null) === false, "dohFlag null safe");

  console.log("cultivera-menus-ui-core: 54 self-tests passed");
}
