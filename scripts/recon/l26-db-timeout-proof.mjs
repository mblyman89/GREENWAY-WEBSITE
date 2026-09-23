#!/usr/bin/env node
/**
 * scripts/recon/l26-db-timeout-proof.mjs
 *
 * SLICE L-26 — RECON. Prove the FIX, against a real socket, under GC
 * pressure, using the REAL client — before shipping it.
 *
 * ===========================================================================
 * THE ROAD TO THIS SCRIPT (why the obvious fix was the wrong one)
 * ===========================================================================
 * This slice began intending to inject a custom `fetch` that composed a
 * floor deadline with `AbortSignal.any([caller, floor])`. That would have
 * covered all ~300 unbounded queries in one place.
 *
 * It would also have been the fourth failed fix. Measured, in
 * `scripts/recon/l26-signal-gc.mjs`, on this exact Node version:
 *
 *   [G1 any(), no gc          ] TimeoutError after 904ms
 *   [G2 any(), FORCED GC      ] HUNG (>6000ms)  <-- DEADLINE NEVER FIRED
 *   [G3 any(), sources pinned ] TimeoutError after 901ms
 *   [G4 bare timeout, FORCED GC] TimeoutError after 900ms
 *
 * `AbortSignal.any()` loses its abort when its source signals are collected.
 * This is a CONFIRMED upstream Node.js defect:
 *
 *   nodejs/node#57736 "AbortSignal.any() is unreliable and breaks timeouts"
 *                     labelled `confirmed-bug`, fixed by PR #57867
 *   nodejs/node#55428 "Request signal isn't aborted after garbage collection"
 *                     labelled `confirmed-bug`, still OPEN
 *
 * A deadline that stops working once the garbage collector runs is worse
 * than no deadline, because it looks correct in every test and fails only
 * under load — which is exactly when the shop needs it.
 *
 * ===========================================================================
 * THE FIX THAT IS ACTUALLY AVAILABLE
 * ===========================================================================
 * `@supabase/supabase-js` v2.108 exposes `db.timeout`, and postgrest-js
 * implements it with a plain `AbortController` + `setTimeout` — NOT with
 * `AbortSignal.any`. Vendored source, `postgrest-js/dist/index.mjs:4888`:
 *
 *   const controller = new AbortController();
 *   const timeoutId = setTimeout(() => controller.abort(), timeout);
 *
 * A live `setTimeout` is a GC root, and the closure holds the controller, so
 * nothing here is collectable while the timer is pending. That is precisely
 * the shape probe G4 showed to be safe.
 *
 * It also correctly BRIDGES a caller's own signal (same source, line 4897):
 * if `init.signal` is present it attaches an abort listener that trips the
 * controller — giving the same "tighter deadline wins" composition as
 * `AbortSignal.any`, without the collectable composite.
 *
 * ===========================================================================
 * WHAT THIS SCRIPT ASSERTS
 * ===========================================================================
 *   P1. CONTROL — the real client with NO db.timeout hangs forever.
 *   P2. db.timeout bounds it.
 *   P3. db.timeout STILL bounds it after a forced GC  (the G2 killer).
 *   P4. a per-query .abortSignal() that is SHORTER still wins.
 *   P5. the timeout surfaces through the `{ data, error }` channel, so
 *       every existing `if (error)` branch handles it unmodified.
 *   P6. a healthy query is unaffected.
 *
 * PostgrestClient is driven directly rather than through createClient() for
 * the reason documented in the L-25 probe: `supabase.from(...)` IS a
 * PostgrestClient query builder, and driving it directly avoids realtime-js's
 * WebSocket requirement, which is a sandbox artefact unrelated to this test.
 * The constructor option under test is the same one createClient() forwards
 * (`supabase-js/dist/index.mjs:684  timeout: settings.db.timeout`).
 *
 * Usage:  node --expose-gc scripts/recon/l26-db-timeout-proof.mjs
 */
import { createServer } from "node:http";
import { PostgrestClient } from "@supabase/postgrest-js";

const blackHole = createServer((req) => { void req; });
const healthy = createServer((req, res) => {
  void req;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify([{ id: "row-1" }]));
});
await new Promise((r) => blackHole.listen(0, "127.0.0.1", r));
await new Promise((r) => healthy.listen(0, "127.0.0.1", r));

const BLACK_HOLE = `http://127.0.0.1:${blackHole.address().port}`;
const HEALTHY = `http://127.0.0.1:${healthy.address().port}`;
const HAS_GC = typeof globalThis.gc === "function";

console.log(`[probe] black hole : ${BLACK_HOLE}`);
console.log(`[probe] healthy    : ${HEALTHY}`);
console.log(`[probe] node ${process.version}  gc exposed: ${HAS_GC}`);
console.log("");

const HEADERS = { apikey: "probe", Authorization: "Bearer probe" };

/** Run a query under an independent wall-clock guard. */
async function guarded(name, run, guardMs = 9000) {
  const started = Date.now();
  const outcome = await Promise.race([
    run().then(
      (v) => ({ k: "settled", v }),
      (e) => ({ k: "threw", n: e?.name, m: e?.message }),
    ),
    new Promise((r) => setTimeout(() => r({ k: "HUNG" }), guardMs)),
  ]);
  const took = Date.now() - started;
  if (outcome.k === "HUNG") {
    console.log(`[${name}] HUNG (>${guardMs}ms)`);
  } else if (outcome.k === "threw") {
    console.log(`[${name}] threw after ${took}ms -> ${outcome.n}: ${outcome.m}`);
  } else {
    const { data, error } = outcome.v ?? {};
    console.log(
      `[${name}] settled after ${took}ms -> ` +
        (error
          ? `error.message=${JSON.stringify(String(error.message).slice(0, 80))}`
          : `data=${JSON.stringify(data)}`),
    );
  }
  return outcome;
}

/* ── P1. CONTROL: no db.timeout ───────────────────────────────────────── */
const noTimeout = new PostgrestClient(BLACK_HOLE, { headers: HEADERS });
await guarded("P1 CONTROL no timeout   ", () =>
  noTimeout.from("announcer_devices").select("id"),
);

/* ── P2. db.timeout bounds it ─────────────────────────────────────────── */
const bounded = new PostgrestClient(BLACK_HOLE, { headers: HEADERS, timeout: 1200 });
await guarded("P2 timeout 1200         ", () =>
  bounded.from("announcer_devices").select("id"),
);

/* ── P3. THE G2 KILLER: same, but force a GC mid-flight ──────────────── */
//
// This is the stage that disqualified AbortSignal.any. The query is started,
// then the collector is run twice while the request is in flight. If
// db.timeout were built on a collectable composite signal, this hangs.
{
  const started = Date.now();
  const client = new PostgrestClient(BLACK_HOLE, { headers: HEADERS, timeout: 1200 });
  const inFlight = client
    .from("announcer_devices")
    .select("id")
    .then(
      (v) => ({ k: "settled", v }),
      (e) => ({ k: "threw", n: e?.name }),
    );

  if (HAS_GC) {
    await new Promise((r) => setTimeout(r, 200));
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 200));
    globalThis.gc();
  }

  const outcome = await Promise.race([
    inFlight,
    new Promise((r) => setTimeout(() => r({ k: "HUNG" }), 9000)),
  ]);
  const took = Date.now() - started;
  console.log(
    outcome.k === "HUNG"
      ? `[P3 timeout + FORCED GC ] HUNG (>9000ms)  <-- THE FIX IS GC-FRAGILE, DO NOT SHIP`
      : `[P3 timeout + FORCED GC ] survived GC, settled after ${took}ms ` +
        `-> ${outcome.v?.error ? `error=${String(outcome.v.error.message).slice(0, 60)}` : outcome.n ?? "data"}`,
  );
}

/* ── P4. a SHORTER per-query .abortSignal() still wins ───────────────── */
//
// L-25 attached per-query deadlines chosen against Leafly's documented
// latency. Installing a client-wide floor must TIGHTEN, never relax, them.
{
  const client = new PostgrestClient(BLACK_HOLE, { headers: HEADERS, timeout: 30_000 });
  await guarded("P4 floor 30s + query 800", () =>
    client.from("leafly_orders").select("id").abortSignal(AbortSignal.timeout(800)),
  );
}

/* ── P5. the shape of the failure: error VALUE, not a throw ──────────── */
//
// Every reader in this codebase is written as `const { data, error } = await
// ...; if (error) return fallback`. If the timeout arrived as a THROW
// instead, those readers would propagate it and 500 the page rather than
// degrading. This checks which channel it uses.
{
  const client = new PostgrestClient(BLACK_HOLE, { headers: HEADERS, timeout: 700 });
  const outcome = await guarded("P5 error channel        ", () =>
    client.from("announcer_devices").select("id"),
  );
  if (outcome.k === "settled") {
    const { error } = outcome.v ?? {};
    console.log(
      `[P5] -> arrives as an ERROR VALUE (existing \`if (error)\` branches handle it). ` +
        `name=${JSON.stringify(error?.name ?? null)} code=${JSON.stringify(error?.code ?? null)}`,
    );
  } else if (outcome.k === "threw") {
    console.log(`[P5] -> arrives as a THROW (name=${outcome.n}); readers need try/catch`);
  }
}

/* ── P6. a healthy query is untouched ────────────────────────────────── */
{
  const client = new PostgrestClient(HEALTHY, { headers: HEADERS, timeout: 20_000 });
  await guarded("P6 healthy query        ", () =>
    client.from("announcer_devices").select("id"),
  );
}

blackHole.close();
healthy.close();
console.log("");
console.log("[probe] done");
process.exit(0);
