/**
 * src/lib/pos/device-heartbeat-core.ts
 *
 * PURE heartbeat-write throttle for register devices (USAGE-3).
 *
 * Background: `authenticateDevice` (sync-store) runs on EVERY register API
 * call — the 15-second interrupt poll, the 45-second pickup-badge poll, every
 * flush, every lookup — and used to follow the credential check with an
 * unconditional `UPDATE pos_devices SET last_seen_at = now()`. One register
 * left on the home screen therefore produced ~5,760 heartbeat writes a day
 * per register purely from the interrupt poll, each one a Supabase
 * round-trip plus a response body counted against egress. Nothing reads
 * `pos_devices.last_seen_at` at sub-minute resolution (the Devices page shows
 * `last_synced_at`; no SQL consumes the column), so a stamp refreshed about
 * once a minute carries the same information.
 *
 * Policy (all decisions live here so they are testable without a database):
 *  - Write when there is no stamp or an unparseable stamp, so a freshly
 *    provisioned device gets a heartbeat on its very first call.
 *  - Otherwise write only when the stored stamp is at least
 *    DEVICE_HEARTBEAT_WRITE_INTERVAL_MS old. A stamp in the future (clock
 *    skew) is treated as fresh and skipped, since rewriting it would only
 *    move it back.
 *
 * No imports; embedded self-tests follow the repo's pure-core pattern.
 */

/** Minimum age of the stored `last_seen_at` before another write is made. */
export const DEVICE_HEARTBEAT_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * The register's fastest recurring authenticated call (RegisterShell interrupt
 * poll). Pinned so the self-test can prove the throttle still yields a fresh
 * stamp at least once per interval on an idle register.
 */
export const REGISTER_FASTEST_POLL_MS = 15 * 1000;

export function shouldWriteDeviceHeartbeat(input: { lastSeenAt: string | null; nowMs: number }): boolean {
  if (!input.lastSeenAt) return true;
  const t = new Date(input.lastSeenAt).getTime();
  if (Number.isNaN(t)) return true;
  const age = input.nowMs - t;
  if (age < 0) return false;
  return age >= DEVICE_HEARTBEAT_WRITE_INTERVAL_MS;
}

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runDeviceHeartbeatCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`device-heartbeat-core self-test failed: ${name}`);
  };

  const NOW = Date.parse("2026-03-10T12:00:00.000Z");
  const stamp = (agoMs: number) => new Date(NOW - agoMs).toISOString();

  ok("interval is 60s", DEVICE_HEARTBEAT_WRITE_INTERVAL_MS === 60_000);
  ok("fastest register poll pinned at 15s", REGISTER_FASTEST_POLL_MS === 15_000);
  ok(
    "an idle register still refreshes its stamp at least every interval + one poll",
    DEVICE_HEARTBEAT_WRITE_INTERVAL_MS + REGISTER_FASTEST_POLL_MS <= 75_000,
  );

  ok("null stamp -> write", shouldWriteDeviceHeartbeat({ lastSeenAt: null, nowMs: NOW }) === true);
  ok("empty stamp -> write", shouldWriteDeviceHeartbeat({ lastSeenAt: "", nowMs: NOW }) === true);
  ok("garbage stamp -> write", shouldWriteDeviceHeartbeat({ lastSeenAt: "yesterday", nowMs: NOW }) === true);

  ok("1s old -> skip", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(1_000), nowMs: NOW }) === false);
  ok("15s old -> skip", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(15_000), nowMs: NOW }) === false);
  ok("59.9s old -> skip", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(59_999), nowMs: NOW }) === false);
  ok("exactly 60s old -> write", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(60_000), nowMs: NOW }) === true);
  ok("10 min old -> write", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(600_000), nowMs: NOW }) === true);
  ok("future stamp -> skip", shouldWriteDeviceHeartbeat({ lastSeenAt: stamp(-5_000), nowMs: NOW }) === false);

  // Simulated idle register: 15 s interrupt poll for 5 minutes writes 5 times, not 20.
  let last: string | null = null;
  let writes = 0;
  for (let i = 0; i < 20; i++) {
    const now = NOW + i * REGISTER_FASTEST_POLL_MS;
    if (shouldWriteDeviceHeartbeat({ lastSeenAt: last, nowMs: now })) {
      writes += 1;
      last = new Date(now).toISOString();
    }
  }
  ok(`20 polls over 5 min -> 5 writes (got ${writes})`, writes === 5);
}
