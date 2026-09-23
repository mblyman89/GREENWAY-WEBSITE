#!/usr/bin/env node
/**
 * scripts/recon/l26-floor-fetch-probe.mjs
 *
 * SLICE L-26 — RECON ONLY. Prove the floor deadline works, against a REAL
 * socket, before a line of it ships.
 *
 * ===========================================================================
 * WHAT THIS SLICE IS TRYING TO ESTABLISH
 * ===========================================================================
 * The acknowledge button has now survived three fixes. Every one of them
 * bounded a call site that somebody ENUMERATED by hand:
 *
 *   L-17  bounded the outbound fetch connection   → still hangs
 *   L-23  bounded the outbound response body      → still hangs
 *   L-25  bounded the acknowledge action's ~14 DB calls → still hangs
 *
 * Each enumeration was correct and each was incomplete, because the thing
 * being enumerated kept turning out to be bigger than the list. The current
 * inventory says 300 database queries are reachable and still unbounded.
 *
 * Hand-patching 300 call sites is the same strategy that has failed three
 * times, only larger. It also degrades the moment somebody writes query 301.
 *
 * So this slice proposes a FLOOR instead of a list: a custom `fetch` handed
 * to the Supabase client factory, which composes a deadline into EVERY
 * request the client will ever make, including ones nobody has written yet
 * and including `auth.getUser()`, which is not a PostgREST query at all and
 * therefore cannot be bounded by `.abortSignal()` under any enumeration.
 *
 * This probe answers the four questions that must be true for that to work.
 * It answers them against a server that accepts connections and never
 * replies — the same methodology L-23 and L-25 used, because a mock of the
 * thing under test cannot reproduce the defect in the thing under test.
 *
 *   Q1. Does an UNBOUNDED fetch to a black hole hang forever?
 *       (the control — if this settles, the probe proves nothing)
 *   Q2. Does a floor-injected signal bound it?
 *   Q3. Does `AbortSignal.any` preserve a CALLER's shorter deadline?
 *       (the floor must never make an existing bound weaker)
 *   Q4. Does the floor leave a healthy fast request completely alone?
 *       (a fix that breaks the 99.99% case is not a fix)
 *
 * Usage:  node scripts/recon/l26-floor-fetch-probe.mjs
 */
import { createServer } from "node:http";

/* ── A black hole and a healthy server ────────────────────────────────── */

const blackHole = createServer((req) => {
  // Accept the request. Send NOTHING. Ever.
  // This is what a saturated connection pooler looks like from outside: the
  // TCP handshake succeeds, so there is no connection error to catch, and
  // then silence. No `catch` block in the application ever runs.
  void req;
});

const healthy = createServer((req, res) => {
  void req;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify([{ ok: true }]));
});

await new Promise((r) => blackHole.listen(0, "127.0.0.1", r));
await new Promise((r) => healthy.listen(0, "127.0.0.1", r));

const BLACK_HOLE = `http://127.0.0.1:${blackHole.address().port}/rest/v1/x`;
const HEALTHY = `http://127.0.0.1:${healthy.address().port}/rest/v1/x`;

console.log(`[probe] black hole : ${BLACK_HOLE}`);
console.log(`[probe] healthy    : ${HEALTHY}`);
console.log("");

/* ── The candidate implementation, inlined ────────────────────────────── */

/**
 * Inlined deliberately, NOT imported from src/.
 *
 * The production module carries `import "server-only"`, which throws outside
 * a React Server Component render. More importantly, a probe that imports
 * the implementation can only ever prove the implementation is what it is.
 * Retyping the logic here means the probe tests the IDEA, and if the shipped
 * version drifts from the idea the compliance test — which reads the real
 * file — is what catches it. Two different instruments, on purpose.
 */
function withFloor(floorMs, baseFetch = fetch) {
  return (input, init = {}) => {
    const floor = AbortSignal.timeout(floorMs);
    const caller = init.signal;
    return baseFetch(input, {
      ...init,
      signal: caller ? AbortSignal.any([caller, floor]) : floor,
    });
  };
}

const ms = (started) => `${Date.now() - started}ms`;

/* ── Q1. CONTROL: unbounded fetch to a black hole ─────────────────────── */
{
  const started = Date.now();
  let settled = false;
  fetch(BLACK_HOLE).then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await new Promise((r) => setTimeout(r, 6000));
  console.log(
    settled
      ? `[Q1] CONTROL FAILED: unbounded fetch settled in under 6s — the probe proves nothing`
      : `[Q1] CONTROL HOLDS: after ${ms(started)} settled=false -> STILL HANGING`,
  );
}

/* ── Q2. The floor bounds it ──────────────────────────────────────────── */
{
  const started = Date.now();
  const floored = withFloor(1500);
  try {
    await floored(BLACK_HOLE);
    console.log(`[Q2] FAILED: resolved in ${ms(started)} — the floor did not fire`);
  } catch (error) {
    console.log(`[Q2] BOUNDED after ${ms(started)} -> ${error.name}: ${error.message}`);
  }
}

/* ── Q3. A caller's SHORTER deadline still wins ───────────────────────── */
//
// This is the property that makes the floor safe to add underneath code that
// already bounds itself. L-25 spent a slice attaching `.abortSignal()` to
// the Leafly path with budgets chosen against Leafly's documented latency.
// If installing a 20s floor silently RELAXED those to 20s, this slice would
// be quietly undoing the last one. `AbortSignal.any` aborts as soon as the
// FIRST of its inputs aborts, so the tighter deadline governs — but that is
// a claim about a Node built-in, and claims get measured here.
{
  const started = Date.now();
  const floored = withFloor(30_000);
  try {
    await floored(BLACK_HOLE, { signal: AbortSignal.timeout(900) });
    console.log(`[Q3] FAILED: resolved in ${ms(started)}`);
  } catch (error) {
    const elapsed = Date.now() - started;
    const callerWon = elapsed < 5000;
    console.log(
      `[Q3] ${callerWon ? "CALLER'S 900ms WON" : "FAILED — floor overrode caller"}` +
        ` after ${ms(started)} -> ${error.name}`,
    );
  }
}

/* ── Q4. A healthy request is untouched ───────────────────────────────── */
{
  const started = Date.now();
  const floored = withFloor(20_000);
  const res = await floored(HEALTHY);
  const body = await res.json();
  console.log(
    `[Q4] HEALTHY request unaffected: ${res.status} in ${ms(started)}, body=${JSON.stringify(body)}`,
  );
}

/* ── Q5. The floor's own abort is distinguishable ─────────────────────── */
//
// The application has to be able to TELL the operator which deadline fired,
// so `isDbDeadlineError` must recognise whatever this throws.
{
  const floored = withFloor(300);
  try {
    await floored(BLACK_HOLE);
  } catch (error) {
    console.log(
      `[Q5] shape: name=${JSON.stringify(error.name)} ` +
        `message=${JSON.stringify(error.message)}`,
    );
  }
}

blackHole.close();
healthy.close();
console.log("");
console.log("[probe] done");
process.exit(0);
