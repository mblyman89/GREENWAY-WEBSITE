#!/usr/bin/env node
/**
 * scripts/recon/l26-signal-gc.mjs
 *
 * SLICE L-26 — RECON. THE HYPOTHESIS THAT WOULD HAVE SHIPPED A FOURTH
 * FAILED FIX.
 *
 * ===========================================================================
 * THE OBSERVATION
 * ===========================================================================
 * The same construction behaves two different ways depending only on how
 * long the process has been running and how much has been allocated:
 *
 *   l26-q3-forensics  F2: any([timeout(900), timeout(30_000)])  aborted 901ms
 *   l26-q3-replica    Q3: any([timeout(900), timeout(30_000)])  HUNG >10_000ms
 *
 * Identical inputs. Opposite outcomes. That is not flakiness to shrug at —
 * a deadline that sometimes does not fire is indistinguishable from the bug
 * this entire slice exists to remove, and it would fail in production
 * exactly when the system is busy, which is exactly when it is needed.
 *
 * ===========================================================================
 * THE HYPOTHESIS: PREMATURE GARBAGE COLLECTION
 * ===========================================================================
 * `AbortSignal.timeout()` and `AbortSignal.any()` are specified to be
 * collectable when nothing can observe them. A composite signal returned by
 * `AbortSignal.any()` holds its SOURCE signals weakly. If the only strong
 * references to the sources are local variables that have gone out of scope
 * — which is precisely what `withFloor()` does — then once a GC cycle runs,
 * the sources can be collected and their timers never fire.
 *
 * The result: `fetch` waits on a composite signal that is now incapable of
 * ever aborting. Silent. Non-deterministic. Load-dependent.
 *
 * That would make `AbortSignal.any` an unacceptable foundation for the fix,
 * and it explains the difference above: the replica had run six seconds and
 * allocated more before reaching Q3, so a GC cycle had had the chance to run.
 *
 * ===========================================================================
 * HOW THIS IS TESTED
 * ===========================================================================
 * Run with `--expose-gc` and force collection between creating the signal
 * and awaiting it. If the hypothesis is right, the forced-GC case hangs
 * deterministically and the no-GC case aborts on time.
 *
 * G1  composite signal, NO forced gc          → expect: aborts ~900ms
 * G2  composite signal, forced gc             → hypothesis: HANGS
 * G3  composite signal, sources kept ALIVE
 *     in a strong reference, forced gc        → expect: aborts ~900ms
 *                                               (this is the FIX)
 * G4  plain AbortSignal.timeout, forced gc    → is the bare timeout affected?
 *
 * Usage:  node --expose-gc scripts/recon/l26-signal-gc.mjs
 */
import { createServer } from "node:http";

const server = createServer((req) => { void req; });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/rest/v1/x`;

const HAS_GC = typeof globalThis.gc === "function";
console.log(`[probe] black hole: ${URL_}`);
console.log(`[probe] node ${process.version}  gc exposed: ${HAS_GC}`);
if (!HAS_GC) {
  console.log("[probe] RERUN WITH --expose-gc, otherwise G2/G3/G4 prove nothing");
}
console.log("");

async function stage(name, makeSignal, { forceGc }) {
  const started = Date.now();
  const signal = makeSignal();

  if (forceGc && HAS_GC) {
    // Two cycles: the first may only promote, the second collects.
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.gc();
  }

  const r = await Promise.race([
    fetch(URL_, { signal }).then(
      () => ({ k: "ok" }),
      (e) => ({ k: "err", n: e?.name }),
    ),
    new Promise((res) => setTimeout(() => res({ k: "HUNG" }), 6000)),
  ]);
  const took = Date.now() - started;
  console.log(
    r.k === "HUNG"
      ? `[${name}] HUNG (>6000ms)  <-- DEADLINE NEVER FIRED`
      : `[${name}] ${r.n ?? "resolved"} after ${took}ms`,
  );
  return r.k;
}

/* ── G1: composite, no forced GC ─────────────────────────────────────── */
await stage(
  "G1 any(), no gc          ",
  () => AbortSignal.any([AbortSignal.timeout(900), AbortSignal.timeout(30_000)]),
  { forceGc: false },
);

/* ── G2: composite, forced GC — THE SUSPECT ──────────────────────────── */
await stage(
  "G2 any(), FORCED GC      ",
  () => AbortSignal.any([AbortSignal.timeout(900), AbortSignal.timeout(30_000)]),
  { forceGc: true },
);

/* ── G3: composite with sources held alive — THE CANDIDATE FIX ───────── */
//
// A module-level array keeps a strong reference to the source signals for
// the lifetime of the request, so there is nothing for the collector to
// take. If G2 hangs and G3 does not, the mechanism is proven and the fix is
// "hold the sources".
const KEEP_ALIVE = [];
await stage(
  "G3 any(), sources pinned ",
  () => {
    const a = AbortSignal.timeout(900);
    const b = AbortSignal.timeout(30_000);
    const combined = AbortSignal.any([a, b]);
    KEEP_ALIVE.push(a, b, combined);
    return combined;
  },
  { forceGc: true },
);

/* ── G4: is a BARE AbortSignal.timeout affected too? ─────────────────── */
//
// This is the more frightening possibility. If a plain `AbortSignal.timeout`
// can be collected before it fires, then every `.abortSignal()` added in
// slice L-25 has the same defect, and the "bounded" queries are only
// bounded when the garbage collector happens not to run.
await stage(
  "G4 bare timeout, FORCED GC",
  () => AbortSignal.timeout(900),
  { forceGc: true },
);

/* ── G5: bare timeout held alive, forced GC (control for G4) ─────────── */
await stage(
  "G5 bare timeout, pinned  ",
  () => {
    const s = AbortSignal.timeout(900);
    KEEP_ALIVE.push(s);
    return s;
  },
  { forceGc: true },
);

console.log("");
console.log(`[probe] keep-alive refs retained: ${KEEP_ALIVE.length}`);
server.close();
console.log("[probe] done");
process.exit(0);
