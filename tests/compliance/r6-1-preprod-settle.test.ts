/**
 * tests/compliance/r6-1-preprod-settle.test.ts   (Round 6 / Slice R6-1)
 *
 * The owner's first end-to-end PREprod upload, 2026-10-20 (evidence:
 * docs/ccrs-bible/evidence/2026-10-20-real-upload/). 4 of 6 files succeeded;
 * Strain and Inventory came back with error files. These tests pin what the
 * real bytes say and what the hub does with them:
 *
 *   1. Strain: 11 rows "Duplicate Strain". Benign by design [G L0325-L0326]:
 *      classifyEcho -> error-benign, nothing to fix.
 *   2. Inventory: 13 of 18 Inserts "Duplicate External Identifier". An Insert
 *      creates "a new record with a unique external identifier" [G L0246], so
 *      PREprod already held the 13: classifyEcho -> error-rows, 13 uncertain.
 *   3. The 13 refused lots are EXACTLY the lots whose strain was a Duplicate
 *      Strain: the same vendor lots had been filed by an earlier PREprod test,
 *      while our PREprod ledger started empty (0249 ccrs_preprod_ledger_start).
 *   4. The Sale file was ACCEPTED and named 4 of the 13. CCRS refuses a Sale
 *      naming inventory it does not hold [G L1302-L1304], so those 4 are proved
 *      on file: the rule ccrs_prove_by_reference (0284) applies.
 *   5. PREprod cannot be reset: "NO, you can request a copy from the Service
 *      Desk for what has been reported to Preproduction and clean or work
 *      around the data." [EXAM L0518] -> the PREprod-only settle button.
 *
 * The SQL itself is proven on Postgres by scripts/recon/ccrs-settle-0284-pg-check.sql
 * (CI: POST_APPLY_CHECKS); this file pins the wiring and the evidence.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyEcho, type OurRow } from "@/lib/compliance/ccrs-outcome-core";
import {
  decodePreprodSettle,
  decodeProveByReference,
  FILE_STATE_TEXT,
  lifecycleErrorText,
  pendingDuplicateCount,
  settleSummaryText,
} from "@/lib/compliance/ccrs-lifecycle-core";
import { STRATEGY_PLAYBOOK } from "@/lib/compliance/ccrs-strategy-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const EV = path.join(ROOT, "docs/ccrs-bible/evidence/2026-10-20-real-upload");
const read = (rel: string) => readFileSync(path.join(EV, rel), "utf8");
const md5 = (rel: string) => createHash("md5").update(readFileSync(path.join(EV, rel))).digest("hex");
const SRC = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Data lines of a sent CCRS file (3 header rows + column row), split on commas. */
function sentRows(rel: string): Record<string, string>[] {
  const lines = read(rel).split("\r\n").filter((l) => l !== "");
  const cols = lines[3].split(",");
  return lines.slice(4).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
}
/** Our rows of a sent file as the outbox stores them (row_no from 1). */
function ourRows(rel: string, idCol: string): OurRow[] {
  return sentRows(rel).map((r, i) => ({ rowNo: i + 1, externalId: r[idCol], operation: r.Operation ?? null }));
}

const INV_SENT = "sent/Inventory_413541_20261020165831.csv";
const STRAIN_SENT = "sent/Strain_413541_20261020165828.csv";
const SALE_SENT = "sent/Sale_413541_20261020165833.csv";
const INV_ERR = "errors/Inventory__20261020T171203677_failed.csv";
const STRAIN_ERR = "errors/Strain_20261020T170115355_failed.csv";

describe("evidence: the real 2026-10-20 bytes are the ones analysed", () => {
  it("file hashes", () => {
    expect(md5(STRAIN_SENT)).toMatch(/^378b4fe6/);
    expect(md5(INV_SENT)).toMatch(/^61c325f0/);
    expect(md5(STRAIN_ERR)).toMatch(/^2fedaefe/);
    expect(md5(INV_ERR)).toMatch(/^a6fce1a4/);
  });
  it("18 Inventory Inserts sent, 14 strains sent, 7 sale lines sent", () => {
    expect(sentRows(INV_SENT)).toHaveLength(18);
    expect(sentRows(INV_SENT).every((r) => r.Operation === "Insert")).toBe(true);
    expect(sentRows(STRAIN_SENT)).toHaveLength(14);
    expect(sentRows(SALE_SENT)).toHaveLength(7);
  });
});

describe("Strain: Duplicate Strain is benign [G L0325-L0326]", () => {
  it("classifyEcho -> error-benign, 11 rows, nothing uncertain", () => {
    const v = classifyEcho("Strain", ourRows(STRAIN_SENT, "Strain"), read(STRAIN_ERR));
    expect(v.outcome).toBe("error-benign");
    expect(v.messages).toEqual(["Duplicate Strain. The Strain must be unique for the LicenseNumber"]);
    expect(v.rejected).toEqual([]);
  });
});

describe("Inventory: Duplicate External Identifier on Insert makes 13 lots uncertain [G L0246]", () => {
  const v = classifyEcho("Inventory", ourRows(INV_SENT, "ExternalIdentifier"), read(INV_ERR));
  const sent = sentRows(INV_SENT);
  const refused = v.rejected.map((r) => sent[r.row_no - 1].ExternalIdentifier).sort();

  it("error-rows, 13 rejected, every one uncertain, one message", () => {
    expect(v.outcome).toBe("error-rows");
    expect(v.rejected).toHaveLength(13);
    expect(v.rejected.every((r) => r.uncertain)).toBe(true);
    expect(v.messages).toEqual(["Duplicate External Identifier"]);
  });

  it("the 5 accepted lots are the ones the hand diagnosis named", () => {
    const accepted = sent.map((r) => r.ExternalIdentifier).filter((id) => !refused.includes(id)).sort();
    expect(accepted).toEqual(["21375127410682809", "21375127499408998", "21375127714797798", "21375127729537320", "21375127733003150"]);
  });

  it("the 13 refused lots are exactly the lots whose strain CCRS called Duplicate Strain", () => {
    const lines = read(STRAIN_ERR).split(/\r?\n/).filter((l) => l !== "");
    const head = lines[0].split(",");
    const si = head.indexOf("Strain");
    const dupStrains = new Set(lines.slice(1).map((l) => l.split(",")[si].toLowerCase()));
    const byDupStrain = sent.filter((r) => dupStrains.has(r.Strain.toLowerCase())).map((r) => r.ExternalIdentifier).sort();
    expect(byDupStrain).toEqual(refused);
  });

  it("the accepted Sale named 4 refused lots: proof by reference [G L1302-L1304]", () => {
    const named = new Set(sentRows(SALE_SENT).map((r) => r.InventoryExternalIdentifier));
    const proved = refused.filter((id) => named.has(id)).sort();
    expect(proved).toEqual(["21375127433073461", "21375127720298989", "WA413287-INE6AQ", "WA413287-INUKZB"]);
  });

  it("the issue message 0249 writes for them is what the PREprod button looks for", () => {
    // 0249 ccrs_record_outcome: 'row ' || row_no || ' (' || external_id || '): ' || message
    const issues = v.rejected.map((r) => ({
      fileId: "inv",
      code: r.uncertain ? "CCRS_ROW_CONTRADICTS_LEDGER" : "CCRS_ROW_REJECTED",
      message: `row ${r.row_no} (${sent[r.row_no - 1].ExternalIdentifier}): ${r.message}`,
    }));
    expect(pendingDuplicateCount([{ id: "inv", state: "reconciling" }], issues)).toBe(13);
    expect(pendingDuplicateCount([{ id: "inv", state: "closed" }], issues)).toBe(0);
    expect(SRC("supabase/migrations/0284_ccrs_settle_uncertain.sql")).toContain("i.message like '%: Duplicate External Identifier'");
    expect(SRC("supabase/migrations/0249_ccrs_upload_lifecycle.sql")).toContain("'row ' || r.row_no || ' (' || r.external_id || '): ' || (x->>'message')");
  });
});

describe("0284 decoders refuse anything garbled", () => {
  it("prove", () => {
    expect(decodeProveByReference("preprod", { env: "preprod", proved: ["A", "B"], files_closed: 1 })).toEqual({ env: "preprod", proved: ["A", "B"], filesClosed: 1 });
    expect(() => decodeProveByReference("prod", { env: "preprod", proved: [], files_closed: 0 })).toThrow(/another env/);
    expect(() => decodeProveByReference("prod", { env: "prod", proved: [""], files_closed: 0 })).toThrow(/proved/);
    expect(() => decodeProveByReference("prod", { env: "prod", proved: [], files_closed: -1 })).toThrow(/files_closed/);
    expect(() => decodeProveByReference("prod", null)).toThrow();
  });
  it("settle (PREprod only, Inventory/Product/Area only)", () => {
    expect(decodePreprodSettle({ env: "preprod", settled: [["Inventory", "L1"], ["Area", "A1"]], files_closed: 2 }).settled).toEqual([
      { fileType: "Inventory", externalId: "L1" },
      { fileType: "Area", externalId: "A1" },
    ]);
    expect(() => decodePreprodSettle({ env: "prod", settled: [], files_closed: 0 })).toThrow(/PREprod/);
    expect(() => decodePreprodSettle({ env: "preprod", settled: [["Strain", "x"]], files_closed: 0 })).toThrow(/entry/);
    expect(() => decodePreprodSettle({ env: "preprod", settled: [["Inventory", "x"], ["Inventory", "x"]], files_closed: 0 })).toThrow(/duplicates/);
  });
  it("operator text", () => {
    expect(settleSummaryText({ settled: [{}, {}], filesClosed: 1 })).toBe("2 PREprod id(s) treated as on file; 1 file(s) closed. They go out as Update next time.");
    expect(settleSummaryText({ proved: ["a"], filesClosed: 0 })).toContain("proved on file by an accepted sale");
    expect(lifecycleErrorText("CCRS_SETTLE_BY: who settled it is recorded")).toMatch(/^Who settled/);
    expect(lifecycleErrorText("CCRS_SETTLE_BAD_ENV: x")).toMatch(/^Only PREprod or production/);
    expect(FILE_STATE_TEXT.reconciling).toContain("Settle PREprod duplicates");
  });
});

describe("wiring", () => {
  const actions = SRC("src/app/admin/compliance/ccrs/actions.ts");
  const mail = SRC("src/app/admin/compliance/ccrs/mail-actions.ts");
  const store = SRC("src/lib/compliance/ccrs-ledger-store.ts");
  const panel = SRC("src/components/admin/compliance/CcrsFilesPanel.tsx");
  const page = SRC("src/app/admin/compliance/ccrs/page.tsx");

  it("the proof runs after every recorded success / error answer (paste and email)", () => {
    expect(actions.match(/await proveAfterOutcome\(admin, env\)/g)).toHaveLength(2);
    expect(mail.match(/await proveAfterOutcome\(admin, env\)/g)).toHaveLength(2);
  });
  it("a failed proof never hides a recorded answer (proveAfterOutcome catches)", () => {
    const fn = store.slice(store.indexOf("export async function proveAfterOutcome"));
    expect(fn).toContain("} catch (e) {");
    expect(fn).toContain("it runs again after the next answer");
  });
  it("the settle action is settings.manage, audited, PREprod only", () => {
    const fn = actions.slice(actions.indexOf("export async function settlePreprodDuplicatesAction"));
    expect(fn.slice(0, 200)).toContain('requirePermission("settings.manage")');
    expect(fn).toContain('action: "ccrs.preprod.settle_duplicates"');
    expect(fn).toContain('backTo(weekKey, "preprod"');
    expect(store).toContain('admin.rpc("ccrs_preprod_settle_duplicates", { p_by: by })');
  });
  it("the panel shows the button only in PREprod and the page passes the action", () => {
    expect(panel).toContain('const dupes = p.env === "preprod" ? pendingDuplicateCount(p.files, p.issues) : 0;');
    expect(panel).toContain("Settle PREprod duplicates");
    expect(page).toContain("settlePreprodDuplicates: settlePreprodDuplicatesAction,");
    expect(store).toContain('"I_PROVED_BY_REFERENCE", "I_PREPROD_SETTLED"');
  });
  it("the playbook tells the owner about both new routes and still never says re-send as Insert", () => {
    const fix = STRATEGY_PLAYBOOK["Duplicate External Identifier"].fix.join(" ");
    expect(fix).toContain("Settle PREprod duplicates");
    expect(fix).toContain("later Sale or Adjustment that CCRS accepted");
    expect(fix).toContain("servicedesk@lcb.wa.gov");
    expect(fix).toContain("Never re-send it as Insert");
  });
  it("CI runs the 0284 Postgres scenario check", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-settle-0284-pg-check.sql", mustPrint: "CCRS 0284 CHECK PASSED" });
  });
  it("0284: production is refused by the settle function, grants are service role only", () => {
    const m = SRC("supabase/migrations/0284_ccrs_settle_uncertain.sql");
    expect(m).toContain("where e.env = 'preprod' and e.state = 'uncertain'");
    expect(m).toContain("and g.uploaded_at > uf.uploaded_at");
    expect(m).not.toMatch(/security definer\s*\n\s*as/i);
    expect(m).toContain("revoke all on function public.ccrs_preprod_settle_duplicates(text) from public, anon, authenticated;");
  });
});
