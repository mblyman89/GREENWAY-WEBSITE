/**
 * src/lib/media/folders-core.ts — R65 S2, PURE core.
 *
 * Owner: "a super intelligent file/folder system for everything … product
 * photos, nested inside a folder for each source … a folder for all the
 * product photos currently in use … website banner assets broken down by
 * page, specials cards folders".
 *
 * Enterprise DAMs (Bynder, Brandfolder, Adobe AEM, Cloudinary) do NOT make the
 * owner drag 800 files into folders. They use SMART (virtual) collections:
 * rules over metadata decide which folders an asset appears in, and ONE asset
 * may appear in several (e.g. "Products › Menu scraping" AND "Products › In
 * use"). Nothing is moved, nothing can be mis-filed, and every new import
 * files itself the moment it lands.
 *
 * The rules below use ONLY the values the code base really writes (verified
 * call sites, R65 recon):
 *   - menu scraping (Cultivera / GrowFlow / LeafLink):  tags [platform, "product-image"|"coa", vendorTag]
 *   - products' vendor-menu import:                      tags [platform, "enrichment-import"]
 *   - vendor website harvest (KB):                       tags ["harvested", "product"]
 *   - web research / Gemini AI lookup:                   tags ["web-research", …]
 *   - hand upload:                                       source "upload:direct" (or no source)
 *   - FLUX: tags "flux"/"ai-generated"; Midjourney: "marketing"/"flux-reference"
 *   - emailed menus: usage "vendor-menu"; fonts: usage "font"
 * plus WHERE the asset is used (media_usages rows, product/vendor columns, and
 * page content that embeds its storage key) — gathered by folders-server.ts.
 */

/** The slice of a media_assets row the rules read. */
export type FolderAsset = {
  id: string;
  storage_key: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  alt_text: string | null;
  title: string | null;
  source: string | null;
  usage_type: string | null;
  tags: string[] | null;
  status: string | null;
};

/** Where an asset is used (built server-side, see folders-server.ts). */
export type FolderUse = {
  /** Attached to a product (enrichment / KB gallery / media_usages product). */
  onProduct: boolean;
  /** Used anywhere at all (any usage row, logo column, or page content). */
  anywhere: boolean;
  /** Website pages whose content embeds this asset (content_blocks.page etc.). */
  pages: string[];
  /** Content slot keys that embed it (e.g. "specials.deals.presentation"). */
  slots: string[];
};

export const NO_USE: FolderUse = { onProduct: false, anywhere: false, pages: [], slots: [] };

export type FolderNode = {
  id: string;
  label: string;
  icon: string;
  hint: string;
  count: number;
  children: FolderNode[];
};

const MENU_PLATFORMS = ["cultivera", "growflow", "leaflink"] as const;
const PLATFORM_LABEL: Record<string, string> = { cultivera: "Cultivera", growflow: "GrowFlow", leaflink: "LeafLink" };

/** Tags that describe the pipeline, not the vendor — never a vendor folder. */
const PIPELINE_TAGS = new Set<string>([
  ...MENU_PLATFORMS, "product-image", "coa", "harvested", "enrichment-import", "onboarding-import",
  "web-research", "product", "vendor", "flux", "ai-generated", "flux-image", "flux-video", "marketing",
  "flux-reference", "font", "vendor-logo", "brand-logo",
]);

/** Website page slugs → friendly names (content_blocks.page / page_sections.page_slug values). */
export const PAGE_LABELS: Record<string, string> = {
  home: "Home", menu: "Shop / Menu", specials: "Specials", loyalty: "Loyalty", vendors: "Vendors",
  about: "About", faq: "FAQ", locations: "Locations", "price-match": "Price match", medical: "Medical",
  blog: "Blog", business: "Branding", "header-footer": "Header & footer", footer: "Header & footer", legal: "Legal",
};

/** Placement tags (taxonomy.PLACEMENT_SUGGESTIONS) → page slug. */
const PLACEMENT_PAGE: Record<string, string> = {
  "home-hero": "home", "home-section": "home", "menu-banner": "menu", "loyalty-banner": "loyalty",
  "specials-banner": "specials", "vendors-banner": "vendors", "faq-banner": "faq", "about-banner": "about",
  "locations-banner": "locations", "price-match-banner": "price-match", header: "header-footer", footer: "header-footer",
};

/** The specials weekly-deal cards live in this one content block. */
export const SPECIALS_CARDS_SLOT = "specials.deals.presentation";

export function pageSlugOf(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (p === "footer") return "header-footer";
  if (p.startsWith("legal")) return "legal";
  return p;
}

function tagSet(a: FolderAsset): Set<string> {
  return new Set((a.tags ?? []).map((t) => t.toLowerCase()));
}

/** The vendor tag a menu import added (first non-pipeline tag), or null. */
export function vendorTagOf(a: FolderAsset): string | null {
  for (const t of a.tags ?? []) {
    const n = t.toLowerCase();
    if (n && !PIPELINE_TAGS.has(n) && !PLACEMENT_PAGE[n]) return n;
  }
  return null;
}

/** "acme-farms" → "Acme Farms". */
export function prettyTag(tag: string): string {
  return tag.split("-").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

/** Which product source a product photo came from (one answer). */
export function productSourceOf(a: FolderAsset): "menu" | "vendor-site" | "web-research" | "upload" | "other" {
  const t = tagSet(a);
  if (MENU_PLATFORMS.some((p) => t.has(p))) return "menu";
  if (t.has("web-research")) return "web-research";
  if (t.has("harvested")) return "vendor-site";
  const src = (a.source ?? "").toLowerCase();
  if (!src || src === "upload:direct") return "upload";
  return "other";
}

function isPdf(a: FolderAsset): boolean {
  return (a.mime_type ?? "") === "application/pdf";
}

/**
 * Every folder id this asset appears in (leaf folders AND their parents).
 * Virtual: an asset can live in many folders at once.
 */
export function folderIdsFor(a: FolderAsset, use: FolderUse = NO_USE): string[] {
  const out = new Set<string>(["all"]);
  const add = (id: string) => {
    const parts = id.split("/");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  };
  const usage = (a.usage_type ?? "").toLowerCase();
  const t = tagSet(a);
  const pages = new Set(use.pages.map(pageSlugOf));
  for (const tag of t) if (PLACEMENT_PAGE[tag]) pages.add(PLACEMENT_PAGE[tag]!);

  // Products (photos) — by source, platform, vendor, and in-use.
  if (usage === "product" && !(t.has("coa") || isPdf(a))) {
    const src = productSourceOf(a);
    add(`products/${src}`);
    if (src === "menu") {
      for (const p of MENU_PLATFORMS) if (t.has(p)) add(`products/menu/${p}`);
    }
    const v = vendorTagOf(a);
    if (v && src === "menu") add(`products/by-vendor/${v}`);
    add(use.onProduct ? "products/in-use" : "products/not-used");
  }
  // Documents (COAs, newsletter PDFs, other PDFs).
  if (usage === "document" || usage === "newsletter-pdf" || t.has("coa") || (isPdf(a) && usage !== "vendor-menu")) {
    if (t.has("coa")) add("documents/coas");
    else if (usage === "newsletter-pdf") add("documents/newsletters");
    else add("documents/other");
  }
  // Logos.
  if (usage === "logo") add("logos/greenway");
  if (usage === "brand-logo") add("logos/brands");
  if (usage === "vendor-logo") add("logos/vendors");
  // Website by page (banners, heroes, backgrounds, and anything a page embeds).
  const isSiteArt = usage === "hero" || usage === "banner" || usage === "background" || usage === "icon";
  for (const p of pages) {
    if (p === "specials") continue; // specials has its own folder below
    add(`website/${p}`);
  }
  if (isSiteArt && pages.size === 0) add("website/not-placed");
  // Specials (weekly-deal cards vs. banners).
  if (use.slots.includes(SPECIALS_CARDS_SLOT)) add("specials/cards");
  const otherSpecialsSlot = use.slots.some((s) => s.startsWith("specials.") && s !== SPECIALS_CARDS_SLOT);
  if (pages.has("specials") && (!use.slots.includes(SPECIALS_CARDS_SLOT) || otherSpecialsSlot)) add("specials/banners");
  // Blog & newsletter art.
  if (usage === "blog-hero" || usage === "blog") add("blog/covers");
  if (usage === "newsletter") add("blog/newsletter-art");
  // Marketing / AI generated.
  if (t.has("flux") || t.has("ai-generated")) add("marketing/ai-generated");
  else if (t.has("flux-reference") || (usage === "marketing" && t.has("marketing"))) add("marketing/midjourney");
  else if (usage === "marketing") add("marketing/other");
  // Vendor menus (emailed), fonts.
  if (usage === "vendor-menu") add("vendor-menus");
  if (usage === "font") add("fonts");

  // Needs attention (health).
  const filed = [...out].some((id) => id !== "all");
  if (!filed) add("review/unfiled");
  if (a.status === "draft") add("review/drafts");
  if (a.status === "archived") add("review/archived");
  if ((a.mime_type ?? "").startsWith("image/") && !(a.alt_text ?? "").trim()) add("review/no-alt");
  if (!use.anywhere) add("review/unused");
  return [...out];
}

/** Static skeleton (dynamic children — pages, vendors — are added by buildFolderTree). */
const SKELETON: Array<{ id: string; label: string; icon: string; hint: string }> = [
  { id: "products", label: "Product photos", icon: "🛍️", hint: "Every product photo, by where it came from." },
  { id: "products/in-use", label: "In use on a product", icon: "✅", hint: "Attached to a product right now." },
  { id: "products/not-used", label: "Not on any product yet", icon: "⏳", hint: "Imported but not attached to a product." },
  { id: "products/menu", label: "Menu scraping", icon: "🧾", hint: "Pulled from vendor menus (Cultivera, GrowFlow, LeafLink)." },
  { id: "products/vendor-site", label: "Vendor website", icon: "🌐", hint: "Harvested from the vendor's own website." },
  { id: "products/web-research", label: "Web research (Gemini)", icon: "✨", hint: "Found by the AI look-up / web research and imported." },
  { id: "products/upload", label: "Uploaded by hand", icon: "⬆️", hint: "Uploaded from a computer or phone." },
  { id: "products/other", label: "Other sources", icon: "📦", hint: "Product photos from any other source." },
  { id: "products/by-vendor", label: "By vendor", icon: "🏷️", hint: "Menu photos grouped by the vendor they came from." },
  { id: "website", label: "Website pages", icon: "🖥️", hint: "Banners, heroes and images, by the page that uses them." },
  { id: "website/not-placed", label: "Banners not placed yet", icon: "📭", hint: "Banner / hero art no page uses yet." },
  { id: "specials", label: "Specials", icon: "🔥", hint: "The Specials page's deal cards and banners." },
  { id: "specials/cards", label: "Weekly deal cards", icon: "🃏", hint: "Images used in the 7 weekly deal cards." },
  { id: "specials/banners", label: "Specials banners", icon: "🖼️", hint: "Hero / Today's Deal banner art." },
  { id: "logos", label: "Logos", icon: "🔰", hint: "Greenway, brand and vendor logos." },
  { id: "logos/greenway", label: "Greenway", icon: "🌿", hint: "Your own logos." },
  { id: "logos/brands", label: "Brands", icon: "🏷️", hint: "Product brand logos." },
  { id: "logos/vendors", label: "Vendors", icon: "🚚", hint: "Vendor logos." },
  { id: "documents", label: "Documents", icon: "📄", hint: "COAs, newsletter PDFs and other files." },
  { id: "documents/coas", label: "COAs (lab results)", icon: "🧪", hint: "Certificates of analysis from vendor menus." },
  { id: "documents/newsletters", label: "Newsletter PDFs", icon: "📰", hint: "Newsletter files." },
  { id: "documents/other", label: "Other documents", icon: "📁", hint: "Any other PDF or file." },
  { id: "blog", label: "Blog & newsletter", icon: "✍️", hint: "Blog covers and newsletter art." },
  { id: "blog/covers", label: "Blog covers", icon: "🖼️", hint: "Blog post hero images." },
  { id: "blog/newsletter-art", label: "Newsletter art", icon: "📰", hint: "Newsletter covers / art." },
  { id: "marketing", label: "Marketing & AI", icon: "🎨", hint: "AI-generated and marketing art." },
  { id: "marketing/ai-generated", label: "AI generated (FLUX)", icon: "🤖", hint: "Made by the FLUX image/video generator." },
  { id: "marketing/midjourney", label: "Midjourney & references", icon: "🎨", hint: "Midjourney uploads and reference images." },
  { id: "marketing/other", label: "Other marketing", icon: "📣", hint: "Other marketing images." },
  { id: "vendor-menus", label: "Emailed vendor menus", icon: "✉️", hint: "Images from menus vendors emailed in." },
  { id: "fonts", label: "Fonts", icon: "🔤", hint: "Custom font files." },
  { id: "review", label: "Needs attention", icon: "🩺", hint: "Tidy-up lists — fix these to keep the library healthy." },
  { id: "review/unfiled", label: "Unfiled", icon: "❓", hint: "Doesn't fit any folder — give it a purpose." },
  { id: "review/drafts", label: "Drafts", icon: "📝", hint: "Not published yet (won't show on the public site)." },
  { id: "review/no-alt", label: "Missing alt text", icon: "♿", hint: "Images without a description for screen readers / SEO." },
  { id: "review/unused", label: "Not used anywhere", icon: "🧹", hint: "Not used by any product, page or logo — clean-up candidates." },
  { id: "review/duplicates", label: "Possible duplicates", icon: "👯", hint: "Same file name and size as another asset." },
  { id: "review/archived", label: "Archived", icon: "🗄️", hint: "Archived assets." },
];

/** Ids of assets that share filename + byte size with another asset. */
export function duplicateIds(assets: FolderAsset[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const a of assets) {
    if (!a.filename || !a.size_bytes) continue;
    const k = `${a.filename.toLowerCase()}|${a.size_bytes}`;
    groups.set(k, [...(groups.get(k) ?? []), a.id]);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => out.add(id));
  return out;
}

/** asset id → every folder id (duplicates folded in). */
export function folderIndex(assets: FolderAsset[], uses: Map<string, FolderUse>): Map<string, string[]> {
  const dups = duplicateIds(assets);
  const idx = new Map<string, string[]>();
  for (const a of assets) {
    const ids = folderIdsFor(a, uses.get(a.id) ?? NO_USE);
    if (dups.has(a.id)) ids.push("review", "review/duplicates");
    idx.set(a.id, [...new Set(ids)]);
  }
  return idx;
}

function dynLabel(id: string): { label: string; icon: string; hint: string } {
  const [root, mid, leaf] = id.split("/");
  if (root === "website" && mid) return { label: PAGE_LABELS[mid] ?? prettyTag(mid), icon: "📄", hint: `Used on the ${PAGE_LABELS[mid] ?? mid} page.` };
  if (root === "products" && mid === "by-vendor" && leaf) return { label: prettyTag(leaf), icon: "🏷️", hint: `Menu photos from ${prettyTag(leaf)}.` };
  if (root === "products" && mid === "menu" && leaf) return { label: PLATFORM_LABEL[leaf] ?? leaf, icon: "🧾", hint: `Scraped from ${PLATFORM_LABEL[leaf] ?? leaf} menus.` };
  return { label: prettyTag(id.split("/").pop() ?? id), icon: "📁", hint: "" };
}

/** Build the counted tree. Empty folders are dropped (except roots with kids). */
export function buildFolderTree(idx: Map<string, string[]>): FolderNode[] {
  const counts = new Map<string, number>();
  for (const ids of idx.values()) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const meta = new Map(SKELETON.map((s) => [s.id, s]));
  const order = new Map(SKELETON.map((s, i) => [s.id, i]));
  const nodes = new Map<string, FolderNode>();
  for (const [id, count] of counts) {
    if (id === "all" || count === 0) continue;
    const m = meta.get(id) ?? { id, ...dynLabel(id) };
    nodes.set(id, { id, label: m.label, icon: m.icon, hint: m.hint, count, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.id.includes("/") ? n.id.slice(0, n.id.lastIndexOf("/")) : null;
    if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(n);
    else if (!parent) roots.push(n);
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => {
      const oa = order.get(a.id), ob = order.get(b.id);
      if (oa !== undefined && ob !== undefined) return oa - ob;
      if (oa !== undefined) return -1;
      if (ob !== undefined) return 1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Breadcrumb trail for a folder id ("products/menu/growflow" → 3 crumbs). */
export function folderTrail(id: string): Array<{ id: string; label: string }> {
  if (!id || id === "all") return [];
  const meta = new Map(SKELETON.map((s) => [s.id, s]));
  const parts = id.split("/");
  return parts.map((_, i) => {
    const fid = parts.slice(0, i + 1).join("/");
    return { id: fid, label: meta.get(fid)?.label ?? dynLabel(fid).label };
  });
}

/** Folder ids accepted from the URL (?folder=) — conservative charset. */
export function safeFolderId(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9/-]{0,80}$/.test(v) ? v : "all";
}

export function __runMediaFoldersCoreTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error("FAIL media-folders-core:", m); } };
  const base: FolderAsset = { id: "a", storage_key: "k", filename: "x.jpg", mime_type: "image/jpeg", size_bytes: 10, alt_text: "x", title: "x", source: null, usage_type: null, tags: [], status: "published" };
  const menu = { ...base, id: "m", usage_type: "product", source: "crawl:https://x", tags: ["harvested", "growflow", "product-image", "acme-farms"] };
  const f1 = folderIdsFor(menu, { onProduct: true, anywhere: true, pages: [], slots: [] });
  ok(f1.includes("products/menu/growflow") && f1.includes("products/by-vendor/acme-farms") && f1.includes("products/in-use"), "menu photo filed by platform+vendor+in-use");
  ok(!f1.includes("products/vendor-site"), "menu import isn't vendor-site even though harvested");
  ok(productSourceOf({ ...base, usage_type: "product", tags: ["harvested", "product"] }) === "vendor-site", "KB harvest = vendor website");
  ok(productSourceOf({ ...base, usage_type: "product", tags: ["harvested", "web-research", "enrichment-import"] }) === "web-research", "research = web-research");
  ok(productSourceOf({ ...base, usage_type: "product", source: "upload:direct" }) === "upload", "direct upload");
  const coa = folderIdsFor({ ...base, usage_type: "document", mime_type: "application/pdf", tags: ["cultivera", "coa"] });
  ok(coa.includes("documents/coas") && !coa.some((x) => x.startsWith("products")), "COA in documents only");
  const ban = folderIdsFor({ ...base, usage_type: "banner" }, { onProduct: false, anywhere: true, pages: ["home", "specials"], slots: [SPECIALS_CARDS_SLOT] });
  ok(ban.includes("website/home") && ban.includes("specials/cards") && !ban.includes("website/specials"), "banner by page + specials cards");
  ok(folderIdsFor({ ...base, usage_type: "hero" }).includes("website/not-placed"), "unplaced hero");
  ok(folderIdsFor({ ...base, tags: ["loyalty-banner"] }).includes("website/loyalty"), "placement tag → page");
  ok(folderIdsFor({ ...base }).includes("review/unfiled"), "nothing matches → unfiled");
  ok(folderIdsFor({ ...base, alt_text: "" }).includes("review/no-alt"), "missing alt");
  ok(folderIdsFor({ ...base, usage_type: "marketing", tags: ["flux", "ai-generated"] }).includes("marketing/ai-generated"), "flux");
  const idx = folderIndex([menu, { ...menu, id: "m2", filename: "x.jpg" }, { ...base, id: "b", filename: "x.jpg", size_bytes: 10 }], new Map());
  ok(idx.get("b")!.includes("review/duplicates"), "duplicate detection");
  const tree = buildFolderTree(idx);
  ok(tree[0]!.id === "products" && tree[0]!.count === 2, "tree root order + counts");
  ok(tree.find((n) => n.id === "products")!.children.some((c) => c.id === "products/by-vendor" && c.children[0]!.label === "Acme Farms"), "dynamic vendor folder");
  ok(folderTrail("products/menu/growflow").map((c) => c.label).join(">") === "Product photos>Menu scraping>GrowFlow", "trail");
  ok(safeFolderId("../etc") === "all" && safeFolderId("website/home") === "website/home", "safe id");
  return { passed, failed };
}
