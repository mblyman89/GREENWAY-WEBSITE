/**
 * scripts/recon/l28-board-overflow-probe.mjs
 *
 * SLICE L-28 — "I placed a new order, the back office is aware of it, but it
 * is not in the list."
 *
 * ===========================================================================
 * THE OWNER'S QUESTION, VERBATIM
 * ===========================================================================
 *   "there are currently 9 orders in total, 8 of which have expired, one is
 *    still pending. but I cannot see the 9th order, maybe the ui doesnt allow
 *    for more than 8? ... please recon if this is a new bug, or the ui not
 *    allowed to display more than 8 hiding the 9th order."
 *
 * This script answers that question by EXECUTION, not by reading. It replays
 * his exact stated shape — 9 orders, 8 expired, 1 live — through two models:
 * the query the server USED to issue, and the query it issues NOW. Then it
 * prints which of his orders survive each one.
 *
 * ===========================================================================
 * WHY A MODEL AND NOT THE REAL DATABASE
 * ===========================================================================
 * The service-role credentials are not in the repo and must never be. What
 * CAN be reproduced exactly is the SEMANTICS of the PostgREST calls: filter,
 * order, limit. Those are plain set operations and they are re-implemented
 * here in plain JavaScript.
 *
 * ===========================================================================
 * THE TRAP THIS FILE FELL INTO ONCE, AND HOW IT IS NOW AVOIDED
 * ===========================================================================
 * The first version of this probe read EVERY number — including the board
 * limit — out of order-board-server.ts, for both the "before" and the "after"
 * case. That felt rigorous. It was not. The moment the fix landed, the source
 * said 200, so the "before" model silently became the "after" model, the bug
 * could no longer be reproduced, and the probe failed with "did not reproduce
 * the reported symptom." A reproduction harness that stops reproducing the
 * instant you fix the bug is not a regression guard — it is a fuse that blows
 * on success.
 *
 * The rule that falls out of that, and it generalises past this file:
 *
 *   A "before" model must be pinned to HISTORY, which is frozen.
 *   An "after" model must be pinned to SOURCE, which moves.
 *
 * So BROKEN_* below are hard-coded constants describing code that no longer
 * exists (git blame e631036a~ if you want to see it), and the fixed model is
 * read from and asserted against the live file. Drift in the live file fails
 * loudly with exit 2.
 *
 * Run:  node scripts/recon/l28-board-overflow-probe.mjs
 * Exit: 0 = bug reproduced AND current source fixes it
 *       1 = one of those two claims is false — do not ship
 *       2 = the harness no longer models the real query
 */

import { readFileSync } from "node:fs";

const SRC = "src/lib/leafly/order-board-server.ts";
const source = readFileSync(SRC, "utf8");

// ───────────────────────────────────────────────────────────────────────────
// 0. THE BROKEN BEHAVIOUR — FROZEN HISTORY, NEVER READ FROM SOURCE
//    This is what `loadLeaflyOrderBoard` did before this slice. These numbers
//    are deliberately literal. If the file is fixed, they must NOT follow it.
// ───────────────────────────────────────────────────────────────────────────
const BROKEN_LIMIT = 8;
const BROKEN_PENDING_FILTER = "acknowledged_at IS NULL"; // and nothing else

// ───────────────────────────────────────────────────────────────────────────
// 1. PIN THE FIXED MODEL TO THE SOURCE
//    If the real query changes shape, this harness must fail loudly rather
//    than keep "proving" something about code that no longer exists.
// ───────────────────────────────────────────────────────────────────────────
/**
 * Slice the source to a single construct, bounded on BOTH sides.
 *
 * WHY THIS EXISTS. The first version of these pins searched the whole file.
 * That is not the claim being made. `.is("canceled_at", null)` appears in the
 * pending query AND in `countLeaflyOrdersAwaitingAck`, so a whole-file search
 * for it stays green when you delete either one — it just finds the other.
 * Verified: deleting the filter from the pending query left this probe
 * reporting PROVEN BY EXECUTION. An unscoped source assertion silently
 * degrades from "this construct does X" into "this string appears somewhere
 * in this file", which is a much weaker claim wearing the same clothes.
 */
function bodyBetween(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  if (start === -1) return null;
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  return source.slice(start, end === -1 ? source.length : end);
}

const PENDING_QUERY = bodyBetween("const runPending = (columns: string) =>", "let pending = await");
const CLOSED_QUERY = bodyBetween("const runClosed = (columns: string) =>", "let closed = await");
const COUNT_FN = bodyBetween(
  "export async function countLeaflyOrdersAwaitingAck",
  "\nexport ",
);

if (!PENDING_QUERY || !CLOSED_QUERY || !COUNT_FN) {
  console.error(
    `MODEL DRIFT: could not locate the pending query, the closed query, and the ` +
      `count function in ${SRC}. The probe cannot scope its assertions.`,
  );
  process.exit(2);
}

// [scope, regex, label] — every assertion names the construct it is about.
const pins = [
  [source, /export const LEAFLY_BOARD_LIMIT = (\d+);/, "board limit constant"],
  [source, /const TERMINAL_STATUSES = \[([^\]]+)\] as const;/, "terminal status vocabulary"],
  [source, /const remaining = limit - pendingRows\.length;/, "acked query gets the leftover slots"],

  // The pending query — the thing that actually hid his order.
  [PENDING_QUERY, /\.is\("acknowledged_at", null\)/, "PENDING query filters acknowledged_at IS NULL"],
  [PENDING_QUERY, /\.is\("canceled_at", null\)/, "PENDING query excludes cancelled orders"],
  [
    PENDING_QUERY,
    /leafly_status\.not\.in\.\(\$\{TERMINAL_STATUSES\.join\(","\)\}\)/,
    "PENDING query excludes terminal statuses",
  ],
  [PENDING_QUERY, /\.order\("acknowledge_by", \{ ascending: true/, "PENDING sort is deadline ASCENDING"],

  // The third query — the reason "hide" does not mean "lose".
  [
    CLOSED_QUERY,
    /const closedBudget = limit - pendingRows\.length - ackedRows\.length;|\.limit\(closedBudget\)/,
    "CLOSED query exists so dead orders are HIDDEN, not LOST",
  ],
  [
    CLOSED_QUERY,
    /leafly_status\.in\.\(\$\{TERMINAL_STATUSES\.join\(","\)\}\)/,
    "CLOSED query selects exactly the terminal orders",
  ],

  // The badge — it lied for the same reason the list did, so it needs the
  // same two filters or it goes right back to disagreeing with the list.
  [COUNT_FN, /\.is\("acknowledged_at", null\)/, "COUNT filters acknowledged_at IS NULL"],
  [COUNT_FN, /\.is\("canceled_at", null\)/, "COUNT excludes cancelled orders"],
  [
    COUNT_FN,
    /leafly_status\.not\.in\.\(\$\{TERMINAL_STATUSES\.join\(","\)\}\)/,
    "COUNT excludes terminal statuses",
  ],
];
let pinFailure = false;
for (const [scope, re, label] of pins) {
  if (!re.test(scope)) {
    console.error(`MODEL DRIFT: could not find ${label} in ${SRC}`);
    pinFailure = true;
  }
}
// `closedBudget` must also still be computed, not hard-coded to something
// that skips the query. Asserted separately because the slice above starts
// after the line it is declared on.
if (!/const closedBudget = limit - pendingRows\.length - ackedRows\.length;/.test(source)) {
  console.error(`MODEL DRIFT: closedBudget is no longer derived from the remaining slots in ${SRC}`);
  pinFailure = true;
}
if (pinFailure) {
  console.error("\nThe harness no longer models the real query. Fix it before trusting it.");
  process.exit(2);
}

const FIXED_LIMIT = Number(source.match(/export const LEAFLY_BOARD_LIMIT = (\d+);/)[1]);

// Read the terminal vocabulary out of the source too, rather than re-typing
// it, so that adding a fourth terminal status cannot leave this probe testing
// a narrower definition of "over" than the server uses.
const TERMINAL = new Set(
  source
    .match(/const TERMINAL_STATUSES = \[([^\]]+)\] as const;/)[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean),
);

// Guard the guard: if that parse ever yields an empty set, every order would
// look non-terminal and the probe would "pass" while proving nothing.
if (TERMINAL.size === 0) {
  console.error(`MODEL DRIFT: parsed an EMPTY terminal status set out of ${SRC}.`);
  process.exit(2);
}

// The whole bug turns on the fix actually raising the ceiling. If someone
// lowers it back to 8, say so here rather than letting the run look healthy.
if (FIXED_LIMIT <= BROKEN_LIMIT) {
  console.error(
    `MODEL DRIFT: LEAFLY_BOARD_LIMIT is ${FIXED_LIMIT}, which is not above the ` +
      `broken ceiling of ${BROKEN_LIMIT}. The clipping half of this bug is back.`,
  );
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. THE OWNER'S BOARD
//    8 expired orders from earlier, then the one he just placed.
//    An expired order is `leafly_status: "expired"` with acknowledged_at
//    STILL NULL — because nothing in the codebase ever stamps
//    acknowledged_at on expiry. webhook-server.ts stamps canceled_at only.
// ───────────────────────────────────────────────────────────────────────────
function mkOrder(n, { expired }) {
  // Deadlines an hour apart, oldest first, so the ordering is unambiguous.
  const deadline = new Date(Date.UTC(2026, 8, 23, 6 + n, 0, 0)).toISOString();
  return {
    id: `row-${n}`,
    leafly_order_id: `LFY-${1000 + n}`,
    leafly_status: expired ? "expired" : "submitted",
    acknowledge_by: deadline,
    // THE CRUX. Expired orders were never acknowledged — that is WHY they
    // expired. So this stays null for all nine rows.
    acknowledged_at: null,
    canceled_at: expired ? deadline : null,
    updated_at: deadline,
    label: expired ? `expired #${n}` : `>>> THE NEW LIVE ORDER <<<`,
  };
}

const board = [];
for (let n = 1; n <= 8; n++) board.push(mkOrder(n, { expired: true }));
board.push(mkOrder(9, { expired: false })); // the one he just placed

function isTerminal(r) {
  return r.canceled_at !== null || TERMINAL.has((r.leafly_status ?? "").trim());
}

// ───────────────────────────────────────────────────────────────────────────
// 3. THE QUERIES
// ───────────────────────────────────────────────────────────────────────────
const byDeadlineAsc = (a, b) => (a.acknowledge_by < b.acknowledge_by ? -1 : 1);
const byUpdatedDesc = (a, b) => (a.updated_at > b.updated_at ? -1 : 1);

/** What the server USED to do. Frozen. */
function brokenBoard(rows) {
  const pending = rows
    .filter((r) => r.acknowledged_at === null) // BROKEN_PENDING_FILTER
    .sort(byDeadlineAsc)
    .slice(0, BROKEN_LIMIT);
  const remaining = BROKEN_LIMIT - pending.length;
  const acked =
    remaining > 0
      ? rows.filter((r) => r.acknowledged_at !== null).sort(byUpdatedDesc).slice(0, remaining)
      : []; // `if (remaining > 0)` — with 8 dead rows this never ran
  return { rows: [...pending, ...acked], remaining };
}

/** What the server does NOW. Shape asserted against source above. */
function fixedBoard(rows) {
  const pending = rows
    .filter((r) => r.acknowledged_at === null && !isTerminal(r))
    .sort(byDeadlineAsc)
    .slice(0, FIXED_LIMIT);
  const remaining = FIXED_LIMIT - pending.length;
  const acked =
    remaining > 0
      ? rows.filter((r) => r.acknowledged_at !== null).sort(byUpdatedDesc).slice(0, remaining)
      : [];
  const closedBudget = FIXED_LIMIT - pending.length - acked.length;
  const closed =
    closedBudget > 0
      ? rows
          .filter((r) => r.acknowledged_at === null && isTerminal(r))
          .sort(byUpdatedDesc)
          .slice(0, closedBudget)
      : [];
  return { pending, acked, closed, rows: [...pending, ...acked, ...closed] };
}

// ───────────────────────────────────────────────────────────────────────────
// 4. RUN IT
// ───────────────────────────────────────────────────────────────────────────
const line = "─".repeat(74);
console.log(line);
console.log("L-28 PROBE — why the 9th order is invisible");
console.log(line);
console.log(`Broken board limit (frozen history): ${BROKEN_LIMIT}`);
console.log(`Broken pending filter              : ${BROKEN_PENDING_FILTER}`);
console.log(`LEAFLY_BOARD_LIMIT read from source: ${FIXED_LIMIT}`);
console.log(`Terminal statuses read from source : ${[...TERMINAL].join(", ")}`);
console.log(`Orders on the owner's board        : ${board.length} (8 expired, 1 live)\n`);

const before = brokenBoard(board);
console.log("BEFORE — what the board returned when he looked:");
for (const r of before.rows) console.log(`   ${r.leafly_order_id}  ${r.label}`);
console.log(
  `   (acked query got ${before.remaining} leftover slots, so it ` +
    `${before.remaining > 0 ? "ran" : "NEVER RAN"})`,
);

const liveShownBefore = before.rows.some((r) => !isTerminal(r));
console.log(`\n   Rows returned ............. ${before.rows.length}`);
console.log(`   Live order visible? ....... ${liveShownBefore ? "YES" : "NO  <-- THE BUG"}`);

// The safety net that is supposed to make a clipped list non-silent.
const countBefore = board.filter((r) => r.acknowledged_at === null).length;
console.log(`   "Awaiting acknowledgement" badge said: ${countBefore}`);
console.log(`   ...but every one of the ${before.rows.length} rows on screen was expired.`);
console.log("   The badge and the list disagreed, and the badge was the honest one.");

console.log(`\n${line}`);
const after = fixedBoard(board);
const liveShownAfter = after.rows.some((r) => !isTerminal(r));
console.log("AFTER — current source, terminal orders are not 'pending':");
console.log(`   open (query 1) .... ${after.pending.map((r) => r.leafly_order_id).join(", ") || "none"}`);
console.log(`   acked (query 2) ... ${after.acked.map((r) => r.leafly_order_id).join(", ") || "none"}`);
console.log(`   closed (query 3) .. ${after.closed.length} row(s) — hidden by default, NOT lost`);
console.log(`\n   Rows returned ............. ${after.rows.length}`);
console.log(`   Live order visible? ....... ${liveShownAfter ? "YES" : "NO"}`);
const countAfter = board.filter((r) => r.acknowledged_at === null && !isTerminal(r)).length;
console.log(`   "Awaiting acknowledgement" badge says: ${countAfter}  (matches the open list)`);

// The fix must not trade one disappearance for another. The owner asked to
// HIDE finished orders, which means they still have to be fetched so a filter
// can show them again on demand.
const everyOrderStillFetched = board.every((b) =>
  after.rows.some((r) => r.leafly_order_id === b.leafly_order_id),
);
console.log(
  `   All ${board.length} orders still fetched? ... ${everyOrderStillFetched ? "YES" : "NO  <-- REGRESSION"}`,
);

console.log(`\n${line}`);
console.log("VERDICT");
console.log(line);
if (!liveShownBefore && liveShownAfter && everyOrderStillFetched && countAfter === 1) {
  console.log("NOT a UI display cap. The 9th order was never FETCHED, so it never");
  console.log("reached the browser. Expired orders still satisfied the 'not yet");
  console.log("acknowledged' filter, they sorted FIRST because their deadlines are");
  console.log("oldest, and they consumed all 8 slots. The single order that needed a");
  console.log("human is the exact one that got pushed out — the failure was inverted.");
  console.log("");
  console.log("The current source fixes it, keeps all 9 rows fetched so 'hide' means");
  console.log("hide rather than lose, and makes the badge agree with the list.");
  console.log("PROVEN ABOVE BY EXECUTION.");
  process.exit(0);
}
console.log("One of the four claims this probe makes is false:");
console.log(`   bug reproduced before .......... ${!liveShownBefore}`);
console.log(`   live order visible after ....... ${liveShownAfter}`);
console.log(`   nothing lost ................... ${everyOrderStillFetched}`);
console.log(`   badge agrees with list ......... ${countAfter === 1}`);
console.log("Do not ship on the strength of this run. Investigate further.");
process.exit(1);
