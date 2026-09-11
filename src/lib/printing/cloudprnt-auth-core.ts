/**
 * src/lib/printing/cloudprnt-auth-core.ts  (D-68)
 *
 * The ONE place that decides which secret a CloudPRNT request is carrying.
 *
 * THE DEFECT THIS FIXES
 * ---------------------
 * /api/cloudprnt carries TWO DIFFERENT secrets on the SAME `?token=` query
 * parameter:
 *
 *   1. the printer's shared POLL token -- AUTHENTICATION ("who are you?")
 *   2. the per-receipt JOB token       -- ADDRESSING     ("which receipt?")
 *
 * The original extractor read `?token=` first for BOTH purposes, so once a
 * poll token was configured (which S-9 forces in production) Star's own
 * protocol broke itself: the printer's `GET /api/cloudprnt?token=<JOB>` had
 * its JOB token compared against the POLL secret and 401'd. The printer kept
 * polling happily, kept being told a job was ready, and was locked out of
 * fetching the body every single time -- so the job sat in `printing`, was
 * re-claimed as stale every two minutes until it burned MAX_PRINT_ATTEMPTS,
 * was marked `failed`, and every later receipt queued behind it. Nothing ever
 * printed while the logs and the "printer online" heartbeat both looked fine.
 * Proof: scripts/recon/cloudprnt-token-collision.mjs.
 *
 * THE FIX
 * -------
 * Give the two secrets separate namespaces with OPPOSITE precedence, and put
 * that decision behind one dispatcher so a future endpoint cannot reinvent
 * the ordering and reintroduce the collision:
 *
 *   use "auth" -> Basic-auth password WINS, query token is the fallback.
 *                 Rationale: Star sends Basic auth on every request once it
 *                 is configured in the printer web UI, and it is the only
 *                 channel the printer NEVER overwrites with a job token. The
 *                 query fallback preserves support for firmware/setups that
 *                 authenticate with `?token=` and never send Basic at all.
 *
 *   use "job"  -> query token WINS, Basic-auth password is the fallback.
 *                 Rationale: `?token=<jobToken>` is exactly what our own POST
 *                 reply instructed the printer to send back. The Basic
 *                 fallback is inert in practice (a poll token will not match
 *                 any job) but keeps the old single-token behaviour working
 *                 for any client that put the job token in Basic auth.
 *
 * Because the two uses prefer different channels, a request carrying BOTH a
 * Basic-auth poll token and a `?token=<JOB>` query -- the normal Star case --
 * resolves each secret correctly and independently.
 *
 * PURE module: no I/O, no next/server, no supabase. Runs under
 * scripts/compliance/run-pure-selftests.ts.
 */

/**
 * Which secret the caller wants out of the request.
 * - "auth": the shared poll token used to authenticate the printer.
 * - "job":  the per-receipt job token used to address a queued receipt.
 */
export type CloudPrntTokenUse = "auth" | "job";

/** The two places a CloudPRNT secret can arrive. */
export type CloudPrntTokenSources = {
  /** Raw `Authorization` header value, or null when absent. */
  authorizationHeader: string | null | undefined;
  /** Raw `?token=` query-parameter value, or null when absent. */
  queryToken: string | null | undefined;
};

/** Decode base64 to a UTF-8 string in both Node and edge runtimes. */
function decodeBase64(value: string): string | null {
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      let out = "";
      for (let i = 0; i < binary.length; i += 1) {
        out += String.fromCharCode(binary.charCodeAt(i) & 0xff);
      }
      // Re-interpret the latin1 bytes as UTF-8 so non-ASCII passwords survive.
      return decodeURIComponent(
        out
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      );
    }
  } catch {
    // Fall through to Buffer / null below.
  }
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(value, "base64").toString("utf8");
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The password half of an HTTP Basic `Authorization` header, or null when the
 * header is absent, not Basic, undecodable, or carries an EMPTY password.
 *
 * An empty password returns null (not "") on purpose: callers use `??`
 * fallbacks, and `""` would shadow a perfectly good query token while also
 * never matching a real secret.
 */
export function basicAuthPassword(headerValue: string | null | undefined): string | null {
  const auth = (headerValue ?? "").trim();
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  const encoded = auth.slice(6).trim();
  if (!encoded) return null;
  const decoded = decodeBase64(encoded);
  if (decoded === null) return null;
  const idx = decoded.indexOf(":");
  // No colon at all: treat the whole payload as the secret (some minimal
  // clients base64 the bare token). With a colon, everything AFTER the first
  // one is the password -- passwords may legally contain colons.
  const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  return password.length > 0 ? password : null;
}

/** A trimmed query token, or null when absent/blank. */
function queryValue(queryToken: string | null | undefined): string | null {
  const q = (queryToken ?? "").trim();
  return q.length > 0 ? q : null;
}

/**
 * The shared POLL token being presented for AUTHENTICATION.
 * Basic-auth password wins; `?token=` is the fallback.
 */
export function authCredential(sources: CloudPrntTokenSources): string | null {
  return basicAuthPassword(sources.authorizationHeader) ?? queryValue(sources.queryToken);
}

/**
 * The per-receipt JOB token identifying which queued receipt to serve/confirm.
 * `?token=` wins; the Basic-auth password is the fallback.
 */
export function jobHandle(sources: CloudPrntTokenSources): string | null {
  return queryValue(sources.queryToken) ?? basicAuthPassword(sources.authorizationHeader);
}

/**
 * The ONE dispatcher. Route handlers must state WHICH secret they want, so
 * the precedence decision lives here instead of being re-guessed per call
 * site (that re-guessing is exactly what caused D-68).
 */
export function extractCloudPrntToken(
  use: CloudPrntTokenUse,
  sources: CloudPrntTokenSources,
): string | null {
  return use === "auth" ? authCredential(sources) : jobHandle(sources);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runCloudPrntAuthCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };
  const eq = (actual: unknown, expected: unknown, msg: string) => {
    ok(
      actual === expected,
      `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  };
  const basic = (user: string, pw: string) =>
    "Basic " + Buffer.from(`${user}:${pw}`, "utf8").toString("base64");

  const POLL = "poll-secret-abc123";
  const JOB = "job-9f3e1c77-2b4a-4d51-8e6f-0a1b2c3d4e5f";

  // --- basicAuthPassword -------------------------------------------------
  eq(basicAuthPassword(basic("printer", POLL)), POLL, "basic: password extracted");
  eq(basicAuthPassword(basic("", POLL)), POLL, "basic: empty username still yields password");
  eq(basicAuthPassword(null), null, "basic: null header -> null");
  eq(basicAuthPassword(undefined), null, "basic: undefined header -> null");
  eq(basicAuthPassword(""), null, "basic: empty header -> null");
  eq(basicAuthPassword("Bearer abc123"), null, "basic: Bearer scheme ignored");
  eq(basicAuthPassword("Basic"), null, "basic: scheme with no payload -> null");
  eq(basicAuthPassword("Basic    "), null, "basic: scheme with blank payload -> null");
  eq(basicAuthPassword(basic("printer", "")), null, "basic: EMPTY password -> null (not empty string)");
  eq(
    basicAuthPassword("basic " + Buffer.from(`printer:${POLL}`, "utf8").toString("base64")),
    POLL,
    "basic: scheme match is case-insensitive",
  );
  eq(
    basicAuthPassword("  Basic " + Buffer.from(`printer:${POLL}`, "utf8").toString("base64") + "  "),
    POLL,
    "basic: surrounding whitespace tolerated",
  );
  eq(
    basicAuthPassword("Basic " + Buffer.from("bare-token-no-colon", "utf8").toString("base64")),
    "bare-token-no-colon",
    "basic: payload without a colon treated as the whole secret",
  );
  eq(
    basicAuthPassword("Basic " + Buffer.from("printer:pw:with:colons", "utf8").toString("base64")),
    "pw:with:colons",
    "basic: password may contain colons (split on FIRST colon only)",
  );
  eq(
    basicAuthPassword("Basic " + Buffer.from("printer:pässwörd", "utf8").toString("base64")),
    "pässwörd",
    "basic: non-ASCII password decodes as UTF-8",
  );

  // --- authCredential: Basic WINS ----------------------------------------
  eq(
    authCredential({ authorizationHeader: basic("printer", POLL), queryToken: JOB }),
    POLL,
    "auth: Basic poll token wins over a ?token=<JOB> query (THE D-68 FIX)",
  );
  eq(
    authCredential({ authorizationHeader: null, queryToken: POLL }),
    POLL,
    "auth: falls back to query token when no Basic header",
  );
  eq(
    authCredential({ authorizationHeader: basic("printer", ""), queryToken: POLL }),
    POLL,
    "auth: empty Basic password falls through to query token",
  );
  eq(
    authCredential({ authorizationHeader: null, queryToken: null }),
    null,
    "auth: nothing supplied -> null",
  );
  eq(
    authCredential({ authorizationHeader: null, queryToken: "   " }),
    null,
    "auth: blank query token -> null",
  );
  eq(
    authCredential({ authorizationHeader: null, queryToken: `  ${POLL}  ` }),
    POLL,
    "auth: query token is trimmed",
  );

  // --- jobHandle: query WINS ---------------------------------------------
  eq(
    jobHandle({ authorizationHeader: basic("printer", POLL), queryToken: JOB }),
    JOB,
    "job: query job token wins over the Basic poll token (THE D-68 FIX)",
  );
  eq(
    jobHandle({ authorizationHeader: basic("printer", JOB), queryToken: null }),
    JOB,
    "job: falls back to Basic password when no query token",
  );
  eq(
    jobHandle({ authorizationHeader: null, queryToken: null }),
    null,
    "job: nothing supplied -> null",
  );
  eq(
    jobHandle({ authorizationHeader: null, queryToken: `  ${JOB}  ` }),
    JOB,
    "job: query token is trimmed",
  );
  eq(
    jobHandle({ authorizationHeader: null, queryToken: "   " }),
    null,
    "job: blank query token -> null",
  );

  // --- dispatcher --------------------------------------------------------
  const starRequest = { authorizationHeader: basic("printer", POLL), queryToken: JOB };
  eq(extractCloudPrntToken("auth", starRequest), POLL, "dispatch: 'auth' -> poll token");
  eq(extractCloudPrntToken("job", starRequest), JOB, "dispatch: 'job' -> job token");
  ok(
    extractCloudPrntToken("auth", starRequest) !== extractCloudPrntToken("job", starRequest),
    "dispatch: the two uses resolve to DIFFERENT secrets on one request",
  );

  // --- the full Star CloudPRNT 2.5.2 sequence ----------------------------
  // This is the regression that matters: replay what the printer actually
  // sends and assert auth succeeds at every step while the job token stays
  // addressable.
  const poll = { authorizationHeader: basic("printer", POLL), queryToken: null };
  const fetchBody = { authorizationHeader: basic("printer", POLL), queryToken: JOB };
  const confirm = { authorizationHeader: basic("printer", POLL), queryToken: JOB };
  eq(extractCloudPrntToken("auth", poll), POLL, "sequence: POST poll authenticates");
  eq(extractCloudPrntToken("auth", fetchBody), POLL, "sequence: GET body authenticates");
  eq(extractCloudPrntToken("job", fetchBody), JOB, "sequence: GET body resolves the job");
  eq(extractCloudPrntToken("auth", confirm), POLL, "sequence: DELETE confirm authenticates");
  eq(extractCloudPrntToken("job", confirm), JOB, "sequence: DELETE confirm resolves the job");

  // A query-token-only setup (no Basic at all) must still work end to end.
  const qOnlyPoll = { authorizationHeader: null, queryToken: POLL };
  eq(extractCloudPrntToken("auth", qOnlyPoll), POLL, "sequence: query-only auth still works");

  if (fail > 0) {
    throw new Error(`cloudprnt-auth-core self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`cloudprnt-auth-core: ${pass} self-tests passed`);
}
