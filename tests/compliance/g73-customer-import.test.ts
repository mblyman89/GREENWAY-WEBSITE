/**
 * G-73 (owner message 15): drag-and-drop import of the Cultivera customer
 * export. The real file is customer PII and is never committed; these tests
 * use rows shaped exactly like it (same 26 headers, same cell types the xlsx
 * reader returns: numbers, Excel serial dates, strings, nulls).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  IMPORT_BATCH_SIZE,
  PLACEHOLDER_DOB_MIN,
  __runCustomerImportCoreTests,
  describeReport,
  mapCustomerGrid,
  parseCsv,
  planImportBatch,
  sanitizeImportRow,
  type Grid,
} from "@/lib/customers/customer-import-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** The 26 headers of the Cultivera export, spacing and all ("Last Name "). */
const CULTIVERA_HEADERS = [
  "Customer ID", "First Name", "Last Name ", "Phone Number", "Total Spent", "Driver License Number",
  "Date Of Birth", "Driver License Issued Date", "Driver License Expiration Date", "IS MEDICAL", "IS A MINOR",
  "IS A CAREGIVER", "IS TEMPORARY", "HAS SALES LIMIT EXEMPTION", "Image y/n", "Street Address ",
  "Street Address 2 ", "State", "City", "Email", "Customer Groups", "Tax Designations", "Zip", "Date Created",
  "Active", "Last Purchase Date",
];

function row(o: { id: number; first?: string; last?: string; phone?: string; spent?: number; dob?: number | null; email?: string; tax?: string; med?: string; lastBuy?: number | null }) {
  return [
    o.id, o.first ?? "", o.last ?? "", o.phone ?? "", o.spent ?? 0, "", o.dob ?? null, null, null, o.med ?? "N", "N", "N",
    "N", "N", "N", "", "", "WA", "", o.email ?? "", "", o.tax ?? "", "", "8/30/2024 2:36:31 PM", "Y", o.lastBuy ?? null,
  ];
}

describe("G-73 customer-import-core self-tests", () => {
  it("all pass, and there are enough of them", () => {
    const r = __runCustomerImportCoreTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });
});

describe("G-73 the Cultivera export, as the browser reads it", () => {
  const grid: Grid = [CULTIVERA_HEADERS];
  grid.push(row({ id: 13, first: "bill", last: "mcclendon", phone: "(360) 809-3778", spent: 291.2, lastBuy: 46067.8616836806 }));
  grid.push(row({ id: 13, first: "bill", last: "mcclendon", phone: "(360) 809-3778", spent: 291.2, lastBuy: 46067.8616836806 }));
  grid.push(row({ id: 618, first: "Madison", last: "Deck", spent: 1141.2, dob: 34778 }));
  grid.push(row({ id: 1508, first: "4110", phone: "(411) 0-" }));
  grid.push(row({ id: 6907, phone: "(Rec) rea-tion", email: "0", med: "Y" }));
  grid.push(row({ id: 14318, first: "Vet", last: "Eran", tax: "Veteran", email: "jmike6192004gmail.com" }));
  for (let i = 0; i < PLACEHOLDER_DOB_MIN; i++) grid.push(row({ id: 2000 + i, first: `P${i}`, dob: 36475 }));
  const m = mapCustomerGrid(grid, "2026-11-01");

  it("reads the real headers, including the trailing space in 'Last Name '", () => {
    expect(m.error).toBeNull();
    expect(m.rows.find((r) => r.external_id === "618")?.last_name).toBe("Deck");
  });
  it("merges the exact repeat rows Cultivera exports", () => {
    expect(m.report.duplicateRows).toBe(1);
    expect(m.rows.filter((r) => r.external_id === "13")).toHaveLength(1);
  });
  it("leaves out rows with no name, phone or email, and names them", () => {
    expect(m.report.skippedIds).toEqual(["1508", "6907"]);
  });
  it("keeps money in cents and the purchase time in UTC", () => {
    const bill = m.rows.find((r) => r.external_id === "13")!;
    expect(bill.imported_spend_minor_units).toBe(29120);
    expect(bill.last_purchase_at).toBe("2026-02-14T20:40:49.470Z");
    expect(bill.phone_normalized).toBe("3608093778");
  });
  it("keeps a real birthday, blanks the 11/11/1999 placeholder", () => {
    expect(m.rows.find((r) => r.external_id === "618")?.birthdate).toBe("1995-03-20");
    expect(m.rows.find((r) => r.external_id === "2000")?.birthdate).toBeNull();
    expect(m.report.dobPlaceholders).toBe(PLACEHOLDER_DOB_MIN);
  });
  it("tells the person, in plain English, what was left blank and why", () => {
    const text = describeReport(m.report).join("\n");
    expect(text).toMatch(/^13 customers ready to import, from 16 rows in the file\./);
    expect(text).toMatch(/1 rows were exact repeats/);
    expect(text).toMatch(/Customer ID 1508, 6907/);
    expect(text).toMatch(/emails were not valid addresses/);
    expect(text).toMatch(/placeholders/);
    expect(text).toMatch(/marked Veteran in Cultivera/);
  });
  it("a .csv of the same sheet gives the same customers", () => {
    const csv = grid.map((r) => r.map((c) => (c == null ? "" : `"${String(c).replace(/"/g, '""')}"`)).join(",")).join("\r\n");
    const fromCsv = mapCustomerGrid(parseCsv(csv), "2026-11-01");
    expect(fromCsv.rows.map((r) => r.external_id)).toEqual(m.rows.map((r) => r.external_id));
  });
  it("every cleaned row survives the server's re-check unchanged", () => {
    for (const r of m.rows) expect(sanitizeImportRow(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it("two Cultivera customers who share a phone stay two customers", () => {
    const plan = planImportBatch(
      [{ ...m.rows[0], external_id: "645" }],
      [{ id: "x", external_id: "283", first_name: "Claire", last_name: "Cronin", phone: m.rows[0].phone, phone_normalized: m.rows[0].phone_normalized, email: null, email_normalized: null, birthdate: null, is_medical_patient: false, state: "WA", city: null, zip: null, last_purchase_at: null }],
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });
});

describe("G-73 wiring: drop a file, batches, no paste box", () => {
  const page = read("src/app/admin/customers/import/page.tsx");
  const actions = read("src/app/admin/customers/import/actions.ts");
  const store = read("src/lib/customers/import.ts");
  const drop = read("src/components/admin/customers/CustomerImportDropzone.tsx");

  it("the page shows the drop zone and no paste box", () => {
    expect(page).toMatch(/<CustomerImportDropzone today=\{pacificToday\(\)\} \/>/);
    expect(page).not.toMatch(/Textarea|csv_text/);
  });
  it("the drop zone reads .xlsx and .csv and imports in batches", () => {
    expect(drop).toMatch(/onDrop=/);
    expect(drop).toMatch(/accept="\.xlsx,\.xls,\.csv/);
    expect(drop).toMatch(/await import\("xlsx"\)/);
    expect(drop).toMatch(/chunk\(mapped\.rows, IMPORT_BATCH_SIZE\)/);
    expect(drop).toMatch(/Continue/);
  });
  it("the server action checks permission, caps the batch, and re-checks every row", () => {
    expect(actions).toMatch(/requirePermission\("customers\.manage"\)/);
    expect(actions).toMatch(/rows\.length > IMPORT_BATCH_SIZE/);
    expect(actions).toMatch(/rows\.map\(sanitizeImportRow\)/);
    expect(IMPORT_BATCH_SIZE).toBeLessThanOrEqual(500);
  });
  it("the store looks up in bulk and reports every write error", () => {
    expect(store).toMatch(/\.in\(l\.column, part\)/);
    expect(store).toMatch(/q = q\.is\("external_id", null\)/);
    expect(store).toMatch(/planImportBatch\(rows/);
    expect(store.match(/if \(res\.error\) \{/g)?.length).toBe(2);
    expect(store).not.toMatch(/for \(const row of/);
  });
});
