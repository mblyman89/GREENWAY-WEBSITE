/**
 * P-F (2026-10-31): the last three PREprod scoreboard tests, replayed against
 * the owner's exact files (docs/ccrs-bible/evidence/2026-10-31-preprod).
 *
 *   1. Product Update: the 8 rows CCRS refused ("UpdatedBy is required for
 *      Update or Delete Operations ...") had UpdatedBy/UpdatedDate blank. Now
 *      stamped [G L0234-L0242], and the last check refuses such a row.
 *   2. Inventory Update: the 6 rows CCRS refused ("Strain is required") had a
 *      blank Strain. Now filled (product, lot, then what CCRS accepted [EXAM2
 *      L0034-L0035]) or held back E64 [G L0551-L0554]; the last check
 *      refuses a blank Strain.
 *   3. Both messages are known now, so applying the error file records the
 *      rows as refused (error-rows), never error-unmatched / "unclear".
 *   4. Area: CCRS holds GWA-SALES-FLOOR since 10/20; a Duplicate answer to an
 *      Area Insert, or a settled record, counts as passed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CCRS_COLUMNS, assembleCcrsFile, ccrsReaderSplit, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { stampProductUpdates, __runCcrsLedgerCoreTests } from "@/lib/compliance/ccrs-ledger-core";
import { NO_STRAIN_REASON, fillBlankStrains, pickLotStrain, __runCcrsStrainFillTests } from "@/lib/compliance/ccrs-strain-fill-core";
import { CCRS_KNOWN_MESSAGES, classifyEcho } from "@/lib/compliance/ccrs-outcome-core";
import { STRATEGY_PLAYBOOK, buildCcrsStrategy } from "@/lib/compliance/ccrs-strategy-core";
import { readErrorAttachment } from "@/lib/compliance/ccrs-mail-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import { isHeldBack } from "@/lib/compliance/ccrs-submit-gate-core";
import { fixLinksFor } from "@/lib/compliance/ccrs-never-block-core";
import { SCORE_TESTS, SCOREBOARD_NEXT_STEP, scoreTest, __runCcrsScoreboardTests, type ScoreRow } from "@/lib/compliance/ccrs-scoreboard-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const EV = "docs/ccrs-bible/evidence/2026-10-31-preprod";
const SENT_PRODUCT = read(`${EV}/sent/Product_413541_20261031141036.csv`);
const SENT_INV = read(`${EV}/sent/Inventory_413541_20261031142647.csv`);
const ECHO_PRODUCT = read(`${EV}/errors/Product__20261031T185120035.csv`);
const ECHO_INV = read(`${EV}/errors/Inventory__20261031T182905659.csv`);
const dataRows = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(ccrsReaderSplit);
const CTX = { licenseNumber: "413541", licenseeName: "Greenway Marijuana", contactEmail: "michael@greenwaymarijuana.com" };
const BATCH = read("src/lib/compliance/ccrs-batch.ts");

describe("1. Product Update: UpdatedBy + UpdatedDate", () => {
  const rows = dataRows(SENT_PRODUCT);
  const C = CCRS_COLUMNS.Product;
  it("the file the owner sent: 8 Updates, both cells blank, and the last check now refuses every row", () => {
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r[C.indexOf("Operation")] === "Update" && r[C.indexOf("UpdatedBy")] === "" && r[C.indexOf("UpdatedDate")] === "")).toBe(true);
    const errs = verifyCcrsFile("Product", SENT_PRODUCT).filter((p) => p.severity === "error").map((p) => p.message);
    for (let n = 1; n <= 8; n += 1) {
      expect(errs).toContain(`Data row ${n}: UpdatedBy is required for an Update row [G L0234-L0236].`);
      expect(errs).toContain(`Data row ${n}: UpdatedDate is required for an Update row [G L0237-L0242].`);
    }
  });
  it("stamped, the same rows pass the last check (UpdatedDate = the batch day, never before CreatedDate)", () => {
    const fixed = stampProductUpdates(rows, { updatedBy: "Michael Lyman", batchDay: "10/31/2026" });
    expect(fixed.every((r) => r[C.indexOf("UpdatedBy")] === "Michael Lyman" && r[C.indexOf("UpdatedDate")] === "10/31/2026")).toBe(true);
    const csv = assembleCcrsFile({ type: "Product", submittedBy: "Michael Lyman", submittedDate: new Date("2026-10-31T21:00:00Z"), rows: fixed });
    expect(verifyCcrsFile("Product", csv).filter((p) => p.severity === "error")).toEqual([]);
  });
  it("an Insert row is never stamped (UpdatedBy/UpdatedDate stay blank on Insert, as CCRS accepted on 10/20)", () => {
    const ins = rows.map((r) => r.map((c, i) => (i === C.indexOf("Operation") ? "Insert" : c)));
    expect(stampProductUpdates(ins, { updatedBy: "X", batchDay: "10/31/2026" })).toEqual(ins);
  });
  it("the batch stamps every Product file after the plan (one line, the source guard stays)", () => {
    expect(BATCH).toContain("applyProductPlan(productBuild.rows, productBuild.keys, plan)");
    expect(BATCH).toContain("rows: stampProductUpdates(productPlanned.rows, { updatedBy: submittedBy, batchDay: createdDate })");
  });
  it("ledger self-tests (incl. the stamp)", () => expect(() => __runCcrsLedgerCoreTests()).not.toThrow());
});

describe("2. Inventory Update: never a blank Strain", () => {
  const rows = dataRows(SENT_INV);
  const C = CCRS_COLUMNS.Inventory;
  it("the file the owner sent: 6 Updates with a blank Strain, and the last check now refuses every row", () => {
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r[C.indexOf("Strain")] === "")).toBe(true);
    const errs = verifyCcrsFile("Inventory", SENT_INV).filter((p) => p.severity === "error").map((p) => p.message);
    for (let n = 1; n <= 6; n += 1) expect(errs).toContain(`Data row ${n}: Strain is required on every Inventory row [G L0551-L0554].`);
  });
  it("with CCRS's accepted strain known for a lot it is filled; with none it is held back E64 (never sent blank)", () => {
    const told = new Map([["GF41244605628871", "Grape Ape"]]);
    const r = fillBlankStrains(rows, (id) => told.get(id) ?? null);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0][C.indexOf("ExternalIdentifier")]).toBe("GF41244605628871");
    expect(r.rows[0][C.indexOf("Strain")]).toBe("Grape Ape");
    expect(r.held.map((h) => h.id).sort()).toEqual(["GF41918905566981", "GF41918905566983", "GF41918905566988", "GF41918905566989", "GF41918905566990"]);
    expect(r.held.every((h) => h.reason === NO_STRAIN_REASON)).toBe(true);
    const csv = assembleCcrsFile({ type: "Inventory", submittedBy: "Michael Lyman", submittedDate: new Date("2026-10-31T21:00:00Z"), rows: r.rows });
    expect(verifyCcrsFile("Inventory", csv).filter((p) => p.severity === "error")).toEqual([]);
  });
  it("the lot's own strain is used only when CCRS holds it or this batch files it (Valid Values: Strain.Strain)", () => {
    expect(pickLotStrain({ productStrain: "", lotStrain: "Oil Tanker", menuStrains: new Set(["Oil Tanker"]), view: null })).toBe("Oil Tanker");
    expect(pickLotStrain({ productStrain: "", lotStrain: "Oil Tanker", menuStrains: new Set(), view: null })).toBe("");
  });
  it("E64 is registered, pinned to the guide, held back (owed), and links to the product", () => {
    expect(CCRS_ISSUE_CODES).toContain("E64_INVENTORY_NO_STRAIN");
    expect(CCRS_ISSUE_CODES).toContain("E65_INVENTORY_STRAIN_FROM_CCRS");
    expect(specPinFor("E64_INVENTORY_NO_STRAIN")).toBe("[G L0551-L0554]");
    expect(isHeldBack({ severity: "error", code: "E64_INVENTORY_NO_STRAIN" })).toBe(true);
    expect(fixLinksFor({ code: "E64_INVENTORY_NO_STRAIN", file: "Inventory" }, { id: "pos-123" })[0]).toEqual({ label: "Product page", href: "/admin/products/pos-123" });
  });
  it("the batch: lot strain_name read, plan uses pickLotStrain, fill runs before the delta", () => {
    expect(BATCH).toMatch(/const LOT_COLUMNS =\s*"[^"]*, strain_name";/);
    expect(BATCH).toContain("strain: pickLotStrain({");
    expect(BATCH.indexOf("const strainFill = fillBlankStrains(")).toBeLessThan(BATCH.indexOf("const delta = planInventoryDelta("));
    expect(BATCH).toContain('code: "E64_INVENTORY_NO_STRAIN"');
  });
  it("strain-fill self-tests", () => expect(() => __runCcrsStrainFillTests()).not.toThrow());
});

describe("3. Applying the error files: known messages, rows refused (not unclear)", () => {
  const ourRows = (csv: string, type: "Product" | "Inventory") =>
    dataRows(csv).map((r, i) => ({ rowNo: i + 1, externalId: r[CCRS_COLUMNS[type].indexOf("ExternalIdentifier")], operation: r[CCRS_COLUMNS[type].indexOf("Operation")] }));
  it("Product echo -> error-rows, 8 of 8 refused, none uncertain", () => {
    const v = classifyEcho("Product", ourRows(SENT_PRODUCT, "Product"), ECHO_PRODUCT);
    expect(v.outcome).toBe("error-rows");
    expect(v.rejected).toHaveLength(8);
    expect(v.rejected.every((r) => !r.uncertain)).toBe(true);
  });
  it("Inventory echo -> error-rows, 6 of 6 refused with \"Strain is required\"", () => {
    const v = classifyEcho("Inventory", ourRows(SENT_INV, "Inventory"), ECHO_INV);
    expect(v.outcome).toBe("error-rows");
    expect(v.rejected).toHaveLength(6);
    expect(v.messages).toEqual(["Strain is required"]);
  });
  it("the strategy report explains both files with no examiner draft", () => {
    for (const [name, text] of [["Product__20261031T185120035.csv", ECHO_PRODUCT], ["Inventory__20261031T182905659.csv", ECHO_INV]] as const) {
      const s = buildCcrsStrategy([readErrorAttachment(name, text)!], CTX);
      expect(s.files[0].scope).toBe("listed-rows");
      expect(s.examinerDraft).toBeNull();
    }
  });
  it("the four new texts are known row errors with a playbook entry citing the guide", () => {
    for (const t of ["UpdatedBy is required for Update or Delete Operations", "UpdatedDate is required for Update or Delete Operations", "UpdatedDate must be a date for Update and Delete operations", "Strain is required"]) {
      expect(CCRS_KNOWN_MESSAGES.find((m) => m.text === t)?.cls).toBe("row");
      expect(STRATEGY_PLAYBOOK[t].action).toBe("fix-resend");
      expect(STRATEGY_PLAYBOOK[t].cite.join(" ")).toMatch(/\[G L0(23|55)/);
    }
  });
});

describe("4. Scoreboard: Area held = passed; failures in CCRS's words", () => {
  const row = (o: Partial<ScoreRow>): ScoreRow => ({ rowState: "uncertain", fileState: "reconciling", fileName: "F.csv", operation: "Insert", payload: {}, answeredAt: "2026-10-27T18:00:00Z", ...o });
  const t = (id: string) => SCORE_TESTS.find((x) => x.id === id)!;
  it("the owner's 10/27 Area file (Duplicate External Identifier on GWA-SALES-FLOOR) now shows PASSED", () => {
    const r = scoreTest(t("area"), [row({ fileName: "Area_413541_20261027101136.csv", messages: ["row 1 (GWA-SALES-FLOOR): Duplicate External Identifier"] })]);
    expect(r.status).toBe("passed");
    expect(r.lastPass).toMatchObject({ fileName: "Area_413541_20261027101136.csv", how: "held" });
  });
  it("after Settle PREprod duplicates (record filed) the Area shows PASSED even with no message", () => {
    expect(scoreTest(t("area"), [row({ fileState: "closed", entityState: "filed" })]).status).toBe("passed");
  });
  it("Product Update and Inventory Update failures quote CCRS and say what to do", () => {
    const pu = scoreTest(t("product-update"), [row({ operation: "Update", messages: [ECHO_PRODUCT.split("\r\n")[1].split(",Update,")[1].split(",")[0]] })]);
    expect(pu.failure!.why).toContain('CCRS answered "UpdatedBy is required for Update or Delete Operations');
    expect(pu.failure!.why).toContain("Export PREprod again");
    const lu = scoreTest(t("lot-update"), [row({ operation: "Update", messages: ["row 1 (GF41918905566983): Strain is required"] })]);
    expect(lu.failure!.why).toBe(`CCRS answered "Strain is required": ${SCOREBOARD_NEXT_STEP["Strain is required"]}`);
  });
  it("every next-step key is a message CCRS really sent; nothing on the board says unclear", () => {
    const known = new Set(CCRS_KNOWN_MESSAGES.map((m) => m.text));
    for (const k of Object.keys(SCOREBOARD_NEXT_STEP)) expect(known.has(k), k).toBe(true);
    const core = read("src/lib/compliance/ccrs-scoreboard-core.ts").split("export function __runCcrsScoreboardTests")[0];
    expect(core).not.toMatch(/answer is unclear/);
  });
  it("the store reads the row's CCRS message and the record's state, still bounded", () => {
    const store = read("src/lib/compliance/ccrs-scoreboard-store.ts");
    expect(store).toContain("ccrs_filed_entities(state), ccrs_file_issues(code, message)");
    expect(store).toContain("error_messages");
  });
  it("scoreboard self-tests", () => expect(__runCcrsScoreboardTests().failed).toBe(0));
});
