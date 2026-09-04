/**
 * SLICE 12 -- THE SOCKET SCANNER ROUTER, PROVEN BEHAVIOURALLY.
 *
 * ═══ THE MEASURED PROBLEM ═══
 *
 * The D760 in KEYBOARD-WEDGE (HID) mode types the barcode one keystroke at a
 * time over Bluetooth. A driver's licence PDF417 is 300-1100 characters, so a
 * single ID scan takes roughly TEN SECONDS to arrive, and the burst can stall
 * mid-stream. Slice 10 already wrung out what could be wrung out of that path
 * (finalize-on-complete instead of a fixed timer). The remaining ten seconds
 * are not our timers -- they are the transport. The only fix is to stop
 * spelling the barcode and receive it as one message, which is what Socket's
 * Application Mode SDK does.
 *
 * ═══ THE BUG THIS FILE EXISTS TO PREVENT ═══
 *
 * When the SDK is connected, the scanner is NO LONGER a keyboard -- but the
 * wedge listener is still bound, and any host that keeps HID alive would
 * deliver the SAME physical scan down BOTH channels.
 *
 * The obvious defence -- "ignore a payload we just saw" -- DOES NOT WORK HERE,
 * and that is the single most important fact in this file. Dedupe by time
 * assumes the two copies arrive close together. They do not: the SDK copy
 * arrives in milliseconds and the wedge copy finishes spelling itself out ten
 * seconds later. Any window wide enough to catch the straggler (>10 s) would
 * also swallow a cashier legitimately scanning the same item twice, which is
 * an ordinary thing to do at a register and must never be silently dropped.
 *
 * So the arbitration is by CHANNEL OWNERSHIP, not by time: once a Socket
 * device announces itself, the SDK owns scanning and the wedge is refused.
 * Time-based dedupe is kept ONLY for its real job -- one channel repeating
 * itself because the trigger was held down.
 *
 * ═══ TESTING DOCTRINE ═══
 *
 * Everything here is proven by calling the function and asserting on returned
 * values. Text matching proves a word exists, never that a value is right.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  SOCKET_REPEAT_WINDOW_MS,
  acceptSocketScan,
  classifySocketPayload,
  emptySocketScanState,
  noteSocketDeviceArrival,
  noteSocketDeviceRemoval,
  socketScanOwner,
  type SocketScanState,
} from "@/lib/pos/socket-scan-core";

// ---------------------------------------------------------------------------
// Fixtures -- real payload SHAPES, not "abc".
// ---------------------------------------------------------------------------

/**
 * A realistic AAMVA payload. The header is what the production parser keys
 * on (id-scan-core.ts uses `text.indexOf("ANSI ")`), so the fixture carries a
 * real one rather than a word that happens to contain the letters.
 */
const ID_PAYLOAD =
  "@\n\u001e\rANSI 636045090102DL00410288ZW03290015DLDAQWDL12345678\n" +
  "DCSSPECIMEN\nDACJANE\nDBB19900115\nDBA20301231\nDCGUSA\nDAJWA\n";

/** A product/lot barcode: short, no ANSI header. */
const PRODUCT_PAYLOAD = "1A4070300003D91000001234";

// ===========================================================================
// 1. ROUTING -- an ID must never be added to the cart as a product.
// ===========================================================================

describe("SLICE 12: classifySocketPayload routes a decoded payload", () => {
  it("routes an AAMVA driver's licence to the ID path", () => {
    expect(classifySocketPayload(ID_PAYLOAD)).toBe("id");
  });

  it("routes an ordinary package barcode to the product path", () => {
    expect(classifySocketPayload(PRODUCT_PAYLOAD)).toBe("product");
  });

  /**
   * THE ROUTER KEYS ON FORMAT, NOT ON PARSE SUCCESS.
   *
   * A licence that arrives damaged is still a LICENCE. If routing depended on
   * the payload parsing cleanly, a bad ID read would fall through to the
   * product path and be looked up as a barcode -- the cashier would see
   * "matched nothing on the menu" for a scan of a customer's ID, which sends
   * them hunting in exactly the wrong place. Route by format so the ID path
   * gets to give the ID-shaped error.
   */
  it("routes a DAMAGED licence to the ID path, not to the cart", () => {
    const truncated = "@\n\u001e\rANSI 636045090102DL00410288ZW0329";
    expect(classifySocketPayload(truncated)).toBe("id");
  });

  it("refuses empty and whitespace-only payloads", () => {
    for (const raw of ["", "   ", "\n\t\r "]) {
      expect(classifySocketPayload(raw), JSON.stringify(raw)).toBe("unusable");
    }
  });

  it("refuses a payload too short to be any real barcode", () => {
    // Below the 4-char floor the cart resolver itself enforces
    // (scan-to-cart-core.ts refuses codes shorter than 4).
    expect(classifySocketPayload("abc")).toBe("unusable");
    expect(classifySocketPayload("abcd")).toBe("product");
  });

  it("survives null and undefined without throwing", () => {
    expect(classifySocketPayload(null as unknown as string)).toBe("unusable");
    expect(classifySocketPayload(undefined as unknown as string)).toBe("unusable");
  });
});

// ===========================================================================
// 2. CHANNEL OWNERSHIP -- the double-scan defence.
// ===========================================================================

describe("SLICE 12: the SDK takes ownership of scanning when it connects", () => {
  it("starts owned by nobody, so the wedge works exactly as it does today", () => {
    const state = emptySocketScanState();
    expect(socketScanOwner(state)).toBe(null);

    const r = acceptSocketScan({ state, channel: "wedge", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    expect(r.accepted).toBe(true);
  });

  it("hands ownership to the SDK when a Socket device arrives", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    expect(socketScanOwner(state)).toBe("sdk");
  });

  /**
   * THE DOUBLE-SCAN, PREVENTED.
   *
   * Same payload, both channels. The SDK copy is accepted; the wedge copy is
   * refused because it no longer owns the channel -- NOT because it looked
   * like a duplicate.
   */
  it("REFUSES the wedge once the SDK owns scanning", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const sdk = acceptSocketScan({ state, channel: "sdk", raw: ID_PAYLOAD, nowMs: 1000 });
    expect(sdk.accepted).toBe(true);

    const wedge = acceptSocketScan({
      state: sdk.state,
      channel: "wedge",
      raw: ID_PAYLOAD,
      nowMs: 11000, // ten seconds later: the wedge has finished spelling it out
    });
    expect(wedge.accepted).toBe(false);
    expect(wedge.accepted === false && wedge.reason).toBe("not-owner");
  });

  /**
   * THE PROOF THAT TIME-BASED DEDUPE WOULD NOT HAVE BEEN ENOUGH.
   *
   * The wedge straggler lands FAR outside any sane repeat window. If the
   * defence were a timer, this scan would be accepted and the customer's ID
   * would be processed twice. Assert the gap really is outside the window, so
   * this test cannot quietly become a duplicate-detection test if the window
   * is ever widened.
   */
  it("refuses the wedge straggler even though it is far outside the repeat window", () => {
    const gapMs = 11000 - 1000;
    expect(gapMs).toBeGreaterThan(SOCKET_REPEAT_WINDOW_MS);

    const state = noteSocketDeviceArrival(emptySocketScanState());
    const sdk = acceptSocketScan({ state, channel: "sdk", raw: ID_PAYLOAD, nowMs: 1000 });
    const wedge = acceptSocketScan({
      state: sdk.state,
      channel: "wedge",
      raw: ID_PAYLOAD,
      nowMs: 11000,
    });
    expect(wedge.accepted).toBe(false);
    expect(wedge.accepted === false && wedge.reason).toBe("not-owner");
  });

  /**
   * FAILS SAFE, NOT SILENT.
   *
   * If the scanner disconnects mid-shift -- battery, out of range, powered off
   * -- the register must not stop scanning. Ownership returns to nobody and
   * the wedge works again. A store that cannot scan is a store that cannot
   * sell.
   */
  it("returns scanning to the wedge when the Socket device disappears", () => {
    let state: SocketScanState = noteSocketDeviceArrival(emptySocketScanState());
    expect(
      acceptSocketScan({ state, channel: "wedge", raw: PRODUCT_PAYLOAD, nowMs: 1000 }).accepted,
    ).toBe(false);

    state = noteSocketDeviceRemoval(state);
    expect(socketScanOwner(state)).toBe(null);
    expect(
      acceptSocketScan({ state, channel: "wedge", raw: PRODUCT_PAYLOAD, nowMs: 2000 }).accepted,
    ).toBe(true);
  });

  it("a second scanner arriving does not un-own the first", () => {
    const once = noteSocketDeviceArrival(emptySocketScanState());
    const twice = noteSocketDeviceArrival(once);
    expect(socketScanOwner(twice)).toBe("sdk");
  });

  /**
   * Two devices paired, one walks away. Removal is counted, so the wedge only
   * comes back when the LAST scanner is gone -- otherwise unplugging a spare
   * would re-enable the wedge while a working SDK scanner is still connected,
   * re-opening the double-scan this whole section closes.
   */
  it("keeps SDK ownership while ANY scanner remains connected", () => {
    let state = noteSocketDeviceArrival(emptySocketScanState());
    state = noteSocketDeviceArrival(state);
    state = noteSocketDeviceRemoval(state);
    expect(socketScanOwner(state)).toBe("sdk");
    state = noteSocketDeviceRemoval(state);
    expect(socketScanOwner(state)).toBe(null);
  });

  it("never drives the connected count below zero", () => {
    // A removal without a matching arrival (a late callback after teardown)
    // must not leave the state owing an arrival, or the next real scanner
    // would connect and still be refused.
    let state = noteSocketDeviceRemoval(emptySocketScanState());
    state = noteSocketDeviceRemoval(state);
    state = noteSocketDeviceArrival(state);
    expect(socketScanOwner(state)).toBe("sdk");
  });
});

// ===========================================================================
// 3. REPEAT SUPPRESSION -- one channel repeating itself.
// ===========================================================================

describe("SLICE 12: a held trigger does not scan the same thing twice", () => {
  it("refuses an identical payload repeated inside the window", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    expect(first.accepted).toBe(true);

    const second = acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS - 1,
    });
    expect(second.accepted).toBe(false);
    expect(second.accepted === false && second.reason).toBe("repeat");
  });

  /**
   * THE SALE-BREAKING MISTAKE THIS AVOIDS.
   *
   * Two identical items is an ordinary purchase. Suppressing forever would
   * mean the cashier scans the second gummy pack and nothing happens -- so
   * they scan again, harder, and still nothing. Past the window, the same
   * payload is a NEW scan and must be accepted.
   */
  it("ACCEPTS the same payload again once the window has passed", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    const second = acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS + 1,
    });
    expect(second.accepted).toBe(true);
  });

  it("treats the window boundary as still-a-repeat (inclusive)", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    const at = acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS,
    });
    expect(at.accepted).toBe(false);
  });

  it("never suppresses a DIFFERENT payload, however fast it follows", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    const other = acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: "1A4070300003D91000009999",
      nowMs: 1001,
    });
    expect(other.accepted).toBe(true);
  });

  /**
   * A REFUSED SCAN MUST NOT MOVE THE GOALPOSTS.
   *
   * If a suppressed repeat refreshed the timestamp, a scanner with a stuck
   * trigger would extend its own suppression indefinitely and the register
   * would stay deaf to that barcode for as long as the trigger was held.
   */
  it("a suppressed repeat does not extend the suppression window", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    const held = acceptSocketScan({
      state: first.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1500,
    });
    expect(held.accepted).toBe(false);

    // Measured from the FIRST accept, not from the refusal.
    const after = acceptSocketScan({
      state: held.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1000 + SOCKET_REPEAT_WINDOW_MS + 1,
    });
    expect(after.accepted).toBe(true);
  });

  /**
   * REPEAT SUPPRESSION IS PER-CHANNEL, AND THAT IS NOT AN IMPLEMENTATION
   * DETAIL. (Found by mutation testing: dropping the channel comparison
   * survived the suite until this test existed.)
   *
   * Ownership is what stops the cross-channel duplicate, so the repeat window
   * never needs to reach across channels -- and it must not, or the two
   * mechanisms would overlap in a way that hides a bug in either one.
   *
   * The concrete failure this prevents: a scanner disconnects mid-shift, the
   * wedge takes over, and the cashier re-scans the item that was in flight.
   * That is a NEW scan on a NEW channel and it must ring up. If suppression
   * ignored the channel, the register would sit there doing nothing at the
   * exact moment the fallback was supposed to save the sale.
   */
  it("does not let one channel's scan suppress the OTHER channel's", () => {
    // Nobody owns scanning (no Socket device), so both channels are live and
    // the ONLY thing that could refuse the second scan is repeat suppression.
    const state = emptySocketScanState();
    expect(socketScanOwner(state)).toBe(null);

    const viaSdk = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    expect(viaSdk.accepted).toBe(true);

    const viaWedge = acceptSocketScan({
      state: viaSdk.state,
      channel: "wedge",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1010, // well inside the window: only the CHANNEL differs
    });
    expect(1010 - 1000).toBeLessThan(SOCKET_REPEAT_WINDOW_MS);
    expect(
      viaWedge.accepted,
      "a different channel is a different scan; suppression must not reach across",
    ).toBe(true);

    // And the mirror image, so the test cannot pass by only ever checking one
    // direction of the comparison.
    const wedgeFirst = acceptSocketScan({
      state: emptySocketScanState(),
      channel: "wedge",
      raw: PRODUCT_PAYLOAD,
      nowMs: 5000,
    });
    expect(wedgeFirst.accepted).toBe(true);
    expect(
      acceptSocketScan({
        state: wedgeFirst.state,
        channel: "sdk",
        raw: PRODUCT_PAYLOAD,
        nowMs: 5010,
      }).accepted,
    ).toBe(true);
  });

  it("refuses an unusable payload without disturbing repeat state", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const first = acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    const junk = acceptSocketScan({ state: first.state, channel: "sdk", raw: "  ", nowMs: 1100 });
    expect(junk.accepted).toBe(false);
    expect(junk.accepted === false && junk.reason).toBe("unusable");

    // The good payload is still the one being suppressed.
    const repeat = acceptSocketScan({
      state: junk.state,
      channel: "sdk",
      raw: PRODUCT_PAYLOAD,
      nowMs: 1200,
    });
    expect(repeat.accepted).toBe(false);
  });
});

// ===========================================================================
// 4. THE ACCEPTED RESULT CARRIES WHAT THE CALLER NEEDS.
// ===========================================================================

describe("SLICE 12: an accepted scan tells the caller where to send it", () => {
  it("hands back the route alongside the payload", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const r = acceptSocketScan({ state, channel: "sdk", raw: ID_PAYLOAD, nowMs: 1000 });
    expect(r.accepted).toBe(true);
    expect(r.accepted === true && r.route).toBe("id");
    expect(r.accepted === true && r.payload).toBe(ID_PAYLOAD);
  });

  /**
   * THE PAYLOAD IS HANDED BACK BYTE-FOR-BYTE.
   *
   * The AAMVA parser depends on control characters -- it splits fields on
   * LF / CR / RS (\x1e). A router that helpfully trimmed or normalised the
   * payload would destroy the field separators and turn every ID scan into a
   * parse failure. Pass it through untouched; normalisation belongs to the
   * cart resolver, which does its own.
   */
  it("does not trim, normalise or otherwise touch the payload", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const r = acceptSocketScan({ state, channel: "sdk", raw: ID_PAYLOAD, nowMs: 1000 });
    expect(r.accepted === true && r.payload === ID_PAYLOAD).toBe(true);
    expect(r.accepted === true && r.payload.includes("\u001e")).toBe(true);
  });

  it("is a PURE state machine: the input state is never mutated", () => {
    const state = noteSocketDeviceArrival(emptySocketScanState());
    const snapshot = JSON.stringify(state);
    acceptSocketScan({ state, channel: "sdk", raw: PRODUCT_PAYLOAD, nowMs: 1000 });
    noteSocketDeviceArrival(state);
    noteSocketDeviceRemoval(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

// ===========================================================================
// 5. SOURCE GUARDS -- a class of bug, not a value.
// ===========================================================================

describe("SLICE 12: the router stays pure", () => {
  it("the core has no database, network, React or native imports", () => {
    const src = readFileSync("src/lib/pos/socket-scan-core.ts", "utf8");
    for (const forbidden of ["supabase", "server-only", "node:fs", "fetch(", "@capacitor", "react"]) {
      expect(src.includes(forbidden), `socket-scan-core must not reference ${forbidden}`).toBe(
        false,
      );
    }
  });
});
