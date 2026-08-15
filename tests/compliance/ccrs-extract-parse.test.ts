/**
 * tests/compliance/ccrs-extract-parse.test.ts
 *
 * S1 coverage for the CCRS monthly-extract transformer's pure core:
 *   - parse.ts: UTF-16/BOM decoding, delimiter sniffing, line splitting,
 *     verified table signatures, minor-unit money math, typed row mappers,
 *     and the streaming table reader.
 *   - zip.ts: central-directory reading + entry decompression (stored and
 *     deflate), including the nested-zip flow the real extract uses.
 *
 * Fixtures replicate the REAL extract byte format (UTF-16-LE + BOM,
 * tab-delimited, CRLF) captured from the April/May 2026 files in Task H.
 * Zip fixtures are constructed byte-exact in-test (node:zlib provides the
 * deflate payloads; the modules under test remain dependency-free).
 */
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";

import {
  decodeCcrsBytes,
  sniffDelimiter,
  splitDelimited,
  LineSplitter,
  detectExtractTable,
  tableNameFromZipEntry,
  headerIndexMap,
  toNum,
  moneyToMinor,
  toIsoDate,
  toBool,
  normalizeSaleType,
  mapLicensee,
  mapSaleHeader,
  mapSaleDetail,
  mapProduct,
  mapInventory,
  mapStrain,
  mapLabResult,
  mapManifestHeader,
  mapTransportedItem,
  streamTable,
  decodeStream,
  SKIPPED_TABLES,
  type ExtractTableKind,
} from "@/lib/discovery/ccrs-extract/parse";
import {
  bytesAsBlob,
  readZipEntries,
  openZipEntryStream,
  readZipEntryBytes,
} from "@/lib/discovery/ccrs-extract/zip";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Encode text as UTF-16-LE, optionally with the FF FE BOM (the extract default). */
function utf16le(text: string, withBom = true): Uint8Array {
  const codeUnits = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) codeUnits[i] = text.charCodeAt(i);
  const body = new Uint8Array(codeUnits.buffer);
  if (!withBom) return body;
  const out = new Uint8Array(body.byteLength + 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  out.set(body, 2);
  return out;
}

const CRLF = "\r\n";

/** Verified May-2026 Licensee header (exact column order from the real file). */
const LICENSEE_HEADER =
  "LicenseStatus\tLicenseeId\tUBI\tLicenseNumber\tName\tDBA\tLicenseIssueDate\tLicenseExpirationDate\tExternalIdentifier\tIsDeleted\tAddress1\tAddress2\tCity\tState\tZipCode\tCounty\tEmailAddress\tPhoneNumber\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

/** Greenway's real Licensee row (verified byte-for-byte in Task H). */
const GREENWAY_ROW =
  "Active\t736\t6033535550010001\t413541    \tLYMAN'S MARIJUANA L.L.C.\tGREENWAY MARIJUANA\t2025-10-27\t2026-11-30\t\tFalse\t4851 GEIGER RD SE\t\tPORT ORCHARD\tWA\t98366    \tKITSAP\tMICHAEL@GREENWAYMARIJUANA.COM\t\tLoadLicenseeETL\t2021-12-06 09:09:34.420000000\tproc_UpdateExistingLicenses\t2025-10-28 04:52:12.467000000";

const SALE_HEADER_HEADER =
  "SaleHeaderId\tLicenseeId\tSoldToLicenseeId\tSaleType\tSaleDate\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

const SALE_DETAIL_HEADER =
  "SaleDetailId\tSaleHeaderId\tInventoryId\tPlantId\tQuantity\tUnitPrice\tDiscount\tSalesTax\tOtherTax\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

const PRODUCT_HEADER =
  "ProductId\tLicenseeId\tInventoryType\tName\tDescription\tUnitWeightGrams\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

const INVENTORY_HEADER =
  "LicenseeId\tInventoryId\tStrainId\tAreaId\tProductId\tInventoryIdentifier\tInitialQuantity\tQuantityOnHand\tTotalCost\tIsMedical\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tupdatedDate";

const STRAIN_HEADER =
  "StrainId\tLicenseeId\tName\tStrainType\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

const LAB_HEADER =
  "LabResultId\tLabLicenseeId\tLicenseeId\tLabTestStatus\tInventoryId\tTestName\tTestDate\tTestValue\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

/** Task I (I4): verified May-2026 ManifestHeader header (exact column order, read from the real zip). */
const MANIFEST_HEADER_HEADER =
  "CCRSManifestHeaderId\tSubmittedBy\tSubmittedDate\tNumberRecords\tExternalManifestIdentifier\tHeaderOperation\tTransportationType\tOriginLicenseNumber\tOriginLicenseName\tOriginLicenseeAddress\tOriginLicenseePhone\tOriginLicenseeEmailAddress\tOriginAssociateID\tTransportationLicenseNumber\tTransportationAssociateID\tDepartureDateTime\tArrivalDateTime\tDestinationLicenseNumber\tDestinationLicenseName\tDestinationLicenseAddress\tDestinationLicenseePhone\tDestinationLicenseeEmailAddress\tDestinationAssociateId\tIsDeleted\tRecordCreatedBy\tRecordCreatedDate\tRecordUpdatedBy\tRecordUpdatedDate\tOrderCancelled\tManifestGeneratedDate\tErrorMessage\tTransportationLicenseAddress\tTransportationLicenseName\tTransportationLicenseEmailAddress\tTransportationLicensePhone\tIsManifestGenerated";

/** Task I (I4): verified May-2026 TransportedItems header (exact column order, read from the real zip). */
const TRANSPORTED_ITEMS_HEADER =
  "TransportedItemsID\tExternalManifestIdentifier\tInventoryExternalIdentifier\tPlantExternalIdentifier\tDescription\tProductType\tMedical\tInventoryType\tStrain\tQuantity\tUOM\tWeightPerUnit\tServingsPerUnit\tExternalIdentifier\tLabTestExternalIdentifier\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate\tRecordCreatedBy\tRecordCreatedDate\tRecordUpdatedBy\tRecordUpdatedDate\tIsDeleted\tOperation\tErrorMessage";

// ---------------------------------------------------------------------------
// decodeCcrsBytes
// ---------------------------------------------------------------------------

describe("decodeCcrsBytes", () => {
  it("decodes UTF-16-LE with BOM (the extract default)", () => {
    const text = `${LICENSEE_HEADER}${CRLF}${GREENWAY_ROW}${CRLF}`;
    expect(decodeCcrsBytes(utf16le(text))).toBe(text);
  });

  it("decodes BOM-less UTF-16-LE via NUL-byte probe (Harvest-style files)", () => {
    const text = "Some\tHeader\r\ndata\trow\r\n";
    expect(decodeCcrsBytes(utf16le(text, false))).toBe(text);
  });

  it("falls back to UTF-8 when bytes clearly are not UTF-16", () => {
    const text = "plain,utf8,file\n1,2,3\n";
    expect(decodeCcrsBytes(new TextEncoder().encode(text))).toBe(text);
  });

  it("returns empty string for empty input", () => {
    expect(decodeCcrsBytes(new Uint8Array(0))).toBe("");
  });
});

// ---------------------------------------------------------------------------
// sniffDelimiter + LineSplitter
// ---------------------------------------------------------------------------

describe("sniffDelimiter", () => {
  it("picks tab for the standard extract tables", () => {
    expect(sniffDelimiter(LICENSEE_HEADER)).toBe("\t");
  });
  it("picks comma for the Areas table (the one comma-delimited file)", () => {
    expect(sniffDelimiter("LicenseeId,Name,IsQuarantine,ExternalIdentifier,IsDeleted")).toBe(",");
  });
  it("tab wins ties (extract default)", () => {
    expect(sniffDelimiter("a\tb,c")).toBe("\t"); // 1 tab, 1 comma
  });
});

describe("LineSplitter", () => {
  it("splits CRLF lines across arbitrary chunk boundaries", () => {
    const s = new LineSplitter();
    const lines: string[] = [];
    s.push("line1\r", (l) => lines.push(l));
    s.push("\nline2\r\nli", (l) => lines.push(l));
    s.push("ne3\r\n", (l) => lines.push(l));
    s.flush((l) => lines.push(l));
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("flushes a final unterminated line", () => {
    const s = new LineSplitter();
    const lines: string[] = [];
    s.push("only-line-no-newline", (l) => lines.push(l));
    s.flush((l) => lines.push(l));
    expect(lines).toEqual(["only-line-no-newline"]);
  });
});

// ---------------------------------------------------------------------------
// Table detection — verified signatures
// ---------------------------------------------------------------------------

describe("detectExtractTable", () => {
  const cases: Array<[string, ExtractTableKind]> = [
    [LICENSEE_HEADER, "licensee"],
    [SALE_HEADER_HEADER, "sale_header"],
    [SALE_DETAIL_HEADER, "sale_detail"],
    [PRODUCT_HEADER, "product"],
    [INVENTORY_HEADER, "inventory"],
    [STRAIN_HEADER, "strain"],
    [LAB_HEADER, "lab_result"],
    // Task I (I4): manifest tables are now detected (vendor attribution).
    [MANIFEST_HEADER_HEADER, "manifest_header"],
    [TRANSPORTED_ITEMS_HEADER, "transported_item"],
  ];
  for (const [header, kind] of cases) {
    it(`detects ${kind}`, () => {
      expect(detectExtractTable(header.split("\t"))).toBe(kind);
    });
  }

  it("returns unknown for the SELF-REPORT template Sale header (different schema)", () => {
    const templateSale =
      "LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice";
    expect(detectExtractTable(templateSale.split(","))).toBe("unknown");
  });

  it("returns unknown for a random header (never guess)", () => {
    expect(detectExtractTable(["foo", "bar", "baz"])).toBe("unknown");
  });
});

describe("tableNameFromZipEntry", () => {
  it("strips path, chunk suffix and extension", () => {
    expect(
      tableNameFromZipEntry("May 2026 CCRS Monthly Reports/CCRS PRR (6-2-26)/SaleHeader_10.zip"),
    ).toBe("saleheader");
    expect(tableNameFromZipEntry("Licensee_0.zip")).toBe("licensee");
    expect(tableNameFromZipEntry("Areas_0.zip")).toBe("areas");
  });

  it("skipped tables cover all verified non-transformer tables", () => {
    for (const t of [
      "areas",
      "contacts",
      "harvest",
      "integrator",
      "inventoryadjustment",
      "inventoryplanttransfer",
      "plant",
      "plantdestructions",
    ]) {
      expect(SKIPPED_TABLES.has(t)).toBe(true);
    }
    expect(SKIPPED_TABLES.has("saleheader")).toBe(false);
    expect(SKIPPED_TABLES.has("salesdetail")).toBe(false);
    // Task I (I4): manifests are now CRUNCHED (vendor attribution), not skipped.
    expect(SKIPPED_TABLES.has("manifestheader")).toBe(false);
    expect(SKIPPED_TABLES.has("transporteditems")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Money / number / date helpers
// ---------------------------------------------------------------------------

describe("moneyToMinor (string math, never float×100)", () => {
  it("parses real extract price shapes", () => {
    expect(moneyToMinor("4.20")).toBe(420);
    expect(moneyToMinor(".00")).toBe(0);
    expect(moneyToMinor("12")).toBe(1200);
    expect(moneyToMinor("19.99")).toBe(1999);
    expect(moneyToMinor("0.1")).toBe(10);
    expect(moneyToMinor("-2.50")).toBe(-250);
    expect(moneyToMinor("1,234.56")).toBe(123456);
    expect(moneyToMinor("$5.00")).toBe(500);
  });
  it("rounds a 3rd decimal digit half-up", () => {
    expect(moneyToMinor("1.005")).toBe(101);
    expect(moneyToMinor("1.004")).toBe(100);
  });
  it("never fabricates: blank/garbage → null", () => {
    expect(moneyToMinor("")).toBeNull();
    expect(moneyToMinor("abc")).toBeNull();
    expect(moneyToMinor(null)).toBeNull();
    expect(moneyToMinor("1.2.3")).toBeNull();
  });
});

describe("toNum / toIsoDate / toBool / normalizeSaleType", () => {
  it("toNum handles decimals and rejects garbage", () => {
    expect(toNum("15.00")).toBe(15);
    expect(toNum("0")).toBe(0);
    expect(toNum("x")).toBeNull();
    expect(toNum(null)).toBeNull();
  });
  it("toIsoDate handles the extract's datetime shape", () => {
    expect(toIsoDate("2026-05-31 00:00:00")).toBe("2026-05-31");
    expect(toIsoDate("2026-04-06")).toBe("2026-04-06");
    expect(toIsoDate("5/9/2026")).toBe("2026-05-09");
    expect(toIsoDate("not-a-date")).toBeNull();
  });
  it("toBool handles True/False strings", () => {
    expect(toBool("False")).toBe(false);
    expect(toBool("True")).toBe(true);
    expect(toBool("weird")).toBeNull();
  });
  it("normalizeSaleType maps verified values", () => {
    expect(normalizeSaleType("RecreationalRetail")).toBe("retail");
    expect(normalizeSaleType("RecreationalMedical")).toBe("medical");
    expect(normalizeSaleType("Wholesale")).toBe("wholesale");
    expect(normalizeSaleType("SomethingElse")).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Row mappers — against the REAL verified rows
// ---------------------------------------------------------------------------

describe("row mappers", () => {
  it("mapLicensee parses Greenway's real row (license number keeps its padding trimmed)", () => {
    const idx = headerIndexMap(LICENSEE_HEADER.split("\t"));
    const rec = mapLicensee(GREENWAY_ROW.split("\t"), idx);
    expect(rec).not.toBeNull();
    expect(rec!.licenseeId).toBe("736");
    expect(rec!.licenseNumber).toBe("413541"); // cell() trims the trailing padding
    expect(rec!.name).toBe("LYMAN'S MARIJUANA L.L.C.");
    expect(rec!.dba).toBe("GREENWAY MARIJUANA");
    expect(rec!.status).toBe("Active");
    expect(rec!.city).toBe("PORT ORCHARD");
    expect(rec!.county).toBe("KITSAP");
  });

  it("mapSaleHeader parses seller/buyer/type/date", () => {
    const idx = headerIndexMap(SALE_HEADER_HEADER.split("\t"));
    const rec = mapSaleHeader(
      "335631065\t736\t\tRecreationalRetail\t2026-05-09 00:00:00\tC1-x\tFalse\tUser-6791\t2026-05-09 08:25:00\t\t".split("\t"),
      idx,
    );
    expect(rec).not.toBeNull();
    expect(rec!.saleHeaderId).toBe("335631065");
    expect(rec!.sellerLicenseeId).toBe("736");
    expect(rec!.buyerLicenseeId).toBeNull();
    expect(rec!.saleType).toBe("retail");
    expect(rec!.saleDate).toBe("2026-05-09");
  });

  it("mapSaleDetail parses the real detail row shape (per-unit price in cents)", () => {
    const idx = headerIndexMap(SALE_DETAIL_HEADER.split("\t"));
    const rec = mapSaleDetail(
      "343620450\t335631065\t50066319\t\t15.00\t4.20\t.00\t.00\t.00\tC1-67910001121853\tFalse\tUser-6791\t2026-04-29 08:25:00\t\t".split(
        "\t",
      ),
      idx,
    );
    expect(rec.saleHeaderId).toBe("335631065");
    expect(rec.inventoryId).toBe("50066319");
    expect(rec.quantity).toBe(15);
    expect(rec.unitPriceMinor).toBe(420);
    expect(rec.discountMinor).toBe(0);
    expect(rec.isDeleted).toBe(false);
  });

  it("mapProduct / mapInventory / mapStrain / mapLabResult parse and require their ids", () => {
    const pIdx = headerIndexMap(PRODUCT_HEADER.split("\t"));
    const p = mapProduct(
      "9001\t42\tUsable Cannabis\tFlower - Lemon Cherry Runtz - 3.5g\t\t3.5\t\tFalse\t\t\t\t".split("\t"),
      pIdx,
    );
    expect(p).toEqual({
      productId: "9001",
      licenseeId: "42",
      inventoryType: "Usable Cannabis",
      name: "Flower - Lemon Cherry Runtz - 3.5g",
      unitWeightGrams: 3.5,
    });
    expect(mapProduct("\t42\tX\tY\t\t1\t\tFalse\t\t\t\t".split("\t"), pIdx)).toBeNull();

    const iIdx = headerIndexMap(INVENTORY_HEADER.split("\t"));
    const inv = mapInventory(
      "42\t50066319\t77\t\t9001\tlot-1\t100\t40\t500.00\tFalse\t\tFalse\t\t\t\t".split("\t"),
      iIdx,
    );
    expect(inv).toEqual({
      inventoryId: "50066319",
      licenseeId: "42",
      productId: "9001",
      strainId: "77",
      externalIdentifier: null, // blank cell — never fabricated (Task I I4)
    });

    // Task I (I4): the lot id (ExternalIdentifier) is now carried through —
    // it is the join key to TransportedItems.InventoryExternalIdentifier.
    const invWithLot = mapInventory(
      "42\t50066319\t77\t\t9001\tlot-1\t100\t40\t500.00\tFalse\tLOT.752489.9ba888\tFalse\t\t\t\t".split("\t"),
      iIdx,
    );
    expect(invWithLot?.externalIdentifier).toBe("LOT.752489.9ba888");

    const sIdx = headerIndexMap(STRAIN_HEADER.split("\t"));
    expect(mapStrain("77\t42\tLemon Cherry Runtz\tHybrid\t\tFalse\t\t\t\t".split("\t"), sIdx)).toEqual({
      strainId: "77",
      name: "Lemon Cherry Runtz",
    });

    const lIdx = headerIndexMap(LAB_HEADER.split("\t"));
    expect(
      mapLabResult(
        "1\t900\t42\tPassed\t50066319\tPotency - THC\t2026-05-01\t23.4\t\tFalse\t\t\t\t".split("\t"),
        lIdx,
      ),
    ).toEqual({ inventoryId: "50066319", testName: "Potency - THC", testValue: 23.4 });
  });

  it("mapManifestHeader parses the real row shape and requires the manifest id (Task I I4)", () => {
    const idx = headerIndexMap(MANIFEST_HEADER_HEADER.split("\t"));
    // Column values mirror the verified May-2026 sample row (trimmed strings).
    const cells = MANIFEST_HEADER_HEADER.split("\t").map(() => "");
    cells[4] = "RM-1692125503"; // ExternalManifestIdentifier
    cells[7] = "417949"; // OriginLicenseNumber
    cells[8] = "SOUTH SEATTLE RETAIL HOLDING"; // OriginLicenseName
    cells[23] = "False"; // IsDeleted
    expect(mapManifestHeader(cells, idx)).toEqual({
      externalManifestIdentifier: "RM-1692125503",
      originLicenseNumber: "417949",
      originLicenseName: "SOUTH SEATTLE RETAIL HOLDING",
      isDeleted: false,
    });
    // No manifest id → no row (there is nothing to join on — never guess).
    const blank = MANIFEST_HEADER_HEADER.split("\t").map(() => "");
    expect(mapManifestHeader(blank, idx)).toBeNull();
  });

  it("mapTransportedItem parses the real row shape (Task I I4)", () => {
    const idx = headerIndexMap(TRANSPORTED_ITEMS_HEADER.split("\t"));
    const cells = TRANSPORTED_ITEMS_HEADER.split("\t").map(() => "");
    cells[0] = "19923862"; // TransportedItemsID
    cells[1] = "RM-1769188030"; // ExternalManifestIdentifier
    cells[2] = "LOT.752489.9ba888"; // InventoryExternalIdentifier
    cells[4] = "PLAIDJACKET - Miracle Alien"; // Description
    cells[23] = "True"; // IsDeleted
    expect(mapTransportedItem(cells, idx)).toEqual({
      externalManifestIdentifier: "RM-1769188030",
      inventoryExternalIdentifier: "LOT.752489.9ba888",
      description: "PLAIDJACKET - Miracle Alien",
      isDeleted: true,
    });
  });
});

// ---------------------------------------------------------------------------
// streamTable + decodeStream — end-to-end over real byte fixtures
// ---------------------------------------------------------------------------

function byteStreamOf(bytes: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let off = 0; off < bytes.byteLength; off += chunkSize) {
        controller.enqueue(bytes.subarray(off, Math.min(off + chunkSize, bytes.byteLength)));
      }
      controller.close();
    },
  });
}

describe("streamTable over UTF-16 tab-delimited bytes", () => {
  it("detects licensee + maps rows, across awkward chunk boundaries", async () => {
    const text = `${LICENSEE_HEADER}${CRLF}${GREENWAY_ROW}${CRLF}`;
    const bytes = utf16le(text);
    const rows: Array<ReturnType<typeof mapLicensee>> = [];
    // chunkSize 7 is deliberately odd: it splits UTF-16 code units across reads.
    const result = await streamTable(decodeStream(byteStreamOf(bytes, 7)), (kind, cells, idx) => {
      if (kind === "licensee") rows.push(mapLicensee(cells, idx));
    });
    expect(result.kind).toBe("licensee");
    expect(result.rowCount).toBe(1);
    expect(rows[0]?.licenseNumber).toBe("413541");
    expect(rows[0]?.dba).toBe("GREENWAY MARIJUANA");
  });

  it("reports unknown tables without inventing rows", async () => {
    const text = `Weird\tColumns\tHere${CRLF}a\tb\tc${CRLF}`;
    const seen: string[] = [];
    const result = await streamTable(decodeStream(byteStreamOf(utf16le(text))), (kind) => {
      seen.push(kind);
    });
    expect(result.kind).toBe("unknown");
    expect(result.rowCount).toBe(1);
    expect(seen).toEqual([]); // onRow never called for unknown tables
  });
});

// ---------------------------------------------------------------------------
// zip.ts — byte-exact zip fixtures (stored + deflate), nested archive flow
// ---------------------------------------------------------------------------

/** Minimal zip writer for fixtures: local headers + central directory + EOCD. */
function buildZip(files: Array<{ name: string; data: Uint8Array; method: 0 | 8 }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const payload = f.method === 8 ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, f.method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, f.method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);

    chunks.push(local, payload);
    central.push(cen);
    offset += local.length + payload.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe("zip reader", () => {
  it("reads entries + round-trips stored and deflate payloads", async () => {
    const a = new TextEncoder().encode("hello stored");
    const b = utf16le(`${STRAIN_HEADER}${CRLF}77\t42\tLemon Cherry Runtz\tHybrid\t\tFalse\t\t\t\t${CRLF}`);
    const zip = buildZip([
      { name: "stored.txt", data: a, method: 0 },
      { name: "Strains_0.csv", data: b, method: 8 },
    ]);
    const blob = bytesAsBlob(zip);
    const entries = await readZipEntries(blob);
    expect(entries.map((e) => e.name)).toEqual(["stored.txt", "Strains_0.csv"]);
    expect(await readZipEntryBytes(blob, entries[0])).toEqual(a);
    expect(await readZipEntryBytes(blob, entries[1])).toEqual(b);
  });

  it("streams a deflate entry incrementally", async () => {
    const text = `${SALE_DETAIL_HEADER}${CRLF}1\t2\t3\t\t1.00\t9.99\t.00\t.00\t.00\tx\tFalse\t\t\t\t${CRLF}`;
    const data = utf16le(text);
    const zip = buildZip([{ name: "SalesDetail_0.csv", data, method: 8 }]);
    const blob = bytesAsBlob(zip);
    const [entry] = await readZipEntries(blob);
    const stream = await openZipEntryStream(blob, entry);
    const rows: Array<ReturnType<typeof mapSaleDetail>> = [];
    const res = await streamTable(decodeStream(stream), (kind, cells, idx) => {
      if (kind === "sale_detail") rows.push(mapSaleDetail(cells, idx));
    });
    expect(res.kind).toBe("sale_detail");
    expect(rows).toHaveLength(1);
    expect(rows[0].unitPriceMinor).toBe(999);
  });

  it("handles the NESTED zip flow (outer zip → inner table zip → UTF-16 csv)", async () => {
    const csv = utf16le(`${SALE_HEADER_HEADER}${CRLF}1\t736\t\tRecreationalRetail\t2026-05-01 00:00:00\t\tFalse\t\t\t\t${CRLF}`);
    const inner = buildZip([{ name: "SaleHeader_0.csv", data: csv, method: 8 }]);
    const outer = buildZip([
      { name: "May 2026 CCRS Monthly Reports/CCRS PRR (6-2-26)/SaleHeader_0.zip", data: inner, method: 8 },
    ]);

    const outerBlob = bytesAsBlob(outer);
    const outerEntries = await readZipEntries(outerBlob);
    expect(outerEntries).toHaveLength(1);
    expect(tableNameFromZipEntry(outerEntries[0].name)).toBe("saleheader");

    const innerBytes = await readZipEntryBytes(outerBlob, outerEntries[0]);
    const innerBlob = bytesAsBlob(innerBytes);
    const innerEntries = await readZipEntries(innerBlob);
    expect(innerEntries.map((e) => e.name)).toEqual(["SaleHeader_0.csv"]);

    const stream = await openZipEntryStream(innerBlob, innerEntries[0]);
    const rows: Array<ReturnType<typeof mapSaleHeader>> = [];
    const res = await streamTable(decodeStream(stream), (kind, cells, idx) => {
      if (kind === "sale_header") rows.push(mapSaleHeader(cells, idx));
    });
    expect(res.kind).toBe("sale_header");
    expect(rows[0]?.sellerLicenseeId).toBe("736");
    expect(rows[0]?.saleType).toBe("retail");
    expect(rows[0]?.saleDate).toBe("2026-05-01");
  });

  it("rejects non-zip bytes with a precise error (never guess)", async () => {
    await expect(readZipEntries(bytesAsBlob(new TextEncoder().encode("this is not a zip file at all, definitely more than 22 bytes")))).rejects.toThrow(
      /end-of-central-directory/,
    );
  });
});

/**
 * Quoted-CSV coverage — REGRESSION GUARD for a real defect found against the
 * REAL December 2025 extract.
 *
 * The Licensee table ships COMMA-delimited AND QUOTED while every other table
 * is tab-delimited and unquoted. 50 of 150 sampled licensee rows (33%) carry
 * quoted commas. The previous naive `line.split(",")` shifted every later cell
 * left by one, so Name/DBA/City/County were read from the WRONG columns:
 * `"GAFCO, LLC"` yielded name '"GAFCO', dba 'LLC"', city null, county
 * '982235399' (a ZIP code). All fixtures below are VERBATIM real rows.
 */
describe("splitDelimited (RFC-4180 quotes)", () => {
  it("keeps a quoted delimiter inside the field", () => {
    expect(splitDelimited('a,"b,c",d', ",")).toEqual(["a", "b,c", "d"]);
  });

  it("unwraps quotes without keeping them", () => {
    expect(splitDelimited('"GAFCO, LLC",PUFFIN FARM', ",")).toEqual(["GAFCO, LLC", "PUFFIN FARM"]);
  });

  it("treats a doubled quote as one literal quote", () => {
    expect(splitDelimited('"say ""hi""",x', ",")).toEqual(['say "hi"', "x"]);
  });

  it("preserves empty fields exactly", () => {
    expect(splitDelimited("a,,b", ",")).toEqual(["a", "", "b"]);
    expect(splitDelimited('a,"",b', ",")).toEqual(["a", "", "b"]);
  });

  it("keeps a mid-field quote verbatim (never 'repairs' it)", () => {
    expect(splitDelimited('5" pipe,x', ",")).toEqual(['5" pipe', "x"]);
  });

  it("is byte-identical to split() on unquoted tab lines (hot path)", () => {
    const line = "8330042\t7680101\t1299906\t\t1.00\t.00\t.00";
    expect(splitDelimited(line, "\t")).toEqual(line.split("\t"));
  });

  it("handles tab-delimited lines that do contain a quote character", () => {
    expect(splitDelimited('a\t"b\tc"\td', "\t")).toEqual(["a", "b\tc", "d"]);
  });
});

describe("licensee parsing — REAL December 2025 rows with quoted commas", () => {
  const HEADER =
    "LicenseStatus,LicenseeId,UBI,LicenseNumber,Name,DBA,LicenseIssueDate,LicenseExpirationDate,ExternalIdentifier,IsDeleted,Address1,Address2,City,State,ZipCode,County,EmailAddress,PhoneNumber,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate";

  // Verbatim rows from Michael's real December 2025 extract sample.
  const ROW_QUOTED_NAME =
    'Active,8,6033508340010001,413021    ,"GAFCO, LLC",PUFFIN FARM,2024-12-05,2025-11-30,NULL,0,23930 OSO LOOP RD STE X,,ARLINGTON,WA,982235399,SNOHOMISH,cyrenas@gmail.com,NULL,LoadLicenseeETL,2021-12-02 08:32:50.137,proc_UpdateExistingLicenses,2025-11-20 04:50:39.643';
  const ROW_QUOTED_ADDR2 =
    'Active,9,6047608990010001,416626    ,VANCOUVER GARDENS LLC,VANCOUVER GARDENS LLC,2025-09-11,2026-06-30,NULL,0,931 GOERIG RD STE C,"D, E",WOODLAND,WA,986749376,COWLITZ,royalkind.co@gmail.com,NULL,LoadLicenseeETL,2021-12-02 08:32:50.137,proc_UpdateExistingLicenses,2025-09-11 04:45:37.730';
  const ROW_PLAIN =
    'Active,22,6035601210010004,079720    ,FILLABONG INC,FILLABONG,2025-11-13,2026-11-30,NULL,0,3249 PERRY AVE STE B,,BREMERTON,WA,98310    ,KITSAP,snaytammy@yahoo.com,NULL,LoadLicenseeETL,2021-12-06 09:09:34.420,proc_UpdateExistingLicenses,2025-11-13 04:50:45.510';

  async function parseLicensees(rows: string[]) {
    const text = [HEADER, ...rows].join("\r\n") + "\r\n";
    async function* chunks() {
      yield text;
    }
    const out: ReturnType<typeof mapLicensee>[] = [];
    const res = await streamTable(chunks(), (kind, cells, idx) => {
      if (kind === "licensee") out.push(mapLicensee(cells, idx));
    });
    return { out, res };
  }

  it("detects the comma-delimited licensee table", async () => {
    const { res } = await parseLicensees([ROW_PLAIN]);
    expect(res.kind).toBe("licensee");
    expect(res.rowCount).toBe(1);
  });

  it("reads a quoted company name without splitting it", async () => {
    const { out } = await parseLicensees([ROW_QUOTED_NAME]);
    expect(out[0]).toEqual({
      licenseeId: "8",
      licenseNumber: "413021",
      name: "GAFCO, LLC",
      dba: "PUFFIN FARM",
      status: "Active",
      city: "ARLINGTON",
      county: "SNOHOMISH",
    });
  });

  it("does not let a quoted Address2 shift City/County (county must not be a ZIP)", async () => {
    const { out } = await parseLicensees([ROW_QUOTED_ADDR2]);
    expect(out[0]?.city).toBe("WOODLAND");
    expect(out[0]?.county).toBe("COWLITZ");
    expect(out[0]?.county).not.toMatch(/^\d+$/);
  });

  it("still parses unquoted rows correctly", async () => {
    const { out } = await parseLicensees([ROW_PLAIN]);
    expect(out[0]?.name).toBe("FILLABONG INC");
    expect(out[0]?.city).toBe("BREMERTON");
    expect(out[0]?.county).toBe("KITSAP");
  });

  it("trims the space-padded LicenseNumber", async () => {
    const { out } = await parseLicensees([ROW_QUOTED_NAME, ROW_PLAIN]);
    expect(out.map((r) => r?.licenseNumber)).toEqual(["413021", "079720"]);
  });
});
