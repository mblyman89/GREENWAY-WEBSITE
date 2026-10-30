/**
 * CCRS C1 (2026-10-30): the examiner's answers 9b/9c built in.
 *
 *   D-1: the InventoryTransfer ExternalIdentifier is our reported inventory id
 *        ITSELF, no "TR-" suffix/prefix [EXAM2 L0056]. Transfers filed before
 *        C1 under "TR-<id>" are still recognised as reported (never re-sent).
 *   D-2: a newly received lot keeps the vendor's own id (trusted source, no
 *        collision) so returns and recalls trace back [EXAM2 L0056].
 *   D-3: a transfer CCRS accepted whose facts changed is corrected with an
 *        Update carrying the same ExternalIdentifier [EXAM2 L0058] [G L0247],
 *        only after the owner approves exactly those values (E63).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CcrsIssueList } from "@/components/admin/compliance/CcrsIssueList";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import { HELD_BACK_CODES } from "@/lib/compliance/ccrs-submit-gate-core";
import {
  LEGACY_TRANSFER_ID_PREFIX,
  TRANSFER_BLOCKING,
  TRANSFER_TOLD_RPC,
  approveTransferCorrection,
  buildTransferRows,
  decodeTransferTold,
  e63RowId,
  normalizeTransferApprovals,
  parseE63RowId,
  transferCorrectionFingerprint,
  transferCorrectionSettingKey,
  transferExternalId,
  transferLookupIds,
  transferSummaryText,
  transferUpdatedDate,
  withdrawTransferCorrection,
  type TransferHeld,
  type TransferInput,
  type TransferLot,
  type TransferTold,
} from "@/lib/compliance/ccrs-transfer-core";
import { TRUSTED_INTAKE_ID_SOURCES, __runCcrsIntakeIdTests, intakeIdCandidates, intakeInventoryExternalId } from "@/lib/compliance/ccrs-intake-id-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const EXAM2 = SRC("docs/ccrs-bible/evidence/2026-10-29-examiner-answers/brian-answers-verbatim.txt").split("\n");
const EX = (n: number) => EXAM2[n - 1];
const TC = CCRS_COLUMNS.InventoryTransfer;
const col = (row: readonly string[], name: string) => row[TC.indexOf(name)];

const lot = (o: Partial<TransferLot> = {}): TransferLot => ({
  lotId: "L1",
  manifestId: "M1",
  label: "Lot 1",
  ourId: "WA417068.IN1",
  vendorId: "WA417068.IN1",
  vendorIdSource: "wcia_json",
  vendorLicense: "417068",
  receivedQty: 24,
  receivedOn: "2026-11-03",
  disposition: "accepted",
  isCultivera: false,
  ...o,
});
const input = (o: Partial<TransferInput> = {}): TransferInput => ({
  lots: [lot()],
  licenseNumber: "413541",
  createdBy: "Greenway",
  fromDay: "2026-11-01",
  toDay: "2026-11-07",
  notBefore: "2026-11-01",
  catchUp: false,
  held: null,
  reportable: new Set(["WA417068.IN1"]),
  ...o,
});
const held = (entries: [string, TransferHeld | null][]) => new Map(entries);
const FILED: TransferHeld = { state: "filed", inFlight: false };
/** What CCRS accepted: the Insert row as a column -> value map, with overrides. */
const toldOf = (o: Record<string, string> = {}): Record<string, string> => {
  const r = buildTransferRows(input()).rows[0];
  return { ...Object.fromEntries(TC.map((c, i) => [c, r[i]])), ...o };
};
const loaded = (t: TransferTold) => ({ kind: "loaded" as const, byId: new Map([["WA417068.IN1", t]]) });

describe("C1 grounding: the examiner's words, verbatim", () => {
  it("9b: no suffix; keep the vendor's id for returns and recalls [EXAM2 L0056]", () => {
    expect(EX(55)).toContain('9b. ExternalIdentifier "TR-" + our inventory id?');
    expect(EX(56)).toContain("you can not have a suffix on this file");
    expect(EX(56)).toContain("doing a return");
    expect(EX(56)).toContain("if a recall happens");
  });
  it("9c: corrections go by Update [EXAM2 L0058]", () => {
    expect(EX(57)).toContain("Correct a filed transfer by Update with same ExternalIdentifier?");
    expect(EX(58)).toContain("Yes, the update path is the correct way to make corrections.");
  });
  it("check_pins knows the EXAM2 source", () => {
    expect(SRC("scripts/ccrs-bible/check_pins.py")).toContain("2026-10-29-examiner-answers/brian-answers-verbatim.txt");
  });
});

describe("D-1: transfer ExternalIdentifier = our lot id, no prefix", () => {
  it("an Insert carries ExternalIdentifier === ToInventoryExternalIdentifier", () => {
    const r = buildTransferRows(input()).rows[0];
    expect(col(r, "ExternalIdentifier")).toBe("WA417068.IN1");
    expect(col(r, "ExternalIdentifier")).toBe(col(r, "ToInventoryExternalIdentifier"));
    expect(col(r, "Operation")).toBe("Insert");
    expect(transferExternalId("X.1")).toBe("X.1");
  });
  it("no source file writes a TR- transfer id any more (only the read-only legacy alias)", () => {
    const core = SRC("src/lib/compliance/ccrs-transfer-core.ts");
    expect(core).not.toMatch(/export const TRANSFER_ID_PREFIX/);
    expect(LEGACY_TRANSFER_ID_PREFIX).toBe("TR-");
    expect(SRC("src/lib/compliance/ccrs-batch.ts")).not.toMatch(/TRANSFER_ID_PREFIX/);
  });
  it("the ledger is asked about BOTH the plain id and the legacy alias", () => {
    expect(transferLookupIds(["A", "B", "A"])).toEqual(["A", "TR-A", "B", "TR-B"]);
    expect(SRC("src/lib/compliance/ccrs-batch.ts")).toContain("transferLookupIds(");
  });
  it("a transfer filed before C1 as TR-<id> is reported: never re-Inserted, never auto-corrected", () => {
    const p = buildTransferRows(input({ held: held([["TR-WA417068.IN1", FILED]]), told: loaded({ state: "filed", told: toldOf({ Quantity: "1" }), inFlight: false }) }));
    expect(p.rows).toHaveLength(0);
    expect(p.alreadyHeld).toEqual(["TR-WA417068.IN1"]);
    expect(p.legacyHeld).toEqual(["TR-WA417068.IN1"]);
    expect(p.corrections).toHaveLength(0);
    expect(transferSummaryText(p)).toMatch(/TR-/);
  });
  it("a legacy id in an unanswered file still withholds (no second Insert)", () => {
    const p = buildTransferRows(input({ held: held([["TR-WA417068.IN1", { state: null, inFlight: true }]]) }));
    expect(p.rows).toHaveLength(0);
    expect(p.issues.map((i) => i.code)).toEqual(["E14_TRANSFER_LEDGER_WITHHELD"]);
  });
});

describe("D-3: the correction path (Update, same id, owner-approved)", () => {
  const changedTold = () => loaded({ state: "filed", told: toldOf({ Quantity: "20" }), inFlight: false });
  it("unchanged facts: held, nothing sent", () => {
    const p = buildTransferRows(input({ held: held([["WA417068.IN1", FILED]]), told: loaded({ state: "filed", told: toldOf({ Quantity: "24.0" }), inFlight: false }) }));
    expect(p.rows).toHaveLength(0);
    expect(p.alreadyHeld).toEqual(["WA417068.IN1"]);
    expect(p.corrections).toHaveLength(0);
  });
  it("changed but NOT approved: E63, held, nothing sent", () => {
    const p = buildTransferRows(input({ held: held([["WA417068.IN1", FILED]]), told: changedTold() }));
    expect(p.rows).toHaveLength(0);
    expect(p.issues.map((i) => i.code)).toEqual(["E63_TRANSFER_CORRECTION_PENDING"]);
    expect(p.corrections[0].changed).toEqual([{ column: "Quantity", was: "20", now: "24" }]);
    expect(p.corrections[0].approved).toBe(false);
  });
  it("approved with the SAME fingerprint: one Update row, same id, original Created*, Updated* filled", () => {
    const first = buildTransferRows(input({ held: held([["WA417068.IN1", FILED]]), told: changedTold() }));
    const fp = first.corrections[0].fingerprint;
    const p = buildTransferRows(
      input({ held: held([["WA417068.IN1", FILED]]), told: changedTold(), approvals: [{ id: "WA417068.IN1", fingerprint: fp, at: "x", by: null }], batchDay: "11/09/2026" }),
    );
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0];
    expect(col(r, "Operation")).toBe("Update");
    expect(col(r, "ExternalIdentifier")).toBe("WA417068.IN1");
    expect(col(r, "Quantity")).toBe("24");
    expect(col(r, "CreatedDate")).toBe("11/03/2026");
    expect(col(r, "UpdatedBy")).toBe("Greenway");
    expect(col(r, "UpdatedDate")).toBe("11/09/2026");
    expect(p.issues).toHaveLength(0);
  });
  it("an approval for OTHER values does not send (the facts changed again)", () => {
    const p = buildTransferRows(
      input({ held: held([["WA417068.IN1", FILED]]), told: changedTold(), approvals: [{ id: "WA417068.IN1", fingerprint: "stale", at: "x", by: null }], batchDay: "11/09/2026" }),
    );
    expect(p.rows).toHaveLength(0);
    expect(p.issues[0].code).toBe("E63_TRANSFER_CORRECTION_PENDING");
  });
  it("a told entry still in flight, or unknown, proposes no correction", () => {
    for (const t of [{ state: "filed" as const, told: toldOf({ Quantity: "20" }), inFlight: true }, { state: "filed" as const, told: null, inFlight: false }]) {
      const p = buildTransferRows(input({ held: held([["WA417068.IN1", FILED]]), told: loaded(t) }));
      expect(p.rows).toHaveLength(0);
      expect(p.issues).toHaveLength(0);
    }
  });
  it("UpdatedDate is never before CreatedDate [G L0242]", () => {
    expect(transferUpdatedDate("11/10/2026", "11/09/2026")).toBe("11/10/2026");
    expect(transferUpdatedDate("11/03/2026", "11/09/2026")).toBe("11/09/2026");
    expect(() => transferUpdatedDate("11/03/2026", "2026-11-09")).toThrow();
  });
  it("the fingerprint covers the id and every compared column", () => {
    const r = buildTransferRows(input()).rows[0];
    const fp = transferCorrectionFingerprint(r);
    expect(fp.startsWith("WA417068.IN1|")).toBe(true);
    const r2 = [...r];
    r2[TC.indexOf("Quantity")] = "25";
    expect(transferCorrectionFingerprint(r2)).not.toBe(fp);
  });
  it("approvals: one per id, last wins, withdraw removes; per-env setting key", () => {
    let l = approveTransferCorrection([], { id: "A", fingerprint: "1", at: "t", by: null });
    l = approveTransferCorrection(l, { id: "A", fingerprint: "2", at: "t", by: null });
    expect(l).toHaveLength(1);
    expect(l[0].fingerprint).toBe("2");
    expect(withdrawTransferCorrection(l, "A")).toHaveLength(0);
    expect(normalizeTransferApprovals("junk")).toEqual([]);
    expect(transferCorrectionSettingKey("prod")).not.toBe(transferCorrectionSettingKey("preprod"));
  });
  it("E63 row id round-trips (the button posts it back)", () => {
    expect(parseE63RowId(e63RowId({ id: "WA1.X", fingerprint: "WA1.X|1|2" }))).toEqual({ id: "WA1.X", fingerprint: "WA1.X|1|2" });
    expect(parseE63RowId("no-hash")).toBeNull();
  });
  it("decodeTransferTold: missing function = absent (corrections off, nothing re-sent)", () => {
    expect(decodeTransferTold("prod", null, { code: "PGRST202", message: "Could not find the function" }).kind).toBe("absent");
  });
  it("E63 is registered, pinned, blocking and HELD BACK (never blocks the other rows)", () => {
    expect(CCRS_ISSUE_CODES).toContain("E63_TRANSFER_CORRECTION_PENDING");
    expect(specPinFor("E63_TRANSFER_CORRECTION_PENDING" as never)).toBe("[FAQ L0058-L0059]");
    expect(TRANSFER_BLOCKING.has("E63_TRANSFER_CORRECTION_PENDING")).toBe(true);
    expect(HELD_BACK_CODES.has("E63_TRANSFER_CORRECTION_PENDING")).toBe(true);
  });
});

describe("D-3 wiring: migration 0325, store, action, button", () => {
  const mig = SRC("supabase/migrations/0325_ccrs_transfer_last_told.sql");
  const code = mig
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  it("0325 is one service-role-only read function, idempotent", () => {
    expect(mig).toContain(`create or replace function public.${TRANSFER_TOLD_RPC}(p_env text, p_ids text[])`);
    expect(mig).toContain("'InventoryTransfer'");
    expect(mig).toMatch(/revoke all on function public\.ccrs_transfer_last_told\(text, text\[\]\) from public, anon, authenticated;/);
    expect(mig).toMatch(/grant execute on function public\.ccrs_transfer_last_told\(text, text\[\]\) to service_role;/);
    expect(code).not.toMatch(/security definer/i);
    expect(code).not.toMatch(/create table|alter table|insert into|update public\./i);
    expect(code).toMatch(/set search_path/i);
    expect(SRC("supabase/rollbacks/0325_ccrs_transfer_last_told.rollback.sql")).toMatch(/drop function if exists public\.ccrs_transfer_last_told/);
  });
  it("0325 has a real-postgres check in the migrations job and a MIGRATIONS_TO_RUN entry", () => {
    expect(POST_APPLY_CHECKS.some((c) => c.file === "scripts/recon/ccrs-transfer-told-0325-pg-check.sql" && c.mustPrint === "CCRS 0325 CHECK PASSED")).toBe(true);
    expect(SRC("docs/MIGRATIONS_TO_RUN.md")).toContain("0325_ccrs_transfer_last_told.sql");
  });
  it("the batch loads told + approvals and passes the batch day", () => {
    const b = SRC("src/lib/compliance/ccrs-batch.ts");
    expect(b).toContain("loadTransferTold(");
    expect(b).toContain("readTransferApprovals(");
    expect(b).toContain("batchDay: createdDate");
    expect(b).toContain("e63RowId(c)");
  });
  it("the approve action needs settings.manage and writes an audit entry", () => {
    const a = SRC("src/app/admin/compliance/ccrs/actions.ts");
    const i = a.indexOf("export async function transferCorrectionAction");
    expect(i).toBeGreaterThan(-1);
    const body = a.slice(i, i + 3000);
    expect(body).toContain("settings.manage");
    expect(body).toContain("ccrs.transfer_correction.");
    expect(body).toContain("parseE63RowId(");
  });
  it("renders 'Approve correction' with the row id on E63 rows only, and only when allowed", () => {
    const act = async () => {};
    const rowId = e63RowId({ id: "WA1.X", fingerprint: "WA1.X|417068|413541|V.1|WA1.X|20|11/03/2026" });
    const issues = [
      { severity: "error" as const, file: "InventoryTransfer", code: "E63_TRANSFER_CORRECTION_PENDING", message: "m", count: 1, rows: [{ id: rowId, label: "Lot", detail: "d" }] },
      { severity: "error" as const, file: "InventoryTransfer", code: "E14_TRANSFER_QUANTITY", message: "m", count: 1, rows: [{ id: "L9", label: "Lot9", detail: "d" }] },
    ];
    const html = renderToStaticMarkup(<CcrsIssueList issues={issues} env="prod" tone="held" copyTitle="t" transferCorrection={{ action: act, weekKey: "2026-11-08" }} />);
    expect((html.match(/Approve correction/g) ?? []).length).toBe(1);
    expect(html).toContain(`name="row_id" value="${rowId}"`);
    expect(html).toContain('name="op" value="approve"');
    expect(html).toContain('name="week_key" value="2026-11-08"');
    expect(html).toContain('name="env" value="prod"');
    const ro = renderToStaticMarkup(<CcrsIssueList issues={issues} env="prod" tone="held" copyTitle="t" />);
    expect(ro).not.toContain("Approve correction");
  });
  it("the held list shows 'Approve correction' on E63 rows", () => {
    expect(SRC("src/components/admin/compliance/CcrsIssueList.tsx")).toContain("Approve correction");
    expect(SRC("src/app/admin/compliance/ccrs/page.tsx")).toContain("transferCorrection={canEdit ? { action: transferCorrectionAction, weekKey: week.key } : undefined}");
  });
});

describe("D-2: a new lot keeps the vendor's own id", () => {
  const none = new Set<string>();
  it("trusted sources pass the dotted id through byte for byte", () => {
    expect(intakeInventoryExternalId({ lot_code: "WA413287.INE6AQ", pos_product_key: null, source_format: "wcia", takenIds: none })).toEqual({ externalId: "WA413287.INE6AQ", basis: "vendor-id", reason: "" });
    expect(intakeInventoryExternalId({ lot_code: "WA413287.INE6AQ", pos_product_key: null, source_format: "ccrs-csv", takenIds: none }).externalId).toBe("WA413287.INE6AQ");
  });
  it("a PDF read, an unknown parser, a collision or an unreadable check keep today's minted id", () => {
    const m = (fmt: string | null, taken: ReadonlySet<string> | null) => intakeInventoryExternalId({ lot_code: "WA413287.INE6AQ", pos_product_key: null, source_format: fmt, takenIds: taken }).externalId;
    expect(m("pdf-manifest", none)).toBe("WA413287-INE6AQ");
    expect(m(null, none)).toBe("WA413287-INE6AQ");
    expect(m("wcia", new Set(["WA413287.INE6AQ"]))).toBe("WA413287-INE6AQ");
    expect(m("wcia", null)).toBe("WA413287-INE6AQ");
    expect([...TRUSTED_INTAKE_ID_SOURCES].sort()).toEqual(["ccrs_csv", "wcia_json"]);
  });
  it("collision candidates are only trusted, valid ids", () => {
    expect(intakeIdCandidates([{ lot_code: "A.1" }, { lot_code: "B,2" }], "wcia")).toEqual(["A.1"]);
    expect(intakeIdCandidates([{ lot_code: "A.1" }], "pdf-manifest")).toEqual([]);
  });
  it("intake uses it on lot creation only, with a collision read first", () => {
    const s = SRC("src/lib/inventory/intake-store.ts");
    expect(s).toContain("intakeInventoryExternalId({");
    expect(s).toContain("readTakenIntakeIds(admin, intakeIdCandidates(parsed.lines, parsed.source_format))");
    expect(s).not.toContain("deriveInventoryExternalId({\n        pos_product_key: line.pos_product_key");
  });
  it("self-tests pass and are registered", () => {
    expect(__runCcrsIntakeIdTests().failed).toBe(0);
    expect(SRC("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ccrs-intake-id-core", __runCcrsIntakeIdTests(), 23)');
  });
});
