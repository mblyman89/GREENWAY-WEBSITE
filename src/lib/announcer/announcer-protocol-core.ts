/**
 * src/lib/announcer/announcer-protocol-core.ts
 *
 * SLICE 28 — the wire protocol between a Raspberry Pi and this site.
 *
 * PURE. Request parsing, response shaping, and the small amount of arithmetic
 * the long-poll needs. No I/O, no database, no clock of its own.
 *
 * WHY THE PARSING LIVES HERE AND NOT IN THE ROUTE
 * -----------------------------------------------
 * The Pi is the one client of this system nobody can open a browser and debug.
 * It is a box on a shelf in a storage room. When it stops working, the only
 * evidence available is what the server said to it, so every refusal has to be
 * specific enough to act on, and every one of those refusals has to be provable
 * without standing in the storage room. That is what makes this a pure module
 * with self-tests rather than a pile of `if` statements inside a route handler.
 *
 * THE SHAPE OF THE CONVERSATION
 * -----------------------------
 * Four exchanges, each of which completes in well under the platform's 60
 * second function ceiling:
 *
 *   pair      once, at setup. Trades a short human-typed code for a permanent
 *             device id and key.
 *   poll      continuously, forever. Held open up to POLL_HOLD_SECONDS while
 *             the server waits for work.
 *   ack       after playing. Confirms delivery so the row retires.
 *   heartbeat when there is nothing else to say. Keeps the dot green.
 */

import {
  POLL_HOLD_SECONDS,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
} from "./announcer-core";

// ============================================================================
// 1. HEADERS
// ============================================================================

/**
 * Deliberately parallel to the register's `X-POS-Device-Id` /
 * `X-POS-Device-Key` pair (see src/app/api/pos/sync/route.ts). Same idea, same
 * discipline, different prefix so a mis-pointed device gets a clean 401
 * instead of accidentally authenticating against the wrong subsystem.
 */
export const DEVICE_ID_HEADER = "x-announcer-device-id";
export const DEVICE_KEY_HEADER = "x-announcer-device-key";

export type DeviceCredentials = { deviceId: string; deviceKey: string };

export type CredentialParse =
  | { ok: true; credentials: DeviceCredentials }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/**
 * Pull the credentials out of the headers.
 *
 * `getHeader` is passed in so this stays pure and testable — the route hands
 * it `(n) => req.headers.get(n)`.
 *
 * The two failure messages are different on purpose. "no id" almost always
 * means the config file on the Pi was never written; "no key" almost always
 * means it was written but truncated. Those are different fixes, and the
 * troubleshooting manual keys off exactly these two strings.
 */
export function parseCredentials(getHeader: (name: string) => string | null): CredentialParse {
  const rawId = getHeader(DEVICE_ID_HEADER) ?? "";
  const rawKey = getHeader(DEVICE_KEY_HEADER) ?? "";
  const id = rawId.trim();
  const key = rawKey.trim();
  if (id === "") {
    return { ok: false, error: "Missing device id. The Pi's config file is empty or was never written." };
  }
  if (!isUuidLike(id)) {
    return { ok: false, error: "Device id is not a valid id. Re-pair this speaker." };
  }
  if (key === "") {
    return { ok: false, error: "Missing device key. The Pi's config file is incomplete — re-pair this speaker." };
  }
  return { ok: true, credentials: { deviceId: id, deviceKey: key } };
}

// ============================================================================
// 2. PAIR
// ============================================================================

export type PairRequest = {
  code: string;
  /** What the Pi says about itself. Diagnostic only; never trusted. */
  agentInfo: Record<string, unknown>;
};

export type PairParse = { ok: true; request: PairRequest } | { ok: false; error: string };

/**
 * Agent info is free-form, self-reported, and only ever displayed. It is
 * capped and shallow-copied so a confused (or simply buggy) agent cannot post
 * a megabyte of nested JSON into a column the back office renders.
 */
export function sanitizeAgentInfo(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 20) break;
    if (typeof k !== "string" || k.length > 40) continue;
    if (typeof v === "string") {
      out[k] = v.length > 200 ? v.slice(0, 200) : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      continue; // drop nested objects and arrays entirely
    }
    count += 1;
  }
  return out;
}

export function parsePairRequest(body: unknown): PairParse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const code = normalizePairingCode(b.code);
  if (code.length !== PAIRING_CODE_LENGTH) {
    return {
      ok: false,
      error: `Pairing code must be ${PAIRING_CODE_LENGTH} characters. Check the code on the Announcer page.`,
    };
  }
  return { ok: true, request: { code, agentInfo: sanitizeAgentInfo(b.agentInfo) } };
}

/**
 * What the Pi gets back once. The device key appears in this response and
 * NOWHERE else, ever again — the server stores only a scrypt hash of it, the
 * same discipline pos_devices.provision_hash uses. If the Pi loses this
 * response, the speaker must be re-paired. That is the correct trade: it means
 * a database dump can never be turned into a working speaker credential.
 */
export type PairSuccess = {
  deviceId: string;
  deviceKey: string;
  deviceName: string;
  pollHoldSeconds: number;
};

// ============================================================================
// 3. POLL
// ============================================================================

/**
 * How long the SERVER should hold this particular poll open.
 *
 * The Pi may ask for a shorter hold — a Pi on a flaky mobile hotspot might
 * prefer 10 seconds so a dead connection is noticed sooner. It may never ask
 * for a longer one, because the ceiling is the platform's, not the Pi's, and a
 * request that outlives the function limit is truncated in a way that looks to
 * the agent exactly like an outage.
 *
 * A missing or nonsense value gets the default rather than an error. The Pi
 * should never fail to poll because it phrased the question badly.
 */
export function resolveHoldSeconds(requested: unknown): number {
  const n = typeof requested === "number" ? requested : Number.NaN;
  if (!Number.isFinite(n)) return POLL_HOLD_SECONDS;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > POLL_HOLD_SECONDS) return POLL_HOLD_SECONDS;
  return floored;
}

/** Cap on how many jobs one poll may take, so a backlog drains in order. */
export const MAX_JOBS_PER_POLL = 5;

export function resolveJobLimit(requested: unknown): number {
  const n = typeof requested === "number" ? requested : Number.NaN;
  if (!Number.isFinite(n)) return MAX_JOBS_PER_POLL;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_JOBS_PER_POLL) return MAX_JOBS_PER_POLL;
  return floored;
}

export type AnnouncerJob = {
  id: string;
  kind: "order" | "test";
  message: string;
  sound: string;
  volume: number;
  createdAt: string;
};

export type PollResponse = {
  jobs: AnnouncerJob[];
  /** Server time, so the agent can report clock skew instead of guessing. */
  serverTime: string;
  /** Echoed so the agent adapts if we ever change the hold. */
  pollHoldSeconds: number;
  /** Config the agent should apply immediately, e.g. after a settings change. */
  deviceName: string;
  enabled: boolean;
};

/**
 * Coerce a database row into a job the agent can act on.
 *
 * Returns null rather than throwing on a malformed row. One bad row must not
 * poison an entire poll — the shop would go silent because of a single typo in
 * a message field.
 */
export function toJob(row: unknown): AnnouncerJob | null {
  if (row === null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const kind = r.kind === "test" ? "test" : "order";
  const message = typeof r.message === "string" ? r.message : "";
  const sound = typeof r.sound === "string" && r.sound.trim() !== "" ? r.sound : "chime";
  const volumeRaw = r.volume;
  const volume = typeof volumeRaw === "number" && Number.isFinite(volumeRaw)
    ? Math.min(100, Math.max(0, Math.round(volumeRaw)))
    : 70;
  const createdAt = typeof r.created_at === "string" ? r.created_at : "";
  if (message.trim() === "") return null;
  return { id: String(id), kind, message, sound, volume, createdAt };
}

// ============================================================================
// 4. ACK
// ============================================================================

export type AckRequest = {
  /** Ids the agent successfully played. */
  played: string[];
  /** Ids it could not play, with the agent's own reason. */
  failed: { id: string; reason: string }[];
};

export type AckParse = { ok: true; request: AckRequest } | { ok: false; error: string };

/** No single ack may cover more than this, so a request body stays bounded. */
export const MAX_ACK_IDS = 50;

/**
 * Parse an ack.
 *
 * An empty ack is VALID and returns an empty result rather than an error. The
 * agent retries acks after a network failure, and a retry that finds nothing
 * left to confirm is normal operation, not a fault.
 */
export function parseAckRequest(body: unknown): AckParse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const b = body as Record<string, unknown>;

  const played: string[] = [];
  if (Array.isArray(b.played)) {
    for (const v of b.played) {
      if (played.length >= MAX_ACK_IDS) break;
      if (typeof v === "string" && v.trim() !== "") played.push(v.trim());
      else if (typeof v === "number" && Number.isFinite(v)) played.push(String(v));
    }
  }

  const failed: { id: string; reason: string }[] = [];
  if (Array.isArray(b.failed)) {
    for (const v of b.failed) {
      if (failed.length >= MAX_ACK_IDS) break;
      if (v === null || typeof v !== "object") continue;
      const rv = v as Record<string, unknown>;
      const id =
        typeof rv.id === "string" && rv.id.trim() !== ""
          ? rv.id.trim()
          : typeof rv.id === "number" && Number.isFinite(rv.id)
            ? String(rv.id)
            : null;
      if (id === null) continue;
      const reasonRaw = typeof rv.reason === "string" ? rv.reason.trim() : "";
      const reason = reasonRaw === "" ? "Agent did not say why." : reasonRaw.slice(0, 300);
      failed.push({ id, reason });
    }
  }

  return { ok: true, request: { played, failed } };
}

// ============================================================================
// 5. HEARTBEAT
// ============================================================================

export type HeartbeatRequest = { agentInfo: Record<string, unknown> };

export function parseHeartbeatRequest(body: unknown): HeartbeatRequest {
  // A heartbeat with no body at all is fine — its whole job is to be a beat.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { agentInfo: {} };
  }
  return { agentInfo: sanitizeAgentInfo((body as Record<string, unknown>).agentInfo) };
}

// ============================================================================
// 6. ERROR SHAPE
// ============================================================================

/**
 * Every error the agent can receive, in one place.
 *
 * `retryable` is the important field. The agent must know the difference
 * between "the internet blipped, try again in a second" and "your credentials
 * are wrong, retrying forever will never help and you should say so on the
 * status LED". Getting this wrong is how a device ends up hammering a dead
 * endpoint all night, or conversely giving up on a two-second outage.
 */
export type ProtocolError = {
  status: 400 | 401 | 404 | 409 | 429 | 503;
  error: string;
  retryable: boolean;
  /** What a human should do, if a human needs to do anything. */
  hint?: string;
};

export function unauthorized(error: string): ProtocolError {
  return {
    status: 401,
    error,
    // NOT retryable. A bad key is bad forever. The agent should stop hammering
    // and light its status LED so somebody re-pairs it.
    retryable: false,
    hint: "Re-run the installer on this Pi and pair it again from the Announcer page.",
  };
}

export function badRequest(error: string): ProtocolError {
  return { status: 400, error, retryable: false };
}

export function unavailable(error: string): ProtocolError {
  return {
    status: 503,
    error,
    // IS retryable. The database being briefly unreachable is exactly the case
    // the backoff exists for.
    retryable: true,
    hint: "Temporary. The speaker will reconnect by itself.",
  };
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runAnnouncerProtocolTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-protocol FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown): void => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-protocol FAIL: ${label} -> got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
    }
  };

  // ---- credentials -----------------------------------------------------
  const UID = "0f9a1c2d-3e4b-4a5c-8d7e-6f5a4b3c2d1e";
  const hdr = (m: Record<string, string>) => (n: string) => m[n] ?? null;

  const okCreds = parseCredentials(hdr({ [DEVICE_ID_HEADER]: UID, [DEVICE_KEY_HEADER]: "secret" }));
  check("creds: valid pair accepted", okCreds.ok);
  if (okCreds.ok) {
    eq("creds: id passed through", okCreds.credentials.deviceId, UID);
    eq("creds: key passed through", okCreds.credentials.deviceKey, "secret");
  }
  const trimmed = parseCredentials(hdr({ [DEVICE_ID_HEADER]: `  ${UID}  `, [DEVICE_KEY_HEADER]: "  s  " }));
  check("creds: whitespace trimmed", trimmed.ok && trimmed.credentials.deviceKey === "s");
  const noId = parseCredentials(hdr({ [DEVICE_KEY_HEADER]: "secret" }));
  check("creds: missing id rejected", !noId.ok);
  check("creds: missing-id message names the config file", !noId.ok && noId.error.toLowerCase().includes("config file"));
  const badId = parseCredentials(hdr({ [DEVICE_ID_HEADER]: "not-a-uuid", [DEVICE_KEY_HEADER]: "s" }));
  check("creds: malformed id rejected", !badId.ok);
  const noKey = parseCredentials(hdr({ [DEVICE_ID_HEADER]: UID }));
  check("creds: missing key rejected", !noKey.ok);
  check(
    "creds: missing id and missing key say DIFFERENT things",
    !noId.ok && !noKey.ok && noId.error !== noKey.error,
  );
  check("uuid: accepts a real one", isUuidLike(UID));
  check("uuid: rejects a short one", !isUuidLike("1234"));
  check("uuid: rejects a number", !isUuidLike(12345));
  check("uuid: rejects null", !isUuidLike(null));

  // ---- agent info ------------------------------------------------------
  eq("agent: non-object becomes empty", sanitizeAgentInfo("hello"), {});
  eq("agent: null becomes empty", sanitizeAgentInfo(null), {});
  eq("agent: array becomes empty", sanitizeAgentInfo([1, 2]), {});
  eq(
    "agent: scalars survive",
    sanitizeAgentInfo({ os: "Raspbian", version: 3, ok: true }),
    { os: "Raspbian", version: 3, ok: true },
  );
  eq("agent: nested objects are dropped", sanitizeAgentInfo({ a: { b: 1 } }), {});
  eq("agent: arrays inside are dropped", sanitizeAgentInfo({ a: [1] }), {});
  check(
    "agent: long strings are truncated to 200",
    (sanitizeAgentInfo({ s: "x".repeat(500) }).s as string).length === 200,
  );
  check("agent: caps at 20 keys", Object.keys(sanitizeAgentInfo(
    Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])),
  )).length === 20);
  check(
    "agent: absurdly long key is dropped",
    Object.keys(sanitizeAgentInfo({ ["k".repeat(100)]: 1 })).length === 0,
  );

  // ---- pair ------------------------------------------------------------
  const p1 = parsePairRequest({ code: "abcd-2345" });
  check("pair: lowercase dashed code accepted", p1.ok);
  if (p1.ok) eq("pair: code normalized", p1.request.code, "ABCD2345");
  check("pair: short code rejected", !parsePairRequest({ code: "ABC" }).ok);
  check("pair: missing code rejected", !parsePairRequest({}).ok);
  check("pair: non-object body rejected", !parsePairRequest("x").ok);
  check("pair: null body rejected", !parsePairRequest(null).ok);
  check("pair: array body rejected", !parsePairRequest([]).ok);
  const p2 = parsePairRequest({ code: "ABCD2345", agentInfo: { os: "Pi OS" } });
  check("pair: agent info carried", p2.ok && p2.request.agentInfo.os === "Pi OS");

  // ---- poll hold -------------------------------------------------------
  eq("hold: default when absent", resolveHoldSeconds(undefined), POLL_HOLD_SECONDS);
  eq("hold: default when garbage", resolveHoldSeconds("long"), POLL_HOLD_SECONDS);
  eq("hold: a shorter request is honoured", resolveHoldSeconds(10), 10);
  eq("hold: a LONGER request is capped at the ceiling", resolveHoldSeconds(300), POLL_HOLD_SECONDS);
  eq("hold: zero becomes one", resolveHoldSeconds(0), 1);
  eq("hold: negative becomes one", resolveHoldSeconds(-5), 1);
  eq("hold: fractional floors", resolveHoldSeconds(9.9), 9);
  check("hold: the cap can never exceed the platform ceiling", resolveHoldSeconds(9999) < 60);

  // ---- job limit -------------------------------------------------------
  eq("limit: default when absent", resolveJobLimit(undefined), MAX_JOBS_PER_POLL);
  eq("limit: 2 honoured", resolveJobLimit(2), 2);
  eq("limit: over the cap is capped", resolveJobLimit(500), MAX_JOBS_PER_POLL);
  eq("limit: zero becomes one", resolveJobLimit(0), 1);

  // ---- job coercion ----------------------------------------------------
  const goodRow = { id: 7, kind: "order", message: "New online order.", sound: "chime", volume: 80, created_at: "2026-03-10T12:00:00.000Z" };
  eq(
    "job: a good row converts",
    toJob(goodRow),
    { id: "7", kind: "order", message: "New online order.", sound: "chime", volume: 80, createdAt: "2026-03-10T12:00:00.000Z" },
  );
  check("job: null row is skipped, not thrown", toJob(null) === null);
  check("job: non-object row is skipped", toJob("x") === null);
  check("job: missing id is skipped", toJob({ ...goodRow, id: undefined }) === null);
  check("job: EMPTY message is skipped — a silent job is worse than none", toJob({ ...goodRow, message: "  " }) === null);
  const noSound = toJob({ ...goodRow, sound: "" });
  check("job: missing sound falls back rather than dropping the job", noSound !== null && noSound.sound === "chime");
  const badVol = toJob({ ...goodRow, volume: "loud" });
  check("job: bad volume falls back to 70, never 0", badVol !== null && badVol.volume === 70);
  const overVol = toJob({ ...goodRow, volume: 500 });
  check("job: over-range volume clamps to 100", overVol !== null && overVol.volume === 100);
  const negVol = toJob({ ...goodRow, volume: -20 });
  check("job: negative volume clamps to 0", negVol !== null && negVol.volume === 0);
  const testKind = toJob({ ...goodRow, kind: "test" });
  check("job: test kind survives", testKind !== null && testKind.kind === "test");
  const junkKind = toJob({ ...goodRow, kind: "wat" });
  check("job: unknown kind becomes 'order'", junkKind !== null && junkKind.kind === "order");

  // ---- ack -------------------------------------------------------------
  const a1 = parseAckRequest({ played: ["1", "2"], failed: [{ id: "3", reason: "no audio device" }] });
  check("ack: parses", a1.ok);
  if (a1.ok) {
    eq("ack: played ids", a1.request.played, ["1", "2"]);
    eq("ack: failed ids", a1.request.failed, [{ id: "3", reason: "no audio device" }]);
  }
  const a2 = parseAckRequest({});
  check("ack: an EMPTY ack is valid, not an error", a2.ok);
  if (a2.ok) {
    eq("ack: empty played", a2.request.played, []);
    eq("ack: empty failed", a2.request.failed, []);
  }
  const a3 = parseAckRequest({ played: [1, 2, null, "", "x"] });
  check("ack: numeric ids coerce and junk is dropped", a3.ok && JSON.stringify(a3.request.played) === JSON.stringify(["1", "2", "x"]));
  const a4 = parseAckRequest({ failed: [{ id: "9" }] });
  check("ack: a failure with no reason still records a reason", a4.ok && a4.request.failed[0].reason.length > 0);
  const a5 = parseAckRequest({ played: Array.from({ length: 500 }, (_, i) => String(i)) });
  check("ack: caps the id list", a5.ok && a5.request.played.length === MAX_ACK_IDS);
  const a6 = parseAckRequest({ failed: [{ id: "9", reason: "x".repeat(9999) }] });
  check("ack: caps a reason string", a6.ok && a6.request.failed[0].reason.length === 300);
  check("ack: non-object body rejected", !parseAckRequest("x").ok);
  check("ack: array body rejected", !parseAckRequest([]).ok);
  const a7 = parseAckRequest({ played: "not-an-array" });
  check("ack: a non-array played field degrades to empty rather than failing", a7.ok);

  // ---- heartbeat -------------------------------------------------------
  eq("heartbeat: empty body is fine", parseHeartbeatRequest(null), { agentInfo: {} });
  eq("heartbeat: string body is fine", parseHeartbeatRequest("x"), { agentInfo: {} });
  eq("heartbeat: agent info carried", parseHeartbeatRequest({ agentInfo: { v: 2 } }), { agentInfo: { v: 2 } });

  // ---- errors ----------------------------------------------------------
  check("error: 401 is NOT retryable — a bad key is bad forever", unauthorized("x").retryable === false);
  check("error: 401 tells a human what to do", (unauthorized("x").hint ?? "").length > 0);
  check("error: 503 IS retryable — an outage heals", unavailable("x").retryable === true);
  check("error: 503 reassures rather than alarms", (unavailable("x").hint ?? "").length > 0);
  check("error: 400 is not retryable", badRequest("x").retryable === false);
  eq("error: statuses are what they claim", [unauthorized("x").status, badRequest("x").status, unavailable("x").status], [401, 400, 503]);

  return { passed, failed };
}
