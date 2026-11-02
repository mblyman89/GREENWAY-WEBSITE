/**
 * tests/compliance/customer-table-core.test.ts  (customers-table-enterprise)
 *
 * Owner (verbatim): "I would like you to expand the table so it shows more
 * details, every important piece of data should be shown on the table. I want
 * the contact column to be phone and email separated. I want this table to be
 * very useful and powerful. Please enhance the table to be of enterprise grade
 * quality."
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_SORTS } from "@/lib/admin/list-filter-core";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_EXPORT_COLUMNS,
  __runCustomerTableCoreTests,
  canExportCustomers,
  customerFilterOps,
  customerTableQuery,
  parseCustomerTableParams,
  resolveVisibleColumns,
} from "@/lib/customers/customer-table-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("customer-table-core", () => {
  it("embedded self-tests pass with a real assertion count", () => {
    const r = __runCustomerTableCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(150);
  });

  it("phone and email are separate default columns; no combined Contact column", () => {
    const keys = resolveVisibleColumns(undefined).map((c) => c.key);
    expect(keys).toContain("phone");
    expect(keys).toContain("email");
    expect(keys).not.toContain("contact");
  });

  it("shows every important field by default or on request", () => {
    const all = CUSTOMER_COLUMNS.map((c) => c.key);
    for (const k of ["customer_id", "birthdate", "contact_prefs", "medical", "tax", "loyalty", "segment", "visits", "total_spent", "greenway_spent", "old_pos_spent", "first_visit", "last_purchase", "customer_since", "source", "note", "created_at", "updated_at"]) {
      expect(all).toContain(k);
    }
    const exp = CUSTOMER_EXPORT_COLUMNS.map((c) => c.header);
    expect(exp).toContain("Phone");
    expect(exp).toContain("Email");
  });

  it("every header sort is a whitelisted CUSTOMER_SORTS key", () => {
    const keys = new Set(CUSTOMER_SORTS.map((s) => s.key));
    for (const c of CUSTOMER_COLUMNS) {
      if (!c.sort) continue;
      expect(keys.has(c.sort.first)).toBe(true);
      expect(keys.has(c.sort.second)).toBe(true);
    }
  });

  it("the URL grammar is untrusted-input safe and round-trips", () => {
    const s = parseCustomerTableParams({ sort: "drop table", size: "1e9", bmonth: "0", source: "x", col: "<script>" });
    expect(s.sort.key).toBe("recent");
    expect(s.pageSize).toBe(100);
    expect(s.filters.birthdayMonth).toBeUndefined();
    expect(s.filters.source).toBeUndefined();
    expect(customerTableQuery(s)).toBe("");
    const t = parseCustomerTableParams({ q: "bill", medical: "yes", source: "register", bmonth: "3", col: "phone,email" });
    expect(parseCustomerTableParams(Object.fromEntries(new URLSearchParams(customerTableQuery(t))))).toEqual(t);
  });

  it("filter ops only ever name whitelisted columns", () => {
    const ops = customerFilterOps(parseCustomerTableParams({ medical: "no", consent: "yes", dnc: "no", phone: "no", email: "yes", tax: "no", source: "staff", bmonth: "11" }).filters);
    const allowed = new Set(["is_medical_patient", "marketing_consent", "do_not_contact", "phone_normalized", "email", "tax_designations", "import_source", "birthdate"]);
    expect(ops.length).toBe(8);
    for (const o of ops) expect(allowed.has(o.column)).toBe(true);
  });

  it("bulk PII download is manager-and-up only", () => {
    expect(canExportCustomers("manager")).toBe(true);
    expect(canExportCustomers("staff")).toBe(false);
    expect(canExportCustomers("readonly")).toBe(false);
  });
});

describe("customers table wiring", () => {
  it("the page uses the core grammar, the side-table store and shows a download only to managers+", () => {
    const page = read("src/app/admin/customers/page.tsx");
    expect(page).toMatch(/parseCustomerTableParams\(/);
    expect(page).toMatch(/loadCustomerTableExtras\(/);
    expect(page).toMatch(/canExport && total > 0/);
    expect(page).toMatch(/case "phone":/);
    expect(page).toMatch(/case "email":/);
    expect(page).not.toMatch(/c\.email \|\| c\.phone/);
  });

  it("the export route re-checks the role and audits without PII", () => {
    const route = read("src/app/admin/customers/export/route.ts");
    expect(route).toMatch(/requirePermission\("customers\.manage"\)/);
    expect(route).toMatch(/canExportCustomers\(session\.profile\.role\)/);
    expect(route).toMatch(/status: 403/);
    expect(route).toMatch(/action: "customers\.exported"/);
    expect(route).toMatch(/customerExportAudit\(/);
  });

  it("the stores read every error and use explicit columns for side tables", () => {
    const store = read("src/lib/customers/customer-table-store.ts");
    expect(store).toMatch(/select\("customer_id, balance_points, lifetime_points, is_active"\)/);
    expect(store).toMatch(/select\("customer_id, status, expires_on"\)/);
    expect(store).toMatch(/acc\.error/);
    expect(store).toMatch(/auth\.error/);
    const list = read("src/lib/customers/store.ts");
    expect(list).toMatch(/isMissingColumnError/);
    expect(list).toMatch(/applyCustomerFilterOps\(query, opts\.ops\)/);
  });
});
