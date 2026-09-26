#!/usr/bin/env node
/**
 * USAGE-4 recon: what does one paired speaker Pi cost per month under each
 * poll shape, and what does it do to announcement latency?
 *
 * Read-only. No network, no database. Run: node scripts/recon/announcer-poll-cost-model.mjs
 *
 * Pricing (Vercel Fluid compute, Pro, read 2026-09-26):
 *   provisioned memory  $0.0106 per GB-hour, 2 GB default instance, billed for
 *                       the whole time a request is in flight (incl. I/O waits)
 *   invocations         $0.60 per million
 *   active CPU          $0.128 per CPU-hour (tiny here; shown for completeness)
 *
 * Latency model: an order lands at a uniformly random instant in the cycle.
 *   during a hold  -> heard at the next claim tick (POLL_CHECK_INTERVAL_SECONDS)
 *   during a rest  -> heard when the rest ends + one request overhead
 */

const GB = 2;
const MEM_PER_GB_HR = 0.0106;
const INVOCATION_PER_M = 0.6;
const CPU_PER_HR = 0.128;
const DAYS = 30;
const CHECK_INTERVAL = 5;
const OVERHEAD_S = 0.5; // TLS + two serial Supabase round trips, typical
const CPU_PER_POLL_S = 0.02;
// Supabase egress per poll, rough: auth row (~1 KB incl. headers) + one
// empty claim (~0.4 KB). A long hold adds one claim per check tick.
const EGRESS_AUTH_KB = 1.0;
const EGRESS_CLAIM_KB = 0.4;

function model(name, { hold, rest }) {
  const cycle = hold + rest + OVERHEAD_S;
  const inFlight = hold + OVERHEAD_S;
  const pollsPerDay = 86400 / cycle;
  const memGbHrMonth = (GB * inFlight * pollsPerDay * DAYS) / 3600;
  const memCost = memGbHrMonth * MEM_PER_GB_HR;
  const invCost = (pollsPerDay * DAYS / 1e6) * INVOCATION_PER_M;
  const cpuCost = (CPU_PER_POLL_S * pollsPerDay * DAYS / 3600) * CPU_PER_HR;
  // The route claims at t=0 and then every CHECK_INTERVAL while
  // t + CHECK_INTERVAL < hold, so a 25 s hold is 5 claims and a 0 s hold is 1.
  const claimsPerPoll = Math.max(1, Math.ceil(hold / CHECK_INTERVAL));
  const dbCallsPerDay = pollsPerDay * (1 + claimsPerPoll);
  const egressGbMonth = (pollsPerDay * (EGRESS_AUTH_KB + claimsPerPoll * EGRESS_CLAIM_KB) * DAYS) / 1e6;
  // latency
  const pHold = hold / cycle;
  const pRest = (rest + OVERHEAD_S) / cycle;
  const meanHold = Math.min(CHECK_INTERVAL, hold) / 2;
  const meanRest = (rest + OVERHEAD_S) / 2 + OVERHEAD_S;
  const meanLatency = pHold * meanHold + pRest * meanRest;
  const worstLatency = Math.max(hold > 0 ? CHECK_INTERVAL : 0, rest + OVERHEAD_S * 2);
  return {
    profile: name,
    hold_s: hold,
    rest_s: rest,
    duty_pct: Math.round((inFlight / cycle) * 100),
    polls_per_day: Math.round(pollsPerDay),
    vercel_memory_usd_mo: memCost.toFixed(2),
    vercel_invocations_usd_mo: invCost.toFixed(2),
    vercel_cpu_usd_mo: cpuCost.toFixed(2),
    vercel_total_usd_mo: (memCost + invCost + cpuCost).toFixed(2),
    supabase_calls_per_day: Math.round(dbCallsPerDay),
    supabase_egress_gb_mo: egressGbMonth.toFixed(2),
    mean_latency_s: meanLatency.toFixed(1),
    worst_latency_s: worstLatency.toFixed(1),
  };
}

const rows = [
  model("pre-USAGE-1 (25 s hold, no rest)", { hold: 25, rest: 0 }),
  model("USAGE-1 today (25 s hold, 10 s rest)", { hold: 25, rest: 10 }),
  model("10 s hold, 25 s rest (roadmap idea)", { hold: 10, rest: 25 }),
  model("USAGE-4 quick (0 s hold, 10 s rest)", { hold: 0, rest: 10 }),
  model("USAGE-4 disabled speaker (0 s, 30 s rest)", { hold: 0, rest: 30 }),
  model("quick, 5 s rest (rejected: egress)", { hold: 0, rest: 5 }),
];
console.table(rows);
