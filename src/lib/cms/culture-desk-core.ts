/**
 * src/lib/cms/culture-desk-core.ts — D237 N-6 (SOP-22 G-116; F-22-13, F-22-14 S1).
 *
 * The culture news desk, pure part, and the HEALTH-TOPIC GUARD.
 *
 * Owner rules (D237, Appendix C (a)):
 *  - Q-22-1 (a): "Cited news and research reporting only, no product links,
 *    the 'talk to your provider' line, no claims (N-6 guard)."
 *  - Q-22-6 (a): "Yes, on demand only (a person presses 'Find news')."
 *  - Q-22-7: culture posts go on the existing CULTURE card on /blog.
 *
 * WAC 314-55-155(2)(a)(vii): no advertising may represent "that the use of
 * cannabis has curative or therapeutic effects". The guard therefore:
 *   1. blocks therapeutic wording outright (any health topic or not);
 *   2. if the text touches health, it needs a cited source link;
 *   3. a health post carries the "talk to your healthcare provider" line;
 *   4. a health post may not link to products, the menu or deals.
 * Every culture draft also carries its source links.
 *
 * Pure: no server imports.
 */

export const PROVIDER_LINE =
  "This post reports news and research; it is not medical advice. Talk to your healthcare provider about any health question.";

export const NEWS_SUMMARY_MAX = 600;
export const NEWS_TITLE_MAX = 200;
export const FIND_NEWS_MAX = 8;
export const TOPIC_MAX = 160;

export type NewsKind = "wslcb" | "web" | "vendor";

export type NewsItem = {
  id: string;
  kind: NewsKind;
  title: string;
  url: string;
  date: string | null;
  summary: string;
  /** Where it came from, in words (outlet or "WSLCB"). */
  outlet: string;
};

const HEALTH_RE =
  /\b(health|healthy|medical|medicinal|medicine|patients?|clinical|clinic|doctors?|physicians?|study|studies|research(?:ers)?|trial|symptoms?|pain|anxiety|depress(?:ion|ed)|insomnia|sleep|epilep(?:sy|tic)|seizures?|cancer|chemo(?:therapy)?|nausea|ptsd|arthritis|inflammation|glaucoma|multiple sclerosis|migraines?|opioids?|addiction|wellness|disease|disorder|condition|diagnos(?:is|ed))\b/i;

/** Therapeutic wording — blocked outright (WAC 314-55-155(2)(a)(vii)). */
const THERAPEUTIC_RE =
  /\b(cures?|cured|curing|curative|treats?|treated|treating|treatment for|heals?|healing|relieves?|relief (?:from|of)|remed(?:y|ies)|therapeutic|therapy for|prevents?|alleviates?|eases?|soothes?|reduces? (?:pain|anxiety|stress|inflammation|nausea|seizures?)|helps? (?:with|you) (?:pain|anxiety|sleep|stress|nausea|seizures?|depression|insomnia)|good for your (?:health|body|mind)|medical benefits?|health benefits?|benefits? for (?:pain|anxiety|sleep|health))\b/gi;

export const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function linksIn(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
}

/** Links that sell: our menu, products, deals, cart, or a shop link. */
const PRODUCT_PATH_RE = /\/(menu|shop|products?|deals?|specials?|cart|checkout|order|brands?\/[^/]+\/products?)(\/|\?|#|$)/i;

export function isProductOrDealLink(url: string, siteHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const ours = host.includes("greenway") || siteHosts.map((h) => h.toLowerCase().replace(/^www\./, "")).includes(host);
  if (ours && PRODUCT_PATH_RE.test(u.pathname)) return true;
  // Relative-style deal words on any host's path, e.g. a dispensary shop page.
  return /\/(shop|cart|checkout)(\/|$)/i.test(u.pathname);
}

export function touchesHealth(text: string): boolean {
  return HEALTH_RE.test(text);
}

export function therapeuticWords(text: string): string[] {
  return [...new Set((text.match(THERAPEUTIC_RE) ?? []).map((m) => m.toLowerCase()))];
}

/** Same-site relative links like "/menu" or "/deals" also count as selling. */
function relativeSellingLinks(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[\s(])(\/(?:menu|shop|products?|deals?|specials?|cart|checkout)(?:\/[^\s)]*)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1]!);
  return [...out];
}

export type GuardIssue = { level: "must-fix" | "heads-up"; text: string };

export type GuardResult = {
  health: boolean;
  issues: GuardIssue[];
  /** Must-fix only, as plain lines. */
  blocking: string[];
  sources: string[];
  hasProviderLine: boolean;
};

/**
 * The health-topic guard. `text` is everything that would be published
 * (title, excerpt, body). `requireSource` is true for culture posts (every
 * culture draft carries its links).
 */
export function guardCultureText(text: string, opts: { requireSource?: boolean; siteHosts?: readonly string[] } = {}): GuardResult {
  const issues: GuardIssue[] = [];
  const health = touchesHealth(text);
  const links = linksIn(text);
  const selling = [...links.filter((u) => isProductOrDealLink(u, opts.siteHosts ?? [])), ...relativeSellingLinks(text)];
  const sources = links.filter((u) => !isProductOrDealLink(u, opts.siteHosts ?? []));
  const hasProviderLine = /talk to your (?:healthcare|health care) provider/i.test(text);

  const thera = therapeuticWords(text);
  if (thera.length) {
    issues.push({ level: "must-fix", text: `Therapeutic wording is not allowed (WAC 314-55-155(2)(a)(vii)): ${thera.join(", ")}. Report what a source said, attributed, never as a benefit.` });
  }
  if ((opts.requireSource || health) && sources.length === 0) {
    issues.push({
      level: "must-fix",
      text: health
        ? "This touches health, so it needs a cited source link (Q-22-1). Add the link to the study or news."
        : "A culture post carries its source link. Add the link to the news.",
    });
  }
  if (health && selling.length) {
    issues.push({ level: "must-fix", text: `A health post may not link to products, the menu or deals (Q-22-1): ${selling.join(", ")}.` });
  }
  if (health && !hasProviderLine) {
    issues.push({ level: "must-fix", text: `A health post needs the line: "${PROVIDER_LINE}"` });
  }
  return { health, issues, blocking: issues.filter((i) => i.level === "must-fix").map((i) => i.text), sources, hasProviderLine };
}

/** Add the provider line (once) and the sources list (when missing) to the body paragraphs. */
export function withGuardLines(body: string[], sources: string[], health: boolean): string[] {
  const out = body.map((p) => p.trim()).filter(Boolean);
  const joined = out.join("\n");
  const missing = sources.filter((s) => !joined.includes(s));
  if (missing.length) out.push(`Source${missing.length === 1 ? "" : "s"}: ${missing.join(" · ")}`);
  if (health && !/talk to your (?:healthcare|health care) provider/i.test(joined)) out.push(PROVIDER_LINE);
  return out;
}

// ── news items ───────────────────────────────────────────────────────────

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type RegulatoryRow = {
  id: string;
  title: string;
  url: string | null;
  published_at: string | null;
  body_text: string | null;
  status: string;
  summary?: string | null;
};

export function regulatoryToNews(rows: RegulatoryRow[]): NewsItem[] {
  const out: NewsItem[] = [];
  for (const r of rows) {
    if (r.status === "archived" || !r.url || !isHttpUrl(r.url)) continue;
    out.push({
      id: `wslcb:${r.id}`,
      kind: "wslcb",
      title: clean(r.title, NEWS_TITLE_MAX),
      url: r.url,
      date: r.published_at ? r.published_at.slice(0, 10) : null,
      summary: clean(r.summary || r.body_text || "", NEWS_SUMMARY_MAX),
      outlet: "WSLCB",
    });
  }
  return out;
}

export function buildFindNewsPrompt(kind: "web" | "vendor", topic: string): string {
  const t = clean(topic, TOPIC_MAX);
  const what =
    kind === "vendor"
      ? `recent public news about the Washington cannabis producer or brand "${t}": awards, new products or genetics, press features. Use the brand's own announcements, award organizers or news outlets.`
      : `recent federal, national or Washington State cannabis news${t ? ` about: ${t}` : ""} (law, policy, rescheduling, research reporting, industry). Prefer official sources (DEA, HHS, Congress.gov, WA Legislature, WSLCB) and reputable outlets.`;
  return [
    `Find ${what}`,
    `Return JSON {"items": [{"title": "...", "url": "https://... (the exact page you used)", "date": "YYYY-MM-DD or empty", "outlet": "publisher name", "summary": "2-3 factual sentences, attributed (\\"X reported that...\\")"}]} with at most ${FIND_NEWS_MAX} items, newest first.`,
    "Only include items you actually found and can link to. Never invent a story, a date or a link.",
    "Report research as what the researchers or the article said; never say cannabis treats, cures or helps any condition.",
  ].join("\n");
}

/** Keep only items whose link is a real source the search returned (cited news only). */
export function parseFoundNews(raw: unknown, sources: string[], kind: "web" | "vendor"): NewsItem[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? (raw as unknown[]) : [];
  const norm = (u: string) => u.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
  const cited = new Set(sources.map(norm));
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const url = clean(o.url, 500);
    const title = clean(o.title, NEWS_TITLE_MAX);
    if (!title || !isHttpUrl(url)) continue;
    if (cited.size > 0 && !cited.has(norm(url))) continue;
    if (cited.size === 0) continue; // no live search ran: nothing is "cited"
    if (seen.has(norm(url))) continue;
    seen.add(norm(url));
    const date = clean(o.date, 10);
    out.push({
      id: `${kind}:${out.length}`,
      kind,
      title,
      url,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      summary: clean(o.summary, NEWS_SUMMARY_MAX),
      outlet: clean(o.outlet, 80) || new URL(url).hostname.replace(/^www\./, ""),
    });
    if (out.length >= FIND_NEWS_MAX) break;
  }
  return out;
}

/** Validate a news item sent back by the browser for drafting (web items are never stored). */
export function cleanNewsItem(raw: unknown): NewsItem | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = o.kind === "wslcb" || o.kind === "vendor" ? o.kind : o.kind === "web" ? "web" : null;
  const url = clean(o.url, 500);
  const title = clean(o.title, NEWS_TITLE_MAX);
  if (!kind || !title || !isHttpUrl(url)) return null;
  const date = clean(o.date, 10);
  return {
    id: clean(o.id, 80) || `${kind}:x`,
    kind,
    title,
    url,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    summary: clean(o.summary, NEWS_SUMMARY_MAX),
    outlet: clean(o.outlet, 80),
  };
}

/** The facts for the culture draft (fed to the N-5 culture template prompt). */
export function newsFacts(item: NewsItem, notes: string): string[] {
  const out = [
    `News: ${item.title}${item.outlet ? ` (${item.outlet}${item.date ? `, ${item.date}` : ""})` : ""}.`,
    `Source link (cite it): ${item.url}`,
  ];
  if (item.summary) out.push(`What the source says: ${item.summary}`);
  const n = clean(notes, 1500);
  if (n) out.push(`Notes from staff: ${n}`);
  return out;
}

export const CULTURE_EXTRA_RULES = [
  "This is a CULTURE post for the blog: report the news, attributed to the source, and say what it means for adult customers in Washington.",
  "Include the source link from the facts in the body.",
  "If it touches health or research: report only what the source said, attributed; never say cannabis treats, cures, relieves or helps any condition; do not link to products, the menu or deals; end with: \"" + PROVIDER_LINE + "\"",
  "Do not mention products, prices or deals.",
].join("\n");

// ── self-test ────────────────────────────────────────────────────────────

export function __runCultureDeskCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL culture-desk-core: ${name}`);
    }
  };

  ok("health: study", touchesHealth("A new study looked at cannabis use"));
  ok("health: patients", touchesHealth("Medical patients in Washington"));
  ok("health: not for law news", !touchesHealth("Congress passed a banking bill for cannabis businesses."));
  ok("health: word boundary", !touchesHealth("We painted the store."));

  ok("therapeutic: treats", therapeuticWords("It treats pain").includes("treats"));
  ok("therapeutic: relieves", therapeuticWords("relieves stress").length === 1);
  ok("therapeutic: helps with sleep", therapeuticWords("it helps with sleep").length === 1);
  ok("therapeutic: medical benefits", therapeuticWords("the medical benefits of THC").length === 1);
  ok("therapeutic: reduces anxiety", therapeuticWords("reduces anxiety").length === 1);
  ok("therapeutic: clean report", therapeuticWords("Researchers at UW published a survey of adult use.").length === 0);

  ok("product link: our menu", isProductOrDealLink("https://greenwaymarijuana.com/menu/flower"));
  ok("product link: our deals", isProductOrDealLink("https://www.greenwaymarijuana.com/deals"));
  ok("product link: blog is fine", !isProductOrDealLink("https://greenwaymarijuana.com/blog/x"));
  ok("product link: news is fine", !isProductOrDealLink("https://www.dea.gov/press-releases/2026/x"));
  ok("product link: extra host", isProductOrDealLink("https://shop.example.com/products/1", ["shop.example.com"]));
  ok("product link: any cart", isProductOrDealLink("https://x.example/cart"));
  ok("product link: bad url", !isProductOrDealLink("not a url"));

  const law = guardCultureText("WSLCB changed a rule. https://lcb.wa.gov/x", { requireSource: true });
  ok("law news with source passes", !law.health && law.blocking.length === 0 && law.sources[0] === "https://lcb.wa.gov/x");
  const lawNo = guardCultureText("WSLCB changed a rule.", { requireSource: true });
  ok("culture without source must-fix", lawNo.blocking.length === 1 && lawNo.blocking[0]!.includes("source link"));
  ok("non-culture law text without source ok", guardCultureText("WSLCB changed a rule.").blocking.length === 0);

  const h1 = guardCultureText("A study of patients was published.");
  ok("health without source must-fix", h1.health && h1.blocking.some((b) => b.includes("cited source")));
  ok("health without provider line must-fix", h1.blocking.some((b) => b.includes("healthcare provider")));
  const h2 = guardCultureText(`A study of patients was published. https://nih.gov/s ${PROVIDER_LINE}`);
  ok("health with source + line passes", h2.health && h2.blocking.length === 0 && h2.hasProviderLine);
  const h3 = guardCultureText(`A study. https://nih.gov/s See https://greenwaymarijuana.com/menu ${PROVIDER_LINE}`);
  ok("health with menu link must-fix", h3.blocking.some((b) => b.includes("may not link")));
  ok("menu link is not a source", h3.sources.join() === "https://nih.gov/s");
  const h4 = guardCultureText(`A study. https://nih.gov/s Shop our picks at /deals today. ${PROVIDER_LINE}`);
  ok("health with relative deals link must-fix", h4.blocking.some((b) => b.includes("/deals")));
  const h5 = guardCultureText(`A study says it cures pain. https://nih.gov/s ${PROVIDER_LINE}`);
  ok("therapeutic blocked even with source", h5.blocking.some((b) => b.includes("Therapeutic")));
  ok("therapeutic blocked off-health too", guardCultureText("This strain heals. https://x.example/a").blocking.length === 1);

  const body = withGuardLines(["Para one.", " "], ["https://nih.gov/s"], true);
  ok("guard lines: source added", body.includes("Source: https://nih.gov/s"));
  ok("guard lines: provider line added", body[body.length - 1] === PROVIDER_LINE);
  const body2 = withGuardLines(["See https://nih.gov/s.", PROVIDER_LINE], ["https://nih.gov/s"], true);
  ok("guard lines: nothing doubled", body2.length === 2);
  ok("guard lines: no provider line off-health", !withGuardLines(["x"], [], false).includes(PROVIDER_LINE));
  ok("guarded body passes the guard", guardCultureText(["A study of patients.", ...withGuardLines(["A study of patients."], ["https://nih.gov/s"], true)].join("\n"), { requireSource: true }).blocking.length === 0);

  const reg = regulatoryToNews([
    { id: "1", title: "Bulletin  A", url: "https://lcb.wa.gov/a", published_at: "2026-11-10T00:00:00Z", body_text: "Body", status: "new" },
    { id: "2", title: "No url", url: null, published_at: null, body_text: null, status: "new" },
    { id: "3", title: "Archived", url: "https://lcb.wa.gov/c", published_at: null, body_text: null, status: "archived" },
    { id: "4", title: "Bad", url: "javascript:alert(1)", published_at: null, body_text: null, status: "new" },
  ]);
  ok("wslcb: only linked, live items", reg.length === 1 && reg[0]!.id === "wslcb:1" && reg[0]!.title === "Bulletin A");
  ok("wslcb: date + outlet", reg[0]!.date === "2026-11-10" && reg[0]!.outlet === "WSLCB");

  ok("prompt: vendor names the brand", buildFindNewsPrompt("vendor", "Cedar Farms").includes('"Cedar Farms"'));
  ok("prompt: never invent", buildFindNewsPrompt("web", "").includes("Never invent"));

  const found = parseFoundNews(
    {
      items: [
        { title: "DEA update", url: "https://www.dea.gov/x/", date: "2026-11-09", outlet: "DEA", summary: "The DEA said..." },
        { title: "Made up", url: "https://fake.example/y", summary: "z" },
        { title: "Dup", url: "https://www.dea.gov/x", summary: "" },
        { title: "", url: "https://www.dea.gov/z" },
        { title: "Bad url", url: "ftp://x" },
      ],
    },
    ["https://www.dea.gov/x"],
    "web",
  );
  ok("found: only cited links kept", found.length === 1 && found[0]!.title === "DEA update");
  ok("found: no live search, nothing kept", parseFoundNews({ items: [{ title: "A", url: "https://a.example" }] }, [], "web").length === 0);
  ok("found: garbage safe", parseFoundNews("x", ["https://a.example"], "web").length === 0);

  ok("cleanNewsItem: rejects bad url", cleanNewsItem({ kind: "web", title: "T", url: "javascript:x" }) === null);
  ok("cleanNewsItem: rejects bad kind", cleanNewsItem({ kind: "nope", title: "T", url: "https://a.example" }) === null);
  const ci = cleanNewsItem({ kind: "web", title: " T ", url: "https://a.example/n", date: "bad", outlet: "A" });
  ok("cleanNewsItem: ok", !!ci && ci.title === "T" && ci.date === null);
  ok("news facts cite the link", !!ci && newsFacts(ci, "").some((f) => f === "Source link (cite it): https://a.example/n"));

  return { passed, failed };
}
