/**
 * S-17a (CCRS Bible Part 17 §C.4 defect 1, §J): the hub, the compliance report
 * and the export refusal show EVERY withheld row with its reason and the next
 * step.
 *
 * Owner evidence (docs/ccrs-bible/evidence/2026-10-19-owner-screenshots/):
 * production said "[Inventory] 17 lot(s) were left out of Inventory.csv …
 * Each row says why; reconcile it, then rebuild. (17)" and showed no rows. The
 * builder had the rows; the gate's input type had no `rows` field and every
 * caller mapped issues by hand, so they were dropped. These tests pin:
 *   1. the gate carries rows/code/specPin and merges rows on dedupe;
 *   2. every withhold reason ccrs-ledger-core can produce is classified (read
 *      from the source, so a new reason cannot fall through silently);
 *   3. real planner output (planLedgerBatch) → gate → display keeps all rows;
 *   4. the next step names the right control per environment;
 *   5. the rendered list shows every row, uncapped, with a copy button;
 *   6. no caller maps sync issues by hand, the report has no 30-warning cap,
 *      and the export refusal prints rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NO_PRODUCT_ID_REASON,
  buildLedgerView,
  planLedgerBatch,
  type LedgerEntry,
  type LedgerState,
  type PlanLot,
} from "@/lib/compliance/ccrs-ledger-core";
import {
  WITHHOLD_CLASSES,
  __runCcrsIssueDisplayTests,
  classifyWithholdReason,
  groupRowsByReason,
  issuePlainText,
  issuesPlainText,
  mergeRows,
  nextStepFor,
  rowLine,
  type DisplayRow,
} from "@/lib/compliance/ccrs-issue-display-core";
import {
  __runCcrsSubmitGateTests,
  assertCcrsBatchSubmittable,
  toGateInput,
} from "@/lib/compliance/ccrs-submit-gate-core";
import { CcrsIssueList } from "@/components/admin/compliance/CcrsIssueList";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const LCORE = read("src/lib/compliance/ccrs-ledger-core.ts");
const HUB = read("src/app/admin/compliance/ccrs/page.tsx");
const REPORT = read("src/app/admin/reports/compliance/page.tsx");
const ROUTE = read("src/app/admin/reports/compliance/batch-export/route.ts");

const inv = (id: string, state: LedgerState, productExternalId: string | null = null): LedgerEntry => ({
  fileType: "Inventory",
  externalId: id,
  filedName: null,
  state,
  productExternalId,
});
const prod = (id: string, name: string | null, state: LedgerState = "seed"): LedgerEntry => ({
  fileType: "Product",
  externalId: id,
  filedName: name,
  state,
});
const lot = (lotId: string, ext: string, productKey: string): PlanLot => ({
  lotId,
  label: `LOT-${lotId}`,
  inventoryExternalId: ext,
  productKey,
  strain: "",
});

describe("embedded self-tests", () => {
  it("issue-display core self-tests pass", () => {
    expect(__runCcrsIssueDisplayTests().failed).toBe(0);
  });
  it("submit-gate self-tests pass (incl. S-17a rows)", () => {
    expect(__runCcrsSubmitGateTests().failed).toBe(0);
  });
});

describe("gate carries rows (Part 17 §C.4 defect 1)", () => {
  const rows17: DisplayRow[] = Array.from({ length: 17 }, (_, i) => ({
    id: `lot-${i}`,
    label: `L${i}`,
    detail: "its product is not in the published menu",
  }));
  const issue = {
    severity: "error" as const,
    file: "Inventory",
    message: "17 lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them.",
    count: 17,
    code: "E41_LEDGER_WITHHELD",
    specPin: "[G L0246-L0248]",
    rows: rows17,
  };

  it("toGateInput keeps every field", () => {
    const g = toGateInput(issue);
    expect(g.rows).toHaveLength(17);
    expect(g.code).toBe("E41_LEDGER_WITHHELD");
    expect(g.specPin).toBe("[G L0246-L0248]");
    expect(g.count).toBe(17);
  });

  it("the verdict's error has all 17 rows", () => {
    const v = assertCcrsBatchSubmittable({ syncIssues: [toGateInput(issue)], verifierProblems: [], files: [] });
    // R74 S39: withheld lots are left out of the files (held back, still owed);
    // they no longer block the good records. Every row is still carried.
    expect(v.submittable).toBe(true);
    expect(v.held[0].rows).toHaveLength(17);
    expect(v.held[0].code).toBe("E41_LEDGER_WITHHELD");
  });

  it("dedupe merges a duplicate's rows instead of dropping them", () => {
    const a = { ...issue, rows: rows17.slice(0, 10) };
    const b = { ...issue, rows: rows17.slice(5) };
    const v = assertCcrsBatchSubmittable({ syncIssues: [a, b].map(toGateInput), verifierProblems: [], files: [] });
    expect(v.held).toHaveLength(1);
    expect(v.held[0].rows!.map((r) => r.id)).toEqual(rows17.map((r) => r.id));
  });

  it("mergeRows treats same id with a different reason as a different row", () => {
    const m = mergeRows([{ id: "x", label: "X", detail: "r1" }], [{ id: "x", label: "X", detail: "r2" }]);
    expect(m).toHaveLength(2);
  });
});

describe("every withhold reason in ccrs-ledger-core is classified", () => {
  // Pull every `reason:` literal from the source. Template holes are filled
  // with a realistic value; the product-inherits template is filled with the
  // no-id reason (what production showed on 2026-10-19).
  // Every string/template literal on any line that sets a `reason:` (catches
  // ternaries like `reason: e ? `…` : "…"`). Templates first, then plain
  // strings outside them (a template may itself contain double quotes).
  const literals: string[] = [];
  for (const line of LCORE.split("\n")) {
    const at = line.search(/\breason:/);
    if (at < 0) continue;
    const tail = line.slice(at + "reason:".length);
    for (const m of tail.matchAll(/`([^`]*)`/g)) literals.push(m[1]);
    for (const m of tail.replace(/`[^`]*`/g, "").matchAll(/"([^"]*)"/g)) literals.push(m[1]);
  }
  const NOT_WITHHOLDS = new Set(["on file", "not on file", "every lot names a filed product"]);
  const fill = (t: string) =>
    t
      .replace("${pp.reason}", NO_PRODUCT_ID_REASON)
      .replace(/\$\{e\.state\}|\$\{p\.state\}/g, "deleted")
      .replace(/\$\{[^}]+\}/g, "1234.ABC")
      .replace(/\$\{holders\.join\(", "\)\}/g, "GWP-000001");
  const withholds = literals.filter((l) => !NOT_WITHHOLDS.has(l)).map(fill);

  it("found the reasons (guards the extractor itself)", () => {
    // 2 cannot-Delete + 3 route + 4 product-name + name-collision + conflicting-renames + 2 lot-finalise = 13
    expect(withholds.length).toBeGreaterThanOrEqual(13);
    expect(withholds).toContain("its product is not in the published menu");
  });
  for (const w of withholds) {
    it(`classified: ${w.slice(0, 70)}`, () => {
      expect(classifyWithholdReason(w)).not.toBe("unclassified");
    });
  }
  it("the no-id constant is classified directly and through its lot", () => {
    expect(classifyWithholdReason(NO_PRODUCT_ID_REASON)).toBe("no-product-id");
    expect(classifyWithholdReason(`its product is withheld: ${NO_PRODUCT_ID_REASON}`)).toBe("no-product-id");
  });
  it("an unrecognised reason is 'unclassified', never guessed", () => {
    expect(classifyWithholdReason("a reason nobody wrote yet")).toBe("unclassified");
    expect(nextStepFor("unclassified", "prod")).toMatch(/held back \(not sent\) until it is understood/i);
  });
});

describe("real planner output → gate → display", () => {
  it("each withheld lot keeps its own reason and the right class", () => {
    const { view } = buildLedgerView("prod", [
      inv("U1", "uncertain"),
      inv("F1", "seed", "9999.PRD"), // filed product not in ledger
      inv("D1", "deleted"),
      prod("1111.PRD", "Some Filed Name"),
    ]);
    const plan = planLedgerBatch({
      view,
      lots: [
        lot("1", "U1", "k-has"),
        lot("2", "F1", "k-has"),
        lot("3", "D1", "k-has"),
        lot("4", "NEW-1", "k-missing"), // product key not in the menu
        lot("5", "NEW-2", "k-noid"), // product in menu, no GWP id
      ],
      products: [
        { key: "k-has", legacyId: "k-has", ourName: "Has" },
        { key: "k-noid", legacyId: "k-noid", ourName: "No Id" },
      ],
      strains: [],
    });
    const rows: DisplayRow[] = [];
    for (const [id, p] of plan.lots) if (p.action === "withhold") rows.push({ id, label: `LOT-${id}`, detail: p.reason });
    expect(rows).toHaveLength(5);
    const cls = Object.fromEntries(rows.map((r) => [r.id, classifyWithholdReason(r.detail)]));
    expect(cls).toEqual({
      "1": "uncertain",
      "2": "filed-product-unproven",
      "3": "deleted-id",
      "4": "not-in-published-menu",
      "5": "no-product-id",
    });
    const v = assertCcrsBatchSubmittable({
      syncIssues: [toGateInput({ severity: "error", file: "Inventory", message: "withheld", count: 5, code: "E41_LEDGER_WITHHELD", rows })],
      verifierProblems: [],
      files: [],
    });
    const text = issuePlainText(v.held[0], "prod").join("\n");
    for (const r of rows) expect(text).toContain(rowLine(r));
    expect(text).toContain("Every row (5):");
    expect(groupRowsByReason(rows, "prod")).toHaveLength(5);
  });
});

describe("next step names the right control per environment", () => {
  it("prod no-id → the production Assign button", () => {
    expect(nextStepFor("no-product-id", "prod")).toContain('"Assign CCRS Product ids (GWP-)"');
  });
  it("PREprod no-id → PREprod set-up, and says prod ids do not carry over", () => {
    const s = nextStepFor("no-product-id", "preprod");
    expect(s).toContain('"Assign PREprod ids"');
    expect(s).toMatch(/does not carry over/);
  });
  it("not-in-menu points at Menu review, not at CCRS", () => {
    expect(nextStepFor("not-in-published-menu", "prod")).toMatch(/Menu review/);
  });
  it("filed-product-unproven points at the fresh copy / S-15, not at editing the lot", () => {
    expect(nextStepFor("filed-product-unproven", "prod")).toMatch(/S-15/);
  });
  it("every class has a non-empty hint in both envs", () => {
    for (const c of WITHHOLD_CLASSES) for (const e of ["prod", "preprod"] as const) expect(nextStepFor(c, e).length).toBeGreaterThan(20);
  });
});

describe("plain text is uncapped", () => {
  it("prints all 250 rows", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `id${i}`, label: `L${i}`, detail: "its product is not in the published menu" }));
    const t = issuesPlainText([{ severity: "error", file: "Inventory", message: "m", code: "E41_LEDGER_WITHHELD", rows }], "prod", "T");
    expect(t.split("\n").filter((l) => l.startsWith("    - "))).toHaveLength(250);
    expect(t).toContain("L249 [id249]");
  });
  it("non-withhold issues list rows without reason groups", () => {
    const t = issuePlainText({ severity: "warning", file: "Product", message: "m", code: "E44_FREE_TEXT_REWRITTEN", rows: [{ id: "GWP-1", label: "GWP-1", detail: "x" }] }, "prod");
    expect(t.join("\n")).not.toContain("Next step:");
    expect(t.join("\n")).toContain("    - GWP-1 — x");
  });
});

describe("CcrsIssueList render", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `lot${i}`, label: `LOT${i}`, detail: `its product is withheld: ${NO_PRODUCT_ID_REASON}` }));
  const html = renderToStaticMarkup(
    <CcrsIssueList
      issues={[{ severity: "error", file: "Inventory", message: "40 lots withheld", count: 40, code: "E41_LEDGER_WITHHELD", rows }]}
      env="preprod"
      tone="error"
      copyTitle="t"
    />,
  );
  it("renders every row (no cap)", () => {
    expect((html.match(/<li>LOT\d+ \[lot\d+\]/g) ?? []).length).toBe(40);
  });
  it("renders the reason group with the PREprod set-up link", () => {
    expect(html).toContain('data-class="no-product-id"');
    expect(html).toContain('href="#ccrs-files"');
  });
  it("offers a copy button", () => {
    expect(html).toContain("Copy these rows");
    expect(html).toContain("Copy every error with its rows");
  });
  it("renders nothing for no issues", () => {
    expect(renderToStaticMarkup(<CcrsIssueList issues={[]} env="prod" tone="error" copyTitle="t" />)).toBe("");
  });
  it("prod never shows the PREprod link", () => {
    const h = renderToStaticMarkup(
      <CcrsIssueList issues={[{ severity: "error", file: "Inventory", message: "m", code: "E41_LEDGER_WITHHELD", rows }]} env="prod" tone="error" copyTitle="t" />,
    );
    expect(h).not.toContain('href="#ccrs-files"');
  });
});

describe("source pins: callers", () => {
  for (const [name, src] of [
    ["hub", HUB],
    ["report", REPORT],
    ["export route", ROUTE],
  ] as const) {
    it(`${name} maps sync issues with toGateInput, not by hand`, () => {
      expect(src).toContain("syncIssues: batch.syncIssues.map(toGateInput)");
      expect(src).not.toMatch(/syncIssues: batch\.syncIssues\.map\(\(s\) =>/);
    });
  }
  it("hub renders errors and warnings with CcrsIssueList", () => {
    expect(HUB).toContain('tone="error"');
    expect(HUB).toContain('tone="warning"');
    expect(HUB).not.toContain("• [{e.file}] {e.message}");
  });
  it("report has no 30-warning cap and uses CcrsIssueList", () => {
    expect(REPORT).not.toContain("batchWarnings.slice(0, 30)");
    expect(REPORT).toContain("issues={batchWarnings}");
    expect(REPORT).toContain("issues={batchErrors}");
  });
  it("export refusal prints rows via issuePlainText", () => {
    expect(ROUTE).toContain('const fmt = (i: GateIssue): string => issuePlainText(i, env, "  ").join("\\r\\n");');
  });
});
