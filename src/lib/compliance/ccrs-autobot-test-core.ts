/**
 * src/lib/compliance/ccrs-autobot-test-core.ts  (D254)
 *
 * PURE. The PREprod practice set for the assisted uploader ("autobot"):
 * seven one-row CCRS files, one per upload type, that reference only each
 * other, so CCRS PREproduction can accept them on an empty or a busy
 * account.
 *
 * Owner (D254, verbatim): "please provide for me 7 test files to upload to
 * the preprod env to test the autobot. one for each batch."
 *
 * Every identifier carries one tag (GWT + the Pacific file stamp), so a new
 * set never collides with an earlier one ("Duplicate External Identifier"
 * was CCRS's answer to a re-used Area id, 2026-11-18).
 *
 *   Group 1  Strain, Area, Product      (new names, Insert)
 *   Group 2  Inventory                  (one lot of 10, naming the three above)
 *   Group 3  InventoryAdjustment        (1 unit, Reconciliation)
 *            InventoryTransfer          (vendor -> us, into the same lot; the
 *                                        vendor lot does not exist in PREprod,
 *                                        so "Invalid FromInventoryExternalIdentifier"
 *                                        [G L1191] is the expected answer: T-50)
 *            Sale                       (3 x 5.00 - 3.00; the PREprod T-40 numbers)
 *
 * No cell holds a comma (CCRS splits on every comma), the files are CRLF and
 * NumberRecords is 1. The bytes are made by assembleCcrsFile, the same
 * assembler the weekly batch uses.
 */
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileStamp,
  verifyCcrsBatch,
  CCRS_COLUMNS,
  CCRS_UPLOAD_ORDER,
  type CcrsRetailerFileType,
} from "./ccrs-batch-core";
import { planOutboxFiles, verifyOutboxAgainstLedger, type OutboxSourceFile } from "./ccrs-outbox-core";
import { buildLedgerView } from "./ccrs-ledger-core";

/** The vendor license on our real transfers (11/02/2026 file). */
export const AUTOBOT_TEST_VENDOR_LICENSE = "424980";

export const AUTOBOT_TEST_TAG_RE = /^GWT\d{14}$/;

/** GWT + YYYYMMDDHHMMSS (Pacific), e.g. GWT20261118181700. */
export function autobotTestTag(now: Date): string {
  return `GWT${ccrsFileStamp(now)}`;
}

export type AutobotTestIds = {
  tag: string;
  strain: string;
  area: string;
  areaId: string;
  productName: string;
  productId: string;
  lotId: string;
  adjustmentId: string;
  vendorLotId: string;
  transferId: string;
  saleId: string;
  saleLineId: string;
};

export function autobotTestIds(tag: string): AutobotTestIds {
  if (!AUTOBOT_TEST_TAG_RE.test(tag)) throw new Error(`autobot test tag must look like GWT + 14 digits (got ${JSON.stringify(tag)})`);
  const lotId = `${tag}-LOT`;
  return {
    tag,
    strain: `GW Test Strain ${tag}`,
    area: `GW Test Area ${tag}`,
    areaId: `${tag}-AREA`,
    productName: `GW Test Flower ${tag} 1g`,
    productId: `${tag}-PROD`,
    lotId,
    adjustmentId: `${tag}-ADJ`,
    vendorLotId: `${tag}-VENDOR`,
    // C1: a transfer's ExternalIdentifier IS our lot id, no suffix [EXAM2 L0056].
    transferId: lotId,
    saleId: `${tag}-SALE`,
    saleLineId: `${tag}-SALE-1`,
  };
}

/** What CCRS should answer for each file (shown in the manifest and the hub). */
export const AUTOBOT_TEST_EXPECT: Record<CcrsRetailerFileType, string> = {
  Strain: "success",
  Area: "success",
  Product: "success",
  Inventory: "success",
  InventoryAdjustment: "success",
  InventoryTransfer: "probably an error email: \"Invalid FromInventoryExternalIdentifier\" (the vendor lot is made up; this is test T-50). Any answer is fine for the test: the run only needs CCRS to answer.",
  Sale: "success",
};

/**
 * The seven files, in upload order. `now` dates every row and names the tag;
 * pass the same `now` to planOutboxFiles so file names and ids agree.
 */
export function buildAutobotTestSources(opts: {
  licenseNumber: string;
  submittedBy: string;
  now: Date;
  tag?: string;
}): { ids: AutobotTestIds; files: OutboxSourceFile[] } {
  const lic = opts.licenseNumber.trim();
  const by = opts.submittedBy.trim();
  if (!/^\d{6}$/.test(lic)) throw new Error(`license number must be 6 digits (got ${JSON.stringify(opts.licenseNumber)})`);
  if (!by) throw new Error("SubmittedBy is empty: set it in license settings");
  const ids = autobotTestIds(opts.tag ?? autobotTestTag(opts.now));
  const d = ccrsDate(opts.now);
  const rows: Record<CcrsRetailerFileType, string[]> = {
    Strain: [lic, ids.strain, "Hybrid", by, d],
    Area: [lic, ids.area, "FALSE", ids.areaId, by, d, "", "", "Insert"],
    Product: [lic, "EndProduct", "Usable Cannabis", ids.productName, "Autobot practice product (D254)", "1", ids.productId, by, d, "", "", "Insert"],
    Inventory: [lic, ids.strain, ids.area, ids.productName, "10", "10", "10.00", "FALSE", ids.lotId, by, d, "", "", "Insert"],
    InventoryAdjustment: [lic, ids.lotId, "Reconciliation", "Autobot practice count (D254)", "1", d, ids.adjustmentId, by, d, "", "", "Insert"],
    InventoryTransfer: [AUTOBOT_TEST_VENDOR_LICENSE, lic, ids.vendorLotId, ids.lotId, "10", d, ids.transferId, by, d, "", "", "Insert"],
    // PREprod T-40 (accepted 2026-09-17): 3 x 5.00 - 3.00 = 12.00; tax 1.20; excise 37% = 4.44.
    Sale: [lic, "", ids.lotId, "", "RecreationalRetail", d, "3", "5.00", "3.00", "1.20", "4.44", ids.saleId, ids.saleLineId, by, d, "", "", "Insert"],
  };
  const files = CCRS_UPLOAD_ORDER.map((type) => {
    if (rows[type].length !== CCRS_COLUMNS[type].length) throw new Error(`${type} test row has ${rows[type].length} cells, template has ${CCRS_COLUMNS[type].length}`);
    return { type, csv: assembleCcrsFile({ type, submittedBy: by, submittedDate: opts.now, rows: [rows[type]] }) };
  });
  return { ids, files };
}

/* ------------------------------------------------------------------ *
 * Self-tests (run via tsx / vitest). Pure: no I/O.
 * ------------------------------------------------------------------ */
export function __runCcrsAutobotTestCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[ccrs-autobot-test-core] FAIL: ${m}`);
    }
  };
  const now = new Date("2026-11-19T02:17:05Z"); // 11/18/2026 18:17:05 Pacific
  const tag = autobotTestTag(now);
  ok(tag === "GWT20261118181705", `tag is GWT + Pacific stamp (got ${tag})`);
  const { ids, files } = buildAutobotTestSources({ licenseNumber: "413541", submittedBy: "Michael Lyman", now });
  ok(files.length === 7, "seven files");
  ok(files.map((f) => f.type).join(",") === "Strain,Area,Product,Inventory,InventoryAdjustment,InventoryTransfer,Sale", "one of each type, upload order");
  ok(verifyCcrsBatch(files).ok, `the batch verifier passes: ${JSON.stringify(verifyCcrsBatch(files).problems.slice(0, 2))}`);
  ok(files.every((f) => f.csv.split("\r\n").length === 6 && f.csv.endsWith("\r\n") && !/[^\r]\n/.test(f.csv)), "CRLF, four header lines and one data line each");
  ok(files.every((f) => f.csv.split("\r\n")[2] === "NumberRecords,1"), "NumberRecords is 1");
  ok(files.every((f) => f.csv.split("\r\n")[4].split(",").length === CCRS_COLUMNS[f.type].length), "no comma inside a cell");
  ok(files.every((f) => f.csv.split("\r\n")[1] === "SubmittedDate,11/18/2026"), "dated the Pacific day");
  const row = (t: CcrsRetailerFileType) => files.find((f) => f.type === t)!.csv.split("\r\n")[4].split(",");
  const col = (t: CcrsRetailerFileType, c: string) => row(t)[CCRS_COLUMNS[t].indexOf(c)];
  ok(col("Inventory", "Strain") === ids.strain && col("Inventory", "Area") === ids.area && col("Inventory", "Product") === ids.productName, "the lot names this set's strain, area and product");
  ok(col("InventoryAdjustment", "InventoryExternalIdentifier") === ids.lotId && col("Sale", "InventoryExternalIdentifier") === ids.lotId, "adjustment and sale name this set's lot");
  ok(col("InventoryTransfer", "ToInventoryExternalIdentifier") === ids.lotId && col("InventoryTransfer", "ExternalIdentifier") === ids.lotId, "transfer goes into our lot and is identified by it (C1)");
  ok(col("InventoryTransfer", "FromLicenseNumber") === AUTOBOT_TEST_VENDOR_LICENSE && col("InventoryTransfer", "ToLicenseNumber") === "413541", "transfer is vendor -> us");
  ok(col("Sale", "CannabisExciseTax") === "4.44" && col("Sale", "SaleType") === "RecreationalRetail", "retail sale carries non-zero excise (E50)");
  ok(files.every((f) => { const r = f.csv.split("\r\n")[4].split(","); const i = CCRS_COLUMNS[f.type].indexOf("Operation"); return i < 0 || r[i] === "Insert"; }), "every row is an Insert");
  ok(col("Product", "Name").length <= 75, "product name within 75");
  const other = buildAutobotTestSources({ licenseNumber: "413541", submittedBy: "Michael Lyman", now: new Date(now.getTime() + 60_000) });
  ok(other.ids.lotId !== ids.lotId && other.ids.strain !== ids.strain && other.ids.areaId !== ids.areaId && other.ids.productId !== ids.productId, "a later set never re-uses an id");
  const fixed = buildAutobotTestSources({ licenseNumber: "413541", submittedBy: "Michael Lyman", now, tag: "GWT20990101000000" });
  ok(fixed.ids.lotId === "GWT20990101000000-LOT", "an explicit tag is used");
  let threw = 0;
  for (const bad of ["GWT1", "XYZ20261118181705", "GWT2026111818170,"]) {
    try { autobotTestIds(bad); } catch { threw += 1; }
  }
  ok(threw === 3, "a malformed tag is refused");
  let licThrew = false;
  try { buildAutobotTestSources({ licenseNumber: "", submittedBy: "x", now }); } catch { licThrew = true; }
  ok(licThrew, "no license number, no files");
  let byThrew = false;
  try { buildAutobotTestSources({ licenseNumber: "413541", submittedBy: " ", now }); } catch { byThrew = true; }
  ok(byThrew, "no SubmittedBy, no files");
  const planned = planOutboxFiles(files, { licenseNumber: "413541", now, lastStamp: new Date("2026-11-19T03:00:00Z") });
  ok(planned.length === 7 && planned.every((f, i) => i === 0 || f.stampAt.getTime() > planned[i - 1].stampAt.getTime()), "planned stamps rise in upload order");
  ok(planned[0].stampAt.getTime() > Date.parse("2026-11-19T03:00:00Z"), "stamps come after the env's last stamp");
  ok(verifyOutboxAgainstLedger(buildLedgerView("preprod", []).view, planned).length === 0, "the set passes the ledger self-check on an empty ledger (each file only names earlier files)");
  const held = buildLedgerView("preprod", [{ fileType: "Inventory", externalId: ids.lotId, filedName: null, state: "filed" }]).view;
  ok(verifyOutboxAgainstLedger(held, planned).some((p) => p.code === "L_INSERT_ON_FILE"), "the self-check would catch a re-used lot id");
  ok(Object.keys(AUTOBOT_TEST_EXPECT).length === 7 && AUTOBOT_TEST_EXPECT.InventoryTransfer.includes("Invalid FromInventoryExternalIdentifier"), "expected answers cover all seven; transfer marked");
  return { passed, failed };
}
