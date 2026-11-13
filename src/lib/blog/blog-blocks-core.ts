/**
 * D239 N-7 (SOP-22 G-117; F-22-15, F-22-18, F-22-20; Q-22-7): rich blog posts.
 *
 * Pure (no server imports). A post body is still the `text[]` column it has
 * always been: every array item is one paragraph. A paragraph that starts
 * with a short code becomes a block; everything else stays a plain
 * paragraph, so every old post renders exactly as before (no migration).
 *
 *   ## Heading text                          -> heading
 *   > Quote text — First name | https://link -> quote (the link is optional)
 *   [image: https://… | alt text | caption]  -> image (from Digital Assets)
 *   [product: Name | /menu/… | https://image | short note] -> product card
 *   [button: Label | /deals]                 -> call-to-action button
 *   Sources: https://a · https://b           -> source list (the culture
 *                                               desk already writes this line)
 *
 * Also here: the Article JSON-LD builder and the same-page /blog filters
 * (Q-22-7: no new tab or page; culture stays the CULTURE card on /blog).
 */

export type BlogBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "image"; src: string; alt: string; caption: string }
  | { type: "product"; name: string; href: string; image: string; note: string }
  | { type: "quote"; text: string; name: string; href: string }
  | { type: "button"; label: string; href: string }
  | { type: "sources"; links: string[] };

export type BlogBlockType = BlogBlock["type"];

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Links: a site path ("/deals", never "//host") or an http(s) URL. Else "". */
export function safeBlogLink(v: unknown): string {
  const s = clean(v, 1000);
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//") && !/[\s"<>\\]/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Images: a site path or an https URL only (no http, no data:). */
export function safeBlogImage(v: unknown): string {
  const s = clean(v, 1000);
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//") && !/[\s"<>\\]/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const SHORT_RE = /^\[(image|product|button)\s*:\s*([\s\S]*)\]$/i;
const SOURCES_RE = /^sources?\s*:\s*(.+)$/i;
const URL_ONLY_RE = /^https?:\/\/\S+$/i;

function parts(raw: string): string[] {
  return raw.split("|").map((p) => p.trim());
}

/** Turn one stored paragraph into a block. Anything not recognised stays a paragraph. */
export function parseBlogBlock(paragraph: string): BlogBlock {
  const p = String(paragraph ?? "").trim();
  const asText: BlogBlock = { type: "paragraph", text: p };
  if (!p) return asText;

  const h = /^#{1,3}\s+([\s\S]+)$/.exec(p);
  if (h) {
    const text = clean(h[1], 160);
    return text ? { type: "heading", text } : asText;
  }

  if (p.startsWith(">")) {
    let body = p.replace(/^>\s?/, "").replace(/\n>\s?/g, "\n").trim();
    let href = "";
    const pipe = body.lastIndexOf(" | ");
    if (pipe > 0) {
      const maybe = safeBlogLink(body.slice(pipe + 3));
      if (maybe) {
        href = maybe;
        body = body.slice(0, pipe).trim();
      }
    }
    let name = "";
    const dash = Math.max(body.lastIndexOf(" — "), body.lastIndexOf(" -- "));
    if (dash > 0) {
      name = clean(body.slice(dash).replace(/^\s*(—|--)\s*/, ""), 40);
      body = body.slice(0, dash).trim();
    }
    const text = body.replace(/[ \t]+/g, " ").trim().slice(0, 600);
    return text ? { type: "quote", text, name, href } : asText;
  }

  const sc = SHORT_RE.exec(p);
  if (sc) {
    const kind = sc[1].toLowerCase();
    const f = parts(sc[2]);
    if (kind === "image") {
      const src = safeBlogImage(f[0]);
      return src ? { type: "image", src, alt: clean(f[1], 200), caption: clean(f[2], 200) } : asText;
    }
    if (kind === "product") {
      const name = clean(f[0], 120);
      return name ? { type: "product", name, href: safeBlogLink(f[1]), image: safeBlogImage(f[2]), note: clean(f[3], 300) } : asText;
    }
    const label = clean(f[0], 50);
    const href = safeBlogLink(f[1]);
    return label && href ? { type: "button", label, href } : asText;
  }

  const src = SOURCES_RE.exec(p);
  if (src) {
    const tokens = src[1]
      .split(/\s*(?:·|\||,)\s*|\s+/)
      .map((t) => t.replace(/[.;:]+$/, "").trim())
      .filter(Boolean);
    if (tokens.length && tokens.every((t) => URL_ONLY_RE.test(t))) {
      const links = [...new Set(tokens.map((t) => safeBlogLink(t)).filter(Boolean))];
      if (links.length) return { type: "sources", links };
    }
  }
  return asText;
}

export function parseBlogBody(paragraphs: readonly string[] | null | undefined): BlogBlock[] {
  return (paragraphs ?? []).map((p) => parseBlogBlock(p)).filter((b) => !(b.type === "paragraph" && !b.text));
}

/** Write a block back as its stored paragraph (round-trips with parseBlogBlock). */
export function serializeBlogBlock(b: BlogBlock): string {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "heading":
      return `## ${b.text}`;
    case "quote":
      return `> ${b.text}${b.name ? ` — ${b.name}` : ""}${b.href ? ` | ${b.href}` : ""}`;
    case "image":
      return `[image: ${b.src} | ${b.alt}${b.caption ? ` | ${b.caption}` : ""}]`;
    case "product":
      return `[product: ${b.name} | ${b.href} | ${b.image} | ${b.note}]`;
    case "button":
      return `[button: ${b.label} | ${b.href}]`;
    case "sources":
      return `Sources: ${b.links.join(" · ")}`;
  }
}

/** Starter text the editor's Insert buttons drop into the body. */
export const BLOG_BLOCK_SNIPPETS: Record<Exclude<BlogBlockType, "paragraph">, { label: string; text: string }> = {
  heading: { label: "Heading", text: "## A short heading" },
  image: { label: "Image", text: "[image: https://… | Describe the picture | Optional caption]" },
  product: { label: "Product card", text: "[product: Product name | /menu | https://… image (optional) | One short, factual line]" },
  quote: { label: "Quote", text: "> The quote goes here — First name" },
  button: { label: "Button", text: "[button: See this week's deals | /deals]" },
  sources: { label: "Source list", text: "Sources: https://…" },
};

/** Paragraphs that look like a block but did not parse (shown in the editor so nothing odd goes live). */
export function blogBlockIssues(paragraphs: readonly string[]): string[] {
  const out: string[] = [];
  paragraphs.forEach((raw, i) => {
    const p = raw.trim();
    const b = parseBlogBlock(p);
    if (b.type !== "paragraph") return;
    const n = i + 1;
    if (SHORT_RE.test(p)) {
      const kind = SHORT_RE.exec(p)![1].toLowerCase();
      if (kind === "image") out.push(`Paragraph ${n}: the image needs an https:// address or a /site path (pick one from Digital Assets).`);
      else if (kind === "button") out.push(`Paragraph ${n}: the button needs a label and a link, like [button: See deals | /deals].`);
      else out.push(`Paragraph ${n}: the product card needs a name first.`);
    } else if (/^\[(image|product|button|sources?)\b/i.test(p)) {
      out.push(`Paragraph ${n}: a block short code must start with [ and end with ] on its own paragraph.`);
    } else if (SOURCES_RE.test(p)) {
      out.push(`Paragraph ${n}: a Sources line should hold only links (https://…), separated by · or |.`);
    }
  });
  return out;
}

/** Plain words of a body (for counts and AI), short codes reduced to their visible text. */
export function blogPlainText(paragraphs: readonly string[]): string {
  return parseBlogBody(paragraphs)
    .map((b) => {
      switch (b.type) {
        case "paragraph":
        case "heading":
          return b.text;
        case "quote":
          return b.name ? `“${b.text}” ${b.name}` : `“${b.text}”`;
        case "image":
          return b.caption;
        case "product":
          return [b.name, b.note].filter(Boolean).join(". ");
        case "button":
          return b.label;
        case "sources":
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Body text for the culture health guard: a picture address is not a source,
 * so image blocks give only their words; every other block keeps its links
 * (a product or button link is still caught as a product link).
 */
export function blogGuardParagraphs(paragraphs: readonly string[]): string[] {
  return (paragraphs ?? []).map((raw) => {
    const b = parseBlogBlock(raw);
    if (b.type === "image") return [b.alt, b.caption].filter(Boolean).join(". ");
    if (b.type === "product") return [b.name, b.note, b.href].filter(Boolean).join(". ");
    return raw;
  });
}

// ---------------------------------------------------------------------------
// Article JSON-LD (F-22-20)
// ---------------------------------------------------------------------------
export type ArticleSchemaInput = {
  slug: string;
  title: string;
  excerpt: string;
  publishDate: string;
  author: string;
  imageSrc: string;
  kind?: string;
};

function absolute(siteUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${siteUrl.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

export function blogArticleSchema(post: ArticleSchemaInput, siteUrl: string, siteName: string, logoPath: string): Record<string, unknown> {
  const url = absolute(siteUrl, `/blog/${post.slug}`);
  const ms = Date.parse(post.publishDate);
  const date = Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  const author = clean(post.author, 80) || siteName;
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: clean(post.title, 110),
    description: clean(post.excerpt, 300) || undefined,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: post.imageSrc ? [absolute(siteUrl, post.imageSrc)] : undefined,
    datePublished: date,
    dateModified: date,
    author: /team|greenway/i.test(author) ? { "@type": "Organization", name: author, url: siteUrl } : { "@type": "Person", name: author },
    publisher: { "@type": "Organization", name: siteName, url: siteUrl, logo: { "@type": "ImageObject", url: absolute(siteUrl, logoPath) } },
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so a title can never close the tag. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// ---------------------------------------------------------------------------
// Same-page filters on /blog (F-22-18; Q-22-7: no new tab or page)
// ---------------------------------------------------------------------------
export type BlogView = "all" | "store" | "culture" | "newsletter";
export const BLOG_VIEWS: readonly { key: BlogView; label: string; categories: readonly string[] }[] = [
  { key: "all", label: "All", categories: [] },
  { key: "store", label: "Store", categories: ["PRODUCTS", "DEALS"] },
  { key: "culture", label: "Culture", categories: ["CULTURE"] },
  { key: "newsletter", label: "Newsletters", categories: ["NEWSLETTER"] },
];

export function viewFromHash(hash: string | null | undefined): BlogView {
  const k = String(hash ?? "").replace(/^#/, "").trim().toLowerCase();
  return (BLOG_VIEWS.find((v) => v.key === k)?.key ?? "all") as BlogView;
}

export function filterPostsByView<T extends { category: string }>(posts: readonly T[], view: BlogView): T[] {
  const def = BLOG_VIEWS.find((v) => v.key === view);
  if (!def || def.key === "all") return [...posts];
  return posts.filter((p) => def.categories.includes(String(p.category).toUpperCase()));
}

export function viewCounts<T extends { category: string }>(posts: readonly T[]): Record<BlogView, number> {
  const out = { all: posts.length, store: 0, culture: 0, newsletter: 0 } as Record<BlogView, number>;
  for (const v of BLOG_VIEWS) if (v.key !== "all") out[v.key] = filterPostsByView(posts, v.key).length;
  return out;
}

// ---------------------------------------------------------------------------
// Digital Assets picker (F-22-15)
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The hero picked from the library: a media id, used only when no new file was uploaded. */
export function pickedHeroId(raw: unknown, uploaded: boolean): string | undefined {
  if (uploaded) return undefined;
  const s = String(raw ?? "").trim();
  return UUID_RE.test(s) ? s.toLowerCase() : undefined;
}

// ---------------------------------------------------------------------------
export function __runBlogBlocksCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL blog-blocks-core: ${name}`);
    }
  };

  // Backward compatible: plain paragraphs are untouched.
  const old = ["First paragraph about flower.", "Second paragraph, with a comma: and a colon."];
  const ob = parseBlogBody(old);
  ok("old paragraphs stay paragraphs", ob.length === 2 && ob.every((b) => b.type === "paragraph"));
  ok("old text is unchanged", ob[0].type === "paragraph" && ob[0].text === old[0]);
  ok("empty body", parseBlogBody([]).length === 0 && parseBlogBody(null).length === 0);
  ok("blank paragraphs dropped", parseBlogBody(["", "  ", "x"]).length === 1);

  // Heading
  const h = parseBlogBlock("## What is new");
  ok("heading parsed", h.type === "heading" && h.text === "What is new");
  ok("# also heading", parseBlogBlock("# Big").type === "heading");
  ok("hashtag is not heading", parseBlogBlock("#greenway rocks").type === "paragraph");

  // Quote
  const q = parseBlogBlock("> Friendly staff and great picks — Sam | https://g.page/r/abc");
  ok("quote text", q.type === "quote" && q.text === "Friendly staff and great picks");
  ok("quote name", q.type === "quote" && q.name === "Sam");
  ok("quote link", q.type === "quote" && q.href === "https://g.page/r/abc");
  const q2 = parseBlogBlock("> Just a quote");
  ok("quote without name", q2.type === "quote" && q2.name === "" && q2.href === "");
  const q3 = parseBlogBlock("> Bad link — Jo | javascript:alert(1)");
  ok("quote bad link not used", q3.type === "quote" && q3.href === "");

  // Image
  const im = parseBlogBlock("[image: https://x.supabase.co/storage/v1/object/public/media/a.jpg | Jars on a shelf | New in]");
  ok("image src", im.type === "image" && im.src.startsWith("https://x.supabase.co/"));
  ok("image alt + caption", im.type === "image" && im.alt === "Jars on a shelf" && im.caption === "New in");
  ok("image site path ok", parseBlogBlock("[image: /blog/a.png | a]").type === "image");
  ok("image http refused", parseBlogBlock("[image: http://x.com/a.png | a]").type === "paragraph");
  ok("image data: refused", parseBlogBlock("[image: data:image/png;base64,AAA | a]").type === "paragraph");
  ok("image // refused", parseBlogBlock("[image: //evil.com/a.png | a]").type === "paragraph");
  ok("image case-insensitive", parseBlogBlock("[Image: /a.png | a]").type === "image");

  // Product
  const pr = parseBlogBlock("[product: Blue Dream 3.5g | /menu?q=blue | /blog/p.png | Sweet berry aroma.]");
  ok("product parsed", pr.type === "product" && pr.name === "Blue Dream 3.5g" && pr.href === "/menu?q=blue" && pr.image === "/blog/p.png" && pr.note === "Sweet berry aroma.");
  ok("product name only", parseBlogBlock("[product: Gummies]").type === "product");
  ok("product without name refused", parseBlogBlock("[product:  | /menu]").type === "paragraph");
  const prBad = parseBlogBlock("[product: X | javascript:alert(1) | http://a/b.png | n]");
  ok("product bad link + http image blanked", prBad.type === "product" && prBad.href === "" && prBad.image === "");

  // Button
  const bt = parseBlogBlock("[button: See deals | /deals]");
  ok("button parsed", bt.type === "button" && bt.label === "See deals" && bt.href === "/deals");
  ok("button needs link", parseBlogBlock("[button: See deals]").type === "paragraph");
  ok("button refuses javascript", parseBlogBlock("[button: x | javascript:alert(1)]").type === "paragraph");

  // Sources (the culture desk line)
  const so = parseBlogBlock("Sources: https://a.gov/x · https://b.org/y");
  ok("sources parsed", so.type === "sources" && so.links.length === 2);
  ok("single Source:", parseBlogBlock("Source: https://lcb.wa.gov/news").type === "sources");
  ok("sources dedupe", (() => { const s = parseBlogBlock("Sources: https://a.gov/x | https://a.gov/x"); return s.type === "sources" && s.links.length === 1; })());
  ok("Sources with words stays text", parseBlogBlock("Sources: our staff and https://a.gov").type === "paragraph");
  ok("trailing period trimmed", (() => { const s = parseBlogBlock("Source: https://a.gov/x."); return s.type === "sources" && s.links[0] === "https://a.gov/x"; })());

  // Round trip
  const all: BlogBlock[] = [
    { type: "paragraph", text: "Hello" },
    { type: "heading", text: "Head" },
    { type: "quote", text: "Great", name: "Al", href: "https://g.page/r/x" },
    { type: "image", src: "/a.png", alt: "A", caption: "C" },
    { type: "product", name: "P", href: "/menu", image: "/p.png", note: "N" },
    { type: "button", label: "Go", href: "/deals" },
    { type: "sources", links: ["https://a.gov/x", "https://b.org/y"] },
  ];
  for (const b of all) ok(`round trip ${b.type}`, JSON.stringify(parseBlogBlock(serializeBlogBlock(b))) === JSON.stringify(b));
  for (const [k, s] of Object.entries(BLOG_BLOCK_SNIPPETS)) {
    if (k === "image" || k === "sources") continue; // need a real address first
    ok(`snippet ${k} parses`, parseBlogBlock(s.text).type === k);
  }

  // Issues
  ok("issue for bad image", blogBlockIssues(["[image: nope | a]"]).length === 1);
  ok("issue for bad button", blogBlockIssues(["[button: x]"])[0].includes("label and a link"));
  ok("no issue for plain", blogBlockIssues(["Plain text.", "## H"]).length === 0);
  ok("issue for unclosed code", blogBlockIssues(["[image: /a.png | a"]).length === 1);

  // Plain text
  const pt = blogPlainText(["## H", "Body", "[button: Go | /deals]", "Sources: https://a.gov"]);
  ok("plain text keeps words", pt.includes("H") && pt.includes("Body") && pt.includes("Go"));
  ok("plain text drops source urls", !pt.includes("https://a.gov"));

  // Guard text
  const gp = blogGuardParagraphs(["[image: https://x.supabase.co/a.jpg | Jar | Cap]", "Sources: https://a.gov/x", "[product: P | /menu | https://cdn.x/p.png | n]"]);
  ok("guard drops image url", !gp[0].includes("https://") && gp[0].includes("Jar"));
  ok("guard keeps source", gp[1].includes("https://a.gov/x"));
  ok("guard keeps product link, drops product photo", gp[2].includes("/menu") && !gp[2].includes("cdn.x"));

  // JSON-LD
  const ld = blogArticleSchema({ slug: "x-y", title: "Title", excerpt: "Ex", publishDate: "2026-06-20", author: "Greenway Team", imageSrc: "/blog/a.png" }, "https://www.greenwaymarijuana.com", "Greenway Marijuana", "/logo.png");
  ok("ld type", ld["@type"] === "BlogPosting" && ld["@context"] === "https://schema.org");
  ok("ld url", ld.url === "https://www.greenwaymarijuana.com/blog/x-y");
  ok("ld image absolute", Array.isArray(ld.image) && (ld.image as string[])[0] === "https://www.greenwaymarijuana.com/blog/a.png");
  ok("ld date iso", typeof ld.datePublished === "string" && (ld.datePublished as string).startsWith("2026-06-20"));
  ok("ld team author is org", (ld.author as { "@type": string })["@type"] === "Organization");
  const ld2 = blogArticleSchema({ slug: "a", title: "T", excerpt: "", publishDate: "", author: "Michael", imageSrc: "https://cdn.x/a.png" }, "https://s.com/", "S", "/l.png");
  ok("ld person author", (ld2.author as { "@type": string })["@type"] === "Person");
  ok("ld no bad date / empty description", !("datePublished" in ld2) && !("description" in ld2));
  ok("ld keeps absolute image", (ld2.image as string[])[0] === "https://cdn.x/a.png");
  ok("jsonLdText escapes <", !jsonLdText({ a: "</script><script>x" }).includes("</script>"));

  // Filters
  const posts = [{ category: "PRODUCTS" }, { category: "DEALS" }, { category: "CULTURE" }, { category: "NEWSLETTER" }, { category: "culture" }];
  ok("all view", filterPostsByView(posts, "all").length === 5);
  ok("store view", filterPostsByView(posts, "store").length === 2);
  ok("culture view (case)", filterPostsByView(posts, "culture").length === 2);
  ok("newsletter view", filterPostsByView(posts, "newsletter").length === 1);
  ok("hash view", viewFromHash("#culture") === "culture" && viewFromHash("#nope") === "all" && viewFromHash(null) === "all");
  const vc = viewCounts(posts);
  ok("counts", vc.all === 5 && vc.store === 2 && vc.culture === 2 && vc.newsletter === 1);

  // Hero picker
  ok("picked hero uuid", pickedHeroId("0E8B6A3C-1111-2222-3333-444455556666", false) === "0e8b6a3c-1111-2222-3333-444455556666");
  ok("upload wins", pickedHeroId("0e8b6a3c-1111-2222-3333-444455556666", true) === undefined);
  ok("junk id refused", pickedHeroId("x' or 1=1", false) === undefined && pickedHeroId("", false) === undefined);

  ok("safeBlogLink mailto refused", safeBlogLink("mailto:a@b.c") === "");
  return { passed, failed };
}
