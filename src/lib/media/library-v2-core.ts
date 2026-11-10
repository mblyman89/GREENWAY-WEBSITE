/**
 * src/lib/media/library-v2-core.ts   (D221 M5 + M7)
 *
 * The Media Library v2 rules as PURE functions, so they are pinned by the
 * self-tests below and by tests/compliance/d221-m5-m8-media-finish.test.ts:
 *
 *   - the facet filters (vendor, platform, role, category, review, SEO, AI,
 *     collection) and their counts. Each facet is counted over the rows the
 *     OTHER filters leave, the way every faceted search works, so a count
 *     always says how many you would see if you clicked it;
 *   - the AI / human / rule badge per field (from field_provenance);
 *   - the bulk actions (publish, archive, re-describe, set vendor, undo
 *     auto-publish, add to collection): which rows each one changes, which it
 *     skips and why. Nothing is ever deleted;
 *   - the health dashboard tiles;
 *   - collection names and slugs;
 *   - the search log entry (what is worth logging).
 *
 * AGENTS.md rule 3 (D221 exception): a person's value is never overwritten by
 * the AI; a bulk "set vendor" is a PERSON's value, so it is marked human.
 */

// ---------------------------------------------------------------------------
// Filters + facets
// ---------------------------------------------------------------------------

/** The v2 filter keys that travel in the library URL (with q/status/usage/folder/sort/page). */
export const LIBRARY_FILTER_KEYS = ["vendor", "platform", "role", "category", "review", "seo", "ai", "coll"] as const;
export type LibraryFilterKey = (typeof LIBRARY_FILTER_KEYS)[number];
export type LibraryFilters = Partial<Record<LibraryFilterKey, string>>;

export const REVIEW_FILTERS = ["needs_review", "rejected", "ok"] as const;
export const SEO_FILTERS = ["yes", "no"] as const;
export const AI_FILTERS = ["pending", "done", "failed", "skipped"] as const;

/** The row fields the filters read (a MediaAsset satisfies it). */
export type FilterableMedia = {
  id: string;
  status?: string | null;
  vendor_id?: string | null;
  platform?: string | null;
  role?: string | null;
  category?: string | null;
  review_state?: string | null;
  seo_alt?: string | null;
  seo_title?: string | null;
  ai_status?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v.trim() : "";
}

/** Keep only valid, non-empty v2 filters from searchParams. Unknown values are dropped (never guessed). */
export function parseLibraryFilters(sp: Record<string, unknown> | null | undefined): LibraryFilters {
  const out: LibraryFilters = {};
  const vendor = first(sp?.vendor);
  if (vendor === "none" || UUID_RE.test(vendor)) out.vendor = vendor.toLowerCase();
  const platform = first(sp?.platform).toLowerCase();
  if (/^[a-z]{2,20}$/.test(platform) || platform === "none") out.platform = platform;
  const role = first(sp?.role).toLowerCase();
  if (/^[a-z]{2,20}$/.test(role) || role === "none") out.role = role;
  const category = first(sp?.category).slice(0, 60);
  if (category) out.category = category;
  const review = first(sp?.review);
  if ((REVIEW_FILTERS as readonly string[]).includes(review)) out.review = review;
  const seo = first(sp?.seo);
  if ((SEO_FILTERS as readonly string[]).includes(seo)) out.seo = seo;
  const ai = first(sp?.ai);
  if ((AI_FILTERS as readonly string[]).includes(ai)) out.ai = ai;
  const coll = first(sp?.coll);
  if (UUID_RE.test(coll)) out.coll = coll.toLowerCase();
  return out;
}

export function hasSeo(m: FilterableMedia): boolean {
  return Boolean((m.seo_alt ?? "").trim() && (m.seo_title ?? "").trim());
}

/** One filter test. `inCollection` = the ids in the chosen collection (only read when coll is set). */
export function matchesFilter(m: FilterableMedia, key: LibraryFilterKey, value: string, inCollection?: ReadonlySet<string>): boolean {
  switch (key) {
    case "vendor":
      return value === "none" ? !m.vendor_id : (m.vendor_id ?? "").toLowerCase() === value;
    case "platform":
      return value === "none" ? !m.platform : (m.platform ?? "") === value;
    case "role":
      return value === "none" ? !m.role : (m.role ?? "") === value;
    case "category":
      return value === "none" ? !m.category : (m.category ?? "").toLowerCase() === value.toLowerCase();
    case "review":
      return (m.review_state ?? "ok") === value;
    case "seo":
      return value === "yes" ? hasSeo(m) : !hasSeo(m);
    case "ai":
      return (m.ai_status ?? "pending") === value;
    case "coll":
      return Boolean(inCollection?.has(m.id));
  }
}

export function applyLibraryFilters<T extends FilterableMedia>(
  rows: readonly T[],
  filters: LibraryFilters,
  inCollection?: ReadonlySet<string>,
  skip?: LibraryFilterKey,
): T[] {
  const active = (Object.entries(filters) as [LibraryFilterKey, string][]).filter(([k, v]) => v && k !== skip);
  if (active.length === 0) return [...rows];
  return rows.filter((m) => active.every(([k, v]) => matchesFilter(m, k, v, inCollection)));
}

export type FacetOption = { value: string; label: string; count: number };
export type Facet = { key: LibraryFilterKey; label: string; options: FacetOption[] };

const FACET_LIMIT = 40;

function countBy<T>(rows: readonly T[], keyOf: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function optionsFrom(counts: Map<string, number>, labelOf: (v: string) => string, limit = FACET_LIMIT): FacetOption[] {
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * The facet panel. Each facet counts the rows the OTHER filters leave (so the
 * chosen value of a facet never hides that facet's alternatives). Archived
 * rows only count when `rows` includes them (the caller's status filter).
 */
export function buildFacets<T extends FilterableMedia>(
  rows: readonly T[],
  filters: LibraryFilters,
  vendorNames: ReadonlyMap<string, string>,
  inCollection?: ReadonlySet<string>,
): Facet[] {
  const base = (skip: LibraryFilterKey) => applyLibraryFilters(rows, filters, inCollection, skip);
  const none = "none";
  const facets: Facet[] = [
    {
      key: "vendor",
      label: "Vendor",
      options: optionsFrom(countBy(base("vendor"), (r) => (r.vendor_id ?? "").toLowerCase() || none), (v) =>
        v === none ? "No vendor yet" : vendorNames.get(v) ?? "Unknown vendor card",
      ),
    },
    {
      key: "platform",
      label: "Came from",
      options: optionsFrom(countBy(base("platform"), (r) => r.platform || none), (v) => (v === none ? "Unknown" : PLATFORM_LABEL[v] ?? v)),
    },
    {
      key: "role",
      label: "What it is",
      options: optionsFrom(countBy(base("role"), (r) => r.role || none), (v) => (v === none ? "Not classified" : ROLE_LABEL[v] ?? v)),
    },
    {
      key: "category",
      label: "Category",
      options: optionsFrom(countBy(base("category"), (r) => (r.category ?? "").toLowerCase() || none), (v) => (v === none ? "No category" : v)),
    },
    {
      key: "review",
      label: "Review",
      options: optionsFrom(countBy(base("review"), (r) => r.review_state || "ok"), (v) => REVIEW_LABEL[v] ?? v),
    },
    {
      key: "seo",
      label: "SEO",
      options: optionsFrom(countBy(base("seo"), (r) => (hasSeo(r) ? "yes" : "no")), (v) => (v === "yes" ? "Has SEO" : "No SEO yet")),
    },
    {
      key: "ai",
      label: "AI closer look",
      options: optionsFrom(countBy(base("ai"), (r) => r.ai_status || "pending"), (v) => AI_LABEL[v] ?? v),
    },
  ];
  return facets.filter((f) => f.options.length > 0);
}

export const PLATFORM_LABEL: Record<string, string> = {
  cultivera: "Cultivera menu",
  growflow: "GrowFlow menu",
  leaflink: "LeafLink menu",
  email: "Vendor email",
  website: "Vendor website",
  upload: "Uploaded",
  ai: "AI made",
  other: "Other",
};
export const ROLE_LABEL: Record<string, string> = {
  product: "Product photo",
  packaging: "Packaging",
  flower: "Flower close-up",
  lifestyle: "Lifestyle",
  logo: "Logo",
  banner: "Banner",
  label: "Label",
  coa: "COA",
  menu: "Menu",
  marketing: "Marketing",
  other: "Other",
};
export const REVIEW_LABEL: Record<string, string> = { ok: "Looks right", needs_review: "Needs review", rejected: "Rejected" };
export const AI_LABEL: Record<string, string> = { pending: "Not looked at yet", done: "Described", failed: "Failed", skipped: "Skipped" };

// ---------------------------------------------------------------------------
// AI / human badges
// ---------------------------------------------------------------------------

export type FieldBadge = "ai" | "human" | "rule" | null;

/**
 * Who wrote a field: field_provenance says "ai:<model>", "human", or a rule
 * name ("derived", "menu", ...). An empty value has no badge.
 */
export function fieldBadge(prov: Record<string, unknown> | null | undefined, column: string, value: unknown): FieldBadge {
  const empty = value === null || value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
  if (empty) return null;
  const p = prov?.[column];
  if (typeof p !== "string" || !p.trim()) return null;
  if (p.startsWith("ai")) return "ai";
  if (p === "human") return "human";
  return "rule";
}

export const BADGE_TEXT: Record<Exclude<FieldBadge, null>, string> = { ai: "AI", human: "Person", rule: "Rule" };

/** The fields the detail page shows, in order, with their labels. */
export const SEO_FIELDS: readonly { column: string; label: string }[] = [
  { column: "seo_title", label: "SEO title" },
  { column: "seo_alt", label: "Alt text (SEO)" },
  { column: "seo_description", label: "SEO description" },
  { column: "seo_slug", label: "File name slug" },
  { column: "seo_keywords", label: "Keywords" },
  { column: "ai_caption", label: "Caption" },
  { column: "visible_text", label: "Text on the package" },
  { column: "ai_description", label: "What is in the picture" },
  { column: "ai_tags", label: "AI tags" },
  { column: "role", label: "What it is" },
  { column: "pack_size", label: "Pack size" },
  { column: "credit_text", label: "Credit" },
];

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export const BULK_ACTIONS = ["publish", "archive", "redescribe", "set-vendor", "undo-auto", "add-to-collection"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export function parseBulkAction(raw: unknown): BulkAction | null {
  const s = String(raw ?? "").trim();
  return (BULK_ACTIONS as readonly string[]).includes(s) ? (s as BulkAction) : null;
}

export type BulkRow = {
  id: string;
  status: string | null;
  mime_type: string | null;
  review_state?: string | null;
  publish_reason?: string | null;
  vendor_id?: string | null;
  ai_status?: string | null;
  canonical_id?: string | null;
  field_provenance?: Record<string, unknown> | null;
};

export type BulkStep =
  | { id: string; kind: "patch"; patch: Record<string, unknown> }
  | { id: string; kind: "rpc-undo" }
  | { id: string; kind: "collect" }
  | { id: string; kind: "skip"; reason: string };

const DESCRIBABLE = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

/**
 * What a bulk action does to ONE row. PURE. `vendorId` is the chosen vendor
 * for set-vendor (validated by the caller). Nothing here ever deletes.
 */
export function bulkStep(action: BulkAction, row: BulkRow, opts: { vendorId?: string | null; actorId?: string | null; nowIso: string }): BulkStep {
  const status = row.status ?? "draft";
  switch (action) {
    case "publish":
      if (status === "published") return { id: row.id, kind: "skip", reason: "already published" };
      if (row.review_state === "rejected") return { id: row.id, kind: "skip", reason: "rejected (un-reject it first)" };
      if (row.canonical_id) return { id: row.id, kind: "skip", reason: "an archived copy of another picture" };
      return { id: row.id, kind: "patch", patch: { status: "published", publish_reason: "human", published_by: opts.actorId ?? null, published_at: opts.nowIso } };
    case "archive":
      if (status === "archived") return { id: row.id, kind: "skip", reason: "already archived" };
      return { id: row.id, kind: "patch", patch: { status: "archived" } };
    case "redescribe":
      if (status === "archived") return { id: row.id, kind: "skip", reason: "archived" };
      if (row.review_state === "rejected") return { id: row.id, kind: "skip", reason: "rejected" };
      if (!DESCRIBABLE.has((row.mime_type ?? "").toLowerCase())) return { id: row.id, kind: "skip", reason: "not a picture the AI reads" };
      if (row.ai_status === "pending") return { id: row.id, kind: "skip", reason: "already waiting" };
      return { id: row.id, kind: "patch", patch: { ai_status: "pending", ai_error: null } };
    case "set-vendor": {
      const v = (opts.vendorId ?? "").trim().toLowerCase();
      if (!UUID_RE.test(v)) return { id: row.id, kind: "skip", reason: "no vendor chosen" };
      if ((row.vendor_id ?? "").toLowerCase() === v) return { id: row.id, kind: "skip", reason: "already that vendor" };
      const prov = { ...((row.field_provenance as Record<string, unknown> | null) ?? {}), vendor_id: "human" };
      return { id: row.id, kind: "patch", patch: { vendor_id: v, field_provenance: prov } };
    }
    case "undo-auto":
      if (status !== "published" || row.publish_reason !== "vendor-source-auto") return { id: row.id, kind: "skip", reason: "not auto-published" };
      return { id: row.id, kind: "rpc-undo" };
    case "add-to-collection":
      if (status === "archived") return { id: row.id, kind: "skip", reason: "archived" };
      return { id: row.id, kind: "collect" };
  }
}

export function bulkSummary(action: BulkAction, steps: readonly BulkStep[], done: number, failed: number): string {
  const verb: Record<BulkAction, string> = {
    publish: "Published",
    archive: "Archived",
    redescribe: "Queued for a fresh AI look",
    "set-vendor": "Set the vendor on",
    "undo-auto": "Set back to draft",
    "add-to-collection": "Added to the collection",
  };
  const skipped = steps.filter((s) => s.kind === "skip");
  const why = [...new Set(skipped.map((s) => (s.kind === "skip" ? s.reason : "")))].filter(Boolean).slice(0, 3);
  return `${verb[action]} ${done} file(s).${skipped.length ? ` Skipped ${skipped.length} (${why.join("; ")}).` : ""}${failed ? ` ${failed} could not be saved; try again.` : ""}`;
}

// ---------------------------------------------------------------------------
// Health dashboard
// ---------------------------------------------------------------------------

export type HealthTile = { key: string; label: string; value: string; hint: string; tone: "good" | "warn" | "muted" };

function num(h: Record<string, unknown> | null | undefined, k: string): number {
  const v = Number(h?.[k] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function healthTiles(h: Record<string, unknown> | null | undefined): HealthTile[] {
  if (!h) return [];
  const live = num(h, "live");
  const described = num(h, "ai_described");
  const seo = num(h, "with_seo");
  const published = num(h, "published");
  const vendor = num(h, "with_vendor");
  const review = num(h, "needs_review");
  const spend = num(h, "ai_spend_usd");
  return [
    { key: "described", label: "Described by AI", value: pct(described, live), hint: `${described} of ${live} live files`, tone: described >= live * 0.9 ? "good" : "warn" },
    { key: "seo", label: "SEO complete", value: pct(seo, live), hint: `${seo} have an SEO title and alt text`, tone: seo >= live * 0.9 ? "good" : "warn" },
    { key: "published", label: "Published", value: pct(published, live), hint: `${published} published, ${num(h, "auto_published")} of them automatically`, tone: "muted" },
    { key: "vendor", label: "Vendor known", value: pct(vendor, live), hint: `${vendor} of ${live} filed under a vendor`, tone: vendor >= live * 0.9 ? "good" : "warn" },
    { key: "review", label: "Waiting for review", value: String(review), hint: "Doubtful pictures a person decides", tone: review === 0 ? "good" : "warn" },
    { key: "copies", label: "Duplicate copies archived", value: String(num(h, "archived_copies")), hint: "Kept (never deleted), pointed at the original", tone: "muted" },
    { key: "spend", label: "AI spend", value: `$${spend.toFixed(2)}`, hint: "All AI runs on the library", tone: "muted" },
    { key: "zero", label: "Searches that found nothing (30 days)", value: String(num(h, "zero_result_30d")), hint: `${num(h, "searches_30d")} searches in all`, tone: num(h, "zero_result_30d") === 0 ? "good" : "warn" },
  ];
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export function collectionSlug(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function parseCollectionInput(raw: { name?: unknown; description?: unknown; kind?: unknown }):
  | { ok: true; name: string; slug: string; description: string | null; kind: "collection" | "brand-kit" }
  | { ok: false; error: string } {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Give the collection a name." };
  if (name.length > 120) return { ok: false, error: "Keep the name under 120 characters." };
  const slug = collectionSlug(name);
  if (!slug) return { ok: false, error: "Use at least one letter or number in the name." };
  const description = String(raw.description ?? "").trim().slice(0, 500) || null;
  const kind = raw.kind === "brand-kit" ? "brand-kit" : "collection";
  return { ok: true, name, slug, description, kind };
}

// ---------------------------------------------------------------------------
// Search log
// ---------------------------------------------------------------------------

export type SearchSurface = "library" | "picker" | "onboarding";

/** The row to log, or null when the search is not worth logging (empty / one letter). */
export function searchLogEntry(surface: SearchSurface, query: unknown, filters: Record<string, unknown>, results: number):
  | { surface: SearchSurface; query: string; filters: Record<string, string>; results: number }
  | null {
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 2) return null;
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters ?? {})) {
    if (typeof v === "string" && v.trim()) f[k] = v.trim().slice(0, 80);
  }
  return { surface, query: q, filters: f, results: Math.max(0, Math.floor(Number(results) || 0)) };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runLibraryV2CoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`library-v2-core: ${label}`);
    passed++;
  };
  const V1 = "11111111-1111-4111-8111-111111111111";
  const V2 = "22222222-2222-4222-8222-222222222222";

  // parse
  const f = parseLibraryFilters({ vendor: V1.toUpperCase(), platform: "cultivera", review: "needs_review", seo: "maybe", ai: "done", coll: "x", role: "product" });
  ok(f.vendor === V1, "vendor uuid kept, lower-cased");
  ok(f.platform === "cultivera" && f.role === "product", "platform + role kept");
  ok(f.review === "needs_review" && f.ai === "done", "review + ai kept");
  ok(f.seo === undefined && f.coll === undefined, "unknown seo / bad collection id dropped");
  ok(parseLibraryFilters({ vendor: "drop table" }).vendor === undefined, "bad vendor dropped");
  ok(parseLibraryFilters({ vendor: "none" }).vendor === "none", "vendor none kept");
  ok(Object.keys(parseLibraryFilters(null)).length === 0, "null -> no filters");

  // filters + facets
  const rows: FilterableMedia[] = [
    { id: "a", vendor_id: V1, platform: "cultivera", role: "product", category: "Flower", review_state: "ok", seo_alt: "x", seo_title: "y", ai_status: "done" },
    { id: "b", vendor_id: V1, platform: "growflow", role: "logo", category: null, review_state: "needs_review", ai_status: "pending" },
    { id: "c", vendor_id: V2, platform: "cultivera", role: "product", category: "flower", review_state: "ok", ai_status: "pending" },
    { id: "d", vendor_id: null, platform: null, role: null, category: null, review_state: "rejected", ai_status: "failed" },
  ];
  ok(applyLibraryFilters(rows, { vendor: V1 }).map((r) => r.id).join() === "a,b", "vendor filter");
  ok(applyLibraryFilters(rows, { vendor: "none" }).map((r) => r.id).join() === "d", "no-vendor filter");
  ok(applyLibraryFilters(rows, { category: "FLOWER" }).map((r) => r.id).join() === "a,c", "category is case-insensitive");
  ok(applyLibraryFilters(rows, { seo: "yes" }).map((r) => r.id).join() === "a", "has-SEO filter");
  ok(applyLibraryFilters(rows, { seo: "no" }).length === 3, "no-SEO filter");
  ok(applyLibraryFilters(rows, { coll: "c0" }, new Set(["c"])).map((r) => r.id).join() === "c", "collection filter");
  ok(applyLibraryFilters(rows, { vendor: V1, platform: "cultivera" }).map((r) => r.id).join() === "a", "filters AND together");
  const facets = buildFacets(rows, { vendor: V1 }, new Map([[V1, "Phat Panda"]]));
  const vf = facets.find((x) => x.key === "vendor")!;
  ok(vf.options.length === 3, "vendor facet ignores its own filter (shows the alternatives)");
  ok(vf.options[0]!.label === "Phat Panda" && vf.options[0]!.count === 2, "vendor facet labels + counts");
  ok(vf.options.some((o) => o.label === "Unknown vendor card"), "an unnamed vendor card is labelled honestly");
  const pf = facets.find((x) => x.key === "platform")!;
  ok(pf.options.reduce((s, o) => s + o.count, 0) === 2, "platform facet counted inside the vendor filter");
  const cf = buildFacets(rows, {}, new Map()).find((x) => x.key === "category")!;
  ok(cf.options.find((o) => o.value === "flower")?.count === 2, "category facet merges case");

  // badges
  ok(fieldBadge({ seo_alt: "ai:gpt-6-luna" }, "seo_alt", "x") === "ai", "ai badge");
  ok(fieldBadge({ seo_alt: "human" }, "seo_alt", "x") === "human", "human badge");
  ok(fieldBadge({ platform: "derived" }, "platform", "cultivera") === "rule", "rule badge");
  ok(fieldBadge({ seo_alt: "ai:x" }, "seo_alt", "") === null, "empty value -> no badge");
  ok(fieldBadge({}, "seo_alt", "x") === null, "no provenance -> no badge");
  ok(fieldBadge({ ai_tags: "ai:x" }, "ai_tags", []) === null, "empty array -> no badge");

  // bulk
  const now = "2026-11-11T00:00:00Z";
  const row: BulkRow = { id: "r", status: "draft", mime_type: "image/png", review_state: "ok", publish_reason: null, vendor_id: null, ai_status: "done", field_provenance: { platform: "derived" } };
  const pub = bulkStep("publish", row, { nowIso: now, actorId: "u1" });
  ok(pub.kind === "patch" && pub.patch.publish_reason === "human" && pub.patch.published_by === "u1", "publish marks human + who");
  ok(bulkStep("publish", { ...row, review_state: "rejected" }, { nowIso: now }).kind === "skip", "publish skips rejected");
  ok(bulkStep("publish", { ...row, canonical_id: "x" }, { nowIso: now }).kind === "skip", "publish skips an archived copy");
  ok(bulkStep("publish", { ...row, status: "published" }, { nowIso: now }).kind === "skip", "publish skips published");
  const arc = bulkStep("archive", row, { nowIso: now });
  ok(arc.kind === "patch" && arc.patch.status === "archived" && Object.keys(arc.patch).length === 1, "archive only changes status (never deletes)");
  const red = bulkStep("redescribe", row, { nowIso: now });
  ok(red.kind === "patch" && red.patch.ai_status === "pending", "re-describe queues the picture");
  ok(bulkStep("redescribe", { ...row, mime_type: "application/pdf" }, { nowIso: now }).kind === "skip", "re-describe skips a PDF");
  ok(bulkStep("redescribe", { ...row, review_state: "rejected" }, { nowIso: now }).kind === "skip", "re-describe skips rejected");
  ok(bulkStep("redescribe", { ...row, ai_status: "pending" }, { nowIso: now }).kind === "skip", "re-describe skips already waiting");
  const sv = bulkStep("set-vendor", row, { nowIso: now, vendorId: V2 });
  ok(sv.kind === "patch" && sv.patch.vendor_id === V2, "set vendor");
  ok(sv.kind === "patch" && (sv.patch.field_provenance as Record<string, string>).vendor_id === "human" && (sv.patch.field_provenance as Record<string, string>).platform === "derived", "set vendor marks human, keeps the rest");
  ok(bulkStep("set-vendor", row, { nowIso: now, vendorId: "nope" }).kind === "skip", "set vendor needs a real id");
  ok(bulkStep("set-vendor", { ...row, vendor_id: V2 }, { nowIso: now, vendorId: V2 }).kind === "skip", "set vendor skips no-op");
  ok(bulkStep("undo-auto", { ...row, status: "published", publish_reason: "vendor-source-auto" }, { nowIso: now }).kind === "rpc-undo", "undo auto-publish");
  ok(bulkStep("undo-auto", { ...row, status: "published", publish_reason: "human" }, { nowIso: now }).kind === "skip", "undo never touches a person's publish");
  ok(bulkStep("add-to-collection", row, { nowIso: now }).kind === "collect", "collect");
  ok(bulkStep("add-to-collection", { ...row, status: "archived" }, { nowIso: now }).kind === "skip", "collect skips archived");
  ok(parseBulkAction("delete") === null && parseBulkAction("publish") === "publish", "no delete action exists");
  ok(bulkSummary("archive", [{ id: "x", kind: "skip", reason: "already archived" }], 2, 0) === "Archived 2 file(s). Skipped 1 (already archived).", "summary");

  // health
  const tiles = healthTiles({ live: 100, ai_described: 95, with_seo: 10, published: 80, auto_published: 70, with_vendor: 99, needs_review: 3, ai_spend_usd: 1.234, archived_copies: 5, zero_result_30d: 0, searches_30d: 4 });
  ok(tiles.length === 8, "eight tiles");
  ok(tiles.find((t) => t.key === "described")!.value === "95%" && tiles.find((t) => t.key === "described")!.tone === "good", "described %");
  ok(tiles.find((t) => t.key === "seo")!.tone === "warn", "low SEO warns");
  ok(tiles.find((t) => t.key === "spend")!.value === "$1.23", "spend formatted");
  ok(healthTiles(null).length === 0, "no health -> no tiles");
  ok(healthTiles({ live: 0 }).find((t) => t.key === "described")!.value === "0%", "no divide by zero");

  // collections
  ok(collectionSlug("  Brand kit: Fairwinds!! ") === "brand-kit-fairwinds", "slug");
  ok(collectionSlug("Café ☕ shots") === "cafe-shots", "slug strips non-ascii");
  ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(collectionSlug("a".repeat(90) + " b")), "long slug still valid");
  const pc = parseCollectionInput({ name: "Hero shots", kind: "brand-kit" });
  ok(pc.ok && pc.slug === "hero-shots" && pc.kind === "brand-kit" && pc.description === null, "collection input");
  ok(!parseCollectionInput({ name: "  " }).ok, "empty name refused");
  ok(!parseCollectionInput({ name: "!!!" }).ok, "symbol-only name refused");

  // search log
  ok(searchLogEntry("library", "  blue   dream ", { vendor: V1, x: "" }, 4)?.query === "blue dream", "log normalizes spaces");
  ok(Object.keys(searchLogEntry("library", "blue", { vendor: V1, x: "" }, 4)!.filters).join() === "vendor", "empty filters dropped");
  ok(searchLogEntry("picker", "a", {}, 0) === null, "one letter not logged");
  ok(searchLogEntry("picker", "ab", {}, -3)!.results === 0, "negative results clamp");

  return { passed, failed: 0 };
}
