/**
 * src/lib/customers/customer-table-core.ts  (customers-table-enterprise)
 *
 * Owner (verbatim): "Thank you. All customer data has now landed in our
 * customer table. I would like you to expand the table so it shows more
 * details, every important piece of data should be shown on the table. I want
 * the contact column to be phone and email separated. I want this table to be
 * very useful and powerful. Please enhance the table to be of enterprise grade
 * quality. Push and merge the work. Follow the standing rules. Thank you!"
 *
 * The ONE place the /admin/customers table's rules live:
 *
 *   - the column registry (every column, its group, whether it shows by
 *     default, which sort its header clicks to) and the ?col= picker grammar;
 *   - the URL grammar for the whole page (search, filters, sort, page size,
 *     density, columns) - untrusted strings in, a validated state out, never
 *     an exception;
 *   - the filter ops a store applies (pure data, so the store stays a switch);
 *   - display helpers: phone formatting, age from birthday, medical
 *     authorization status, where a record came from;
 *   - the export row (the CSV / Excel download is the same table, every
 *     column, money in cents for the workbook helper).
 *
 * PURE: no server-only, no database. Self-tests: __runCustomerTableCoreTests
 * (scripts/compliance/run-pure-selftests.ts) + tests/compliance/customer-table-core.test.ts.
 */

import { CUSTOMER_SORTS, parseYesNo, resolveSort, type SortOption } from "@/lib/admin/list-filter-core";
import { customerFigures } from "@/lib/customers/customer-search-core";

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type CustomerColumnGroup = "identity" | "contact" | "medical" | "loyalty" | "money" | "history" | "record";

export type CustomerColumn = {
  key: string;
  label: string;
  group: CustomerColumnGroup;
  /** Shown when the operator has not picked columns. */
  defaultVisible: boolean;
  /** Can never be hidden (the row's link). */
  locked?: boolean;
  align?: "left" | "right" | "center";
  /** Header click: first click sorts by `first`, a second click by `second`. */
  sort?: { first: string; second: string };
  /** One line for the column picker. */
  hint: string;
};

export const CUSTOMER_COLUMN_GROUP_LABELS: Record<CustomerColumnGroup, string> = {
  identity: "Who",
  contact: "Contact",
  medical: "Medical",
  loyalty: "Loyalty & groups",
  money: "Spend",
  history: "Visits & dates",
  record: "Record",
};

export const CUSTOMER_COLUMNS: readonly CustomerColumn[] = [
  { key: "name", label: "Name", group: "identity", defaultVisible: true, locked: true, sort: { first: "name", second: "name_desc" }, hint: "First and last name; opens the profile." },
  { key: "customer_id", label: "Customer ID", group: "identity", defaultVisible: true, hint: "The old POS (Cultivera) Customer ID." },
  { key: "birthdate", label: "Birthday / age", group: "identity", defaultVisible: true, sort: { first: "birthdate_oldest", second: "birthdate_youngest" }, hint: "Date of birth and age today." },
  { key: "phone", label: "Phone", group: "contact", defaultVisible: true, sort: { first: "phone", second: "phone_desc" }, hint: "Mobile phone; tap to call." },
  { key: "email", label: "Email", group: "contact", defaultVisible: true, sort: { first: "email", second: "email_desc" }, hint: "Email address; tap to write." },
  { key: "contact_prefs", label: "Marketing", group: "contact", defaultVisible: true, hint: "Marketing consent and do-not-contact." },
  { key: "medical", label: "Medical", group: "medical", defaultVisible: true, align: "center", hint: "Medical patient and recognition card status." },
  { key: "tax", label: "Tax designation", group: "medical", defaultVisible: true, hint: "Old POS tax designation (e.g. Veteran)." },
  { key: "loyalty", label: "Loyalty", group: "loyalty", defaultVisible: true, align: "right", hint: "Points balance and tier." },
  { key: "segment", label: "Group", group: "loyalty", defaultVisible: true, hint: "Customer group from purchase history." },
  { key: "visits", label: "Visits", group: "history", defaultVisible: true, align: "right", sort: { first: "visits_high", second: "visits_low" }, hint: "Completed visits at Greenway." },
  { key: "total_spent", label: "Total spent", group: "money", defaultVisible: true, align: "right", hint: "Greenway + old POS together." },
  { key: "greenway_spent", label: "Spent here", group: "money", defaultVisible: false, align: "right", sort: { first: "spend_high", second: "spend_low" }, hint: "Spend on this system only." },
  { key: "old_pos_spent", label: "Old POS spent", group: "money", defaultVisible: false, align: "right", sort: { first: "old_spend_high", second: "old_spend_low" }, hint: "Total Spent from the old POS import." },
  { key: "first_visit", label: "First visit", group: "history", defaultVisible: false, align: "right", sort: { first: "first_visit_oldest", second: "first_visit_newest" }, hint: "First completed visit here." },
  { key: "last_purchase", label: "Last purchase", group: "history", defaultVisible: true, align: "right", sort: { first: "recent", second: "lapsed" }, hint: "Most recent purchase (here or old POS)." },
  { key: "customer_since", label: "Customer since", group: "history", defaultVisible: true, align: "right", sort: { first: "since_oldest", second: "since_newest" }, hint: "Old POS Date Created, else the day added here." },
  { key: "source", label: "Source", group: "record", defaultVisible: true, hint: "Where the record came from." },
  { key: "note", label: "Staff note", group: "record", defaultVisible: false, hint: "The private staff note (shortened)." },
  { key: "created_at", label: "Added here", group: "record", defaultVisible: false, align: "right", sort: { first: "newest", second: "oldest" }, hint: "When the record was created in this system." },
  { key: "updated_at", label: "Last updated", group: "record", defaultVisible: false, align: "right", sort: { first: "updated", second: "updated_oldest" }, hint: "When the record last changed." },
];

const COLUMN_KEYS = new Set(CUSTOMER_COLUMNS.map((c) => c.key));

/** The columns to render, in registry order. Empty / garbage picks = the defaults. Locked columns always show. */
export function resolveVisibleColumns(raw: string | readonly string[] | undefined | null): CustomerColumn[] {
  const picked = new Set(
    (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [])
      .map((s) => String(s).trim())
      .filter((s) => COLUMN_KEYS.has(s)),
  );
  if (picked.size === 0) return CUSTOMER_COLUMNS.filter((c) => c.defaultVisible || c.locked);
  return CUSTOMER_COLUMNS.filter((c) => c.locked || picked.has(c.key));
}

/** True when the visible set is exactly the default set (so the URL can omit ?col=). */
export function isDefaultColumnSet(cols: readonly CustomerColumn[]): boolean {
  const def = CUSTOMER_COLUMNS.filter((c) => c.defaultVisible || c.locked).map((c) => c.key);
  return def.length === cols.length && def.every((k, i) => cols[i]?.key === k);
}

// ---------------------------------------------------------------------------
// Sorts (the header-sort targets that are not in the base menu)
// ---------------------------------------------------------------------------

/** Every key a header can click to must exist in CUSTOMER_SORTS (self-tested). */
export function headerSortState(col: CustomerColumn, currentSortKey: string): { active: "first" | "second" | null; nextKey: string | null } {
  if (!col.sort) return { active: null, nextKey: null };
  if (currentSortKey === col.sort.first) return { active: "first", nextKey: col.sort.second };
  if (currentSortKey === col.sort.second) return { active: "second", nextKey: col.sort.first };
  return { active: null, nextKey: col.sort.first };
}

// ---------------------------------------------------------------------------
// URL grammar
// ---------------------------------------------------------------------------

export const CUSTOMER_PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_CUSTOMER_PAGE_SIZE = 100;

export type CustomerSourceFilter = "old_pos" | "website" | "register" | "staff";
export const CUSTOMER_SOURCE_OPTIONS: readonly { key: CustomerSourceFilter; label: string; importSource: string | null }[] = [
  { key: "old_pos", label: "Old POS import (Cultivera)", importSource: "cultivera-export" },
  { key: "website", label: "Website loyalty signup", importSource: "loyalty-signup" },
  { key: "register", label: "Register signup", importSource: "register-signup" },
  { key: "staff", label: "Added by staff", importSource: null },
];

export type CustomerTableFilters = {
  isMedical?: boolean;
  marketingConsent?: boolean;
  doNotContact?: boolean;
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasTaxDesignation?: boolean;
  source?: CustomerSourceFilter;
  /** 1..12: birthday in this month. */
  birthdayMonth?: number;
};

export type CustomerTableState = {
  q: string;
  page: number;
  pageSize: number;
  sort: SortOption;
  filters: CustomerTableFilters;
  density: "comfortable" | "compact";
  columns: CustomerColumn[];
};

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseCustomerTableParams(sp: RawParams): CustomerTableState {
  const q = (one(sp.q) ?? "").trim().slice(0, 200);
  const pageN = Number.parseInt(one(sp.page) ?? "", 10);
  const page = Number.isFinite(pageN) && pageN >= 1 ? pageN : 1;
  const sizeN = Number.parseInt(one(sp.size) ?? "", 10);
  const pageSize = (CUSTOMER_PAGE_SIZES as readonly number[]).includes(sizeN) ? sizeN : DEFAULT_CUSTOMER_PAGE_SIZE;
  const sort = resolveSort(one(sp.sort), CUSTOMER_SORTS);
  const src = one(sp.source);
  const source = CUSTOMER_SOURCE_OPTIONS.find((o) => o.key === src)?.key;
  const bm = Number.parseInt(one(sp.bmonth) ?? "", 10);
  const birthdayMonth = Number.isInteger(bm) && bm >= 1 && bm <= 12 && /^\d{1,2}$/.test(one(sp.bmonth) ?? "") ? bm : undefined;
  const filters: CustomerTableFilters = {
    isMedical: parseYesNo(one(sp.medical)),
    marketingConsent: parseYesNo(one(sp.consent)),
    doNotContact: parseYesNo(one(sp.dnc)),
    hasPhone: parseYesNo(one(sp.phone)),
    hasEmail: parseYesNo(one(sp.email)),
    hasTaxDesignation: parseYesNo(one(sp.tax)),
    source,
    birthdayMonth,
  };
  const density = one(sp.density) === "compact" ? "compact" : "comfortable";
  return { q, page, pageSize, sort, filters, density, columns: resolveVisibleColumns(sp.col) };
}

/** How many filters (not search / sort) are on - for the "Clear" link and the badge. */
export function activeFilterCount(f: CustomerTableFilters): number {
  return Object.values(f).filter((v) => v !== undefined).length;
}

const yn = (b: boolean | undefined) => (b === undefined ? undefined : b ? "yes" : "no");

/** The query string (no leading "?") that reproduces a state; defaults are omitted. */
export function customerTableQuery(state: CustomerTableState, override: Partial<{ page: number; sort: string; pageSize: number; density: CustomerTableState["density"] }> = {}): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  const sortKey = override.sort ?? state.sort.key;
  if (sortKey !== CUSTOMER_SORTS[0].key) p.set("sort", sortKey);
  const f = state.filters;
  const pairs: [string, string | undefined][] = [
    ["medical", yn(f.isMedical)],
    ["consent", yn(f.marketingConsent)],
    ["dnc", yn(f.doNotContact)],
    ["phone", yn(f.hasPhone)],
    ["email", yn(f.hasEmail)],
    ["tax", yn(f.hasTaxDesignation)],
    ["source", f.source],
    ["bmonth", f.birthdayMonth ? String(f.birthdayMonth) : undefined],
  ];
  for (const [k, v] of pairs) if (v) p.set(k, v);
  const size = override.pageSize ?? state.pageSize;
  if (size !== DEFAULT_CUSTOMER_PAGE_SIZE) p.set("size", String(size));
  const density = override.density ?? state.density;
  if (density !== "comfortable") p.set("density", density);
  if (!isDefaultColumnSet(state.columns)) p.set("col", state.columns.map((c) => c.key).join(","));
  const page = override.page ?? state.page;
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

export function customerTableHref(state: CustomerTableState, override: Parameters<typeof customerTableQuery>[1] = {}): string {
  const qs = customerTableQuery(state, override);
  return `/admin/customers${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// Filter ops (the store applies these; pure data)
// ---------------------------------------------------------------------------

export type CustomerFilterOp =
  | { op: "eq"; column: string; value: boolean | string }
  | { op: "is_null"; column: string }
  | { op: "not_null"; column: string }
  | { op: "like"; column: string; pattern: string };

export function customerFilterOps(f: CustomerTableFilters): CustomerFilterOp[] {
  const ops: CustomerFilterOp[] = [];
  if (f.isMedical !== undefined) ops.push({ op: "eq", column: "is_medical_patient", value: f.isMedical });
  if (f.marketingConsent !== undefined) ops.push({ op: "eq", column: "marketing_consent", value: f.marketingConsent });
  if (f.doNotContact !== undefined) ops.push({ op: "eq", column: "do_not_contact", value: f.doNotContact });
  if (f.hasPhone !== undefined) ops.push({ op: f.hasPhone ? "not_null" : "is_null", column: "phone_normalized" });
  if (f.hasEmail !== undefined) ops.push({ op: f.hasEmail ? "not_null" : "is_null", column: "email" });
  if (f.hasTaxDesignation !== undefined) ops.push({ op: f.hasTaxDesignation ? "not_null" : "is_null", column: "tax_designations" });
  if (f.source) {
    const src = CUSTOMER_SOURCE_OPTIONS.find((o) => o.key === f.source);
    if (src) ops.push(src.importSource === null ? { op: "is_null", column: "import_source" } : { op: "eq", column: "import_source", value: src.importSource });
  }
  if (f.birthdayMonth) ops.push({ op: "like", column: "birthdate", pattern: `____-${String(f.birthdayMonth).padStart(2, "0")}-%` });
  return ops;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** (360) 555-0123 for a US number; anything else is shown as typed. */
export function formatPhone(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return s;
}

/** E.164-ish dial string for a tel: link (US numbers get +1). Null when there is nothing to dial. */
export function telHref(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) d = `1${d}`;
  if (d.length < 7) return null;
  return `tel:+${d}`;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole years on `todayYmd` (Pacific yyyy-mm-dd), or null for a missing / malformed / future birthday. */
export function ageOnDay(birthdate: string | null | undefined, todayYmd: string): number | null {
  const b = ISO_DAY.exec((birthdate ?? "").trim());
  const t = ISO_DAY.exec(todayYmd);
  if (!b || !t) return null;
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  if (bm < 1 || bm > 12 || bd < 1 || bd > 31) return null;
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

/** "Mar 4, 1990" from yyyy-mm-dd without any time-zone shift (a birthday is a calendar label). */
export function formatCalendarDay(ymd: string | null | undefined): string | null {
  const m = ISO_DAY.exec((ymd ?? "").trim());
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${months[mo - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Is the birthday within the next `days` days (today counts)? */
export function birthdaySoon(birthdate: string | null | undefined, todayYmd: string, days = 7): boolean {
  const b = ISO_DAY.exec((birthdate ?? "").trim());
  const t = ISO_DAY.exec(todayYmd);
  if (!b || !t) return false;
  const ty = Number(t[1]);
  const today = Date.UTC(ty, Number(t[2]) - 1, Number(t[3]));
  for (const y of [ty, ty + 1]) {
    const bday = Date.UTC(y, Number(b[2]) - 1, Number(b[3]));
    const diff = Math.round((bday - today) / 86_400_000);
    if (diff >= 0 && diff <= days) return true;
  }
  return false;
}

export type AuthorizationRow = { customer_id: string; status: string | null; expires_on: string | null };
export type AuthorizationStatus = {
  state: "active" | "expiring" | "expired" | "revoked" | "none";
  expiresOn: string | null;
  daysLeft: number | null;
};

/**
 * The best card a customer holds on `todayYmd`: an active, unexpired card wins
 * (the one expiring last); "expiring" when it ends within `soonDays`. Status
 * "active" past its expires_on counts as expired (the nightly job may not have
 * flipped it yet).
 */
export function authorizationStatusFor(rows: readonly AuthorizationRow[], todayYmd: string, soonDays = 30): AuthorizationStatus {
  if (rows.length === 0) return { state: "none", expiresOn: null, daysLeft: null };
  const dayMs = (ymd: string) => {
    const m = ISO_DAY.exec(ymd);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  const today = dayMs(todayYmd);
  let best: AuthorizationStatus | null = null;
  let lastExpired: AuthorizationStatus | null = null;
  let revoked = false;
  for (const r of rows) {
    const status = (r.status ?? "").toLowerCase();
    if (status === "revoked") {
      revoked = true;
      continue;
    }
    const exp = r.expires_on && ISO_DAY.test(r.expires_on) ? r.expires_on : null;
    const daysLeft = exp ? Math.round((dayMs(exp) - today) / 86_400_000) : null;
    const live = status === "active" && (daysLeft === null || daysLeft >= 0);
    if (live) {
      const cand: AuthorizationStatus = { state: daysLeft !== null && daysLeft <= soonDays ? "expiring" : "active", expiresOn: exp, daysLeft };
      // No expiry beats any expiry; otherwise the later expiry wins.
      if (!best || (best.daysLeft !== null && (cand.daysLeft === null || cand.daysLeft > best.daysLeft))) best = cand;
    } else if (!lastExpired || (exp && (!lastExpired.expiresOn || exp > lastExpired.expiresOn))) {
      lastExpired = { state: "expired", expiresOn: exp, daysLeft };
    }
  }
  if (best) return best;
  if (lastExpired) return lastExpired;
  return revoked ? { state: "revoked", expiresOn: null, daysLeft: null } : { state: "none", expiresOn: null, daysLeft: null };
}

export function authorizationLabel(a: AuthorizationStatus): string {
  switch (a.state) {
    case "active":
      return a.expiresOn ? `Card valid to ${formatCalendarDay(a.expiresOn)}` : "Card valid";
    case "expiring":
      return `Card expires in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`;
    case "expired":
      return a.expiresOn ? `Card expired ${formatCalendarDay(a.expiresOn)}` : "Card expired";
    case "revoked":
      return "Card revoked";
    default:
      return "No card on file";
  }
}

/** Where a record came from, in plain English. */
export function customerSourceLabel(importSource: string | null | undefined): string {
  const s = (importSource ?? "").trim();
  if (!s) return "Added by staff";
  const known = CUSTOMER_SOURCE_OPTIONS.find((o) => o.importSource === s);
  if (known) return known.key === "old_pos" ? "Old POS import" : known.label;
  return s;
}

/** Shorten a note for a table cell (full text goes in the title attribute). */
export function shortNote(note: string | null | undefined, max = 60): string | null {
  const s = (note ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
}

// ---------------------------------------------------------------------------
// Export (CSV / Excel)
// ---------------------------------------------------------------------------

/** Bulk download of customer PII: managers and up only (staff can view the table, not take it home). */
export function canExportCustomers(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/** Hard cap on one download (a bigger file means the filters are wrong). */
export const CUSTOMER_EXPORT_CAP = 50_000;

export type CustomerExportColumn = { key: string; header: string; type: "text" | "integer" | "currency" };
export const CUSTOMER_EXPORT_COLUMNS: readonly CustomerExportColumn[] = [
  { key: "first_name", header: "First name", type: "text" },
  { key: "last_name", header: "Last name", type: "text" },
  { key: "customer_id", header: "Customer ID (old POS)", type: "text" },
  { key: "phone", header: "Phone", type: "text" },
  { key: "email", header: "Email", type: "text" },
  { key: "birthdate", header: "Birthday", type: "text" },
  { key: "age", header: "Age", type: "integer" },
  { key: "marketing_consent", header: "Marketing consent", type: "text" },
  { key: "do_not_contact", header: "Do not contact", type: "text" },
  { key: "medical", header: "Medical patient", type: "text" },
  { key: "card_status", header: "Recognition card", type: "text" },
  { key: "card_expires", header: "Card expires", type: "text" },
  { key: "tax_designations", header: "Tax designation", type: "text" },
  { key: "loyalty_points", header: "Loyalty points", type: "integer" },
  { key: "loyalty_lifetime", header: "Lifetime points", type: "integer" },
  { key: "loyalty_tier", header: "Tier", type: "text" },
  { key: "segment", header: "Group", type: "text" },
  { key: "visits", header: "Visits", type: "integer" },
  { key: "total_spent", header: "Total spent", type: "currency" },
  { key: "spent_here", header: "Spent here", type: "currency" },
  { key: "old_pos_spent", header: "Old POS spent", type: "currency" },
  { key: "first_visit", header: "First visit", type: "text" },
  { key: "last_purchase", header: "Last purchase", type: "text" },
  { key: "last_purchase_source", header: "Last purchase at", type: "text" },
  { key: "customer_since", header: "Customer since", type: "text" },
  { key: "source", header: "Source", type: "text" },
  { key: "staff_note", header: "Staff note", type: "text" },
  { key: "created_at", header: "Added here", type: "text" },
  { key: "updated_at", header: "Last updated", type: "text" },
  { key: "id", header: "Record ID", type: "text" },
];

export type CustomerRowFacts = {
  customer: {
    id: string;
    first_name: string;
    last_name: string | null;
    external_id?: string | null;
    phone: string | null;
    email: string | null;
    birthdate: string | null;
    marketing_consent: boolean;
    do_not_contact: boolean;
    is_medical_patient: boolean;
    tax_designations?: string | null;
    import_source?: string | null;
    staff_note: string | null;
    imported_created_at?: string | null;
    created_at: string;
    updated_at: string;
  };
  figures: { visits: number; totalSpendMinor: number; liveSpendMinor: number; oldPosSpendMinor: number; lastPurchaseAt: string | null; lastPurchaseSource: "greenway" | "old_pos" | null; firstVisitAt: string | null };
  loyalty: { balancePoints: number; lifetimePoints: number; tierName: string | null } | null;
  authorization: AuthorizationStatus;
  segmentLabel: string | null;
};

/** Pacific calendar day (yyyy-mm-dd) of an instant, or "" when missing. */
export function pacificYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function customerExportRow(f: CustomerRowFacts, todayYmd: string): Record<string, string | number | null> {
  const c = f.customer;
  const age = ageOnDay(c.birthdate, todayYmd);
  return {
    first_name: c.first_name,
    last_name: c.last_name ?? "",
    customer_id: c.external_id ?? "",
    phone: formatPhone(c.phone) ?? "",
    email: c.email ?? "",
    birthdate: c.birthdate ?? "",
    age: age,
    marketing_consent: c.marketing_consent ? "yes" : "no",
    do_not_contact: c.do_not_contact ? "yes" : "no",
    medical: c.is_medical_patient ? "yes" : "no",
    card_status: f.authorization.state === "none" ? "" : f.authorization.state,
    card_expires: f.authorization.expiresOn ?? "",
    tax_designations: c.tax_designations ?? "",
    loyalty_points: f.loyalty ? f.loyalty.balancePoints : null,
    loyalty_lifetime: f.loyalty ? f.loyalty.lifetimePoints : null,
    loyalty_tier: f.loyalty?.tierName ?? "",
    segment: f.segmentLabel ?? "",
    visits: f.figures.visits,
    total_spent: f.figures.totalSpendMinor,
    spent_here: f.figures.liveSpendMinor,
    old_pos_spent: f.figures.oldPosSpendMinor,
    first_visit: pacificYmd(f.figures.firstVisitAt),
    last_purchase: pacificYmd(f.figures.lastPurchaseAt),
    last_purchase_source: f.figures.lastPurchaseSource === "old_pos" ? "Old POS" : f.figures.lastPurchaseSource === "greenway" ? "Greenway" : "",
    customer_since: pacificYmd(c.imported_created_at ?? c.created_at),
    source: customerSourceLabel(c.import_source),
    staff_note: (c.staff_note ?? "").replace(/\s+/g, " ").trim(),
    created_at: pacificYmd(c.created_at),
    updated_at: pacificYmd(c.updated_at),
    id: c.id,
  };
}

/** The audit entry for a download: the filters and the row count, never a name, phone or email. */
export function customerExportAudit(state: CustomerTableState, rows: number, format: string): Record<string, unknown> {
  return {
    format,
    rows,
    searched: state.q.length > 0,
    sort: state.sort.key,
    filters: Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v !== undefined)),
  };
}

// ---------------------------------------------------------------------------
// Figures (visits / spend / dates) - one rule for the table and the download
// ---------------------------------------------------------------------------

export type TableRollup = { visits: number; netSpendMinor: number; lastVisitAt: string | null; firstVisitAt: string | null };
export type TableFigures = CustomerRowFacts["figures"];

/**
 * Slice 3 / G-75 rule, shared: the population rollup (live columns after 0232,
 * computed from orders before) wins; in computed mode a customer with no
 * rollup has no Greenway visits yet; otherwise the row's own columns. Old POS
 * spend and last purchase are added by customerFigures.
 */
export function tableFigures(
  c: { visit_count: number; lifetime_spend_minor_units: number; last_visit_at: string | null; first_visit_at?: string | null; imported_spend_minor_units?: number | null; last_purchase_at?: string | null },
  rollup: TableRollup | undefined,
  computedMode: boolean,
): TableFigures {
  const live = rollup
    ? { visits: rollup.visits, spendMinor: rollup.netSpendMinor, lastVisitAt: rollup.lastVisitAt, firstVisitAt: rollup.firstVisitAt }
    : computedMode
      ? { visits: 0, spendMinor: 0, lastVisitAt: null, firstVisitAt: null }
      : { visits: c.visit_count, spendMinor: c.lifetime_spend_minor_units, lastVisitAt: c.last_visit_at, firstVisitAt: c.first_visit_at ?? null };
  const f = customerFigures(c, { spendMinor: live.spendMinor, lastVisitAt: live.lastVisitAt });
  return { visits: live.visits, firstVisitAt: live.firstVisitAt, ...f };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCustomerTableCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      failures.push(name);
    }
  };
  const eq = (a: unknown, b: unknown, name: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${name}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

  // Column registry
  const keys = CUSTOMER_COLUMNS.map((c) => c.key);
  eq(new Set(keys).size, keys.length, "column keys unique");
  ok(CUSTOMER_COLUMNS.filter((c) => c.locked).length === 1 && CUSTOMER_COLUMNS[0].key === "name", "name is the one locked first column");
  ok(keys.includes("phone") && keys.includes("email") && !keys.includes("contact"), "phone and email are separate columns (owner)");
  ok(CUSTOMER_COLUMNS.find((c) => c.key === "phone")!.defaultVisible && CUSTOMER_COLUMNS.find((c) => c.key === "email")!.defaultVisible, "phone and email show by default");
  const sortKeys = new Set(CUSTOMER_SORTS.map((s) => s.key));
  for (const c of CUSTOMER_COLUMNS) {
    if (c.sort) {
      ok(sortKeys.has(c.sort.first), `${c.key} first sort exists`);
      ok(sortKeys.has(c.sort.second), `${c.key} second sort exists`);
      ok(c.sort.first !== c.sort.second, `${c.key} sorts differ`);
    }
    ok(c.label.length > 0 && c.hint.length > 0, `${c.key} labelled`);
    ok(c.group in CUSTOMER_COLUMN_GROUP_LABELS, `${c.key} group known`);
  }

  // Column picker
  const def = resolveVisibleColumns(undefined);
  ok(def.length > 10 && def.every((c) => c.defaultVisible || c.locked), "defaults when nothing picked");
  ok(isDefaultColumnSet(def), "default set recognised");
  eq(resolveVisibleColumns("garbage,,nope").map((c) => c.key), def.map((c) => c.key), "garbage picks = defaults");
  eq(resolveVisibleColumns("email,phone").map((c) => c.key), ["name", "phone", "email"], "picked in registry order + locked name");
  eq(resolveVisibleColumns(["note", "updated_at"]).map((c) => c.key), ["name", "note", "updated_at"], "array picks");
  ok(!isDefaultColumnSet(resolveVisibleColumns("email")), "custom set not default");

  // Header sort
  const nameCol = CUSTOMER_COLUMNS[0];
  eq(headerSortState(nameCol, "recent"), { active: null, nextKey: "name" }, "inactive header -> first");
  eq(headerSortState(nameCol, "name"), { active: "first", nextKey: "name_desc" }, "first -> second");
  eq(headerSortState(nameCol, "name_desc"), { active: "second", nextKey: "name" }, "second -> first");
  eq(headerSortState(CUSTOMER_COLUMNS.find((c) => c.key === "loyalty")!, "name"), { active: null, nextKey: null }, "unsortable header");

  // URL grammar
  const s0 = parseCustomerTableParams({});
  eq([s0.q, s0.page, s0.pageSize, s0.sort.key, s0.density, activeFilterCount(s0.filters)], ["", 1, 100, "recent", "comfortable", 0], "empty params = defaults");
  eq(customerTableQuery(s0), "", "default state has an empty query");
  const s1 = parseCustomerTableParams({ q: "  bill  ", page: "3", size: "250", sort: "email", medical: "yes", consent: "no", dnc: "yes", phone: "yes", email: "no", tax: "yes", source: "old_pos", bmonth: "7", density: "compact", col: "email,phone" });
  eq([s1.q, s1.page, s1.pageSize, s1.sort.key, s1.density], ["bill", 3, 250, "email", "compact"], "full params parsed");
  eq(s1.filters, { isMedical: true, marketingConsent: false, doNotContact: true, hasPhone: true, hasEmail: false, hasTaxDesignation: true, source: "old_pos", birthdayMonth: 7 }, "filters parsed");
  eq(activeFilterCount(s1.filters), 8, "eight filters on");
  const round = parseCustomerTableParams(Object.fromEntries(new URLSearchParams(customerTableQuery(s1))));
  eq(customerTableQuery(round), customerTableQuery(s1), "query round-trips");
  ok(customerTableQuery(s1, { page: 1 }).indexOf("page=") === -1, "page 1 omitted");
  ok(customerTableQuery(s1, { sort: "recent" }).indexOf("sort=") === -1, "default sort omitted");
  ok(customerTableHref(s0, { page: 2 }) === "/admin/customers?page=2", "href with page");
  const bad = parseCustomerTableParams({ page: "-4", size: "99999", sort: "__proto__", medical: "maybe", source: "evil", bmonth: "13", density: "huge" });
  eq([bad.page, bad.pageSize, bad.sort.key, bad.filters.isMedical, bad.filters.source, bad.filters.birthdayMonth, bad.density], [1, 100, "recent", undefined, undefined, undefined, "comfortable"], "garbage params fall back");
  eq(parseCustomerTableParams({ bmonth: "1.5" }).filters.birthdayMonth, undefined, "fractional month rejected");
  eq(parseCustomerTableParams({ q: ["a", "b"] }).q, "a", "repeated q takes the first");
  eq(parseCustomerTableParams({ q: "x".repeat(500) }).q.length, 200, "search capped");

  // Filter ops
  eq(customerFilterOps({}), [], "no filters -> no ops");
  eq(customerFilterOps(s1.filters), [
    { op: "eq", column: "is_medical_patient", value: true },
    { op: "eq", column: "marketing_consent", value: false },
    { op: "eq", column: "do_not_contact", value: true },
    { op: "not_null", column: "phone_normalized" },
    { op: "is_null", column: "email" },
    { op: "not_null", column: "tax_designations" },
    { op: "eq", column: "import_source", value: "cultivera-export" },
    { op: "like", column: "birthdate", pattern: "____-07-%" },
  ], "all ops");
  eq(customerFilterOps({ source: "staff" }), [{ op: "is_null", column: "import_source" }], "staff = no import source");
  eq(customerFilterOps({ source: "register" }), [{ op: "eq", column: "import_source", value: "register-signup" }], "register source");
  eq(customerFilterOps({ birthdayMonth: 12 }), [{ op: "like", column: "birthdate", pattern: "____-12-%" }], "december pattern");

  // Phone
  eq(formatPhone("3605550123"), "(360) 555-0123", "10 digits");
  eq(formatPhone("+1 360.555.0123"), "(360) 555-0123", "11 digits with 1");
  eq(formatPhone("555-0123"), "555-0123", "short shown as typed");
  eq(formatPhone("  "), null, "blank phone");
  eq(telHref("(360) 555-0123"), "tel:+13605550123", "tel href");
  eq(telHref("12"), null, "no tel for junk");

  // Age / birthday
  eq(ageOnDay("2000-11-02", "2026-11-01"), 25, "day before birthday");
  eq(ageOnDay("2000-11-01", "2026-11-01"), 26, "on birthday");
  eq(ageOnDay("2004-02-29", "2025-02-28"), 20, "leap birthday not yet");
  eq(ageOnDay("1990/01/01", "2026-01-01"), null, "malformed");
  eq(ageOnDay("2030-01-01", "2026-01-01"), null, "future");
  eq(ageOnDay(null, "2026-01-01"), null, "missing");
  eq(formatCalendarDay("1990-03-04"), "Mar 4, 1990", "calendar label no tz shift");
  eq(formatCalendarDay("1990-13-04"), null, "bad month label");
  ok(birthdaySoon("1990-11-03", "2026-11-01"), "birthday in 2 days");
  ok(birthdaySoon("1990-11-01", "2026-11-01"), "birthday today");
  ok(!birthdaySoon("1990-10-31", "2026-11-01"), "birthday yesterday not soon");
  ok(birthdaySoon("1990-01-02", "2026-12-30"), "birthday across new year");

  // Authorization status
  const T = "2026-06-01";
  eq(authorizationStatusFor([], T).state, "none", "no cards");
  eq(authorizationStatusFor([{ customer_id: "a", status: "active", expires_on: "2027-01-01" }], T).state, "active", "active");
  eq(authorizationStatusFor([{ customer_id: "a", status: "active", expires_on: "2026-06-11" }], T), { state: "expiring", expiresOn: "2026-06-11", daysLeft: 10 }, "expiring in 10");
  eq(authorizationStatusFor([{ customer_id: "a", status: "active", expires_on: "2026-05-31" }], T).state, "expired", "active past expiry is expired");
  eq(authorizationStatusFor([{ customer_id: "a", status: "revoked", expires_on: "2027-01-01" }], T).state, "revoked", "revoked");
  eq(authorizationStatusFor([{ customer_id: "a", status: "expired", expires_on: "2025-01-01" }, { customer_id: "a", status: "active", expires_on: "2026-12-01" }], T).expiresOn, "2026-12-01", "valid card beats old one");
  eq(authorizationStatusFor([{ customer_id: "a", status: "active", expires_on: "2026-07-01" }, { customer_id: "a", status: "active", expires_on: "2027-07-01" }], T).expiresOn, "2027-07-01", "latest expiry wins");
  eq(authorizationStatusFor([{ customer_id: "a", status: "active", expires_on: null }, { customer_id: "a", status: "active", expires_on: "2027-07-01" }], T).expiresOn, null, "no-expiry card wins");
  eq(authorizationStatusFor([{ customer_id: "a", status: "expired", expires_on: "2024-01-01" }, { customer_id: "a", status: "expired", expires_on: "2025-01-01" }], T).expiresOn, "2025-01-01", "latest expired shown");
  ok(authorizationLabel({ state: "expiring", expiresOn: "2026-06-02", daysLeft: 1 }) === "Card expires in 1 day", "singular day");
  ok(authorizationLabel({ state: "active", expiresOn: "2027-01-01", daysLeft: 200 }).includes("Jan 1, 2027"), "active label");
  ok(authorizationLabel({ state: "none", expiresOn: null, daysLeft: null }) === "No card on file", "none label");

  // Source / note
  eq(customerSourceLabel("cultivera-export"), "Old POS import", "cultivera");
  eq(customerSourceLabel("loyalty-signup"), "Website loyalty signup", "website");
  eq(customerSourceLabel("register-signup"), "Register signup", "register");
  eq(customerSourceLabel(null), "Added by staff", "staff");
  eq(customerSourceLabel("something-new"), "something-new", "unknown shown raw");
  eq(shortNote("  a\n b  "), "a b", "note collapsed");
  eq(shortNote("x".repeat(80), 10), `${"x".repeat(9)}\u2026`, "note shortened");
  eq(shortNote(""), null, "empty note");

  // Export
  ok(canExportCustomers("owner") && canExportCustomers("admin") && canExportCustomers("manager"), "managers+ export");
  ok(!canExportCustomers("staff") && !canExportCustomers("readonly") && !canExportCustomers(null), "staff cannot bulk export PII");
  const ekeys = CUSTOMER_EXPORT_COLUMNS.map((c) => c.key);
  eq(new Set(ekeys).size, ekeys.length, "export keys unique");
  const facts: CustomerRowFacts = {
    customer: { id: "u1", first_name: "Bill", last_name: "McCoy", external_id: "123", phone: "3605550123", email: "b@x.com", birthdate: "1990-03-04", marketing_consent: true, do_not_contact: false, is_medical_patient: true, tax_designations: "Veteran", import_source: "cultivera-export", staff_note: "likes\nsativa", imported_created_at: "2021-05-01T19:00:00Z", created_at: "2026-10-01T07:30:00Z", updated_at: "2026-10-02T07:30:00Z" },
    figures: { visits: 3, totalSpendMinor: 12345, liveSpendMinor: 2345, oldPosSpendMinor: 10000, lastPurchaseAt: "2026-10-03T06:00:00Z", lastPurchaseSource: "greenway", firstVisitAt: "2026-10-01T18:00:00Z" },
    loyalty: { balancePoints: 120, lifetimePoints: 400, tierName: "Gold" },
    authorization: { state: "active", expiresOn: "2027-01-01", daysLeft: 200 },
    segmentLabel: "Champions",
  };
  const row = customerExportRow(facts, "2026-11-01");
  ok(ekeys.every((k) => k in row), "row has every export column");
  eq([row.phone, row.age, row.total_spent, row.old_pos_spent, row.medical, row.card_status, row.loyalty_tier, row.staff_note], ["(360) 555-0123", 36, 12345, 10000, "yes", "active", "Gold", "likes sativa"], "row values (money stays cents)");
  eq(row.last_purchase, "2026-10-02", "last purchase in Pacific (06:00Z = previous day)");
  eq(row.created_at, "2026-10-01", "created Pacific day");
  eq(row.customer_since, "2021-05-01", "customer since prefers old POS date");
  const noLoyal = customerExportRow({ ...facts, loyalty: null, authorization: { state: "none", expiresOn: null, daysLeft: null } }, "2026-11-01");
  eq([noLoyal.loyalty_points, noLoyal.card_status], [null, ""], "non-member blanks");
  const audit = customerExportAudit(s1, 42, "csv");
  ok(!JSON.stringify(audit).includes("bill"), "audit carries no search text");
  eq([audit.rows, audit.searched, audit.format], [42, true, "csv"], "audit facts");
  eq(pacificYmd("garbage"), "", "bad instant");

  // Figures
  const base = { visit_count: 4, lifetime_spend_minor_units: 5000, last_visit_at: "2026-09-01T00:00:00Z", first_visit_at: "2026-01-01T00:00:00Z", imported_spend_minor_units: 7000, last_purchase_at: "2025-01-01T00:00:00Z" };
  const fLive = tableFigures(base, undefined, false);
  eq([fLive.visits, fLive.liveSpendMinor, fLive.oldPosSpendMinor, fLive.totalSpendMinor, fLive.lastPurchaseSource, fLive.firstVisitAt], [4, 5000, 7000, 12000, "greenway", "2026-01-01T00:00:00Z"], "live columns");
  const fRoll = tableFigures(base, { visits: 9, netSpendMinor: 100, lastVisitAt: null, firstVisitAt: null }, false);
  eq([fRoll.visits, fRoll.liveSpendMinor, fRoll.lastPurchaseSource, fRoll.lastPurchaseAt], [9, 100, "old_pos", "2025-01-01T00:00:00Z"], "rollup wins; old POS last purchase");
  const fComp = tableFigures(base, undefined, true);
  eq([fComp.visits, fComp.liveSpendMinor, fComp.totalSpendMinor, fComp.firstVisitAt], [0, 0, 7000, null], "computed mode with no rollup");

  if (failed > 0) throw new Error(`customer-table-core self-tests failed:\n  ${failures.join("\n  ")}`);
  return { passed, failed };
}
