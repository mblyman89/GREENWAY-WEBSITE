/**
 * src/lib/pos/member-book-core.ts  (D170 O15: loyalty on the iPad)
 *
 * Owner, 2026-11-04: "Please add customer loyalty to the iPad. Our data is
 * safe. I want all features unlocked."
 *
 * The register keeps a copy of the member book (every customer, with their
 * loyalty points and tier) in its ENCRYPTED store, refreshed while online.
 * During an outage the budtender can still:
 *   - look a member up (the SAME G-75 search rules the server uses: every
 *     word in any order, phone digits anywhere, Customer ID, email);
 *   - have a scanned ID attach the member automatically (the SAME AO-3
 *     matcher: exact first + last name + birthdate, one match only);
 *   - see the saved summary (last purchase, total spent) instead of history.
 *
 * Every offline answer says how old the copy is, because points can change
 * on another register. At sync the server re-checks the member exists
 * (sync-store B14), so an attach from a stale copy can never silently land
 * points on a deleted or merged profile.
 *
 * What the copy holds and why (row keys are short to keep it small, ~2 MB
 * for 15,000 customers): id; first and last name; phone digits and email
 * (search only, never displayed); birthdate (scan match only, never
 * displayed); Customer ID; medical flag; spend and last purchase (the
 * result line); points balance and lifetime points (tier).
 *
 * Pure: no I/O. Self-tested below and registered in run-pure-selftests.ts.
 */
import {
  customerFigures,
  memberLabel,
  money,
  parseCustomerQuery,
  rankCustomerMatches,
  registerHitDetail,
  registerResultNote,
  shortDate,
  type SearchableCustomer,
} from "../customers/customer-search-core";
import { matchScannedCustomer, type ScannedIdentity } from "./member-match-core";
import { applyRewardPricing, chooseReward } from "../loyalty/loyalty-reward-core";
import { generateRedemptionCode } from "../loyalty/engine";

export const MEMBER_BOOK_VERSION = 1;
/** Rows per page from /api/pos/member-book (PostgREST returns at most 1,000). */
export const MEMBER_BOOK_PAGE_SIZE = 1000;
/** Safety cap on pages (60,000 customers) so a bad cursor can never loop forever. */
export const MEMBER_BOOK_MAX_PAGES = 60;
/** Refresh the copy this often while online. */
export const MEMBER_BOOK_REFRESH_MS = 30 * 60_000;
/** Hits shown, same as the online lookup. */
export const MEMBER_BOOK_HIT_LIMIT = 25;

/** One customer as the server sends it and the iPad stores it. */
export type BookRow = {
  /** customers.id */
  i: string;
  /** first name */
  f: string;
  /** last name */
  l: string | null;
  /** phone digits (search only) */
  p: string | null;
  /** email, lower case (search only) */
  e: string | null;
  /** birthdate yyyy-mm-dd (scan match only) */
  b: string | null;
  /** Customer ID (old POS) */
  x: string | null;
  /** medical patient */
  m: boolean;
  /** our spend (minor units) */
  s: number;
  /** old-POS spend (minor units) */
  o: number;
  /** our last visit (ISO) */
  v: string | null;
  /** old-POS last purchase (ISO) */
  lp: string | null;
  /** points balance */
  bp: number;
  /** lifetime points (tier) */
  lt: number;
};

export type BookTier = { name: string; minPoints: number };

export type MemberBook = {
  v: number;
  /** When the copy was downloaded (ms). */
  at: number;
  tiers: BookTier[];
  rows: BookRow[];
};

/** The hit shape the register already uses (PosMemberHit). */
export type BookHit = {
  customerId: string;
  label: string;
  points: number;
  tierName: string | null;
  fullName?: string;
  detail?: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Validate one row (server page or stored copy). Null when unusable. */
export function parseBookRow(raw: unknown): BookRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const i = str(r.i);
  const f = typeof r.f === "string" ? r.f : null;
  if (!i || f === null) return null;
  return {
    i,
    f,
    l: str(r.l),
    p: str(r.p),
    e: str(r.e),
    b: str(r.b),
    x: str(r.x),
    m: r.m === true,
    s: num(r.s),
    o: num(r.o),
    v: str(r.v),
    lp: str(r.lp),
    bp: Math.max(0, Math.floor(typeof r.bp === "number" && Number.isFinite(r.bp) ? r.bp : 0)),
    lt: num(r.lt),
  };
}

export function parseBookTiers(raw: unknown): BookTier[] {
  if (!Array.isArray(raw)) return [];
  const out: BookTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.minPoints !== "number" || !Number.isFinite(x.minPoints)) continue;
    out.push({ name: x.name, minPoints: x.minPoints });
  }
  return out;
}

/** Parse the stored copy; anything unreadable is "no copy" (never throws). */
export function parseMemberBook(raw: string | null | undefined): MemberBook | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const b = o as Record<string, unknown>;
  if (b.v !== MEMBER_BOOK_VERSION || typeof b.at !== "number" || !Array.isArray(b.rows)) return null;
  const rows: BookRow[] = [];
  const seen = new Set<string>();
  for (const r of b.rows) {
    const row = parseBookRow(r);
    if (!row || seen.has(row.i)) continue;
    seen.add(row.i);
    rows.push(row);
  }
  return { v: MEMBER_BOOK_VERSION, at: b.at, tiers: parseBookTiers(b.tiers), rows };
}

/**
 * One page from the server. `next` is the cursor for the following page, or
 * null when this was the last. Returns null when the page is malformed (the
 * whole download is then abandoned and the old copy kept).
 */
export function parseBookPage(raw: unknown): { rows: BookRow[]; next: string | null; tiers: BookTier[] | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.rows)) return null;
  const rows = p.rows.map(parseBookRow).filter((r): r is BookRow => !!r);
  const next = typeof p.next === "string" && p.next ? p.next : null;
  const tiers = Array.isArray(p.tiers) ? parseBookTiers(p.tiers) : null;
  return { rows, next, tiers };
}

/** Should the register download a fresh copy now? */
export function memberBookDue(book: MemberBook | null, nowMs: number): boolean {
  return !book || nowMs - book.at >= MEMBER_BOOK_REFRESH_MS || nowMs < book.at;
}

function tierName(lifetime: number, tiers: BookTier[]): string | null {
  let chosen: BookTier | null = null;
  for (const t of tiers) if (lifetime >= t.minPoints && (!chosen || t.minPoints > chosen.minPoints)) chosen = t;
  return chosen?.name ?? null;
}

function asSearchable(r: BookRow): SearchableCustomer {
  return {
    id: r.i,
    first_name: r.f,
    last_name: r.l,
    email: r.e,
    phone: r.p,
    phone_normalized: r.p,
    external_id: r.x,
    is_medical_patient: r.m,
    lifetime_spend_minor_units: r.s,
    imported_spend_minor_units: r.o,
    last_visit_at: r.v,
    last_purchase_at: r.lp,
  };
}

export function bookHit(r: BookRow, tiers: BookTier[]): BookHit {
  const { fullName, detail } = registerHitDetail(asSearchable(r));
  return { customerId: r.i, label: memberLabel(r.f, r.l), points: r.bp, tierName: tierName(r.lt, tiers), fullName, detail };
}

/** "12 min" / "3 h" / "2 days" */
export function bookAgeWords(book: MemberBook, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - book.at) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The line every offline answer carries. */
export function bookOfflineNote(book: MemberBook, nowMs: number): string {
  return `Offline: from the member book saved on this iPad ${bookAgeWords(book, nowMs)}. Points may have changed since.`;
}

/** Offline member lookup: the same search rules and ranking as the server. */
export function searchMemberBook(
  book: MemberBook,
  query: string,
  nowMs: number,
): { members: BookHit[]; note: string } {
  const q = parseCustomerQuery(query);
  if (q.tokens.length === 0) return { members: [], note: bookOfflineNote(book, nowMs) };
  const byId = new Map(book.rows.map((r) => [r.i, r]));
  const ranked = rankCustomerMatches(book.rows.map(asSearchable), q);
  const shown = ranked.slice(0, MEMBER_BOOK_HIT_LIMIT).map((c) => bookHit(byId.get(c.id)!, book.tiers));
  const more = registerResultNote(shown.length, ranked.length, false);
  return { members: shown, note: [bookOfflineNote(book, nowMs), more].filter(Boolean).join(" ") };
}

/** Offline scan auto-attach: the same one-match-only rule as /api/pos/member-match. */
export function matchFromBook(book: MemberBook, scan: ScannedIdentity): BookHit | null {
  const dob = scan.dateOfBirth.trim();
  const pool = book.rows.filter((r) => (r.b ?? "").slice(0, 10) === dob);
  const res = matchScannedCustomer(
    scan,
    pool.map((r) => ({ id: r.i, first_name: r.f, last_name: r.l, birthdate: r.b })),
  );
  if (res.kind !== "match") return null;
  const row = pool.find((r) => r.i === res.customerId);
  return row ? bookHit(row, book.tiers) : null;
}

/** Offline stand-in for the purchase history: the saved summary line. */
export function bookHistorySummary(book: MemberBook, customerId: string, nowMs: number): string | null {
  const r = book.rows.find((x) => x.i === customerId);
  if (!r) return null;
  const f = customerFigures(asSearchable(r));
  const d = shortDate(f.lastPurchaseAt);
  const parts = [d ? `last bought ${d}` : "no purchases on file"];
  if (f.totalSpendMinor > 0) parts.push(`${money(f.totalSpendMinor)} spent`);
  parts.push(`${r.bp.toLocaleString("en-US")} points`);
  return `Offline: the full purchase list needs a connection. Saved on this iPad ${bookAgeWords(book, nowMs)}: ${parts.join(" · ")}.`;
}

/**
 * Change one member's points on THIS iPad's copy (an offline reward used
 * here). The server's balance is the truth; the next download replaces it.
 */
export function adjustBookPoints(book: MemberBook, customerId: string, delta: number): MemberBook {
  return { ...book, rows: book.rows.map((r) => (r.i === customerId ? { ...r, bp: Math.max(0, r.bp + Math.round(delta)) } : r)) };
}

export function bookRow(book: MemberBook | null, customerId: string): BookRow | null {
  return book?.rows.find((r) => r.i === customerId) ?? null;
}

// ---------------------------------------------------------------------------
// D170 O15b — a reward used OFFLINE
// ---------------------------------------------------------------------------

/** One priced cart line with what the floor needs (cost from the menu). */
export type OfflineRewardLine = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  unitPriceMinor: number;
  regularPriceMinor: number;
  costMinorUnits: number | null;
};

export type OfflineRewardGrant = {
  redemptionId: string;
  code: string;
  valueMinor: number;
  appliedMinor: number;
  pointsSpent: number;
  source: "points";
  perVariant: Record<string, number>;
  rewardPoints: number;
  percentBps: number;
  offline: true;
};

/**
 * Price a 150 / 300 point reward on this iPad, against the member's SAVED
 * balance, with the very same pure pricing the server uses
 * (applyRewardPricing: percent off the regular price, better-of with the
 * day's deal, legal floor, never-discount items untouched). The redemption id
 * and code are minted here; at sync the server issues exactly that
 * redemption only if the LIVE balance still covers it, otherwise the sale
 * goes to the exception queue (never silently honoured).
 */
export function offlineRewardGrant(input: {
  balancePoints: number;
  rewardPoints: unknown;
  lines: OfflineRewardLine[];
  neverDiscountKeys: readonly string[];
  redemptionId: string;
  rand?: () => number;
}): { ok: true; grant: OfflineRewardGrant } | { ok: false; error: string } {
  const chosen = chooseReward(input.balancePoints, input.rewardPoints);
  if (!chosen.ok) return { ok: false, error: `${chosen.error} (saved balance on this iPad)` };
  if (input.balancePoints < chosen.reward.points) {
    return { ok: false, error: `Not enough points on the saved balance (${input.balancePoints}).` };
  }
  if (input.lines.length === 0) return { ok: false, error: "Add items first." };
  const never = new Set(input.neverDiscountKeys.map((k) => k.trim().toLowerCase()));
  const key = (l: OfflineRewardLine) => l.variantId ?? l.productId;
  const exclude = new Set(input.lines.filter((l) => never.has(l.productId.trim().toLowerCase())).map(key));
  const priced = applyRewardPricing(
    input.lines.map((l) => ({
      lineId: key(l),
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
      costMinorUnits: l.costMinorUnits,
    })),
    chosen.reward,
    { excludeLineIds: exclude },
  );
  if (!priced.ok) return { ok: false, error: priced.message };
  const perVariant: Record<string, number> = {};
  for (const l of priced.lines) if (l.loyaltyDiscountMinorUnits > 0) perVariant[l.lineId] = l.loyaltyDiscountMinorUnits;
  return {
    ok: true,
    grant: {
      redemptionId: input.redemptionId,
      code: generateRedemptionCode(input.rand),
      valueMinor: priced.appliedMinorUnits,
      appliedMinor: priced.appliedMinorUnits,
      pointsSpent: chosen.reward.points,
      source: "points",
      perVariant,
      rewardPoints: chosen.reward.points,
      percentBps: chosen.reward.percentBps,
      offline: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runMemberBookCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`member-book-core FAIL: ${label}`);
    }
  };
  const now = 1_800_000_000_000;
  const row = (o: Partial<BookRow> & { i: string; f: string }): BookRow => ({
    l: null, p: null, e: null, b: null, x: null, m: false, s: 0, o: 0, v: null, lp: null, bp: 0, lt: 0, ...o,
  });
  const bill = row({ i: "a", f: "Bill", l: "McClendon", p: "3608093778", b: "1980-04-02", x: "13", o: 29120, lp: "2026-02-14T20:40:49Z", bp: 320, lt: 900 });
  const billy = row({ i: "b", f: "Billy", l: "Bob", p: "2535550000", b: "1990-01-01", bp: 10 });
  const twinA = row({ i: "c", f: "Sam", l: "Lee", b: "1985-05-05" });
  const twinB = row({ i: "d", f: "Sam", l: "Lee", b: "1985-05-05" });
  const book: MemberBook = { v: 1, at: now - 12 * 60_000, tiers: [{ name: "Silver", minPoints: 500 }, { name: "Gold", minPoints: 2000 }], rows: [bill, billy, twinA, twinB] };

  ok(parseMemberBook(null) === null && parseMemberBook("x{") === null, "unreadable -> no copy");
  ok(parseMemberBook(JSON.stringify({ ...book, v: 2 })) === null, "wrong version -> no copy");
  const round = parseMemberBook(JSON.stringify({ ...book, rows: [...book.rows, bill, { i: "", f: "x" }] }));
  ok(round?.rows.length === 4, "round trip drops duplicates and bad rows");
  ok(parseBookRow({ i: "z", f: "Ann", bp: -5 })?.bp === 0, "negative points clamp to 0");

  const r1 = searchMemberBook(book, "bill mcc", now);
  ok(r1.members[0]?.customerId === "a", "two words in natural order find Bill");
  ok(searchMemberBook(book, "mcclendon bill", now).members[0]?.customerId === "a", "any order");
  ok(searchMemberBook(book, "3778", now).members[0]?.customerId === "a", "phone ending");
  ok(searchMemberBook(book, "13", now).members[0]?.customerId === "a", "Customer ID");
  ok(searchMemberBook(book, "bill", now).members.length === 2, "partial name finds both Bills");
  ok(r1.members[0]?.label === "Bill M." && r1.members[0]?.tierName === "Silver" && r1.members[0]?.points === 320, "hit label, tier and points");
  ok(!(r1.members[0]?.detail ?? "").includes("3608093778") && (r1.members[0]?.detail ?? "").includes("…3778"), "only the phone tail is shown");
  ok(/^Offline: from the member book saved on this iPad 12 min ago\./.test(r1.note), "every offline answer says how old the copy is");
  ok(searchMemberBook(book, "  ", now).members.length === 0, "empty query finds nobody");

  ok(matchFromBook(book, { firstName: "BILL", lastName: "MCCLENDON", dateOfBirth: "1980-04-02" })?.customerId === "a", "scan match");
  ok(matchFromBook(book, { firstName: "Sam", lastName: "Lee", dateOfBirth: "1985-05-05" }) === null, "ambiguous scan never attaches");
  ok(matchFromBook(book, { firstName: "Bill", lastName: "McClendon", dateOfBirth: "1980-04-03" }) === null, "wrong birthdate never attaches");

  const h = bookHistorySummary(book, "a", now) ?? "";
  ok(/last bought Feb 14/.test(h) && /\$291\.20 spent/.test(h) && /320 points/.test(h), "history summary");
  ok(bookHistorySummary(book, "nope", now) === null, "unknown member has no summary");

  const spent = adjustBookPoints(book, "a", -150);
  ok(bookRow(spent, "a")?.bp === 170 && bookRow(book, "a")?.bp === 320, "points adjust on a copy");
  ok(bookRow(adjustBookPoints(book, "b", -500), "b")?.bp === 0, "never below zero");

  ok(memberBookDue(null, now) && !memberBookDue(book, now) && memberBookDue({ ...book, at: now - MEMBER_BOOK_REFRESH_MS }, now), "refresh due");
  ok(memberBookDue({ ...book, at: now + 60_000 }, now), "a copy from the future (clock moved) refreshes");

  const page = parseBookPage({ rows: [{ i: "q", f: "Q" }, { bad: 1 }], next: "q", tiers: [{ name: "T", minPoints: 1 }] });
  ok(page?.rows.length === 1 && page.next === "q" && page.tiers?.length === 1, "page parse");
  ok(parseBookPage({ rows: [], next: "" })?.next === null, "last page");
  ok(parseBookPage({ nope: true }) === null, "malformed page abandons the download");
  // O15b — offline reward
  const lines: OfflineRewardLine[] = [
    { variantId: "v1", productId: "p1", category: "flower", quantity: 1, unitPriceMinor: 4000, regularPriceMinor: 4000, costMinorUnits: 1000 },
    { variantId: "v2", productId: "p2", category: "flower", quantity: 2, unitPriceMinor: 2000, regularPriceMinor: 2000, costMinorUnits: 500 },
  ];
  const g = offlineRewardGrant({ balancePoints: 320, rewardPoints: 300, lines, neverDiscountKeys: [], redemptionId: "r1", rand: () => 0 });
  ok(g.ok && g.grant.pointsSpent === 300 && g.grant.percentBps === 2500 && g.grant.offline, "300 pts = 25% off, offline");
  ok(g.ok && g.grant.appliedMinor === 2000 && g.grant.perVariant.v1 === 1000 && g.grant.perVariant.v2 === 500, "25% of regular per unit");
  ok(g.ok && /^GW-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(g.grant.code), "code minted in the normal shape");
  const poor = offlineRewardGrant({ balancePoints: 200, rewardPoints: 300, lines, neverDiscountKeys: [], redemptionId: "r2" });
  ok(!poor.ok && /saved balance/.test(poor.ok ? "" : poor.error), "saved balance too low refuses");
  const never = offlineRewardGrant({ balancePoints: 320, rewardPoints: 150, lines, neverDiscountKeys: ["P1"], redemptionId: "r3" });
  ok(never.ok && !never.grant.perVariant.v1 && never.grant.perVariant.v2 === 200, "never-discount items keep their price");
  const none = offlineRewardGrant({ balancePoints: 320, rewardPoints: 150, lines: [{ ...lines[0], unitPriceMinor: 1000 }], neverDiscountKeys: [], redemptionId: "r4" });
  ok(!none.ok, "no savings, no points used");
  return { passed, failed };
}
