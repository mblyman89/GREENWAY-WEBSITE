#!/usr/bin/env node
/**
 * scripts/recon/l26-q3-replica.mjs
 *
 * SLICE L-26 — RECON. Byte-for-byte replica of the original floor probe's
 * stages, but with an independent wall-clock guard around each one.
 *
 * WHY BOTHER, GIVEN F1..F4 ALREADY PASSED
 * ===========================================================================
 * Because "the isolated version worked, so the combined version must have
 * been a fluke" is exactly the reasoning that lets a real defect through.
 * The combined probe is closer to production than the isolated one:
 * production has MANY concurrent requests in flight, a mix of bounded and
 * unbounded, against a live origin. If something about that combination can
 * defeat a deadline, that is not a probe artefact — that is the bug.
 *
 * The original instrument could not tell me WHICH stage hung, because it
 * awaited each stage directly and the first hang ate the whole budget. This
 * replica fixes only the instrument, changing none of the stages.
 */
import { createServer } from "node:http";

const blackHole = createServer((req) => { void req; });
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

// IDENTICAL to the original.
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

async function stage(name, fn, guardMs = 10_000) {
  const started = Date.now();
  const r = await Promise.race([
    fn().then(
      (v) => ({ k: "ok", v }),
      (e) => ({ k: "err", n: e?.name, m: e?.message }),
    ),
    new Promise((res) => setTimeout(() => res({ k: "HUNG" }), guardMs)),
  ]);
  const took = Date.now() - started;
  console.log(
    r.k === "HUNG"
      ? `[${name}] HUNG (>${guardMs}ms)`
      : r.k === "err"
        ? `[${name}] aborted after ${took}ms -> ${r.n}`
        : `[${name}] resolved after ${took}ms -> ${JSON.stringify(r.v)}`,
  );
  return r;
}

/* Q1 — the control: an unbounded fetch left dangling, exactly as before. */
console.log("[probe] Q1: starting the unbounded control fetch (never awaited)");
let q1settled = false;
fetch(BLACK_HOLE).then(
  () => { q1settled = true; },
  () => { q1settled = true; },
);
await new Promise((r) => setTimeout(r, 6000));
console.log(`[Q1] after 6000ms settled=${q1settled} (expected false)`);
console.log("");

/* Q2 — floor only. */
await stage("Q2 floor 1500", () => withFloor(1500)(BLACK_HOLE));

/* Q3 — THE STAGE THAT HUNG. floor 30s + caller 900ms. */
await stage("Q3 floor 30000 + caller 900", () =>
  withFloor(30_000)(BLACK_HOLE, { signal: AbortSignal.timeout(900) }),
);

/* Q4 — healthy request through the floor. */
await stage("Q4 healthy via floor", async () => {
  const res = await withFloor(20_000)(HEALTHY);
  return { status: res.status, body: await res.json() };
});

/* Q5 — error shape. */
await stage("Q5 floor 300", () => withFloor(300)(BLACK_HOLE));

console.log("");
console.log("[probe] If Q3 aborts near 900ms here, the original 'hang' was the");
console.log("[probe] instrument (no per-stage guard), not AbortSignal.any.");

for (const s of [blackHole, healthy]) s.close();
console.log("");
console.log("[probe] done");
process.exit(0);
