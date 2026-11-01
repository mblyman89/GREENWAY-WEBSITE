/**
 * G-73 (owner message 15): drag-and-drop customer import from the Cultivera
 * export.
 *
 * Owner (verbatim): "I also need you to help me extract the data from this
 * customers csv file taken from cultivera to upload to our new system. the
 * upload process in place currently does not work, and I would much rather
 * just drag and drop the file in then paste the spreadsheet into the box."
 *
 * PURE. No server-only, no database, no clock: the browser reads the dropped
 * .xlsx or .csv into a grid, this module turns the grid into clean customer
 * rows plus a plain-English report, and the server action plans each batch of
 * writes with `planImportBatch` against the rows it found in the database.
 *
 * What the real export (82BB4F, 2026-11-01, 16,586 rows) taught us, each rule
 * with the row shape that forced it:
 *
 *  1. Rows repeat. 1,437 Customer IDs appear twice, identically. One customer
 *     per Customer ID; the last copy wins.
 *  2. Phones are often fragments ("(575) 7-", "(420) -"). A phone is kept
 *     only when it has 10 digits (or 11 starting with 1); otherwise it is
 *     dropped and counted, never stored as a fake number.
 *  3. Emails without "@" ("jmike6192004gmail.com") are dropped and counted.
 *  4. Birthdays have placeholders. 414 customers share 1999-11-11 and 28 share
 *     1900-01-02. A birthday shared by PLACEHOLDER_DOB_MIN customers or more
 *     in one file, before 1910, or making the person under 18 today is not a
 *     birthday; it is dropped and counted (standing rule 3: never invent).
 *  5. Excel dates are serial numbers with no time zone. Purchase times in this
 *     export fall between 15:00 and 07:00, i.e. store hours in UTC, so serials
 *     are read as UTC. Birthdays are whole days and keep their calendar date.
 *  6. A row with no letter in either name and no usable phone or email is not
 *     a customer (17 blank rows, plus two "medical" rows named '' and '"').
 *  7. Matching an existing customer: by Customer ID first. A phone or email
 *     match only claims a customer that has NO Customer ID yet (one made in
 *     our system, e.g. a loyalty signup). Two Cultivera customers who share a
 *     phone (65 phones in this file) stay two customers.
 *  8. Updating never blanks what we already have: an empty cell keeps the
 *     stored value, a medical flag is never removed, the last purchase is the
 *     later of the two. Old-POS spend goes to imported_spend_minor_units only
 *     (0232: lifetime_spend_minor_units is live and never written here).
 *  9. Owner message 17 (G-75): every column with real data is kept. "Date
 *     Created" (when Cultivera added the customer, read as UTC like the other
 *     timestamps) goes to imported_created_at and "Tax Designations" (e.g.
 *     "Veteran") to tax_designations (both 0335). The other columns in the
 *     November 2026 file are empty for every row (licence, address, city,
 *     zip, groups) or the same for every row (Active = Y, the N flags).
 */

/** A birthday shared by this many customers in one file is a placeholder. */
export const PLACEHOLDER_DOB_MIN = 10;
/** Rows sent to the server per request. Keeps each request small and fast. */
export const IMPORT_BATCH_SIZE = 400;
export const IMPORT_SOURCE = "cultivera-export";

export type Cell = string | number | boolean | Date | null | undefined;
export type Grid = Cell[][];

export type CustomerImportRow = {
  external_id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  email_normalized: string | null;
  birthdate: string | null;
  is_medical_patient: boolean;
  imported_spend_minor_units: number;
  state: string | null;
  city: string | null;
  zip: string | null;
  last_purchase_at: string | null;
  /** 0335: Cultivera "Date Created". */
  imported_created_at: string | null;
  /** 0335: Cultivera "Tax Designations", e.g. "Veteran". */
  tax_designations: string | null;
};

export type ImportReport = {
  rowsInFile: number;
  duplicateRows: number;
  customers: number;
  skippedNoIdentity: number;
  skippedNoCustomerId: number;
  skippedIds: string[];
  phonesDropped: number;
  emailsDropped: number;
  dobPlaceholders: number;
  dobImplausible: number;
  withPhone: number;
  withEmail: number;
  withBirthday: number;
  medical: number;
  veterans: number;
  withSpend: number;
  withLastPurchase: number;
  withCreatedDate: number;
  missingColumns: string[];
};

export type MappedImport = { rows: CustomerImportRow[]; report: ImportReport; error: string | null };

// ── cells ────────────────────────────────────────────────────────────────

export function cellText(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v).trim();
}

export function normalizeHeader(h: Cell): string {
  return cellText(h).toLowerCase().replace(/\s+/g, " ").trim();
}

/** 10-digit US phone (11 digits with a leading 1 is accepted). Else null. */
export function cleanPhone(raw: string): { phone: string | null; normalized: string | null } {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return { phone: null, normalized: null };
  return { phone: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, normalized: ten };
}

export function cleanEmail(raw: string): { email: string | null; normalized: string | null } {
  const t = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { email: null, normalized: null };
  return { email: t, normalized: t.toLowerCase() };
}

export function moneyToMinor(v: Cell): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Excel serial day number to a UTC instant (Excel stores no zone). */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * 86400000));
}

/** "8/30/2024 2:36:31 PM", "8/30/2024", "2024-08-30", "2024-08-30T…Z", serial or Date, read as UTC. */
export function cellToDate(v: Cell): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return excelSerialToDate(v);
  const s = String(v).trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?)?$/i.exec(s);
  if (us) {
    let hh = us[4] ? Number(us[4]) : 0;
    const ap = us[7]?.toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    const d = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), hh, us[5] ? Number(us[5]) : 0, us[6] ? Number(us[6]) : 0));
    return d.getUTCMonth() === Number(us[1]) - 1 ? d : null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) {
    if (iso[8]) {
      const d = new Date(s.replace(" ", "T"));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const ms = iso[7] ? Math.round(Number(`0.${iso[7]}`) * 1000) : 0;
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), iso[4] ? Number(iso[4]) : 0, iso[5] ? Number(iso[5]) : 0, iso[6] ? Number(iso[6]) : 0, ms));
    return d.getUTCMonth() === Number(iso[2]) - 1 ? d : null;
  }
  return null;
}

export function cellToDay(v: Cell): string | null {
  const d = cellToDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Whole years between a yyyy-mm-dd birthday and a yyyy-mm-dd day. */
export function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// ── CSV (for a .csv drop) ────────────────────────────────────────────────

/** RFC-4180 CSV: quoted fields, escaped quotes, embedded newlines, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── sheet → rows ─────────────────────────────────────────────────────────

const REQUIRED = ["customer id", "first name", "last name"] as const;

function emptyReport(rowsInFile: number, missing: string[]): ImportReport {
  return {
    rowsInFile, duplicateRows: 0, customers: 0, skippedNoIdentity: 0, skippedNoCustomerId: 0, skippedIds: [],
    phonesDropped: 0, emailsDropped: 0, dobPlaceholders: 0, dobImplausible: 0,
    withPhone: 0, withEmail: 0, withBirthday: 0, medical: 0, veterans: 0, withSpend: 0, withLastPurchase: 0, withCreatedDate: 0, missingColumns: missing,
  };
}

/**
 * Turn the first sheet of the Cultivera export (header row first) into clean
 * customer rows. `today` is the Pacific business day, yyyy-mm-dd (rule 9).
 */
export function mapCustomerGrid(grid: Grid, today: string): MappedImport {
  const nonEmpty = grid.filter((r) => Array.isArray(r) && r.some((c) => cellText(c) !== ""));
  if (nonEmpty.length === 0) {
    return { rows: [], report: emptyReport(0, []), error: "The file is empty." };
  }
  const header = nonEmpty[0].map(normalizeHeader);
  const missing = REQUIRED.filter((h) => !header.includes(h));
  const data = nonEmpty.slice(1);
  if (missing.length > 0) {
    return {
      rows: [],
      report: emptyReport(data.length, [...missing]),
      error: `This does not look like the Cultivera customer export. It has no ${missing.map((m) => `"${m.replace(/\b\w/g, (x) => x.toUpperCase())}"`).join(", ")} column. Export Customers from Cultivera and drop that file.`,
    };
  }
  const at = (name: string) => header.indexOf(name);
  const c = {
    id: at("customer id"), first: at("first name"), last: at("last name"), phone: at("phone number"),
    spent: at("total spent"), dob: at("date of birth"), med: at("is medical"), state: at("state"),
    city: at("city"), zip: at("zip"), email: at("email"), tax: at("tax designations"), lastBuy: at("last purchase date"),
    created: at("date created"),
  };
  const get = (r: Cell[], i: number): Cell => (i >= 0 && i < r.length ? r[i] : null);
  const txt = (r: Cell[], i: number) => cellText(get(r, i));

  const report = emptyReport(data.length, []);
  const byId = new Map<string, Cell[]>();
  for (const r of data) {
    const id = txt(r, c.id).replace(/\.0+$/, "");
    if (!id) {
      report.skippedNoCustomerId++;
      continue;
    }
    if (byId.has(id)) report.duplicateRows++;
    byId.set(id, r);
  }

  // Rule 4: a birthday many customers share is a placeholder.
  const dobCount = new Map<string, number>();
  for (const r of byId.values()) {
    const d = cellToDay(get(r, c.dob));
    if (d) dobCount.set(d, (dobCount.get(d) ?? 0) + 1);
  }

  const rows: CustomerImportRow[] = [];
  for (const [id, r] of byId) {
    const first = txt(r, c.first);
    const last = txt(r, c.last);
    const rawPhone = txt(r, c.phone);
    const rawEmail = txt(r, c.email);
    const p = cleanPhone(rawPhone);
    const e = cleanEmail(rawEmail);
    const named = /\p{L}/u.test(first) || /\p{L}/u.test(last);
    if (!named && !p.normalized && !e.normalized) {
      report.skippedNoIdentity++;
      report.skippedIds.push(id);
      continue;
    }
    if (rawPhone && !p.phone) report.phonesDropped++;
    if (rawEmail && !e.email) report.emailsDropped++;

    let birthdate = cellToDay(get(r, c.dob));
    if (birthdate) {
      if ((dobCount.get(birthdate) ?? 0) >= PLACEHOLDER_DOB_MIN) {
        report.dobPlaceholders++;
        birthdate = null;
      } else if (Number(birthdate.slice(0, 4)) < 1910 || ageOn(birthdate, today) < 18) {
        report.dobImplausible++;
        birthdate = null;
      }
    }
    const lastBuy = cellToDate(get(r, c.lastBuy));
    const createdAt = cellToDate(get(r, c.created));
    const medical = txt(r, c.med).toUpperCase() === "Y";
    const tax = txt(r, c.tax).replace(/\s+/g, " ").slice(0, 200);
    if (/veteran/i.test(tax)) report.veterans++;

    const row: CustomerImportRow = {
      external_id: id,
      first_name: /\p{L}/u.test(first) ? first : "(unknown)",
      last_name: /\p{L}/u.test(last) ? last : null,
      phone: p.phone,
      phone_normalized: p.normalized,
      email: e.email,
      email_normalized: e.normalized,
      birthdate,
      is_medical_patient: medical,
      imported_spend_minor_units: moneyToMinor(get(r, c.spent) as Cell),
      state: txt(r, c.state).toUpperCase() || null,
      city: txt(r, c.city) || null,
      zip: txt(r, c.zip) || null,
      last_purchase_at: lastBuy ? lastBuy.toISOString() : null,
      imported_created_at: createdAt ? createdAt.toISOString() : null,
      tax_designations: tax || null,
    };
    if (row.phone) report.withPhone++;
    if (row.imported_spend_minor_units > 0) report.withSpend++;
    if (row.last_purchase_at) report.withLastPurchase++;
    if (row.imported_created_at) report.withCreatedDate++;
    if (row.email) report.withEmail++;
    if (row.birthdate) report.withBirthday++;
    if (row.is_medical_patient) report.medical++;
    rows.push(row);
  }
  report.customers = rows.length;
  return { rows, report, error: null };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── the server's half: validate, match, merge ────────────────────────────

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;

/** Re-check a row that came from the browser. Null when it is not usable. */
export function sanitizeImportRow(x: unknown): CustomerImportRow | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const external_id = str(o.external_id, 64);
  const first_name = str(o.first_name, 120);
  if (!external_id || !first_name) return null;
  const p = cleanPhone(typeof o.phone === "string" ? o.phone : "");
  const e = cleanEmail(typeof o.email === "string" ? o.email : "");
  const bd = str(o.birthdate, 10);
  const lp = str(o.last_purchase_at, 40);
  const cr = str(o.imported_created_at, 40);
  const spend = typeof o.imported_spend_minor_units === "number" && Number.isFinite(o.imported_spend_minor_units)
    ? Math.max(0, Math.min(2147483647, Math.round(o.imported_spend_minor_units)))
    : 0;
  return {
    external_id,
    first_name,
    last_name: str(o.last_name, 120),
    phone: p.phone,
    phone_normalized: p.normalized,
    email: e.email,
    email_normalized: e.normalized,
    birthdate: bd && /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : null,
    is_medical_patient: o.is_medical_patient === true,
    imported_spend_minor_units: spend,
    state: str(o.state, 20),
    city: str(o.city, 120),
    zip: str(o.zip, 20),
    last_purchase_at: lp && !Number.isNaN(new Date(lp).getTime()) ? new Date(lp).toISOString() : null,
    imported_created_at: cr && !Number.isNaN(new Date(cr).getTime()) ? new Date(cr).toISOString() : null,
    tax_designations: str(o.tax_designations, 200),
  };
}

export type ExistingCustomer = {
  id: string;
  external_id: string | null;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  email_normalized: string | null;
  birthdate: string | null;
  is_medical_patient: boolean;
  state: string | null;
  city: string | null;
  zip: string | null;
  last_purchase_at: string | null;
  /** 0335; absent when the server read with LEGACY_EXISTING_COLUMNS. */
  imported_created_at?: string | null;
  tax_designations?: string | null;
};

/** Columns the server selects for matching; keep in step with ExistingCustomer. */
export const EXISTING_COLUMNS =
  "id,external_id,first_name,last_name,phone,phone_normalized,email,email_normalized,birthdate,is_medical_patient,state,city,zip,last_purchase_at,imported_created_at,tax_designations";
/** The same without the 0335 columns, for a database where 0335 has not run yet. */
export const LEGACY_EXISTING_COLUMNS =
  "id,external_id,first_name,last_name,phone,phone_normalized,email,email_normalized,birthdate,is_medical_patient,state,city,zip,last_purchase_at";
/** Columns 0335 adds. The writer drops them and retries if the database does not have them yet. */
export const COLUMNS_0335 = ["imported_created_at", "tax_designations"] as const;

export type CustomerWrite = Omit<CustomerImportRow, never> & { import_source: string };
export type BatchPlan = {
  updates: (CustomerWrite & { id: string })[];
  inserts: CustomerWrite[];
};

const later = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : new Date(a).getTime() >= new Date(b).getTime() ? a : b;

/** Rule 8: an empty incoming cell never blanks a stored value. */
export function mergeForUpdate(ex: ExistingCustomer, inc: CustomerImportRow): CustomerWrite & { id: string } {
  const phoneFromInc = inc.phone_normalized != null;
  const emailFromInc = inc.email_normalized != null;
  return {
    id: ex.id,
    external_id: inc.external_id,
    first_name: inc.first_name !== "(unknown)" ? inc.first_name : ex.first_name,
    last_name: inc.last_name ?? ex.last_name,
    phone: phoneFromInc ? inc.phone : ex.phone,
    phone_normalized: phoneFromInc ? inc.phone_normalized : ex.phone_normalized,
    email: emailFromInc ? inc.email : ex.email,
    email_normalized: emailFromInc ? inc.email_normalized : ex.email_normalized,
    birthdate: inc.birthdate ?? ex.birthdate,
    is_medical_patient: ex.is_medical_patient || inc.is_medical_patient,
    imported_spend_minor_units: inc.imported_spend_minor_units,
    state: inc.state ?? ex.state,
    city: inc.city ?? ex.city,
    zip: inc.zip ?? ex.zip,
    last_purchase_at: later(ex.last_purchase_at, inc.last_purchase_at),
    imported_created_at: inc.imported_created_at ?? ex.imported_created_at ?? null,
    tax_designations: inc.tax_designations ?? ex.tax_designations ?? null,
    import_source: IMPORT_SOURCE,
  };
}

/**
 * Rule 7. `existing` is every stored customer whose Customer ID, phone or
 * email appears in this batch. Each stored customer is claimed at most once.
 */
export function planImportBatch(incoming: CustomerImportRow[], existing: ExistingCustomer[]): BatchPlan {
  const byExt = new Map<string, ExistingCustomer>();
  const byPhone = new Map<string, ExistingCustomer>();
  const byEmail = new Map<string, ExistingCustomer>();
  for (const ex of existing) {
    if (ex.external_id) byExt.set(ex.external_id, ex);
    else {
      if (ex.phone_normalized && !byPhone.has(ex.phone_normalized)) byPhone.set(ex.phone_normalized, ex);
      if (ex.email_normalized && !byEmail.has(ex.email_normalized)) byEmail.set(ex.email_normalized, ex);
    }
  }
  const claimed = new Set<string>();
  const seenExt = new Set<string>();
  const plan: BatchPlan = { updates: [], inserts: [] };
  for (const inc of incoming) {
    if (seenExt.has(inc.external_id)) continue;
    seenExt.add(inc.external_id);
    let match = byExt.get(inc.external_id) ?? null;
    if (!match && inc.phone_normalized) {
      const m = byPhone.get(inc.phone_normalized);
      if (m && !claimed.has(m.id)) match = m;
    }
    if (!match && inc.email_normalized) {
      const m = byEmail.get(inc.email_normalized);
      if (m && !claimed.has(m.id)) match = m;
    }
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id);
      plan.updates.push(mergeForUpdate(match, inc));
    } else {
      plan.inserts.push({ ...inc, import_source: IMPORT_SOURCE });
    }
  }
  return plan;
}

/** Plain-English lines for the preview, in the order a person reads them. */
export function describeReport(r: ImportReport): string[] {
  const n = (x: number) => x.toLocaleString("en-US");
  const lines = [`${n(r.customers)} customers ready to import, from ${n(r.rowsInFile)} rows in the file.`];
  if (r.duplicateRows) lines.push(`${n(r.duplicateRows)} rows were exact repeats of another row and were merged.`);
  if (r.skippedNoIdentity) lines.push(`${n(r.skippedNoIdentity)} rows had no name, phone or email and were left out (Customer ID ${r.skippedIds.slice(0, 20).join(", ")}${r.skippedIds.length > 20 ? ", …" : ""}).`);
  if (r.skippedNoCustomerId) lines.push(`${n(r.skippedNoCustomerId)} rows had no Customer ID and were left out.`);
  if (r.phonesDropped) lines.push(`${n(r.phonesDropped)} phone numbers were incomplete (not 10 digits) and were left blank.`);
  if (r.emailsDropped) lines.push(`${n(r.emailsDropped)} emails were not valid addresses and were left blank.`);
  if (r.dobPlaceholders) lines.push(`${n(r.dobPlaceholders)} birthdays were placeholders (the same date on ${PLACEHOLDER_DOB_MIN} or more customers, like 11/11/1999) and were left blank.`);
  if (r.dobImplausible) lines.push(`${n(r.dobImplausible)} birthdays were impossible (before 1910, or under 18 today) and were left blank.`);
  if (r.withSpend || r.withLastPurchase) lines.push(`${n(r.withSpend)} have a Total Spent and ${n(r.withLastPurchase)} have a Last Purchase Date. Both are saved and shown on the customer list, the profile and the register search.`);
  if (r.withCreatedDate) lines.push(`${n(r.withCreatedDate)} have a Date Created, saved as "customer since".`);
  if (r.veterans) lines.push(`${n(r.veterans)} customers are marked Veteran in Cultivera. This is saved on their record (Tax designation) so staff can see it; the veteran discount is still applied at the register after checking a military ID.`);
  return lines;
}

// ── self-tests ───────────────────────────────────────────────────────────

export function __runCustomerImportCoreTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };

  // cells
  ok("phone: full number formatted", cleanPhone("(360) 809-3778").phone === "(360) 809-3778");
  ok("phone: normalized digits", cleanPhone("360.809.3778").normalized === "3608093778");
  ok("phone: leading 1 dropped", cleanPhone("+1 360 809 3778").normalized === "3608093778");
  ok("phone: fragment dropped", cleanPhone("(575) 7-").phone === null);
  ok("phone: text dropped", cleanPhone("(Rec) rea-tion").normalized === null);
  ok("phone: 11 digits not starting 1 dropped", cleanPhone("23608093778").phone === null);
  ok("email: valid kept, normalized lower", cleanEmail(" Bob@Gmail.com ").normalized === "bob@gmail.com");
  ok("email: missing @ dropped", cleanEmail("jmike6192004gmail.com").email === null);
  ok("email: no dot after @ dropped", cleanEmail("athena@wahlstrom").email === null);
  ok("money: float", moneyToMinor(291.2) === 29120);
  ok("money: string with $ and comma", moneyToMinor("$1,141.20") === 114120);
  ok("money: zero/negative/garbage → 0", moneyToMinor(0) === 0 && moneyToMinor(-5) === 0 && moneyToMinor("x") === 0);
  ok("serial: 45698 is 2025-02-10 in UTC", excelSerialToDate(45698)?.toISOString() === "2025-02-10T00:00:00.000Z");
  ok("serial: time of day kept", excelSerialToDate(45698.5)?.toISOString() === "2025-02-10T12:00:00.000Z");
  ok("date: Cultivera US string PM", cellToDate("8/30/2024 2:36:31 PM")?.toISOString() === "2024-08-30T14:36:31.000Z");
  ok("date: 12 AM is midnight", cellToDate("1/2/2025 12:05:00 AM")?.toISOString() === "2025-01-02T00:05:00.000Z");
  ok("date: 12 PM is noon", cellToDate("1/2/2025 12:05:00 PM")?.toISOString() === "2025-01-02T12:05:00.000Z");
  ok("date: ISO day", cellToDay("1995-05-02") === "1995-05-02");
  ok("date: ISO with fraction, no zone = UTC", cellToDate("2026-02-14 20:40:49.47")?.toISOString() === "2026-02-14T20:40:49.470Z");
  ok("date: impossible 2/30 rejected", cellToDate("2/30/2024") === null);
  ok("date: garbage rejected", cellToDate("soon") === null && cellToDate("") === null);
  ok("age: day before birthday", ageOn("2000-11-02", "2026-11-01") === 25);
  ok("age: on birthday", ageOn("2000-11-01", "2026-11-01") === 26);
  ok("csv: quotes, comma, CRLF, BOM", JSON.stringify(parseCsv('\ufeffa,b\r\n"x, y","he said ""hi"""\r\n')) === JSON.stringify([["a", "b"], ["x, y", 'he said "hi"']]));

  // grid
  const H = ["Customer ID", "First Name", "Last Name ", "Phone Number", "Total Spent", "Date Of Birth", "IS MEDICAL", "State", "Email", "Tax Designations", "Last Purchase Date"];
  const grid: Grid = [H];
  grid.push([13, "bill", "mcclendon", "(360) 809-3778", 291.2, null, "N", "WA", "", "", 46067.86]);
  grid.push([13, "bill", "mcclendon", "(360) 809-3778", 291.2, null, "N", "WA", "", "", 46067.86]);
  grid.push([14, "belfair", "", "(575) 7-", 0, 36283, "N", "WA", "nope", " Veteran ", null]);
  grid.push([7406, "", "", "", 0, null, "N", "WA", "", "", null]);
  grid.push([6906, '"', "", "", 0, null, "Y", "WA", "", "", null]);
  grid.push([20, "", "Smith", "", 5, 45534, "Y", "WA", "a@b.co", "", "8/30/2024 2:36:31 PM"]);
  for (let i = 0; i < PLACEHOLDER_DOB_MIN; i++) grid.push([100 + i, `P${i}`, "X", "", 0, 36475, "N", "WA", "", "", null]);
  grid.push(["", "nobody", "", "", 0, null, "N", "", "", "", null]);
  grid.push([300, "Old", "Timer", "", 0, "1/2/1900", "N", "WA", "", "", null]);
  grid.push([]);
  const m = mapCustomerGrid(grid, "2026-11-01");
  const r = m.report;
  const byId = new Map(m.rows.map((x) => [x.external_id, x]));
  ok("grid: no error", m.error === null);
  ok("grid: blank row not counted in file rows", r.rowsInFile === 18);
  ok("grid: duplicate merged", r.duplicateRows === 1 && m.rows.filter((x) => x.external_id === "13").length === 1);
  ok("grid: no-identity rows skipped by id", r.skippedNoIdentity === 2 && r.skippedIds.join() === "7406,6906");
  ok("grid: row without Customer ID skipped", r.skippedNoCustomerId === 1);
  ok("grid: customer count", r.customers === 14 && m.rows.length === 14);
  ok("grid: spend in cents", byId.get("13")?.imported_spend_minor_units === 29120);
  ok("grid: last purchase serial read as UTC", byId.get("13")?.last_purchase_at === "2026-02-14T20:38:24.000Z");
  ok("grid: phone fragment dropped and counted", byId.get("14")?.phone === null && r.phonesDropped === 1);
  ok("grid: bad email dropped and counted", byId.get("14")?.email === null && r.emailsDropped === 1);
  ok("grid: veteran counted", r.veterans === 1);
  ok("grid: tax designation saved, trimmed", byId.get("14")?.tax_designations === "Veteran" && byId.get("13")?.tax_designations === null);
  ok("grid: spend + last purchase counted", r.withSpend === 2 && r.withLastPurchase === 2);
  ok("grid: no Date Created column = null, not invented", byId.get("13")?.imported_created_at === null && r.withCreatedDate === 0);
  {
    const g2 = mapCustomerGrid(parseCsv("Customer ID,First Name,Last Name,Date Created,Last Purchase Date\n13,bill,mcclendon,8/30/2024 2:36:31 PM,2/14/2026 8:38:24 PM\n14,ann,lee,,\n"), "2026-11-01");
    ok("grid: Date Created read as UTC", g2.rows[0]?.imported_created_at === "2024-08-30T14:36:31.000Z" && g2.report.withCreatedDate === 1);
    ok("grid: empty Date Created stays null", g2.rows[1]?.imported_created_at === null);
    ok("report: spend/last purchase line", describeReport(g2.report).some((l) => /0 have a Total Spent and 1 have a Last Purchase Date/.test(l)));
  }
  ok("grid: real birthday kept", byId.get("14")?.birthdate === "1999-05-03");
  ok("grid: under-18 birthday dropped", byId.get("20")?.birthdate === null);
  ok("grid: pre-1910 birthday dropped", byId.get("300")?.birthdate === null && r.dobImplausible === 2);
  ok("grid: shared placeholder birthday dropped", byId.get("100")?.birthdate === null && r.dobPlaceholders === PLACEHOLDER_DOB_MIN);
  ok("grid: missing first name becomes (unknown)", byId.get("20")?.first_name === "(unknown)" && byId.get("20")?.last_name === "Smith");
  ok("grid: medical kept on a real customer", byId.get("20")?.is_medical_patient === true && r.medical === 1);
  ok("grid: US date string purchase", byId.get("20")?.last_purchase_at === "2024-08-30T14:36:31.000Z");
  ok("grid: wrong file refused in plain English", /Cultivera customer export/.test(mapCustomerGrid([["Name", "Phone"], ["a", "b"]], "2026-11-01").error ?? ""));
  ok("grid: empty file refused", mapCustomerGrid([[], [null]], "2026-11-01").error === "The file is empty.");
  ok("grid: CSV text cells work the same", mapCustomerGrid(parseCsv("Customer ID,First Name,Last Name,Total Spent\n5,Ann,Lee,$10.50\n"), "2026-11-01").rows[0]?.imported_spend_minor_units === 1050);
  ok("chunk: sizes", JSON.stringify(chunk([1, 2, 3, 4, 5], 2)) === "[[1,2],[3,4],[5]]");
  ok("report: plain English first line", describeReport(r)[0] === "14 customers ready to import, from 18 rows in the file.");

  // sanitize
  const good = byId.get("13")!;
  ok("sanitize: round-trips a clean row", JSON.stringify(sanitizeImportRow(JSON.parse(JSON.stringify(good)))) === JSON.stringify(good));
  ok("sanitize: rejects missing id", sanitizeImportRow({ ...good, external_id: "" }) === null);
  ok("sanitize: rejects non-object", sanitizeImportRow("x") === null && sanitizeImportRow(null) === null);
  ok("sanitize: re-cleans a bad phone", sanitizeImportRow({ ...good, phone: "(575) 7-" })?.phone_normalized === null);
  ok("sanitize: clamps negative spend", sanitizeImportRow({ ...good, imported_spend_minor_units: -9 })?.imported_spend_minor_units === 0);
  ok("sanitize: drops bad birthdate", sanitizeImportRow({ ...good, birthdate: "11/11/1999" })?.birthdate === null);
  ok("sanitize: bad created date dropped", sanitizeImportRow({ ...good, imported_created_at: "soon" })?.imported_created_at === null);
  ok("sanitize: tax designation capped", (sanitizeImportRow({ ...good, tax_designations: "x".repeat(500) })?.tax_designations ?? "").length === 200);
  ok("sanitize: medical only when true", sanitizeImportRow({ ...good, is_medical_patient: "Y" })?.is_medical_patient === false);

  // plan
  const ex = (o: Partial<ExistingCustomer> & { id: string }): ExistingCustomer => ({
    external_id: null, first_name: "Old", last_name: null, phone: null, phone_normalized: null, email: null,
    email_normalized: null, birthdate: null, is_medical_patient: false, state: null, city: null, zip: null,
    last_purchase_at: null, imported_created_at: null, tax_designations: null, ...o,
  });
  const inc = (o: Partial<CustomerImportRow> & { external_id: string }): CustomerImportRow => ({
    first_name: "New", last_name: null, phone: null, phone_normalized: null, email: null, email_normalized: null,
    birthdate: null, is_medical_patient: false, imported_spend_minor_units: 100, state: "WA", city: null, zip: null,
    last_purchase_at: null, imported_created_at: null, tax_designations: null, ...o,
  });
  const p1 = planImportBatch([inc({ external_id: "1" })], [ex({ id: "a", external_id: "1" })]);
  ok("plan: Customer ID match updates", p1.updates.length === 1 && p1.updates[0].id === "a" && p1.inserts.length === 0);
  const p2 = planImportBatch([inc({ external_id: "2", phone_normalized: "3605550100", phone: "(360) 555-0100" })], [ex({ id: "b", phone_normalized: "3605550100" })]);
  ok("plan: phone claims a customer with no Customer ID", p2.updates[0]?.id === "b" && p2.updates[0].external_id === "2");
  const p3 = planImportBatch([inc({ external_id: "645", phone_normalized: "2533134559" })], [ex({ id: "c", external_id: "283", phone_normalized: "2533134559" })]);
  ok("plan: phone never steals another Cultivera customer", p3.updates.length === 0 && p3.inserts.length === 1);
  const p4 = planImportBatch(
    [inc({ external_id: "3", phone_normalized: "3605550199" }), inc({ external_id: "4", phone_normalized: "3605550199" })],
    [ex({ id: "d", phone_normalized: "3605550199" })],
  );
  ok("plan: a stored customer is claimed once", p4.updates.length === 1 && p4.inserts.length === 1 && p4.inserts[0].external_id === "4");
  const p5 = planImportBatch([inc({ external_id: "5", email_normalized: "x@y.co", email: "x@y.co" })], [ex({ id: "e", email_normalized: "x@y.co" })]);
  ok("plan: email claims when phone does not", p5.updates[0]?.id === "e");
  const p6 = planImportBatch([inc({ external_id: "6" }), inc({ external_id: "6" })], []);
  ok("plan: repeated Customer ID inserted once", p6.inserts.length === 1);
  ok("plan: inserts carry the import source", p6.inserts[0].import_source === IMPORT_SOURCE);
  const mg = mergeForUpdate(
    ex({ id: "f", first_name: "Jane", last_name: "Doe", phone: "(360) 555-0101", phone_normalized: "3605550101", email: "j@d.co", email_normalized: "j@d.co", birthdate: "1980-01-01", is_medical_patient: true, last_purchase_at: "2026-10-01T00:00:00.000Z" }),
    inc({ external_id: "7", first_name: "(unknown)", last_purchase_at: "2026-01-01T00:00:00.000Z", imported_spend_minor_units: 5000 }),
  );
  ok("merge: empty cells keep stored values", mg.first_name === "Jane" && mg.last_name === "Doe" && mg.phone === "(360) 555-0101" && mg.phone_normalized === "3605550101" && mg.email_normalized === "j@d.co" && mg.email === "j@d.co" && mg.birthdate === "1980-01-01");
  ok("merge: medical flag never removed", mg.is_medical_patient === true);
  ok("merge: last purchase is the later one", mg.last_purchase_at === "2026-10-01T00:00:00.000Z");
  ok("merge: old-POS spend written to imported spend", mg.imported_spend_minor_units === 5000 && !("lifetime_spend_minor_units" in mg));
  const mg3 = mergeForUpdate(
    ex({ id: "h", imported_created_at: "2024-08-30T14:36:31.000Z", tax_designations: "Veteran" }),
    inc({ external_id: "10" }),
  );
  ok("merge: empty created/tax cells keep stored values", mg3.imported_created_at === "2024-08-30T14:36:31.000Z" && mg3.tax_designations === "Veteran");
  ok("merge: incoming tax designation wins", mergeForUpdate(ex({ id: "i", tax_designations: "Veteran" }), inc({ external_id: "11", tax_designations: "Senior" })).tax_designations === "Senior");
  ok("columns: 0335 columns read, legacy list without them", EXISTING_COLUMNS.includes("imported_created_at") && !LEGACY_EXISTING_COLUMNS.includes("tax_designations"));
  const mg2 = mergeForUpdate(ex({ id: "g", phone: "(360) 555-0101", phone_normalized: "3605550101" }), inc({ external_id: "8", phone: "(360) 555-0102", phone_normalized: "3605550102" }));
  ok("merge: a new phone replaces the stored one", mg2.phone_normalized === "3605550102" && mg2.phone === "(360) 555-0102");
  ok("plan: every write has the same columns", (() => {
    const pl = planImportBatch([inc({ external_id: "9" }), inc({ external_id: "1" })], [ex({ id: "a", external_id: "1" })]);
    const { id: _id, ...u } = pl.updates[0];
    void _id;
    return JSON.stringify(Object.keys(u).sort()) === JSON.stringify(Object.keys(pl.inserts[0]).sort());
  })());

  return { passed, failed: failures.length, failures };
}
