/**
 * R74 S8: the per-lot coverage report ("where did every Cultivera lot's manifest come from?").
 * Owner (round 2 #5): "Whatever Cultivera doesn't find, the email will ... for ones the email can't
 * find either, yes flag them in one unmatched Cultivera stock manifest." and (round 2 #6) a lot with
 * no received date goes to the CCRS clean-up — so the report flags it.
 *
 * End to end with the REAL transfer plan (planFromSources, the same call the rebuild page and Apply
 * use), the REAL WCIA parser (parseVendorJson) and the REAL stored-row reader (mailDocsFromRows).
 * Read-only: no database writes anywhere in S8.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { planFromSources } from "@/lib/inventory/cultivera-rehome-core";
import type { TransferIndexEntry } from "@/lib/inventory/cultivera-transfer-match-core";
import {
  __runCultiveraCoverageCoreTests,
  buildCoverageReport,
  coverageCsv,
  coverageFilterFromParams,
  filterCoverage,
  openBarcodes,
  type CoverageLotSource,
} from "@/lib/pos/cultivera-coverage-core";
import type { MailDoc } from "@/lib/pos/cultivera-mail-match-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S8 pure core", () => {
  it("self-tests pass at the pinned count", () => {
    const r = __runCultiveraCoverageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(41);
  });

  it("is registered in the pure self-test runner with its floor", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runCultiveraCoverageCoreTests()");
    expect(src).toMatch(/cultivera-coverage-core: .*expected >= 41/);
  });
});

describe("R74 S8 end to end: real transfer plan + real WCIA parser", () => {
  const ON_TRANSFER = "1111111111111111";
  const ON_EMAIL = "1234567890123456";
  const NOWHERE = "5555555555555555";

  const sources: CoverageLotSource[] = [
    { barcode: ON_TRANSFER, vendor: "Fireline", receivedDateRaw: "2025-01-02 10:00:00", units: 3, productName: "Fire OG 3.5g" },
    { barcode: ON_EMAIL, vendor: "Canna Organix", receivedDateRaw: "2025-03-01 10:30:00", units: 4, productName: "Blue Dream" },
    { barcode: NOWHERE, vendor: "Default Vendor", receivedDateRaw: "", units: 2, productName: "Mystery" },
  ];
  const transfers: TransferIndexEntry[] = [
    {
      id: 77,
      number: "0001234",
      vendor: "Fireline",
      transferDate: "2025-01-02",
      acceptedAt: "2025-01-02T18:00:00.000Z",
      status: "Accepted",
      lines: [[ON_TRANSFER, 3, 3, false]],
    },
  ];

  const wcia = JSON.stringify({
    document_schema_version: "2.1.0",
    transfer_id: "0009001",
    from_license_number: "412345",
    from_license_name: "CANNA ORGANIX LLC",
    est_departed_at: "2025-03-01T17:00:00Z",
    inventory_transfer_items: [
      { inventory_id: ON_EMAIL, product_name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", qty: "10", unit_price: "4.50", uom: "each" },
    ],
  });

  const { plan } = planFromSources(sources, transfers, new Map(), "2025-06-01");

  it("the real plan finds the transfer lot and leaves the other two open", () => {
    expect(openBarcodes(sources, plan)).toEqual([ON_EMAIL, NOWHERE].sort());
  });

  it("before 0293: email NOT checked, the two open lots go to the unmatched manifest", () => {
    const r = buildCoverageReport(sources, plan, null);
    expect(r.emailChecked).toBe(false);
    expect(r.line).toMatch(/NOT checked/);
    expect(r.counts).toMatchObject({ lots: 3, transfer: 1, email: 0, unmatched: 2, noReceivedDate: 1 });
    expect(r.rows.find((x) => x.barcode === ON_TRANSFER)).toMatchObject({ source: "transfer", manifestNumber: "0001234" });
  });

  it("with the harvested WCIA email: the emailed lot is placed, only the true orphan is left", () => {
    const parsed = parseVendorJson(wcia);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const docs: MailDoc[] = [{ messageId: "gm1", emailAt: "2025-03-01T18:00:00Z", filename: "0009001.json", manifest: parsed.manifest }];
    const r = buildCoverageReport(sources, plan, docs);
    expect(r.emailChecked).toBe(true);
    expect(r.counts).toMatchObject({ lots: 3, transfer: 1, email: 1, several_emails: 0, unmatched: 1 });
    expect(r.rows.find((x) => x.barcode === ON_EMAIL)).toMatchObject({ source: "email", manifestNumber: "0009001", vendor: "Canna Organix" });
    expect(r.rows.find((x) => x.barcode === NOWHERE)).toMatchObject({ source: "unmatched", manifestNumber: "CV-UNMATCHED", noReceivedDate: true });
    expect(r.complete).toBe(false);

    // filters + CSV as the page and route use them
    const onlyUnmatched = filterCoverage(r.rows, coverageFilterFromParams((k) => (k === "source" ? "unmatched" : null)));
    expect(onlyUnmatched.map((x) => x.barcode)).toEqual([NOWHERE]);
    const csv = coverageCsv(r.rows);
    expect(csv.split("\n")[0]).toContain("Barcode");
    expect(csv).toContain("0009001");
    expect(csv).toContain("CV-UNMATCHED");
  });
});

describe("R74 S8 wiring", () => {
  const store = read("src/lib/pos/cultivera-coverage-store.ts");
  const page = "src/app/admin/menu-imports/[id]/coverage/page.tsx";
  const route = "src/app/admin/menu-imports/[id]/coverage/csv/route.ts";

  it("the store is server-only, read-only, and reads only parsed docs that overlap the open lots", () => {
    expect(store).toContain('import "server-only"');
    expect(store).toContain('.eq("status", "parsed")');
    expect(store).toContain('.overlaps("barcodes"');
    expect(store).toContain("planFromSources(");
    expect(store).toContain("loadRehomeSources(");
    expect(store).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the page and the CSV route exist and are gated", () => {
    expect(existsSync(page)).toBe(true);
    expect(existsSync(route)).toBe(true);
    expect(read(page)).toContain("loadCoverage(");
    expect(read(route)).toContain("menu.import");
    expect(read(route)).toContain("coverageCsv(");
  });

  it("the manifests rebuild page links to the coverage report", () => {
    expect(read("src/app/admin/menu-imports/[id]/manifests/page.tsx")).toContain("/coverage");
  });
});
