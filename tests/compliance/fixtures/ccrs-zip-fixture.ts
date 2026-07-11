/**
 * tests/compliance/fixtures/ccrs-zip-fixture.ts
 *
 * Shared byte-exact CCRS zip fixture builders (Task H, S14). The zip writer
 * and UTF-16-LE encoder replicate the in-test helpers proven in
 * ccrs-extract-parse.test.ts; the table headers are the VERIFIED May-2026
 * extract headers (exact column order from the real files). Extracted here so
 * the worker-runner tests can build full synthetic nested deliveries (outer
 * zip → inner table zips → UTF-16 csv) without duplicating the byte format.
 */
import { deflateRawSync } from "node:zlib";

/** Encode text as UTF-16-LE, optionally with the FF FE BOM (extract default). */
export function utf16le(text: string, withBom = true): Uint8Array {
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

export const CRLF = "\r\n";

/** Verified May-2026 headers (exact column order from the real extract). */
export const LICENSEE_HEADER =
  "LicenseStatus\tLicenseeId\tUBI\tLicenseNumber\tName\tDBA\tLicenseIssueDate\tLicenseExpirationDate\tExternalIdentifier\tIsDeleted\tAddress1\tAddress2\tCity\tState\tZipCode\tCounty\tEmailAddress\tPhoneNumber\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

export const SALE_HEADER_HEADER =
  "SaleHeaderId\tLicenseeId\tSoldToLicenseeId\tSaleType\tSaleDate\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

export const SALE_DETAIL_HEADER =
  "SaleDetailId\tSaleHeaderId\tInventoryId\tPlantId\tQuantity\tUnitPrice\tDiscount\tSalesTax\tOtherTax\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

export const PRODUCT_HEADER =
  "ProductId\tLicenseeId\tInventoryType\tName\tDescription\tUnitWeightGrams\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

export const INVENTORY_HEADER =
  "LicenseeId\tInventoryId\tStrainId\tAreaId\tProductId\tInventoryIdentifier\tInitialQuantity\tQuantityOnHand\tTotalCost\tIsMedical\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tupdatedDate";

export const STRAIN_HEADER =
  "StrainId\tLicenseeId\tName\tStrainType\tExternalIdentifier\tIsDeleted\tCreatedBy\tCreatedDate\tUpdatedBy\tUpdatedDate";

/** Greenway's real Licensee row (verified byte-for-byte in Task H). */
export const GREENWAY_ROW =
  "Active\t736\t6033535550010001\t413541    \tLYMAN'S MARIJUANA L.L.C.\tGREENWAY MARIJUANA\t2025-10-27\t2026-11-30\t\tFalse\t4851 GEIGER RD SE\t\tPORT ORCHARD\tWA\t98366    \tKITSAP\tMICHAEL@GREENWAYMARIJUANA.COM\t\tLoadLicenseeETL\t2021-12-06 09:09:34.420000000\tproc_UpdateExistingLicenses\t2025-10-28 04:52:12.467000000";

/** A retailer licensee row in the same column order (fixture identities). */
export function licenseeRow(opts: {
  licenseeId: string;
  licenseNumber: string;
  name: string;
  dba?: string;
  city?: string;
}): string {
  return `Active\t${opts.licenseeId}\t\t${opts.licenseNumber}\t${opts.name}\t${opts.dba ?? ""}\t2020-01-01\t2027-01-01\t\tFalse\tADDR\t\t${opts.city ?? "PORT ORCHARD"}\tWA\t98366\tKITSAP\t\t\tETL\t\tETL\t`;
}

/** Minimal zip writer: local headers + central directory + EOCD (stored/deflate). */
export function buildZip(files: Array<{ name: string; data: Uint8Array; method: 0 | 8 }>): Uint8Array {
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

/** Build an inner CCRS table zip: one UTF-16-LE csv, deflate-compressed. */
export function tableZip(csvName: string, lines: string[]): Uint8Array {
  return buildZip([{ name: csvName, data: utf16le(lines.join(CRLF) + CRLF), method: 8 }]);
}
