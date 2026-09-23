#!/usr/bin/env node
/**
 * scripts/recon/l26-any-isolated.mjs
 *
 * SLICE L-26 — RECON. Q3 of the floor probe appeared to hang. Before
 * drawing ANY conclusion from that, isolate it: one question, one process,
 * no other pending promises in the event loop.
 *
 * The question: does `AbortSignal.any([callerSignal, floorSignal])` abort a
 * real fetch when the CALLER's (shorter) signal fires?
 *
 * This matters enormously. If `AbortSignal.any` does not propagate, then the
 * floor would REPLACE every existing deadline rather than tighten it, and
 * shipping it would silently undo slice L-25.
 *
 * Isolated because the combined probe held a deliberately-never-settling
 * fetch from Q1 alive in the same process. That is a confound: a hang in a
 * later stage could be the stage, or could be the earlier promise. Never
 * diagnose from an experiment with two variables in it.
 */
import { createServer } from "node:http";

const blackHole = createServer((req) => { void req; });
await new Promise((r) => blackHole.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${blackHole.address().port}/rest/v1/x`;

console.log(`[probe] black hole: ${URL_}`);
console.log(`[probe] node ${process.version}`);
console.log("");

// ── A: does AbortSignal.any fire its EVENT at all? (no fetch involved) ──
{
  const started = Date.now();
  const caller = AbortSignal.timeout(500);
  const floor = AbortSignal.timeout(30_000);
  const combined = AbortSignal.any([caller, floor]);
  await new Promise((resolve) => {
    combined.addEventListener("abort", () => {
      console.log(
        `[A] combined signal aborted after ${Date.now() - started}ms ` +
          `reason=${combined.reason?.name}`,
      );
      resolve();
    });
    setTimeout(() => {
      console.log(`[A] FAILED: no abort event after 3000ms`);
      resolve();
    }, 3000);
  });
}

// ── B: does that combined signal actually abort a real fetch? ───────────
{
  const started = Date.now();
  const caller = AbortSignal.timeout(500);
  const floor = AbortSignal.timeout(30_000);
  try {
    await fetch(URL_, { signal: AbortSignal.any([caller, floor]) });
    console.log(`[B] FAILED: resolved in ${Date.now() - started}ms`);
  } catch (error) {
    console.log(
      `[B] fetch aborted after ${Date.now() - started}ms -> ` +
        `${error.name}: ${error.message}`,
    );
  }
}

// ── C: the floor side of the same combinator ────────────────────────────
{
  const started = Date.now();
  const caller = AbortSignal.timeout(30_000);
  const floor = AbortSignal.timeout(700);
  try {
    await fetch(URL_, { signal: AbortSignal.any([caller, floor]) });
    console.log(`[C] FAILED: resolved in ${Date.now() - started}ms`);
  } catch (error) {
    console.log(
      `[C] floor fired after ${Date.now() - started}ms -> ` +
        `${error.name}: ${error.message}`,
    );
  }
}

blackHole.close();
console.log("");
console.log("[probe] done");
process.exit(0);
