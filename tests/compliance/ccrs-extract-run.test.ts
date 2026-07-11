/**
 * tests/compliance/ccrs-extract-run.test.ts
 *
 * S14 (Task H, logged suggestion #6): the DOM-free pipeline runner
 * (`ccrs-extract/run.ts`) that the Web Worker (and the uploader's main-thread
 * fallback) executes. End-to-end over BYTE-EXACT synthetic nested deliveries
 * (outer zip → inner table zips → UTF-16-LE tab-delimited csv — the real
 * extract format verified in Task H):
 *
 *  - full crunch: licensee/product/inventory/strain/header/detail rows land in
 *    the aggregator exactly as the pre-S14 inline uploader pipeline did
 *    (competitor stats, statewide suppliers, totals, period detection);
 *  - table ordering, skip rules (SKIPPED_TABLES + labresult), progress
 *    callback protocol (structured-clonable snapshots, monotonic filesDone);
 *  - the not-a-delivery-zip error is thrown VERBATIM (never force-fit).
 */
import { describe, expect, it } from "vitest";

import { runCcrsExtract, TABLE_ORDER, type ExtractProgress } from "@/lib/discovery/ccrs-extract/run";
import { bytesAsBlob } from "@/lib/discovery/ccrs-extract/zip";
import {
  buildZip,
  tableZip,
  CRLF,
  utf16le,
  LICENSEE_HEADER,
  SALE_HEADER_HEADER,
  SALE_DETAIL_HEADER,
  PRODUCT_HEADER,
  INVENTORY_HEADER,
  STRAIN_HEADER,
  MANIFEST_HEADER_HEADER,
  TRANSPORTED_ITEMS_HEADER,
  GREENWAY_ROW,
  licenseeRow,
  manifestHeaderRow,
  transportedItemRow,
} from "./fixtures/ccrs-zip-fixture";

// ---------------------------------------------------------------------------
// Fixture delivery: Greenway (736/413541), competitor HPO (901/420001),
// supplier farm (950/610001). One retail sale at HPO, one wholesale transfer
// farm → HPO. Retail line resolves Inventory → Product for attribution.
// ---------------------------------------------------------------------------

const PREFIX = "May 2026 CCRS Monthly Reports/CCRS PRR (6-2-26)/";

function buildDelivery(extraOuterFiles: Array<{ name: string; data: Uint8Array; method: 0 | 8 }> = []) {
  const licensee = tableZip("Licensee_0.csv", [
    LICENSEE_HEADER,
    GREENWAY_ROW,
    licenseeRow({ licenseeId: "901", licenseNumber: "420001", name: "HIGH POINT OP LLC", dba: "HPO CANNABIS" }),
    licenseeRow({ licenseeId: "950", licenseNumber: "610001", name: "EVERGREEN FARMS LLC", dba: "Evergreen Farms" }),
  ]);
  const strains = tableZip("Strains_0.csv", [
    STRAIN_HEADER,
    "77\t950\tBlue Dream\tHybrid\t\tFalse\t\t\t\t",
  ]);
  const product = tableZip("Product_0.csv", [
    PRODUCT_HEADER,
    "5001\t950\tUsable Marijuana\tEvergreen | Blue Dream 3.5g\t\t3.5\t\tFalse\t\t\t\t",
  ]);
  const inventory = tableZip("Inventory_0.csv", [
    INVENTORY_HEADER,
    "901\t8001\t77\t\t5001\tINV-1\t100\t50\t\tFalse\t\tFalse\t\t\t\t",
  ]);
  const saleHeader = tableZip("SaleHeader_0.csv", [
    SALE_HEADER_HEADER,
    // Retail sale at the tracked competitor (HPO sells to a consumer).
    "3001\t901\t\tRecreationalRetail\t2026-05-03 00:00:00\t\tFalse\t\t\t\t",
    // Wholesale transfer: farm (950) sells TO the competitor (901).
    "3002\t950\t901\tWholesale\t2026-05-10 00:00:00\t\tFalse\t\t\t\t",
  ]);
  const saleDetail = tableZip("SalesDetail_0.csv", [
    SALE_DETAIL_HEADER,
    // Retail line: qty 2 × $30.00 − $0.00 = $60.00; resolves via Inventory 8001.
    "9001\t3001\t8001\t\t2.00\t30.00\t.00\t.00\t.00\t\tFalse\t\t\t\t",
    // Wholesale line: qty 10 × $5.00 − $2.00 = $48.00 for the farm.
    "9002\t3002\t8001\t\t10.00\t5.00\t2.00\t.00\t.00\t\tFalse\t\t\t\t",
  ]);

  return buildZip([
    // Deliberately shuffled: the runner must impose the dependency order.
    { name: `${PREFIX}SalesDetail_0.zip`, data: saleDetail, method: 8 },
    { name: `${PREFIX}Licensee_0.zip`, data: licensee, method: 8 },
    { name: `${PREFIX}SaleHeader_0.zip`, data: saleHeader, method: 8 },
    { name: `${PREFIX}Inventory_0.zip`, data: inventory, method: 8 },
    { name: `${PREFIX}Strains_0.zip`, data: strains, method: 8 },
    { name: `${PREFIX}Product_0.zip`, data: product, method: 8 },
    ...extraOuterFiles,
  ]);
}

const OPTS = { selfLicenseNumber: "413541", trackedLicenseNumbers: ["413541", "420001"] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCcrsExtract (S14)", () => {
  it("crunches a synthetic nested delivery end to end (same math as the inline pipeline)", async () => {
    const { result, rows, filesTotal } = await runCcrsExtract(bytesAsBlob(buildDelivery()), OPTS);

    expect(filesTotal).toBe(6);
    // 3 licensees + 1 strain + 1 product + 1 inventory + 2 headers + 2 details
    expect(rows).toBe(10);
    expect(result.totals.licenseeRows).toBe(3);
    expect(result.totals.saleHeaderRows).toBe(2);
    expect(result.totals.saleDetailRows).toBe(2);
    expect(result.totals.retailLines).toBe(1);
    expect(result.totals.wholesaleLines).toBe(1);
    // I1: period = the dominant SaleHeader month's full span; the honest
    // observed SaleDate span rides alongside.
    expect(result.periodStart).toBe("2026-05-01");
    expect(result.periodEnd).toBe("2026-05-31");
    expect(result.observedMinDate).toBe("2026-05-03");
    expect(result.observedMaxDate).toBe("2026-05-10");

    // Competitor stats: HPO's retail revenue = 2 × $30.00 = $60.00 (6000¢).
    expect(result.competitors).toHaveLength(1);
    const hpo = result.competitors[0];
    expect(hpo.licenseNumber).toBe("420001");
    expect(hpo.retail.revenueMinor).toBe(6000);
    expect(hpo.retail.units).toBe(2);
    // Wholesale sourcing: HPO bought $48.00 (10 × $5.00 − $2.00) from the farm.
    expect(hpo.wholesale.spendMinor).toBe(4800);
    expect(hpo.wholesale.topSuppliers[0]?.licenseNumber).toBe("610001");

    // S10 statewide suppliers: the farm with 1 line, $48.00, 1 tracked buyer.
    const farm = result.suppliers.find((s) => s.licenseNumber === "610001");
    expect(farm).toBeDefined();
    expect(farm?.revenueMinor).toBe(4800);
    expect(farm?.lineCount).toBe(1);
    expect(farm?.trackedBuyers).toBe(1);

    // Greenway itself must NEVER appear in competitor outputs.
    expect(result.competitors.some((c) => c.licenseNumber === "413541")).toBe(false);
  });

  it("emits structured-clonable progress with monotonic filesDone and table names", async () => {
    const snapshots: ExtractProgress[] = [];
    await runCcrsExtract(bytesAsBlob(buildDelivery()), {
      ...OPTS,
      onProgress: (p) => snapshots.push(structuredClone(p)), // must survive postMessage semantics
    });

    expect(snapshots[0]).toEqual({ phase: "reading", filesDone: 0, filesTotal: 0, rows: 0, currentFile: null });
    const agg = snapshots.filter((p) => p.phase === "aggregating");
    expect(agg.length).toBeGreaterThan(0);
    let last = -1;
    for (const p of agg) {
      expect(p.filesDone).toBeGreaterThanOrEqual(last);
      last = p.filesDone;
      expect(p.filesTotal).toBe(6);
    }
    expect(agg[agg.length - 1].filesDone).toBe(6);
    // The first crunched table must be Licensee (dependency order imposed).
    const named = agg.find((p) => p.currentFile != null);
    expect(named?.currentFile).toBe("Licensee_0.zip");
  });

  it("processes tables in dependency order regardless of zip entry order", () => {
    // The TABLE_ORDER constant is the contract the sort uses. Task I (I4):
    // manifests precede inventory (the lot→vendor map must exist when
    // inventory rows join their ExternalIdentifier), and manifest headers
    // precede transported items (origin lookup).
    expect(TABLE_ORDER).toEqual([
      "licensee",
      "strains",
      "manifestheader",
      "transporteditems",
      "product",
      "inventory",
      "saleheader",
      "salesdetail",
    ]);
  });

  it("skips non-table zips (SKIPPED_TABLES + labresult) without failing", async () => {
    const junkCsv = utf16le(`A\tB${CRLF}1\t2${CRLF}`);
    const zip = buildDelivery([
      { name: `${PREFIX}Areas_0.zip`, data: buildZip([{ name: "Areas_0.csv", data: junkCsv, method: 8 }]), method: 8 },
      { name: `${PREFIX}LabResult_0.zip`, data: buildZip([{ name: "LabResult_0.csv", data: junkCsv, method: 8 }]), method: 8 },
      { name: `${PREFIX}readme.txt`, data: new TextEncoder().encode("not a zip"), method: 0 },
    ]);
    const { filesTotal } = await runCcrsExtract(bytesAsBlob(zip), OPTS);
    expect(filesTotal).toBe(6); // the six real tables only
  });

  it("throws the not-a-delivery-zip error verbatim (never force-fits)", async () => {
    const notDelivery = buildZip([
      { name: "readme.txt", data: new TextEncoder().encode("hello"), method: 0 },
    ]);
    await expect(runCcrsExtract(bytesAsBlob(notDelivery), OPTS)).rejects.toThrow(
      "No CCRS table zips found inside this file. Drop the FULL monthly delivery zip (it contains Licensee/Product/Inventory/SaleHeader/SalesDetail zips).",
    );
  });

  it("runs without a progress callback (worker shell may omit it)", async () => {
    const { result } = await runCcrsExtract(bytesAsBlob(buildDelivery()), OPTS);
    expect(result.competitors).toHaveLength(1);
  });

  // Task I (I4): a delivery WITH manifest tables — the lot-level vendor join
  // must flow end to end (nested zips → parse → aggregate → signals), and the
  // per-type top-10 signals must come out with the vendor attached.
  it("crunches manifest tables end to end: lot join attributes the shipping vendor (I4)", async () => {
    const manifestHeader = tableZip("ManifestHeader_0.csv", [
      MANIFEST_HEADER_HEADER,
      manifestHeaderRow({
        externalManifestIdentifier: "RM-100",
        originLicenseNumber: "610001",
        originLicenseName: "EVERGREEN FARMS LLC",
      }),
      // Deleted manifest — must contribute nothing.
      manifestHeaderRow({
        externalManifestIdentifier: "RM-DEAD",
        originLicenseNumber: "999999",
        originLicenseName: "GHOST FARM LLC",
        isDeleted: true,
      }),
    ]);
    const transportedItems = tableZip("TransportedItems_0.csv", [
      TRANSPORTED_ITEMS_HEADER,
      transportedItemRow({
        externalManifestIdentifier: "RM-100",
        inventoryExternalIdentifier: "LOT-BD-1",
        description: "Evergreen | Blue Dream 3.5g",
      }),
    ]);
    // Inventory row carrying the lot id in ExternalIdentifier (column 11).
    const inventoryWithLot = tableZip("Inventory_0.csv", [
      INVENTORY_HEADER,
      "901\t8001\t77\t\t5001\tINV-1\t100\t50\t\tFalse\tLOT-BD-1\tFalse\t\t\t\t",
    ]);
    const licensee = tableZip("Licensee_0.csv", [
      LICENSEE_HEADER,
      GREENWAY_ROW,
      licenseeRow({ licenseeId: "901", licenseNumber: "420001", name: "HIGH POINT OP LLC", dba: "HPO CANNABIS" }),
      licenseeRow({ licenseeId: "950", licenseNumber: "610001", name: "EVERGREEN FARMS LLC", dba: "Evergreen Farms" }),
    ]);
    const strains = tableZip("Strains_0.csv", [STRAIN_HEADER, "77\t950\tBlue Dream\tHybrid\t\tFalse\t\t\t\t"]);
    const product = tableZip("Product_0.csv", [
      PRODUCT_HEADER,
      "5001\t950\tUsable Marijuana\tEvergreen | Blue Dream 3.5g\t\t3.5\t\tFalse\t\t\t\t",
    ]);
    const saleHeader = tableZip("SaleHeader_0.csv", [
      SALE_HEADER_HEADER,
      "3001\t901\t\tRecreationalRetail\t2026-05-03 00:00:00\t\tFalse\t\t\t\t",
    ]);
    const saleDetail = tableZip("SalesDetail_0.csv", [
      SALE_DETAIL_HEADER,
      "9001\t3001\t8001\t\t2.00\t30.00\t.00\t.00\t.00\t\tFalse\t\t\t\t",
    ]);

    const zip = buildZip([
      // Shuffled on purpose — the runner must order manifests BEFORE inventory.
      { name: `${PREFIX}SalesDetail_0.zip`, data: saleDetail, method: 8 },
      { name: `${PREFIX}Inventory_0.zip`, data: inventoryWithLot, method: 8 },
      { name: `${PREFIX}TransportedItems_0.zip`, data: transportedItems, method: 8 },
      { name: `${PREFIX}Licensee_0.zip`, data: licensee, method: 8 },
      { name: `${PREFIX}SaleHeader_0.zip`, data: saleHeader, method: 8 },
      { name: `${PREFIX}ManifestHeader_0.zip`, data: manifestHeader, method: 8 },
      { name: `${PREFIX}Strains_0.zip`, data: strains, method: 8 },
      { name: `${PREFIX}Product_0.zip`, data: product, method: 8 },
    ]);

    const { result, filesTotal } = await runCcrsExtract(bytesAsBlob(zip), OPTS);
    expect(filesTotal).toBe(8); // manifests are crunched, not skipped
    expect(result.totals.manifestRows).toBe(2);
    expect(result.totals.transportedItemRows).toBe(1);

    // The statewide mover carries the manifest-resolved shipping vendor,
    // displayed by its licensee-table DBA.
    const sw = result.signals.find((s) => s.kind === "statewide_mover");
    expect(sw?.productName).toBe("Evergreen | Blue Dream 3.5g");
    expect(sw?.vendorLicense).toBe("610001");
    expect(sw?.vendorName).toBe("Evergreen Farms");

    // The owner's per-type board: a type_mover row for the type, with vendor.
    const tm = result.signals.find((s) => s.kind === "type_mover");
    expect(tm?.inventoryType).toBe("Usable Marijuana");
    expect(tm?.productName).toBe("Evergreen | Blue Dream 3.5g");
    expect(tm?.vendorLicense).toBe("610001");
    expect(tm?.vendorName).toBe("Evergreen Farms");
  });
});
