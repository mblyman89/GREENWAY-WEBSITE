/**
 * D227 S4 — "Re-send refused rows" on an errored Sale file.
 *
 * Spec pins:
 *   [G L1374] "CannabisExciseTax must equal 37% of unit price (except medical)"
 *   [G L1377] "CannabisExciseTax does not equal 37% of UnitPrice"
 *   [G L1378] "Only Medical Sales can be 0"
 *   [FAQ L0153-L0160] discount and taxes are for the whole row (3 x $5.00 - $3.00 -> $4.44)
 *
 * Evidence: docs/ccrs-bible/evidence/2026-11-10-preprod (sent/, errors/, fixed/).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";
import { __runCcrsResendRefusedCoreTests, planResendRefused, resendScope, saleRowIdentityProblem } from "@/lib/compliance/ccrs-resend-refused-core";
import { CcrsFilesPanel, type PanelFile } from "@/components/admin/compliance/CcrsFilesPanel";

const ROOT = path.resolve(__dirname, "../..");
const EV = path.join(ROOT, "docs/ccrs-bible/evidence/2026-11-10-preprod");
const SRC = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SENT = readFileSync(path.join(EV, "sent/Sale_413541_20261110101609.csv"), "utf8");
const FIXED = readFileSync(path.join(EV, "fixed/Sale_413541_20261110150000.csv"), "utf8");
const REFUSED = ["GWY-AZ3ALV-5a216511", "GWY-7DPS89-c54049ac"];
const D = CCRS_COLUMNS.Sale.indexOf("SaleDetailExternalIdentifier");
const data = (csv: string) => csv.split("\r\n").filter(Boolean).slice(4);

describe("the pure core", () => {
  it("self-tests pass", () => {
    const r = __runCcrsResendRefusedCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
});

describe("on the real 2026-11-10 PREprod file", () => {
  it("the OLD bytes of the two refused rows fail the identity, so a stale rebuild would never re-send them", () => {
    const p = planResendRefused(SENT, REFUSED);
    expect(p.csv).toBeNull();
    expect(p.failing.map((f) => f.id).sort()).toEqual([...REFUSED].sort());
    expect(p.failing.find((f) => f.id === REFUSED[0])!.why).toContain("13.65");
  });

  it("every ACCEPTED row of the sent file passes the same identity check", () => {
    const bad = data(SENT).map((l) => l.split(",")).filter((c) => !REFUSED.includes(c[D])).map(saleRowIdentityProblem).filter(Boolean);
    expect(bad).toEqual([]);
  });

  it("a fresh build carrying the fixed lines re-sends ONLY the two refused rows, never the 1,330 accepted ones", () => {
    const fixedById = new Map(data(FIXED).map((l) => [l.split(",")[D], l]));
    const lines = SENT.split("\r\n");
    const rebuilt = lines.map((l, i) => (i < 4 ? l : fixedById.get(l.split(",")[D]) ?? l)).join("\r\n");
    const p = planResendRefused(rebuilt, REFUSED);
    expect(p.sent.sort()).toEqual([...REFUSED].sort());
    expect(p.failing).toEqual([]);
    expect(p.notInBuild).toEqual([]);
    expect(data(p.csv!)).toHaveLength(2);
    expect(p.csv!.split("\r\n")[2]).toBe("NumberRecords,2");
    // Same rows as the hand-made fixed file (12.31/0.02 -> 13.66 and 12.31/0.01 -> 9.11).
    expect(new Set(data(p.csv!))).toEqual(new Set(data(FIXED)));
  });

  it("the scope covers rejected rows only and spans their sale dates", () => {
    const rows = data(SENT).map((l, i) => {
      const c = l.split(",");
      return { rowNo: i + 1, externalId: c[D], state: REFUSED.includes(c[D]) ? "rejected" : "confirmed", saleDate: c[CCRS_COLUMNS.Sale.indexOf("SaleDate")] };
    });
    const s = resendScope(rows);
    expect(s.ids.sort()).toEqual([...REFUSED].sort());
    expect(s.from).toBe("2026-11-06");
    expect(s.to).toBe("2026-11-06");
  });
});

describe("the button and the action", () => {
  const noop = () => {};
  const actions = { markUploaded: noop, recordSuccess: noop, recordError: noop, recordNoEmail: noop, abandon: noop, startPreprod: noop, assignPreprodIds: noop, resendRefused: noop };
  const f = (over: Partial<PanelFile>): PanelFile => ({
    id: "00000000-0000-4000-8000-000000000009", fileType: "Sale", purpose: "weekly", fileName: "Sale_413541_20261110101609.csv",
    numberRecords: 1332, state: "errored", stampAt: "2026-11-10T18:16:09Z", uploadedAt: "2026-11-10T18:20:00Z", errorMessages: null, notes: null, ...over,
  });
  const rej = { fileId: "00000000-0000-4000-8000-000000000009", severity: "error", code: "CCRS_ROW_REJECTED", message: "row 80 (L1): Cannabis Excise Tax does not equal 37% of Unit Price" };
  const html = (over: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(CcrsFilesPanel, {
        env: "preprod", weekKey: "2026-11-01", canEdit: true, available: true, loadError: null, files: [], issues: [], ledgerLoaded: true,
        unassignedProductCount: 0, nowISO: "2026-11-10T20:00:00.000Z", actions, ...over,
      }),
    );
  it("shows on an errored Sale file with refused rows, with the count", () => {
    const h = html({ files: [f({})], issues: [rej, { ...rej, message: "row 81 (L2): ..." }] });
    expect(h).toContain('data-testid="resend-refused"');
    expect(h).toMatch(/Re-send refused rows \((<!-- -->)?2(<!-- -->)?\)/);
  });
  it("never shows for a non-Sale file, a non-errored file, no refused rows, or a viewer", () => {
    expect(html({ files: [f({ fileType: "Inventory" })], issues: [rej] })).not.toContain("resend-refused");
    expect(html({ files: [f({ state: "uploaded" })], issues: [rej] })).not.toContain("resend-refused");
    expect(html({ files: [f({})], issues: [{ ...rej, code: "CCRS_ROW_CONTRADICTS_LEDGER" }] })).not.toContain("resend-refused");
    expect(html({ files: [f({})], issues: [rej], canEdit: false })).not.toContain("resend-refused");
  });
  it("the page wires the action; the action guards, rebuilds, checks, emits through the outbox and audits", () => {
    expect(SRC("src/app/admin/compliance/ccrs/page.tsx")).toContain("resendRefused: resendRefusedRowsAction");
    const a = SRC("src/app/admin/compliance/ccrs/actions.ts");
    const fn = a.slice(a.indexOf("export async function resendRefusedRowsAction"));
    expect(fn).toContain('requirePermission("settings.manage")');
    expect(fn).toContain('file.fileType !== "Sale"');
    expect(fn).toContain('file.state !== "errored"');
    expect(fn).toContain("fileRowsWithState(admin, file.id, file.numberRecords)");
    expect(fn).toContain("buildCcrsBatch(range.fromISO, range.toISO, { env })");
    expect(fn).toContain("planResendRefused(");
    expect(fn).toContain("verifyOutboxAgainstLedger(batch.ledger.view, planned)");
    expect(fn).toContain("emitOutboxFiles(admin, env, payload, [])");
    expect(fn).toContain('action: "ccrs.file.resend_refused"');
    expect(fn.indexOf("verifyOutboxAgainstLedger")).toBeLessThan(fn.indexOf("emitOutboxFiles("));
  });
  it("the store read is paged to the end (never a silent 1,000-row cut)", () => {
    const s = SRC("src/lib/compliance/ccrs-ledger-store.ts");
    const fn = s.slice(s.indexOf("export async function fileRowsWithState"));
    expect(fn).toContain(".range(from, to)");
    expect(fn).toContain("if (!verdict.complete) throw");
  });
});
