#!/usr/bin/env node
/**
 * RECON ONLY (L-25). Prove, against a REAL socket, two things:
 *
 *   1. A PostgREST query against a server that accepts the connection and then
 *      never answers hangs FOREVER with the client we actually use.
 *   2. `.abortSignal(AbortSignal.timeout(ms))` bounds it.
 *
 * Same methodology L-23 used for the body stall: a real server, not a mock,
 * because a mock could not have reproduced the original defect.
 *
 * Uses PostgrestClient directly rather than createClient(). That is not a
 * shortcut — `supabase.from(...)` IS a PostgrestClient query builder; the
 * supabase-js wrapper only adds auth/realtime/storage around it. Driving the
 * query layer directly avoids realtime-js's Node-20 WebSocket requirement,
 * which is a sandbox artefact and has nothing to do with the behaviour under
 * test.
 */
import { createServer } from "node:http";
import { PostgrestClient } from "@supabase/postgrest-js";

const server = createServer((req) => {
  // Accept the request. Send NOTHING. Ever. A black hole — which is what a
  // saturated connection pooler looks like from the outside.
  void req;
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}`;
console.log(`[probe] black-hole server on ${url}`);
console.log("");

const db = new PostgrestClient(url, {
  headers: { apikey: "probe", Authorization: "Bearer probe" },
});

// ── PROBE 1: the code as it exists today (no signal of any kind) ──────────
{
  const started = Date.now();
  let settled = false;
  db.from("integration_credentials")
    .select("*")
    .eq("id", true)
    .maybeSingle()
    .then(
      () => { settled = true; },
      () => { settled = true; },
    );

  await new Promise((r) => setTimeout(r, 8000));
  console.log(
    `[probe 1] UNBOUNDED (today's code): after ${Date.now() - started}ms ` +
      `settled=${settled} -> ${settled ? "returned" : "STILL HANGING"}`,
  );
}

console.log("");

// ── PROBE 2: the same query, bounded ──────────────────────────────────────
{
  const started = Date.now();
  let outcome = "STILL HANGING";
  try {
    const { error } = await db
      .from("integration_credentials")
      .select("*")
      .eq("id", true)
      .abortSignal(AbortSignal.timeout(1500))
      .maybeSingle();
    outcome = error ? `returned an error value: ${error.message}` : "returned ok";
  } catch (err) {
    outcome = `threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(
    `[probe 2] BOUNDED (abortSignal 1500ms): after ${Date.now() - started}ms -> ${outcome}`,
  );
}

server.close();
process.exit(0);
