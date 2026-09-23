#!/usr/bin/env node
/**
 * scripts/recon/l26-head-of-line.mjs
 *
 * SLICE L-26 — RECON. Why did Q3 hang when B, the same test in isolation,
 * passed in 504ms?
 *
 * ===========================================================================
 * THE DISCREPANCY
 * ===========================================================================
 * In the combined probe:
 *   Q1  leaves ONE deliberately-unbounded fetch pending forever (the control)
 *   Q2  bounded fetch, same origin   → fired correctly at 1502ms
 *   Q3  caller 900ms + floor 30s     → NEVER SETTLED (process killed at 60s)
 *
 * Isolated, with no dangling Q1 fetch in the process, the identical Q3 case
 * settled in 504ms.
 *
 * The only difference is the pending request from Q1 against the SAME
 * origin. That points at undici's per-origin connection pool: Node's `fetch`
 * keeps a small number of sockets per origin and QUEUES anything beyond it.
 *
 * ===========================================================================
 * WHY THIS IS NOT A PROBE ARTEFACT — IT MAY BE THE PRODUCTION MECHANISM
 * ===========================================================================
 * Every Supabase call in this application goes to ONE origin: the project
 * URL. The orders page render fires a 7-way `Promise.all` at that origin and
 * then more queries after it.
 *
 * If one query stalls and holds a socket, the others do not fail — they sit
 * in a client-side QUEUE, never dispatched. And a request that was never
 * dispatched is a request whose deadline behaviour we have never actually
 * tested. L-25 attached `.abortSignal()` to the acknowledge path and proved
 * it fires for a DISPATCHED request. Whether it fires for a QUEUED one is a
 * different question that nobody has asked.
 *
 * That distinction is exactly the sort of gap that lets a bug survive three
 * fixes, so it gets measured rather than assumed.
 *
 * QUESTIONS
 *   H1. Does one pending request to an origin delay a second request to the
 *       same origin? (is there head-of-line blocking at all?)
 *   H2. If so, does an AbortSignal still fire for the QUEUED request?
 *   H3. How many concurrent stalled sockets does it take to block?
 */
import { createServer } from "node:http";

const stalled = [];
const server = createServer((req, res) => {
  const url = req.url ?? "";
  if (url.includes("/fast")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
    return;
  }
  // Hold it open forever, but KEEP THE HANDLES so we can close cleanly.
  stalled.push(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

console.log(`[probe] origin: ${ORIGIN}`);
console.log(`[probe] node ${process.version}`);
console.log("");

const el = (t) => `${Date.now() - t}ms`;

/* ── H1: one stalled request, then a FAST one to the same origin ──────── */
{
  // Fire a request that will never be answered, and do not await it.
  const hung = fetch(`${ORIGIN}/stall`).catch(() => undefined);
  void hung;
  await new Promise((r) => setTimeout(r, 250)); // let it claim a socket

  const started = Date.now();
  let done = false;
  const fast = fetch(`${ORIGIN}/fast`).then(
    (res) => { done = true; return res.status; },
    (e) => { done = true; return e.name; },
  );
  const outcome = await Promise.race([
    fast,
    new Promise((r) => setTimeout(() => r("__TIMEOUT__"), 5000)),
  ]);
  console.log(
    outcome === "__TIMEOUT__"
      ? `[H1] HEAD-OF-LINE BLOCKING CONFIRMED: a healthy request to the same ` +
        `origin did not complete within 5000ms while 1 request was stalled`
      : `[H1] no blocking from 1 stalled socket: fast request -> ${outcome} in ${el(started)} (done=${done})`,
  );
}

/* ── H3: how many stalled sockets before a healthy request is blocked? ── */
{
  let blockedAt = null;
  for (let n = 2; n <= 12 && blockedAt === null; n++) {
    void fetch(`${ORIGIN}/stall?n=${n}`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 120));

    const outcome = await Promise.race([
      fetch(`${ORIGIN}/fast`).then((res) => res.status, (e) => e.name),
      new Promise((r) => setTimeout(() => r("__TIMEOUT__"), 2500)),
    ]);
    if (outcome === "__TIMEOUT__") blockedAt = n;
  }
  console.log(
    blockedAt === null
      ? `[H3] no blocking observed with up to 12 concurrent stalled sockets`
      : `[H3] a healthy request became BLOCKED once ${blockedAt} sockets were stalled`,
  );
}

/* ── H2: does an AbortSignal fire for a request that is QUEUED? ───────── */
//
// THE QUESTION THAT MATTERS MOST. If a queued request ignores its deadline,
// then every `.abortSignal()` added in L-25 is inert in exactly the
// circumstance it was added for, and no amount of further enumeration would
// ever have fixed this bug.
{
  const started = Date.now();
  try {
    await fetch(`${ORIGIN}/stall?queued=1`, { signal: AbortSignal.timeout(1200) });
    console.log(`[H2] FAILED: resolved in ${el(started)}`);
  } catch (error) {
    const elapsed = Date.now() - started;
    console.log(
      `[H2] deadline on a QUEUED request fired after ${elapsed}ms -> ` +
        `${error.name}` +
        (elapsed > 3000 ? "  <-- LATE: the signal did not pre-empt the queue" : "  <-- on time"),
    );
  }
}

for (const res of stalled) { try { res.destroy(); } catch { /* ignore */ } }
server.close();
console.log("");
console.log("[probe] done");
process.exit(0);
