/**
 * Bible v2 S-11 — Product and Strain routing from a ledger view.
 * Ground: Part 03 §D.3; [G L0246-L0248] [G L0319-L0320] [G L0359] [G L0580-L0583];
 * Brian A1, A13, A16, A17. Real values are from the 2026-09-18 LCB delivery
 * (analysis3/s11/*.out); nothing here is invented to make a test pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEDGER_STATES,
  applyProductPlan,
  buildLedgerView,
  formatMintedProductId,
  planLedgerBatch,
  resolveProductName,
  resolveStrainCasing,
  routeOperation,
  routeReference,
  __runCcrsLedgerCoreTests,
  type LedgerEntry,
  type LedgerState,
  type PlanLot,
} from "@/lib/compliance/ccrs-ledger-core";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

const SRC = readFileSync(join(process.cwd(), "src/lib/compliance/ccrs-batch.ts"), "utf8");
const CORE = readFileSync(join(process.cwd(), "src/lib/compliance/ccrs-ledger-core.ts"), "utf8");

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
const strain = (name: string, state: LedgerState = "seed"): LedgerEntry => ({
  fileType: "Strain",
  externalId: name,
  filedName: name,
  state,
});
const lot = (lotId: string, ext: string, productKey: string, s = ""): PlanLot => ({
  lotId,
  label: lotId,
  inventoryExternalId: ext,
  productKey,
  strain: s,
});

describe("routeOperation — Part 03 §D.3, every state × intent", () => {
  const expected: Record<LedgerState, { upsert: string; delete: string }> = {
    seed: { upsert: "Update", delete: "Delete" },
    filed: { upsert: "Update", delete: "Delete" },
    confirmed: { upsert: "Update", delete: "Delete" },
    closed: { upsert: "Update", delete: "withhold" },
    uncertain: { upsert: "withhold", delete: "withhold" },
    deleted: { upsert: "withhold", delete: "withhold" },
    unknown: { upsert: "withhold", delete: "withhold" },
  };
  it("covers all 7 states (no state left untested)", () => {
    expect(Object.keys(expected).sort()).toEqual([...LEDGER_STATES].sort());
  });
  for (const st of LEDGER_STATES) {
    for (const intent of ["upsert", "delete"] as const) {
      it(`${st} + ${intent} → ${expected[st][intent]}`, () => {
        const { view } = buildLedgerView("prod", [inv("X", st)]);
        const r = routeOperation(view, "Inventory", "X", intent);
        expect(r.op).toBe(expected[st][intent]);
        expect(r.state).toBe(st);
        expect(r.reason.length).toBeGreaterThan(0);
      });
    }
  }
  it("absent + upsert → Insert; absent + delete → withhold (never Delete the unproven)", () => {
    const { view } = buildLedgerView("prod", []);
    expect(routeOperation(view, "Inventory", "NEW", "upsert")).toMatchObject({ op: "Insert", state: null });
    expect(routeOperation(view, "Inventory", "NEW", "delete")).toMatchObject({ op: "withhold", state: null });
  });
  it("is exact: a case or space variant of a filed id is NOT the filed id", () => {
    const { view } = buildLedgerView("prod", [inv("GF41583505706958 ", "seed")]);
    expect(routeOperation(view, "Inventory", "GF41583505706958 ", "upsert").op).toBe("Update");
    expect(routeOperation(view, "Inventory", "GF41583505706958", "upsert").op).toBe("Insert");
    expect(routeOperation(view, "Inventory", "gf41583505706958 ", "upsert").op).toBe("Insert");
  });
  it("is per file type: a Product id does not route an Inventory row", () => {
    const { view } = buildLedgerView("prod", [prod("P1", "N")]);
    expect(routeOperation(view, "Inventory", "P1", "upsert").op).toBe("Insert");
    expect(routeOperation(view, "Product", "P1", "upsert").op).toBe("Update");
  });
});

describe("routeReference — event rows may only name a lot CCRS holds", () => {
  for (const st of LEDGER_STATES) {
    const ok = st === "seed" || st === "filed" || st === "confirmed";
    it(`${st} → ${ok ? "ok" : "refused"}`, () => {
      const { view } = buildLedgerView("prod", [inv("L", st)]);
      expect(routeReference(view, "Inventory", "L")).toEqual({ ok, state: st });
    });
  }
  it("absent → refused", () => {
    const { view } = buildLedgerView("prod", []);
    expect(routeReference(view, "Inventory", "L")).toEqual({ ok: false, state: null });
  });
});

describe("buildLedgerView", () => {
  it("reports a duplicate id instead of silently choosing (first row wins)", () => {
    const { view, duplicates } = buildLedgerView("prod", [prod("1", "A"), prod("1", "B")]);
    expect(duplicates).toEqual(["Product/1"]);
    expect(view.entries.size).toBe(1);
    expect(resolveProductName(buildLedgerView("prod", [prod("1", "A"), prod("1", "B"), inv("I", "seed", "1")]).view, "I", "x")).toMatchObject({ name: "A" });
  });
  it("throws on a state outside the contract", () => {
    expect(() => buildLedgerView("prod", [{ ...inv("X", "seed"), state: "live" as unknown as LedgerState }])).toThrow(/unknown state "live"/);
  });
  it("a deleted strain does not anchor casing; productsByName holds present products only", () => {
    const { view } = buildLedgerView("prod", [strain("Gone", "deleted"), prod("P1", "Same"), prod("P2", "Same", "deleted"), prod("P3", "Same", "uncertain")]);
    expect(view.strainsByFold.has("gone")).toBe(false);
    expect(view.productsByName.get("Same")).toEqual(["P1"]);
  });
});

describe("resolveStrainCasing — Brian A16, [G L0359]", () => {
  const { view } = buildLedgerView("prod", [
    strain("Dutch Treat"),
    // the 2 real case-variant groups CCRS already holds for 413541
    strain("Mack's GAK"),
    strain("Mack's Gak"),
    strain("Snoop's Dream x Gobbstopper"),
    strain("snoop's dream x gobbstopper"),
  ]);
  it("Dutch treat → the filed Dutch Treat", () => {
    expect(resolveStrainCasing(view, "Dutch treat")).toEqual({ kind: "case-variant", value: "Dutch Treat", ours: "Dutch treat" });
  });
  it("exact filed spelling → filed, unchanged", () => {
    expect(resolveStrainCasing(view, "Dutch Treat")).toEqual({ kind: "filed", value: "Dutch Treat" });
    expect(resolveStrainCasing(view, "Mack's Gak")).toEqual({ kind: "filed", value: "Mack's Gak" });
  });
  it("a third casing of a real 2-variant group resolves stably to one filed casing (never sent)", () => {
    const r = resolveStrainCasing(view, "MACK'S GAK");
    expect(r.kind).toBe("case-variant");
    expect(["Mack's GAK", "Mack's Gak"]).toContain(r.value);
    expect(resolveStrainCasing(view, "MACK'S GAK")).toEqual(r);
  });
  it("not on file → new", () => {
    expect(resolveStrainCasing(view, "Zkittlez")).toEqual({ kind: "new", value: "Zkittlez" });
  });
});

describe("resolveProductName — [G L0580-L0583]", () => {
  // Real: filed lot GF41244605536579 → product C1100012999, whose filed Name
  // has no double quotes (the delivery's Inventory report wraps it in quotes).
  const REAL = "Shatter J's Infused Pre-roll Blackberry Pie - 1g";
  const { view } = buildLedgerView("prod", [
    prod("C1100012999", REAL),
    inv("GF41244605536579", "seed", "C1100012999"),
    inv("NOPID", "seed", null),
    inv("BLANKPID", "seed", "  "),
    inv("GHOST", "seed", "P-NOT-IN-LEDGER"),
    prod("PU", "Uncertain", "uncertain"),
    inv("TOUNCERTAIN", "seed", "PU"),
    prod("PE", ""),
    inv("TOEMPTY", "seed", "PE"),
  ]);
  it("filed lot → the FILED name, flagged when ours differs", () => {
    expect(resolveProductName(view, "GF41244605536579", "Our Composed Name")).toEqual({
      kind: "filed",
      name: REAL,
      productExternalId: "C1100012999",
      differs: true,
    });
    expect(resolveProductName(view, "GF41244605536579", REAL)).toMatchObject({ name: REAL, differs: false });
  });
  it("not a filed lot → ours", () => {
    expect(resolveProductName(view, "GWL-20261101-000001", "Ours")).toEqual({ kind: "ours", name: "Ours" });
  });
  it("filed lot whose product is unprovable → withhold (no pid, blank pid, absent, not present, nameless)", () => {
    for (const id of ["NOPID", "BLANKPID", "GHOST", "TOUNCERTAIN", "TOEMPTY"]) {
      expect(resolveProductName(view, id, "Ours").kind, id).toBe("withhold");
    }
  });
  it("rename keeps our name and points at the filed product to Update", () => {
    expect(resolveProductName(view, "GF41244605536579", "New Name", { rename: true })).toEqual({
      kind: "filed",
      name: "New Name",
      productExternalId: "C1100012999",
      differs: true,
    });
    // a blank 'ours' can never rename a filed product to nothing
    expect(resolveProductName(view, "GF41244605536579", "", { rename: true })).toMatchObject({ name: REAL });
  });
});

describe("formatMintedProductId — D-01a GWP-<seq6>", () => {
  it("formats, pads, and prefixes a PREprod run", () => {
    expect(formatMintedProductId(1)).toBe("GWP-000001");
    expect(formatMintedProductId(4412)).toBe("GWP-004412");
    expect(formatMintedProductId(999_999)).toBe("GWP-999999");
    expect(formatMintedProductId(7, "P20261005A")).toBe("P20261005A-GWP-000007");
  });
  it("refuses out-of-range sequences and bad run ids", () => {
    for (const n of [0, -1, 1.5, 1_000_000, Number.NaN]) expect(() => formatMintedProductId(n)).toThrow(/out of range/);
    for (const r of ["P2026105A", "p20261005A", "P20261005", "P20261005AB", ""]) expect(() => formatMintedProductId(1, r)).toThrow(/bad PREprod run id/);
  });
  it("is not purely numeric (Brian A3) and fits 100 chars [G L0224]", () => {
    const id = formatMintedProductId(1, "P20261005A");
    expect(/^\d+$/.test(id)).toBe(false);
    expect(id.length).toBeLessThanOrEqual(100);
  });
});

describe("planLedgerBatch — no ledger yet (legacy path until S-12)", () => {
  const plan = planLedgerBatch({
    view: null,
    products: [
      { key: "pos-aaa", legacyId: "pos-aaa", ourName: "A Name" },
      { key: "pos-bbb", legacyId: "pos-bbb", ourName: "B Name" },
    ],
    lots: [lot("l1", "BC1", "pos-aaa", "Dutch Treat"), lot("l2", "BC2", "pos-bbb", "Dutch treat"), lot("l3", "BC3", "pos-zzz")],
    strains: ["Dutch Treat", "Dutch treat", "Zkittlez"],
  });
  it("every product is an Insert under its legacy id (byte-identical to pre-S-11)", () => {
    expect(plan.products.get("pos-aaa")).toEqual({ action: "emit", op: "Insert", ext: "pos-aaa" });
    expect(plan.products.get("pos-bbb")).toEqual({ action: "emit", op: "Insert", ext: "pos-bbb" });
    expect(plan.renames.size).toBe(0);
  });
  it("every lot is an Insert with our name ('' when the product is not in the menu, as before)", () => {
    expect(plan.lots.get("l1")).toEqual({ action: "emit", op: "Insert", productName: "A Name", strain: "Dutch Treat" });
    expect(plan.lots.get("l3")).toEqual({ action: "emit", op: "Insert", productName: "", strain: "" });
  });
  it("FIX: a case variant inside one batch is written with the first spelling in BOTH files", () => {
    // Before S-11 the Strain file deduped case-insensitively but the Inventory
    // row kept "Dutch treat" — a strain CCRS was never sent → Invalid Strain.
    expect([...plan.strainEmit]).toEqual(["Dutch Treat", "Zkittlez"]);
    expect(plan.lots.get("l2")).toMatchObject({ strain: "Dutch Treat" });
    expect(plan.strainCaseVariants).toEqual([{ ours: "Dutch treat", value: "Dutch Treat", source: "batch" }]);
  });
});

describe("planLedgerBatch — with a ledger", () => {
  const FILED = "Airo Pro Cartridge Ac/Dc";
  const { view } = buildLedgerView(
    "prod",
    [
      strain("Dutch Treat"),
      prod("P65303102334312", FILED),
      prod("P-TAKEN", "Already Filed Name"),
      inv("BC-FILED-1", "seed", "P65303102334312"),
      inv("BC-FILED-2", "seed", "P65303102334312"),
      inv("BC-UNCERTAIN", "uncertain", "P65303102334312"),
      inv("BC-CLOSED", "closed", "P65303102334312"),
      prod("P-R", "Old Name"),
      inv("BC-R1", "seed", "P-R"),
      inv("BC-R2", "seed", "P-R"),
      prod("P-C", "Conflict Old"),
      inv("BC-C1", "seed", "P-C"),
      inv("BC-C2", "seed", "P-C"),
      prod("GWP-000009", "Mixed Name", "filed"),
    ],
    new Map([
      ["pos-new", "GWP-000001"],
      ["pos-mixed", "GWP-000009"],
      ["pos-collide", "GWP-000002"],
    ]),
  );
  const zk = Array.from({ length: 40 }, (_, i) => lot(`z${i}`, `GWL-20261101-${String(i + 1).padStart(6, "0")}`, "pos-new", "Zkittlez"));
  const plan = planLedgerBatch({
    view,
    products: [
      { key: "pos-airo", legacyId: "pos-airo", ourName: "Our Airo Name" },
      { key: "pos-new", legacyId: "pos-new", ourName: "Brand New 1g" },
      { key: "pos-unassigned", legacyId: "pos-unassigned", ourName: "No Id Yet" },
      { key: "pos-collide", legacyId: "pos-collide", ourName: "Already Filed Name" },
      { key: "pos-mixed", legacyId: "pos-mixed", ourName: "Mixed Name" },
      { key: "pos-r", legacyId: "pos-r", ourName: "New Name" },
      { key: "pos-c1", legacyId: "pos-c1", ourName: "Conflict A" },
      { key: "pos-c2", legacyId: "pos-c2", ourName: "Conflict B" },
    ],
    lots: [
      lot("f1", "BC-FILED-1", "pos-airo", "Dutch treat"),
      lot("f2", "BC-FILED-2", "pos-airo", "Dutch Treat"),
      lot("u1", "BC-UNCERTAIN", "pos-airo"),
      lot("c1", "BC-CLOSED", "pos-airo"),
      ...zk,
      lot("n1", "GWL-20261101-000100", "pos-unassigned"),
      lot("k1", "GWL-20261101-000101", "pos-collide"),
      lot("m1", "GWL-20261101-000102", "pos-mixed"),
      lot("r1", "BC-R1", "pos-r"),
      lot("r2", "BC-R2", "pos-r"),
      lot("x1", "BC-C1", "pos-c1"),
      lot("x2", "BC-C2", "pos-c2"),
    ],
    strains: ["Dutch treat", ...Array(40).fill("Zkittlez")],
    renameFiledProductIds: new Set(["P-R", "P-C"]),
  });

  it("Strain: the filed Dutch Treat is never re-sent; Dutch treat is written as Dutch Treat", () => {
    expect(plan.strainEmit.has("Dutch Treat")).toBe(false);
    expect(plan.strainEmit.has("Dutch treat")).toBe(false);
    expect(plan.lots.get("f1")).toMatchObject({ strain: "Dutch Treat" });
    expect(plan.strainCaseVariants).toContainEqual({ ours: "Dutch treat", value: "Dutch Treat", source: "ledger" });
  });
  it("Strain: Zkittlez (not on file) is emitted exactly once for 40 lots", () => {
    expect([...plan.strainEmit]).toEqual(["Zkittlez"]);
    for (const z of zk) expect(plan.lots.get(z.lotId)).toMatchObject({ strain: "Zkittlez" });
  });
  it("Product: filed lots name the FILED product, are Updates, and our product row is not sent", () => {
    expect(plan.lots.get("f1")).toEqual({ action: "emit", op: "Update", productName: FILED, strain: "Dutch Treat" });
    expect(plan.lots.get("c1")).toMatchObject({ action: "emit", op: "Update", productName: FILED });
    expect(plan.products.get("pos-airo")).toMatchObject({ action: "skip" });
    expect(plan.nameFromLedger.map((n) => n.lotId).sort()).toEqual(["c1", "f1", "f2"]);
    expect(plan.nameFromLedger[0]).toMatchObject({ ours: "Our Airo Name", filed: FILED });
  });
  it("an uncertain lot is withheld with its reason", () => {
    expect(plan.lots.get("u1")).toMatchObject({ action: "withhold" });
    expect((plan.lots.get("u1") as { reason: string }).reason).toMatch(/uncertain/);
  });
  it("Product new: assigned GWP- id not on file → Insert; its new lots are Inserts with our name", () => {
    expect(plan.products.get("pos-new")).toEqual({ action: "emit", op: "Insert", ext: "GWP-000001" });
    expect(plan.lots.get("z0")).toEqual({ action: "emit", op: "Insert", productName: "Brand New 1g", strain: "Zkittlez" });
  });
  it("Product with no assigned id is withheld, and so are its lots (never an id invented at export)", () => {
    expect(plan.products.get("pos-unassigned")).toMatchObject({ action: "withhold" });
    expect(plan.lots.get("n1")).toMatchObject({ action: "withhold" });
    expect((plan.lots.get("n1") as { reason: string }).reason).toMatch(/product is withheld/);
  });
  it("never Inserts a second product under a name CCRS already holds (gap N-12)", () => {
    expect(plan.products.get("pos-collide")).toMatchObject({ action: "withhold" });
    expect((plan.products.get("pos-collide") as { reason: string }).reason).toMatch(/P-TAKEN/);
    expect(plan.lots.get("k1")).toMatchObject({ action: "withhold" });
  });
  it("our own already-filed product is an Update under its GWP- id (its own name is not a collision)", () => {
    expect(plan.products.get("pos-mixed")).toEqual({ action: "emit", op: "Update", ext: "GWP-000009" });
    expect(plan.lots.get("m1")).toMatchObject({ action: "emit", op: "Insert", productName: "Mixed Name" });
  });
  it("Rename: one Product Update with the new name, and every lot on it carries the new name", () => {
    expect(plan.renames.get("P-R")).toEqual({ name: "New Name", productKey: "pos-r" });
    expect(plan.lots.get("r1")).toMatchObject({ action: "emit", op: "Update", productName: "New Name" });
    expect(plan.lots.get("r2")).toMatchObject({ productName: "New Name" });
    expect(plan.nameFromLedger.some((n) => n.lotId === "r1")).toBe(false);
  });
  it("Rename conflict: two different new names for one filed product → nobody moves", () => {
    expect(plan.renames.has("P-C")).toBe(false);
    expect(plan.lots.get("x1")).toMatchObject({ action: "withhold" });
    expect(plan.lots.get("x2")).toMatchObject({ action: "withhold" });
  });
  it("every lot and every product has exactly one decision", () => {
    expect(plan.lots.size).toBe(4 + 40 + 3 + 2 + 2);
    expect(plan.products.size).toBe(8);
  });
});

describe("applyProductPlan", () => {
  const C = CCRS_COLUMNS.Product;
  const row = (name: string, ext: string) => {
    const r = C.map(() => "");
    r[C.indexOf("Name")] = name;
    r[C.indexOf("ExternalIdentifier")] = ext;
    r[C.indexOf("Operation")] = "Insert";
    return r;
  };
  const { view } = buildLedgerView(
    "prod",
    [prod("P-R", "Old"), inv("BC-R", "seed", "P-R"), prod("P-F", "Filed"), inv("BC-F", "seed", "P-F"), prod("GWP-000002", "Upd", "filed")],
    new Map([
      ["k-new", "GWP-000001"],
      ["k-upd", "GWP-000002"],
    ]),
  );
  const plan = planLedgerBatch({
    view,
    products: [
      { key: "k-new", legacyId: "k-new", ourName: "New" },
      { key: "k-r", legacyId: "k-r", ourName: "Renamed" },
      { key: "k-f", legacyId: "k-f", ourName: "Ours" },
      { key: "k-none", legacyId: "k-none", ourName: "None" },
      { key: "k-upd", legacyId: "k-upd", ourName: "Upd" },
    ],
    lots: [lot("a", "GWL-1", "k-new"), lot("b", "BC-R", "k-r"), lot("c", "BC-F", "k-f")],
    strains: [],
    renameFiledProductIds: new Set(["P-R"]),
  });
  const out = applyProductPlan(
    [row("New", "k-new"), row("Renamed", "k-r"), row("Ours", "k-f"), row("None", "k-none"), row("Upd", "k-upd")],
    ["k-new", "k-r", "k-f", "k-none", "k-upd"],
    plan,
  );
  it("rewrites id + Operation from the plan; appends the rename Update; reports skip and withhold", () => {
    const ext = C.indexOf("ExternalIdentifier");
    const op = C.indexOf("Operation");
    const nm = C.indexOf("Name");
    expect(out.rows.map((r) => [r[nm], r[ext], r[op]])).toEqual([
      ["New", "GWP-000001", "Insert"],
      ["Upd", "GWP-000002", "Update"],
      ["Renamed", "P-R", "Update"],
    ]);
    expect(out.skipped.map((s) => s.key).sort()).toEqual(["k-f", "k-r"]);
    expect(out.withheld).toEqual([{ key: "k-none", label: "None", reason: expect.stringMatching(/no CCRS Product id/) }]);
    expect(out.rows.every((r) => r.length === C.length)).toBe(true);
  });
  it("does not mutate its input rows", () => {
    const input = [row("New", "k-new")];
    applyProductPlan(input, ["k-new"], planLedgerBatch({ view: null, products: [{ key: "k-new", legacyId: "k-new", ourName: "New" }], lots: [], strains: [] }));
    expect(input[0][C.indexOf("ExternalIdentifier")]).toBe("k-new");
  });
  it("refuses misaligned input and unplanned keys (fail loud)", () => {
    expect(() => applyProductPlan([row("a", "a")], [], plan)).toThrow(/1 rows vs 0 keys/);
    expect(() => applyProductPlan([row("a", "a")], ["k-unknown"], plan)).toThrow(/no plan for product key "k-unknown"/);
  });
  it("legacy plan passes rows through byte-identical", () => {
    const rows = [row("A", "pos-a"), row("B", "pos-b")];
    const p = planLedgerBatch({
      view: null,
      products: [
        { key: "pos-a", legacyId: "pos-a", ourName: "A" },
        { key: "pos-b", legacyId: "pos-b", ourName: "B" },
      ],
      lots: [],
      strains: [],
    });
    expect(applyProductPlan(rows, ["pos-a", "pos-b"], p).rows).toEqual(rows);
  });
});

describe("issue codes and wiring (source guards)", () => {
  it("E39/E40/E41 exist with verbatim-checkable pins", () => {
    expect(CCRS_ISSUE_CODES).toEqual(expect.arrayContaining(["E39_STRAIN_CASE_VARIANT", "E40_PRODUCT_NAME_FROM_LEDGER", "E41_LEDGER_WITHHELD"]));
    expect(specPinFor("E39_STRAIN_CASE_VARIANT")).toBe("[G L0359]");
    expect(specPinFor("E40_PRODUCT_NAME_FROM_LEDGER")).toBe("[G L0580-L0583]");
    expect(specPinFor("E41_LEDGER_WITHHELD")).toBe("[G L0246-L0248]");
  });
  it("the Inventory row's Operation, Product and Strain come from the plan", () => {
    expect(SRC).toContain("      planned.op,\n    ]);");
    expect(SRC).toContain("const productName = planned.productName;");
    expect(SRC).toContain("const strain = planned.strain;");
    expect(SRC).not.toMatch(/const strain = \(item\?\.strain_name/);
  });
  it("the Strain file emits only what the plan allows, in the plan's casing", () => {
    expect(SRC).toContain("const strain = plan.strainCanonical.get(raw) ?? raw;");
    expect(SRC).toContain("if (!plan.strainEmit.has(strain)) continue;");
    expect(SRC).not.toContain("const key = strain.toLowerCase();");
  });
  it("the Product file goes through applyProductPlan; S-12b loads the ledger slice (null only when absent)", () => {
    expect(SRC).toContain("applyProductPlan(productBuild.rows, productBuild.keys, plan)");
    expect(SRC).not.toContain("const ledger: LedgerView | null = null;");
    expect(SRC).toContain("const slice = await loadLedgerForBatch(");
    expect(SRC).toContain('const ledger: LedgerView | null = slice.kind === "loaded" ? slice.ledger.view : null;');
    expect(SRC).toContain('code: "E41_LEDGER_WITHHELD"');
    expect(SRC).toContain('code: "E40_PRODUCT_NAME_FROM_LEDGER"');
    expect(SRC).toContain('code: "E39_STRAIN_CASE_VARIANT"');
  });
  it("the core stays pure (no I/O imports)", () => {
    expect(CORE).not.toMatch(/from "(node:|fs|@\/lib\/supabase|server-only)/);
  });
  it("embedded self-test passes", () => {
    expect(() => __runCcrsLedgerCoreTests()).not.toThrow();
  });
});
