/**
 * G-75 (owner message 17): one powerful customer search for the register and
 * the back office, Total Spent / Last Purchase shown everywhere, and every
 * column of the Cultivera export with real data saved (Date Created, Tax
 * Designations via 0335).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  __runCustomerSearchCoreTests,
  buildCustomerSearchFilter,
  customerFigures,
  parseCustomerQuery,
  rankCustomerMatches,
  registerHitDetail,
  type SearchableCustomer,
} from "@/lib/customers/customer-search-core";
import { mapCustomerGrid, parseCsv, sanitizeImportRow } from "@/lib/customers/customer-import-core";
import { isMissing0335Column } from "@/lib/customers/import";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const cust = (o: Partial<SearchableCustomer> & { id: string; first_name: string }): SearchableCustomer => ({
  last_name: null, email: null, phone: null, phone_normalized: null, ...o,
});
const book: SearchableCustomer[] = [
  cust({ id: "1", first_name: "bill", last_name: "mcclendon", phone_normalized: "3608093778", external_id: "13", imported_spend_minor_units: 29120, last_purchase_at: "2026-02-14T20:38:24.000Z" }),
  cust({ id: "2", first_name: "Bill", last_name: "Miller", phone_normalized: "2535550100" }),
  cust({ id: "3", first_name: "Logan", last_name: "McClendon", email: "logan@example.com" }),
  cust({ id: "4", first_name: "Wilma", last_name: "Billings" }),
];
const find = (q: string) => rankCustomerMatches(book, parseCustomerQuery(q)).map((c) => c.id);

describe("G-75 customer-search-core self-tests", () => {
  it("all pass, and there are enough of them", () => {
    const r = __runCustomerSearchCoreTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(65);
  });
});

describe("G-75 the search finds anyone the owner described", () => {
  it("full name, either order (the old search never matched 'bill mcclendon')", () => {
    expect(find("bill mcclendon")[0]).toBe("1");
    expect(find("mcclendon bill")[0]).toBe("1");
  });
  it("part of a name", () => {
    expect(find("mccl")).toEqual(expect.arrayContaining(["1", "3"]));
    expect(find("bi mc")[0]).toBe("1");
  });
  it("last name only", () => {
    expect(find("miller")).toEqual(["2"]);
  });
  it("phone digits, any format, any part", () => {
    expect(find("(360) 809-3778")).toEqual(["1"]);
    expect(find("3778")).toEqual(["1"]);
    expect(find("1-360-809-3778")).toEqual(["1"]);
  });
  it("email and Customer ID", () => {
    expect(find("logan@example")).toEqual(["3"]);
    expect(find("13")).toContain("1");
  });
  it("database filter needs every word, each in any column", () => {
    const f = buildCustomerSearchFilter(parseCustomerQuery("bill mcclendon")) ?? "";
    expect(f.startsWith("and(or(")).toBe(true);
    expect(f).toContain("last_name.ilike.%mcclendon%");
    expect(buildCustomerSearchFilter(parseCustomerQuery("360-809"))).toContain("phone_normalized.ilike.%360809%");
  });
});

describe("G-75 Total Spent and Last Purchase from the spreadsheet are shown", () => {
  it("total = spend here + old POS spend; last purchase falls back to the old POS date", () => {
    const f = customerFigures({ lifetime_spend_minor_units: 1000, imported_spend_minor_units: 29120, last_visit_at: null, last_purchase_at: "2026-02-14T20:38:24.000Z" });
    expect(f.totalSpendMinor).toBe(30120);
    expect(f.lastPurchaseAt).toBe("2026-02-14T20:38:24.000Z");
    expect(f.lastPurchaseSource).toBe("old_pos");
  });
  it("register hit tells two Bills apart without a full phone or email", () => {
    const { fullName, detail } = registerHitDetail(book[0]);
    expect(fullName).toBe("bill mcclendon");
    expect(detail).toContain("…3778");
    expect(detail).toContain("$291.20 spent");
    expect(detail).toContain("#13");
    expect(detail).not.toContain("3608093778");
  });
  it("admin list and profile use the combined figures", () => {
    expect(read("src/app/admin/customers/page.tsx")).toMatch(/customerFigures\(/);
    const profile = read("src/app/admin/customers/[id]/page.tsx");
    expect(profile).toMatch(/customerFigures\(/);
    expect(profile).toMatch(/Total spent \(all time\)/);
    expect(profile).toMatch(/imported_created_at/);
    expect(profile).toMatch(/tax_designations/);
  });
});

describe("G-75 every spreadsheet column with data is saved", () => {
  const g = mapCustomerGrid(
    parseCsv("Customer ID,First Name,Last Name ,Total Spent,Tax Designations,Date Created,Last Purchase Date\n13,bill,mcclendon,291.2,Veteran,8/30/2024 2:36:31 PM,2/14/2026 8:38:24 PM\n"),
    "2026-11-01",
  );
  it("Date Created and Tax Designations reach the row and survive the server re-check", () => {
    const r = g.rows[0];
    expect(r.imported_created_at).toBe("2024-08-30T14:36:31.000Z");
    expect(r.tax_designations).toBe("Veteran");
    expect(r.imported_spend_minor_units).toBe(29120);
    expect(r.last_purchase_at).toBe("2026-02-14T20:38:24.000Z");
    expect(sanitizeImportRow(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it("before 0335 the writer drops only the two new columns and retries", () => {
    expect(isMissing0335Column({ code: "PGRST204", message: "Could not find the 'tax_designations' column" })).toBe(true);
    expect(isMissing0335Column({ code: "42703", message: 'column customers.imported_created_at does not exist' })).toBe(true);
    expect(isMissing0335Column({ code: "PGRST204", message: "Could not find the 'phone' column" })).toBe(false);
    expect(read("src/lib/customers/import.ts")).toMatch(/LEGACY_EXISTING_COLUMNS/);
  });
});

describe("G-75 wiring", () => {
  it("the register route uses the shared search and returns no full phone/email/birthday", () => {
    const src = read("src/app/api/pos/member/route.ts");
    expect(src).toMatch(/searchCustomers\(/);
    expect(src).not.toMatch(/listCustomers\(/);
    expect(src).not.toMatch(/birthdate:|email:\s*c\.|phone:\s*c\./);
  });
  it("the register searches as you type, ignoring stale answers", () => {
    const src = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(src).toMatch(/searchTicket/);
    expect(src).toMatch(/setTimeout\(/);
  });
  it("listCustomers delegates to the shared search", () => {
    expect(read("src/lib/customers/store.ts")).toMatch(/export async function searchCustomers\(/);
  });
  it("0335: columns, trigram indexes, server-only typo search", () => {
    const sql = read("supabase/migrations/0335_customer_search.sql");
    expect(sql).toMatch(/create extension if not exists pg_trgm/);
    expect(sql).toMatch(/add column if not exists imported_created_at timestamptz/);
    expect(sql).toMatch(/add column if not exists tax_designations text/);
    expect(sql).toMatch(/revoke all on function public\.customer_search_fuzzy\(text, integer\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.customer_search_fuzzy\(text, integer\) to service_role/);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toMatch(/customer-search-0335-pg-check\.sql/);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0335_customer_search\.sql/);
  });
});
