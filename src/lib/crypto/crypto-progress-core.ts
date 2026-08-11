/**
 * src/lib/crypto/crypto-progress-core.ts — PURE backfill-progress model.
 *
 * Michael asked to SEE how far a wallet's history backfill has gotten, with a
 * progress bar where one is honestly possible, and to know whether the system
 * is making progress or stuck looping. This module turns a wallet's stored
 * sync-state (cursor, target, previous cursor, tx count, status, complete flag)
 * into a truthful `BackfillProgressView` the UI can render.
 *
 * HONESTY RULES (never guess):
 *   • EVM chains (ethereum / flare / songbird) paginate by BLOCK NUMBER and walk
 *     genesis → chain tip. When we know the tip (`targetCursor`), a TRUE percent
 *     is computable and we render a real progress bar.
 *   • XRPL paginates by an OPAQUE account_tx marker (walked newest → oldest). The
 *     marker carries a `ledger` index, so we can honestly say "reached back to
 *     ledger N" — but there is NO clean percent, so we NEVER fabricate one.
 *   • Coreum paginates by an OPAQUE next_key per stream — no numeric position at
 *     all. We show phase + transaction count only. NEVER a fake percent.
 *
 * MOVEMENT / STUCK DETECTION: a wallet is only "stalled" if, across runs, the
 * cursor did NOT advance while the backfill is still incomplete and not errored.
 * We detect that by comparing the current cursor to the PREVIOUS run's cursor
 * (`prevCursor`). Otherwise it is "progressing", "complete", "idle", or "error".
 *
 * All math is exact integer math (Number is only used for block indices, which
 * are safe integers well under 2^53 on every chain we support). No floats touch
 * a money figure here — this module handles progress display only, never value.
 *
 * PURE: no `server-only`, no I/O. Unit-tested via `__runCryptoProgressCoreTests`
 * (wired into run-pure-selftests + a vitest mirror).
 */

import { isEvmChain, isCosmosChain, type Chain } from "./crypto-core";

// ---------------------------------------------------------------------------
// Inputs + outputs
// ---------------------------------------------------------------------------

/** The raw per-wallet sync facts this module reasons over (all optional/nullable). */
export type BackfillProgressInput = {
  chain: Chain;
  /** Current resume cursor (chain-specific string). null once backfill done. */
  cursor: string | null;
  /** The cursor from the PRIOR run, for stuck detection. null if unknown. */
  prevCursor: string | null;
  /**
   * The backfill TARGET. For EVM this is the chain-tip block number (as a decimal
   * string) captured at sync time. null for opaque-cursor chains / when unknown.
   */
  targetCursor: string | null;
  /** Running count of transaction rows captured for this wallet. null if unknown. */
  transactionsTotal: number | null;
  /** True once the full history has been walked. */
  backfillComplete: boolean;
  status: "idle" | "backfilling" | "syncing" | "error";
  lastSyncedAt: string | null;
};

/** How the backfill is moving — drives the tone + the plain-English sentence. */
export type BackfillMovement =
  | "idle" // never synced yet
  | "progressing" // cursor advanced since last run (or first run in progress)
  | "stalled" // cursor did NOT advance and we're not complete/errored — may be stuck
  | "complete" // full history captured
  | "error"; // last run recorded an error

/** The honest, render-ready progress view for one wallet. */
export type BackfillProgressView = {
  chain: Chain;
  /** True only when a truthful percentage is available (EVM with known tip). */
  hasPercent: boolean;
  /** 0..100 integer percent when `hasPercent`; otherwise null. NEVER guessed. */
  percent: number | null;
  movement: BackfillMovement;
  /** UI tone hint, matching the Health-tab chip palette. */
  tone: "neutral" | "green" | "orange" | "red";
  /** Short chip label, e.g. "82% synced", "Backfilling", "Up to date". */
  label: string;
  /** One plain-English sentence for Michael describing exactly where things stand. */
  detail: string;
  /** How far back the backfill has reached, when knowable (e.g. "block 8,240,113"
   * or "ledger 106,228,618"). null when not applicable. */
  reachedText: string | null;
  /** Transactions captured so far (for the readout), or null if unknown. */
  transactionsTotal: number | null;
};

// ---------------------------------------------------------------------------
// Cursor parsing (per-chain, defensive — never throws)
// ---------------------------------------------------------------------------

/**
 * Parse the EVM cursor `"<nextStartBlock>:<lastConsumedBlock>"` and return the
 * block the backfill has reached (nextStartBlock). Returns null if the cursor is
 * absent or malformed (we then fall back to a non-percent view).
 */
export function parseEvmReachedBlock(cursor: string | null): number | null {
  if (!cursor) return null;
  const parts = cursor.trim().split(":");
  if (parts.length < 1) return null;
  const n = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Parse an EVM target (chain-tip) block from its decimal-string form. */
export function parseEvmTargetBlock(targetCursor: string | null): number | null {
  if (!targetCursor) return null;
  const n = Number.parseInt(targetCursor.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Pull the `ledger` index out of an XRPL account_tx marker cursor. The cursor is
 * stored as JSON like `{"ledger":106228618,"seq":0}`. Returns null if the cursor
 * is absent or not a marker with a numeric ledger.
 */
export function parseXrplReachedLedger(cursor: string | null): number | null {
  if (!cursor) return null;
  const raw = cursor.trim();
  if (raw === "") return null;
  try {
    const obj: unknown = JSON.parse(raw);
    if (obj && typeof obj === "object" && "ledger" in obj) {
      const led = (obj as { ledger: unknown }).ledger;
      if (typeof led === "number" && Number.isFinite(led) && led > 0) {
        return Math.trunc(led);
      }
      if (typeof led === "string") {
        const n = Number.parseInt(led, 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  } catch {
    // Not JSON (or not a marker) — no ledger to surface. That is fine.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Movement / stuck detection
// ---------------------------------------------------------------------------

/**
 * Decide how the backfill is moving. Order matters:
 *   error → complete → idle(no cursor, never synced) → stalled/progressing.
 * "stalled" requires: not complete, not error, a cursor exists, and it equals
 * the previous run's cursor (so two consecutive runs made no progress).
 */
export function computeMovement(input: BackfillProgressInput): BackfillMovement {
  if (input.status === "error") return "error";
  if (input.backfillComplete) return "complete";
  // Never synced: no cursor AND no timestamp AND idle.
  if (input.cursor === null && input.lastSyncedAt === null && input.status === "idle") {
    return "idle";
  }
  // Mid-backfill (cursor present). Stuck only if the cursor didn't advance.
  if (input.cursor !== null && input.prevCursor !== null && input.cursor === input.prevCursor) {
    return "stalled";
  }
  return "progressing";
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

/** Group-with-commas an integer for display: 8240113 → "8,240,113". */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const neg = n < 0;
  const digits = Math.abs(Math.trunc(n)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return (neg ? "-" : "") + out;
}

/**
 * Clamp + integer-ify a percent from a reached/target pair using EXACT integer
 * math (no float): floor(reached * 100 / target), clamped to 0..100. If target
 * is 0 we cannot compute a percent and return null.
 */
export function integerPercent(reached: number, target: number): number | null {
  if (!Number.isFinite(reached) || !Number.isFinite(target) || target <= 0) return null;
  const r = Math.max(0, Math.trunc(reached));
  const t = Math.trunc(target);
  if (r >= t) return 100;
  const p = Math.floor((r * 100) / t);
  return p < 0 ? 0 : p > 100 ? 100 : p;
}

/** Best-effort friendly timestamp, e.g. "2026-08-11 19:48 UTC". */
function whenText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** "3 transactions" / "1 transaction" / "" (when unknown). */
function txnsPhrase(total: number | null): string {
  if (total === null || total < 0) return "";
  return `${formatInt(total)} transaction${total === 1 ? "" : "s"} captured`;
}

// ---------------------------------------------------------------------------
// The main builder
// ---------------------------------------------------------------------------

/**
 * Build the honest progress view for one wallet. Degrades gracefully: if the
 * richer fields (target/prev/count) are null — e.g. before the progress
 * migration has run — it still returns a correct phase + movement view, just
 * without a percent or reached-readout.
 */
export function buildBackfillProgress(input: BackfillProgressInput): BackfillProgressView {
  const movement = computeMovement(input);
  const txns = input.transactionsTotal;

  // ----- ERROR ------------------------------------------------------------
  if (movement === "error") {
    return {
      chain: input.chain,
      hasPercent: false,
      percent: null,
      movement,
      tone: "red",
      label: "Needs attention",
      detail: "The last sync hit a problem and stopped. Open the wallet to see the message; the next sync will retry from where it left off.",
      reachedText: null,
      transactionsTotal: txns,
    };
  }

  // ----- NEVER SYNCED -----------------------------------------------------
  if (movement === "idle") {
    return {
      chain: input.chain,
      hasPercent: false,
      percent: null,
      movement,
      tone: "neutral",
      label: "Not started",
      detail: "No history pulled yet. Click “Sync now” to begin the full historical backfill.",
      reachedText: null,
      transactionsTotal: txns,
    };
  }

  // ----- COMPLETE ---------------------------------------------------------
  if (movement === "complete") {
    const when = whenText(input.lastSyncedAt);
    const tx = txnsPhrase(txns);
    return {
      chain: input.chain,
      hasPercent: true,
      percent: 100,
      movement,
      tone: "green",
      label: "Up to date",
      detail: `Full history captured${tx ? ` — ${tx}` : ""}.${when ? ` Last refreshed ${when}.` : ""}`,
      reachedText: null,
      transactionsTotal: txns,
    };
  }

  // ----- IN PROGRESS (progressing or stalled) -----------------------------
  const stalled = movement === "stalled";
  const tone: BackfillProgressView["tone"] = stalled ? "orange" : "orange";
  const tx = txnsPhrase(txns);

  // EVM: try for a TRUE percent + reached block.
  if (isEvmChain(input.chain)) {
    const reached = parseEvmReachedBlock(input.cursor);
    const target = parseEvmTargetBlock(input.targetCursor);
    const percent = reached !== null && target !== null ? integerPercent(reached, target) : null;
    const reachedText = reached !== null ? `block ${formatInt(reached)}` : null;
    if (percent !== null) {
      const base = `Backfilling history — about ${percent}% of the chain scanned (up to block ${formatInt(
        reached as number,
      )} of ${formatInt(target as number)})${tx ? `, ${tx}` : ""}.`;
      return {
        chain: input.chain,
        hasPercent: true,
        percent,
        movement,
        tone,
        label: stalled ? "No recent progress" : `${percent}% synced`,
        detail: stalled
          ? `${base} The last click didn’t advance — if this repeats, it may be stuck; try again or open the wallet.`
          : base,
        reachedText,
        transactionsTotal: txns,
      };
    }
    // No tip yet — honest fallback without a fabricated percent.
    return {
      chain: input.chain,
      hasPercent: false,
      percent: null,
      movement,
      tone,
      label: stalled ? "No recent progress" : "Backfilling",
      detail: stalled
        ? `Backfilling history${reachedText ? ` (reached ${reachedText})` : ""}${tx ? ` — ${tx}` : ""}. The last click didn’t advance — if this repeats, it may be stuck.`
        : `Backfilling history${reachedText ? ` (reached ${reachedText})` : ""}${tx ? ` — ${tx}` : ""}. Keep clicking “Sync now” to continue; each run picks up where the last left off.`,
      reachedText,
      transactionsTotal: txns,
    };
  }

  // XRPL: honest "reached ledger N" (no percent).
  if (input.chain === "xrpl") {
    const ledger = parseXrplReachedLedger(input.cursor);
    const reachedText = ledger !== null ? `ledger ${formatInt(ledger)}` : null;
    return {
      chain: input.chain,
      hasPercent: false,
      percent: null,
      movement,
      tone,
      label: stalled ? "No recent progress" : "Backfilling",
      detail: stalled
        ? `Backfilling history${reachedText ? `, reached back to ${reachedText}` : ""}${tx ? ` — ${tx}` : ""}. The last click didn’t advance — if this repeats, it may be stuck.`
        : `Backfilling history${reachedText ? `, reached back to ${reachedText}` : ""}${tx ? ` — ${tx}` : ""}. Keep clicking “Sync now” to continue; each run resumes where the last left off.`,
      reachedText,
      transactionsTotal: txns,
    };
  }

  // Coreum / other Cosmos: phase + tx count only (opaque next_key, no position).
  if (isCosmosChain(input.chain)) {
    return {
      chain: input.chain,
      hasPercent: false,
      percent: null,
      movement,
      tone,
      label: stalled ? "No recent progress" : "Backfilling",
      detail: stalled
        ? `Backfilling history${tx ? ` — ${tx}` : ""}. The last click didn’t advance — if this repeats, it may be stuck.`
        : `Backfilling history${tx ? ` — ${tx}` : ""}. Keep clicking “Sync now” to continue; each run resumes where the last left off.`,
      reachedText: null,
      transactionsTotal: txns,
    };
  }

  // Fallback (should be unreachable — every Chain is EVM, XRPL, or Cosmos).
  return {
    chain: input.chain,
    hasPercent: false,
    percent: null,
    movement,
    tone,
    label: "Backfilling",
    detail: `Backfilling history${tx ? ` — ${tx}` : ""}.`,
    reachedText: null,
    transactionsTotal: txns,
  };
}

// ---------------------------------------------------------------------------
// Pure self-test — wired into run-pure-selftests + a vitest mirror.
// ---------------------------------------------------------------------------

export function __runCryptoProgressCoreTests(): void {
  let failures = 0;
  const check = (label: string, cond: boolean): void => {
    if (!cond) {
      failures += 1;
      console.error(`[crypto-progress-core self-test] FAIL: ${label}`);
    }
  };

  // --- parseEvmReachedBlock
  check("evm reached parses next block", parseEvmReachedBlock("8240113:8240100") === 8240113);
  check("evm reached genesis", parseEvmReachedBlock("0:-1") === 0);
  check("evm reached null", parseEvmReachedBlock(null) === null);
  check("evm reached garbage", parseEvmReachedBlock("abc") === null);
  check("evm reached single field", parseEvmReachedBlock("500") === 500);

  // --- parseEvmTargetBlock
  check("evm target parses", parseEvmTargetBlock("10000000") === 10000000);
  check("evm target null", parseEvmTargetBlock(null) === null);
  check("evm target zero → null", parseEvmTargetBlock("0") === null);

  // --- parseXrplReachedLedger (verified live marker shape)
  check("xrpl ledger from marker", parseXrplReachedLedger('{"ledger":106228618,"seq":0}') === 106228618);
  check("xrpl ledger string form", parseXrplReachedLedger('{"ledger":"12345"}') === 12345);
  check("xrpl ledger null", parseXrplReachedLedger(null) === null);
  check("xrpl ledger non-json", parseXrplReachedLedger("not-json") === null);
  check("xrpl ledger no field", parseXrplReachedLedger('{"seq":1}') === null);

  // --- integerPercent (exact, clamped)
  check("percent half", integerPercent(50, 100) === 50);
  check("percent floors", integerPercent(1, 3) === 33);
  check("percent reached==target → 100", integerPercent(100, 100) === 100);
  check("percent over target clamps 100", integerPercent(150, 100) === 100);
  check("percent zero target → null", integerPercent(5, 0) === null);
  check("percent zero reached", integerPercent(0, 100) === 0);
  // Large block numbers stay exact (well within safe-integer range).
  check("percent large blocks", integerPercent(8240113, 16480226) === 50);
  check("percent large blocks floor", integerPercent(8240113, 16480227) === 49);

  // --- formatInt
  check("formatInt commas", formatInt(8240113) === "8,240,113");
  check("formatInt small", formatInt(42) === "42");
  check("formatInt zero", formatInt(0) === "0");
  check("formatInt thousand", formatInt(1000) === "1,000");

  // --- computeMovement
  const base: BackfillProgressInput = {
    chain: "flare",
    cursor: "100:99",
    prevCursor: "50:49",
    targetCursor: "200",
    transactionsTotal: 5,
    backfillComplete: false,
    status: "backfilling",
    lastSyncedAt: "2026-08-11T00:00:00Z",
  };
  check("movement progressing", computeMovement(base) === "progressing");
  check(
    "movement stalled when cursor unchanged",
    computeMovement({ ...base, prevCursor: "100:99" }) === "stalled",
  );
  check(
    "movement complete",
    computeMovement({ ...base, backfillComplete: true }) === "complete",
  );
  check("movement error", computeMovement({ ...base, status: "error" }) === "error");
  check(
    "movement idle (never synced)",
    computeMovement({
      chain: "xrpl",
      cursor: null,
      prevCursor: null,
      targetCursor: null,
      transactionsTotal: null,
      backfillComplete: false,
      status: "idle",
      lastSyncedAt: null,
    }) === "idle",
  );

  // --- buildBackfillProgress: EVM true percent
  const evm = buildBackfillProgress(base);
  check("evm view has percent", evm.hasPercent === true);
  check("evm percent 50", evm.percent === 50);
  check("evm tone orange", evm.tone === "orange");
  check("evm reachedText block", evm.reachedText === "block 100");
  check("evm label shows percent", evm.label === "50% synced");

  // EVM without a tip → honest, no percent.
  const evmNoTip = buildBackfillProgress({ ...base, targetCursor: null });
  check("evm no tip → no percent", evmNoTip.hasPercent === false && evmNoTip.percent === null);
  check("evm no tip still reached", evmNoTip.reachedText === "block 100");

  // EVM stalled → orange, warns about stuck.
  const evmStalled = buildBackfillProgress({ ...base, prevCursor: "100:99" });
  check("evm stalled movement", evmStalled.movement === "stalled");
  check("evm stalled label", evmStalled.label === "No recent progress");
  check("evm stalled mentions stuck", /stuck/.test(evmStalled.detail));

  // --- XRPL view: ledger readout, NO percent.
  const xrpl = buildBackfillProgress({
    chain: "xrpl",
    cursor: '{"ledger":106228618,"seq":0}',
    prevCursor: '{"ledger":106500000,"seq":0}',
    targetCursor: null,
    transactionsTotal: 12,
    backfillComplete: false,
    status: "backfilling",
    lastSyncedAt: "2026-08-11T00:00:00Z",
  });
  check("xrpl no percent", xrpl.hasPercent === false && xrpl.percent === null);
  check("xrpl reached ledger", xrpl.reachedText === "ledger 106,228,618");
  check("xrpl detail mentions ledger", /ledger 106,228,618/.test(xrpl.detail));

  // --- Coreum view: phase + txns only, NO percent, NO reached.
  const coreum = buildBackfillProgress({
    chain: "coreum",
    cursor: "opaque-next-key-abc",
    prevCursor: "opaque-next-key-xyz",
    targetCursor: null,
    transactionsTotal: 3,
    backfillComplete: false,
    status: "backfilling",
    lastSyncedAt: "2026-08-11T00:00:00Z",
  });
  check("coreum no percent", coreum.hasPercent === false && coreum.percent === null);
  check("coreum no reachedText", coreum.reachedText === null);
  check("coreum txns in detail", /3 transactions captured/.test(coreum.detail));

  // --- complete + error + idle views
  const done = buildBackfillProgress({ ...base, backfillComplete: true, transactionsTotal: 42 });
  check("complete tone green", done.tone === "green");
  check("complete percent 100", done.percent === 100 && done.hasPercent === true);
  check("complete label", done.label === "Up to date");
  check("complete mentions txns", /42 transactions captured/.test(done.detail));

  const err = buildBackfillProgress({ ...base, status: "error" });
  check("error tone red", err.tone === "red");
  check("error label", err.label === "Needs attention");

  const idle = buildBackfillProgress({
    chain: "ethereum",
    cursor: null,
    prevCursor: null,
    targetCursor: null,
    transactionsTotal: null,
    backfillComplete: false,
    status: "idle",
    lastSyncedAt: null,
  });
  check("idle tone neutral", idle.tone === "neutral");
  check("idle label", idle.label === "Not started");

  if (failures > 0) {
    throw new Error(`crypto-progress-core self-test failed: ${failures} check(s) failed`);
  }
  console.log("crypto-progress-core self-tests: all passed");
}
