/**
 * scripts/recon/l27-auth-hang-probe.mjs
 *
 * SLICE L-27 — DOES `db: { timeout }` BOUND `auth.getUser()`?
 *
 * L-26 installed a global `db: { timeout: 15000 }` floor on both Supabase
 * factories and proved it bounds PostgREST. The acknowledge button still hung,
 * and the owner's newest report changed shape: it now spins for FIVE MINUTES
 * and quits. Five minutes is exactly `maxDuration = 300` — the platform killer,
 * not any deadline of ours.
 *
 * So the question is no longer "is the database bounded". It is "WHAT ON THIS
 * PATH IS NOT A DATABASE QUERY". The first statement of
 * `acknowledgeLeaflyOrderAction` is `await requirePermission(...)`, which calls
 * `getStaffSession()`, whose FIRST await is `supabase.auth.getUser()`.
 *
 * Reading supabase-js 2.x: `settings.db.timeout` is handed ONLY to the
 * PostgrestClient. `_initSupabaseAuthClient` never receives it, and
 * `auth-js/lib/fetch.js` calls `fetcher(url, requestParams)` with no `signal`.
 *
 * That is a reading. This file is the MEASUREMENT.
 *
 * Run: node scripts/recon/l27-auth-hang-probe.mjs
 */

import http from "node:http";
import { createClient } from "@supabase/supabase-js";

/**
 * Node 20 has no global WebSocket, and supabase-js constructs a RealtimeClient
 * eagerly inside `createClient`. Realtime plays no part in this probe, so a
 * never-connecting stub is installed purely to get past the constructor. In
 * production Next.js supplies the real one; nothing here depends on it.
 */
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = class {
    constructor() {
      /* never connects; never used by this probe */
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
    send() {}
  };
}

const HOLD_MS = 25_000;
const FLOOR_MS = 15_000;
const VERDICT_MS = 20_000;

/** A server that accepts the connection, sends nothing, and never answers. */
function blackHole() {
  return new Promise((resolve) => {
    const held = [];
    const server = http.createServer((req, res) => {
      held.push(res);
      setTimeout(() => {
        try {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } catch {
          /* already gone */
        }
      }, HOLD_MS);
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          for (const r of held) {
            try {
              r.destroy();
            } catch {
              /* noop */
            }
          }
          server.close();
        },
      }),
    );
  });
}

async function timed(label, fn) {
  const started = Date.now();
  let outcome;
  try {
    const r = await fn();
    outcome = r?.error ? `error: ${r.error.message ?? r.error}` : "resolved";
  } catch (err) {
    outcome = `threw: ${err?.message ?? err}`;
  }
  const ms = Date.now() - started;
  console.log(`  ${label.padEnd(46)} ${String(ms).padStart(6)}ms  ${outcome}`);
  return ms;
}

async function main() {
  const hole = await blackHole();
  console.log(`\nBlack hole listening at ${hole.url} (holds ${HOLD_MS}ms)\n`);

  const results = {};

  // ── P1: PostgREST WITH the L-26 floor. Expected: bounded near 15s. ────────
  {
    const c = createClient(hole.url, "anon-key-for-probe", {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { timeout: FLOOR_MS },
    });
    console.log("P1  PostgREST, db.timeout=15000 (the L-26 floor)");
    results.p1 = await timed("  .from('x').select()", () =>
      c.from("staff_profiles").select("*").limit(1),
    );
  }

  // ── P2: auth.getUser() with the SAME client and the SAME floor. ───────────
  //      If the floor covered auth, this would also land near 15s.
  {
    const c = createClient(hole.url, "anon-key-for-probe", {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { timeout: FLOOR_MS },
    });
    console.log("\nP2  auth.getUser(), SAME db.timeout=15000");
    results.p2 = await timed("  .auth.getUser()", () =>
      c.auth.getUser("a-bearer-token-so-it-must-go-to-the-network"),
    );
  }

  // ── P3: the proposed fix — a bounded `global.fetch`. ──────────────────────
  {
    const bounded = (input, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      return fetch(input, { ...init, signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
    };
    const c = createClient(hole.url, "anon-key-for-probe", {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { timeout: FLOOR_MS },
      global: { fetch: bounded },
    });
    console.log("\nP3  auth.getUser(), global.fetch bounded at 8000ms");
    results.p3 = await timed("  .auth.getUser()", () =>
      c.auth.getUser("a-bearer-token-so-it-must-go-to-the-network"),
    );
  }

  hole.close();

  console.log("\n─────────────────────────── VERDICT ───────────────────────────");
  const p1ok = results.p1 < VERDICT_MS;
  const p2hung = results.p2 >= VERDICT_MS;
  const p3ok = results.p3 < VERDICT_MS;

  console.log(
    `P1 PostgREST bounded by db.timeout ......... ${p1ok ? "YES" : "NO"} (${results.p1}ms)`,
  );
  console.log(
    `P2 auth.getUser bounded by db.timeout ..... ${p2hung ? "NO — UNBOUNDED" : "yes"} (${results.p2}ms)`,
  );
  console.log(
    `P3 auth.getUser bounded by global.fetch ... ${p3ok ? "YES" : "NO"} (${results.p3}ms)`,
  );

  const proven = p1ok && p2hung && p3ok;
  console.log(
    `\n${proven ? "PROVEN" : "NOT PROVEN"}: db.timeout does NOT reach the auth client; a bounded global.fetch does.`,
  );
  process.exit(proven ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
