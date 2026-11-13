/**
 * src/lib/cms/post-templates-core.ts — D237 N-5 (SOP-22 G-115; F-22-10, F-22-16).
 *
 * The grounded AI content engine, pure part. "New post from…" offers seven
 * templates. Each template turns the "This week at Greenway" feed (N-4) into
 * items, and each item carries ONLY the fact lines the AI may use.
 *
 * Owner rules (D237, Appendix C (a)):
 *  - Q-22-8 (a): prices and dates only in Sale / Vendor-day posts, copied from
 *    the promotion, and a deal the below-cost check flags is never offered.
 *  - Q-22-9 (a): vendor claims only with a source link; no AI superlatives.
 *  - Q-22-2 (a): reviews are curated: staff paste the review they picked.
 *  - Q-22-1 (a): culture is cited news only (a source link is required; the
 *    news desk and the health guard come in N-6).
 *
 * Pure: no server imports. The server adds checkCompliance() flags.
 */
import type { ThisWeekFeed } from "./this-week-feed-core";

export type PostTemplateKey =
  | "new-vendor"
  | "fresh-drops"
  | "review-spotlight"
  | "sale"
  | "vendor-day"
  | "holiday"
  | "culture";

export type PostTemplate = {
  key: PostTemplateKey;
  label: string;
  blurb: string;
  category: "PRODUCTS" | "DEALS" | "CULTURE";
  /** Q-22-8: only these may state an offer (price, percent). */
  allowsPrice: boolean;
  /** Dates allowed: sale and vendor day (Q-22-8), and the holiday's own date. */
  allowsDates: boolean;
  /** Staff must type notes (the curated review, the cited news). */
  needsNotes: boolean;
};

export const POST_TEMPLATES: readonly PostTemplate[] = [
  { key: "new-vendor", label: "New vendor", blurb: "Welcome a vendor added this week.", category: "PRODUCTS", allowsPrice: false, allowsDates: false, needsNotes: false },
  { key: "fresh-drops", label: "Fresh drops", blurb: "What came in this week, by vendor and type.", category: "PRODUCTS", allowsPrice: false, allowsDates: false, needsNotes: false },
  { key: "review-spotlight", label: "Review spotlight", blurb: "A customer review you picked (paste it in the notes).", category: "PRODUCTS", allowsPrice: false, allowsDates: false, needsNotes: true },
  { key: "sale", label: "Sale", blurb: "A published deal, with the offer and dates copied from the promotion.", category: "DEALS", allowsPrice: true, allowsDates: true, needsNotes: false },
  { key: "vendor-day", label: "Vendor day", blurb: "A vendor day or clearance from Promotions.", category: "DEALS", allowsPrice: true, allowsDates: true, needsNotes: false },
  { key: "holiday", label: "Holiday", blurb: "A holiday, 4/20, 7/10 or a local event coming up.", category: "CULTURE", allowsPrice: false, allowsDates: true, needsNotes: false },
  { key: "culture", label: "Culture", blurb: "Cited cannabis news for the CULTURE card (paste the source link in the notes).", category: "CULTURE", allowsPrice: false, allowsDates: false, needsNotes: true },
];

export function getTemplate(key: string): PostTemplate | null {
  return POST_TEMPLATES.find((t) => t.key === key) ?? null;
}

export const NOTES_MAX = 1500;
export const HEADLINE_COUNT = 5;
export const HEADLINE_MAX = 110;
export const EXCERPT_MAX = 220;
export const SECTIONS_MAX = 5;
export const PICTURE_COUNT = 3;

export type TemplateItem = {
  id: string;
  label: string;
  /** The only facts the AI may use. */
  facts: string[];
  /** Vendor cards to look in for pictures. */
  vendorIds: string[];
  /** Words used to rank pictures from Digital Assets. */
  searchWords: string[];
};

export type TemplateItems = {
  items: TemplateItem[];
  /** Items left out on purpose, with the reason (shown, never sent to the AI). */
  held: { label: string; reason: string }[];
};

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
}

const NOTES_ITEM_ID = "notes";

/** The items one template offers for this week's feed. */
export function templateItems(key: PostTemplateKey, feed: ThisWeekFeed): TemplateItems {
  const week = `Week: ${feed.fromDay} to ${feed.toDay} (Pacific).`;
  const out: TemplateItems = { items: [], held: [] };
  const dropFor = (vendorId: string) => feed.freshDrops.find((g) => g.vendorId === vendorId) ?? null;
  const typeText = (g: { types: { type: string; lots: number }[] }) =>
    g.types.map((t) => `${t.type} (${t.lots} lot${t.lots === 1 ? "" : "s"})`).join(", ");

  switch (key) {
    case "new-vendor":
      for (const v of feed.newVendors) {
        const g = dropFor(v.id);
        out.items.push({
          id: `vendor:${v.id}`,
          label: v.name,
          facts: [`New vendor at Greenway: ${v.name} (added ${v.addedOn}).`, ...(g ? [`First products from ${v.name} this week: ${typeText(g)}.`] : [])],
          vendorIds: [v.id],
          searchWords: words(v.name),
        });
      }
      break;
    case "fresh-drops":
      if (feed.freshDrops.length > 0) {
        out.items.push({
          id: "drops:all",
          label: `All fresh drops this week (${feed.freshLotCount} lots)`,
          facts: [week, ...feed.freshDrops.slice(0, 12).map((g) => `Fresh drop: ${g.vendorName}: ${typeText(g)}.`)],
          vendorIds: feed.freshDrops.map((g) => g.vendorId).filter((x): x is string => !!x).slice(0, 12),
          searchWords: feed.freshDrops.slice(0, 6).flatMap((g) => words(g.vendorName)),
        });
      }
      for (const g of feed.freshDrops.slice(0, 20)) {
        if (!g.vendorId) continue;
        out.items.push({
          id: `drops:${g.vendorId}`,
          label: `${g.vendorName} (${g.lots} lot${g.lots === 1 ? "" : "s"})`,
          facts: [week, `Fresh drop: ${g.vendorName}: ${typeText(g)}.`],
          vendorIds: [g.vendorId],
          searchWords: words(g.vendorName),
        });
      }
      break;
    case "sale":
    case "vendor-day": {
      const seen = new Set<string>();
      const pool = key === "vendor-day" ? feed.vendorDays : [...feed.runningNow, ...feed.comingUp].filter((d) => !d.markdown);
      for (const d of pool) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        if (d.belowCost > 0) {
          out.held.push({ label: d.title, reason: `The below-cost check flagged ${d.belowCost} item${d.belowCost === 1 ? "" : "s"}; fix the promotion first (Q-22-8).` });
          continue;
        }
        out.items.push({
          id: `deal:${d.id}`,
          label: `${d.title} (${d.when})`,
          facts: [
            `${key === "vendor-day" ? "Vendor day" : "Deal"}: ${d.title}.`,
            `Offer, exactly as set in Promotions: ${d.offer}.`,
            `When, exactly as set in Promotions: ${d.when}.`,
            ...(d.bonusNote ? [`Note from the promotion: ${d.bonusNote}.`] : []),
          ],
          vendorIds: [],
          searchWords: words(d.title),
        });
      }
      break;
    }
    case "holiday":
      for (const c of feed.calendar) {
        out.items.push({
          id: `date:${c.date}:${c.name}`.slice(0, 120),
          label: `${c.name} (${c.date})`,
          facts: [`Date ahead: ${c.name} on ${c.date}.`],
          vendorIds: [],
          searchWords: words(c.name),
        });
      }
      break;
    case "review-spotlight":
    case "culture":
      out.items.push({
        id: NOTES_ITEM_ID,
        label: key === "culture" ? "The news in your notes" : "The review in your notes",
        facts: [],
        vendorIds: [],
        searchWords: [],
      });
      break;
  }
  return out;
}

export const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

export function linksIn(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
}

/**
 * Add the staff notes to an item. Returns an error in plain words when the
 * template needs notes (or a source link) and they are missing.
 */
export function withNotes(t: PostTemplate, item: TemplateItem, notesRaw: string): { item: TemplateItem } | { error: string } {
  const notes = (notesRaw ?? "").trim().slice(0, NOTES_MAX);
  if (t.needsNotes && notes.length < 20) {
    return { error: t.key === "culture" ? "Paste the news you want to write about and its source link in the notes." : "Paste the customer review you picked in the notes." };
  }
  if (t.key === "culture" && linksIn(notes).length === 0) {
    return { error: "A culture post needs a source link (Q-22-1). Paste the link to the news in the notes." };
  }
  if (!notes) return { item };
  const facts = [...item.facts];
  if (t.key === "review-spotlight") facts.push(`Customer review picked by staff (quote only these words): "${notes}"`);
  else if (t.key === "culture") facts.push(`News notes from staff, with sources: ${notes}`);
  else facts.push(`Extra notes from staff: ${notes}`);
  return { item: { ...item, facts, searchWords: [...item.searchWords, ...words(notes)].slice(0, 30) } };
}

// ── prompt ───────────────────────────────────────────────────────────────

export function buildDraftPrompt(t: PostTemplate, item: TemplateItem): string {
  const rules = [
    "Write a blog post draft for Greenway Marijuana, a licensed Washington I-502 cannabis retailer in Port Orchard (Kitsap County), for adults 21 and over.",
    `Post type: ${t.label}. ${t.blurb}`,
    "Use ONLY the facts listed below. Do not add products, strains, effects, awards, lab results, history or anything else that is not in the facts.",
    t.allowsPrice
      ? "You may state the offer and the dates ONLY exactly as written in the facts. Never change, round or add a price, percent or date."
      : "Do NOT mention any price, dollar amount, percent, discount or sale.",
    t.allowsDates ? "" : "Do NOT mention specific dates.",
    "Never use superlatives or rankings (best, finest, greatest, #1, number one, top-rated, ultimate, unbeatable, unmatched, world-class, perfect, strongest, most potent). Do not praise a vendor or product beyond the facts; a vendor claim needs a source link in the facts.",
    "No health, medical or therapeutic claims, no dosing, nothing that appeals to minors, no alcohol, tobacco or driving.",
    t.key === "review-spotlight" ? "Quote the customer's review only in their own words; do not add to it." : "",
    t.key === "culture" ? "Keep the source links from the notes; say where the news came from." : "",
    "End with a short, calm call to action to visit the store or browse the menu (21+).",
    `Return JSON: {"headlines": [${HEADLINE_COUNT} different headline options, each under ${HEADLINE_MAX} characters], "excerpt": "one or two sentences, under ${EXCERPT_MAX} characters", "sections": [{"heading": "short heading", "paragraphs": ["short paragraph", "..."]}] (2 to 4 sections, 1 to 3 short paragraphs each), "cta": "one sentence"}`,
  ].filter(Boolean);
  return `${rules.join("\n")}\n\nFACTS:\n${item.facts.map((f) => `- ${f}`).join("\n") || "- (none)"}`;
}

// ── output check ─────────────────────────────────────────────────────────

export type DraftSection = { heading: string; paragraphs: string[] };
export type PostDraft = { headlines: string[]; excerpt: string; sections: DraftSection[]; cta: string };
export type DraftIssue = { level: "must-fix" | "heads-up"; text: string };

const SUPERLATIVE_RE =
  /\b(best|finest|greatest|number one|top[- ]rated|ultimate|unbeatable|unmatched|unrivaled|world[- ]class|perfect|purest|strongest|most potent|highest[- ]quality|premier|second to none)\b|#\s?1\b/gi;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi;
const DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{4}-\d{2}-\d{2}\b/gi;

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").replace(/[*#`]+/g, "").trim().slice(0, max) : "";
}

function normMoney(s: string): string {
  return s.replace(/[\s,$]/g, "").replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}
function normPct(s: string): string {
  return (s.match(/\d+(?:\.\d+)?/)?.[0] ?? s).replace(/\.0+$/, "");
}

/** Normalize the AI's JSON into a draft. Never throws. */
export function normalizeDraft(raw: unknown): PostDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const headlines: string[] = [];
  for (const h of Array.isArray(r.headlines) ? r.headlines : []) {
    const c = clean(h, HEADLINE_MAX).replace(/^["']|["']$/g, "");
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      headlines.push(c);
    }
    if (headlines.length >= HEADLINE_COUNT) break;
  }
  const sections: DraftSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    const so = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const paragraphs = (Array.isArray(so.paragraphs) ? so.paragraphs : []).map((p) => clean(p, 900)).filter(Boolean).slice(0, 4);
    if (paragraphs.length === 0) continue;
    sections.push({ heading: clean(so.heading, 90), paragraphs });
    if (sections.length >= SECTIONS_MAX) break;
  }
  return { headlines, excerpt: clean(r.excerpt, EXCERPT_MAX), sections, cta: clean(r.cta, 300) };
}

export function draftText(d: PostDraft): string {
  return [...d.headlines, d.excerpt, ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs]), d.cta].join("\n");
}

/** The checks the owner's rules need (Q-22-8, Q-22-9). Compliance flags are added by the server. */
export function checkDraft(t: PostTemplate, item: TemplateItem, d: PostDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const text = draftText(d);
  const facts = item.facts.join("\n");
  if (d.headlines.length === 0) issues.push({ level: "must-fix", text: "No headline came back. Draft it again." });
  if (d.sections.length === 0) issues.push({ level: "must-fix", text: "No body came back. Draft it again." });

  const sup = [...new Set((text.match(SUPERLATIVE_RE) ?? []).map((m) => m.toLowerCase()))];
  if (sup.length) issues.push({ level: "must-fix", text: `Superlatives are not allowed (Q-22-9): ${sup.join(", ")}.` });

  const money = [...new Set(text.match(MONEY_RE) ?? [])];
  const pct = [...new Set(text.match(PERCENT_RE) ?? [])];
  if (!t.allowsPrice) {
    if (money.length || pct.length) issues.push({ level: "must-fix", text: `Prices are only for Sale and Vendor-day posts (Q-22-8): ${[...money, ...pct].join(", ")}.` });
  } else {
    const okMoney = new Set((facts.match(MONEY_RE) ?? []).map(normMoney));
    const okPct = new Set((facts.match(PERCENT_RE) ?? []).map(normPct));
    const bad = [...money.filter((m) => !okMoney.has(normMoney(m))), ...pct.filter((p) => !okPct.has(normPct(p)))];
    if (bad.length) issues.push({ level: "must-fix", text: `These amounts are not in the promotion (Q-22-8): ${bad.join(", ")}.` });
  }
  if (!t.allowsDates) {
    const dates = [...new Set(text.match(DATE_RE) ?? [])];
    if (dates.length) issues.push({ level: "heads-up", text: `Dates are only for Sale, Vendor-day and Holiday posts: ${dates.join(", ")}.` });
  }
  if (t.key === "culture") {
    const factLinks = linksIn(facts);
    if (factLinks.length && !factLinks.some((u) => text.includes(u))) {
      issues.push({ level: "heads-up", text: "The source link is not in the draft; add it so readers can check the news (Q-22-1)." });
    }
  }
  const foreignLinks = linksIn(text).filter((u) => !facts.includes(u));
  if (foreignLinks.length) issues.push({ level: "must-fix", text: `Links not in the facts: ${foreignLinks.join(", ")}.` });
  return issues;
}

/**
 * The post body is plain paragraphs today (rich blocks come in N-7), so a
 * heading becomes its own short paragraph, then its paragraphs, then the CTA.
 */
export function draftToParagraphs(d: PostDraft): string[] {
  const out: string[] = [];
  for (const s of d.sections) {
    if (s.heading) out.push(s.heading);
    out.push(...s.paragraphs);
  }
  if (d.cta) out.push(d.cta);
  return out;
}

// ── pictures ─────────────────────────────────────────────────────────────

export type PictureCandidate = {
  id: string;
  url: string | null;
  title: string | null;
  alt_text: string | null;
  filename: string | null;
  tags: string[] | null;
  mime_type: string | null;
  vendor_id?: string | null;
  product_name?: string | null;
  ai_caption?: string | null;
  license_status?: string | null;
};

export type PictureSuggestion = { id: string; url: string | null; label: string; why: string };

/** Up to 3 pictures from Digital Assets: same vendor first, then matching words. */
export function suggestPictures(assets: PictureCandidate[], item: TemplateItem, max = PICTURE_COUNT): PictureSuggestion[] {
  const want = new Set(item.searchWords);
  const vendors = new Set(item.vendorIds);
  const scored: { a: PictureCandidate; score: number; why: string }[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    if (!a?.id || seen.has(a.id) || !a.url) continue;
    seen.add(a.id);
    if (a.mime_type && !a.mime_type.startsWith("image/")) continue;
    if (a.license_status === "pending-review") continue;
    const sameVendor = !!a.vendor_id && vendors.has(a.vendor_id);
    const hay = new Set(words([a.title, a.alt_text, a.filename, a.product_name, a.ai_caption, ...(a.tags ?? [])].filter(Boolean).join(" ")));
    const hits = [...want].filter((w) => hay.has(w)).length;
    const score = (sameVendor ? 10 : 0) + hits;
    if (score <= 0) continue;
    scored.push({ a, score, why: sameVendor ? "Same vendor" : `Matches ${hits} word${hits === 1 ? "" : "s"}` });
  }
  scored.sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
  return scored.slice(0, max).map(({ a, why }) => ({ id: a.id, url: a.url, label: a.title || a.filename || "(untitled image)", why }));
}

// ── self-test ────────────────────────────────────────────────────────────

export function __runPostTemplatesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL post-templates-core: ${name}`);
    }
  };
  const V = "11111111-1111-1111-1111-111111111111";
  const feed: ThisWeekFeed = {
    fromDay: "2026-11-05",
    toDay: "2026-11-11",
    newVendors: [{ id: V, name: "Cedar Farms", addedOn: "2026-11-09" }],
    freshDrops: [
      { vendorId: V, vendorName: "Cedar Farms", types: [{ type: "Flower", lots: 3 }], lots: 3 },
      { vendorId: null, vendorName: "Vendor not set", types: [{ type: "Other", lots: 1 }], lots: 1 },
    ],
    freshLotCount: 4,
    runningNow: [
      { id: "p1", title: "Flower Friday", when: "Fridays", offer: "20% off", bonusNote: null, markdown: false, belowCost: 0 },
      { id: "p2", title: "Too Deep", when: "2026-11-01 to 2026-11-30", offer: "$5.50 off", bonusNote: null, markdown: false, belowCost: 2 },
    ],
    comingUp: [{ id: "p3", title: "Cedar Day", when: "2026-11-20", offer: "15% off", bonusNote: "While supplies last", markdown: true, belowCost: 0 }],
    vendorDays: [{ id: "p3", title: "Cedar Day", when: "2026-11-20", offer: "15% off", bonusNote: "While supplies last", markdown: true, belowCost: 0 }],
    calendar: [{ date: "2026-11-26", name: "Thanksgiving", kind: "holiday" }],
  };

  ok("seven templates", POST_TEMPLATES.length === 7);
  ok("only sale + vendor-day allow price", POST_TEMPLATES.filter((t) => t.allowsPrice).map((t) => t.key).join(",") === "sale,vendor-day");
  ok("getTemplate unknown is null", getTemplate("nope") === null);
  ok("culture is CULTURE category", getTemplate("culture")?.category === "CULTURE");

  const nv = templateItems("new-vendor", feed);
  ok("new vendor item", nv.items.length === 1 && nv.items[0]!.vendorIds[0] === V);
  ok("new vendor carries its first drops", nv.items[0]!.facts.some((f) => f.includes("Flower (3 lots)")));
  const fd = templateItems("fresh-drops", feed);
  ok("fresh drops: all + per vendor (vendor-less skipped)", fd.items.length === 2 && fd.items[0]!.id === "drops:all");
  const sale = templateItems("sale", feed);
  ok("sale skips the markdown deal", sale.items.every((i) => i.id !== "deal:p3"));
  ok("sale holds the below-cost deal", sale.items.length === 1 && sale.held.length === 1 && sale.held[0]!.label === "Too Deep");
  ok("sale facts copy the offer", sale.items[0]!.facts.some((f) => f.includes("20% off")));
  const vd = templateItems("vendor-day", feed);
  ok("vendor day from vendorDays", vd.items.length === 1 && vd.items[0]!.facts.some((f) => f.includes("While supplies last")));
  const hol = templateItems("holiday", feed);
  ok("holiday item", hol.items.length === 1 && hol.items[0]!.label.includes("Thanksgiving"));
  ok("review has a notes item", templateItems("review-spotlight", feed).items[0]!.id === "notes");

  const cult = getTemplate("culture")!;
  const cultItem = templateItems("culture", feed).items[0]!;
  ok("culture needs notes", "error" in withNotes(cult, cultItem, ""));
  ok("culture needs a link", "error" in withNotes(cult, cultItem, "WSLCB announced new rules for retailers this week, read more."));
  const cw = withNotes(cult, cultItem, "WSLCB announced new rules this week: https://lcb.wa.gov/news/x.");
  ok("culture with link ok", "item" in cw && cw.item.facts.some((f) => f.includes("https://lcb.wa.gov/news/x")));
  ok("links trim the trailing dot", linksIn("see https://a.example/x.").join() === "https://a.example/x");
  const rev = withNotes(getTemplate("review-spotlight")!, templateItems("review-spotlight", feed).items[0]!, "Friendly staff and a clean shop, always a good visit.");
  ok("review notes quoted", "item" in rev && rev.item.facts[0]!.startsWith("Customer review picked by staff"));
  ok("notes optional elsewhere", "item" in withNotes(getTemplate("holiday")!, hol.items[0]!, ""));

  const p1 = buildDraftPrompt(getTemplate("new-vendor")!, nv.items[0]!);
  ok("prompt forbids price for new vendor", p1.includes("Do NOT mention any price"));
  ok("prompt lists facts", p1.includes("- New vendor at Greenway: Cedar Farms"));
  ok("prompt forbids superlatives", p1.includes("Never use superlatives"));
  const p2 = buildDraftPrompt(getTemplate("sale")!, sale.items[0]!);
  ok("prompt allows exact offer for sale", p2.includes("ONLY exactly as written") && !p2.includes("Do NOT mention specific dates"));

  const d = normalizeDraft({
    headlines: ["A", "a", "  B  ", "C", "D", "E", "F"],
    excerpt: "Short **excerpt**",
    sections: [{ heading: "## Hi", paragraphs: ["One", "", "Two"] }, { heading: "Empty", paragraphs: [] }],
    cta: "Visit us (21+).",
  });
  ok("headlines deduped and capped", d.headlines.join() === "A,B,C,D,E");
  ok("markdown stripped", d.excerpt === "Short excerpt" && d.sections[0]!.heading === "Hi");
  ok("empty section dropped", d.sections.length === 1 && d.sections[0]!.paragraphs.length === 2);
  ok("garbage input is safe", normalizeDraft(null).headlines.length === 0 && normalizeDraft("x").sections.length === 0);
  ok("paragraphs: heading, body, cta", draftToParagraphs(d).join("|") === "Hi|One|Two|Visit us (21+).");

  const nvT = getTemplate("new-vendor")!;
  const good: PostDraft = { headlines: ["Meet Cedar Farms"], excerpt: "New on our shelves.", sections: [{ heading: "Hello", paragraphs: ["Cedar Farms flower is here."] }], cta: "Stop by." };
  ok("clean draft no issues", checkDraft(nvT, nv.items[0]!, good).length === 0);
  const supD = { ...good, excerpt: "The best flower in Kitsap, #1 for sure." };
  const supI = checkDraft(nvT, nv.items[0]!, supD);
  ok("superlatives must-fix", supI.some((i) => i.level === "must-fix" && i.text.includes("best") && i.text.includes("#1")));
  ok("price in new vendor must-fix", checkDraft(nvT, nv.items[0]!, { ...good, cta: "Save 20% today, only $5." }).some((i) => i.text.includes("Q-22-8")));
  ok("date in new vendor heads-up", checkDraft(nvT, nv.items[0]!, { ...good, cta: "Come Nov 20." }).some((i) => i.level === "heads-up"));
  const saleT = getTemplate("sale")!;
  ok("sale with the promotion's offer ok", checkDraft(saleT, sale.items[0]!, { ...good, cta: "Take 20% off on Fridays." }).length === 0);
  ok("sale with another percent must-fix", checkDraft(saleT, sale.items[0]!, { ...good, cta: "Take 25% off." }).some((i) => i.text.includes("25%")));
  const vdItem = { ...vd.items[0]!, facts: [...vd.items[0]!.facts, "Offer: $5.50 off."] };
  ok("money matched normalized", checkDraft(getTemplate("vendor-day")!, vdItem, { ...good, cta: "Get $5.50 off." }).length === 0);
  ok("invented link must-fix", checkDraft(nvT, nv.items[0]!, { ...good, cta: "See https://evil.example" }).some((i) => i.text.startsWith("Links not in the facts")));
  ok("empty draft must-fix", checkDraft(nvT, nv.items[0]!, normalizeDraft({})).filter((i) => i.level === "must-fix").length === 2);
  if ("item" in cw) {
    ok("culture missing source heads-up", checkDraft(cult, cw.item, good).some((i) => i.text.includes("source link")));
    ok("culture with source ok", checkDraft(cult, cw.item, { ...good, cta: "Source: https://lcb.wa.gov/news/x" }).length === 0);
  }

  const assets: PictureCandidate[] = [
    { id: "a1", url: "u1", title: "Cedar Farms jar", alt_text: null, filename: "c.jpg", tags: null, mime_type: "image/jpeg", vendor_id: V },
    { id: "a2", url: "u2", title: "Cedar logo", alt_text: null, filename: "l.png", tags: ["farms"], mime_type: "image/png" },
    { id: "a3", url: "u3", title: "Unrelated", alt_text: null, filename: "x.png", tags: null, mime_type: "image/png" },
    { id: "a4", url: null, title: "Cedar no url", alt_text: null, filename: null, tags: null, mime_type: "image/png" },
    { id: "a5", url: "u5", title: "Cedar pending", alt_text: null, filename: null, tags: null, mime_type: "image/png", license_status: "pending-review" },
    { id: "a6", url: "u6", title: "Cedar pdf", alt_text: null, filename: null, tags: null, mime_type: "application/pdf" },
  ];
  const pics = suggestPictures(assets, nv.items[0]!);
  ok("pictures: same vendor first", pics[0]?.id === "a1" && pics[0]?.why === "Same vendor");
  ok("pictures: word match second", pics[1]?.id === "a2");
  ok("pictures: unrelated, no-url, pending, non-image skipped", pics.length === 2);
  ok("pictures capped at 3", suggestPictures([...assets, ...["b1", "b2", "b3"].map((id) => ({ ...assets[1]!, id }))], nv.items[0]!).length === 3);

  return { passed, failed };
}
