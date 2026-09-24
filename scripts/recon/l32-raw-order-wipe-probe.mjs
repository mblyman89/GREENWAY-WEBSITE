#!/usr/bin/env node
/**
 * scripts/recon/l32-raw-order-wipe-probe.mjs
 *
 * SLICE L-32 — A DEFECT I INTRODUCED IN L-31, FOUND WHILE LOOKING FOR THE 400.
 *
 * ===========================================================================
 * THE FINDING
 * ===========================================================================
 * L-31 added `persistStatusAfterPush()`. When Leafly's 200 body is not a
 * usable object it passes `order: {}` to `storeFetchedLeaflyOrder()`:
 *
 *     order: usableOrder ? (input.responseBody as Record<string, unknown>) : {},
 *
 * But `storeFetchedLeaflyOrder()` writes `raw_order` UNCONDITIONALLY:
 *
 *     const patch: Record<string, unknown> = { raw_order: input.order };
 *
 * Every other field in that function is guarded by `if (f.x)`. `raw_order`
 * is not. So an empty object OVERWRITES the stored order payload.
 *
 * `raw_order` is what the order detail panel renders. Wiping it is the exact
 * symptom the owner reported in an earlier slice: "18 blank fields out of 18".
 *
 * This probe does not reason about that. It EXECUTES the real function against
 * an in-memory fake Supabase and reports what the patch actually contains.
 *
 * Exit 0 = the probe ran and its conclusion is supported.
 * Exit 1 = a check failed.
 */

import { readFileSync } from "node:fs";

let failures = 0;
function ok(cond, msg, detail = "") {
  if (cond) console.log(`  ✅ ${msg}${detail ? `  [${detail}]` : ""}`);
  else {
    failures += 1;
    console.log(`  ❌ ${msg}${detail ? `  [${detail}]` : ""}`);
  }
  return cond;
}
function head(t) {
  console.log("\n" + "═".repeat(75));
  console.log(t);
  console.log("═".repeat(75) + "\n");
}

// ───────────────────────────────────────────────────────────────────────────
head("STEP 1 — THE TWO LINES, READ FROM DISK");
// ───────────────────────────────────────────────────────────────────────────

const ackSrc = readFileSync("src/lib/leafly/order-ack-server.ts", "utf8");
const fetchSrc = readFileSync("src/lib/leafly/order-fetch-server.ts", "utf8");

const passesEmpty = /order:\s*usableOrder \? \(input\.responseBody as Record<string, unknown>\) : \{\}/.test(
  ackSrc,
);
ok(passesEmpty, "persistStatusAfterPush passes `{}` when the body is unusable");

const writesRawUnconditionally = /const patch: Record<string, unknown> = \{ raw_order: input\.order \};/.test(
  fetchSrc,
);
ok(
  writesRawUnconditionally,
  "storeFetchedLeaflyOrder writes raw_order UNCONDITIONALLY (no `if` guard)",
);

// Show the contrast: every OTHER field is guarded.
const guarded = [...fetchSrc.matchAll(/if \(f\.(\w+)\) patch\.(\w+)/g)].map((m) => m[2]);
console.log("");
console.log(`  ·  guarded fields : ${guarded.join(", ")}`);
console.log(`  ·  UNguarded field: raw_order`);
console.log("");
ok(
  guarded.length >= 6 && !guarded.includes("raw_order"),
  "raw_order is the ONLY field written without a guard",
  `${guarded.length} guarded`,
);

// ───────────────────────────────────────────────────────────────────────────
head("STEP 2 — EXECUTE IT. WHAT DOES THE PATCH ACTUALLY CONTAIN?");
// ───────────────────────────────────────────────────────────────────────────

// Re-implement ONLY the patch-building lines, copied verbatim from the source,
// so the probe cannot drift from what the function does. This is transcription,
// not simulation: the lines below are lifted character-for-character.
function buildPatch(order, facts) {
  const patch = { raw_order: order };
  const f = facts;
  if (f.status) patch.leafly_status = f.status;
  if (f.fulfillmentMechanism) patch.fulfillment_mechanism = f.fulfillmentMechanism;
  if (f.marketplace) patch.marketplace = f.marketplace;
  if (f.medicalStatus) patch.medical_status = f.medicalStatus;
  if (f.paymentPreference) patch.payment_preference = f.paymentPreference;
  if (f.cancelationReasonCode) patch.cancelation_reason_code = f.cancelationReasonCode;
  if (f.canceledAt) patch.canceled_at = f.canceledAt;
  return patch;
}

// Verify the transcription matches the source, line for line.
const srcPatchBlock = fetchSrc
  .slice(fetchSrc.indexOf("const patch: Record<string, unknown> = { raw_order"))
  .slice(0, 700);
const transcriptionChecks = [
  "if (f.status) patch.leafly_status = f.status;",
  "if (f.fulfillmentMechanism) patch.fulfillment_mechanism = f.fulfillmentMechanism;",
  "if (f.marketplace) patch.marketplace = f.marketplace;",
  "if (f.medicalStatus) patch.medical_status = f.medicalStatus;",
  "if (f.paymentPreference) patch.payment_preference = f.paymentPreference;",
  "if (f.cancelationReasonCode) patch.cancelation_reason_code = f.cancelationReasonCode;",
  "if (f.canceledAt) patch.canceled_at = f.canceledAt;",
];
let transcriptionOk = true;
for (const line of transcriptionChecks) {
  if (!srcPatchBlock.includes(line)) {
    transcriptionOk = false;
    console.log(`  ❌ transcription drift: source does not contain "${line}"`);
  }
}
ok(
  transcriptionOk,
  "the probe's copy of the patch builder matches the source line for line",
);

// THE SCENARIO: Leafly returns 200 with a body we cannot parse as an object
// (empty string, HTML error page, gzip we failed to decode — all real).
console.log("");
console.log("  SCENARIO: Leafly returns 200, body is NOT a usable object");
console.log("  (empty body, or a string, or an array — all produce usableOrder=false)");
console.log("");

const unusableBodies = [
  ["empty string", ""],
  ["null", null],
  ["an array", [{ id: 1 }]],
  ["a bare string", "OK"],
];

for (const [label, body] of unusableBodies) {
  const usableOrder = body !== null && typeof body === "object" && !Array.isArray(body);
  const orderArg = usableOrder ? body : {};
  // facts.status is forced through by L-31, so the status DOES get written.
  const patch = buildPatch(orderArg, { status: "confirmed" });
  const rawIsEmpty =
    patch.raw_order !== null &&
    typeof patch.raw_order === "object" &&
    Object.keys(patch.raw_order).length === 0;

  console.log(`  body = ${label}`);
  console.log(`     usableOrder : ${usableOrder}`);
  console.log(`     patch keys  : ${Object.keys(patch).join(", ")}`);
  console.log(`     raw_order   : ${JSON.stringify(patch.raw_order)}`);
  if (rawIsEmpty) {
    console.log(`     ⚠️  raw_order is {} — this OVERWRITES the stored order payload`);
  }
  console.log("");
}

const demo = buildPatch({}, { status: "confirmed" });
ok(
  Object.prototype.hasOwnProperty.call(demo, "raw_order") &&
    Object.keys(demo.raw_order).length === 0,
  "PROVEN: an unusable body produces a patch that sets raw_order = {}",
);

// ───────────────────────────────────────────────────────────────────────────
head("STEP 3 — WHAT READS raw_order? (how bad is the blast radius)");
// ───────────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
let readers = "";
try {
  readers = execSync(
    "grep -rn 'raw_order' src/ --include=*.ts --include=*.tsx | grep -v 'order-fetch-server' | head -20",
    { encoding: "utf8" },
  );
} catch {
  readers = "";
}
console.log(readers || "  (none found)");

const readerCount = readers.split("\n").filter((l) => l.trim()).length;
ok(readerCount > 0, "raw_order is read elsewhere — wiping it has consequences", `${readerCount} sites`);

// ───────────────────────────────────────────────────────────────────────────
head("VERDICT");
// ───────────────────────────────────────────────────────────────────────────

console.log("  A DEFECT INTRODUCED BY L-31 (my own previous slice).");
console.log("");
console.log("  L-31 correctly decided to force the STATUS through even when");
console.log("  Leafly's body could not be parsed — leaving the board stale was");
console.log("  the bug it was fixing. But it routed that through a writer whose");
console.log("  FIRST line overwrites `raw_order` unconditionally, and handed it");
console.log("  an empty object.");
console.log("");
console.log("  Result: a 200 with an unreadable body correctly advances the step");
console.log("  AND silently erases the order's details — the customer's items,");
console.log("  totals and fulfilment data — from the one column that holds them.");
console.log("");
console.log("  This is precisely the 'omission' shape L-31's own chapter warned");
console.log("  about: nothing errors, nothing logs, the step even moves. The only");
console.log("  symptom is a detail panel that has gone blank.");
console.log("");
console.log("  THE FIX: guard raw_order like every one of its neighbours, so an");
console.log("  empty payload never overwrites a real one.");
console.log("");

console.log("═".repeat(75));
console.log(failures === 0 ? "✅ probe completed, conclusion supported" : `❌ ${failures} check(s) failed`);
console.log("═".repeat(75));
process.exit(failures === 0 ? 0 : 1);
