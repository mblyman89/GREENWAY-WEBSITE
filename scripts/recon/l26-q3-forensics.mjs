#!/usr/bin/env node
/**
 * scripts/recon/l26-q3-forensics.mjs
 *
 * SLICE L-26 — RECON. Close the Q3 discrepancy before shipping anything.
 *
 * ===========================================================================
 * THE STATE OF THE EVIDENCE
 * ===========================================================================
 *   l26-floor-fetch-probe   Q3 (caller 900ms + floor 30s)  NEVER SETTLED
 *   l26-any-isolated        B  (caller 500ms + floor 30s)  settled in 504ms
 *   l26-head-of-line        no socket contention; deadlines fire on time
 *
 * Same construction, opposite results. One of these experiments is lying,
 * and `AbortSignal.any` is the exact mechanism this slice intends to build
 * on, so "it probably works, the isolated test passed" is not good enough.
 * If a combined signal can silently fail to abort, the floor is worthless
 * and I would be shipping the fourth failed fix.
 *
 * The ONLY difference between the two runs is that the failing one had an
 * earlier, deliberately-unbounded fetch to the SAME origin still pending,
 * and it was that fetch's stage that logged last.
 *
 * VARIABLES, ISOLATED ONE AT A TIME:
 *   F1. combined signal, nothing else pending          (expect: aborts)
 *   F2. combined signal, ONE dangling unbounded fetch  (the suspect)
 *   F3. plain caller-only signal + dangling fetch      (is `any` implicated
 *                                                       at all, or is it the
 *                                                       dangling request?)
 *   F4. was it never the fetch — but the PROBE's own reporting?
 *
 * Each stage is independently guarded by a wall-clock race so that one hang
 * cannot hide the stages after it. That is the flaw in the original probe
 * and it is worth fixing here rather than re-running a blind instrument.
 */
import { createServer } from "node:http";

const server = createServer((req) => { void req; });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/rest/v1/x`;

console.log(`[probe] black hole: ${URL_}`);
console.log(`[probe] node ${process.version}`);
console.log("");

/**
 * Run one stage under an independent wall-clock guard.
 *
 * The original probe awaited each stage directly, so the first stage that
 * hung consumed the entire process budget and every later stage reported
 * nothing. An instrument whose failure mode is silence cannot be trusted to
 * tell you which thing failed.
 */
async function stage(name, fn, guardMs = 8000) {
  const started = Date.now();
  const result = await Promise.race([
    fn().then(
      (v) => ({ kind: "resolved", v }),
      (e) => ({ kind: "rejected", name: e?.name, message: e?.message }),
    ),
    new Promise((r) => setTimeout(() => r({ kind: "HUNG" }), guardMs)),
  ]);
  const took = Date.now() - started;
  if (result.kind === "HUNG") {
    console.log(`[${name}] HUNG: no settlement within ${guardMs}ms`);
  } else if (result.kind === "rejected") {
    console.log(`[${name}] aborted after ${took}ms -> ${result.name}`);
  } else {
    console.log(`[${name}] RESOLVED after ${took}ms (no abort!)`);
  }
  return result;
}

/* ── F1: combined signal, clean process ──────────────────────────────── */
await stage("F1 combined, nothing pending", () =>
  fetch(URL_, {
    signal: AbortSignal.any([AbortSignal.timeout(900), AbortSignal.timeout(30_000)]),
  }),
);

/* ── F2: introduce the suspect — a dangling unbounded fetch ──────────── */
console.log("");
console.log("[probe] ...starting ONE unbounded fetch that will never settle");
const dangling = fetch(URL_).then(
  () => "resolved",
  () => "rejected",
);
void dangling;
await new Promise((r) => setTimeout(r, 300));

await stage("F2 combined, 1 dangling", () =>
  fetch(URL_, {
    signal: AbortSignal.any([AbortSignal.timeout(900), AbortSignal.timeout(30_000)]),
  }),
);

/* ── F3: is `AbortSignal.any` implicated, or just the dangling fetch? ── */
await stage("F3 plain signal, 1 dangling", () =>
  fetch(URL_, { signal: AbortSignal.timeout(900) }),
);

/* ── F4: repeat F1's exact shape a second time, late in the process ──── */
//
// If F1 passes and F4 fails with the same inputs, the variable is process
// age / accumulated state, not the signal construction.
await stage("F4 combined, repeated late", () =>
  fetch(URL_, {
    signal: AbortSignal.any([AbortSignal.timeout(900), AbortSignal.timeout(30_000)]),
  }),
);

console.log("");
console.log("[probe] VERDICT");
console.log("[probe]   If F1..F4 all abort near 900ms, AbortSignal.any is sound");
console.log("[probe]   and the original Q3 'hang' was the probe, not the code.");

server.close();
console.log("");
console.log("[probe] done");
process.exit(0);
