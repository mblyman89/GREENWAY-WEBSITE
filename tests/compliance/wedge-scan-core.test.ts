/**
 * tests/compliance/wedge-scan-core.test.ts
 *
 * Vitest mirror for the AM-A global keyboard-wedge scan classifier. The
 * owner's rule: scan a product WITHOUT pushing any buttons or clicking into
 * the search bar. Fast printable bursts ending in Enter are scans; human
 * typing never is.
 */
import { describe, expect, it } from "vitest";
import {
  emptyWedgeState,
  wedgeKey,
  WEDGE_INTERKEY_MS,
  WEDGE_MIN_LENGTH,
  __runWedgeScanCoreTests,
  type WedgeState,
} from "@/lib/pos/wedge-scan-core";

function typeBurst(text: string, startMs: number, gapMs: number): { state: WedgeState; t: number } {
  let state = emptyWedgeState();
  let t = startMs;
  for (const ch of text) {
    state = wedgeKey(state, ch, t).state;
    t += gapMs;
  }
  return { state, t };
}

describe("wedgeKey", () => {
  it("emits a scan for a fast burst ending in Enter, then resets", () => {
    const { state, t } = typeBurst("1A2B3C4D", 1000, 20);
    const r = wedgeKey(state, "Enter", t);
    expect(r.scan).toBe("1A2B3C4D");
    expect(r.state).toEqual(emptyWedgeState());
  });

  it("never emits for human-speed typing (slow keys restart the buffer)", () => {
    const { state, t } = typeBurst("hello", 1000, 200);
    expect(state.buffer).toBe("o");
    expect(wedgeKey(state, "Enter", t).scan).toBeNull();
  });

  it("refuses bursts below the minimum length", () => {
    const { state, t } = typeBurst("ab1", 1000, 20);
    expect(wedgeKey(state, "Enter", t).scan).toBeNull();
    expect(WEDGE_MIN_LENGTH).toBe(4);
    const four = typeBurst("ab12", 1000, 20);
    expect(wedgeKey(four.state, "Enter", four.t).scan).toBe("ab12");
  });

  it("chains at exactly the inter-key threshold and restarts one ms over", () => {
    let s = wedgeKey(emptyWedgeState(), "a", 1000).state;
    s = wedgeKey(s, "b", 1000 + WEDGE_INTERKEY_MS).state;
    expect(s.buffer).toBe("ab");
    let s2 = wedgeKey(emptyWedgeState(), "a", 1000).state;
    s2 = wedgeKey(s2, "b", 1000 + WEDGE_INTERKEY_MS + 1).state;
    expect(s2.buffer).toBe("b");
  });

  it("ignores modifier keys mid-burst without severing the chain", () => {
    let s = wedgeKey(emptyWedgeState(), "a", 1000).state;
    s = wedgeKey(s, "Shift", 1010).state;
    s = wedgeKey(s, "B", 1020).state;
    s = wedgeKey(s, "c", 1040).state;
    s = wedgeKey(s, "9", 1060).state;
    expect(s.buffer).toBe("aBc9");
    expect(wedgeKey(s, "Enter", 1080).scan).toBe("aBc9");
  });

  it("isolates back-to-back scans", () => {
    const first = typeBurst("CODE-ONE", 1000, 15);
    const e1 = wedgeKey(first.state, "Enter", first.t);
    let state = e1.state;
    let t = 9000;
    for (const ch of "CODE-TWO") {
      state = wedgeKey(state, ch, t).state;
      t += 15;
    }
    const e2 = wedgeKey(state, "Enter", t);
    expect(e1.scan).toBe("CODE-ONE");
    expect(e2.scan).toBe("CODE-TWO");
  });

  it("bare Enter emits nothing", () => {
    expect(wedgeKey(emptyWedgeState(), "Enter", 500).scan).toBeNull();
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runWedgeScanCoreTests()).not.toThrow();
  });
});
