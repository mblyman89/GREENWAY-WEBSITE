/**
 * src/lib/enrichment/research-core.ts — SLICE 74 (deep product web research).
 *
 * PURE helpers for the "Research this product on the web" flow on the
 * enrichment detail page. Owner: "I want to add a specific product lookup
 * from the internet using gpt or crawl4ai in the product detail page of the
 * enrichment process… deep researching the web intelligently."
 *
 * How the honest pipeline works (nothing here does I/O):
 *   1. The owner finds the product's OWN page on the maker's site (we build a
 *      pre-filled web-search link to help) and pastes the URL.
 *   2. A server action sends that ONE page to the Python crawl4ai worker
 *      (`/research`, entity_type "product") which fetches it politely, has
 *      GPT extract a description VERIFIED against the real page text, runs
 *      the compliance scan, and writes a DRAFT into ai_suggestions.
 *   3. Image URLs the page showed come back as candidates; we persist them as
 *      ONE reviewable research_images draft. NOTHING is auto-applied — every
 *      finding waits in the AI panel for the owner's Accept / Import / Dismiss.
 *
 * These helpers cover the pure edges of that flow: validating the pasted URL,
 * building the search link, packing/unpacking the image-candidates draft, and
 * writing the plain-English outcome message.
 */

// ---------------------------------------------------------------------------
// URL validation — only public http(s) pages may be researched.
// ---------------------------------------------------------------------------

export type ResearchUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Validate a pasted research URL. Accepts only absolute http(s) URLs;
 * trims whitespace; returns the normalized string form.
 */
export function validateResearchUrl(raw: string | null | undefined): ResearchUrlCheck {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "Paste the product page's URL first." };
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, reason: "That doesn't look like a full URL — include the https:// part." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only regular web pages (http/https) can be researched." };
  }
  if (!parsed.hostname.includes(".")) {
    return { ok: false, reason: "That URL is missing a real website address." };
  }
  return { ok: true, url: parsed.toString() };
}

// ---------------------------------------------------------------------------
// Search link — helps the owner FIND the product's own page.
// ---------------------------------------------------------------------------

/**
 * Pre-filled Google search for this product (brand + name). Opens the familiar
 * Google results page in a new tab — the owner asked for Google here (the old
 * DuckDuckGo tab looked unfamiliar). No account or API key needed; it's just a
 * plain search URL the operator clicks to find the maker's own product page.
 */
export function buildWebSearchUrl(name: string, brand?: string | null): string {
  const q = [brand ?? "", name].map((s) => s.trim()).filter(Boolean).join(" ").trim();
  return "https://www.google.com/search?q=" + encodeURIComponent(q || "cannabis product");
}

// ---------------------------------------------------------------------------
// Image-candidates draft — pack for storage, unpack for display.
// ---------------------------------------------------------------------------

/** Max image URLs kept on one research draft (mirrors the crawler's cap spirit). */
export const MAX_RESEARCH_IMAGE_LINES = 20;

/**
 * Pack crawler image candidates into ONE draft body: one absolute http(s)
 * URL per line, deduped, order preserved, capped. Returns "" when nothing
 * useful survives (caller then skips writing a draft).
 */
export function packImageCandidates(urls: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const check = validateResearchUrl(raw);
    if (!check.ok) continue;
    if (check.url.toLowerCase().endsWith(".svg")) continue; // logos/icons, not product shots
    if (seen.has(check.url)) continue;
    seen.add(check.url);
    out.push(check.url);
    if (out.length >= MAX_RESEARCH_IMAGE_LINES) break;
  }
  return out.join("\n");
}

/** Unpack a research_images draft body back into displayable image URLs. */
export function parseImageDraftLines(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const check = validateResearchUrl(line);
    if (check.ok) out.push(check.url);
  }
  return out;
}

/** The reference field key for the image-candidates draft (never "accepted" —
 *  each URL is imported individually or the draft is dismissed). */
export const RESEARCH_IMAGES_FIELD = "research_images";

// ---------------------------------------------------------------------------
// Outcome message — plain English for the owner.
// ---------------------------------------------------------------------------

export type ResearchOutcomeInput = {
  draftsWritten: number;
  imageCandidates: number;
  /** Crawler-reported error string ("" = none). */
  error?: string | null;
};

/** One honest sentence describing what the research run produced. */
export function researchOutcomeMessage(o: ResearchOutcomeInput): string {
  const err = (o.error ?? "").trim();
  if (err) return `Research failed: ${err}`;
  const parts: string[] = [];
  if (o.draftsWritten > 0) {
    parts.push(`${o.draftsWritten} draft${o.draftsWritten === 1 ? "" : "s"} written`);
  }
  if (o.imageCandidates > 0) {
    parts.push(`${o.imageCandidates} image candidate${o.imageCandidates === 1 ? "" : "s"} found`);
  }
  if (parts.length === 0) {
    return "Research finished but that page had nothing usable — try the product's own page on the maker's site.";
  }
  return `Research finished — ${parts.join(" and ")}. Review below; nothing is applied until you approve it.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runProductResearchCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`FAIL research-core: ${label}`);
    }
  };

  // URL validation.
  ok(validateResearchUrl("https://example.com/products/gg4").ok, "accepts a normal https product URL");
  ok(validateResearchUrl("  https://example.com/x  ").ok, "trims whitespace");
  ok(!validateResearchUrl("").ok, "rejects empty");
  ok(!validateResearchUrl("example.com/no-scheme").ok, "rejects missing scheme");
  ok(!validateResearchUrl("ftp://example.com/file").ok, "rejects non-http(s) schemes");
  ok(!validateResearchUrl("https://localhost/x").ok, "rejects dotless hosts (localhost)");
  const norm = validateResearchUrl("HTTPS://Example.com/Path");
  ok(norm.ok && norm.url === "https://example.com/Path", "normalizes scheme/host case, keeps path case");

  // Search link (Google).
  ok(
    buildWebSearchUrl("Grape Gas 3.5g", "Phat Panda") ===
      "https://www.google.com/search?q=Phat%20Panda%20Grape%20Gas%203.5g",
    "search link: brand + name, URL-encoded",
  );
  ok(
    buildWebSearchUrl("Blue Dream", null) === "https://www.google.com/search?q=Blue%20Dream",
    "search link: no brand → name only",
  );
  ok(
    buildWebSearchUrl("   ", "") === "https://www.google.com/search?q=cannabis%20product",
    "search link: blank inputs never build an empty query",
  );

  // Pack candidates.
  const packed = packImageCandidates([
    "https://cdn.example.com/a.jpg",
    "not a url",
    "https://cdn.example.com/a.jpg", // dupe
    "https://cdn.example.com/logo.svg", // svg dropped
    "http://cdn.example.com/b.png",
  ]);
  ok(
    packed === "https://cdn.example.com/a.jpg\nhttp://cdn.example.com/b.png",
    "pack: dedupes, drops junk + svg, preserves order",
  );
  ok(packImageCandidates([]) === "", "pack: empty input → empty string (no draft)");
  const many = packImageCandidates(
    Array.from({ length: 30 }, (_, i) => `https://cdn.example.com/img-${i}.jpg`),
  );
  ok(many.split("\n").length === MAX_RESEARCH_IMAGE_LINES, "pack: capped at MAX_RESEARCH_IMAGE_LINES");

  // Parse draft lines (round trip).
  ok(
    JSON.stringify(parseImageDraftLines(packed)) ===
      JSON.stringify(["https://cdn.example.com/a.jpg", "http://cdn.example.com/b.png"]),
    "parse: round-trips the packed draft",
  );
  ok(parseImageDraftLines("junk\n\n").length === 0, "parse: junk lines dropped");
  ok(parseImageDraftLines(null).length === 0, "parse: null-safe");

  // Outcome messages.
  ok(
    researchOutcomeMessage({ draftsWritten: 2, imageCandidates: 5 }) ===
      "Research finished — 2 drafts written and 5 image candidates found. Review below; nothing is applied until you approve it.",
    "outcome: drafts + images, plural",
  );
  ok(
    researchOutcomeMessage({ draftsWritten: 1, imageCandidates: 0 }).includes("1 draft written"),
    "outcome: singular draft",
  );
  ok(
    researchOutcomeMessage({ draftsWritten: 0, imageCandidates: 0 }).includes("nothing usable"),
    "outcome: honest empty-handed message",
  );
  ok(
    researchOutcomeMessage({ draftsWritten: 3, imageCandidates: 0, error: "HTTP 403" }) ===
      "Research failed: HTTP 403",
    "outcome: error wins over counts",
  );

  if (fail > 0) throw new Error(`research-core: ${fail} failure(s)`);
  console.log(`research-core: ${pass} checks passed`);
}
