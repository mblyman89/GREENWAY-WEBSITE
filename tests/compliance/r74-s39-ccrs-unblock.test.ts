/**
 * R74 S39 - "we cant block good records from being uploaded".
 * Held-back records (left out of the files, tracked as owed) never block the
 * zip; anything that would put a bad row INTO the files still does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runCcrsHeldBackTests, heldRecordsOf } from "@/lib/compliance/ccrs-held-back-core";
import { assertCcrsBatchSubmittable, isHeldBack, __runCcrsSubmitGateTests } from "@/lib/compliance/ccrs-submit-gate-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S39 CCRS unblock", () => {
  it("pure self-tests pinned", () => {
    expect(__runCcrsHeldBackTests()).toEqual({ passed: 10, failed: 0 });
    expect(__runCcrsSubmitGateTests().failed).toBe(0);
  });

  it("the owner's production + PREprod screens are now submittable with a held list", () => {
    const v = assertCcrsBatchSubmittable({
      syncIssues: [
        { severity: "error", file: "Inventory", message: "849 Cultivera lots", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD", rows: [{ id: "L1", label: "Lot 1", detail: "not on record" }] },
        { severity: "error", file: "Product", message: "1000 products", code: "E41_LEDGER_WITHHELD", rows: [{ id: "P1", label: "P1" }] },
        { severity: "error", file: "Sale", message: "2 sale rows", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S1", label: "S1" }] },
      ],
      verifierProblems: [],
      files: [],
    });
    expect(v.submittable).toBe(true);
    expect(v.heldCount).toBe(3);
    expect(heldRecordsOf(v.held).map((r) => `${r.t}:${r.id}`)).toEqual(["Inventory:L1", "Product:P1", "Sale:S1"]);
  });

  it("a bad row still blocks", () => {
    expect(isHeldBack({ severity: "error", code: "L_REF_INVENTORY" })).toBe(false);
    expect(isHeldBack({ severity: "error" })).toBe(false);
    expect(CCRS_ISSUE_CODES).toContain("E56_EVENT_ROW_LOT_HELD");
    expect(specPinFor("E56_EVENT_ROW_LOT_HELD")).toBe("[G L1302-L1304]");
  });

  it("wiring: paged menu + adjustments, chunked id assignment, owed list recorded on emit", () => {
    expect(read("src/lib/compliance/ccrs-batch.ts")).toMatch(/pagedAll<MenuItemRow>/);
    expect(read("src/lib/compliance/ccrs-inventory-adjustment.ts")).toMatch(/pagedAll<unknown>/);
    expect(read("src/lib/compliance/ccrs-ledger-store.ts")).toMatch(/ASSIGN_CHUNK = 500/);
    const route = read("src/app/admin/reports/compliance/batch-export/route.ts");
    expect(route).toMatch(/recordHeldBack\(admin, env, range\.fromDate, heldRecordsOf\(verdict\.held\)\)/);
    expect(route).toMatch(/HELD BACK/);
    expect(read("src/app/admin/compliance/ccrs/page.tsx")).toMatch(/ccrs-still-owed/);
    expect(read("supabase/migrations/0297_ccrs_held_sync.sql")).toMatch(/ccrs_record_held/);
  });
});
