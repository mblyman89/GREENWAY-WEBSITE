/**
 * R74 S25 (round 12): Cultivera lots keep the CCRS ids Cultivera filed; lots we
 * intake get our own ids and GWP- Product ids. Production never sends a
 * Cultivera lot as a NEW record.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CULTIVERA_NOT_ON_RECORD_REASON,
  CULTIVERA_ONLY_PRODUCT_REASON,
  GWP_ID_RE,
  __runCcrsIdentityGuardCoreTests,
  applyIdentityHolds,
  buildIdentityProof,
  cultiveraLotsToHold,
  identityIssues,
  isGwpProductId,
  type IdentityLot,
} from "@/lib/compliance/ccrs-identity-guard-core";
import { buildLedgerView, planLedgerBatch, type LedgerEntry } from "@/lib/compliance/ccrs-ledger-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import { classifyWithholdReason, isWithholdIssue, WITHHOLD_CLASSES, __runCcrsIssueDisplayTests } from "@/lib/compliance/ccrs-issue-display-core";
import { CcrsIdentityProofPanel } from "@/components/admin/compliance/CcrsIdentityProofPanel";

const read = (p: string) => readFileSync(p, "utf8");
const CORE = read("src/lib/compliance/ccrs-identity-guard-core.ts");
const BATCH = read("src/lib/compliance/ccrs-batch.ts");
const RUNNER = read("scripts/compliance/run-pure-selftests.ts");
const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");
const ROUTE = read("src/app/admin/reports/compliance/batch-export/route.ts");

const entry = (fileType: "Inventory" | "Product", externalId: string, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ fileType, externalId, filedName: null, state: "seed", productExternalId: null, ...extra }) as LedgerEntry;

function scenario(env: "prod" | "preprod", withLedger = true) {
  const { view } = buildLedgerView(
    env,
    [
      entry("Inventory", "WA123.CV1", { productExternalId: "CV-PROD-1" }),
      entry("Product", "CV-PROD-1", { filedName: "Blue Dream 1g (Cultivera)" }),
      entry("Inventory", "GW-LOT-OLD", { productExternalId: "GWP-000007", state: "filed" }),
      entry("Product", "GWP-000007", { filedName: "Our Gummies", state: "filed" }),
    ],
    new Map([
      ["k-ours", "GWP-000007"],
      ["k-new", "GWP-000008"],
    ]),
  );
  const lots: IdentityLot[] = [
    { lotId: "cv1", label: "WA123.CV1", lotCode: "WA123.CV1", ccrsId: "WA123.CV1", productKey: "k-cv", isCultivera: true },
    { lotId: "cv2", label: "WA555.REIMPORT", lotCode: "WA555.REIMPORT", ccrsId: "WA555.REIMPORT", productKey: "k-cvonly", isCultivera: true },
    { lotId: "in1", label: "VEND-9", lotCode: "VEND-9", ccrsId: "GW-LOT-NEW", productKey: "k-new", isCultivera: false },
    { lotId: "in2", label: "OLD", lotCode: "OLD", ccrsId: "GW-LOT-OLD", productKey: "k-ours", isCultivera: false },
  ];
  const ledger = withLedger ? view : null;
  const held = cultiveraLotsToHold({ env, view: ledger, lots });
  const raw = planLedgerBatch({
    view: ledger,
    lots: lots
      .filter((l) => !held.has(l.lotId))
      .map((l) => ({ lotId: l.lotId, label: l.label, inventoryExternalId: l.ccrsId!, productKey: l.productKey, strain: "" })),
    products: [
      { key: "k-cv", legacyId: "LEG-CV", ourName: "Blue Dream 1g" },
      { key: "k-cvonly", legacyId: "LEG-CVONLY", ourName: "Reimported" },
      { key: "k-new", legacyId: "LEG-NEW", ourName: "New Gummies" },
      { key: "k-ours", legacyId: "LEG-OURS", ourName: "Our Gummies" },
    ],
    strains: [],
  });
  const plan = applyIdentityHolds(raw, held, lots);
  const proof = buildIdentityProof({ env, view: ledger, lots, plan, held });
  return { held, plan, proof, issues: identityIssues(proof, withLedger ? null : "seed-not-finalized") };
}

describe("R74 S25 ccrs-identity-guard-core", () => {
  it("self-tests: exact count, registered in the pure runner with floor 43, pure", () => {
    expect(__runCcrsIdentityGuardCoreTests()).toEqual({ passed: 43, failed: 0 });
    expect(RUNNER).toMatch(
      /\{ const r = __runCcrsIdentityGuardCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 43\) throw new Error\([^\n]*\} \/\/ R74 S25/,
    );
    expect(CORE).not.toContain("process" + ".env");
    expect(CORE).not.toMatch(/from "@\/lib\/supabase|createClient|server-only/);
    expect(__runCcrsIssueDisplayTests()).toEqual({ passed: 17, failed: 0 });
  });

  it("GWP- id shape matches migration 0248", () => {
    expect(GWP_ID_RE.source).toBe("^(P[0-9]{8}[A-Z]-)?GWP-[0-9]{6}$");
    expect(isGwpProductId("GWP-000001")).toBe(true);
    expect(isGwpProductId("P41234567A-GWP-000001")).toBe(true);
    expect(isGwpProductId("CV-PROD-1")).toBe(false);
    expect(isGwpProductId(null)).toBe(false);
  });

  it("prod with ledger: a filed Cultivera lot keeps its id and Cultivera's product; intake gets GWP-", () => {
    const { plan, proof } = scenario("prod");
    const cv1 = plan.lots.get("cv1")!;
    expect(cv1).toMatchObject({ action: "emit", op: "Update", productName: "Blue Dream 1g (Cultivera)" });
    expect(plan.products.get("k-cv")?.action).toBe("skip");
    const inNew = plan.lots.get("in1")!;
    expect(inNew).toMatchObject({ action: "emit", op: "Insert" });
    expect(plan.products.get("k-new")).toEqual({ action: "emit", op: "Insert", ext: "GWP-000008" });
    // our earlier-filed lot is an Update naming our filed GWP- product; no Product row is re-sent.
    expect(plan.lots.get("in2")).toMatchObject({ action: "emit", op: "Update", productName: "Our Gummies" });
    expect(plan.products.get("k-ours")).toEqual({ action: "skip", reason: "every lot names a filed product" });
    expect(proof.cultivera).toMatchObject({ lots: 2, onRecord: 1, filedProducts: 1, held: 1, sentAsNew: 0 });
    expect(proof.intake).toMatchObject({ lots: 2, newRecords: 1, onRecordOurs: 1, onRecordCultivera: 0 });
    expect(proof.products).toMatchObject({ gwpInsert: 1, gwpUpdate: 0, legacyIds: 0 });
  });

  it("prod: a Cultivera lot CCRS does not hold is HELD, never an Insert, and asks for no GWP- id", () => {
    const { held, plan, proof, issues } = scenario("prod");
    expect(held.get("cv2")).toBe(CULTIVERA_NOT_ON_RECORD_REASON);
    expect(plan.lots.get("cv2")).toEqual({ action: "withhold", reason: CULTIVERA_NOT_ON_RECORD_REASON });
    expect(plan.products.get("k-cvonly")).toEqual({ action: "skip", reason: CULTIVERA_ONLY_PRODUCT_REASON });
    expect(proof.products.cultiveraOnlyHeld).toBe(1);
    const e52 = issues.filter((i) => i.code === "E52_CULTIVERA_LOT_NOT_ON_RECORD");
    expect(e52).toHaveLength(1);
    expect(e52[0].severity).toBe("error");
  });

  it("prod without the ledger: E53 blocks (every row would be a new record)", () => {
    const { proof, issues } = scenario("prod", false);
    expect(proof.mode).toBe("legacy");
    expect(proof.cultivera.sentAsNew).toBe(2);
    const e53 = issues.find((i) => i.code === "E53_PROD_LEDGER_NOT_LOADED");
    expect(e53?.severity).toBe("error");
  });

  it("PREprod: nothing held, no blocking identity error (separate environment, FAQ L0096)", () => {
    const { held, issues } = scenario("preprod");
    expect(held.size).toBe(0);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    const legacy = scenario("preprod", false);
    expect(legacy.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("issue codes are pinned to the spec and E52 is a withhold class", () => {
    for (const code of [
      "E52_CULTIVERA_LOT_NOT_ON_RECORD",
      "E53_PROD_LEDGER_NOT_LOADED",
      "E54_CULTIVERA_ID_NOT_BARCODE",
      "E55_INTAKE_LOT_ON_CULTIVERA_RECORD",
    ] as const) {
      expect(CCRS_ISSUE_CODES).toContain(code);
      expect(specPinFor(code)).toMatch(/^\[(G|FAQ) L\d{4}(-L\d{4})?\]$/);
    }
    expect(WITHHOLD_CLASSES).toContain("cultivera-not-on-record");
    expect(classifyWithholdReason(CULTIVERA_NOT_ON_RECORD_REASON)).toBe("cultivera-not-on-record");
    expect(isWithholdIssue({ code: "E52_CULTIVERA_LOT_NOT_ON_RECORD" } as never)).toBe(true);
  });

  it("batch wiring: lots carry notes/manifest_id, holds happen before planning, E41 does not double-report", () => {
    expect(BATCH).toMatch(/const LOT_COLUMNS =[^;]*notes, manifest_id/);
    expect(BATCH).toMatch(/cultiveraLotsToHold\([\s\S]*planLedgerBatch\(\{[\s\S]*\.filter\(\(l\) => !identityHeld\.has\(l\.id\)\)/);
    expect(BATCH).toContain("const identityPlan = applyIdentityHolds(rawPlan, identityHeld, identityLots);");
    expect(BATCH).toContain("syncIssues.push(...identityIssues(identity,");
    expect(BATCH).toMatch(/CULTIVERA_NOT_ON_RECORD_REASON\)\s*continue;/);
    expect(BATCH).toMatch(/readMigrationManifestIds[\s\S]*chunkedIn/);
  });

  it("hub renders the proof panel; export note explains the E53 refusal", () => {
    expect(PAGE).toContain("<CcrsIdentityProofPanel proof={batch.identity} />");
    expect(ROUTE).toContain("Production exports in this state are refused (E53)");
    const { proof } = scenario("prod");
    const html = renderToStaticMarkup(createElement(CcrsIdentityProofPanel, { proof }));
    expect(html).toContain('data-testid="ccrs-identity-proof"');
    expect(html).toMatch(/data-testid="idp-cv-onrecord">1</);
    expect(html).toMatch(/data-testid="idp-cv-held">1</);
    expect(html).toMatch(/data-testid="idp-p-ins">1</);
    const legacy = renderToStaticMarkup(createElement(CcrsIdentityProofPanel, { proof: scenario("prod", false).proof }));
    expect(legacy).toContain('data-testid="ccrs-identity-legacy"');
  });
});
