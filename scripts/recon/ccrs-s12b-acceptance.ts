/**
 * scripts/recon/ccrs-s12b-acceptance.ts — S-12b acceptance dry run (Part 07).
 *
 * "A dry-run weekly batch on the seeded ledger produces an Inventory file
 *  where every shelf lot is `Update` and zero rows are `Insert` except lots
 *  received after cutover; the file verifies; the route refuses to emit the
 *  same content twice."
 *
 * Runs against a LOCAL Postgres that has 0001–0248 + the seed loaded (never
 * production: the URL must be a unix socket / localhost). It uses the SAME
 * code the route uses: ccrs_ledger_slice → decodeLedgerSlice → planLedgerBatch
 * → planOutboxFiles → verifyOutboxAgainstLedger → emitPayload →
 * ccrs_emit_files (inside a transaction that is ROLLED BACK).
 *
 *   PGURL="postgresql://postgres@/s12b?host=/tmp/pgsock&port=5433" \
 *     npx tsx scripts/recon/ccrs-s12b-acceptance.ts
 *
 * Prints "S-12B ACCEPTANCE PASSED" or exits 1. Prints counts only — no LCB
 * delivery rows are written anywhere (the repo is public).
 */
import { execFileSync } from "node:child_process";
import { assembleCcrsFile, CCRS_COLUMNS } from "../../src/lib/compliance/ccrs-batch-core";
import { planLedgerBatch, type PlanLot } from "../../src/lib/compliance/ccrs-ledger-core";
import { decodeLedgerSlice } from "../../src/lib/compliance/ccrs-ledger-store-core";
import { emitPayload, planOutboxFiles, verifyOutboxAgainstLedger } from "../../src/lib/compliance/ccrs-outbox-core";

const URL_ = process.env.PGURL ?? "";
if (!/host=\/tmp|@localhost|@127\.0\.0\.1/.test(URL_)) {
  console.error("PGURL must point at a LOCAL database (unix socket or localhost).");
  process.exit(2);
}
const psql = (sql: string, input?: string) =>
  execFileSync("psql", [URL_, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { input, maxBuffer: 1 << 28 }).toString();
const psqlFile = (script: string) =>
  execFileSync("psql", [URL_, "-v", "ON_ERROR_STOP=1", "-Atq"], { input: script, maxBuffer: 1 << 28 }).toString();
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed += 1;
};

// ── 1. The shelf: every live (seed) lot whose filed product is on file, plus
//      3 lots received after cutover (not on file) for products with a GWP id.
const shelf = psql(
  `select e.external_id || chr(9) || coalesce(e.seed_payload->>'Strain','') from ccrs_filed_entities e
     join ccrs_filed_entities p on p.env='prod' and p.file_type='Product' and p.external_id=e.product_external_id and p.state='seed' and coalesce(p.filed_name,'')<>''
    where e.env='prod' and e.file_type='Inventory' and e.state='seed' order by e.external_id limit 4200`,
)
  .trim()
  .split("\n")
  .map((l) => l.split("\t"));
const gwp = psql(`select product_key from ccrs_product_ids where env='prod' order by product_key limit 3`).trim().split("\n").filter(Boolean);
check(shelf.length >= 4000, `shelf sample = ${shelf.length} filed live lots`);
check(gwp.length === 3, `3 products with an assigned GWP id (${gwp.join(",")})`);
const heldStrain = psql(`select external_id from ccrs_filed_entities where env='prod' and file_type='Strain' and state='seed' order by 1 limit 1`).trim();
const NEW = ["GWL-20261007-000001", "GWL-20261007-000002", "GWL-20261007-000003"];

const lots: PlanLot[] = [
  ...shelf.map(([id, strain]) => ({ lotId: id, label: id, inventoryExternalId: id, productKey: "shelf", strain: strain.trim() })),
  ...NEW.map((id, i) => ({ lotId: id, label: id, inventoryExternalId: id, productKey: gwp[i], strain: heldStrain })),
];
const products = gwp.map((k, i) => ({ key: k, legacyId: k, ourName: `S12B Acceptance Product ${i + 1}` }));

// ── 2. The ledger slice, decoded exactly as the app does.
const sliceJson = psql(
  `select public.ccrs_ledger_slice('prod', array[${lots.map((l) => q(l.inventoryExternalId)).join(",")}]::text[], array[${products.map((p) => q(p.ourName)).join(",")}]::text[])::text`,
);
const t0 = Date.now();
const slice = decodeLedgerSlice("prod", JSON.parse(sliceJson), null);
check(slice.kind === "loaded", `ledger slice loaded (${(sliceJson.length / 1e6).toFixed(2)} MB, decoded in ${Date.now() - t0} ms)`);
if (slice.kind !== "loaded") process.exit(1);
const view = slice.ledger.view;
check(slice.ledger.duplicates.length === 0, "no duplicate ledger rows");

// ── 3. Route with the real planner.
const plan = planLedgerBatch({ view, lots, products, strains: [heldStrain] });
let upd = 0, ins = 0, wh = 0;
const insertIds: string[] = [];
for (const l of lots) {
  const p = plan.lots.get(l.lotId)!;
  if (p.action === "withhold") wh += 1;
  else if (p.op === "Update") upd += 1;
  else { ins += 1; insertIds.push(l.lotId); }
}
check(upd === shelf.length, `every shelf lot is Update (${upd}/${shelf.length})`);
check(ins === NEW.length && insertIds.every((id) => NEW.includes(id)), `Insert only for lots received after cutover (${ins}: ${insertIds.join(",")})`);
check(wh === 0, `nothing withheld (${wh})`);
check(gwp.every((k) => { const p = plan.products.get(k); return p?.action === "emit" && p.op === "Insert"; }), "post-cutover products Insert under their GWP id");
// D-06 (Part 08): the live strains CCRS does not hold in ANY casing. Part 04
// L126: those lots "cannot be Updated until either the strain is Inserted …
// or the lots are re-pointed". The planner must want exactly those strains
// (and never a strain CCRS holds); the verifier must block exactly those rows.
const d06 = new Set(
  psql(`select distinct e.seed_payload->>'Strain' from ccrs_filed_entities e where e.env='prod' and e.file_type='Inventory' and e.state='seed'
          and coalesce(e.seed_payload->>'Strain','')<>''
          and not exists (select 1 from ccrs_filed_entities s where s.env='prod' and s.file_type='Strain' and lower(s.external_id)=lower(e.seed_payload->>'Strain'))`)
    .split("\n").filter((x) => x !== ""),
);
check(d06.size === 16, `D-06 hard-missing live strains = ${d06.size} (Part 08 says 16)`);
const sampleD06 = new Set(shelf.map(([, st]) => st.trim()).filter((st) => d06.has(st)));
const sampleD06Rows = shelf.filter(([, st]) => d06.has(st.trim())).length;
check([...plan.strainEmit].every((st) => sampleD06.has(st)) && [...sampleD06].every((st) => plan.strainEmit.has(st)),
  `the planner wants a Strain row for exactly the D-06 strains in this sample (${plan.strainEmit.size}), never a held one`);

// ── 4. Assemble the Product + Inventory files exactly as the builder lays rows out.
const now = new Date("2026-10-07T19:00:00Z");
const productRows = gwp.map((k, i) => {
  const p = plan.products.get(k)!;
  if (p.action !== "emit") throw new Error("unreachable");
  return ["413541", "EndProduct", "Usable Marijuana", products[i].ourName, "", "3.5", p.ext, "Greenway", "10/07/2026", "", "", p.op];
});
const invRows = lots.map((l) => {
  const p = plan.lots.get(l.lotId)!;
  if (p.action !== "emit") throw new Error("unreachable");
  return ["413541", p.strain, "Sales Floor", p.productName, "5", "1", "14.00", "FALSE", l.inventoryExternalId, "Greenway", "10/07/2026", "Greenway", "10/07/2026", p.op];
});
check(invRows.every((r) => r.length === CCRS_COLUMNS.Inventory.length) && productRows.every((r) => r.length === CCRS_COLUMNS.Product.length), "row widths match the templates");
const files = planOutboxFiles(
  [
    { type: "Product", csv: assembleCcrsFile({ type: "Product", submittedBy: "Greenway", submittedDate: now, rows: productRows }) },
    { type: "Inventory", csv: assembleCcrsFile({ type: "Inventory", submittedBy: "Greenway", submittedDate: now, rows: invRows }) },
    { type: "Area", csv: assembleCcrsFile({ type: "Area", submittedBy: "Greenway", submittedDate: now, rows: [] }) },
  ],
  { licenseNumber: "413541", now, lastStamp: slice.ledger.lastStamp },
);
check(files.length === 2 && files[0].type === "Product" && files[1].type === "Inventory", `Product then Inventory; empty Area not emitted (${files.map((f) => f.fileName).join(", ")})`);

// ── 5. The file verifies against the ledger …
const problems = verifyOutboxAgainstLedger(view, files);
const strainProblems = problems.filter((p) => p.code === "L_REF_STRAIN");
check(problems.length === strainProblems.length, `ledger self-check: no problem other than D-06 strains (${problems.length - strainProblems.length} other)`);
check(strainProblems.length === sampleD06Rows, `ledger self-check blocks exactly the ${sampleD06Rows} D-06 row(s) (${strainProblems.length})`);
// With the D-06 strains Inserted first (the "Insert" branch of D-06), the same
// bytes verify clean — proof the block is ONLY the missing strains.
const withStrains = planOutboxFiles(
  [
    { type: "Strain", csv: assembleCcrsFile({ type: "Strain", submittedBy: "Greenway", submittedDate: now, rows: [...plan.strainEmit].map((st) => ["413541", st, "Hybrid", "Greenway", "10/07/2026"]) }) },
    { type: "Product", csv: files[0].csv },
    { type: "Inventory", csv: files[1].csv },
  ],
  { licenseNumber: "413541", now, lastStamp: slice.ledger.lastStamp },
);
const clean = verifyOutboxAgainstLedger(view, withStrains);
check(clean.length === 0, `with the D-06 strains Inserted first the emission verifies clean (${clean.length}${clean.length ? ": " + clean.slice(0, 2).map((p) => p.message).join(" | ") : ""})`);

// … and catches the three spec cases (Part 07 S-12b "verifyCcrsFile extension").
const tamper = (from: RegExp, to: string) => {
  const inv = files[1];
  const csv = inv.csv.replace(from, to);
  const again = planOutboxFiles([{ type: "Product", csv: files[0].csv }, { type: "Inventory", csv }], { licenseNumber: "413541", now, lastStamp: slice.ledger.lastStamp });
  return verifyOutboxAgainstLedger(view, again).map((p) => p.code);
};
const firstShelf = shelf[0][0];
check(tamper(new RegExp(`(,${firstShelf},Greenway,10/07/2026,Greenway,10/07/2026,)Update`), "$1Insert").includes("L_INSERT_ON_FILE"), "Insert of a ledger-present id → L_INSERT_ON_FILE");
check(tamper(/(,GWL-20261007-000001,Greenway,10\/07\/2026,Greenway,10\/07\/2026,)Insert/, "$1Update").includes("L_UPDATE_NOT_ON_FILE"), "Update of a ledger-absent id → L_UPDATE_NOT_ON_FILE");
check(tamper(/,Sales Floor,/, ",Back Room S12B,").includes("L_REF_AREA"), "Area string not in the ledger → L_REF_AREA");
check(tamper(/S12B Acceptance Product 1,5,/, "S12B Not Filed,5,").includes("L_REF_PRODUCT"), "Product string not in the ledger → L_REF_PRODUCT");
check(tamper(new RegExp(`413541,${heldStrain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},Sales Floor,S12B`), "413541,Zz Not A Strain S12B,Sales Floor,S12B").includes("L_REF_STRAIN"), "Strain string not in the ledger → L_REF_STRAIN");

// ── 6. Emit (in a rolled-back transaction): first call emits, second refuses.
const payload = JSON.stringify(emitPayload(files));
const out = psqlFile(
  `begin;\n` +
    `select public.ccrs_emit_files('prod', $p$${payload}$p$::jsonb, '[]'::jsonb)->'files';\n` +
    `select public.ccrs_emit_files('prod', $p$${payload}$p$::jsonb, '[]'::jsonb)->'files';\n` +
    `select count(*) from ccrs_file_rows r join ccrs_files f on f.id=r.file_id where f.purpose='weekly' and r.operation='Update';\n` +
    `rollback;\n`,
).trim().split("\n");
const first = JSON.parse(out[0]) as { status: string }[];
const second = JSON.parse(out[1]) as { status: string; file_name: string }[];
check(first.length === 2 && first.every((r) => r.status === "emitted"), "first emit: both files emitted");
check(second.length === 2 && second.every((r) => r.status === "duplicate"), "second emit of the same bytes: refused as duplicate");
check(second.map((r) => r.file_name).join() === files.map((f) => f.fileName).join(), "duplicate answers carry the STORED names");
check(Number(out[2]) === shelf.length, `rows stored from the bytes: ${out[2]} Update rows`);

if (failed > 0) {
  console.log(`S-12B ACCEPTANCE FAILED (${failed})`);
  process.exit(1);
}
console.log("S-12B ACCEPTANCE PASSED");
