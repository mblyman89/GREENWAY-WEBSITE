/**
 * src/lib/vendors/vendor-gemini-research-core.ts -- R49 S7, PURE core.
 *
 * "Research with Google Gemini (step 1)" on the vendor detail page. One
 * grounded Google Search lookup (provider.generateWebSearch -> Gemini
 * google_search grounding) about a VENDOR, turned into a short, reviewable
 * worksheet: website, social profiles, mission, about, product philosophy,
 * plus reference facts (licence, location, founded, what they make).
 *
 * GOOGLE "GROUNDING WITH GOOGLE SEARCH" TERMS (ai.google.dev/gemini-api/terms,
 * re-read 2026-10 for this slice) shape the design:
 *   - Grounded Results are shown ONLY to the staff member who asked, together
 *     with Google's Search Suggestions (rendered verbatim, sandboxed).
 *   - Nothing is cached or stored automatically. The only thing ever saved is
 *     an individual field the staff member was shown, reviewed, optionally
 *     edited, and EXPLICITLY clicked "Save as draft" on (the terms' end-user
 *     copy-and-store exception). Citations, links and Search Suggestions are
 *     never stored.
 *   - Links are NEVER used to choose crawl/scrape targets. The crawler card
 *     (step 2) is prefilled only from the vendor's saved website field, which
 *     a human typed/confirmed. The website Gemini reports is shown for a human
 *     to open and judge; this module offers no "crawl this" hand-off.
 *
 * Standing rules: never guess -- the prompt demands "" for anything not found
 * on a real page, and every value is normalized/length-capped here.
 *
 * NO imports beyond types, NO I/O. Registered in the pure self-test runner.
 */

/** Profile fields a staff member may save as a PENDING draft from this card. */
export const GEMINI_SAVEABLE_FIELDS = ["mission_statement", "about", "product_philosophy", "research_social"] as const;
export type GeminiSaveableField = (typeof GEMINI_SAVEABLE_FIELDS)[number];

/** Provenance written on drafts saved from this card (ai_suggestions.source). */
export const GEMINI_DRAFT_SOURCE = "gemini:staff-saved";

/** Length caps (characters) -- a pathological reply can never balloon a draft. */
export const MAX_SHORT_FIELD = 300;
export const MAX_LONG_FIELD = 2000;
export const MAX_SOCIALS = 8;

/** Platform keys the research_social draft understands (social-draft-core). */
const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "Twitter",
  x: "Twitter",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  linktree: "Linktree",
  pinterest: "Pinterest",
  threads: "Threads",
  snapchat: "Snapchat",
};

/** Hostnames that identify each social platform (for URL-only replies). */
const SOCIAL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)(twitter|x)\.com$/i, "twitter"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube"],
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)linktr\.ee$/i, "linktree"],
  [/(^|\.)pinterest\.com$/i, "pinterest"],
  [/(^|\.)threads\.net$/i, "threads"],
  [/(^|\.)snapchat\.com$/i, "snapchat"],
];

export type VendorSocial = { platform: string; url: string; handle: string };

export type VendorGeminiFindings = {
  found: boolean;
  /** 0..100 overall confidence the model reported (0 when absent/invalid). */
  confidence: number;
  website: string;
  socials: VendorSocial[];
  mission: string;
  about: string;
  philosophy: string;
  licenseNumber: string;
  location: string;
  founded: string;
  productTypes: string[];
  notes: string;
};

export const EMPTY_FINDINGS: VendorGeminiFindings = {
  found: false,
  confidence: 0,
  website: "",
  socials: [],
  mission: "",
  about: "",
  philosophy: "",
  licenseNumber: "",
  location: "",
  founded: "",
  productTypes: [],
  notes: "",
};

/** System prompt: grounded, honest, compliance-aware, strict JSON. */
export const VENDOR_GEMINI_SYSTEM = [
  "You research licensed cannabis producers/processors (vendors) for a Washington State retail cannabis store's internal staff tool.",
  "Use Google Search. Report ONLY facts you found on real web pages about THIS company. If you cannot find something, return an empty string or empty array -- never guess, never invent.",
  "Prefer the company's own website and official social profiles, then the Washington State Liquor and Cannabis Board (LCB) and reputable press.",
  "Write mission/about/philosophy as neutral, factual third-person prose in plain English (2-4 sentences each), based on what the company says about itself.",
  "Never make medical, health, curative or therapeutic claims. Never mention youth appeal, cartoons, or anything aimed at minors. No prices.",
  "Reply with ONE JSON object and nothing else.",
].join(" ");

/** The JSON shape the model must return (appended to the user prompt). */
export const VENDOR_GEMINI_SHAPE = `
Return exactly this JSON shape (all keys required; "" or [] when unknown):
{
  "found": true|false,
  "confidence": 0-100,
  "website": "https://official-site",
  "socials": [{"platform": "instagram|facebook|twitter|tiktok|youtube|linkedin|linktree", "url": "https://...", "handle": "name-without-@"}],
  "mission": "",
  "about": "",
  "philosophy": "",
  "license_number": "",
  "location": "City, WA",
  "founded": "",
  "product_types": ["flower", "pre-rolls"],
  "notes": "anything staff should double-check"
}`;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Collapse whitespace but keep paragraph breaks in long prose. */
function cleanProse(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, max);
}

/** Build the user prompt from what we already know about the vendor. */
export function buildVendorGeminiPrompt(input: {
  displayName: string;
  legalName?: string | null;
  licenseNumber?: string | null;
  city?: string | null;
  hint?: string | null;
}): string {
  const name = clean(input.displayName, 160) || "(unnamed vendor)";
  const lines = [`Research this Washington State cannabis vendor: "${name}".`];
  const legal = clean(input.legalName, 160);
  if (legal && legal.toLowerCase() !== name.toLowerCase()) lines.push(`Legal name: ${legal}.`);
  const lic = clean(input.licenseNumber, 40);
  if (lic) lines.push(`WA LCB licence number on file: ${lic}.`);
  const city = clean(input.city, 80);
  if (city) lines.push(`Location on file: ${city}.`);
  const hint = clean(input.hint, 300);
  if (hint) lines.push(`Staff hint: ${hint}`);
  lines.push("Find their official website, official social profiles, and how they describe their mission, story and product philosophy.");
  return lines.join("\n") + "\n" + VENDOR_GEMINI_SHAPE;
}

/**
 * A public http(s) URL or "" -- rejects javascript:, data:, localhost, raw IPs
 * and hosts without a dot. Returns the URL normalized by the URL parser.
 */
export function safePublicUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 500) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? `https://${s}` : "";
  if (!withScheme) return "";
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost") return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return "";
  if (u.username || u.password) return "";
  return u.toString();
}

/** Platform key for a social URL, or "" when the host is not a known network. */
export function platformForUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    for (const [re, key] of SOCIAL_HOSTS) if (re.test(host)) return key;
  } catch {
    /* not a URL */
  }
  return "";
}

/** Best-effort handle from a profile URL ("" when it can't be read). */
export function handleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    const h = seg.replace(/^@/, "");
    return /^[A-Za-z0-9._-]{1,60}$/.test(h) ? h : "";
  } catch {
    return "";
  }
}

function normalizeSocials(raw: unknown): VendorSocial[] {
  if (!Array.isArray(raw)) return [];
  const out: VendorSocial[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let urlRaw: unknown;
    let platformRaw: unknown;
    let handleRaw: unknown;
    if (typeof item === "string") urlRaw = item;
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      urlRaw = o.url;
      platformRaw = o.platform;
      handleRaw = o.handle;
    } else continue;
    const url = safePublicUrl(urlRaw);
    if (!url) continue;
    // The URL's host is the truth; a model-claimed platform that disagrees
    // with the host is ignored (never save an Instagram label on a random site).
    const fromHost = platformForUrl(url);
    const claimed = typeof platformRaw === "string" ? platformRaw.trim().toLowerCase() : "";
    const platform = fromHost || "";
    if (!platform) continue;
    if (claimed && SOCIAL_LABELS[claimed] && (claimed === "x" ? "twitter" : claimed) !== platform) continue;
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const handleClean = clean(handleRaw, 60).replace(/^@/, "");
    const handle = /^[A-Za-z0-9._-]{1,60}$/.test(handleClean) ? handleClean : handleFromUrl(url);
    out.push({ platform, url, handle });
    if (out.length >= MAX_SOCIALS) break;
  }
  return out;
}

function normalizeConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Normalize a loosely-parsed model reply into safe, capped findings. */
export function normalizeVendorFindings(parsed: unknown): VendorGeminiFindings {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY_FINDINGS, socials: [], productTypes: [] };
  const o = parsed as Record<string, unknown>;
  const website = safePublicUrl(o.website);
  const socials = normalizeSocials(o.socials);
  const productTypes = Array.isArray(o.product_types ?? o.productTypes)
    ? Array.from(
        new Set(
          ((o.product_types ?? o.productTypes) as unknown[])
            .map((t) => clean(t, 40).toLowerCase())
            .filter(Boolean),
        ),
      ).slice(0, 12)
    : [];
  const f: VendorGeminiFindings = {
    found: false,
    confidence: normalizeConfidence(o.confidence),
    // A "website" that is really a social profile is not their website.
    website: website && !platformForUrl(website) ? website : "",
    socials,
    mission: cleanProse(o.mission, MAX_LONG_FIELD),
    about: cleanProse(o.about, MAX_LONG_FIELD),
    philosophy: cleanProse(o.philosophy, MAX_LONG_FIELD),
    licenseNumber: clean(o.license_number ?? o.licenseNumber, 40),
    location: clean(o.location, MAX_SHORT_FIELD),
    founded: clean(o.founded, 40),
    productTypes,
    notes: clean(o.notes, MAX_SHORT_FIELD),
  };
  // "found" is earned, not claimed: true only when something usable came back.
  f.found = hasAnyFinding(f);
  return f;
}

/** True when at least one field carries a value. */
export function hasAnyFinding(f: VendorGeminiFindings): boolean {
  return Boolean(
    f.website ||
      f.socials.length ||
      f.mission ||
      f.about ||
      f.philosophy ||
      f.licenseNumber ||
      f.location ||
      f.founded ||
      f.productTypes.length,
  );
}

/**
 * The research_social draft body, in the exact line format
 * social-draft-core.parseSocialDraft reads:  "[Instagram] @handle — https://url"
 */
export function socialDraftBody(socials: VendorSocial[]): string {
  return socials
    .map((s) => {
      const label = SOCIAL_LABELS[s.platform] ?? s.platform;
      const handle = s.handle ? ` @${s.handle}` : "";
      return `[${label}]${handle} \u2014 ${s.url}`;
    })
    .join("\n");
}

/**
 * Validate one save request coming back from the browser (never trusted).
 * Returns the clean value to persist, or an error message.
 */
export function validateGeminiSave(
  fieldKey: string,
  value: unknown,
): { ok: true; field: GeminiSaveableField; value: string } | { ok: false; error: string } {
  if (!(GEMINI_SAVEABLE_FIELDS as readonly string[]).includes(fieldKey)) {
    return { ok: false, error: "That field can't be saved from Gemini research." };
  }
  const field = fieldKey as GeminiSaveableField;
  if (field === "research_social") {
    // Re-derive from the submitted lines: keep only well-formed profile lines
    // on known networks (the browser payload is re-checked, never trusted).
    const lines = String(value ?? "").split(/\r?\n/);
    const socials: VendorSocial[] = [];
    for (const line of lines) {
      const m = /^\s*\[([A-Za-z]+)\]\s*(?:@(\S+))?\s*[\u2014\u2013-]\s*(https?:\/\/\S+)\s*$/.exec(line);
      if (!m) continue;
      socials.push({ platform: m[1].toLowerCase(), url: m[3], handle: m[2] ?? "" });
    }
    const clean = normalizeSocials(socials);
    if (!clean.length) return { ok: false, error: "No valid social profile links to save." };
    return { ok: true, field, value: socialDraftBody(clean) };
  }
  const text = cleanProse(value, MAX_LONG_FIELD);
  if (text.length < 10) return { ok: false, error: "That text is too short to save as a draft." };
  return { ok: true, field, value: text };
}

/** Plain-English label for each saveable field (UI + audit). */
export const GEMINI_FIELD_LABELS: Record<GeminiSaveableField, string> = {
  mission_statement: "Mission statement",
  about: "About",
  product_philosophy: "Product philosophy",
  research_social: "Social profiles",
};

// ---------------------------------------------------------------------------
// Self-tests (pure runner)
// ---------------------------------------------------------------------------

export function __runVendorGeminiResearchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL vendor-gemini-research-core: ${name}`);
    }
  };

  // prompt
  const p = buildVendorGeminiPrompt({ displayName: "  Acme   Farms ", legalName: "Acme Farms", licenseNumber: "412345", city: "Spokane, WA", hint: "organic" });
  ok(p.includes('"Acme Farms"'), "prompt names vendor (whitespace collapsed)");
  ok(!p.includes("Legal name"), "legal name omitted when same as display");
  ok(p.includes("412345"), "prompt carries licence");
  ok(p.includes("Spokane, WA"), "prompt carries city");
  ok(p.includes("Staff hint: organic"), "prompt carries hint");
  ok(p.includes('"socials"'), "prompt carries shape");
  ok(buildVendorGeminiPrompt({ displayName: "" }).includes("(unnamed vendor)"), "empty name placeholder");
  ok(buildVendorGeminiPrompt({ displayName: "A", legalName: "A LLC" }).includes("Legal name: A LLC"), "distinct legal name included");
  ok(/never guess/i.test(VENDOR_GEMINI_SYSTEM), "system says never guess");
  ok(/medical/i.test(VENDOR_GEMINI_SYSTEM), "system bans medical claims");

  // safePublicUrl
  ok(safePublicUrl("https://acme.com/about") === "https://acme.com/about", "keeps https url");
  ok(safePublicUrl("acme.com") === "https://acme.com/", "adds scheme to bare domain");
  ok(safePublicUrl("javascript:alert(1)") === "", "rejects javascript:");
  ok(safePublicUrl("data:text/html,x") === "", "rejects data:");
  ok(safePublicUrl("http://localhost:3000") === "", "rejects localhost");
  ok(safePublicUrl("http://10.0.0.1/") === "", "rejects raw ip");
  ok(safePublicUrl("https://user:pw@acme.com") === "", "rejects credentials");
  ok(safePublicUrl("ftp://acme.com") === "", "rejects ftp");
  ok(safePublicUrl(42) === "", "rejects non-string");
  ok(safePublicUrl("x".repeat(600)) === "", "rejects overlong");

  // platform + handle
  ok(platformForUrl("https://www.instagram.com/acme") === "instagram", "instagram host");
  ok(platformForUrl("https://x.com/acme") === "twitter", "x.com maps to twitter");
  ok(platformForUrl("https://acme.com") === "", "non-social host");
  ok(platformForUrl("nope") === "", "bad url platform");
  ok(handleFromUrl("https://www.instagram.com/acme_farms/") === "acme_farms", "handle from url");
  ok(handleFromUrl("https://facebook.com/") === "", "no handle on bare host");

  // normalize
  const n = normalizeVendorFindings({
    found: true,
    confidence: 0.82,
    website: "https://acmefarms.com",
    socials: [
      { platform: "instagram", url: "https://instagram.com/acmefarms", handle: "@acmefarms" },
      { platform: "instagram", url: "https://instagram.com/acmefarms/" },
      { platform: "facebook", url: "https://evil.example.com/acme" },
      { platform: "facebook", url: "https://instagram.com/other" },
      "https://www.facebook.com/AcmeFarms",
      { platform: "tiktok", url: "javascript:x" },
    ],
    mission: "  We grow   clean.\n\n\nSun grown.  ",
    about: 5,
    philosophy: "",
    license_number: "412345",
    location: "Spokane, WA",
    founded: "2014",
    product_types: ["Flower", "flower", "Pre-rolls", ""],
    notes: "check licence",
  });
  ok(n.found === true, "found when findings exist");
  ok(n.confidence === 82, "0..1 confidence scaled to %");
  ok(n.website === "https://acmefarms.com/", "website kept");
  ok(n.socials.length === 2, "dedupe + host-truth + unsafe dropped");
  ok(n.socials[0].handle === "acmefarms", "@ stripped from handle");
  ok(n.socials[1].platform === "facebook" && n.socials[1].handle === "AcmeFarms", "url-only social inferred");
  ok(n.mission === "We grow clean.\n\nSun grown.", "prose collapsed, paragraphs kept");
  ok(n.about === "", "non-string about -> empty");
  ok(n.productTypes.join(",") === "flower,pre-rolls", "product types deduped lowercased");
  ok(n.licenseNumber === "412345" && n.location === "Spokane, WA" && n.founded === "2014", "reference facts kept");
  const claimedOnly = normalizeVendorFindings({ found: true, confidence: 95 });
  ok(claimedOnly.found === false, "found is earned, not claimed");
  ok(claimedOnly.confidence === 95, "integer confidence kept");
  ok(normalizeVendorFindings({ confidence: 400 }).confidence === 100, "confidence clamped high");
  ok(normalizeVendorFindings({ confidence: "abc" }).confidence === 0, "bad confidence -> 0");
  ok(normalizeVendorFindings(null).found === false, "null -> empty");
  ok(normalizeVendorFindings([1, 2]).socials.length === 0, "array -> empty");
  ok(normalizeVendorFindings({ website: "https://instagram.com/acme" }).website === "", "social url is not a website");
  ok(normalizeVendorFindings({ mission: "x".repeat(5000) }).mission.length === MAX_LONG_FIELD, "long prose capped");
  const many = normalizeVendorFindings({ socials: Array.from({ length: 20 }, (_, i) => `https://instagram.com/a${i}`) });
  ok(many.socials.length === MAX_SOCIALS, "socials capped");
  ok(EMPTY_FINDINGS.socials.length === 0 && normalizeVendorFindings(null).socials !== EMPTY_FINDINGS.socials, "empty findings not shared by reference");

  // social draft body round-trips through the parseSocialDraft line format
  const body = socialDraftBody(n.socials);
  ok(body === "[Instagram] @acmefarms \u2014 https://instagram.com/acmefarms\n[Facebook] @AcmeFarms \u2014 https://www.facebook.com/AcmeFarms", "draft body format");
  const LINE = /^\[([A-Za-z]+)\]\s*(?:@(\S+))?\s*[\u2014\u2013-]\s*(https?:\/\/\S+)\s*$/;
  ok(body.split("\n").every((l) => LINE.test(l)), "every line matches parseSocialDraft regex");
  ok(socialDraftBody([{ platform: "youtube", url: "https://youtube.com/c/a", handle: "" }]) === "[YouTube] \u2014 https://youtube.com/c/a", "no handle -> no @");

  // validateGeminiSave
  ok(validateGeminiSave("website", "x").ok === false, "unknown field refused");
  ok(validateGeminiSave("about", "short").ok === false, "too-short refused");
  const v = validateGeminiSave("about", "  A family farm   in Spokane. ");
  ok(v.ok && v.value === "A family farm in Spokane.", "about cleaned");
  const vs = validateGeminiSave("research_social", body + "\n[Instagram] @x \u2014 javascript:alert(1)\ngarbage line");
  ok(vs.ok && vs.value === body, "social save re-derived, junk dropped");
  ok(validateGeminiSave("research_social", "[Instagram] @x \u2014 https://evil.com/x").ok === false, "social on wrong host refused");
  ok(validateGeminiSave("mission_statement", "x".repeat(9000)).ok, "long text accepted (capped)");
  const capped = validateGeminiSave("mission_statement", "x".repeat(9000));
  ok(capped.ok && capped.value.length === MAX_LONG_FIELD, "long text capped");
  ok(GEMINI_SAVEABLE_FIELDS.every((f) => GEMINI_FIELD_LABELS[f]), "every saveable field labelled");
  ok(GEMINI_DRAFT_SOURCE.startsWith("gemini"), "draft source names gemini");

  return { passed, failed };
}
