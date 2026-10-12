/**
 * src/lib/menu/product-tags-core.ts - R49 S5 + S6 (owner: Michael)
 *
 * OWNER'S ASK: "a tag system ... a New tag that is automatically applied when
 * a product is first put on the menu and removed 14 days later ... a Tag
 * Settings page where I can create tags, pick colours and apply or remove
 * them by hand ... and a Tags section in the menu filter."
 *
 * DESIGN (decided in docs/roadmap/R49-MENU-FILTERS-TAGS-GEMINI.md S5):
 *   - tag_definitions holds the owner's tags. auto_rule 'new_window' makes a
 *     tag apply automatically while (now - first_published_at) < window_days.
 *     It is a PURE TIME PREDICATE, so nothing has to run at midnight to take
 *     "New" off: it simply stops matching (the shop page re-renders at most
 *     every 60 s, so it disappears within a minute of the exact moment).
 *   - product_tag_assignments holds hand-applied tags.
 *   - product_first_seen holds the first time a product key was on a
 *     PUBLISHED menu (first stamp wins).
 *   - "now" is always PASSED IN (never read here), so the result is
 *     deterministic, testable, and never computed during a client render.
 *
 * Pure; self-tests via __runProductTagsCoreTests().
 */

export const TAG_AUTO_RULES = ["none", "new_window"] as const;
export type TagAutoRule = (typeof TAG_AUTO_RULES)[number];

export const NEW_TAG_SLUG = "new";
export const DEFAULT_NEW_WINDOW_DAYS = 14;
export const MAX_WINDOW_DAYS = 365;
export const MAX_TAG_LABEL = 32;
export const MAX_TAGS_ON_CARD = 3;
export const DEFAULT_TAG_COLOR = "#2f6b3a";
const DAY_MS = 24 * 60 * 60 * 1000;

/** One owner tag (tag_definitions row, camel-cased). */
export type TagDefinition = {
  id: string;
  slug: string;
  label: string;
  color: string;
  autoRule: TagAutoRule;
  windowDays: number;
  sortOrder: number;
  enabled: boolean;
  showOnMenu: boolean;
};

/** What a menu card / the Tags facet sees. */
export type MenuProductTag = { slug: string; label: string; color: string };

/** Ten readable presets for the colour picker (all pass WCAG AA with their text colour). */
export const TAG_COLOR_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Orange", hex: "#c2410c" },
  { name: "Greenway green", hex: "#2f6b3a" },
  { name: "Lime", hex: "#7ed957" },
  { name: "Blue", hex: "#1d4ed8" },
  { name: "Purple", hex: "#7e22ce" },
  { name: "Pink", hex: "#db2777" },
  { name: "Red", hex: "#b91c1c" },
  { name: "Gold", hex: "#eab308" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Charcoal", hex: "#27272a" },
];

/** "Staff Pick!" -> "staff-pick". Empty string when nothing usable remains. */
export function slugifyTag(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Accepts "#abc", "#AABBCC", "aabbcc"; returns lower-case "#rrggbb" or null. */
export function normalizeTagColor(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim().toLowerCase();
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a "#rrggbb" colour. */
export function relativeLuminance(hex: string): number {
  const n = normalizeTagColor(hex) ?? DEFAULT_TAG_COLOR;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white text, whichever reads better on the tag colour. */
export function tagTextColor(bg: string): "#000000" | "#ffffff" {
  return contrastRatio(bg, "#000000") >= contrastRatio(bg, "#ffffff") ? "#000000" : "#ffffff";
}

export function clampWindowDays(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_NEW_WINDOW_DAYS;
  return Math.min(n, MAX_WINDOW_DAYS);
}

/** True while the product is inside the "new" window. Unknown first-seen = not new. */
export function isInNewWindow(firstPublishedAt: string | null | undefined, nowMs: number, windowDays: number): boolean {
  if (!firstPublishedAt) return false;
  const t = Date.parse(firstPublishedAt);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - t;
  // A first-seen stamp a little in the future (clock skew) still counts as new.
  return age < clampWindowDays(windowDays) * DAY_MS && age > -DAY_MS;
}

/** The moment the window closes, or null. */
export function newWindowEndsAt(firstPublishedAt: string | null | undefined, windowDays: number): string | null {
  if (!firstPublishedAt) return null;
  const t = Date.parse(firstPublishedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + clampWindowDays(windowDays) * DAY_MS).toISOString();
}

export type TagFormInput = {
  label: string;
  color: string;
  autoRule?: string;
  windowDays?: string | number;
  sortOrder?: string | number;
  enabled?: boolean;
  showOnMenu?: boolean;
};

export type TagValidation =
  | { ok: true; value: Omit<TagDefinition, "id">; }
  | { ok: false; error: string };

/**
 * Validate a create/edit form. `existing` = the other tags (for the unique
 * slug check); `currentSlug` = the slug being edited (slugs never change once
 * created, so links like ?tags=staff-pick keep working after a rename).
 */
export function validateTagForm(
  input: TagFormInput,
  existing: readonly Pick<TagDefinition, "id" | "slug" | "label">[],
  currentSlug: string | null = null,
): TagValidation {
  const label = String(input.label ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { ok: false, error: "Give the tag a name." };
  if (label.length > MAX_TAG_LABEL) return { ok: false, error: `Keep the name to ${MAX_TAG_LABEL} characters or fewer.` };
  const slug = currentSlug ?? slugifyTag(label);
  if (!slug) return { ok: false, error: "The name needs at least one letter or number." };
  if (!currentSlug && existing.some((t) => t.slug === slug)) {
    return { ok: false, error: `A tag called "${label}" already exists.` };
  }
  const color = normalizeTagColor(input.color);
  if (!color) return { ok: false, error: "Pick a colour (for example #c2410c)." };
  const autoRule: TagAutoRule = input.autoRule === "new_window" ? "new_window" : "none";
  // Only the built-in New tag carries the automatic rule (one New tag, one
  // window; keeps the owner's mental model simple and the menu honest).
  if (autoRule === "new_window" && slug !== NEW_TAG_SLUG) {
    return { ok: false, error: "Only the built-in New tag can be automatic." };
  }
  const sortRaw = Math.round(Number(input.sortOrder ?? 100));
  const sortOrder = Number.isFinite(sortRaw) ? Math.min(Math.max(sortRaw, 0), 10000) : 100;
  return {
    ok: true,
    value: {
      slug,
      label,
      color,
      autoRule,
      windowDays: clampWindowDays(input.windowDays ?? DEFAULT_NEW_WINDOW_DAYS),
      sortOrder,
      enabled: input.enabled !== false,
      showOnMenu: input.showOnMenu !== false,
    },
  };
}

/** Order tags the way the owner set (sort order, then name). */
export function sortTags<T extends Pick<TagDefinition, "sortOrder" | "label">>(defs: readonly T[]): T[] {
  return [...defs].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export type ProductTagInputs = {
  defs: readonly TagDefinition[];
  /** pos_product_key -> tag ids applied by hand */
  manual: ReadonlyMap<string, readonly string[]>;
  /** pos_product_key -> first_published_at ISO */
  firstSeen: ReadonlyMap<string, string>;
  nowMs: number;
  /** true = staff view (includes tags hidden from the menu) */
  includeHidden?: boolean;
};

/** The tags one product shows, in the owner's order. Disabled tags never show. */
export function tagsForProduct(key: string, inputs: ProductTagInputs): MenuProductTag[] {
  const manualIds = new Set(inputs.manual.get(key) ?? []);
  const first = inputs.firstSeen.get(key) ?? null;
  const out: MenuProductTag[] = [];
  for (const d of sortTags(inputs.defs)) {
    if (!d.enabled) continue;
    if (!d.showOnMenu && !inputs.includeHidden) continue;
    const auto = d.autoRule === "new_window" && isInNewWindow(first, inputs.nowMs, d.windowDays);
    if (auto || manualIds.has(d.id)) out.push({ slug: d.slug, label: d.label, color: d.color });
  }
  return out;
}

/** Attach `tags` to every item (immutable; items without tags are returned as-is). */
export function attachTags<T extends { id: string; tags?: MenuProductTag[] }>(items: readonly T[], inputs: ProductTagInputs): T[] {
  return items.map((item) => {
    const tags = tagsForProduct(item.id, inputs);
    if (tags.length === 0) {
      if (!item.tags) return item;
      const { tags: _drop, ...rest } = item;
      void _drop;
      return rest as T;
    }
    return { ...item, tags };
  });
}

// ---------------------------------------------------------------------------
// S6: the menu "Tags" facet (?tags=slug,slug). OR within the facet, like
// every other checkbox facet.
// ---------------------------------------------------------------------------
type TaggedInput = { tags?: readonly MenuProductTag[] | null };

export function matchesTagSelection(item: TaggedInput, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const slugs = new Set((item.tags ?? []).map((t) => t.slug));
  return selected.some((s) => slugs.has(s));
}

export type TagFacetOption = { value: string; label: string; count: number };

/**
 * One option per tag present on the (already-filtered) items, in the order
 * the tags first appear (items carry tags in the owner's sort order, so the
 * facet follows it); a selected slug that matches nothing is kept with count
 * 0 so the shopper can always un-tick it.
 */
export function buildTagOptions(items: readonly TaggedInput[], selected: readonly string[] = [], knownLabels?: ReadonlyMap<string, string>): TagFacetOption[] {
  const bySlug = new Map<string, TagFacetOption>();
  const order = new Map<string, number>();
  for (const item of items) {
    (item.tags ?? []).forEach((t, idx) => {
      const existing = bySlug.get(t.slug);
      if (existing) existing.count += 1;
      else {
        bySlug.set(t.slug, { value: t.slug, label: t.label, count: 1 });
        order.set(t.slug, idx);
      }
    });
  }
  for (const s of selected) {
    if (!bySlug.has(s)) {
      bySlug.set(s, { value: s, label: knownLabels?.get(s) ?? s, count: 0 });
      order.set(s, 1000);
    }
  }
  // NEW first (the owner's headline tag), then the owner's order as seen.
  return [...bySlug.values()].sort((a, b) => {
    if (a.value === NEW_TAG_SLUG) return -1;
    if (b.value === NEW_TAG_SLUG) return 1;
    return (order.get(a.value) ?? 0) - (order.get(b.value) ?? 0) || a.label.localeCompare(b.label);
  });
}

/** Parse ?tags= into clean, de-duplicated slugs (max 20). */
export function parseTagParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      // a malformed %-escape: use the raw text (slugify strips the junk)
    }
    const s = slugifyTag(decoded);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

export function __runProductTagsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`product-tags-core FAIL: ${name}`);
    }
  };
  // slug
  ok(slugifyTag("Staff Pick!") === "staff-pick", "slug basic");
  ok(slugifyTag("  Café & Co  ") === "cafe-and-co", "slug accents + ampersand");
  ok(slugifyTag("!!!") === "", "slug empty when nothing usable");
  ok(slugifyTag("a".repeat(60)).length === 40, "slug capped at 40");
  ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugifyTag("--Hello--World--")), "slug matches DB check");
  // colour
  ok(normalizeTagColor("#ABC") === "#aabbcc", "colour expands short hex");
  ok(normalizeTagColor("C2410C") === "#c2410c", "colour adds hash");
  ok(normalizeTagColor("red") === null && normalizeTagColor("#12345") === null, "colour rejects junk");
  ok(tagTextColor("#000000") === "#ffffff" && tagTextColor("#ffffff") === "#000000", "text colour extremes");
  ok(tagTextColor("#7ed957") === "#000000", "lime gets black text");
  ok(TAG_COLOR_PRESETS.every((p) => contrastRatio(p.hex, tagTextColor(p.hex)) >= 4.5), "every preset passes WCAG AA");
  // window
  const now = Date.parse("2026-10-20T12:00:00Z");
  ok(isInNewWindow("2026-10-10T12:00:00Z", now, 14), "10 days old is new");
  ok(!isInNewWindow("2026-10-06T12:00:00Z", now, 14), "exactly 14 days is no longer new");
  ok(isInNewWindow("2026-10-06T12:00:01Z", now, 14), "one second inside the window is new");
  ok(!isInNewWindow("2026-10-10T12:00:00Z", now, 7), "window is configurable");
  ok(!isInNewWindow(null, now, 14) && !isInNewWindow("garbage", now, 14), "unknown first-seen is not new");
  ok(isInNewWindow("2026-10-20T13:00:00Z", now, 14), "small clock skew still new");
  ok(!isInNewWindow("2026-12-20T13:00:00Z", now, 14), "far-future stamp is not new");
  ok(clampWindowDays("0") === 14 && clampWindowDays(9999) === 365 && clampWindowDays("21") === 21, "window clamp");
  ok(newWindowEndsAt("2026-10-06T12:00:00Z", 14) === "2026-10-20T12:00:00.000Z", "window end date");
  // validation
  const existing = [{ id: "1", slug: "new", label: "New" }, { id: "2", slug: "staff-pick", label: "Staff Pick" }];
  const v1 = validateTagForm({ label: "Local Grower", color: "#1d4ed8" }, existing);
  ok(v1.ok && v1.value.slug === "local-grower" && v1.value.autoRule === "none", "valid create");
  ok(!validateTagForm({ label: "Staff pick", color: "#1d4ed8" }, existing).ok, "duplicate slug rejected");
  ok(!validateTagForm({ label: "", color: "#1d4ed8" }, existing).ok, "empty name rejected");
  ok(!validateTagForm({ label: "x".repeat(33), color: "#1d4ed8" }, existing).ok, "long name rejected");
  ok(!validateTagForm({ label: "Ok", color: "blue" }, existing).ok, "bad colour rejected");
  ok(!validateTagForm({ label: "Fresh", color: "#1d4ed8", autoRule: "new_window" }, existing).ok, "only New may be automatic");
  const v2 = validateTagForm({ label: "Just In", color: "#c2410c", autoRule: "new_window", windowDays: "10" }, existing, "new");
  ok(v2.ok && v2.value.slug === "new" && v2.value.windowDays === 10 && v2.value.label === "Just In", "rename New keeps slug + window");
  // tagsForProduct / attachTags
  const defs: TagDefinition[] = [
    { id: "t-new", slug: "new", label: "New", color: "#c2410c", autoRule: "new_window", windowDays: 14, sortOrder: 0, enabled: true, showOnMenu: true },
    { id: "t-sp", slug: "staff-pick", label: "Staff Pick", color: "#7e22ce", autoRule: "none", windowDays: 14, sortOrder: 10, enabled: true, showOnMenu: true },
    { id: "t-off", slug: "off", label: "Off", color: "#27272a", autoRule: "none", windowDays: 14, sortOrder: 5, enabled: false, showOnMenu: true },
    { id: "t-hid", slug: "hidden", label: "Hidden", color: "#27272a", autoRule: "none", windowDays: 14, sortOrder: 6, enabled: true, showOnMenu: false },
  ];
  const inputs: ProductTagInputs = {
    defs,
    manual: new Map([["A", ["t-sp", "t-off", "t-hid"]], ["B", ["t-sp"]]]),
    firstSeen: new Map([["A", "2026-10-15T00:00:00Z"], ["B", "2026-01-01T00:00:00Z"]]),
    nowMs: now,
  };
  const a = tagsForProduct("A", inputs);
  ok(a.map((t) => t.slug).join(",") === "new,staff-pick", "A: new (auto) + staff pick; disabled + hidden excluded; owner order");
  ok(tagsForProduct("A", { ...inputs, includeHidden: true }).some((t) => t.slug === "hidden"), "staff view includes hidden");
  ok(tagsForProduct("B", inputs).map((t) => t.slug).join(",") === "staff-pick", "B: old product not new");
  ok(tagsForProduct("C", inputs).length === 0, "C: no tags");
  ok(tagsForProduct("A", { ...inputs, defs: defs.map((d) => (d.slug === "new" ? { ...d, enabled: false } : d)) }).every((t) => t.slug !== "new"), "turning New off removes it");
  const attached = attachTags([{ id: "A" }, { id: "C", tags: [{ slug: "x", label: "x", color: "#000000" }] }], inputs);
  ok(attached[0].tags?.length === 2 && attached[1].tags === undefined, "attachTags sets and clears");
  // facet
  const items = [{ tags: a }, { tags: tagsForProduct("B", inputs) }, {}];
  ok(matchesTagSelection(items[0], ["new"]) && !matchesTagSelection(items[1], ["new"]), "facet match");
  ok(matchesTagSelection(items[1], ["new", "staff-pick"]), "facet OR within");
  ok(matchesTagSelection(items[2], []) && !matchesTagSelection(items[2], ["new"]), "untagged: matches only empty selection");
  const opts = buildTagOptions(items);
  ok(opts.length === 2 && opts[0].value === "new" && opts[0].count === 1 && opts[1].count === 2, "options with counts, New first");
  ok(buildTagOptions(items, ["gone"]).some((o) => o.value === "gone" && o.count === 0), "selected-but-absent kept");
  ok(buildTagOptions([], ["staff-pick"], new Map([["staff-pick", "Staff Pick"]]))[0].label === "Staff Pick", "absent option uses known label");
  ok(parseTagParam("new,Staff%20Pick,new,,%%") .join(",") === "new,staff-pick", "parse ?tags= dedupes and cleans");
  ok(parseTagParam(null).length === 0, "parse empty");
  return { passed, failed };
}
