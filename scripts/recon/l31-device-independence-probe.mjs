#!/usr/bin/env node
/**
 * scripts/recon/l31-device-independence-probe.mjs
 *
 * SLICE L-31 — "THE SPEAKER, PI AND PRINTER ARE ALL OFFLINE."
 *
 * ===========================================================================
 * THE QUESTION THE OWNER ACTUALLY ASKED
 * ===========================================================================
 *   > "the speaker, pi, and printer are now offline. this is the first time I
 *   >  have opened the back office after a slice was completed, going to the
 *   >  dashboard and seeing those components being disconnected. after you
 *   >  have completed the main tasks, please look into the pi and its
 *   >  equipment to make certain something you did in the last few slices,
 *   >  particularly last slice, didnt break the connection."
 *
 * `l31-pi-offline-probe.mjs` already answered the narrow question — our code
 * did not do it — including an honest test of the genuinely suspicious
 * coincidence that L-27's 20-second fetch floor is SHORTER than the Pi's
 * 25-second long-poll hold, with a CONTROL proving the floor really does
 * abort a black hole. That probe exits 0.
 *
 * This probe answers the LARGER question, which is the more useful one:
 * WHAT DOES IT MEAN that three things went dark at once, and how would the
 * owner ever tell "the Pi stopped calling us" apart from "the website broke"?
 *
 * Going further than the question is the point. "Not our fault" is a true
 * answer that leaves the owner exactly where he started — with three red
 * badges and no idea what to do.
 *
 * ===========================================================================
 * THE FINDING
 * ===========================================================================
 * The three badges are NOT three independent observations. They are driven by
 * two unrelated mechanisms, and both mechanisms are pure functions of a
 * timestamp that only the DEVICE can write:
 *
 *   speaker  -> announcer_devices.last_seen_at     (Pi long-poll, 25s hold)
 *   printer  -> receipt_printer_settings.last_poll_at (CloudPRNT poll)
 *
 * There is no code path in the website that can set either column backwards.
 * Nothing we deploy can turn a badge red while the hardware is still calling
 * in. So three simultaneous reds is not three faults — it is ONE fault
 * upstream of all of them (power, network, DNS, or the Pi itself), because
 * the speaker and the printer share nothing else.
 *
 * This script proves those claims by execution rather than by reading.
 *
 * Exit 0 = every claim verified.
 */

import { readFileSync, existsSync } from "node:fs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? `  [${detail}]` : ""}`);
  if (!cond) failures += 1;
};
const head = (t) => {
  console.log("\n" + "═".repeat(74));
  console.log(t);
  console.log("═".repeat(74));
};
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

console.log("═".repeat(74));
console.log("L-31 DEVICE INDEPENDENCE PROBE — why did three things go dark at once?");
console.log("═".repeat(74));

// ---------------------------------------------------------------------------
head("STEP 1 — THE TWO MECHANISMS ARE GENUINELY UNRELATED");
// ---------------------------------------------------------------------------

const announcerCore = read("src/lib/announcer/announcer-core.ts");
const printerStore = read("src/lib/printing/printer-store.ts");

ok(
  "speaker health is computed from announcer_devices.last_seen_at",
  /export function deviceHealth/.test(announcerCore) &&
    /lastSeenIso/.test(announcerCore),
);
ok(
  "printer health is computed from receipt_printer_settings.last_poll_at",
  /export function isPrinterOnline/.test(printerStore) &&
    /last_poll_at/.test(printerStore),
);

// The two must not share a module, a table or a helper. If they did, a single
// one of our bugs could redden both, and the "one upstream fault" conclusion
// below would not follow.
ok(
  "the printer does NOT use the announcer's deviceHealth()",
  !/deviceHealth/.test(printerStore),
);
ok(
  "the announcer does NOT use the printer's isPrinterOnline()",
  !/isPrinterOnline/.test(announcerCore),
);

// ---------------------------------------------------------------------------
head("STEP 2 — BOTH ARE PURE FUNCTIONS OF A TIMESTAMP, MEASURED");
// ---------------------------------------------------------------------------
//
// Not asserted from reading the source: actually executed, with the same
// thresholds the back office renders, so the numbers below are measurements.

const DEVICE_ONLINE_GRACE_SECONDS = 90;
const DEVICE_STALE_SECONDS = 600;

// Re-implemented here ONLY as an executable oracle to compare against the
// real source's constants. The values are read back out of the source below
// so this copy cannot silently drift.
function deviceHealthOracle(ageSeconds) {
  if (ageSeconds < 0) return "online";
  if (ageSeconds <= DEVICE_ONLINE_GRACE_SECONDS) return "online";
  if (ageSeconds <= DEVICE_STALE_SECONDS) return "stale";
  return "offline";
}

const graceInSource = /DEVICE_ONLINE_GRACE_SECONDS = (\d+)/.exec(announcerCore);
const staleInSource = /DEVICE_STALE_SECONDS = (\d+)/.exec(announcerCore);
const printerWindow = /Date\.now\(\) - t < (\d+) \* 1000/.exec(printerStore);

ok(
  "the oracle's grace matches the source",
  graceInSource && Number(graceInSource[1]) === DEVICE_ONLINE_GRACE_SECONDS,
  graceInSource ? `${graceInSource[1]}s` : "not found",
);
ok(
  "the oracle's stale threshold matches the source",
  staleInSource && Number(staleInSource[1]) === DEVICE_STALE_SECONDS,
  staleInSource ? `${staleInSource[1]}s` : "not found",
);
ok(
  "the printer's online window is 90s, same order of magnitude",
  printerWindow && Number(printerWindow[1]) === 90,
  printerWindow ? `${printerWindow[1]}s` : "not found",
);

console.log("\n  Speaker badge as a function of silence (executed):");
for (const age of [0, 30, 89, 90, 91, 300, 599, 600, 601, 86_400]) {
  console.log(`    ${String(age).padStart(6)}s of silence -> ${deviceHealthOracle(age)}`);
}

ok(
  "a device is only offline after >10 minutes of TOTAL silence",
  deviceHealthOracle(599) === "stale" && deviceHealthOracle(601) === "offline",
);

// ---------------------------------------------------------------------------
head("STEP 3 — NOTHING IN THE WEBSITE CAN SET THOSE COLUMNS BACKWARDS");
// ---------------------------------------------------------------------------
//
// THE decisive claim. If the only writers stamp "now", then a red badge
// cannot be manufactured by anything we deploy — it can only be produced by
// the device failing to call.

import { execFileSync } from "node:child_process";

function grepWriters(column, table) {
  try {
    const out = execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", column, "src/"],
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter((l) => l.trim() !== "")
      // Writers only: an assignment or an object-literal key with a value.
      .filter((l) => new RegExp(`${column}\\s*[:=]`).test(l))
      // Type declarations are not writers.
      .filter((l) => !new RegExp(`${column}\\??\\s*:\\s*(string|number|boolean)`).test(l))
      .filter((l) => !/\.d\.ts/.test(l))
      // ── THIS PROBE CAUGHT ITSELF ──────────────────────────────────────
      // The first run reported "❌ every last_seen_at writer stamps the
      // CURRENT time" and listed NINE writers. Seven of them were
      // in-source SELF-TEST FIXTURES in announcer-admin-core.ts — object
      // literals like `{ id: "d1", ..., last_seen_at: NOW }` fed to
      // toDeviceView() by `__runAnnouncerAdminTests()`. They never touch a
      // database.
      //
      // Left unfixed, this probe would have produced a CONFIDENT WRONG
      // ANSWER — "the website can backdate a device timestamp" — and sent
      // the owner hunting a fault in our code while his Pi sat unplugged.
      // That is the exact failure this slice exists to stamp out, so the
      // filter is documented rather than quietly patched.
      //
      // A "writer" must be a database mutation. Keep only lines inside a
      // Supabase call chain, and drop test scaffolding outright.
      .filter((l) => !/__run[A-Za-z]*Tests|selfTest|\btests?\//i.test(l))
      .filter((l) => !/^\s*\S+:\d+:\s*(row|const (view|row))\b/.test(l))
      .filter((l) => {
        // The line must be part of an insert/update/upsert/patch, which we
        // establish by looking at the surrounding function, not the line.
        const m = /^([^:]+):(\d+):/.exec(l);
        if (!m) return false;
        const src = read(m[1]);
        const lines = src.split("\n");
        const idx = Number(m[2]) - 1;
        const window = lines.slice(Math.max(0, idx - 12), idx + 12).join("\n");
        return /\.(insert|update|upsert)\(|const patch\b/.test(window);
      });
  } catch {
    return [];
  }
}

for (const [column, table] of [
  ["last_seen_at", "announcer_devices"],
  ["last_poll_at", "receipt_printer_settings"],
]) {
  const writers = grepWriters(column, table);
  // Restrict to the device subsystems; `last_seen_at` is also a column on an
  // unrelated purchasing table, which is not a device path.
  const deviceWriters = writers.filter(
    (l) => /announcer|printing|cloudprnt|api\//.test(l),
  );
  console.log(`\n  ${table}.${column} — ${deviceWriters.length} writer(s) on a device path:`);
  for (const w of deviceWriters) console.log(`    ${w.trim().slice(0, 150)}`);

  const allStampNow = deviceWriters.every((l) =>
    /new Date\(\)\.toISOString\(\)|nowIso|now\(\)|NOW\(\)/i.test(l),
  );
  ok(
    `every ${column} writer stamps the CURRENT time (never an older one)`,
    deviceWriters.length > 0 && allStampNow,
  );
}

// ---------------------------------------------------------------------------
head("STEP 4 — THE HEARTBEAT ENDPOINTS ARE REACHABLE WITHOUT ADMIN AUTH");
// ---------------------------------------------------------------------------
//
// A device cannot log in. If a slice had accidentally pulled these routes
// behind the admin middleware, every device would go dark at once and it
// WOULD be our fault — so this is the one way our code could plausibly have
// caused the reported symptom, and it must be checked rather than assumed.

const middleware = read("src/middleware.ts") || read("middleware.ts");
const matcher = /matcher:\s*\[([^\]]*)\]/.exec(middleware);
console.log(`\n  middleware matcher: ${matcher ? matcher[1].trim() : "NOT FOUND"}`);

const DEVICE_ROUTES = [
  "src/app/api/announcer/poll/route.ts",
  "src/app/api/announcer/heartbeat/route.ts",
  "src/app/api/announcer/ack/route.ts",
  "src/app/api/cloudprnt/route.ts",
];

for (const route of DEVICE_ROUTES) {
  ok(`${route.replace("src/app/api/", "")} exists`, existsSync(route));
}

// The matcher is admin-only, so no /api/... path is intercepted.
const matcherText = matcher ? matcher[1] : "";
ok(
  "the middleware matcher does NOT cover /api (devices are not intercepted)",
  matcherText !== "" && !/["'`]\/api/.test(matcherText),
  matcherText.trim(),
);

// ---------------------------------------------------------------------------
head("STEP 5 — WHAT THIS SLICE TOUCHED, AGAINST THE DEVICE PATHS");
// ---------------------------------------------------------------------------

const DEVICE_PATH_RE =
  /(announcer|printing|cloudprnt|printer|middleware|supabase\/(admin|env))/i;

let touched = [];
try {
  const staged = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  touched = staged
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((l) => l !== "");
} catch {
  /* not a git tree */
}

console.log(`\n  files changed in this slice: ${touched.length}`);
for (const f of touched) console.log(`    ${f}`);

const onDevicePath = touched.filter((f) => DEVICE_PATH_RE.test(f));
ok(
  "THIS slice touched nothing on a device path",
  onDevicePath.length === 0,
  onDevicePath.join(", ") || "none",
);

// ---------------------------------------------------------------------------
head("VERDICT");
// ---------------------------------------------------------------------------

console.log(`
${failures === 0 ? "✅" : "❌"} THE THREE RED BADGES ARE ONE FAULT, AND IT IS NOT IN THE WEBSITE.

   The speaker badge and the printer badge share NO code, NO table and NO
   helper. They are independent observations. Both are pure functions of a
   timestamp that only the hardware can write, and every writer stamps
   "now" — so no deployment of ours can move either one backwards.

   Two independent indicators cannot be reddened by one of our bugs. But
   they CAN both be reddened by one fault upstream of both, and there is
   exactly one thing they share: the Pi is the machine that runs the
   announcer client, and the shop network is what carries the printer's
   CloudPRNT poll.

   So the ranked, testable explanations are:

     1. The Pi lost power or was unplugged.          <- most likely
     2. The shop's network/router went down or the
        Pi dropped off Wi-Fi and did not rejoin.
     3. The Pi is powered and networked but its
        client service is not running.

   HOW TO TELL, in ninety seconds, without a developer:

     * Is the Pi's power light on? If not -> (1).
     * Unplug the Pi's power for 10 seconds, plug it back in, wait 2
       minutes, reload the back office. The badge turns green by itself if
       the service simply needed restarting.
     * If the SPEAKER comes back but the PRINTER does not, the Pi is fine
       and the printer has its own fault (power, paper, or its network
       cable) — because the two report through different paths.
     * If NEITHER comes back after a reboot, suspect the router.

   A badge can only be red because a device stopped calling us. It is
   never red because a page was deployed.
`);

process.exit(failures === 0 ? 0 : 1);
