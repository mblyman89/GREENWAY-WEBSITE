/**
 * D239 N-9 (SOP-22 G-119; F-22-12; Q-22-2 (a) curated): the Curated reviews list.
 *
 * Pure (no server imports). Google's terms do not allow copying its reviews
 * into our own store, so there is no live Google block. Instead staff keep a
 * short list of reviews the customer said we may use: the quote, the first
 * name only, the link to the review on Google, and a permission tick (with a
 * note of how permission was given). Only ticked reviews can be used in a
 * post or the newsletter canvas, and a quote with health-benefit wording
 * (WAC 314-55-155) is held back even when ticked.
 */
import { therapeuticWords } from "./culture-desk-core";

export const CURATED_REVIEWS_KEY = "curated_reviews";
export const REVIEWS_MAX = 100;
export const REVIEW_QUOTE_MAX = 600;
export const REVIEW_NAME_MAX = 30;
export const REVIEW_NOTE_MAX = 200;

export type CuratedReview = {
  id: string;
  quote: string;
  firstName: string;
  googleUrl: string;
  permission: boolean;
  /** How and when the customer said yes, e.g. "Asked in store 11/10, said yes". */
  permissionNote: string;
  addedAt: string;
};

/** What the editors get: only usable reviews. */
export type CuratedReviewChoice = { id: string; quote: string; firstName: string; googleUrl: string };

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** First name only (privacy): the first word, letters, apostrophes and hyphens. */
export function firstNameOnly(v: unknown): string {
  const w = clean(v, 80).split(" ")[0] ?? "";
  const m = /^[\p{L}'\-.]+/u.exec(w);
  return (m ? m[0] : "").replace(/\.$/, "").slice(0, REVIEW_NAME_MAX);
}

const GOOGLE_HOST_RE = /(^|\.)(google\.[a-z.]{2,6}|g\.page|goo\.gl)$/i;
/** The review link must be an https link on Google (google.com, g.page, goo.gl, maps.app.goo.gl). Else "". */
export function googleReviewUrl(v: unknown): string {
  const s = clean(v, 1000);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    return GOOGLE_HOST_RE.test(u.hostname) ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Straight quotes; strips wrapping quote marks staff often paste. */
export function cleanQuote(v: unknown): string {
  return clean(v, REVIEW_QUOTE_MAX * 2)
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim()
    .slice(0, REVIEW_QUOTE_MAX);
}

let seq = 0;
export function newReviewId(nowMs: number = Date.now()): string {
  seq = (seq + 1) % 1000;
  return `rv-${nowMs.toString(36)}-${seq.toString(36)}`;
}

export function cleanReview(raw: unknown, nowIso: string = new Date().toISOString()): CuratedReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const quote = cleanQuote(r.quote);
  if (!quote) return null;
  const id = /^[a-z0-9-]{3,40}$/i.test(String(r.id ?? "")) ? String(r.id) : newReviewId();
  const added = Date.parse(String(r.addedAt ?? ""));
  return {
    id,
    quote,
    firstName: firstNameOnly(r.firstName),
    googleUrl: googleReviewUrl(r.googleUrl),
    permission: r.permission === true || r.permission === "on" || r.permission === "true",
    permissionNote: clean(r.permissionNote, REVIEW_NOTE_MAX),
    addedAt: Number.isFinite(added) ? new Date(added).toISOString() : nowIso,
  };
}

export function normalizeReviews(raw: unknown): CuratedReview[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { reviews?: unknown }).reviews) ? (raw as { reviews: unknown[] }).reviews : [];
  const out: CuratedReview[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const c = cleanReview(r);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= REVIEWS_MAX) break;
  }
  return out;
}

/** Why a review cannot be used (empty = usable). */
export function reviewProblems(r: CuratedReview): string[] {
  const out: string[] = [];
  if (!r.permission) out.push("No permission tick yet. Ask the customer first.");
  if (!r.firstName) out.push("Add the customer's first name.");
  const thera = therapeuticWords(r.quote);
  if (thera.length) out.push(`Health-benefit wording (${thera.join(", ")}) cannot be used in advertising (WAC 314-55-155). Pick a different review.`);
  return out;
}

export function isUsable(r: CuratedReview): boolean {
  return reviewProblems(r).length === 0;
}

export function usableChoices(list: readonly CuratedReview[]): CuratedReviewChoice[] {
  return list.filter(isUsable).map((r) => ({ id: r.id, quote: r.quote, firstName: r.firstName, googleUrl: r.googleUrl }));
}

/** Add or replace one review (by id); newest first; capped. */
export function upsertReview(list: readonly CuratedReview[], r: CuratedReview): CuratedReview[] {
  const rest = list.filter((x) => x.id !== r.id);
  const existing = list.find((x) => x.id === r.id);
  return [existing ? { ...r, addedAt: existing.addedAt } : r, ...rest].slice(0, REVIEWS_MAX);
}

export function removeReview(list: readonly CuratedReview[], id: string): CuratedReview[] {
  return list.filter((x) => x.id !== id);
}

/** The canvas `review` block fields for a picked review. */
export function reviewToCanvas(r: CuratedReviewChoice): { quote: string; name: string; href: string } {
  return { quote: r.quote, name: r.firstName, href: r.googleUrl };
}

/** The blog quote block paragraph (N-7 short code). */
export function reviewToBlogParagraph(r: CuratedReviewChoice): string {
  const quote = r.quote.replace(/\s+(—|--)\s+/g, " - ").replace(/ \| /g, " / ");
  return `> ${quote}${r.firstName ? ` — ${r.firstName}` : ""}${r.googleUrl ? ` | ${r.googleUrl}` : ""}`;
}

/** The notes for the "Review spotlight" post template (quote only these words). */
export function reviewToNotes(r: CuratedReviewChoice): string {
  return `"${r.quote}"${r.firstName ? ` — ${r.firstName}` : ""}${r.googleUrl ? ` (Google review: ${r.googleUrl})` : ""}`;
}

/** Is this quote one of the usable curated reviews? (used to warn when a typed quote is not from the list) */
export function quoteIsCurated(quote: string, choices: readonly CuratedReviewChoice[]): boolean {
  const n = (s: string) => cleanQuote(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  const q = n(quote);
  return !!q && choices.some((c) => n(c.quote) === q);
}

/** Review spotlight notes must carry one of the usable curated quotes (Q-22-2 (a)). Returns the refusal or null. */
export const SPOTLIGHT_NEEDS_CURATED =
  "A review spotlight must use a review from Curated reviews (with the customer's permission). Pick one in the notes, or add it in Blog & Newsletter > Curated reviews first.";
export function spotlightNotesProblem(notes: string, choices: readonly CuratedReviewChoice[]): string | null {
  const n = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const hay = n(notes);
  if (!hay) return SPOTLIGHT_NEEDS_CURATED;
  return choices.some((c) => n(c.quote) && hay.includes(n(c.quote))) ? null : SPOTLIGHT_NEEDS_CURATED;
}

// ---------------------------------------------------------------------------
export function __runCuratedReviewsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL curated-reviews-core: ${name}`);
    }
  };
  const now = "2026-11-12T10:00:00.000Z";

  ok("first name only", firstNameOnly("Samantha Jones") === "Samantha");
  ok("first name stops at junk", firstNameOnly("  Jo<script> ") === "Jo" && firstNameOnly("<b>") === "");
  ok("first name keeps hyphen/apostrophe", firstNameOnly("Mary-Kate O'Neil") === "Mary-Kate" && firstNameOnly("D'Angelo") === "D'Angelo");
  ok("initial dot dropped", firstNameOnly("Sam.") === "Sam");
  ok("empty name", firstNameOnly("") === "");

  ok("google.com ok", googleReviewUrl("https://www.google.com/maps/reviews/abc").startsWith("https://www.google.com/"));
  ok("g.page ok", googleReviewUrl("https://g.page/r/CXyz/review") !== "");
  ok("maps.app.goo.gl ok", googleReviewUrl("https://maps.app.goo.gl/abc") !== "");
  ok("http refused", googleReviewUrl("http://www.google.com/x") === "");
  ok("yelp refused", googleReviewUrl("https://www.yelp.com/biz/x") === "");
  ok("lookalike refused", googleReviewUrl("https://google.com.evil.io/x") === "" && googleReviewUrl("https://notgoogle.com/x") === "");
  ok("javascript refused", googleReviewUrl("javascript:alert(1)") === "");

  ok("quote wrapping marks stripped", cleanQuote('  “Great shop!” ') === "Great shop!");
  ok("quote capped", cleanQuote("x".repeat(900)).length === REVIEW_QUOTE_MAX);

  const r = cleanReview({ id: "rv-1", quote: "Friendly staff, clean shop.", firstName: "Sam Jones", googleUrl: "https://g.page/r/x", permission: "on", permissionNote: "Asked in store 11/10" }, now)!;
  ok("clean review", r.firstName === "Sam" && r.permission && r.googleUrl === "https://g.page/r/x" && r.addedAt === now);
  ok("no quote = null", cleanReview({ quote: "  " }) === null && cleanReview(null) === null && cleanReview("x") === null);
  ok("bad id replaced", /^rv-/.test(cleanReview({ id: "../../x", quote: "q" })!.id));
  ok("permission defaults false", cleanReview({ quote: "q", firstName: "A" })!.permission === false);

  ok("usable when ticked + name", isUsable(r));
  ok("not usable without tick", !isUsable({ ...r, permission: false }) && reviewProblems({ ...r, permission: false })[0].includes("permission"));
  ok("not usable without name", !isUsable({ ...r, firstName: "" }));
  const med = { ...r, quote: "This place helps with my anxiety and relieves pain" };
  ok("health wording held back", !isUsable(med) && reviewProblems(med).some((p) => p.includes("WAC 314-55-155")));

  const list = normalizeReviews([r, { ...r }, { quote: "Second", firstName: "Al", permission: true, id: "rv-2" }, { quote: "" }, { quote: "No tick", firstName: "Bo", id: "rv-3" }]);
  ok("normalize dedupes and drops empty", list.length === 3);
  ok("normalize object form", normalizeReviews({ reviews: [r] }).length === 1);
  ok("normalize junk", normalizeReviews(null).length === 0 && normalizeReviews("x").length === 0);
  ok("normalize cap", normalizeReviews(Array.from({ length: 150 }, (_, i) => ({ id: `rv-${i}x`, quote: `q${i}` }))).length === REVIEWS_MAX);

  const ch = usableChoices(list);
  ok("choices only usable", ch.length === 2 && ch.every((c) => c.id !== "rv-3"));
  ok("choices carry no permission note", !("permissionNote" in ch[0]));

  const up = upsertReview(list, { ...r, quote: "Edited", addedAt: "2030-01-01T00:00:00.000Z" });
  ok("upsert replaces, keeps addedAt", up.length === 3 && up[0].quote === "Edited" && up[0].addedAt === r.addedAt);
  const added = upsertReview(list, { ...r, id: "rv-new" });
  ok("upsert adds first", added.length === 4 && added[0].id === "rv-new");
  ok("remove", removeReview(list, "rv-1").length === 2);

  const c = ch[0];
  ok("to canvas", JSON.stringify(reviewToCanvas(c)) === JSON.stringify({ quote: c.quote, name: c.firstName, href: c.googleUrl }));
  const para = reviewToBlogParagraph(c);
  ok("to blog quote", para.startsWith("> ") && para.includes(" — Sam") && para.endsWith(" | https://g.page/r/x"));
  ok("blog quote escapes separators", !reviewToBlogParagraph({ ...c, quote: "A — B | C" }).slice(2).split(" — Sam")[0].includes(" | "));
  ok("to notes", reviewToNotes(c).startsWith('"Friendly staff, clean shop."') && reviewToNotes(c).includes("Google review"));

  ok("quote curated (loose match)", quoteIsCurated("“friendly staff clean shop”", ch));
  ok("quote not curated", !quoteIsCurated("Totally different", ch) && !quoteIsCurated("", ch));
  ok("ids unique", newReviewId(1) !== newReviewId(1));
  ok("spotlight ok with picked notes", spotlightNotesProblem(reviewToNotes(c), ch) === null);
  ok("spotlight refuses other text", spotlightNotesProblem("Some review I found online", ch) === SPOTLIGHT_NEEDS_CURATED);
  ok("spotlight refuses empty / no list", spotlightNotesProblem("", ch) !== null && spotlightNotesProblem(reviewToNotes(c), []) !== null);
  return { passed, failed };
}
