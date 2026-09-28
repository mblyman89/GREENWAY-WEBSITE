/**
 * src/lib/catalog/onboarding-list-core.ts  (S14 — Onboarding list: manifest
 * filter, pagination, condensed rows)
 *
 * PURE. Everything the Product Onboarding list needs to find "the products
 * from the invoice I just processed" without scrolling through 500 full
 * approve forms (F-001, F-006, F-034, F-080):
 *
 *   parseOnboardingListParams   ?q= ?vendor= ?page= ?size= ?rows= -> validated
 *   buildDraftListPlan          the ONE query shape (filters, order, range,
 *                               count) for the list, as data, so every filter
 *                               combination is unit-tested (S14.5)
 *   pageWindow                  "Showing 51-100 of 132", prev / next
 *   summarizeManifestDrafts     per-delivery draft counts for the picker +
 *                               header, from ONE named-column read
 *   manifestPickerLabel         "0421 · Phat Panda · Mar 12 · 14 drafts"
 *   onboardingHeaderTitle       "Product Onboarding — Phat Panda · manifest
 *                               0421 · received Mar 12 · 14 products (9 need
 *                               a price)"  (S14.4, word for word)
 *   rowAttention                the condensed row's "what this one needs" chips
 *   onboardingListHref          URLs that keep every filter (built on S02's
 *                               draftsHref, the single URL builder)
 *
 * GROUNDING (never guessed):
 *   - catalog_product_drafts.manifest_id -> inbound_manifests(id) is the only
 *     FK between the two tables (0026:30), so the vendor filter can join the
 *     DELIVERY's vendor with `inbound_manifests!inner(vendor_id)` in the SAME
 *     round trip (the house pattern: journal-entry-service.ts `gl_entities!inner`
 *     + `.eq("gl_entities.code", ...)`). It deliberately does NOT use
 *     drafts.vendor_id: that column arrives with 0234, which may not be
 *     applied yet, and filtering on a missing column would error the list.
 *   - "Needs a price" = a Needs-review draft with NO auto price
 *     (suggested_price_minor_units is null). suggestPrice() returns null
 *     exactly when the lot has no vendor cost (pricing.ts: "No vendor cost on
 *     this product yet — add the cost to enable pricing."), so the approver
 *     must type a price by hand. price_minor_units cannot be the signal: it
 *     is written only AT approval (catalog-drafts.ts approveDraftWithPrice).
 *   - Accepted deliveries: inbound_manifests.status accepted |
 *     partially_accepted (deriveManifestStatus, intake-store.ts), with
 *     accepted_at stamped at finalize (0032; intake-store.ts). Rejected
 *     deliveries seed no drafts, so they are not offered.
 *   - Search term escaping: the shared GW-021 helper (postgrest-escape.ts),
 *     because the term is embedded in an `.or()` filter STRING.
 *
 * The pinned-draft deep link (S02 `?draft=`) and the unpaginated legacy read
 * keep S02's exact query, so a "go fix it" link can never be filtered or
 * paged away from the product it points at.
 *
 * No fs, no network, no Supabase. Embedded self-tests run in the pure runner.
 */
import { draftsHref, isUuid, normalizeDraftView, type DraftView } from "@/lib/catalog/draft-deep-link-core";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";

// ─── 1. Constants ────────────────────────────────────────────────────────────

/** Page sizes the owner can pick. 50 fits one typical delivery on one page. */
export const DRAFT_PAGE_SIZES = [25, 50, 100] as const;
export type DraftPageSize = (typeof DRAFT_PAGE_SIZES)[number];
export const DRAFT_PAGE_SIZE_DEFAULT: DraftPageSize = 50;
/** S02 / pre-S14 cap, kept for the pinned deep link and the legacy read. */
export const DRAFT_LEGACY_LIMIT = 500;
/** A search term longer than this is cut (a name, not an essay). */
export const DRAFT_SEARCH_MAX_CHARS = 80;
/** Highest page number accepted from a URL (junk beyond this is clamped). */
export const DRAFT_MAX_PAGE = 1000;
/** Picker window + cap (bible S14.2: "accepted in last 30 days"). */
export const PICKER_WINDOW_DAYS = 30;
export const PICKER_MAX_MANIFESTS = 100;
/** Delivery statuses that seeded drafts (deriveManifestStatus). */
export const PICKER_MANIFEST_STATUSES = ["accepted", "partially_accepted"] as const;
/** The draft columns the list may search (all exist since 0026). */
export const DRAFT_SEARCH_COLUMNS = ["name", "brand_name", "vendor_name", "strain_name", "pos_product_key"] as const;
/** The delivery-vendor join (one FK: drafts.manifest_id -> inbound_manifests). */
export const VENDOR_JOIN_SELECT = "*, inbound_manifests!inner(vendor_id)";
export const VENDOR_JOIN_COLUMN = "inbound_manifests.vendor_id";
export const STORE_TIME_ZONE = "America/Los_Angeles";

export type RowsMode = "condensed" | "expanded";

// ─── 2. URL params ───────────────────────────────────────────────────────────

export type OnboardingListParams = {
  /** Trimmed, length-capped search text; "" = none. */
  q: string;
  /** Validated delivery-vendor id, or null. */
  vendorId: string | null;
  /** 1-based page. */
  page: number;
  pageSize: DraftPageSize;
  rows: RowsMode;
};

function single(v: unknown): string {
  if (Array.isArray(v)) return ""; // ?q=a&q=b is ambiguous: ignore
  return typeof v === "string" ? v : "";
}

/** Parse ?q= ?vendor= ?page= ?size= ?rows=. Junk falls back to the default. */
export function parseOnboardingListParams(sp: {
  q?: unknown;
  vendor?: unknown;
  page?: unknown;
  size?: unknown;
  rows?: unknown;
}): OnboardingListParams {
  const q = single(sp.q).replace(/\s+/g, " ").trim().slice(0, DRAFT_SEARCH_MAX_CHARS).trim();
  const vendorRaw = single(sp.vendor);
  const vendorId = isUuid(vendorRaw) ? vendorRaw.trim().toLowerCase() : null;
  const pageRaw = single(sp.page).trim();
  const pageNum = /^[0-9]{1,6}$/.test(pageRaw) ? Number(pageRaw) : 1;
  const page = Math.min(DRAFT_MAX_PAGE, Math.max(1, pageNum));
  const sizeNum = Number(single(sp.size).trim());
  const pageSize = (DRAFT_PAGE_SIZES as readonly number[]).includes(sizeNum)
    ? (sizeNum as DraftPageSize)
    : DRAFT_PAGE_SIZE_DEFAULT;
  const rows: RowsMode = single(sp.rows).trim().toLowerCase() === "expanded" ? "expanded" : "condensed";
  return { q, vendorId, page, pageSize, rows };
}

// ─── 3. The query plan ───────────────────────────────────────────────────────

export type DraftListInput = {
  status?: unknown;
  manifestId?: string | null;
  draftId?: string | null;
  vendorId?: string | null;
  q?: string | null;
  /** null/undefined = the unpaginated legacy read (S02 shape, limit 500). */
  page?: number | null;
  pageSize?: number | null;
};

export type DraftListFilter =
  | { op: "eq"; column: string; value: string }
  | { op: "or"; filter: string };

export type DraftListPlan = {
  /** pinned = S02 deep link; paged = S14 list; legacy = pre-S14 read. */
  mode: "pinned" | "paged" | "legacy";
  view: DraftView;
  select: string;
  /** Ask the server for the total in the SAME round trip. */
  count: boolean;
  filters: DraftListFilter[];
  /** Newest first; paged mode adds `id` so page boundaries are stable. */
  order: { column: string; ascending: boolean }[];
  /** Inclusive row range (paged), else null. */
  range: { from: number; to: number } | null;
  /** Row cap (pinned / legacy), else null. */
  limit: number | null;
  page: number | null;
  pageSize: number | null;
  /** Filters the plan deliberately did NOT apply, for honest UI copy. */
  ignored: ("q" | "vendor" | "page")[];
};

function uuidOrNull(v: unknown): string | null {
  return isUuid(v) ? v.trim().toLowerCase() : null;
}

/** The `.or()` string that searches the draft's name/brand/vendor/strain/key. */
export function draftSearchFilter(q: string | null | undefined): string | null {
  const like = ilikeContains(String(q ?? "").slice(0, DRAFT_SEARCH_MAX_CHARS));
  if (!like) return null;
  return DRAFT_SEARCH_COLUMNS.map((c) => `${c}.ilike.${like}`).join(",");
}

/**
 * The one list query, as data. Values that reach a filter string are a
 * closed enum (status), validated UUIDs, or a GW-021-escaped term, so the
 * filter grammar cannot be broken from a URL.
 */
export function buildDraftListPlan(input: DraftListInput): DraftListPlan {
  const view = normalizeDraftView(input.status);
  const manifestId = uuidOrNull(input.manifestId);
  const draftId = uuidOrNull(input.draftId);
  const vendorId = uuidOrNull(input.vendorId);
  const search = draftSearchFilter(input.q);
  const newestFirst = { column: "created_at", ascending: false };

  if (draftId) {
    // S02, unchanged: ONE round trip for (tab [+ delivery]) OR the pinned id.
    // Search / vendor / page never apply: a deep link must land ON its product.
    const inTab = manifestId ? `and(status.eq.${view},manifest_id.eq.${manifestId})` : `status.eq.${view}`;
    const ignored: DraftListPlan["ignored"] = [];
    if (search) ignored.push("q");
    if (vendorId) ignored.push("vendor");
    if (input.page != null) ignored.push("page");
    return {
      mode: "pinned",
      view,
      select: "*",
      count: false,
      filters: [{ op: "or", filter: `${inTab},id.eq.${draftId}` }],
      order: [newestFirst],
      range: null,
      limit: DRAFT_LEGACY_LIMIT,
      page: null,
      pageSize: null,
      ignored,
    };
  }

  const filters: DraftListFilter[] = [{ op: "eq", column: "status", value: view }];
  if (manifestId) filters.push({ op: "eq", column: "manifest_id", value: manifestId });

  if (input.page == null) {
    // Legacy read: exactly the S02 query (search / vendor are S14-page only).
    const ignored: DraftListPlan["ignored"] = [];
    if (search) ignored.push("q");
    if (vendorId) ignored.push("vendor");
    return {
      mode: "legacy",
      view,
      select: "*",
      count: false,
      filters,
      order: [newestFirst],
      range: null,
      limit: DRAFT_LEGACY_LIMIT,
      page: null,
      pageSize: null,
      ignored,
    };
  }

  if (vendorId) filters.push({ op: "eq", column: VENDOR_JOIN_COLUMN, value: vendorId });
  if (search) filters.push({ op: "or", filter: search });
  const pageSize = (DRAFT_PAGE_SIZES as readonly number[]).includes(Number(input.pageSize))
    ? Number(input.pageSize)
    : DRAFT_PAGE_SIZE_DEFAULT;
  const page = Math.min(DRAFT_MAX_PAGE, Math.max(1, Math.trunc(Number(input.page)) || 1));
  const from = (page - 1) * pageSize;
  return {
    mode: "paged",
    view,
    select: vendorId ? VENDOR_JOIN_SELECT : "*",
    count: true,
    filters,
    order: [newestFirst, { column: "id", ascending: false }],
    range: { from, to: from + pageSize - 1 },
    limit: null,
    page,
    pageSize,
    ignored: [],
  };
}

/** PostgREST's "range not satisfiable" (a page past the end). */
export function isPastEndError(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "PGRST103") return true;
  return typeof err.message === "string" && /range not satisfiable/i.test(err.message);
}

// ─── 4. Paging copy ──────────────────────────────────────────────────────────

export type PageWindow = {
  page: number;
  pageSize: number;
  /** null = the total could not be read (never shown as 0). */
  total: number | null;
  lastPage: number | null;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** The page asked for is beyond the last one. */
  pastEnd: boolean;
  label: string;
};

/**
 * `serverPastEnd` is the list read's own verdict (PostgREST 416 / PGRST103):
 * on that reply there is no total, so without it an out-of-range page would
 * look like an EMPTY list and say "No drafts" while drafts exist.
 */
export function pageWindow(
  total: number | null | undefined,
  page: number,
  pageSize: number,
  rowsOnPage: number,
  serverPastEnd = false,
): PageWindow {
  const t = typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null;
  const size = Math.max(1, Math.trunc(pageSize) || DRAFT_PAGE_SIZE_DEFAULT);
  const p = Math.max(1, Math.trunc(page) || 1);
  const rows = Math.max(0, Math.trunc(rowsOnPage) || 0);
  const from = (p - 1) * size + (rows > 0 ? 1 : 0);
  const to = (p - 1) * size + rows;
  const lastPage = t === null ? null : Math.max(1, Math.ceil(t / size));
  // An empty list is "nothing here", not "past the end of 0 things".
  const pastEnd = (serverPastEnd && rows === 0 && p > 1) || (t !== null && lastPage !== null && p > lastPage && t > 0);
  const hasPrev = p > 1;
  // Unknown total: a full page MAY have more behind it; a short page cannot.
  const hasNext = t === null ? rows === size : p < (lastPage ?? 1);
  let label: string;
  if (pastEnd && t === null) label = "That page is past the end of the list.";
  else if (pastEnd) label = `That page is past the end — there ${t === 1 ? "is" : "are"} ${t} in this list.`;
  else if (rows === 0) label = "";
  else if (t === null) label = `Showing ${from}–${to}`;
  else label = `Showing ${from}–${to} of ${t}`;
  return { page: p, pageSize: size, total: t, lastPage, from, to, hasPrev, hasNext, pastEnd, label };
}

// ─── 5. Manifest picker + header ─────────────────────────────────────────────

export type PickerManifestRow = {
  id: string;
  manifest_number: string | null;
  vendor_id: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  received_at: string | null;
  accepted_at: string | null;
  status: string | null;
};

export type ManifestDraftCounts = {
  /** Every draft this delivery seeded (all tabs). */
  total: number;
  /** Still in Needs review. */
  inReview: number;
  /** In review with no auto price (no vendor cost): a price must be typed. */
  needsPrice: number;
};

/** Fold one named-column read into per-delivery counts. */
export function summarizeManifestDrafts(
  rows: readonly { manifest_id?: unknown; status?: unknown; suggested_price_minor_units?: unknown }[] | null | undefined,
): Map<string, ManifestDraftCounts> {
  const out = new Map<string, ManifestDraftCounts>();
  for (const r of rows ?? []) {
    const id = typeof r?.manifest_id === "string" ? r.manifest_id.toLowerCase() : null;
    if (!id) continue;
    const c = out.get(id) ?? { total: 0, inReview: 0, needsPrice: 0 };
    c.total += 1;
    if (r.status === "draft") {
      c.inReview += 1;
      if (r.suggested_price_minor_units === null || r.suggested_price_minor_units === undefined) c.needsPrice += 1;
    }
    out.set(id, c);
  }
  return out;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "Mar 12" (same year as `now`) or "Mar 12, 2024"; null when unparseable. */
export function shortDeliveryDate(value: string | null | undefined, now: Date): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  // A DATE column is a calendar day, not an instant: format it in UTC so it
  // never slides a day. A timestamptz is an instant: show the store's day.
  const dateOnly = DATE_ONLY_RE.test(v);
  const d = new Date(dateOnly ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  const zone = dateOnly ? "UTC" : STORE_TIME_ZONE;
  const year = (x: Date, tz: string) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }).format(x);
  const sameYear = year(d, zone) === year(now, STORE_TIME_ZONE);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: zone,
  }).format(d);
}

/** When the delivery arrived, with the honest verb for the field we used. */
export function deliveryWhen(m: Pick<PickerManifestRow, "received_at" | "accepted_at" | "transfer_date">, now: Date): string | null {
  const received = shortDeliveryDate(m.received_at, now);
  if (received) return `received ${received}`;
  const accepted = shortDeliveryDate(m.accepted_at, now);
  if (accepted) return `accepted ${accepted}`;
  const shipped = shortDeliveryDate(m.transfer_date, now);
  return shipped ? `shipped ${shipped}` : null;
}

function clean(s: string | null | undefined): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

/** "0421 · Phat Panda · Mar 12 · 14 drafts" (unknown count is omitted). */
export function manifestPickerLabel(m: PickerManifestRow, counts: ManifestDraftCounts | null | undefined, now: Date): string {
  const parts: string[] = [];
  parts.push(clean(m.manifest_number) || "No manifest #");
  const vendor = clean(m.vendor_label);
  if (vendor) parts.push(vendor);
  const day = shortDeliveryDate(m.received_at, now) ?? shortDeliveryDate(m.accepted_at, now) ?? shortDeliveryDate(m.transfer_date, now);
  if (day) parts.push(day);
  if (counts) parts.push(`${counts.total} draft${counts.total === 1 ? "" : "s"}`);
  return parts.join(" \u00b7 ");
}

export const ONBOARDING_TITLE = "Product Onboarding";

/**
 * S14.4 header: "Product Onboarding — Phat Panda · manifest 0421 · received
 * Mar 12 · 14 products (9 need a price)". Any part we could not read is left
 * out, never invented; with no delivery it is the plain title.
 */
export function onboardingHeaderTitle(
  m: PickerManifestRow | null | undefined,
  counts: ManifestDraftCounts | null | undefined,
  now: Date,
): string {
  if (!m) return ONBOARDING_TITLE;
  const parts: string[] = [];
  const vendor = clean(m.vendor_label);
  if (vendor) parts.push(vendor);
  const num = clean(m.manifest_number);
  if (num) parts.push(`manifest ${num}`);
  const when = deliveryWhen(m, now);
  if (when) parts.push(when);
  if (counts) {
    const n = `${counts.total} product${counts.total === 1 ? "" : "s"}`;
    parts.push(counts.needsPrice > 0 ? `${n} (${counts.needsPrice} need${counts.needsPrice === 1 ? "s" : ""} a price)` : n);
  }
  return parts.length ? `${ONBOARDING_TITLE} \u2014 ${parts.join(" \u00b7 ")}` : ONBOARDING_TITLE;
}

/** Distinct delivery vendors from the picker rows (no extra query), A-Z. */
export function pickerVendors(rows: readonly PickerManifestRow[]): { id: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const r of rows) {
    const id = uuidOrNull(r.vendor_id);
    const label = clean(r.vendor_label);
    if (id && label && !byId.has(id)) byId.set(id, label);
  }
  return Array.from(byId.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1));
}

/** ISO start of the picker window. */
export function pickerSinceIso(now: Date): string {
  return new Date(now.getTime() - PICKER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The picker's manifest filter as ONE `.or()` string: recent accepted
 * deliveries, OR the delivery the URL is focused on (so an older focused
 * delivery still gets its header without a second query).
 */
export function pickerManifestFilter(sinceIso: string, focusManifestId: string | null | undefined): string {
  const recent = `and(status.in.(${PICKER_MANIFEST_STATUSES.join(",")}),accepted_at.gte.${sinceIso})`;
  const focus = uuidOrNull(focusManifestId);
  return focus ? `${recent},id.eq.${focus}` : recent;
}

// ─── 6. Condensed row ────────────────────────────────────────────────────────

export type RowAttentionInput = {
  needsCategoryPick?: boolean;
  needsTypePick?: boolean;
  needsOtherwiseTakenPick?: boolean;
  promptsLowThcLiquid?: boolean;
  needsVolumePick?: boolean;
  /** suggested_price_minor_units (null = no auto price: no vendor cost). */
  suggestedPriceMinor?: number | null;
};

export type RowAttentionChip = { key: string; label: string; blocking: boolean };

/**
 * What this draft needs before Approve, for the collapsed row. `blocking`
 * chips are the ones the server gate will refuse without (the picks and the
 * compliance / volume questions). The low-THC prompt is informational.
 */
export function rowAttention(i: RowAttentionInput): RowAttentionChip[] {
  const out: RowAttentionChip[] = [];
  if (i.needsCategoryPick) out.push({ key: "category", label: "Pick a category", blocking: true });
  if (i.needsTypePick) out.push({ key: "type", label: "Pick a type", blocking: true });
  if (i.needsOtherwiseTakenPick) out.push({ key: "otherwise_taken", label: "Compliance question", blocking: true });
  if (i.needsVolumePick) out.push({ key: "volume", label: "Enter the volume", blocking: true });
  if (i.promptsLowThcLiquid) out.push({ key: "low_thc", label: "Low-THC question", blocking: false });
  if (i.suggestedPriceMinor === null || i.suggestedPriceMinor === undefined) {
    out.push({ key: "price", label: "Needs a price", blocking: true });
  }
  return out;
}

/** Is this row's full form open on load? */
export function rowStartsOpen(opts: { rows: RowsMode; pinned: boolean }): boolean {
  return opts.rows === "expanded" || opts.pinned;
}

// ─── 7. URLs ─────────────────────────────────────────────────────────────────

export type OnboardingListHrefOpts = {
  status?: DraftView | null;
  manifestId?: string | null;
  q?: string | null;
  vendorId?: string | null;
  page?: number | null;
  pageSize?: number | null;
  rows?: RowsMode | null;
};

/**
 * An onboarding URL that keeps the filters. Defaults are left out so the
 * canonical URL stays exactly `/admin/inventory/drafts`.
 */
export function onboardingListHref(o: OnboardingListHrefOpts = {}): string {
  const extra: Record<string, string> = {};
  const q = clean(o.q).slice(0, DRAFT_SEARCH_MAX_CHARS);
  if (q) extra.q = q;
  const vendor = uuidOrNull(o.vendorId);
  if (vendor) extra.vendor = vendor;
  if (o.pageSize != null && o.pageSize !== DRAFT_PAGE_SIZE_DEFAULT && (DRAFT_PAGE_SIZES as readonly number[]).includes(o.pageSize)) {
    extra.size = String(o.pageSize);
  }
  if (o.page != null && Math.trunc(o.page) > 1) extra.page = String(Math.min(DRAFT_MAX_PAGE, Math.trunc(o.page)));
  if (o.rows === "expanded") extra.rows = "expanded";
  return draftsHref({ status: o.status ?? null, manifestId: o.manifestId ?? null, extra });
}

// ─── 8. Embedded self-tests ──────────────────────────────────────────────────

export function __runOnboardingListCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL onboarding-list-core: " + msg);
    }
  };
  const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  const V = "11111111-2222-4333-8444-555555555555";
  const D = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
  const NOW = new Date("2025-03-20T18:00:00Z");

  // Params.
  const p0 = parseOnboardingListParams({});
  ok(p0.q === "" && p0.vendorId === null && p0.page === 1 && p0.pageSize === 50 && p0.rows === "condensed", "defaults");
  ok(parseOnboardingListParams({ page: "3" }).page === 3, "page 3");
  ok(parseOnboardingListParams({ page: "0" }).page === 1, "page 0 -> 1");
  ok(parseOnboardingListParams({ page: "-2" }).page === 1, "negative page -> 1");
  ok(parseOnboardingListParams({ page: "2.5" }).page === 1, "fractional page -> 1");
  ok(parseOnboardingListParams({ page: "999999" }).page === DRAFT_MAX_PAGE, "huge page clamped");
  ok(parseOnboardingListParams({ page: ["2", "3"] }).page === 1, "repeated page ignored");
  ok(parseOnboardingListParams({ size: "100" }).pageSize === 100, "size 100");
  ok(parseOnboardingListParams({ size: "37" }).pageSize === 50, "unknown size -> 50");
  ok(parseOnboardingListParams({ vendor: V.toUpperCase() }).vendorId === V, "vendor uuid lowercased");
  ok(parseOnboardingListParams({ vendor: "x,id.neq.0" }).vendorId === null, "junk vendor dropped");
  ok(parseOnboardingListParams({ q: "  blue   dream  " }).q === "blue dream", "q collapsed + trimmed");
  ok(parseOnboardingListParams({ q: "x".repeat(200) }).q.length === DRAFT_SEARCH_MAX_CHARS, "q capped");
  ok(parseOnboardingListParams({ rows: "EXPANDED" }).rows === "expanded", "rows expanded");
  ok(parseOnboardingListParams({ rows: "all" }).rows === "condensed", "unknown rows -> condensed");

  // Plans.
  const legacy = buildDraftListPlan({ status: "approved" });
  ok(legacy.mode === "legacy" && legacy.limit === 500 && legacy.range === null && !legacy.count, "legacy shape");
  ok(legacy.filters.length === 1 && legacy.order.length === 1, "legacy = S02 query");
  const paged = buildDraftListPlan({ status: "draft", page: 2, pageSize: 25 });
  ok(paged.mode === "paged" && paged.count && paged.range?.from === 25 && paged.range.to === 49, "page 2 of 25 -> rows 25..49");
  ok(paged.order[1]?.column === "id", "stable tie-break on id");
  ok(paged.select === "*", "no join without vendor");
  const pv = buildDraftListPlan({ status: "draft", page: 1, vendorId: V });
  ok(pv.select === VENDOR_JOIN_SELECT, "vendor joins the delivery");
  ok(pv.filters.some((f) => f.op === "eq" && f.column === VENDOR_JOIN_COLUMN && f.value === V), "vendor filter on the delivery");
  const pq = buildDraftListPlan({ status: "draft", page: 1, q: "50%,off(" });
  const orF = pq.filters.find((f) => f.op === "or");
  ok(orF?.op === "or" && orF.filter.split(",").length === DRAFT_SEARCH_COLUMNS.length, "search cannot add filter terms");
  ok(orF?.op === "or" && orF.filter.startsWith("name.ilike.%50\\% off%"), "search escaped");
  const pinned = buildDraftListPlan({ status: "draft", draftId: D, manifestId: M, q: "x", vendorId: V, page: 3 });
  ok(pinned.mode === "pinned" && pinned.filters.length === 1 && pinned.range === null, "pin ignores paging");
  ok(pinned.ignored.join() === "q,vendor,page", "pin says what it ignored");
  ok(buildDraftListPlan({ status: "bogus", page: 1 }).view === "draft", "unknown status -> draft");
  ok(buildDraftListPlan({ page: 1, pageSize: 7 }).pageSize === 50, "unknown size -> 50");
  ok(draftSearchFilter("   ") === null && draftSearchFilter("()") === null, "blank search skipped");

  // Paging.
  const w = pageWindow(132, 2, 50, 50);
  ok(w.label === "Showing 51–100 of 132" && w.hasPrev && w.hasNext && w.lastPage === 3, "middle page");
  const last = pageWindow(132, 3, 50, 32);
  ok(last.label === "Showing 101–132 of 132" && !last.hasNext, "last page");
  ok(pageWindow(null, 1, 50, 50).hasNext && pageWindow(null, 1, 50, 50).label === "Showing 1–50", "unknown total");
  ok(!pageWindow(null, 1, 50, 10).hasNext, "short page, unknown total -> no next");
  ok(pageWindow(10, 5, 50, 0).pastEnd, "past the end");
  ok(!pageWindow(0, 1, 50, 0).pastEnd && pageWindow(0, 1, 50, 0).label === "", "empty list is not past the end");
  ok(!pageWindow(0, 2, 50, 0).pastEnd, "empty list, page 2: still empty, not past the end");
  ok(pageWindow(null, 20, 50, 0, true).pastEnd && pageWindow(null, 20, 50, 0, true).label === "That page is past the end of the list.", "416 (no total) is past the end");
  ok(!pageWindow(null, 1, 50, 0, true).pastEnd, "page 1 is never past the end");

  // Counts + labels.
  const counts = summarizeManifestDrafts([
    { manifest_id: M, status: "draft", suggested_price_minor_units: null },
    { manifest_id: M, status: "draft", suggested_price_minor_units: 1500 },
    { manifest_id: M, status: "approved", suggested_price_minor_units: null },
    { manifest_id: null, status: "draft", suggested_price_minor_units: null },
  ]);
  const c = counts.get(M);
  ok(c?.total === 3 && c.inReview === 2 && c.needsPrice === 1, "counts: approved never needs a price");
  ok(counts.size === 1, "rows without a delivery skipped");
  const m: PickerManifestRow = {
    id: M,
    manifest_number: "0421",
    vendor_id: V,
    vendor_label: "Phat Panda",
    transfer_date: "2025-03-11",
    received_at: "2025-03-12T20:00:00Z",
    accepted_at: "2025-03-12T21:00:00Z",
    status: "accepted",
  };
  ok(
    onboardingHeaderTitle(m, { total: 14, inReview: 12, needsPrice: 9 }, NOW) ===
      "Product Onboarding \u2014 Phat Panda \u00b7 manifest 0421 \u00b7 received Mar 12 \u00b7 14 products (9 need a price)",
    "S14.4 header, word for word",
  );
  ok(onboardingHeaderTitle(null, null, NOW) === "Product Onboarding", "no delivery -> plain title");
  ok(onboardingHeaderTitle(m, null, NOW).endsWith("received Mar 12"), "unknown counts omitted");
  ok(onboardingHeaderTitle(m, { total: 1, inReview: 1, needsPrice: 1 }, NOW).endsWith("1 product (1 needs a price)"), "singulars");
  ok(onboardingHeaderTitle(m, { total: 4, inReview: 0, needsPrice: 0 }, NOW).endsWith("4 products"), "no price note at 0");
  ok(onboardingHeaderTitle({ ...m, received_at: null }, null, NOW).includes("accepted Mar 12"), "falls back to accepted, says so");
  ok(onboardingHeaderTitle({ ...m, received_at: null, accepted_at: null }, null, NOW).includes("shipped Mar 11"), "date-only never slides a day");
  ok(shortDeliveryDate("2024-12-30T20:00:00Z", NOW) === "Dec 30, 2024", "other year shows the year");
  ok(shortDeliveryDate("2025-03-13T06:30:00Z", NOW) === "Mar 12", "store's day (LA), not UTC");
  ok(shortDeliveryDate("nope", NOW) === null && shortDeliveryDate(null, NOW) === null, "junk date -> null");
  ok(manifestPickerLabel(m, { total: 14, inReview: 1, needsPrice: 0 }, NOW) === "0421 \u00b7 Phat Panda \u00b7 Mar 12 \u00b7 14 drafts", "picker label");
  ok(manifestPickerLabel({ ...m, manifest_number: null, vendor_label: null }, null, NOW) === "No manifest # \u00b7 Mar 12", "picker label, unknowns omitted");
  ok(pickerVendors([m, { ...m, id: D }, { ...m, vendor_id: null }]).length === 1, "distinct vendors");
  ok(pickerManifestFilter("2025-02-18T18:00:00.000Z", null) === "and(status.in.(accepted,partially_accepted),accepted_at.gte.2025-02-18T18:00:00.000Z)", "picker filter");
  ok(pickerManifestFilter("S", M).endsWith(`,id.eq.${M}`), "focused delivery always included");
  ok(pickerManifestFilter("S", "x),id.neq.(0").indexOf("id.") === -1, "junk focus dropped");
  ok(pickerSinceIso(NOW) === "2025-02-18T18:00:00.000Z", "30-day window");

  // Rows.
  ok(rowAttention({ suggestedPriceMinor: 1500 }).length === 0, "nothing needed -> no chips");
  const chips = rowAttention({ needsCategoryPick: true, needsTypePick: true, needsOtherwiseTakenPick: true, needsVolumePick: true, promptsLowThcLiquid: true, suggestedPriceMinor: null });
  ok(chips.map((x) => x.key).join() === "category,type,otherwise_taken,volume,low_thc,price", "chip order");
  ok(chips.find((x) => x.key === "low_thc")?.blocking === false, "low-THC is informational");
  ok(rowStartsOpen({ rows: "condensed", pinned: true }) && rowStartsOpen({ rows: "expanded", pinned: false }), "open when pinned or expanded");
  ok(!rowStartsOpen({ rows: "condensed", pinned: false }), "condensed by default");

  // URLs.
  ok(onboardingListHref() === "/admin/inventory/drafts", "canonical URL");
  ok(onboardingListHref({ manifestId: M, page: 2 }) === `/admin/inventory/drafts?manifest=${M}&page=2`, "manifest + page");
  ok(onboardingListHref({ q: "blue dream", vendorId: V, pageSize: 100, rows: "expanded", status: "approved" }) ===
    `/admin/inventory/drafts?status=approved&q=blue+dream&vendor=${V}&size=100&rows=expanded`, "every filter kept");
  ok(onboardingListHref({ page: 1, pageSize: 50, rows: "condensed" }) === "/admin/inventory/drafts", "defaults omitted");
  ok(onboardingListHref({ vendorId: "junk" }) === "/admin/inventory/drafts", "junk vendor never linked");
  ok(isPastEndError({ code: "PGRST103" }) && isPastEndError({ message: "Requested range not satisfiable" }), "past-end error");
  ok(!isPastEndError({ code: "42703" }) && !isPastEndError(null), "other errors are not past-end");

  return { passed, failed };
}
