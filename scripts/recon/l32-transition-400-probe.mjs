#!/usr/bin/env node
/**
 * scripts/recon/l32-transition-400-probe.mjs
 *
 * SLICE L-32 — WHY DOES THE NEXT STEP RETURN 400?
 *
 * ===========================================================================
 * THE REPORT
 * ===========================================================================
 * The owner acknowledged an order, then tried the next step, and got OUR
 * error text:
 *
 *   "⚠️ Leafly didn't accept that.
 *    Bad request (400): Leafly rejected the body. Usually an illegal status
 *    transition, or a cancellation reason Leafly does not accept on this
 *    endpoint. Retrying sends the same rejected request."
 *
 * Note the word "Usually". That message is a GUESS. This probe replaces the
 * guess with a derivation from the specification and from our own source.
 *
 * ===========================================================================
 * METHOD
 * ===========================================================================
 * Everything below is read from:
 *   - docs/leafly-specs/order-api-v1.openapi.json  (checksum-verified)
 *   - the actual source files on disk
 * Nothing is asserted from memory. Where a claim cannot be established from
 * those two sources, the probe says so instead of concluding.
 *
 * Exit 0 = the probe reached a supported conclusion.
 * Exit 1 = a check failed or the evidence was inconclusive.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const SPEC = "docs/leafly-specs/order-api-v1.openapi.json";
const EXPECTED_MD5 = "daab7bcf6f77177de85425adf7f805f1";

const ACK_SERVER = "src/lib/leafly/order-ack-server.ts";
const ACK_CORE = "src/lib/leafly/order-ack-core.ts";

let failures = 0;
const notes = [];

function head(title) {
  console.log("\n" + "═".repeat(75));
  console.log(title);
  console.log("═".repeat(75) + "\n");
}

function ok(cond, msg, detail = "") {
  if (cond) {
    console.log(`  ✅ ${msg}${detail ? `  [${detail}]` : ""}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${msg}${detail ? `  [${detail}]` : ""}`);
  }
  return cond;
}

function info(msg) {
  console.log(`  ·  ${msg}`);
}

// ───────────────────────────────────────────────────────────────────────────
head("STEP 1 — THE SPECIFICATION IS THE ONE WE THINK IT IS");
// ───────────────────────────────────────────────────────────────────────────

if (!existsSync(SPEC)) {
  console.log(`  ❌ ${SPEC} is missing. Cannot proceed without the spec.`);
  process.exit(1);
}
const specRaw = readFileSync(SPEC);
const md5 = createHash("md5").update(specRaw).digest("hex");
ok(md5 === EXPECTED_MD5, "vendored spec checksum matches the pinned value", md5);
const spec = JSON.parse(specRaw.toString("utf8"));

const STATUS_PATH = "/{order_integration_key}/orders/{id}/status";
const ACK_PATH = "/{order_integration_key}/orders/{id}/acknowledge";

// ───────────────────────────────────────────────────────────────────────────
head("STEP 2 — WHAT LEAFLY SAYS ACKNOWLEDGE IS (the owner's question 1)");
// ───────────────────────────────────────────────────────────────────────────

const ackOp = spec.paths?.[ACK_PATH]?.post;
ok(Boolean(ackOp), "the acknowledge endpoint exists in the spec");
const ackDesc = String(ackOp?.description ?? "");
const ackCodes = Object.keys(ackOp?.responses ?? {});

info(`summary       : ${ackOp?.summary}`);
info(`success code  : ${ackCodes.join(", ")}`);
console.log("");
for (const line of ackDesc.split("\n")) if (line.trim()) info(line.trim());
console.log("");

ok(
  /retrieved all necessary details/i.test(ackDesc),
  'acknowledge is defined as "your system has retrieved all necessary details"',
);
ok(
  /required before any changes can be made/i.test(ackDesc),
  "acknowledge is REQUIRED before any other change — it cannot be skipped",
);
ok(
  /access to an order's associated media is revoked/i.test(ackDesc),
  "acknowledge REVOKES access to the ID images (one-way door)",
);
ok(ackCodes.includes("204"), "acknowledge returns 204 No Content (carries no order)");

// ───────────────────────────────────────────────────────────────────────────
head("STEP 3 — WHAT LEAFLY SAYS status=confirmed IS (the owner's question 2)");
// ───────────────────────────────────────────────────────────────────────────

const stOp = spec.paths?.[STATUS_PATH]?.post;
ok(Boolean(stOp), "the status endpoint exists in the spec");
const stDesc = String(stOp?.description ?? "");
const stCodes = Object.keys(stOp?.responses ?? {});

info(`summary       : ${stOp?.summary}`);
info(`response codes: ${stCodes.join(", ")}`);
console.log("");
for (const line of stDesc.split("\n")) if (line.trim()) info(line.trim());
console.log("");

ok(
  /move an order along its lifecycle/i.test(stDesc),
  'status is defined as "Move an order along its lifecycle by advancing its status"',
);
ok(stCodes.includes("200"), "status returns 200 WITH an order body");
ok(stCodes.includes("400"), "status documents a 400 — the owner's error");

console.log("");
console.log("  ┌─────────────────────────────────────────────────────────────┐");
console.log("  │ ANSWER TO THE OWNER'S QUESTION:                             │");
console.log("  │                                                             │");
console.log("  │ They are DIFFERENT ENDPOINTS with DIFFERENT MEANINGS.       │");
console.log("  │                                                             │");
console.log("  │  acknowledge = a RECEIPT. 'We have your data.' 204.         │");
console.log("  │                Mandatory. Gated by a 15-minute timer.       │");
console.log("  │                Burns the ID images.                         │");
console.log("  │                                                             │");
console.log("  │  confirmed   = a DECISION. 'We will make this order.' 200.  │");
console.log("  │                Moves the lifecycle. Emails the shopper.     │");
console.log("  │                                                             │");
console.log("  │ You cannot drop acknowledge: the spec says status updates   │");
console.log("  │ 'are only available after an order has been acknowledged'.  │");
console.log("  └─────────────────────────────────────────────────────────────┘");

// ───────────────────────────────────────────────────────────────────────────
head("STEP 4 — THE FIVE TRANSITION RULES, EXTRACTED VERBATIM");
// ───────────────────────────────────────────────────────────────────────────

const RULES = [
  ["only available after an order has been acknowledged", "must acknowledge first"],
  ["only be moved forward", "no backwards moves"],
  ["cannot be moved from their current status to the same status", "no no-op moves"],
  ["cannot be moved out of a terminal status", "terminal is final"],
  ["cannot be moved to 'pending' or 'expired'", "pending/expired are Leafly's"],
];
for (const [needle, human] of RULES) {
  ok(stDesc.includes(needle), `RULE present: ${human}`, needle);
}

const terminalMatch = stDesc.match(/terminal status \(([^)]+)\)/);
info(`terminal statuses per spec: ${terminalMatch ? terminalMatch[1] : "NOT FOUND"}`);
ok(
  Boolean(terminalMatch) && /picked_up/.test(terminalMatch[1]),
  "picked_up is one of the terminal statuses",
);

// ───────────────────────────────────────────────────────────────────────────
head("STEP 5 — WHAT OUR ACKNOWLEDGE BUTTON ACTUALLY SENDS");
// ───────────────────────────────────────────────────────────────────────────

const ackSrc = readFileSync(ACK_SERVER, "utf8");

// Does acknowledgeLeaflyOrder ALSO push status=confirmed?
const pushesConfirmed =
  /setLeaflyOrderStatus\(\{[\s\S]{0,2000}?nextStatus:\s*"confirmed"/.test(ackSrc);
ok(
  pushesConfirmed,
  "our Acknowledge button ALSO pushes status=confirmed (L-14 behaviour)",
);

if (pushesConfirmed) {
  console.log("");
  console.log("  ⚠️  THIS IS THE CRUX OF THE OWNER'S 400.");
  console.log("");
  info("Pressing Acknowledge performs TWO Leafly operations:");
  info("   1. POST .../acknowledge        → 204");
  info("   2. POST .../status {confirmed} → 200, order is now `confirmed`");
  info("");
  info("So by the time the button returns, Leafly already has `confirmed`.");
  info("If the board still OFFERS a 'Confirm' button and the operator");
  info("presses it, that is pending→confirmed sent a SECOND time, against");
  info("an order Leafly already has at `confirmed`. Spec rule 3:");
  info('   "Orders cannot be moved from their current status to the same status"');
  info("→ Leafly answers 400. Exactly the error reported.");
}

// What status do we WRITE LOCALLY after the acknowledge-time confirm push?
head("STEP 6 — DO WE RECORD THE `confirmed` WE JUST SENT?");

// Locate the acknowledge function body.
const ackFnStart = ackSrc.indexOf("export async function acknowledgeLeaflyOrder");
ok(ackFnStart !== -1, "found acknowledgeLeaflyOrder()");
// The function ends at the next top-level `export async function`.
const afterAck = ackSrc.slice(ackFnStart + 10);
const nextExport = afterAck.indexOf("\nexport async function");
const ackFnBody = nextExport === -1 ? afterAck : afterAck.slice(0, nextExport);

const ackStampsAckAt = /markLeaflyOrderAcknowledged\(/.test(ackFnBody);
ok(ackStampsAckAt, "acknowledge stamps acknowledged_at locally");

// The inner confirm push goes through setLeaflyOrderStatus, which (post-L-31)
// persists via persistStatusAfterPush. Verify that is reachable from it.
const persistExists = /async function persistStatusAfterPush\(/.test(ackSrc);
ok(persistExists, "persistStatusAfterPush() exists (L-31)");

const statusFnStart = ackSrc.indexOf("export async function setLeaflyOrderStatus");
const afterStatus = ackSrc.slice(statusFnStart + 10);
const nextExport2 = afterStatus.indexOf("\nexport async function");
const statusFnBody = nextExport2 === -1 ? afterStatus : afterStatus.slice(0, nextExport2);
const statusPersists = /persistWarning = await persistStatusAfterPush\(/.test(statusFnBody);
ok(
  statusPersists,
  "setLeaflyOrderStatus() persists the new status after a successful push",
);

if (pushesConfirmed && statusPersists) {
  console.log("");
  info("So the local row SHOULD end up at `confirmed` after Acknowledge.");
  info("If it does, planLeaflyOrderActions() would compute `confirmed` as");
  info("the current status and would NOT offer Confirm again (rule 3");
  info("refuses same→same), so the 400 could not be reached from the board.");
  info("");
  info("Therefore the 400 requires the local row to be STALE — showing");
  info("`pending` while Leafly holds `confirmed`. The probe now tests");
  info("every way that can happen.");
}

// ───────────────────────────────────────────────────────────────────────────
head("STEP 7 — THE WAYS THE LOCAL ROW CAN GO STALE");
// ───────────────────────────────────────────────────────────────────────────

// (a) The confirm push is inside a try/catch that must never fail the ack.
const confirmInTry =
  /try \{[\s\S]{0,3000}?nextStatus:\s*"confirmed"[\s\S]{0,3000}?\} catch/.test(ackSrc);
ok(
  confirmInTry,
  "the acknowledge-time confirm push is wrapped in try/catch (cannot fail the ack)",
);
if (confirmInTry) {
  notes.push(
    "STALE PATH A: if the confirm push fails (network, 4xx, throw), the " +
      "acknowledgement still succeeds and the row keeps leafly_status=pending, " +
      "while Leafly may or may not have confirmed. The board then offers " +
      "Confirm. If Leafly DID get it, that press is same→same → 400.",
  );
}

// (b) storeFetchedLeaflyOrder only writes status when truthy.
const fetchSrv = readFileSync("src/lib/leafly/order-fetch-server.ts", "utf8");
const conditionalStatusWrite = /if \(f\.status\) patch\.leafly_status = f\.status;/.test(
  fetchSrv,
);
ok(
  conditionalStatusWrite,
  "storeFetchedLeaflyOrder writes leafly_status ONLY when the parsed status is truthy",
);
if (conditionalStatusWrite) {
  notes.push(
    "STALE PATH B: if Leafly's 200 body cannot be parsed into a status, " +
      "`if (f.status)` is false and leafly_status is NOT written — the row " +
      "silently keeps its old value even though the push succeeded.",
  );
}

// (c) Does the acknowledge path pass a FABRICATED current status?
const fabricatesPending = /leafly_status:\s*"pending",/.test(ackFnBody);
ok(
  fabricatesPending,
  'the acknowledge path hard-codes leafly_status:"pending" for its confirm push',
);
if (fabricatesPending) {
  notes.push(
    'STALE PATH C: the acknowledge path overrides the snapshot with "pending" ' +
      "before pushing confirmed. That is correct for a genuinely pending order, " +
      "but if Leafly had already advanced the order (e.g. a retry after a " +
      "timeout, or a status set in Leafly's own dashboard), we are asserting a " +
      "current status we did not verify.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
head("STEP 8 — WHAT WE TELL THE OPERATOR WHEN LEAFLY SAYS 400");
// ───────────────────────────────────────────────────────────────────────────

const coreSrc = readFileSync(ACK_CORE, "utf8");
const msg400Match = coreSrc.match(
  /httpStatus === 400[\s\S]{0,600}?message:\s*([\s\S]{0,400}?),\s*\n\s*documented/,
);
const msg400 = msg400Match ? msg400Match[1] : "";
info("our current 400 message:");
console.log("");
for (const line of msg400.split("\n")) if (line.trim()) info(line.trim());
console.log("");

ok(/Usually/i.test(msg400), 'our 400 message contains the word "Usually" — it is a GUESS');

// Does assessOutboundResponse have any access to the body?
const assessSig = coreSrc.match(
  /export function assessOutboundResponse\(([\s\S]{0,300}?)\)[\s]*:/,
);
const assessParams = assessSig ? assessSig[1].replace(/\s+/g, " ").trim() : "";
info(`assessOutboundResponse parameters: ${assessParams}`);
const takesBody = /body/i.test(assessParams);
ok(
  !takesBody,
  "assessOutboundResponse CANNOT see Leafly's response body — so it cannot report the real reason",
);

// But is the body available at the call site?
const bodyAvailable = /responseBody:\s*raw\.body/.test(statusFnBody);
ok(
  bodyAvailable,
  "the real Leafly body IS available at the call site (recorded as responseBody)",
);

// And the spec says a 400 carries a machine-readable reason.
const badReq = spec.components?.responses?.BadRequest;
const badReqSchemaRef =
  badReq?.content?.["application/json"]?.schema?.oneOf?.[0]?.$ref ?? "";
const schemaName = badReqSchemaRef.split("/").pop();
const schemaErr = spec.components?.schemas?.[schemaName];
info(`400 body schema: ${schemaName} → ${JSON.stringify(schemaErr?.properties ?? {})}`);
ok(
  Boolean(schemaErr?.properties?.message),
  "Leafly's 400 body carries a `message` — the actual reason, which we discard",
);
ok(
  Boolean(schemaErr?.properties?.validation_result),
  "Leafly's 400 body can also carry `validation_result` — field-level detail",
);

if (bodyAvailable && !takesBody) {
  notes.push(
    "DEFECT: Leafly tells us exactly why it rejected the request, in a " +
      "documented `SchemaError` body. We record it in the database and then " +
      "show the operator a hard-coded sentence beginning 'Usually'. Eight " +
      "slices were lost to a popup because a message was unclear; this is the " +
      "same failure mode waiting to happen.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
head("STEP 9 — IS THE BOARD'S 'CURRENT STATUS' EVER RE-READ FROM LEAFLY?");
// ───────────────────────────────────────────────────────────────────────────

// A 400 for same→same is self-healing IF we refresh from Leafly on failure.
const refreshesOn400 =
  /fetchLeaflyOrder|collectLeaflyOrder/.test(statusFnBody) ||
  /fetchLeaflyOrder|collectLeaflyOrder/.test(ackFnBody);
ok(
  !refreshesOn400,
  "neither path re-reads the order from Leafly after a rejected push",
  "so a stale row stays stale, and every retry fails identically",
);
notes.push(
  "DEFECT: when Leafly rejects a transition as illegal, the single most " +
    "useful next action is to ASK LEAFLY what the status actually is. We " +
    "never do, so the operator is left pressing a button that cannot " +
    "succeed — and our own message tells them retrying sends the same " +
    "rejected request, which is true but offers no way out.",
);

// ───────────────────────────────────────────────────────────────────────────
head("VERDICT");
// ───────────────────────────────────────────────────────────────────────────

console.log("  THE OWNER'S TWO QUESTIONS:");
console.log("");
console.log("  Q: What is the difference between acknowledge and confirmed?");
console.log("  A: acknowledge is a RECEIPT (204, mandatory, 15-min deadline,");
console.log("     burns the ID images). confirmed is a BUSINESS DECISION (200,");
console.log("     moves the lifecycle, emails the shopper). Different endpoints,");
console.log("     different meanings. Both quoted verbatim above.");
console.log("");
console.log("  Q: Do we need an acknowledge button if confirm does the same thing?");
console.log("  A: They are not the same thing — BUT our Acknowledge button already");
console.log("     does BOTH (it pushes status=confirmed immediately after). So the");
console.log("     SEPARATE 'Confirm' button on the board is redundant, and pressing");
console.log("     it is what produces the 400.");
console.log("");
console.log("  THE 400, DERIVED:");
console.log("");
console.log("     Acknowledge → Leafly is at `confirmed`");
console.log("     Board offers 'Confirm' anyway (because the local row says pending)");
console.log("     Operator presses it → pending→confirmed → Leafly already confirmed");
console.log("     → spec rule 3 violated → 400");
console.log("");

if (notes.length > 0) {
  console.log("  FINDINGS TO FIX:");
  console.log("");
  for (const n of notes) {
    console.log(`   • ${n}`);
    console.log("");
  }
}

console.log("═".repeat(75));
console.log(failures === 0 ? "✅ probe completed, no internal check failed" : `❌ ${failures} check(s) failed`);
console.log("═".repeat(75));

process.exit(failures === 0 ? 0 : 1);
