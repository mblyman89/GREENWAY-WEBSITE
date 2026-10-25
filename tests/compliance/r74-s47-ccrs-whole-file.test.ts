/**
 * R74 S47 (Round 27): the 2026-10-25 week. CCRS refused the whole Product file
 * ("has not been processed", no error CSV); Inventory then failed "Invalid
 * Product" and Sale "Invalid InventoryExternalIdentifier".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runCcrsWholeFileTests, ccrsUnitWeightCell, parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";
import { classifyCcrsMail } from "@/lib/compliance/ccrs-mail-core";

const ROOT = path.resolve(__dirname, "../..");
const EV = "docs/ccrs-bible/evidence/2026-10-25-week";
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("R74 S47 whole-file refusal", () => {
  it("pure core self-tests", () => {
    const r = __runCcrsWholeFileTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(17);
  });

  it("every weight in the refused Product file becomes a CCRS-readable cell", () => {
    const lines = read(`${EV}/sent/Product_413541_20261025122117.EXTRACT.txt`).split("\r\n").filter(Boolean);
    const hdr = lines[0].split(",");
    const w = hdr.indexOf("UnitWeightGrams");
    const t = hdr.indexOf("InventoryType");
    const rows = lines.slice(1).map((l) => l.split(","));
    expect(rows.filter((r) => r[w] === "")).toHaveLength(14);
    for (const r of rows) expect(ccrsUnitWeightCell(r[w], r[t])).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it("the real email body is read as a refusal of our Product file", () => {
    const body = read(`${EV}/not-processed-email.txt`);
    expect(parseNotProcessed(body)).toEqual(["Product_413541_20261025122117.csv"]);
    const a = classifyCcrsMail({
      gmailId: "g", threadId: null, receivedAt: null, from: "info@lcb.wa.gov", subject: "PRE: CCRS Processing Error",
      text: body, labelIds: [], authResults: [], csvs: [], skippedAttachments: [],
    });
    expect(a.kind).toBe("unknown");
    expect(a.needsHuman.join(" ")).toContain("Record as not processed");
  });

  it("wiring: Product build writes the safe cell; both answer paths record error-fatal", () => {
    expect(read("src/lib/compliance/ccrs-batch.ts")).toContain("ccrsUnitWeightCell(grams, type)");
    expect(read("src/app/admin/compliance/ccrs/mail-actions.ts")).toContain('recordOutcome(admin, f.id, "error-fatal", at, [], [NOT_PROCESSED_MESSAGE])');
    expect(read("src/app/admin/compliance/ccrs/actions.ts")).toContain('recordOutcome(admin, file.id, "error-fatal", at, [], [NOT_PROCESSED_MESSAGE])');
  });
});
