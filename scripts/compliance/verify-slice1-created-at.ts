/**
 * scripts/compliance/verify-slice1-created-at.ts  (SLICE 1 verification)
 *
 * Proves the created_at fix at the level that actually matters: the wire.
 *
 * Instead of trusting a description of how @supabase/postgrest-js serializes an
 * array insert, this harness drives the REAL installed PostgrestQueryBuilder
 * with a stub fetch and inspects the request it would have sent:
 *   - the `columns=` query parameter (postgrest-js builds it from the UNION of
 *     every row's keys)
 *   - the `Prefer` header (whether `missing=default` is present)
 *   - the JSON body (whether any row omits created_at, which PostgREST then
 *     writes as an explicit NULL)
 *
 * It replays the batch shape of the real Cultivera import using the counts
 * VERIFIED from the two source workbooks and recorded in
 * FORENSIC_AUDIT_CULTIVERA_IMPORT.md:
 *   4,179 planned lots = 3,977 with a Received date + 202 without,
 *   inserted in batches of LOT_BATCH = 200 (import-service.ts:384).
 * Lot ORDER follows the planner's documented sort (dated ascending first,
 * undated last), so the batch boundaries here match production.
 *
 * Run: npx tsx scripts/compliance/verify-slice1-created-at.ts
 */
import { PostgrestQueryBuilder } from "@supabase/postgrest-js";
import { resolveLotCreatedAt, findNonUniformInsertRow, insertKeySignature } from "../../src/lib/pos/import-lot-core";

// ---------------------------------------------------------------------------
// Verified ground truth (FORENSIC_AUDIT_CULTIVERA_IMPORT.md)
// ---------------------------------------------------------------------------
const TOTAL_LOTS = 4179;
const UNDATED_LOTS = 202;
const DATED_LOTS = TOTAL_LOTS - UNDATED_LOTS; // 3977
const LOT_BATCH = 200; // src/lib/pos/import-service.ts:384

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    console.error(`  FAIL  ${msg}`);
    failures++;
  }
};

/**
 * Planned lots in the planner's sort order: dated ascending, undated last.
 *
 * Received dates are laid out ENDING one day before `asOf` so the fixture
 * reflects reality: a Cultivera "Received date" records stock that has already
 * been received, so it is in the past relative to the publish run. (The
 * future-dated edge case is covered separately in section 4b.)
 */
function plannedCreatedAt(asOf: Date): (string | null)[] {
  const out: (string | null)[] = [];
  const endMs = asOf.getTime() - 86_400_000;
  const stepMs = 6 * 3600_000;
  for (let i = DATED_LOTS - 1; i >= 0; i--) {
    const day = new Date(endMs - i * stepMs);
    out.push(`${day.toISOString().slice(0, 10)}T12:00:00.000Z`);
  }
  for (let i = 0; i < UNDATED_LOTS; i++) out.push(null);
  return out;
}

/** The row shape import-service.ts builds, pre-SLICE-1 (conditional spread). */
function legacyRow(createdAtIso: string | null, i: number): Record<string, unknown> {
  return {
    lot_code: `BC-${i}`,
    ccrs_inventory_external_id: `BC-${i}`,
    received_qty: 1,
    expires_on: null,
    status: "active",
    ...(createdAtIso ? { created_at: createdAtIso } : {}),
  };
}

/** The row shape import-service.ts builds AFTER SLICE 1. */
function fixedRow(createdAtIso: string | null, i: number, fallbackIso: string): Record<string, unknown> {
  return {
    lot_code: `BC-${i}`,
    ccrs_inventory_external_id: `BC-${i}`,
    received_qty: 1,
    expires_on: null,
    status: "active",
    created_at: resolveLotCreatedAt(createdAtIso, fallbackIso),
  };
}

/** Drive the REAL postgrest-js insert() and capture the request it emits. */
async function captureInsertRequest(rows: Record<string, unknown>[]): Promise<{
  columns: string[];
  prefer: string;
  body: Record<string, unknown>[];
}> {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody = "";
  const stubFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    capturedUrl = String(url);
    capturedHeaders = init.headers;
    capturedBody = init.body;
    return new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;

  const qb = new PostgrestQueryBuilder(new URL("https://example.supabase.co/rest/v1/inventory_lots"), {
    headers: { apikey: "stub" },
    fetch: stubFetch,
  });
  await qb.insert(rows);

  const parsed = new URL(capturedUrl);
  const columnsParam = parsed.searchParams.get("columns") ?? "";
  const columns = columnsParam
    ? columnsParam.split(",").map((c) => c.replace(/^"|"$/g, ""))
    : [];
  const preferKey = Object.keys(capturedHeaders).find((k) => k.toLowerCase() === "prefer");
  return {
    columns,
    prefer: preferKey ? capturedHeaders[preferKey] : "",
    body: JSON.parse(capturedBody) as Record<string, unknown>[],
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const planned = plannedCreatedAt(now);
  const fallbackIso = now.toISOString();

  console.log("SLICE 1 verification - inventory_lots.created_at\n");
  console.log(`Replaying ${TOTAL_LOTS} planned lots (${DATED_LOTS} dated + ${UNDATED_LOTS} undated) in batches of ${LOT_BATCH}.\n`);

  // -------------------------------------------------------------------------
  // 1. Reproduce the ORIGINAL defect so we know the harness detects it.
  // -------------------------------------------------------------------------
  console.log("1. Pre-SLICE-1 behaviour (control - must reproduce the crash condition)");
  const legacyMixedBatches: number[] = [];
  let legacyFirstBadBatch = -1;
  for (let start = 0, b = 1; start < TOTAL_LOTS; start += LOT_BATCH, b++) {
    const slice = planned.slice(start, start + LOT_BATCH);
    const rows = slice.map((iso, i) => legacyRow(iso, start + i));
    if (findNonUniformInsertRow(rows) !== null) {
      legacyMixedBatches.push(b);
      if (legacyFirstBadBatch === -1) legacyFirstBadBatch = b;
    }
  }
  check(legacyMixedBatches.length > 0, `old builder produces ragged batches (count=${legacyMixedBatches.length}, first=batch ${legacyFirstBadBatch})`);

  // Prove PostgREST would receive an explicit NULL for the undated rows.
  {
    const mixed = [legacyRow("2024-01-01T12:00:00.000Z", 1), legacyRow(null, 2)];
    const req = await captureInsertRequest(mixed);
    check(req.columns.includes("created_at"), "old builder still puts created_at in columns= (union of keys)");
    check(!req.prefer.includes("missing=default"), "postgrest-js does NOT send Prefer: missing=default (defaultToNull=true)");
    check(!("created_at" in req.body[1]), "the undated row omits created_at in the body -> PostgREST writes NULL -> not-null violation");
  }

  // -------------------------------------------------------------------------
  // 2. SLICE 1 behaviour across every real batch.
  // -------------------------------------------------------------------------
  console.log("\n2. Post-SLICE-1 behaviour (all batches)");
  let batches = 0;
  let ragged = 0;
  let nullCreatedAt = 0;
  let rowsBuilt = 0;
  const signatures = new Set<string>();
  const usedFallback: number[] = [];

  for (let start = 0; start < TOTAL_LOTS; start += LOT_BATCH) {
    const slice = planned.slice(start, start + LOT_BATCH);
    const rows = slice.map((iso, i) => fixedRow(iso, start + i, fallbackIso));
    batches++;
    rowsBuilt += rows.length;
    if (findNonUniformInsertRow(rows) !== null) ragged++;
    for (const r of rows) {
      signatures.add(insertKeySignature(r));
      const v = r.created_at;
      if (v === null || v === undefined || v === "") nullCreatedAt++;
      if (v === fallbackIso) usedFallback.push(1);
    }
  }

  check(batches === Math.ceil(TOTAL_LOTS / LOT_BATCH), `batch count = ${batches} (expected ${Math.ceil(TOTAL_LOTS / LOT_BATCH)})`);
  check(rowsBuilt === TOTAL_LOTS, `rows built = ${rowsBuilt} (expected ${TOTAL_LOTS})`);
  check(ragged === 0, `ragged batches = ${ragged} (expected 0)`);
  check(nullCreatedAt === 0, `rows with null/empty created_at = ${nullCreatedAt} (expected 0)`);
  check(signatures.size === 1, `distinct key signatures across all ${TOTAL_LOTS} rows = ${signatures.size} (expected 1)`);
  check(usedFallback.length === UNDATED_LOTS, `rows using the now-fallback = ${usedFallback.length} (expected ${UNDATED_LOTS})`);

  // -------------------------------------------------------------------------
  // 3. Wire-level proof on the batch that used to fail.
  // -------------------------------------------------------------------------
  console.log("\n3. Wire-level proof (real postgrest-js request)");
  {
    // The first batch that mixes dated and undated lots under the fix.
    const boundary = DATED_LOTS - 5;
    const slice = planned.slice(boundary, boundary + 10);
    const rows = slice.map((iso, i) => fixedRow(iso, boundary + i, fallbackIso));
    check(slice.some((s) => s === null) && slice.some((s) => s !== null), "test slice genuinely mixes dated and undated lots");

    const req = await captureInsertRequest(rows);
    check(req.columns.includes("created_at"), "created_at present in columns=");
    check(
      req.body.every((r) => "created_at" in r && r.created_at !== null && r.created_at !== ""),
      "every row in the body carries a non-null created_at -> no not-null violation possible",
    );
    const bodyKeySets = new Set(req.body.map((r) => Object.keys(r).sort().join(",")));
    check(bodyKeySets.size === 1, `serialized body has one key set (${bodyKeySets.size})`);
    check(
      req.columns.length === Object.keys(req.body[0]).length,
      `columns= (${req.columns.length}) matches the per-row key count (${Object.keys(req.body[0]).length}) - no phantom columns`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. FIFO intent preserved.
  // -------------------------------------------------------------------------
  console.log("\n4. FIFO ordering intent");
  {
    const resolved = planned.map((iso) => resolveLotCreatedAt(iso, fallbackIso));
    const lastDated = resolved[DATED_LOTS - 1];
    const firstUndated = resolved[DATED_LOTS];
    check(firstUndated === fallbackIso, "undated lots carry the run's fallback instant");
    check(lastDated < firstUndated, `undated lots sort AFTER every dated lot (${lastDated} < ${firstUndated})`);
    let monotonic = true;
    for (let i = 1; i < resolved.length; i++) if (resolved[i] < resolved[i - 1]) monotonic = false;
    check(monotonic, "resolved created_at is non-decreasing in plan order (FIFO consumes oldest first)");
  }

  // -------------------------------------------------------------------------
  // 4b. Edge case found while building this harness: a FUTURE received date.
  //
  // The planner sorts undated lots last on the assumption that "now" is younger
  // than every received date. That holds for real received stock, but if a POS
  // export ever carried a received date AFTER the publish instant (data-entry
  // typo, e.g. 2027 for 2026), the undated lot would sort BEFORE it in
  // created_at order and be consumed first by FIFO.
  //
  // This is a DATA-QUALITY caveat, not a crash: created_at is still non-null,
  // the insert still succeeds, and the write is still correct. It is asserted
  // here so the behaviour is documented and cannot change silently. Surfacing
  // future-dated receipts as an enrichment warning belongs to SLICE 6.
  // -------------------------------------------------------------------------
  console.log("\n4b. Future-dated received date (documented edge case, not a crash)");
  {
    const future = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10) + "T12:00:00.000Z";
    const rows = [fixedRow(future, 1, fallbackIso), fixedRow(null, 2, fallbackIso)];
    check(
      rows.every((r) => typeof r.created_at === "string" && r.created_at !== ""),
      "future-dated + undated rows both still carry a non-null created_at (insert succeeds)",
    );
    check(findNonUniformInsertRow(rows) === null, "future-dated batch is still key-uniform");
    check(
      String(rows[1].created_at) < String(rows[0].created_at),
      "KNOWN CAVEAT: an undated lot sorts before a future-dated lot in FIFO (flagged for SLICE 6 enrichment)",
    );
  }

  console.log("");
  if (failures > 0) {
    console.error(`SLICE 1 VERIFICATION FAILED: ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("SLICE 1 VERIFICATION PASSED - no path emits a NULL created_at.");
}

void main();
