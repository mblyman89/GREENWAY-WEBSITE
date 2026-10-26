/**
 * src/lib/compliance/ccrs-scoreboard-core.ts  (R74 S48, Round 29). PURE.
 *
 * The CCRS test scoreboard. The owner: "I want the system to tell me what I
 * have tested so far that it is aware of, and if I have passed those tests,
 * what tests remain, and how I can go about testing it to get a green passing
 * mark", with "a loud congratulations green banner" when every event passes.
 *
 * WHERE THE EVIDENCE COMES FROM. Only the hub's own record (0247/0249): every
 * row this system sent (`ccrs_file_rows`, with its CSV payload) and what CCRS
 * answered for it (row state + file state). Nothing is self-reported:
 *   PASSED   a row of this kind went in a file CCRS answered, and the row was
 *            not refused (row state submitted / confirmed, file answered).
 *   WAITING  sent, but CCRS's answer is not recorded yet (file emitted/uploaded).
 *   FAILED   CCRS refused it (row rejected) or the answer is unclear (uncertain,
 *            e.g. "Duplicate External Identifier"), and no attempt passed yet.
 *   NOT TESTED  this system never sent one.
 *
 * The list is every kind of event this system files for a retailer: the
 * master files (Strain, Area, Product, Inventory), the Sale file (sales,
 * medical, returns as Update/Delete [FAQ L0052-L0053]), the Adjustment
 * reasons the store uses (mapAdjustmentReason) and received transfers.
 */

export type ScoreStatus = "passed" | "waiting" | "failed" | "not-tested";

/** One row the hub sent, with the state CCRS left it in. */
export type ScoreRow = {
  rowState: string;
  fileState: string;
  fileName: string;
  operation: string | null;
  payload: Record<string, unknown>;
  /** when CCRS answered the file (success or error email) */
  answeredAt: string | null;
};

/** How the store finds the rows of one test (PostgREST filters on the payload). */
export type ScoreQuery = {
  fileType: "Strain" | "Area" | "Product" | "Inventory" | "Sale" | "InventoryAdjustment" | "InventoryTransfer";
  operation?: "Insert" | "Update" | "Delete";
  /** payload field equals this text */
  eq?: Record<string, string>;
  /** payload field differs from this text */
  neq?: Record<string, string>;
};

export type ScoreTest = {
  id: string;
  group: "Set-up files" | "Products and lots" | "Sales and returns" | "Adjustments" | "Receiving";
  title: string;
  required: boolean;
  query: ScoreQuery;
  /** extra check the database filter cannot do (numbers) */
  match?: (p: Record<string, unknown>) => boolean;
  /** how to make one happen, in plain English */
  howTo: string;
};

const num = (v: unknown) => {
  const n = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(n) ? n : NaN;
};

export const SCORE_TESTS: readonly ScoreTest[] = [
  {
    id: "strain",
    group: "Set-up files",
    title: "Strain file accepted",
    required: true,
    query: { fileType: "Strain" },
    howTo: "Publish a product with a strain CCRS has not seen, export PREprod, upload the Strain file first. \"Duplicate Strain\" also counts (the strain is on file either way).",
  },
  {
    id: "area",
    group: "Set-up files",
    title: "Area (Sales Floor) accepted",
    required: true,
    query: { fileType: "Area" },
    howTo: "The first PREprod export carries the Sales Floor Area. Upload it with the Strain and Product files; once CCRS holds it, it is not sent again.",
  },
  {
    id: "product-new",
    group: "Products and lots",
    title: "New product (Product Insert)",
    required: true,
    query: { fileType: "Product", operation: "Insert" },
    howTo: "Publish a new product (or assign PREprod product ids), export PREprod, upload the Product file.",
  },
  {
    id: "product-update",
    group: "Products and lots",
    title: "Product changed (Product Update)",
    required: true,
    query: { fileType: "Product", operation: "Update" },
    howTo: "After CCRS holds a product, change its name or weight in the catalog, export PREprod again and upload the Product file.",
  },
  {
    id: "lot-new",
    group: "Products and lots",
    title: "New lot (Inventory Insert)",
    required: true,
    query: { fileType: "Inventory", operation: "Insert" },
    howTo: "Receive a delivery (Inventory > Intake), export PREprod, upload Inventory at least 10 minutes after Product.",
  },
  {
    id: "lot-update",
    group: "Products and lots",
    title: "Lot quantity changed (Inventory Update)",
    required: true,
    query: { fileType: "Inventory", operation: "Update" },
    howTo: "After CCRS holds a lot (run Settle PREprod duplicates if it said Duplicate), sell from it or adjust it, export PREprod again and upload Inventory.",
  },
  {
    id: "lot-zero",
    group: "Products and lots",
    title: "Lot sold out (quantity 0 reported)",
    required: false,
    query: { fileType: "Inventory", eq: { QuantityOnHand: "0" } },
    howTo: "Sell or adjust a lot down to 0, export PREprod and upload Inventory.",
  },
  {
    id: "sale",
    group: "Sales and returns",
    title: "Recreational sale",
    required: true,
    query: { fileType: "Sale", operation: "Insert", eq: { SaleType: "RecreationalRetail" } },
    howTo: "Ring up a sale on the register (PREprod lots), export PREprod, upload Sale after Inventory is accepted.",
  },
  {
    id: "sale-multi-discount",
    group: "Sales and returns",
    title: "Sale line with quantity 2+ and a discount",
    required: true,
    query: { fileType: "Sale", operation: "Insert", neq: { Quantity: "1" } },
    match: (p) => num(p.Quantity) >= 2 && num(p.Discount) > 0,
    howTo: "Sell 2 or more of one item on one line with a discount (a deal or a manual discount). CCRS takes the discount and taxes for the whole line [FAQ L0154].",
  },
  {
    id: "sale-medical",
    group: "Sales and returns",
    title: "Medical sale (RecreationalMedical)",
    required: false,
    query: { fileType: "Sale", eq: { SaleType: "RecreationalMedical" } },
    howTo: "Only with the medical endorsement: ring up a sale with a valid recognition card and exempt products, export PREprod, upload Sale.",
  },
  {
    id: "return-full",
    group: "Sales and returns",
    title: "Full return (Sale Delete)",
    required: true,
    query: { fileType: "Sale", operation: "Delete" },
    howTo: "After CCRS accepted a sale, return the whole line (Registers > Returns), export PREprod, upload Sale.",
  },
  {
    id: "return-partial",
    group: "Sales and returns",
    title: "Partial return (Sale Update)",
    required: false,
    query: { fileType: "Sale", operation: "Update" },
    howTo: "After CCRS accepted a sale of 2 or more, return only part of that line, export PREprod, upload Sale.",
  },
  {
    id: "adj-lost",
    group: "Adjustments",
    title: "Damage / shrink (Lost)",
    required: true,
    query: { fileType: "InventoryAdjustment", eq: { AdjustmentReason: "Lost" } },
    howTo: "On a lot CCRS holds: Inventory > the lot > Adjust, reason Damage or Shrink, take 1 off. Export PREprod, upload the Adjustment file.",
  },
  {
    id: "adj-destruction",
    group: "Adjustments",
    title: "Destruction",
    required: true,
    query: { fileType: "InventoryAdjustment", eq: { AdjustmentReason: "Destruction" } },
    howTo: "Inventory > the lot > Adjust, reason Destruction (or complete a destruction in Disposition). Export PREprod, upload Adjustment.",
  },
  {
    id: "adj-count",
    group: "Adjustments",
    title: "Cycle-count correction (Reconciliation)",
    required: true,
    query: { fileType: "InventoryAdjustment", eq: { AdjustmentReason: "Reconciliation" } },
    howTo: "Run a cycle count with a difference, or Adjust a lot with reason Cycle-count correction. Export PREprod, upload Adjustment.",
  },
  {
    id: "adj-other",
    group: "Adjustments",
    title: "Return add-back / employee sample (Other)",
    required: false,
    query: { fileType: "InventoryAdjustment", eq: { AdjustmentReason: "Other" } },
    howTo: "A customer return put back to stock, or an employee sample (Adjust, reason Employee sample). Export PREprod, upload Adjustment.",
  },
  {
    id: "adj-lab",
    group: "Adjustments",
    title: "Lab / QA sample (ReturnedLabSample)",
    required: false,
    query: { fileType: "InventoryAdjustment", eq: { AdjustmentReason: "ReturnedLabSample" } },
    howTo: "Adjust a lot with reason Sample (lab/QA). Export PREprod, upload Adjustment.",
  },
  {
    id: "transfer-in",
    group: "Receiving",
    title: "Delivery received (InventoryTransfer)",
    required: true,
    query: { fileType: "InventoryTransfer", operation: "Insert" },
    howTo: "Receive a vendor delivery with the vendor's CCRS lot id read from their manifest (Inventory > Intake), export PREprod, upload Inventory, then the Transfer file.",
  },
];

const ANSWERED_FILE = new Set(["succeeded", "errored", "reconciling", "closed"]);
const OK_ROW = new Set(["submitted", "confirmed"]);
const WAITING_FILE = new Set(["emitted", "uploaded"]);

export type TestResult = {
  test: ScoreTest;
  status: ScoreStatus;
  /** passed: how many accepted rows of this kind were seen (in the sample read) */
  passedCount: number;
  lastPass: { fileName: string; at: string | null } | null;
  waitingFile: string | null;
  failure: { fileName: string; why: string } | null;
};

export function rowVerdict(r: ScoreRow): "pass" | "wait" | "fail" | "other" {
  if (ANSWERED_FILE.has(r.fileState) && OK_ROW.has(r.rowState)) return "pass";
  if (WAITING_FILE.has(r.fileState)) return "wait";
  if (r.rowState === "rejected" || r.rowState === "uncertain") return "fail";
  return "other";
}

export function scoreTest(test: ScoreTest, rows: readonly ScoreRow[]): TestResult {
  const mine = rows.filter((r) => (!test.match || test.match(r.payload)));
  const passes = mine.filter((r) => rowVerdict(r) === "pass");
  const waits = mine.filter((r) => rowVerdict(r) === "wait");
  const fails = mine.filter((r) => rowVerdict(r) === "fail");
  const newest = (xs: ScoreRow[]) => [...xs].sort((a, b) => ((a.answeredAt ?? "") < (b.answeredAt ?? "") ? 1 : -1))[0];
  const p = passes.length ? newest(passes) : null;
  const f = fails.length ? newest(fails) : null;
  const status: ScoreStatus = passes.length ? "passed" : waits.length ? "waiting" : fails.length ? "failed" : "not-tested";
  return {
    test,
    status,
    passedCount: passes.length,
    lastPass: p ? { fileName: p.fileName, at: p.answeredAt } : null,
    waitingFile: waits[0]?.fileName ?? null,
    failure: f ? { fileName: f.fileName, why: f.rowState === "uncertain" ? "CCRS's answer is unclear (often \"Duplicate External Identifier\": run Settle PREprod duplicates, then test again)" : "CCRS refused this row; open the file in the files list for the message" } : null,
  };
}

export type Scoreboard = {
  results: TestResult[];
  required: number;
  requiredPassed: number;
  optionalPassed: number;
  optional: number;
  allRequiredPassed: boolean;
  allPassed: boolean;
};

export function buildScoreboard(rowsByTest: ReadonlyMap<string, readonly ScoreRow[]>, tests: readonly ScoreTest[] = SCORE_TESTS): Scoreboard {
  const results = tests.map((t) => scoreTest(t, rowsByTest.get(t.id) ?? []));
  const req = results.filter((r) => r.test.required);
  const opt = results.filter((r) => !r.test.required);
  const requiredPassed = req.filter((r) => r.status === "passed").length;
  const optionalPassed = opt.filter((r) => r.status === "passed").length;
  return {
    results,
    required: req.length,
    requiredPassed,
    optional: opt.length,
    optionalPassed,
    allRequiredPassed: req.length > 0 && requiredPassed === req.length,
    allPassed: results.every((r) => r.status === "passed"),
  };
}

export const STATUS_TEXT: Record<ScoreStatus, string> = {
  passed: "PASSED",
  waiting: "Waiting for CCRS",
  failed: "Not passed yet",
  "not-tested": "Not tested",
};

/** The next tests to do, required first, in list order (at most n). */
export function nextTests(b: Scoreboard, n = 3): TestResult[] {
  const open = b.results.filter((r) => r.status !== "passed" && r.status !== "waiting");
  return [...open.filter((r) => r.test.required), ...open.filter((r) => !r.test.required)].slice(0, n);
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsScoreboardTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-scoreboard-core: ${m}`);
    }
  };
  const row = (o: Partial<ScoreRow>): ScoreRow => ({ rowState: "submitted", fileState: "closed", fileName: "F.csv", operation: "Insert", payload: {}, answeredAt: "2026-10-25T20:00:00Z", ...o });
  ok(new Set(SCORE_TESTS.map((t) => t.id)).size === SCORE_TESTS.length, "unique ids");
  ok(SCORE_TESTS.every((t) => t.howTo.length > 20), "every test says how");
  ok(rowVerdict(row({})) === "pass", "answered + accepted = pass");
  ok(rowVerdict(row({ fileState: "uploaded" })) === "wait", "waiting");
  ok(rowVerdict(row({ rowState: "rejected", fileState: "closed" })) === "fail", "rejected");
  ok(rowVerdict(row({ rowState: "uncertain", fileState: "reconciling" })) === "fail", "uncertain is not a pass");
  ok(rowVerdict(row({ rowState: "rejected", fileState: "abandoned" })) === "fail", "abandoned + rejected");
  const multi = SCORE_TESTS.find((t) => t.id === "sale-multi-discount")!;
  ok(scoreTest(multi, [row({ payload: { Quantity: "3", Discount: "43.77" } })]).status === "passed", "qty 3 with discount passes");
  ok(scoreTest(multi, [row({ payload: { Quantity: "2", Discount: "0.00" } })]).status === "not-tested", "no discount does not count");
  const sale = SCORE_TESTS.find((t) => t.id === "sale")!;
  const mixed = scoreTest(sale, [row({ rowState: "rejected" }), row({ fileState: "uploaded", fileName: "W.csv" })]);
  ok(mixed.status === "waiting" && mixed.waitingFile === "W.csv" && mixed.failure !== null, "waiting beats failed");
  ok(scoreTest(sale, [row({ rowState: "rejected" }), row({ fileName: "OK.csv" })]).lastPass?.fileName === "OK.csv", "a pass wins");
  const all = new Map(SCORE_TESTS.map((t) => [t.id, [row({ payload: { Quantity: "2", Discount: "1" } })]]));
  const b = buildScoreboard(all);
  ok(b.allRequiredPassed && b.allPassed && b.requiredPassed === b.required, "everything passed");
  const none = buildScoreboard(new Map());
  ok(!none.allRequiredPassed && none.requiredPassed === 0 && nextTests(none)[0].test.id === "strain", "fresh board, next is strain");
  const reqOnly = new Map(SCORE_TESTS.filter((t) => t.required).map((t) => [t.id, [row({ payload: { Quantity: "2", Discount: "1" } })]]));
  const r2 = buildScoreboard(reqOnly);
  ok(r2.allRequiredPassed && !r2.allPassed && nextTests(r2).every((x) => !x.test.required), "required done, optional next");
  return { passed, failed };
}
