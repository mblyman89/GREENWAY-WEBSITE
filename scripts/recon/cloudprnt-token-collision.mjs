/**
 * scripts/recon/cloudprnt-token-collision.mjs  (D-68 proof)
 *
 * PROOF, not opinion. This script reproduces the /api/cloudprnt token
 * extractor and auth check VERBATIM (old + new) and replays the real Star
 * CloudPRNT 2.5.2 request sequence against both, so the defect and the fix
 * are both demonstrable without a database, a server, or a printer.
 *
 * THE DEFECT
 * ----------
 * /api/cloudprnt carries TWO DIFFERENT SECRETS on the SAME `?token=` query
 * parameter:
 *
 *   1. the printer's shared POLL token  (authentication -- "who are you?")
 *   2. the per-receipt JOB token        (addressing     -- "which receipt?")
 *
 * The old extractor read `?token=` FIRST for both purposes. So the moment a
 * poll token is configured (which S-9 forces in production), Star's own
 * protocol breaks itself:
 *
 *   POST   /api/cloudprnt                  -> Basic auth only        -> 200 OK
 *   GET    /api/cloudprnt?token=<JOB>      -> query wins over Basic  -> 401
 *   DELETE /api/cloudprnt?token=<JOB>      -> query wins over Basic  -> 401
 *
 * Consequence chain (why this is silent and total):
 *   printer polls happily -> is told a job is ready -> is locked out of
 *   fetching the body -> job stays `printing` -> re-claimed as stale every
 *   2 min -> burns all MAX_PRINT_ATTEMPTS -> marked `failed` -> every later
 *   receipt queues behind it -> NOTHING EVER PRINTS, while the logs and the
 *   admin "printer online" heartbeat both look perfectly healthy.
 *
 * Run:  node scripts/recon/cloudprnt-token-collision.mjs
 * Exit: 0 when the NEW logic passes all three steps AND the OLD logic is
 *       still shown to fail (i.e. the proof is intact). Non-zero otherwise.
 */

const POLL_TOKEN = "poll-secret-abc123";
const JOB_TOKEN = "job-9f3e1c77-2b4a-4d51-8e6f-0a1b2c3d4e5f";

/** HTTP Basic header for the poll token, exactly as Star firmware sends it. */
function basicHeader(password) {
  return "Basic " + Buffer.from(`printer:${password}`, "utf8").toString("base64");
}

// ---------------------------------------------------------------------------
// OLD logic -- copied verbatim from route.ts before the D-68 fix.
// ---------------------------------------------------------------------------

function extractTokenOld({ authorizationHeader, queryToken }) {
  const q = queryToken;
  if (q) return q;
  const auth = authorizationHeader ?? "";
  if (auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch {
      return null;
    }
  }
  return null;
}

/** OLD: auth token and job handle came from the SAME extractor. */
const oldLogic = {
  auth: (req) => extractTokenOld(req),
  job: (req) => req.queryToken || extractTokenOld(req),
};

// ---------------------------------------------------------------------------
// NEW logic -- mirrors src/lib/printing/cloudprnt-auth-core.ts. Two namespaces
// with OPPOSITE precedence: auth prefers Basic, job prefers query.
// ---------------------------------------------------------------------------

function basicAuthPasswordNew(headerValue) {
  const auth = headerValue ?? "";
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    return password.length > 0 ? password : null;
  } catch {
    return null;
  }
}

const newLogic = {
  auth: (req) => basicAuthPasswordNew(req.authorizationHeader) ?? (req.queryToken?.trim() || null),
  job: (req) => (req.queryToken?.trim() || null) ?? basicAuthPasswordNew(req.authorizationHeader),
};

// ---------------------------------------------------------------------------
// The auth check, verbatim from authFail(): constant-time compare vs expected.
// ---------------------------------------------------------------------------

function authorized(logic, req, expected) {
  const provided = logic.auth(req);
  if (!provided || !expected) return false;
  return provided === expected; // timingSafeEqualStr equivalent for this proof
}

/**
 * The real Star CloudPRNT 2.5.2 sequence. Star sends Basic auth on EVERY
 * request (it is configured once in the printer web UI) and appends
 * ?token=<jobToken> to the GET and DELETE, because that is what our own POST
 * reply told it to do via `jobToken`.
 */
const SEQUENCE = [
  {
    step: "POST poll",
    detail: "Basic auth only",
    req: { authorizationHeader: basicHeader(POLL_TOKEN), queryToken: null },
    wantJobHandle: null,
  },
  {
    step: "GET  body",
    detail: "Basic auth + ?token=<JOB>",
    req: { authorizationHeader: basicHeader(POLL_TOKEN), queryToken: JOB_TOKEN },
    wantJobHandle: JOB_TOKEN,
  },
  {
    step: "DELETE conf",
    detail: "Basic auth + ?token=<JOB>",
    req: { authorizationHeader: basicHeader(POLL_TOKEN), queryToken: JOB_TOKEN },
    wantJobHandle: JOB_TOKEN,
  },
];

function replay(label, logic) {
  console.log(`\n--- ${label} ---`);
  let allowed = 0;
  let rejected = 0;
  let wrongHandle = 0;

  for (const { step, detail, req, wantJobHandle } of SEQUENCE) {
    const ok = authorized(logic, req, POLL_TOKEN);
    const handle = wantJobHandle === null ? null : logic.job(req);
    const handleOk = handle === wantJobHandle;
    if (ok) allowed += 1;
    else rejected += 1;
    if (!handleOk) wrongHandle += 1;

    const flag = ok ? "200 allowed " : "401 REJECTED";
    const note = ok ? (handleOk ? "(as expected)" : "(*** WRONG JOB HANDLE ***)") : "(*** MISMATCH ***)";
    console.log(`  ${flag}  ${step}  (${detail})  ${note}`);
  }
  return { allowed, rejected, wrongHandle };
}

const oldResult = replay("OLD extractor (pre-D-68-fix)", oldLogic);
const newResult = replay("NEW cloudprnt-auth-core (post-fix)", newLogic);

console.log("\n=== VERDICT ===");
let failures = 0;

// The proof is only meaningful if the OLD logic really does break.
if (oldResult.rejected !== 2) {
  console.log(`FAIL: expected OLD logic to 401 the GET and DELETE (2 rejects), got ${oldResult.rejected}`);
  failures += 1;
} else {
  console.log("OK  : OLD logic rejects the GET + DELETE => D-68 reproduced (printer could never fetch a receipt).");
}

// The fix must allow all three AND hand back the right job token.
if (newResult.rejected !== 0) {
  console.log(`FAIL: NEW logic still rejects ${newResult.rejected} request(s)`);
  failures += 1;
} else {
  console.log("OK  : NEW logic allows all three protocol steps.");
}
if (newResult.wrongHandle !== 0) {
  console.log(`FAIL: NEW logic resolved ${newResult.wrongHandle} job handle(s) incorrectly`);
  failures += 1;
} else {
  console.log("OK  : NEW logic resolves the per-receipt job token on GET + DELETE.");
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nD-68 proof intact: defect reproduced, fix verified.");
