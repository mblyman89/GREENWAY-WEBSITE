/**
 * src/lib/pos/socket-scan-core.ts  (SLICE 12)
 *
 * PURE arbitration and routing for scans arriving from the Socket Mobile
 * CaptureSDK. No I/O, no React, no Capacitor -- safe for the tsx self-test
 * harness and for vitest.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * THE MEASURED PROBLEM. The D760 in keyboard-wedge (HID) mode TYPES the
 * barcode, one keystroke at a time, over Bluetooth. A driver's licence PDF417
 * carries 300-1100 characters, so a single ID scan takes roughly ten seconds
 * to arrive and can stall mid-stream. Slice 10 already fixed everything on our
 * side of that: the ID capture finalizes the instant the payload is provably
 * gate-ready rather than waiting on a fixed timer. What remains is not our
 * timers. It is the transport -- spelling a barcode out as keystrokes is slow
 * no matter who is listening.
 *
 * Application Mode replaces the spelling with a single delivered message. The
 * decode arrives whole, once, in milliseconds.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE HAZARD THIS FILE GUARDS: THE SAME SCAN, TWICE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The wedge listener stays bound (it must -- see below), so a host that keeps
 * HID alive alongside the SDK would deliver one physical scan down BOTH
 * channels. For a product that is a double add to the cart. For an ID it is a
 * customer processed twice.
 *
 * THE OBVIOUS DEFENCE DOES NOT WORK, AND THAT IS THE KEY FACT HERE.
 * "Ignore a payload we just saw" assumes the two copies arrive close together.
 * THEY DO NOT. The SDK copy lands in milliseconds; the wedge copy finishes
 * spelling itself out TEN SECONDS later. A window wide enough to catch that
 * straggler would have to exceed ten seconds -- and would then swallow a
 * cashier legitimately scanning the same item twice, which is an ordinary
 * thing to do at a register and must never be silently dropped.
 *
 * So arbitration is by CHANNEL OWNERSHIP, not by elapsed time:
 *
 *     While a Socket device is connected, the SDK owns scanning and wedge
 *     input is refused outright -- not because it looks like a duplicate,
 *     but because it is no longer the scanner talking.
 *
 * Time-based suppression is kept, but only for the job it is actually good
 * at: ONE channel repeating ITSELF because the trigger was held down.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE WEDGE PATH IS NOT DELETED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * It is the fallback that keeps the store selling. The SDK path requires a
 * native build, the CaptureSDK linked, the scanner paired in Application Mode,
 * and the Socket service reachable. If any of those is not true -- and on the
 * very first install none of them are -- the wedge is how the register scans.
 * Ownership is therefore RELEASED when the last device disappears: a scanner
 * going flat mid-shift must not leave a till that cannot scan.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * It does not parse AAMVA (id-scan-core.ts does, and is symbology-agnostic).
 * It does not resolve products (scan-to-cart-core.ts does). It does not talk
 * to the SDK (socket-scanner.ts does). It decides ONE thing: whether this
 * payload, from this channel, at this moment, is a real scan -- and where it
 * should go.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * How long an IDENTICAL payload from the SAME channel is treated as the
 * trigger still being held rather than a new scan.
 *
 * Sized against the two failure modes it sits between. Too short and a held
 * trigger double-adds. Too long and the cashier cannot ring up two identical
 * items -- they scan the second gummy pack, nothing happens, and they have no
 * idea why. A held Socket trigger repeats every few hundred milliseconds; a
 * human moving one package aside and presenting the next takes appreciably
 * longer than a second.
 *
 * NOTE it is NOT sized to catch the cross-channel duplicate. It could not be:
 * that straggler is ten seconds late. Channel ownership handles that, which is
 * why this number gets to stay small enough to keep double-buys working.
 */
export const SOCKET_REPEAT_WINDOW_MS = 1200;

/**
 * Shortest payload that could be a real barcode.
 *
 * Matches the floor scan-to-cart-core.ts already enforces (it refuses codes
 * under 4 characters). Keeping the two the same means this router never
 * forwards something the resolver is guaranteed to reject.
 */
export const SOCKET_MIN_PAYLOAD_LENGTH = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a scan came from. */
export type SocketScanChannel = "sdk" | "wedge";

/** Where an accepted scan should be sent. */
export type SocketScanRoute = "id" | "product";

/** What a payload is, including "nothing usable". */
export type SocketPayloadKind = SocketScanRoute | "unusable";

export type SocketScanState = {
  /**
   * How many Socket devices are currently connected.
   *
   * A COUNT, not a boolean, and that matters: with two scanners paired,
   * unplugging one must not hand scanning back to the wedge while the other
   * is still working -- that would re-open the double-scan this file exists
   * to close.
   */
  connectedDevices: number;
  /** The last payload accepted, for repeat suppression. */
  lastPayload: string | null;
  /** Channel that produced `lastPayload`. */
  lastChannel: SocketScanChannel | null;
  /** When `lastPayload` was ACCEPTED (never updated by a refusal). */
  lastAcceptedMs: number | null;
};

export function emptySocketScanState(): SocketScanState {
  return {
    connectedDevices: 0,
    lastPayload: null,
    lastChannel: null,
    lastAcceptedMs: null,
  };
}

/** Why a scan was refused. Surfaced so the caller can log honestly. */
export type SocketScanRefusal = "not-owner" | "repeat" | "unusable";

export type SocketScanDecision =
  | { accepted: true; state: SocketScanState; route: SocketScanRoute; payload: string }
  | { accepted: false; state: SocketScanState; reason: SocketScanRefusal };

// ---------------------------------------------------------------------------
// Device presence
// ---------------------------------------------------------------------------

/** A Socket device announced itself. Returns a NEW state; never mutates. */
export function noteSocketDeviceArrival(state: SocketScanState): SocketScanState {
  return { ...state, connectedDevices: state.connectedDevices + 1 };
}

/**
 * A Socket device went away.
 *
 * Clamped at zero. A removal callback arriving after teardown (or twice for
 * one device) must not leave the count "owing" an arrival -- if it did, the
 * next real scanner would connect, the count would climb back to zero rather
 * than one, and every SDK scan would be refused for reasons no one could see.
 */
export function noteSocketDeviceRemoval(state: SocketScanState): SocketScanState {
  return { ...state, connectedDevices: Math.max(0, state.connectedDevices - 1) };
}

/**
 * Who owns scanning right now: "sdk" while any device is connected, otherwise
 * null, which means "nobody has claimed it -- the wedge is free to work".
 */
export function socketScanOwner(state: SocketScanState): "sdk" | null {
  return state.connectedDevices > 0 ? "sdk" : null;
}

// ---------------------------------------------------------------------------
// Payload classification
// ---------------------------------------------------------------------------

/**
 * Decide what a decoded payload IS.
 *
 * ROUTING KEYS ON FORMAT, NOT ON PARSE SUCCESS. A damaged licence is still a
 * licence. If we routed on "does this parse", a bad ID read would fall through
 * to the product path and be looked up as a barcode -- the cashier would be
 * told the scan "matched nothing on the menu", which sends them hunting in
 * exactly the wrong direction for a problem that is actually a re-scan. The
 * ID path gets to give the ID-shaped error.
 *
 * The signature is the AAMVA "ANSI " header, which is precisely what
 * id-scan-core.ts keys on (`text.indexOf("ANSI ")`). Deliberately the same
 * test, so the two can never disagree about what an ID looks like.
 */
export function classifySocketPayload(raw: string): SocketPayloadKind {
  if (typeof raw !== "string") return "unusable";
  if (raw.trim().length === 0) return "unusable";
  if (raw.includes("ANSI ")) return "id";
  // Length is measured on the TRIMMED payload: four spaces are not a barcode.
  if (raw.trim().length < SOCKET_MIN_PAYLOAD_LENGTH) return "unusable";
  return "product";
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Should this scan be acted on, and where does it go?
 *
 * Order of checks is deliberate:
 *
 *   1. OWNERSHIP first. If the SDK owns scanning, wedge input is not a scan
 *      at all and nothing else about it is worth evaluating.
 *   2. USABILITY next, so junk never disturbs the repeat state -- a stray
 *      empty callback must not make the register forget which barcode it is
 *      currently suppressing.
 *   3. REPEAT last, and only against the same payload on the same channel.
 *
 * A refusal returns the state UNCHANGED. That is what stops a stuck trigger
 * extending its own suppression forever: the window is measured from the last
 * ACCEPTED scan, so a held button eventually times out and the barcode becomes
 * scannable again instead of the register staying deaf to it.
 */
export function acceptSocketScan(input: {
  state: SocketScanState;
  channel: SocketScanChannel;
  raw: string;
  nowMs: number;
}): SocketScanDecision {
  const { state, channel, raw, nowMs } = input;

  // 1. Ownership.
  if (channel === "wedge" && socketScanOwner(state) === "sdk") {
    return { accepted: false, state, reason: "not-owner" };
  }

  // 2. Usability.
  const kind = classifySocketPayload(raw);
  if (kind === "unusable") {
    return { accepted: false, state, reason: "unusable" };
  }

  // 3. Repeat suppression -- same payload, same channel, inside the window.
  //    Boundary is INCLUSIVE (<=): at exactly the window it is still the same
  //    press. A repeat is only meaningful against a scan we actually accepted.
  if (
    state.lastPayload !== null &&
    state.lastPayload === raw &&
    state.lastChannel === channel &&
    state.lastAcceptedMs !== null &&
    nowMs - state.lastAcceptedMs <= SOCKET_REPEAT_WINDOW_MS
  ) {
    return { accepted: false, state, reason: "repeat" };
  }

  return {
    accepted: true,
    state: { ...state, lastPayload: raw, lastChannel: channel, lastAcceptedMs: nowMs },
    route: kind,
    // Handed back BYTE-FOR-BYTE. The AAMVA parser splits fields on LF / CR /
    // RS (\x1e); a router that helpfully trimmed the payload would destroy the
    // separators and turn every ID scan into a parse failure. Normalisation
    // belongs to the cart resolver, which does its own.
    payload: raw,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runSocketScanCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`socket-scan-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  const ID =
    "@\n\u001e\rANSI 636045090102DL00410288ZW03290015DLDAQWDL12345678\n" +
    "DCSSPECIMEN\nDACJANE\nDBB19900115\nDBA20301231\nDCGUSA\nDAJWA\n";
  const PRODUCT = "1A4070300003D91000001234";

  // Routing.
  ok(classifySocketPayload(ID) === "id", "AAMVA payload routes to the ID path");
  ok(classifySocketPayload(PRODUCT) === "product", "package barcode routes to the product path");
  ok(
    classifySocketPayload("@\n\u001e\rANSI 6360450901") === "id",
    "a DAMAGED licence still routes to the ID path, never to the cart",
  );
  ok(classifySocketPayload("") === "unusable", "empty payload refused");
  ok(classifySocketPayload("   ") === "unusable", "whitespace-only payload refused");
  ok(classifySocketPayload("abc") === "unusable", "3 chars is below the barcode floor");
  ok(classifySocketPayload("abcd") === "product", "4 chars is exactly at the floor");
  ok(
    classifySocketPayload(null as unknown as string) === "unusable",
    "null payload refused without throwing",
  );

  // Ownership.
  ok(socketScanOwner(emptySocketScanState()) === null, "nobody owns scanning at rest");
  const owned = noteSocketDeviceArrival(emptySocketScanState());
  ok(socketScanOwner(owned) === "sdk", "an arriving device gives the SDK ownership");
  ok(
    acceptSocketScan({ state: owned, channel: "wedge", raw: PRODUCT, nowMs: 1000 }).accepted ===
      false,
    "the wedge is refused while the SDK owns scanning",
  );

  // The cross-channel double-scan, ten seconds apart.
  const sdkScan = acceptSocketScan({ state: owned, channel: "sdk", raw: ID, nowMs: 1000 });
  ok(sdkScan.accepted, "the SDK scan is accepted");
  const straggler = acceptSocketScan({
    state: sdkScan.state,
    channel: "wedge",
    raw: ID,
    nowMs: 11000,
  });
  ok(
    !straggler.accepted && straggler.reason === "not-owner",
    "the wedge straggler is refused for NOT-OWNER, ten seconds later",
  );
  ok(
    11000 - 1000 > SOCKET_REPEAT_WINDOW_MS,
    "and that gap is far outside the repeat window, so a timer would have missed it",
  );

  // Release on disconnect -- a till that cannot scan cannot sell.
  const released = noteSocketDeviceRemoval(owned);
  ok(socketScanOwner(released) === null, "the last device leaving frees the wedge");
  ok(
    acceptSocketScan({ state: released, channel: "wedge", raw: PRODUCT, nowMs: 2000 }).accepted,
    "the wedge scans again once the SDK is gone",
  );
  let two = noteSocketDeviceArrival(owned);
  two = noteSocketDeviceRemoval(two);
  ok(socketScanOwner(two) === "sdk", "ownership survives while ANY device remains");
  ok(
    socketScanOwner(noteSocketDeviceArrival(noteSocketDeviceRemoval(emptySocketScanState()))) ===
      "sdk",
    "the device count never goes negative",
  );

  // Repeat suppression.
  const first = acceptSocketScan({ state: owned, channel: "sdk", raw: PRODUCT, nowMs: 1000 });
  ok(
    !acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS,
    }).accepted,
    "an identical payload at the window boundary is still the same press",
  );
  ok(
    acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS + 1,
    }).accepted,
    "past the window the same payload is a NEW scan (two identical items sell)",
  );
  ok(
    acceptSocketScan({ state: first.state, channel: "sdk", raw: "9A7", nowMs: 1001 }).accepted ===
      false,
    "a different but unusable payload is still refused",
  );
  ok(
    acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: "1A4070300003D91000009999",
      nowMs: 1001,
    }).accepted,
    "a DIFFERENT payload is never suppressed, however fast it follows",
  );
  // Per-CHANNEL, found by mutation testing. Ownership stops the cross-channel
  // duplicate, so the window must not also reach across channels: after a
  // scanner drops mid-shift, re-scanning the in-flight item on the wedge is a
  // new sale and has to ring up.
  const noOwner = acceptSocketScan({
    state: emptySocketScanState(),
    channel: "sdk",
    raw: PRODUCT,
    nowMs: 1000,
  });
  ok(
    acceptSocketScan({ state: noOwner.state, channel: "wedge", raw: PRODUCT, nowMs: 1010 })
      .accepted,
    "repeat suppression never reaches across channels",
  );

  const held = acceptSocketScan({ state: first.state, channel: "sdk", raw: PRODUCT, nowMs: 1500 });
  ok(!held.accepted, "the held trigger is suppressed");
  ok(
    acceptSocketScan({
      state: held.state,
      channel: "sdk",
      raw: PRODUCT,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS + 1,
    }).accepted,
    "a refusal does NOT extend the window (measured from the last ACCEPT)",
  );

  // Purity of the result.
  const routed = acceptSocketScan({ state: owned, channel: "sdk", raw: ID, nowMs: 1000 });
  ok(routed.accepted && routed.route === "id", "an accepted scan carries its route");
  ok(
    routed.accepted && routed.payload === ID,
    "the payload is handed back byte-for-byte (field separators intact)",
  );
  const snapshot = JSON.stringify(owned);
  acceptSocketScan({ state: owned, channel: "sdk", raw: PRODUCT, nowMs: 1000 });
  noteSocketDeviceRemoval(owned);
  ok(JSON.stringify(owned) === snapshot, "the input state is never mutated");

  console.log(`socket-scan-core self-tests: ALL PASS (${pass} assertions)`);
}
