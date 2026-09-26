/**
 * src/lib/printing/printer-heartbeat-core.ts
 *
 * PURE heartbeat-write throttle for the CloudPRNT receipt printer (USAGE-1).
 *
 * Background: the Pi printer agent polls /api/cloudprnt forever, and every
 * poll used to UPSERT `receipt_printer_settings` just to move `last_poll_at`
 * forward. At the old 3-second cadence that was ~28,800 writes a day to a
 * single row whose only consumer (`isPrinterOnline`) asks one question: "is
 * the stamp younger than 90 seconds?" A stamp refreshed every ~40 seconds
 * answers that question identically while doing a small fraction of the
 * writes, and every skipped write is one fewer Supabase round-trip and one
 * fewer response body counted against egress.
 *
 * Policy (all decisions live here so they are testable without a database):
 *  - Write when there is no current row, no stamp, or an unparseable stamp,
 *    so a fresh install turns green on its very first poll.
 *  - Write whenever the printer reports a DIFFERENT MAC or status code than
 *    the one stored, so the Equipment page never shows a stale status.
 *  - Otherwise write only when the stored stamp is at least
 *    PRINTER_HEARTBEAT_WRITE_INTERVAL_MS old. A stamp in the future (clock
 *    skew) is treated as fresh and skipped, since rewriting it would only
 *    move it back.
 *
 * No imports; embedded self-tests follow the repo's pure-core pattern.
 */

/** Minimum age of the stored `last_poll_at` before another write is made. */
export const PRINTER_HEARTBEAT_WRITE_INTERVAL_MS = 40 * 1000;

/** The online window `isPrinterOnline` uses. Pinned here for the safety proof. */
export const PRINTER_ONLINE_WINDOW_MS = 90 * 1000;

export type PrinterHeartbeatSnapshot = {
  last_poll_at: string | null;
  printer_mac: string | null;
  last_status_code: string | null;
};

export function shouldWritePrinterHeartbeat(input: {
  current: PrinterHeartbeatSnapshot | null;
  printerMac: string | null;
  statusCode: string | null;
  nowMs: number;
}): boolean {
  const { current } = input;
  if (!current) return true;
  if (input.printerMac && input.printerMac !== current.printer_mac) return true;
  if (input.statusCode && input.statusCode !== current.last_status_code) return true;
  if (!current.last_poll_at) return true;
  const t = new Date(current.last_poll_at).getTime();
  if (Number.isNaN(t)) return true;
  const age = input.nowMs - t;
  if (age < 0) return false;
  return age >= PRINTER_HEARTBEAT_WRITE_INTERVAL_MS;
}

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runPrinterHeartbeatCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`printer-heartbeat-core self-test failed: ${name}`);
  };

  const NOW = Date.parse("2026-03-10T12:00:00.000Z");
  const stamp = (agoMs: number) => new Date(NOW - agoMs).toISOString();
  const row = (agoMs: number, mac = "00:11:22:33:44:55", code = "200 OK"): PrinterHeartbeatSnapshot => ({
    last_poll_at: stamp(agoMs),
    printer_mac: mac,
    last_status_code: code,
  });
  const same = { printerMac: "00:11:22:33:44:55", statusCode: "200 OK", nowMs: NOW };

  // Pinned policy values and the safety proof against the online window.
  ok("interval is 40s", PRINTER_HEARTBEAT_WRITE_INTERVAL_MS === 40_000);
  ok("online window is 90s", PRINTER_ONLINE_WINDOW_MS === 90_000);
  ok(
    "two skipped intervals still fit inside the online window",
    PRINTER_HEARTBEAT_WRITE_INTERVAL_MS * 2 < PRINTER_ONLINE_WINDOW_MS,
  );

  // Always write when there is nothing to compare against.
  ok("no row -> write", shouldWritePrinterHeartbeat({ current: null, ...same }) === true);
  ok(
    "null stamp -> write",
    shouldWritePrinterHeartbeat({ current: { ...row(0), last_poll_at: null }, ...same }) === true,
  );
  ok(
    "garbage stamp -> write",
    shouldWritePrinterHeartbeat({ current: { ...row(0), last_poll_at: "yesterday" }, ...same }) === true,
  );

  // Throttle on age when nothing else changed.
  ok("3s old -> skip", shouldWritePrinterHeartbeat({ current: row(3_000), ...same }) === false);
  ok("39.9s old -> skip", shouldWritePrinterHeartbeat({ current: row(39_999), ...same }) === false);
  ok("exactly 40s old -> write", shouldWritePrinterHeartbeat({ current: row(40_000), ...same }) === true);
  ok("2 min old -> write", shouldWritePrinterHeartbeat({ current: row(120_000), ...same }) === true);
  ok("future stamp -> skip", shouldWritePrinterHeartbeat({ current: row(-5_000), ...same }) === false);

  // Changed identity/status always writes, even on a fresh stamp.
  ok(
    "new MAC -> write",
    shouldWritePrinterHeartbeat({ current: row(1_000), ...same, printerMac: "aa:bb:cc:dd:ee:ff" }) === true,
  );
  ok(
    "new status code -> write",
    shouldWritePrinterHeartbeat({ current: row(1_000), ...same, statusCode: "200 OK PaperLow" }) === true,
  );
  ok(
    "first MAC ever (row has null) -> write",
    shouldWritePrinterHeartbeat({ current: row(1_000, null as unknown as string), ...same }) === true,
  );

  // Missing report values never count as a change.
  ok(
    "printer sent no MAC/status, fresh stamp -> skip",
    shouldWritePrinterHeartbeat({ current: row(1_000), printerMac: null, statusCode: null, nowMs: NOW }) === false,
  );
  ok(
    "printer sent no MAC/status, old stamp -> write",
    shouldWritePrinterHeartbeat({ current: row(50_000), printerMac: null, statusCode: null, nowMs: NOW }) === true,
  );
}
