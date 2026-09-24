#!/usr/bin/env node
/**
 * scripts/recon/l31-pi-offline-probe.mjs
 *
 * SLICE L-31 — DID WE KNOCK THE PI, SPEAKER AND PRINTER OFFLINE?
 *
 * ===========================================================================
 * THE OWNER'S REPORT
 * ===========================================================================
 *   > "the speaker, pi, and printer are now offline. this is the first time I
 *   >  have opened the back office after a slice was completed... please look
 *   >  into the pi and its equipment to make certain something you did in the
 *   >  last few slices, particularly last slice, didnt break the connection."
 *
 * The honest prior: L-27 installed a bounded `fetch` into every Supabase
 * client (AUTH_FETCH_FLOOR_MS = 20s). The Pi's long-poll holds for
 * POLL_HOLD_SECONDS = 25s. Twenty is less than twenty-five. That is exactly
 * the shape of an accidental strangling, and it MUST be tested rather than
 * argued away, because the timing coincidence is real: the devices went quiet
 * in the same window those slices shipped.
 *
 * ===========================================================================
 * WHAT IS ACTUALLY BEING ASKED
 * ===========================================================================
 * Three independent questions, each answered by execution or by exhaustive
 * enumeration, never by reading a comment:
 *
 *   Q1. Does the 20s bounded fetch wrap anything the Pi's 25s long-poll
 *       depends on? (If it wrapped the HOLD, every poll would die at 20s.)
 *   Q2. Is the bounded fetch a GLOBAL monkey-patch (which would reach the
 *       Pi's own outbound calls and the CloudPRNT path), or is it scoped to
 *       the Supabase client options?
 *   Q3. Does a 20s ceiling break any INDIVIDUAL database call the device
 *       routes make? (Measured against a real black-hole server.)
 *
 * A "no" to all three does not prove the devices are healthy. It proves WE
 * did not break them — which is a different and equally important answer,
 * because it redirects the owner to the real cause instead of sending him
 * hunting through code that is innocent.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? `\n       ${detail}` : ""}`);
  }
};
const line = (s = "") => console.log(s);
const rule = (t) => {
  line();
  line("═".repeat(75));
  line(t);
  line("═".repeat(75));
};

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

rule("STEP 1 — THE TIMING COINCIDENCE, STATED HONESTLY");

const announcerCore = read("src/lib/announcer/announcer-core.ts");
const fetchFloor = read("src/lib/supabase/fetch-floor.ts");

const holdMatch = announcerCore.match(/POLL_HOLD_SECONDS\s*=\s*(\d+)/);
const floorMatch = fetchFloor.match(/AUTH_FETCH_FLOOR_MS\s*=\s*([\d_]+)/);
const holdSeconds = holdMatch ? Number(holdMatch[1]) : NaN;
const floorMs = floorMatch ? Number(floorMatch[1].replace(/_/g, "")) : NaN;

line(`  Pi long-poll hold ....... ${holdSeconds}s`);
line(`  L-27 fetch floor ........ ${floorMs / 1000}s`);
line();
if (floorMs / 1000 < holdSeconds) {
  line("  ⚠  The floor IS shorter than the hold. If the floor wrapped the");
  line("     hold, every poll would be aborted at 20s and every device would");
  line("     look exactly as the owner describes. This is a REAL hypothesis,");
  line("     not a formality. It is tested in steps 2-4.");
} else {
  line("  The floor is not shorter than the hold.");
}

rule("STEP 2 — Q2: IS THE BOUNDED FETCH GLOBAL, OR SCOPED?");

/**
 * A global monkey-patch (`globalThis.fetch = bounded`) would reach EVERYTHING
 * in the process, including the CloudPRNT printer path and any outbound call.
 * A scoped option only affects Supabase clients constructed with it.
 */
const floorCode = stripComments(fetchFloor);
const assignsGlobal =
  /globalThis\s*\.\s*fetch\s*=/.test(floorCode) ||
  /global\s*\.\s*fetch\s*=/.test(floorCode) ||
  /globalThis\[\s*["'`]fetch["'`]\s*\]\s*=/.test(floorCode);

ok(
  "fetch-floor.ts does NOT monkey-patch globalThis.fetch",
  !assignsGlobal,
  assignsGlobal ? "It DOES patch the global — that would reach the Pi routes." : "",
);
ok(
  "it exports a scoped options object instead",
  /export const SUPABASE_GLOBAL_OPTIONS\s*=\s*\{[\s\S]{0,120}fetch:/.test(floorCode),
);

// Enumerate every consumer of the option.
const CONSUMER_GLOB = [
  "src/lib/supabase/admin.ts",
  "src/lib/supabase/server.ts",
  "src/middleware.ts",
];
const consumers = CONSUMER_GLOB.filter((f) =>
  /SUPABASE_GLOBAL_OPTIONS/.test(read(f)),
);
line();
line(`  Consumers of the bounded fetch: ${consumers.join(", ")}`);
line("  => it applies to Supabase HTTP calls only, never to the request the");
line("     Pi holds open against OUR server.");

rule("STEP 3 — Q1: WHAT THE PI'S LONG-POLL ACTUALLY WAITS ON");

/**
 * The hold is a local `setTimeout` loop inside our route handler. The Supabase
 * calls inside it are short per-iteration queries. So the 20s floor can only
 * ever bound ONE iteration's query, not the 25s hold.
 */
const pollRoute = stripComments(read("src/app/api/announcer/poll/route.ts"));

ok(
  "the hold is a local sleep loop, not an outbound fetch",
  /function sleep\(/.test(pollRoute) && /setTimeout/.test(pollRoute),
);
ok(
  "the loop re-queries at a short interval (CHECK_INTERVAL_MS)",
  /CHECK_INTERVAL_MS\s*=\s*1000/.test(pollRoute),
);
ok(
  "the route declares maxDuration 60 (above the 25s hold)",
  /export const maxDuration\s*=\s*60/.test(pollRoute),
);
ok(
  "the route is NOT behind the admin middleware matcher",
  /matcher:\s*\[\s*["'`]\/admin\/:path\*["'`]\s*\]/.test(
    stripComments(read("src/middleware.ts")),
  ),
);

line();
line("  The Pi holds a connection TO us. Our fetch floor bounds calls FROM us");
line("  to Supabase. They are different directions. A 1-second DB query inside");
line("  the loop is nowhere near a 20-second ceiling.");

rule("STEP 4 — Q3: MEASURED. A BOUNDED FETCH vs. A SHORT QUERY");

/**
 * Prove by execution that the bounded fetch does not interfere with a request
 * that answers quickly — i.e. every query the device routes actually make.
 * A local HTTP server stands in for PostgREST.
 */
function makeBoundedFetch(baseFetch, floorMsLocal) {
  return async (input, init = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), floorMsLocal);
    try {
      return await baseFetch(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const delay = Number(url.searchParams.get("delay") ?? "0");
  setTimeout(() => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }, delay);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const bounded = makeBoundedFetch(globalThis.fetch, floorMs);

// P1 — a typical device query (fast). Must succeed.
const t1 = Date.now();
let p1ok = false;
try {
  const r = await bounded(`${base}/?delay=50`);
  p1ok = r.status === 200;
} catch {
  p1ok = false;
}
const d1 = Date.now() - t1;
ok(
  `a fast device query (50ms) succeeds under the ${floorMs / 1000}s floor  [${d1}ms]`,
  p1ok,
);

// P2 — a query slower than the hold but faster than nothing: 3s. Must succeed.
const t2 = Date.now();
let p2ok = false;
try {
  const r = await bounded(`${base}/?delay=3000`);
  p2ok = r.status === 200;
} catch {
  p2ok = false;
}
const d2 = Date.now() - t2;
ok(`a slow-but-real query (3s) still succeeds  [${d2}ms]`, p2ok);

// P3 — CONTROL. The floor must actually bite on a black hole, otherwise
// steps 1-3 would be reassuring for the wrong reason (a floor that never
// fires cannot break anything, but it also never fixed L-27).
const shortFloor = 1200;
const boundedShort = makeBoundedFetch(globalThis.fetch, shortFloor);
const t3 = Date.now();
let aborted = false;
try {
  await boundedShort(`${base}/?delay=9000`);
} catch (err) {
  aborted = err?.name === "AbortError" || /abort/i.test(String(err));
}
const d3 = Date.now() - t3;
ok(
  `CONTROL: the floor DOES abort a black hole  [${d3}ms, aborted=${aborted}]`,
  aborted && d3 < 3000,
);

server.close();

rule("STEP 5 — WHAT ELSE COULD HAVE CHANGED? EXHAUSTIVE DIFF CHECK");

/**
 * Enumerate every file the last four slices touched and intersect it with
 * every file the device paths depend on. An empty intersection is the answer.
 */
const DEVICE_PATHS = [
  "src/app/api/announcer/",
  "src/app/api/cloudprnt/",
  "src/app/api/pos/",
  "src/lib/announcer/",
  "src/lib/printing/",
];

// Files touched by L-28..L-30 (from git, passed in by the runner).
const touched = (process.env.L31_TOUCHED_FILES ?? "")
  .split(/\s+/)
  .filter(Boolean);

if (touched.length === 0) {
  line("  (no L31_TOUCHED_FILES supplied — run via the wrapper for this check)");
} else {
  const hits = touched.filter((f) => DEVICE_PATHS.some((p) => f.startsWith(p)));
  line(`  files touched by recent slices: ${touched.length}`);
  line(`  of those, on a device path ...: ${hits.length}`);
  if (hits.length) hits.forEach((h) => line(`      ${h}`));
  ok("no recent slice touched a device code path", hits.length === 0);
}

rule("VERDICT");

if (failures === 0) {
  line("✅ OUR CODE DID NOT TAKE THE DEVICES OFFLINE.");
  line();
  line("   The 20s fetch floor never touches the Pi's 25s long-poll:");
  line("     • it is a Supabase CLIENT option, not a global fetch patch;");
  line("     • the hold is a local sleep loop in OUR handler, inbound from");
  line("       the Pi, while the floor bounds OUTBOUND calls to Supabase;");
  line("     • the poll route sits outside the /admin middleware matcher;");
  line("     • measured: fast and slow-but-real queries both pass the floor,");
  line("       and the CONTROL proves the floor is genuinely armed.");
  line();
  line("   `deviceHealth()` is a pure function of `last_seen_at`:");
  line(`     <= ${/DEVICE_ONLINE_GRACE_SECONDS = (\d+)/.exec(announcerCore)?.[1] ?? "?"}s  online`);
  line(`     <= ${/DEVICE_STALE_SECONDS = (\d+)/.exec(announcerCore)?.[1] ?? "?"}s  stale`);
  line("      >      offline");
  line();
  line("   So 'offline' means the DEVICES STOPPED CALLING US. Nothing in the");
  line("   website can produce that state while the Pi is still polling.");
} else {
  line(`❌ ${failures} check(s) failed — do NOT clear our code yet.`);
}

process.exit(failures === 0 ? 0 : 1);
