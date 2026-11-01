/**
 * G-75 (owner message 17): ONE customer search for the register and the back
 * office, built so it finds anyone.
 *
 * Owner (verbatim): "i am having a hard time searching for customers on the
 * front register. i can find them in the back office. i need a way to search
 * for customers better as well. find all matches even if we spell the name
 * partially, or use their last name or phone number, etc. we need the search
 * lookup to be very powerful so it can find anyone."
 *
 * Why the old search missed people (store.ts listCustomers, before G-75):
 *  1. The whole typed text was matched as ONE piece against each column, so
 *     "bill mcclendon" matched nothing: no single column holds both words.
 *  2. The register asked for 8 rows, newest live visit first. The 15,149
 *     imported Cultivera customers have no live visit yet, so a common first
 *     name filled the 8 slots with whoever happened to sort first and the
 *     right person was never shown.
 *  3. A hit showed only "Bill M." and points, so two Bills looked the same.
 *  4. The Cultivera Customer ID could not be searched at all.
 *
 * Now (all PURE, no database, no clock):
 *  - parseCustomerQuery splits the text into words. Every word must match
 *    (first name, last name or email may hold it, in any order), so "bill",
 *    "mcclendon", "bill mcc", "mcclendon bill" and "mcc" all find Bill
 *    McClendon. A phone typed any way ("(360) 809-3778", "809-3778", "3778")
 *    becomes digits matched anywhere in the phone; digits also match the
 *    Customer ID exactly. Text with "@" matches the email.
 *  - buildCustomerSearchFilter turns the words into ONE PostgREST filter,
 *    every word escaped (GW-021).
 *  - rankCustomerMatches puts the best match first: exact name, then name
 *    starts with, then contains; full phone, then phone ending, then phone
 *    contains; then the most recent purchase (ours or the old POS), then the
 *    biggest spender.
 *  - customerFigures adds the old-POS spend and last purchase to ours, so a
 *    customer imported from Cultivera shows what they spent and when they last
 *    bought, on every screen (Total Spent / Last Purchase Date, owner: "which
 *    our system did not pick up").
 *  - Typos ("mclendon") are the database's job: migration 0335's
 *    customer_search_fuzzy (trigram similarity). The server asks it only when
 *    the exact search finds nobody.
 */

/** Words beyond this are ignored (a search is a name, not a paragraph). */
export const MAX_SEARCH_TOKENS = 5;
/** Shortest search the register and back office accept. */
export const MIN_SEARCH_CHARS = 2;
/** Matches pulled from the database before ranking. */
export const SEARCH_CANDIDATE_CAP = 1000;

export type SearchTokenKind = "name" | "digits" | "email";
export type SearchToken = { kind: SearchTokenKind; text: string };
export type ParsedCustomerQuery = {
  /** Lower-case, single-spaced text as typed, for the whole-name bonus. */
  normalized: string;
  tokens: SearchToken[];
  /** True when the whole query is a phone number or Customer ID. */
  phoneLike: boolean;
};

/** Everything a search needs to know about a stored customer. */
export type SearchableCustomer = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  external_id?: string | null;
  is_medical_patient?: boolean;
  lifetime_spend_minor_units?: number | null;
  imported_spend_minor_units?: number | null;
  last_visit_at?: string | null;
  last_purchase_at?: string | null;
};

const PHONE_LIKE = /^[\d\s().+#-]+$/;
// Letters, digits and the few marks names and emails really use.
const KEEP = /[^\p{L}\p{N}@._+'-]/gu;

/** Split what staff typed into search words. Never throws. */
export function parseCustomerQuery(raw: string | null | undefined): ParsedCustomerQuery {
  const text = String(raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { normalized: "", tokens: [], phoneLike: false };
  const digitsOnly = text.replace(/\D/g, "");
  if (PHONE_LIKE.test(text) && digitsOnly.length > 0) {
    // "(360) 809-3778", "1-360-809-3778", "3778", "13" (a Customer ID).
    const d = digitsOnly.length === 11 && digitsOnly.startsWith("1") ? digitsOnly.slice(1) : digitsOnly;
    return { normalized: text, tokens: [{ kind: "digits", text: d }], phoneLike: true };
  }
  const tokens: SearchToken[] = [];
  const seen = new Set<string>();
  for (const part of text.split(" ")) {
    const t = part.replace(KEEP, "").replace(/^[.'_+-]+|[.'_+-]+$/g, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (t.includes("@")) tokens.push({ kind: "email", text: t });
    else if (/^\d+$/.test(t)) tokens.push({ kind: "digits", text: t });
    else tokens.push({ kind: "name", text: t });
    if (tokens.length >= MAX_SEARCH_TOKENS) break;
  }
  return { normalized: text, tokens, phoneLike: false };
}

/** LIKE wildcards escaped; nothing left that could change the filter's shape. */
function likeTerm(s: string): string {
  return s.replace(/[,()"\\:]/g, "").replace(/[%_]/g, (m) => `\\${m}`);
}

function tokenClause(t: SearchToken): string | null {
  const v = likeTerm(t.text);
  if (!v) return null;
  if (t.kind === "digits") {
    return [`phone_normalized.ilike.%${v}%`, `external_id.eq.${v}`].join(",");
  }
  if (t.kind === "email") {
    return [`email.ilike.%${v}%`, `email_normalized.ilike.%${v}%`].join(",");
  }
  return [`first_name.ilike.%${v}%`, `last_name.ilike.%${v}%`, `email.ilike.%${v}%`].join(",");
}

/**
 * ONE string for supabase-js `.or()`. Every word must match somewhere:
 *   one word:  a,b,c
 *   two words: and(or(a,b,c),or(d,e,f))
 * Null when nothing searchable was typed.
 */
export function buildCustomerSearchFilter(q: ParsedCustomerQuery): string | null {
  const clauses = q.tokens.map(tokenClause).filter((c): c is string => !!c);
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return `and(${clauses.map((c) => `or(${c})`).join(",")})`;
}

const low = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();
const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Does this customer hold every word? (The same rule the filter applies.) */
export function customerMatchesQuery(c: SearchableCustomer, q: ParsedCustomerQuery): boolean {
  if (q.tokens.length === 0) return false;
  const first = low(c.first_name);
  const last = low(c.last_name);
  const email = low(c.email);
  const phone = c.phone_normalized ?? digitsOf(c.phone);
  return q.tokens.every((t) => {
    if (t.kind === "digits") return phone.includes(t.text) || low(c.external_id) === t.text;
    if (t.kind === "email") return email.includes(t.text);
    return first.includes(t.text) || last.includes(t.text) || email.includes(t.text);
  });
}

/** Higher is a better match. 0 = the words are not all there. */
export function scoreCustomerMatch(c: SearchableCustomer, q: ParsedCustomerQuery): number {
  if (!customerMatchesQuery(c, q)) return 0;
  const first = low(c.first_name);
  const last = low(c.last_name);
  const email = low(c.email);
  const phone = c.phone_normalized ?? digitsOf(c.phone);
  const ext = low(c.external_id);
  let score = 0;
  for (const t of q.tokens) {
    if (t.kind === "digits") {
      if (ext === t.text) score += 45;
      if (phone === t.text) score += 45;
      else if (phone.endsWith(t.text)) score += 25;
      else if (phone.includes(t.text)) score += 12;
    } else if (t.kind === "email") {
      score += email === t.text ? 45 : email.startsWith(t.text) ? 25 : 12;
    } else if (first === t.text || last === t.text) score += 30;
    else if (first.startsWith(t.text) || last.startsWith(t.text)) score += 20;
    else if (first.includes(t.text) || last.includes(t.text)) score += 10;
    else score += 4; // only in the email
  }
  // Typed in the natural order: "bill mcc" = first starts "bill", last starts "mcc".
  const names = q.tokens.filter((t) => t.kind === "name");
  if (names.length >= 2 && first.startsWith(names[0].text) && last.startsWith(names[1].text)) score += 15;
  const full = `${first} ${last}`.trim();
  if (q.normalized && full === q.normalized) score += 25;
  return score;
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** What the customer spent and when they last bought, ours plus the old POS. */
export type CustomerFigures = {
  /** Our completed sales less refunds (live, 0232). */
  liveSpendMinor: number;
  /** Cultivera "Total Spent" (imported, never changes). */
  oldPosSpendMinor: number;
  totalSpendMinor: number;
  /** The later of our last visit and Cultivera's "Last Purchase Date". */
  lastPurchaseAt: string | null;
  lastPurchaseSource: "greenway" | "old_pos" | null;
};

export function customerFigures(c: {
  lifetime_spend_minor_units?: number | null;
  imported_spend_minor_units?: number | null;
  last_visit_at?: string | null;
  last_purchase_at?: string | null;
}, liveOverride?: { spendMinor: number; lastVisitAt: string | null }): CustomerFigures {
  const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  const live = liveOverride ? pos(liveOverride.spendMinor) : pos(c.lifetime_spend_minor_units);
  const old = pos(c.imported_spend_minor_units);
  const liveLast = liveOverride ? liveOverride.lastVisitAt : (c.last_visit_at ?? null);
  const oldLast = c.last_purchase_at ?? null;
  let lastPurchaseAt: string | null = null;
  let lastPurchaseSource: CustomerFigures["lastPurchaseSource"] = null;
  if (ms(liveLast) > 0 && ms(liveLast) >= ms(oldLast)) {
    lastPurchaseAt = liveLast;
    lastPurchaseSource = "greenway";
  } else if (ms(oldLast) > 0) {
    lastPurchaseAt = oldLast;
    lastPurchaseSource = "old_pos";
  }
  return { liveSpendMinor: live, oldPosSpendMinor: old, totalSpendMinor: live + old, lastPurchaseAt, lastPurchaseSource };
}

/** Best match first; ties go to the most recent buyer, then the biggest spender, then A to Z. */
export function rankCustomerMatches<T extends SearchableCustomer>(
  rows: readonly T[],
  q: ParsedCustomerQuery,
  fuzzy?: ReadonlyMap<string, number>,
): T[] {
  const scored = rows
    .map((r) => {
      let s = scoreCustomerMatch(r, q);
      // A typo match (0335 trigram similarity 0..1) ranks below every exact one.
      if (s === 0 && fuzzy?.has(r.id)) s = Math.max(0.01, Math.min(1, fuzzy.get(r.id) ?? 0));
      const f = customerFigures(r);
      return { r, s, last: ms(f.lastPurchaseAt), spend: f.totalSpendMinor, name: `${low(r.first_name)} ${low(r.last_name)}` };
    })
    .filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || b.last - a.last || b.spend - a.spend || a.name.localeCompare(b.name) || a.r.id.localeCompare(b.r.id));
  return scored.map((x) => x.r);
}

/** Only ask the typo search when a real name was typed and nothing matched exactly. */
export function shouldTryFuzzy(q: ParsedCustomerQuery, exactMatches: number): boolean {
  if (exactMatches > 0 || q.phoneLike) return false;
  const letters = q.tokens.filter((t) => t.kind === "name").map((t) => t.text).join("");
  return letters.length >= 3;
}

/** The text the typo search compares with "first last". */
export function fuzzyQueryText(q: ParsedCustomerQuery): string {
  return q.tokens.filter((t) => t.kind === "name").map((t) => t.text).join(" ");
}

// ── register hit ────────────────────────────────────────────────────────────

export function money(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortDate(iso: string | null): string | null {
  if (!iso || ms(iso) === 0) return null;
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

/** Privacy-lean label frozen onto the receipt: first name + last initial. */
export function memberLabel(firstName: string, lastName: string | null): string {
  const first = firstName.trim();
  const lastInitial = (lastName ?? "").trim().charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/**
 * The second line of a register hit, so two Bills can be told apart without
 * the iPad ever holding a full phone, email or birthday: full name, the last
 * 4 phone digits, last purchase, total spent, Customer ID.
 */
export function registerHitDetail(c: SearchableCustomer): { fullName: string; detail: string } {
  const fullName = `${c.first_name.trim()} ${(c.last_name ?? "").trim()}`.trim();
  const f = customerFigures(c);
  const phone = c.phone_normalized ?? digitsOf(c.phone);
  const parts: string[] = [];
  if (phone.length >= 4) parts.push(`phone …${phone.slice(-4)}`);
  const d = shortDate(f.lastPurchaseAt);
  parts.push(d ? `last bought ${d}` : "no purchases on file");
  if (f.totalSpendMinor > 0) parts.push(`${money(f.totalSpendMinor)} spent`);
  if (c.is_medical_patient) parts.push("medical");
  if (c.external_id) parts.push(`#${c.external_id}`);
  return { fullName, detail: parts.join(" · ") };
}

/** Plain-English line under the register results. */
export function registerResultNote(shown: number, total: number, usedFuzzy: boolean): string | null {
  if (shown === 0) return null;
  if (usedFuzzy) return "No exact match, so these are the closest spellings.";
  if (total > shown) return `Showing the best ${shown} of ${total.toLocaleString("en-US")} matches. Add the last name or more of the phone to narrow it.`;
  return null;
}

// ── self-tests ──────────────────────────────────────────────────────────────

export function __runCustomerSearchCoreTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };
  const c = (o: Partial<SearchableCustomer> & { id: string; first_name: string }): SearchableCustomer => ({
    last_name: null, email: null, phone: null, phone_normalized: null, ...o,
  });
  const bill = c({ id: "a", first_name: "bill", last_name: "mcclendon", phone: "(360) 809-3778", phone_normalized: "3608093778", external_id: "13", imported_spend_minor_units: 29120, last_purchase_at: "2026-02-14T20:40:49.470Z" });
  const billy = c({ id: "b", first_name: "Billy", last_name: "Bob", last_visit_at: "2026-10-31T20:00:00Z", lifetime_spend_minor_units: 5000 });
  const jane = c({ id: "c", first_name: "Jane", last_name: "Doe", email: "darrenwheeler13@gmail.com", phone_normalized: "2535551234" });
  const kelsey = c({ id: "d", first_name: "Kelsey and Charles", last_name: null });
  const majors = c({ id: "e", first_name: "Cheyanne", last_name: "Majors-Howe" });
  const all = [bill, billy, jane, kelsey, majors];
  const find = (s: string) => all.filter((x) => customerMatchesQuery(x, parseCustomerQuery(s))).map((x) => x.id);

  // parse
  ok("parse: empty", parseCustomerQuery("  ").tokens.length === 0);
  ok("parse: null", parseCustomerQuery(null).tokens.length === 0);
  ok("parse: two names", JSON.stringify(parseCustomerQuery("Bill  McClendon").tokens) === JSON.stringify([{ kind: "name", text: "bill" }, { kind: "name", text: "mcclendon" }]));
  ok("parse: formatted phone is one digits word", JSON.stringify(parseCustomerQuery("(360) 809-3778").tokens) === JSON.stringify([{ kind: "digits", text: "3608093778" }]));
  ok("parse: phone with leading 1", parseCustomerQuery("1-360-809-3778").tokens[0].text === "3608093778");
  ok("parse: phone flagged", parseCustomerQuery("809 3778").phoneLike && parseCustomerQuery("809 3778").tokens[0].text === "8093778");
  ok("parse: email word", parseCustomerQuery("Darren@Gmail").tokens[0].kind === "email");
  ok("parse: mixed name + digits", JSON.stringify(parseCustomerQuery("bill 3778").tokens.map((t) => t.kind)) === JSON.stringify(["name", "digits"]));
  ok("parse: punctuation stripped", parseCustomerQuery("bill, (mcc)").tokens.map((t) => t.text).join("|") === "bill|mcc");
  ok("parse: apostrophe kept inside", parseCustomerQuery("O'Brien").tokens[0].text === "o'brien");
  ok("parse: repeated word once", parseCustomerQuery("bill bill").tokens.length === 1);
  ok("parse: capped at 5 words", parseCustomerQuery("a b c d e f g").tokens.length === MAX_SEARCH_TOKENS);
  ok("parse: only symbols = nothing", parseCustomerQuery("%%% ***").tokens.length === 0);

  // filter
  const f1 = buildCustomerSearchFilter(parseCustomerQuery("mcc"));
  ok("filter: one word, three columns", f1 === "first_name.ilike.%mcc%,last_name.ilike.%mcc%,email.ilike.%mcc%");
  const f2 = buildCustomerSearchFilter(parseCustomerQuery("bill mcc"));
  ok("filter: two words ANDed", f2 === "and(or(first_name.ilike.%bill%,last_name.ilike.%bill%,email.ilike.%bill%),or(first_name.ilike.%mcc%,last_name.ilike.%mcc%,email.ilike.%mcc%))");
  ok("filter: phone digits + Customer ID", buildCustomerSearchFilter(parseCustomerQuery("(360) 809-3778")) === "phone_normalized.ilike.%3608093778%,external_id.eq.3608093778");
  ok("filter: email word", buildCustomerSearchFilter(parseCustomerQuery("bob@x.com")) === "email.ilike.%bob@x.com%,email_normalized.ilike.%bob@x.com%");
  ok("filter: wildcard escaped", buildCustomerSearchFilter(parseCustomerQuery("a_b"))!.includes("a\\_b"));
  ok("filter: nothing typed = null", buildCustomerSearchFilter(parseCustomerQuery("")) === null);
  ok("filter: no grammar characters leak", buildCustomerSearchFilter(parseCustomerQuery("x(y),z")) === "first_name.ilike.%xyz%,last_name.ilike.%xyz%,email.ilike.%xyz%");

  // match: the owner's cases
  ok("match: first name", find("bill").join() === "a,b");
  ok("match: last name only", find("mcclendon").join() === "a");
  ok("match: partial last name", find("mccl").join() === "a");
  ok("match: partial first + partial last", find("bi mcc").join() === "a");
  ok("match: last then first", find("mcclendon bill").join() === "a");
  ok("match: full phone formatted", find("(360) 809-3778").join() === "a");
  ok("match: phone last 4", find("3778").join() === "a");
  ok("match: phone middle", find("809-37").join() === "a");
  ok("match: Customer ID", find("13").join() === "a");
  ok("match: email part", find("darrenwheeler").join() === "c");
  ok("match: name + last 4", find("bill 3778").join() === "a");
  ok("match: hyphenated last name by part", find("howe").join() === "e" && find("majors howe").join() === "e");
  ok("match: word inside first name", find("charles").join() === "d");
  ok("match: case-insensitive", find("BILL MCCLENDON").join() === "a");
  ok("match: wrong second word excludes", find("bill smith").length === 0);
  ok("match: nothing typed matches nobody", find("").length === 0);

  // rank
  const q = parseCustomerQuery("bill");
  const r = rankCustomerMatches(all, q);
  ok("rank: exact first name beats starts-with", r[0].id === "a" && r[1].id === "b");
  ok("rank: non-matches dropped", r.length === 2);
  ok("rank: full name bonus", scoreCustomerMatch(bill, parseCustomerQuery("bill mcclendon")) > scoreCustomerMatch(bill, parseCustomerQuery("mcclendon bill")));
  ok("rank: full phone beats ending", scoreCustomerMatch(bill, parseCustomerQuery("3608093778")) > scoreCustomerMatch(bill, parseCustomerQuery("3778")));
  ok("rank: phone ending beats middle", scoreCustomerMatch(bill, parseCustomerQuery("3778")) > scoreCustomerMatch(bill, parseCustomerQuery("8093")));
  const twins = [c({ id: "x1", first_name: "Sam", last_name: "Lee", last_purchase_at: "2025-01-01T00:00:00Z" }), c({ id: "x2", first_name: "Sam", last_name: "Lee", last_visit_at: "2026-10-30T00:00:00Z" })];
  ok("rank: tie goes to the most recent buyer", rankCustomerMatches(twins, parseCustomerQuery("sam lee"))[0].id === "x2");
  const spenders = [c({ id: "s1", first_name: "Al", imported_spend_minor_units: 100 }), c({ id: "s2", first_name: "Al", imported_spend_minor_units: 900 })];
  ok("rank: then the biggest spender", rankCustomerMatches(spenders, parseCustomerQuery("al"))[0].id === "s2");
  const fz = new Map([["z", 0.62]]);
  const typo = c({ id: "z", first_name: "bill", last_name: "mcclendon" });
  ok("rank: typo hit kept only via fuzzy score", rankCustomerMatches([typo], parseCustomerQuery("mclendon"), fz).length === 1 && rankCustomerMatches([typo], parseCustomerQuery("mclendon")).length === 0);
  const exactMc = c({ id: "m", first_name: "Ann", last_name: "Mclendon" });
  ok("rank: exact beats typo", rankCustomerMatches([typo, exactMc], parseCustomerQuery("mclendon"), new Map([["z", 0.99]]))[0].id === "m");
  ok("fuzzy: only when nothing matched", shouldTryFuzzy(parseCustomerQuery("mclendon"), 0) && !shouldTryFuzzy(parseCustomerQuery("mclendon"), 3));
  ok("fuzzy: never for phones", !shouldTryFuzzy(parseCustomerQuery("3778"), 0));
  ok("fuzzy: needs 3 letters", !shouldTryFuzzy(parseCustomerQuery("bi"), 0));
  ok("fuzzy: text is the name words", fuzzyQueryText(parseCustomerQuery("bill 3778 mcc")) === "bill mcc");

  // figures
  const fb = customerFigures(bill);
  ok("figures: old POS spend counted", fb.oldPosSpendMinor === 29120 && fb.totalSpendMinor === 29120);
  ok("figures: old POS last purchase used", fb.lastPurchaseAt === "2026-02-14T20:40:49.470Z" && fb.lastPurchaseSource === "old_pos");
  const both = customerFigures({ lifetime_spend_minor_units: 5000, imported_spend_minor_units: 29120, last_visit_at: "2026-11-01T18:00:00Z", last_purchase_at: "2026-02-14T20:40:49Z" });
  ok("figures: live + old added", both.totalSpendMinor === 34120 && both.liveSpendMinor === 5000);
  ok("figures: later date wins (ours)", both.lastPurchaseSource === "greenway" && both.lastPurchaseAt === "2026-11-01T18:00:00Z");
  ok("figures: override from computed rollup", customerFigures({ imported_spend_minor_units: 100 }, { spendMinor: 250, lastVisitAt: null }).totalSpendMinor === 350);
  ok("figures: nothing on file", customerFigures({}).lastPurchaseAt === null && customerFigures({}).totalSpendMinor === 0);
  ok("figures: negative/NaN ignored", customerFigures({ lifetime_spend_minor_units: -5, imported_spend_minor_units: Number.NaN }).totalSpendMinor === 0);
  ok("figures: bad date ignored", customerFigures({ last_purchase_at: "nope" }).lastPurchaseAt === null);

  // register hit
  const h = registerHitDetail({ ...bill, is_medical_patient: true });
  ok("hit: full name", h.fullName === "bill mcclendon");
  ok("hit: last 4 only", h.detail.includes("phone …3778") && !h.detail.includes("809"));
  ok("hit: last bought (Pacific)", h.detail.includes("last bought Feb 14, 2026"));
  ok("hit: spent", h.detail.includes("$291.20 spent"));
  ok("hit: medical + Customer ID", h.detail.includes("medical") && h.detail.endsWith("#13"));
  ok("hit: no purchases", registerHitDetail(kelsey).detail === "no purchases on file");
  ok("hit: never the email", !registerHitDetail(jane).detail.includes("@"));
  ok("label: first + last initial", memberLabel(" Bill ", "mcclendon") === "Bill m." && memberLabel("Cher", null) === "Cher");
  ok("money: thousands", money(320385) === "$3,203.85");
  ok("note: more than shown", (registerResultNote(25, 412, false) ?? "").includes("best 25 of 412"));
  ok("note: fuzzy", (registerResultNote(3, 3, true) ?? "").includes("closest spellings"));
  ok("note: all shown", registerResultNote(4, 4, false) === null && registerResultNote(0, 0, false) === null);

  return { passed, failed: failures.length, failures };
}
