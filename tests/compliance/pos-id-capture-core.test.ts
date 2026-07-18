/**
 * tests/compliance/pos-id-capture-core.test.ts  (Slice AP)
 *
 * Pins the ID gate's HIDDEN scanner capture: the keystroke accumulator that
 * replaced the visible textarea. The floor failure it fixes: an AAMVA PDF417
 * payload begins "@" + LF, wedge scanners type LF as Enter, and the old box
 * submitted on the FIRST Enter — so a real WA license died parsing "@" alone
 * ("missing @/ANSI header") while the rest of the barcode crawled in.
 */
import { describe, it, expect } from "vitest";
import {
  emptyIdCaptureState,
  idCaptureKey,
  finalizeIdCapture,
  ID_CAPTURE_IDLE_MS,
  ID_CAPTURE_MIN_LENGTH,
  __runIdCaptureCoreTests,
  type IdCaptureState,
} from "@/lib/pos/id-capture-core";
import { parseAamvaPdf417 } from "@/lib/pos/id-scan-core";

/** Type a string; "\n" is delivered as the Enter key (wedge behavior). */
function type(s: IdCaptureState, text: string, startMs = 1000, gapMs = 20): IdCaptureState {
  let state = s;
  let t = startMs;
  for (const ch of text) {
    state = idCaptureKey(state, ch === "\n" ? "Enter" : ch, t).state;
    t += gapMs;
  }
  return state;
}

describe("pos id-capture-core (AP — hidden instant ID scan)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runIdCaptureCoreTests()).not.toThrow();
  });

  it("captures a full AAMVA payload intact through its embedded Enters, and the payload parses", () => {
    const wa =
      "@\n\nANSI 636045080002DL00410278DLDAQWDL123ABC456\nDCSPUBLIC\nDACJOHN\n" +
      "DBD09152023\nDBB07131990\nDBA07132028\nDAJWA\nDCGUSA\n";
    const fin = finalizeIdCapture(type(emptyIdCaptureState(), wa));
    expect(fin.payload).toBe(wa);
    const parsed = parseAamvaPdf417(fin.payload!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.license.dateOfBirth).toBe("1990-07-13");
      expect(parsed.license.jurisdiction).toBe("WA");
    }
  });

  it("a wedge-stripped payload (no leading @) still parses after the AP parser fix", () => {
    const noAt =
      "ANSI 636045080002DL00410278DLDAQWDL123ABC456\nDCSPUBLIC\nDACJOHN\n" +
      "DBB07131990\nDBA07132028\nDAJWA\nDCGUSA\n";
    const parsed = parseAamvaPdf417(noAt);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.license.expirationDate).toBe("2028-07-13");
  });

  it("leading Enter passes through (buttons stay usable); mid-burst Enter is data", () => {
    expect(idCaptureKey(emptyIdCaptureState(), "Enter", 1000).consumed).toBe(false);
    const s = idCaptureKey(emptyIdCaptureState(), "@", 1000).state;
    const r = idCaptureKey(s, "Enter", 1020);
    expect(r.consumed).toBe(true);
    expect(r.state.buffer).toBe("@\n");
  });

  it("stray human typing resets silently (below min length)", () => {
    const fin = finalizeIdCapture(type(emptyIdCaptureState(), "oops", 1000, 200));
    expect(fin.payload).toBeNull();
    expect(fin.state.buffer).toBe("");
  });

  it("tuning constants: idle window near-instant but scanner-safe; min length filters noise", () => {
    expect(ID_CAPTURE_IDLE_MS).toBeGreaterThanOrEqual(200);
    expect(ID_CAPTURE_IDLE_MS).toBeLessThanOrEqual(1000);
    expect(ID_CAPTURE_MIN_LENGTH).toBe(20);
  });
});
