/**
 * S-17b (CCRS Bible Part 17 §C.4 defect 1, §K.3/§K.4; Part 12 U-60, U-62).
 *
 * 1. The "lots reference products not in the published menu" warning compared
 *    the lot's product KEY with Product column 6, which after applyProductPlan
 *    holds the CCRS id (GWP-… or a filed id). Production 2026-10-19 said
 *    "(38)" for 38 lots whose products were in Product.csv. It now compares
 *    keys with the ledger plan, says WHY (hidden + reason / staged / no item /
 *    blank key / id collision) and lists every lot.
 * 2. The E41 Inventory row "its product is not in the published menu" carries
 *    the same explanation, and keeps its S-17a class.
 * 3. The hub/report now run the export route's ledger self-check, so a Sale
 *    naming a lot CCRS does not hold and this batch does not report
 *    ("Invalid InventoryExternalIdentifier" [G L1302-L1304]) blocks on screen,
 *    not only in the refused download.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CCRS_COLUMNS, type CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";
import {
  NO_PRODUCT_ID_REASON,
  applyProductPlan,
  buildLedgerView,
  planLedgerBatch,
  type LedgerEntry,
} from "@/lib/compliance/ccrs-ledger-core";
import {
  LOT_PRODUCT_NOT_IN_MENU_REASON,
  MISSING_PRODUCT_CLASSES,
  __runCcrsLotProductTests,
  enrichLotWithholdReason,
  explainMissingProduct,
  e47Message,
  keysNeedingMenuLookup,
  legacyLotsWithBlankProduct,
  lotsWithProductNotInMenu,
  lotsWithheldForMissingProduct,
  menuPresenceFromRows,
} from "@/lib/compliance/ccrs-lot-product-core";
import {
  LEDGER_PROBLEM_PIN,
  ledgerSelfCheckIssues,
  planOutboxFiles,
  verifyOutboxAgainstLedger,
} from "@/lib/compliance/ccrs-outbox-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import { classifyWithholdReason, issuePlainText } from "@/lib/compliance/ccrs-issue-display-core";
import { assertCcrsBatchSubmittable, toGateInput } from "@/lib/compliance/ccrs-submit-gate-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const BATCH = read("src/lib/compliance/ccrs-batch.ts");
const LCORE = read("src/lib/compliance/ccrs-ledger-core.ts");
/*
 * The LCB guide text lives outside the repo (lcb/guide.txt, md5 in Part 13).
 * As in ccrs-preflight.test.ts, the lines this slice cites are embedded
 * VERBATIM (bullet glyphs and indentation trimmed). Where the guide file is
 * present (the build sandbox; check_pins.py reads the same file) the embedded
 * text is re-checked against it line by line, so it cannot drift.
 */
const GUIDE_FILE = path.resolve(ROOT, "../lcb/guide.txt");
const GUIDE_LINES: Record<number, string> = {
  246: "Insert (create a new record with a unique external identifier).",
  247: "Update (alter an existing record indicated by external identifier).",
  248: "Delete (delete a record indicated by external identifier).",
  555: "Invalid Strain",
  570: "Invalid Area",
  578: "Product is required",
  579: "Invalid Product",
  580: "Note: If you receive this error message, ensure you have already",
  581: "submitted this product on the product.CSV, and validate that you have",
  582: "submitted this product name in the same format and spelling as previously",
  583: "submitted on the product.CSV",
  1302: "Invalid InventoryExternalIdentifier",
  1303: "Note: If you have received this error, ensure that you have already reported the",
  1304: "inventory in an inventory.CSV",
};
const guideLine = (n: number): string => {
  const t = GUIDE_LINES[n];
  if (t === undefined) throw new Error(`guide line L${n} is not embedded in this test`);
  return t;
};

// ── Fixtures ───────────────────────────────────────────────────────────────
const HDR = "SubmittedBy,G\r\nSubmittedDate,10/19/2026\r\n";
const mk = (t: CcrsRetailerFileType, rows: string[]) =>
  `${HDR}NumberRecords,${rows.length}\r\n${CCRS_COLUMNS[t].join(",")}\r\n${rows.map((r) => r + "\r\n").join("")}`;
const byName = (t: CcrsRetailerFileType, v: Record<string, string>) =>
  CCRS_COLUMNS[t]
    .map((c) => {
      if (!(c in v)) throw new Error(`fixture lacks ${t} column ${c}`);
      return v[c];
    })
    .join(",");
const invRow = (id: string, op: string, product: string) =>
  byName("Inventory", {
    LicenseNumber: "413541", Strain: "Blue Dream", Area: "Sales Floor", Product: product, InitialQuantity: "5", QuantityOnHand: "2",
    TotalCost: "30.00", IsMedical: "FALSE", ExternalIdentifier: id, CreatedBy: "G", CreatedDate: "10/14/2026", UpdatedBy: "G",
    UpdatedDate: "10/19/2026", Operation: op,
  });
const saleRow = (lot: string, n = 1) =>
  byName("Sale", {
    LicenseNumber: "413541", SoldToLicenseNumber: "", InventoryExternalIdentifier: lot, PlantExternalIdentifier: "",
    SaleType: "RecreationalRetail", SaleDate: "10/15/2026", Quantity: "1", UnitPrice: "25.00", Discount: "0",
    RetailSalesTax: "2.18", CannabisExciseTax: "9.25", SaleExternalIdentifier: `GWS-${n}`, SaleDetailExternalIdentifier: `GWS-${n}-${lot}`,
    CreatedBy: "G", CreatedDate: "10/15/2026", UpdatedBy: "", UpdatedDate: "", Operation: "Insert",
  });
const ledgerOf = (rows: Partial<LedgerEntry>[], productIdByKey = new Map<string, string>()) =>
  buildLedgerView(
    "prod",
    rows.map((r) => ({ fileType: "Inventory", externalId: "x", filedName: null, state: "seed", productExternalId: null, ...r }) as LedgerEntry),
    productIdByKey,
  ).view;
const OPTS = { licenseNumber: "413541", now: new Date("2026-10-19T19:00:00Z"), lastStamp: null };

describe("embedded self-tests", () => {
  it("ccrs-lot-product-core self-tests pass", () => {
    const r = __runCcrsLotProductTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(13);
  });
});

describe("U-60: the old column-6 comparison was wrong; the plan-key comparison is right", () => {
  // Real planner + applyProductPlan, the 2026-10-19 production shape: products
  // assigned GWP- ids are emitted (column 6 = GWP-…), one product is withheld.
  const keys = ["K1", "K2", "K3"];
  const view = ledgerOf([{ fileType: "Area", externalId: "C1", filedName: "Sales Floor" }], new Map([["K1", "GWP-000051"], ["K2", "GWP-000052"]]));
  const plan = planLedgerBatch({
    view,
    lots: [
      { lotId: "1", label: "L1", inventoryExternalId: "NEW-1", productKey: "K1", strain: "" },
      { lotId: "2", label: "L2", inventoryExternalId: "NEW-2", productKey: "K2", strain: "" },
      { lotId: "3", label: "L3", inventoryExternalId: "NEW-3", productKey: "K3", strain: "" },
      { lotId: "4", label: "L4", inventoryExternalId: "NEW-4", productKey: "GONE", strain: "" },
    ],
    products: keys.map((k) => ({ key: k, legacyId: k, ourName: `Name ${k}` })),
    strains: [],
  });
  const iExt = CCRS_COLUMNS.Product.indexOf("ExternalIdentifier");
  const rawRows = keys.map((k) => CCRS_COLUMNS.Product.map((c) => (c === "ExternalIdentifier" ? k : c === "Name" ? `Name ${k}` : c === "Operation" ? "Insert" : "x")));
  const applied = applyProductPlan(rawRows, keys, plan);

  it("fixture really is the production shape: emitted rows carry GWP- ids in column 6, K3 withheld for no id", () => {
    expect(iExt).toBe(6);
    expect(applied.rows.map((r) => r[iExt])).toEqual(["GWP-000051", "GWP-000052"]);
    expect(applied.withheld).toEqual([{ key: "K3", label: "Name K3", reason: NO_PRODUCT_ID_REASON }]);
  });
  it("the OLD rule (lot key vs column 6) reports all 4 lots — the false '(38)'", () => {
    const col6 = new Set(applied.rows.map((r) => r[6]));
    const old = new Set(["K1", "K2", "K3", "GONE"].filter((k) => !col6.has(k)));
    expect(old.size).toBe(4);
  });
  it("the NEW rule reports only the key with no product plan, once, with its lots and why", () => {
    const presence = menuPresenceFromRows(true, keys, [], []);
    const lots = [
      { id: "1", label: "L1", productKey: "K1" },
      { id: "2", label: "L2", productKey: "K2" },
      { id: "3", label: "L3", productKey: "K3" },
      { id: "4", label: "L4", productKey: "GONE" },
      { id: "5", label: "L5", productKey: " GONE " },
    ];
    const rows = lotsWithProductNotInMenu(lots, new Set(plan.products.keys()), presence);
    expect(rows).toEqual([{ id: "GONE", label: "GONE", detail: 'no menu item has POS product key "GONE"; 2 lot(s): L4, L5' }]);
  });
  it("the withheld product's lot stays an E41 'its product is withheld' row (not double-reported as not-in-menu)", () => {
    const p3 = plan.lots.get("3");
    expect(p3).toEqual({ action: "withhold", reason: `its product is withheld: ${NO_PRODUCT_ID_REASON}` });
    const p4 = plan.lots.get("4");
    expect(p4).toEqual({ action: "withhold", reason: LOT_PRODUCT_NOT_IN_MENU_REASON });
  });
});

describe("E47 speaks only about lots the planner really left out (or, in legacy mode, wrote with a blank Product)", () => {
  // Real planner. L-FILED is a lot CCRS already holds (seed) whose product key
  // is no longer in the menu: the planner emits it as an Update under its FILED
  // product name, so it is NOT left out and must NOT be called "not in menu".
  const view = ledgerOf([
    { fileType: "Product", externalId: "P-OLD", filedName: "Old Product" },
    { fileType: "Inventory", externalId: "L-FILED", productExternalId: "P-OLD" },
    { fileType: "Inventory", externalId: "L-UNSURE", state: "uncertain", productExternalId: "P-OLD" },
  ]);
  const lotsIn = [
    { lotId: "f", label: "LF", inventoryExternalId: "L-FILED", productKey: "GONE", strain: "" },
    { lotId: "n", label: "LN", inventoryExternalId: "NEW-9", productKey: "GONE", strain: "" },
    { lotId: "u", label: "LU", inventoryExternalId: "L-UNSURE", productKey: "GONE", strain: "" },
    { lotId: "k", label: "LK", inventoryExternalId: "NEW-8", productKey: "K1", strain: "" },
  ];
  const products = [{ key: "K1", legacyId: "K1", ourName: "Name K1" }];
  const rows = [
    { id: "f", pos_product_key: "GONE" },
    { id: "n", pos_product_key: " GONE " },
    { id: "u", pos_product_key: "GONE" },
    { id: "k", pos_product_key: "K1" },
  ];
  it("fixture: the planner emits the filed lot, withholds the new one as not-in-menu, refuses the uncertain one for its own reason", () => {
    const plan = planLedgerBatch({ view, lots: lotsIn, products, strains: [] });
    expect(plan.lots.get("f")).toMatchObject({ action: "emit", op: "Update", productName: "Old Product" });
    expect(plan.lots.get("n")).toEqual({ action: "withhold", reason: LOT_PRODUCT_NOT_IN_MENU_REASON });
    expect(plan.lots.get("u")).toMatchObject({ action: "withhold" });
    expect(plan.lots.get("u")).not.toEqual({ action: "withhold", reason: LOT_PRODUCT_NOT_IN_MENU_REASON });
  });
  it("ledger mode: only the planner's not-in-menu lot is listed", () => {
    const plan = planLedgerBatch({ view, lots: lotsIn, products, strains: [] });
    expect(lotsWithheldForMissingProduct(rows, plan.lots).map((r) => r.id)).toEqual(["n"]);
  });
  it("legacy mode (no view): every emitted lot whose key has no product plan, i.e. written with a blank Product", () => {
    const plan = planLedgerBatch({ view: null, lots: lotsIn, products, strains: [] });
    expect(plan.lots.get("n")).toEqual({ action: "emit", op: "Insert", productName: "", strain: "" });
    const planned = new Set(plan.products.keys());
    expect(legacyLotsWithBlankProduct(rows, plan.lots, planned).map((r) => r.id)).toEqual(["f", "n", "u"]);
  });
  it("messages are honest per mode: left out (ledger) vs written blank and rejected [G L0578] (legacy)", () => {
    expect(e47Message(3, false)).toContain("their lots are left out of Inventory.csv");
    expect(e47Message(3, false)).not.toContain("[G L0578]");
    expect(e47Message(3, true)).toContain("WRITTEN to Inventory.csv with a blank Product");
    expect(e47Message(3, true)).toContain('"Product is required" [G L0578]');
    expect(guideLine(578)).toBe("Product is required");
  });
});

describe("explainMissingProduct: one class per proven fact, never guessed", () => {
  const p = menuPresenceFromRows(true, ["VIS"], [{ source_item_id: "HID", hidden_reason: "no_inventory" }, { source_item_id: "OWN", hidden_reason: "owner_override_hide:~" }], [{ source_item_id: "STG" }]);
  it.each([
    ["", "blank-key"],
    ["   ", "blank-key"],
    ["VIS", "visible-id-collision"],
    ["HID", "hidden-in-published"],
    ["OWN", "hidden-in-published"],
    ["STG", "staged-only"],
    ["NONE", "no-menu-item"],
  ] as const)("%j → %s", (k, cls) => {
    expect(explainMissingProduct(k, p).cls).toBe(cls);
  });
  it("hidden detail uses the menu's own plain-English reason (fact-review-core hiddenReasonText)", () => {
    expect(explainMissingProduct("HID", p).detail).toBe("hidden in the published menu: In the products file but has no inventory rows -- nothing to sell yet.");
    expect(explainMissingProduct("OWN", p).detail).toBe("hidden in the published menu: Hidden by the owner on the product page.");
  });
  it("no published version and unreadable menu are said as such", () => {
    expect(explainMissingProduct("X", menuPresenceFromRows(false, [], [], [])).cls).toBe("no-published-menu");
    const u = explainMissingProduct("X", { readable: false, error: "timeout" });
    expect(u).toEqual({ cls: "menu-unreadable", detail: "the menu could not be read to say why (timeout)" });
  });
  it("every class is reachable (no dead class in the list)", () => {
    const seen = new Set<string>([
      ...["", "VIS", "HID", "STG", "NONE"].map((k) => explainMissingProduct(k, p).cls),
      explainMissingProduct("X", menuPresenceFromRows(false, [], [], [])).cls,
      explainMissingProduct("X", { readable: false, error: "e" }).cls,
    ]);
    expect([...seen].sort()).toEqual([...MISSING_PRODUCT_CLASSES].sort());
  });
  it("keys needing a menu read exclude planned and blank keys, trimmed and de-duplicated", () => {
    const lots = [" A ", "A", "", "B", "P"].map((k, i) => ({ id: String(i), label: "", productKey: k }));
    expect(keysNeedingMenuLookup(lots, new Set(["P"]))).toEqual(["A", "B"]);
  });
});

describe("E41 lot detail enrichment keeps the S-17a class", () => {
  const p = menuPresenceFromRows(true, [], [{ source_item_id: "H", hidden_reason: "reviewer_rejected" }], []);
  it("planner's exact reason is enriched; class is still not-in-published-menu", () => {
    const d = enrichLotWithholdReason(LOT_PRODUCT_NOT_IN_MENU_REASON, "H", p);
    expect(d).toBe(`${LOT_PRODUCT_NOT_IN_MENU_REASON} (hidden in the published menu: Rejected by a reviewer in the fact-review queue -- will not reach the public menu.)`);
    expect(classifyWithholdReason(d)).toBe("not-in-published-menu");
  });
  it("other reasons and a null presence are untouched", () => {
    expect(enrichLotWithholdReason(`its product is withheld: ${NO_PRODUCT_ID_REASON}`, "H", p)).toBe(`its product is withheld: ${NO_PRODUCT_ID_REASON}`);
    expect(enrichLotWithholdReason(LOT_PRODUCT_NOT_IN_MENU_REASON, "H", null)).toBe(LOT_PRODUCT_NOT_IN_MENU_REASON);
  });
  it("the constant is the planner's literal string (read from ccrs-ledger-core)", () => {
    expect(LCORE).toContain(`: "${LOT_PRODUCT_NOT_IN_MENU_REASON}" });`);
  });
});

describe("hub ledger self-check = the export route's refusal (Part 17 §K.4)", () => {
  const HELD = ledgerOf([
    { fileType: "Product", externalId: "P1", filedName: "P One" },
    { fileType: "Strain", externalId: "Blue Dream", filedName: "Blue Dream" },
    { fileType: "Area", externalId: "C1100011", filedName: "Sales Floor" },
    { fileType: "Inventory", externalId: "L-SEED", productExternalId: "P1" },
    { fileType: "Inventory", externalId: "L-CLOSED", state: "closed", productExternalId: "P1" },
  ]);
  it("a Sale of a lot that is neither filed nor in this Inventory.csv → blocking L_REF_INVENTORY with every row", () => {
    const sources = [
      { type: "Inventory" as const, csv: mk("Inventory", [invRow("NEW-1", "Insert", "P One")]) },
      { type: "Sale" as const, csv: mk("Sale", [saleRow("L-SEED", 1), saleRow("NEW-1", 2), saleRow("WITHHELD-9", 3), saleRow("L-CLOSED", 4)]) },
    ];
    const issues = ledgerSelfCheckIssues(HELD, sources, OPTS);
    expect(issues).toHaveLength(1);
    const [i] = issues;
    expect(i).toMatchObject({ severity: "error", file: "Sale", code: "L_REF_INVENTORY", specPin: "[G L1302-L1304]", count: 2 });
    expect(i.rows.map((r) => r.label)).toEqual(["Sale_413541_20261019120001.csv row 3", "Sale_413541_20261019120001.csv row 4"]);
    expect(i.rows[0].detail).toContain("WITHHELD-9");
    expect(i.rows[1].detail).toContain("L-CLOSED");
    expect(i.message).toContain('"Invalid InventoryExternalIdentifier"');
  });
  it("same problems, same count as the route's verifyOutboxAgainstLedger (one source of truth)", () => {
    const sources = [
      { type: "Inventory" as const, csv: mk("Inventory", [invRow("L-SEED", "Insert", "P One"), invRow("NOPE", "Update", "Ghost")]) },
      { type: "Sale" as const, csv: mk("Sale", [saleRow("ZZ", 1)]) },
    ];
    const direct = verifyOutboxAgainstLedger(HELD, planOutboxFiles(sources, OPTS));
    const issues = ledgerSelfCheckIssues(HELD, sources, OPTS);
    expect(issues.reduce((a, i) => a + i.count, 0)).toBe(direct.length);
    expect(issues.map((i) => i.code).sort()).toEqual([...new Set(direct.map((p) => p.code))].sort());
  });
  it("one issue per (file, code): the same code in two files is two issues, each naming its own file", () => {
    const prodRow = byName("Product", Object.fromEntries(CCRS_COLUMNS.Product.map((c) => [c, c === "ExternalIdentifier" ? "P1" : c === "Name" ? "P One" : c === "Operation" ? "Insert" : c === "LicenseNumber" ? "413541" : "x"])));
    const sources = [
      { type: "Product" as const, csv: mk("Product", [prodRow]) },
      { type: "Inventory" as const, csv: mk("Inventory", [invRow("L-SEED", "Insert", "P One")]) },
    ];
    const issues = ledgerSelfCheckIssues(HELD, sources, OPTS);
    expect(issues.map((i) => `${i.file}:${i.code}:${i.count}`).sort()).toEqual(["Inventory:L_INSERT_ON_FILE:1", "Product:L_INSERT_ON_FILE:1"]);
    for (const i of issues) {
      expect(i.message).toContain(` ${i.file} row(s) are Insert`);
      expect(i.rows[0].label).toMatch(new RegExp(`^${i.file}_413541_\\d{14}\\.csv row \\d+$`));
    }
  });
  it("clean batch → no issues", () => {
    const sources = [{ type: "Sale" as const, csv: mk("Sale", [saleRow("L-SEED")]) }];
    expect(ledgerSelfCheckIssues(HELD, sources, OPTS)).toEqual([]);
  });
  it("issues go through the gate as blocking with rows intact (hub shows what the download would refuse)", () => {
    const sources = [{ type: "Sale" as const, csv: mk("Sale", [saleRow("X1", 1), saleRow("X2", 2)]) }];
    const v = assertCcrsBatchSubmittable({ syncIssues: ledgerSelfCheckIssues(HELD, sources, OPTS).map(toGateInput), verifierProblems: [], files: [] });
    expect(v.submittable).toBe(false);
    expect(v.errors[0].rows).toHaveLength(2);
    const text = issuePlainText(v.errors[0], "prod").join("\n");
    expect(text).toContain("[L_REF_INVENTORY]");
    expect(text).toContain("Every row (2):");
  });
  it("every self-check pin quotes the guide line it names", () => {
    const line = guideLine;
    const expectWord: Record<string, string> = {
      L_INSERT_ON_FILE: "Insert",
      L_UPDATE_NOT_ON_FILE: "Update",
      L_DELETE_NOT_ON_FILE: "Delete",
      L_REF_PRODUCT: "Invalid Product",
      L_REF_STRAIN: "Invalid Strain",
      L_REF_AREA: "Invalid Area",
      L_REF_INVENTORY: "Invalid InventoryExternalIdentifier",
      L_TOTALS: "Insert",
    };
    for (const [code, pin] of Object.entries(LEDGER_PROBLEM_PIN)) {
      const m = /^\[G L(\d{4})(?:-L\d{4})?\]$/.exec(pin);
      expect(m, `${code} pin ${pin}`).not.toBeNull();
      expect(line(Number(m![1])), `${code} ${pin}`).toContain(expectWord[code]);
    }
  });
});

describe("embedded guide lines equal lcb/guide.txt (checked wherever the file exists)", () => {
  it.runIf(existsSync(GUIDE_FILE))("every embedded line matches the file, glyphs and indentation trimmed", () => {
    const g = readFileSync(GUIDE_FILE, "utf8").split("\n");
    for (const [n, text] of Object.entries(GUIDE_LINES)) {
      const raw = (g[Number(n) - 1] ?? "").replace(/^[\s\uf0a7\u25a0\u2022]+/, "").trimEnd();
      expect(raw, `L${n}`).toBe(text);
    }
  });
  it("the embedded set covers every pin this slice cites", () => {
    const cited = [...Object.values(LEDGER_PROBLEM_PIN), specPinFor("E47_LOT_PRODUCT_NOT_IN_MENU"), "[G L0578]"];
    for (const pin of cited) {
      const m = /^\[G L(\d{4})(?:-L(\d{4}))?\]$/.exec(pin);
      expect(m, pin).not.toBeNull();
      const a = Number(m![1]);
      const b = m![2] ? Number(m![2]) : a;
      for (let n = a; n <= b; n += 1) expect(GUIDE_LINES[n], `${pin} L${n}`).toBeDefined();
    }
  });
});

describe("E47 is a registered, pinned code", () => {
  it("in CCRS_ISSUE_CODES with pin [G L0579-L0583]", () => {
    expect(CCRS_ISSUE_CODES).toContain("E47_LOT_PRODUCT_NOT_IN_MENU");
    expect(specPinFor("E47_LOT_PRODUCT_NOT_IN_MENU")).toBe("[G L0579-L0583]");
    expect(guideLine(579)).toBe("Invalid Product");
    expect([580, 581, 582, 583].map(guideLine).join(" ")).toContain("submitted this product on the product.CSV");
  });
});

describe("ccrs-batch.ts wiring (source pins)", () => {
  it("the column-6 comparison is gone", () => {
    expect(BATCH).not.toContain("const productExtInFile = new Set(product.rows.map((r) => r[6]));");
    expect(BATCH).not.toContain('"Inventory lots reference products not present in the published menu (Product.csv)."');
  });
  it("the warning compares by plan keys and carries code + rows", () => {
    expect(BATCH).toContain("const plannedKeys = new Set(plan.products.keys());");
    expect(BATCH).toContain("const notInMenu = lotsWithProductNotInMenu(coverageLots, plannedKeys, menuPresence);");
    expect(BATCH).toContain("(ledger ? lotsWithheldForMissingProduct(lots, plan.lots) : legacyLotsWithBlankProduct(lots, plan.lots, plannedKeys))");
    expect(BATCH).toContain('severity: ledger ? "warning" : "error",');
    expect(BATCH).toContain("message: e47Message(notInMenu.length, !ledger),");
    expect(BATCH).toMatch(/code: "E47_LOT_PRODUCT_NOT_IN_MENU",\s*specPin: specPinFor\("E47_LOT_PRODUCT_NOT_IN_MENU"\),\s*count: notInMenu\.length,\s*rows: notInMenu,/);
  });
  it("E41 lot rows are enriched with the menu explanation", () => {
    expect(BATCH).toContain("detail: enrichLotWithholdReason(planned.reason, key, menuPresence) });");
    expect(BATCH).toContain("const inventory = buildInventoryFile(lots, license.licenseNumber, createdBy, plan, area.inventoryAreaName, menuPresence);");
  });
  it("the menu read fails closed to 'unreadable' (never treated as 'no item')", () => {
    expect(BATCH).toContain("if (failed) return { readable: false, error: failed };");
    expect(BATCH).toMatch(/\} catch \(e\) \{\s*return \{ readable: false, error:/);
    expect(BATCH).toContain('.eq("hidden", true)');
    expect(BATCH).toContain('.eq("status", "staged")');
  });
  it("the ledger self-check runs on the built files, only when a ledger view is loaded, before the return", () => {
    const iSelf = BATCH.indexOf("for (const i of ledgerSelfCheckIssues(");
    const iIf = BATCH.lastIndexOf("if (ledger) {", iSelf);
    const iRet = BATCH.indexOf("const totalRecords = files.reduce(");
    expect(iSelf).toBeGreaterThan(0);
    expect(iSelf - iIf).toBeLessThan(80);
    expect(iSelf).toBeLessThan(iRet);
    expect(BATCH).toContain("files.map((f) => ({ type: f.type, csv: f.csv })),");
    expect(BATCH).toContain("syncIssues.push(i);");
  });
});
