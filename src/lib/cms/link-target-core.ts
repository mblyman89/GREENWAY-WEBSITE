/**
 * src/lib/cms/link-target-core.ts — R41 S1 (bible PART 5.6, SLICE S1).
 *
 * PURE link-target model for every button the owner places on a banner.
 * The owner asked for "an easy way to link my buttons to wherever I want …
 * menu filtered for something … a specific blog or newsletter". The editor's
 * LinkPicker (S2) builds hrefs with these helpers, shows `describeHref` under
 * each button in plain English, and refuses anything `checkHref` blocks.
 *
 * Facts copied from the code (verified at S1 time, see bible PART 4.7):
 * - Menu URL params and their write order: InteractiveMenuBrowser.tsx L804-816
 *   (search, categories, strains, terpenes, brands, vendors, weights, maxThc,
 *   maxCbd, maxPrice, sort, doh, classification) + `special` (L685).
 *   Lists are comma-joined; the reader splits on "," (parsePersistedList).
 * - Sort values: SORT_OPTION_VALUES (InteractiveMenuBrowser.tsx L592-599).
 *   Labels: SortDropdown.tsx sortOptions.
 * - Special keys: previewSpecialCollections (InteractiveMenuBrowser.tsx L85).
 * - Categories: websiteCategoryDefinitions (category-taxonomy.ts, pure).
 * - Strains: strainTypeDefinitions (strain-taxonomy.ts, pure).
 * - Newsletters are blog posts with kind "newsletter" at /blog/<slug>.
 *
 * InteractiveMenuBrowser is a client component, so its lists are COPIED here;
 * tests/compliance/r41-design-cores.test.ts is the drift guard.
 */
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";
import { strainTypeDefinitions } from "@/lib/menu/strain-taxonomy";

export type LinkKind = "page" | "menu" | "category" | "blog" | "special" | "external" | "contact" | "anchor" | "unknown";

/** Public routes a button may point at (verified with `ls src/app`). */
export const PUBLIC_PAGES: { path: string; label: string }[] = [
  { path: "/", label: "Home page" },
  { path: "/menu", label: "Shop menu" },
  { path: "/specials", label: "Specials" },
  { path: "/loyalty", label: "Loyalty sign-up" },
  { path: "/medical", label: "Medical" },
  { path: "/vendor-delivery", label: "Vendors & brands" },
  { path: "/blog", label: "Blog & newsletters" },
  { path: "/about", label: "About us" },
  { path: "/faq", label: "FAQ" },
  { path: "/locations", label: "Locations" },
  { path: "/price-match", label: "Price match" },
  { path: "/privacy-policy", label: "Privacy policy" },
  { path: "/terms-of-use", label: "Terms of use" },
  { path: "/consumer-health-data", label: "Consumer health data" },
];

/** The menu's six URL-persisted sort values (SORT_OPTION_VALUES) + labels (SortDropdown). */
export const MENU_SORTS: { value: string; label: string }[] = [
  { value: "featured-shuffle", label: "Featured Shuffle" },
  { value: "best-sellers", label: "Best Sellers" },
  { value: "price-low", label: "Price Low-High" },
  { value: "price-high", label: "Price High-Low" },
  { value: "potency-high", label: "High to Low Potency" },
  { value: "category", label: "Category" },
];

/** previewSpecialCollections keys + labels (InteractiveMenuBrowser.tsx L85-130). */
export const MENU_SPECIALS: { value: string; label: string }[] = [
  { value: "clearance-50", label: "50% Off Clearance" },
  { value: "doobie-tuesday", label: "Doobie Tuesday" },
  { value: "wax-wednesday", label: "Wax Wednesday" },
  { value: "top-shelf-thursday", label: "Top Shelf Thursday" },
  { value: "super-saturday", label: "Super Saturday" },
  { value: "ice-cream-sunday", label: "Ice Cream Sunday" },
];

/** Strain filter values the menu understands (excluding "unknown"). */
export const MENU_STRAINS: { value: string; label: string }[] = strainTypeDefinitions
  .filter((d) => d.value !== "unknown")
  .map((d) => ({ value: d.value, label: d.label }));

export const MENU_CATEGORIES: { value: string; label: string }[] = websiteCategoryDefinitions.map((d) => ({
  value: d.value,
  label: d.label,
}));

const CATEGORY_LABEL = new Map(MENU_CATEGORIES.map((c) => [c.value, c.label]));
const SORT_LABEL = new Map(MENU_SORTS.map((s) => [s.value, s.label]));
const SPECIAL_LABEL = new Map(MENU_SPECIALS.map((s) => [s.value, s.label]));
const STRAIN_LABEL = new Map(MENU_STRAINS.map((s) => [s.value, s.label]));

export type MenuFilters = {
  categories: string[];
  strains: string[];
  brands: string[];
  vendors: string[];
  weights: string[];
  special: string | null;
  sort: string | null;
  maxPrice: number | null;
  maxThc: number | null;
  maxCbd: number | null;
  search: string;
};

export function emptyMenuFilters(): MenuFilters {
  return {
    categories: [],
    strains: [],
    brands: [],
    vendors: [],
    weights: [],
    special: null,
    sort: null,
    maxPrice: null,
    maxThc: null,
    maxCbd: null,
    search: "",
  };
}

/** Params the menu reads (resolveInitialParams), used to warn about unknown ones. */
export const KNOWN_MENU_PARAMS = [
  "search",
  "category",
  "brand",
  "special",
  "categories",
  "strains",
  "terpenes",
  "brands",
  "vendors",
  "weights",
  "maxThc",
  "maxCbd",
  "maxPrice",
  "sort",
  "doh",
  "classification",
] as const;

/** Fixed write order (bible L-2). */
const LIST_ORDER = ["categories", "strains", "brands", "vendors", "weights"] as const;

/** Encode one list value; a literal comma inside a value becomes %2C so it never splits. */
function encodeListValue(v: string): string {
  return encodeURIComponent(v.trim());
}

function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function cleanNum(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100) / 100;
}

/** Canonical /menu?… href with a fixed param order; empties dropped. */
export function buildMenuHref(filters: Partial<MenuFilters>): string {
  const parts: string[] = [];
  for (const key of LIST_ORDER) {
    const list = cleanList(filters[key]);
    if (list.length) parts.push(`${key}=${list.map(encodeListValue).join(",")}`);
  }
  const special = typeof filters.special === "string" ? filters.special.trim() : "";
  if (special) parts.push(`special=${encodeURIComponent(special)}`);
  const sort = typeof filters.sort === "string" ? filters.sort.trim() : "";
  if (sort && sort !== "featured-shuffle") parts.push(`sort=${encodeURIComponent(sort)}`);
  for (const key of ["maxPrice", "maxThc", "maxCbd"] as const) {
    const n = cleanNum(filters[key]);
    if (n !== null) parts.push(`${key}=${n}`);
  }
  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  return parts.length ? `/menu?${parts.join("&")}` : "/menu";
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** Split a raw (still-encoded) query string into [key, rawValue] pairs. */
function rawPairs(query: string): [string, string][] {
  return query
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [decodeSafe(p), ""] : [decodeSafe(p.slice(0, i)), p.slice(i + 1)];
    });
}

/** Parse a /menu href back into filters (round-trips buildMenuHref). Null when not a menu link. */
export function parseMenuHref(href: string): { filters: MenuFilters; unknownParams: string[] } | null {
  const h = (href ?? "").trim();
  const m = /^\/menu(?:\?([^#]*))?(?:#.*)?$/.exec(h);
  if (!m) return null;
  const filters = emptyMenuFilters();
  const unknownParams: string[] = [];
  for (const [key, raw] of rawPairs(m[1] ?? "")) {
    const list = () => raw.split(",").map(decodeSafe).map((v) => v.trim()).filter(Boolean);
    switch (key) {
      case "categories":
      case "strains":
      case "brands":
      case "vendors":
      case "weights":
        filters[key] = list();
        break;
      case "category":
        if (!filters.categories.length) filters.categories = list().slice(0, 1);
        break;
      case "brand":
        if (!filters.brands.length) filters.brands = list().slice(0, 1);
        break;
      case "special":
        filters.special = decodeSafe(raw).trim() || null;
        break;
      case "sort":
        filters.sort = decodeSafe(raw).trim() || null;
        break;
      case "maxPrice":
      case "maxThc":
      case "maxCbd": {
        const n = Number(decodeSafe(raw));
        filters[key] = raw !== "" && Number.isFinite(n) && n >= 0 ? n : null;
        break;
      }
      case "search":
        filters.search = decodeSafe(raw).trim();
        break;
      default:
        if (!(KNOWN_MENU_PARAMS as readonly string[]).includes(key)) unknownParams.push(key);
    }
  }
  return { filters, unknownParams };
}

export function buildCategoryHref(category: string): string {
  return `/menu/${encodeURIComponent((category ?? "").trim().toLowerCase())}`;
}

/** Slug sanitized to the blog's [a-z0-9-] convention. */
export function sanitizeSlug(slug: string): string {
  return (slug ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildBlogHref(slug: string): string {
  return `/blog/${sanitizeSlug(slug)}`;
}

export function linkKindOf(href: string): LinkKind {
  const h = (href ?? "").trim();
  if (!h) return "unknown";
  if (h.startsWith("#")) return "anchor";
  if (/^(tel|mailto):/i.test(h)) return "contact";
  if (/^https?:\/\//i.test(h)) return "external";
  if (/^\/menu\/[^/?#]+\/?$/.test(h)) return "category";
  if (/^\/menu(\?|#|$)/.test(h)) {
    const p = parseMenuHref(h);
    if (p) {
      const f = p.filters;
      const onlySpecial =
        f.special &&
        !f.categories.length &&
        !f.strains.length &&
        !f.brands.length &&
        !f.vendors.length &&
        !f.weights.length &&
        !f.sort &&
        f.maxPrice === null &&
        f.maxThc === null &&
        f.maxCbd === null &&
        !f.search;
      return onlySpecial ? "special" : "menu";
    }
    return "menu";
  }
  if (/^\/blog\/[^/?#]+/.test(h)) return "blog";
  if (h.startsWith("/")) return "page";
  return "unknown";
}

export type HrefCheck = { ok: boolean; level: "ok" | "warn" | "block"; message: string };

const OK: HrefCheck = { ok: true, level: "ok", message: "" };
const warn = (message: string): HrefCheck => ({ ok: true, level: "warn", message });
const block = (message: string): HrefCheck => ({ ok: false, level: "block", message });

/** Validate a button href (bible L-4). "block" must never be saved or rendered. */
export function checkHref(href: string): HrefCheck {
  const raw = typeof href === "string" ? href : "";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return block("This link contains hidden control characters.");
  const h = raw.trim();
  if (!h) return block("Pick where this button goes.");
  const compact = h.replace(/\s+/g, "").toLowerCase();
  if (/^(javascript|data|vbscript):/.test(compact)) return block("That kind of link isn't allowed (it could run code).");
  if (h.startsWith("//") || h.startsWith("\\")) return block("Links starting with // aren't allowed. Use https:// for outside websites.");
  if (/\s/.test(h)) return block("Links can't contain spaces.");
  const kind = linkKindOf(h);
  switch (kind) {
    case "anchor":
      return h.length > 1 ? OK : warn("“#” alone goes nowhere. Add a section id, e.g. #shop-by-category.");
    case "contact": {
      const rest = h.replace(/^(tel|mailto):/i, "");
      if (!rest) return block("Add the phone number or email after tel: / mailto:.");
      if (/^tel:/i.test(h) && !/^\+?[0-9().-]{7,}$/.test(rest)) return warn("That phone number looks unusual.");
      if (/^mailto:/i.test(h) && !/^[^@]+@[^@]+\.[^@]+$/.test(rest.split("?")[0])) return warn("That email address looks unusual.");
      return OK;
    }
    case "external":
      if (/^http:\/\//i.test(h)) return warn("This outside link isn't secure (http). Use https:// if the site supports it.");
      try {
        new URL(h);
      } catch {
        return block("That outside web address isn't valid.");
      }
      return OK;
    case "category": {
      const cat = decodeSafe(h.replace(/^\/menu\//, "").replace(/\/$/, ""));
      return CATEGORY_LABEL.has(cat) ? OK : warn(`“${cat}” isn't one of the menu categories.`);
    }
    case "menu":
    case "special": {
      const p = parseMenuHref(h);
      if (!p) return warn("This menu link has an unusual shape.");
      const problems: string[] = [];
      if (p.unknownParams.length) problems.push(`unknown filter${p.unknownParams.length > 1 ? "s" : ""}: ${p.unknownParams.join(", ")}`);
      const f = p.filters;
      const badCats = f.categories.filter((c) => !CATEGORY_LABEL.has(c));
      if (badCats.length) problems.push(`unknown category: ${badCats.join(", ")}`);
      const badStrains = f.strains.filter((s) => !STRAIN_LABEL.has(s));
      if (badStrains.length) problems.push(`unknown strain: ${badStrains.join(", ")}`);
      if (f.sort && !SORT_LABEL.has(f.sort)) problems.push(`unknown sort: ${f.sort}`);
      if (f.special && !SPECIAL_LABEL.has(f.special)) problems.push(`special “${f.special}” isn't a built-in menu lane (the menu will ignore it unless it matches a sale)`);
      return problems.length ? warn(`Check this menu link — ${problems.join("; ")}.`) : OK;
    }
    case "blog":
      return OK;
    case "page": {
      const path = h.split(/[?#]/)[0].replace(/\/$/, "") || "/";
      if (PUBLIC_PAGES.some((p) => p.path === path)) return OK;
      if (/^\/menu\/products\/[^/]+$/.test(path)) return OK;
      return warn(`“${path}” isn't a known page on the site. Double-check it.`);
    }
    default:
      return warn("This link doesn't look like a page, menu, blog or https:// address.");
  }
}

export type DescribeContext = {
  blogTitles?: Record<string, string>;
  categoryLabels?: Record<string, string>;
};

/** Plain-English summary of where a link goes (bible L-3). */
export function describeHref(href: string, ctx?: DescribeContext): string {
  const h = (href ?? "").trim();
  const catLabel = (c: string) => ctx?.categoryLabels?.[c] ?? CATEGORY_LABEL.get(c) ?? c;
  const kind = linkKindOf(h);
  switch (kind) {
    case "anchor":
      return `Jumps to a section on this page (${h})`;
    case "contact":
      return /^tel:/i.test(h) ? `Calls ${h.slice(4)}` : `Emails ${h.slice(7).split("?")[0]}`;
    case "external": {
      try {
        return `Outside website: ${new URL(h).hostname}`;
      } catch {
        return "Outside website";
      }
    }
    case "category": {
      const cat = decodeSafe(h.replace(/^\/menu\//, "").replace(/\/$/, ""));
      return `Shop menu · ${catLabel(cat)} page`;
    }
    case "special":
    case "menu": {
      const p = parseMenuHref(h);
      if (!p) return "Shop menu";
      const f = p.filters;
      const bits: string[] = [];
      if (f.special) bits.push(`Special: ${SPECIAL_LABEL.get(f.special) ?? f.special}`);
      if (f.categories.length) bits.push(f.categories.map(catLabel).join(" + "));
      if (f.strains.length) bits.push(f.strains.map((s) => STRAIN_LABEL.get(s) ?? s).join(" + "));
      if (f.brands.length) bits.push(`Brand: ${f.brands.join(", ")}`);
      if (f.vendors.length) bits.push(`Vendor: ${f.vendors.join(", ")}`);
      if (f.weights.length) bits.push(`Size: ${f.weights.join(", ")}`);
      if (f.maxPrice !== null) bits.push(`Up to $${f.maxPrice}`);
      if (f.maxThc !== null) bits.push(`THC ≤ ${f.maxThc}%`);
      if (f.maxCbd !== null) bits.push(`CBD ≤ ${f.maxCbd}%`);
      if (f.search) bits.push(`Search “${f.search}”`);
      if (f.sort) bits.push(SORT_LABEL.get(f.sort) ?? f.sort);
      return bits.length ? `Shop menu · ${bits.join(" · ")}` : "Shop menu (everything)";
    }
    case "blog": {
      const slug = decodeSafe(h.replace(/^\/blog\//, "").split(/[?#/]/)[0]);
      const title = ctx?.blogTitles?.[slug];
      return `Blog post: ${title ?? slug}`;
    }
    case "page": {
      const path = h.split(/[?#]/)[0].replace(/\/$/, "") || "/";
      const page = PUBLIC_PAGES.find((p) => p.path === path);
      if (page) return page.label;
      if (/^\/menu\/products\//.test(path)) return "A product page";
      return `Page ${path}`;
    }
    default:
      return h ? h : "Not set";
  }
}

// ── Self-tests ────────────────────────────────────────────────────────────────

export function __runLinkTargetCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL link-target-core: ${msg}`);
    }
  };

  // 1-3 build
  ok(buildMenuHref({ categories: ["flower", "preroll"] }) === "/menu?categories=flower,preroll", "categories comma-joined");
  ok(
    buildMenuHref({ sort: "price-low", strains: ["indica"], categories: ["flower"] }) ===
      "/menu?categories=flower&strains=indica&sort=price-low",
    "fixed param order",
  );
  ok(buildMenuHref({}) === "/menu" && buildMenuHref(emptyMenuFilters()) === "/menu", "empty filters → /menu");
  ok(buildMenuHref({ sort: "featured-shuffle" }) === "/menu", "default sort omitted (menu omits it too)");
  // 4 encoding
  const enc = buildMenuHref({ search: "blue dream & co", brands: ["A, B Farms"] });
  ok(enc === "/menu?brands=A%2C%20B%20Farms&search=blue%20dream%20%26%20co", `encoding: ${enc}`);
  // 5 round trip
  const f1 = { ...emptyMenuFilters(), categories: ["flower", "preroll"], strains: ["indica"], brands: ["A, B Farms"], sort: "price-low", maxPrice: 40, search: "blue dream & co" };
  const rt = parseMenuHref(buildMenuHref(f1));
  ok(!!rt && JSON.stringify(rt.filters) === JSON.stringify(f1), "round trip");
  ok(!!rt && rt.filters.brands.length === 1 && rt.filters.brands[0] === "A, B Farms", "comma brand stays one brand");
  // 6 unknown params
  const unk = parseMenuHref("/menu?categories=flower&bogus=1");
  ok(!!unk && unk.unknownParams.includes("bogus"), "unknown params reported");
  ok(checkHref("/menu?categories=flower&bogus=1").level === "warn", "unknown param warns");
  ok(parseMenuHref("/specials") === null, "non-menu → null");
  ok(parseMenuHref("/menu?category=flower")!.filters.categories[0] === "flower", "legacy single category read");
  // 7 category
  ok(buildCategoryHref("flower") === "/menu/flower", "category href");
  ok(checkHref("/menu/flower").level === "ok", "known category ok");
  ok(checkHref("/menu/nope").level === "warn", "unknown category warns");
  // 8 blog
  ok(buildBlogHref("my-post") === "/blog/my-post", "blog href");
  ok(buildBlogHref(" My Post!! ") === "/blog/my-post", "slug sanitized");
  // 9 blocks
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "/menu\u0000"]) {
    ok(checkHref(bad).level === "block", `blocks ${JSON.stringify(bad)}`);
  }
  ok(checkHref("").level === "block", "empty blocked");
  // 10 http/https
  ok(checkHref("http://example.com").level === "warn", "http warns");
  ok(checkHref("https://example.com/x").level === "ok", "https ok");
  // 11 contact
  ok(checkHref("tel:+13605550123").level === "ok", "tel ok");
  ok(checkHref("mailto:a@b.co").level === "ok", "mailto ok");
  ok(checkHref("tel:").level === "block", "empty tel blocked");
  // 12 anchors
  ok(checkHref("#shop-by-category").level === "ok", "anchor ok");
  ok(checkHref("#").level === "warn", "bare # warns");
  // 13 unknown internal
  ok(checkHref("/nope").level === "warn", "unknown page warns");
  ok(checkHref("/specials").level === "ok" && checkHref("/").level === "ok", "known pages ok");
  ok(checkHref("/menu/products/abc123").level === "ok", "product page ok");
  // 14-16 describe
  const d = describeHref("/menu?categories=flower,preroll&sort=price-low");
  ok(d.includes("Flower") && d.includes("Preroll") && d.includes("Price Low-High"), `menu describe: ${d}`);
  ok(describeHref("/blog/my-post", { blogTitles: { "my-post": "My Post" } }) === "Blog post: My Post", "blog title used");
  ok(describeHref("/blog/my-post") === "Blog post: my-post", "blog slug fallback");
  ok(describeHref("https://www.example.com/a") === "Outside website: www.example.com", "external hostname");
  ok(describeHref("/menu?special=doobie-tuesday").includes("Doobie Tuesday"), "special described");
  ok(describeHref("/specials") === "Specials", "page label");
  // 17 kinds
  ok(linkKindOf("/") === "page", "kind page");
  ok(linkKindOf("/menu?categories=flower") === "menu", "kind menu");
  ok(linkKindOf("/menu/flower") === "category", "kind category");
  ok(linkKindOf("/blog/x") === "blog", "kind blog");
  ok(linkKindOf("/menu?special=wax-wednesday") === "special", "kind special");
  ok(linkKindOf("https://x.com") === "external", "kind external");
  ok(linkKindOf("tel:1") === "contact" && linkKindOf("mailto:a@b.c") === "contact", "kind contact");
  ok(linkKindOf("#a") === "anchor", "kind anchor");
  // 18 numbers
  ok(buildMenuHref({ maxPrice: Number.NaN }) === "/menu", "NaN price dropped");
  ok(buildMenuHref({ maxPrice: -5 }) === "/menu", "negative price dropped");
  ok(buildMenuHref({ maxPrice: 25 }) === "/menu?maxPrice=25", "price kept");
  // 19-20 unknown values
  ok(checkHref("/menu?special=nope").level === "warn", "unknown special warns");
  ok(checkHref("/menu?strains=purple").level === "warn", "unknown strain warns");
  ok(checkHref("/menu?special=doobie-tuesday").level === "ok", "known special ok");
  ok(checkHref("/menu?categories=flower&strains=indica&sort=price-low").level === "ok", "clean menu link ok");
  // lists
  ok(MENU_SORTS.length === 6 && MENU_SPECIALS.length === 6, "copied lists sized");
  ok(MENU_CATEGORIES.some((c) => c.value === "flower") && MENU_STRAINS.every((s) => s.value !== "unknown"), "taxonomy lists");

  return { passed, failed };
}
