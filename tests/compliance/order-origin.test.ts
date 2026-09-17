/**
 * tests/compliance/order-origin.test.ts
 *
 * SLICE L-2 — the order-origin vocabulary, and its contract with the hardware.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `order-origin-core.ts` decides three things that leave the server and become
 * physical: a chime a Raspberry Pi has to play, a line a thermal printer has to
 * print, and an email the customer either does or does not receive. Its own
 * self-tests prove the logic is internally consistent. They cannot prove it
 * agrees with the Pi.
 *
 * That gap is the dangerous one, because it fails SILENTLY. If the server picks
 * a sound id the Pi cannot resolve, `greenway_announcer.py` does not crash and
 * does not report: `is_builtin_sound()` decides built-in vs. uploaded purely by
 * SHAPE (no slash, no dot), so a sound id containing either is treated as a
 * storage path, downloaded, 404s, and falls back. The speaker makes a noise.
 * The wrong noise, or the same noise for both order types — which is precisely
 * the thing the owner asked to be able to tell apart.
 *
 * So this file reads the ACTUAL Pi agent source and asserts the server's choices
 * against it. If somebody adds an origin with a sound the Pi cannot synthesise,
 * CI goes red here instead of a member of staff noticing, weeks later, that
 * Leafly orders sound like website orders.
 *
 * Ground truth: pi-agent/greenway_announcer.py (BUILTIN_SOUND_ORDER, is_builtin_sound)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORDER_ORIGIN,
  MARKETPLACE_ORDER_ORIGINS,
  ORDER_ORIGINS,
  ORIGIN_DEFAULT_SOUND_IDS,
  PICKUP_ORDER_ORIGINS,
  __runOrderOriginTests,
  isMarketplaceOrigin,
  isOrderOrigin,
  isPickupOrigin,
  mayEmailCustomerForOrigin,
  mayEmailStaffForOrigin,
  orderOriginLabel,
  orderOriginReceiptLine,
  originAnnouncementText,
  resolveOriginSound,
  shouldAnnounceOrigin,
  toOrderOrigin,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";

const PI_AGENT_PATH = "pi-agent/greenway_announcer.py";
const piSource = readFileSync(join(process.cwd(), PI_AGENT_PATH), "utf8");

/** The built-in sound ids the Pi can synthesise, read from the agent itself. */
function piBuiltinSounds(): string[] {
  const m = piSource.match(/BUILTIN_SOUND_ORDER\s*=\s*\(([^)]*)\)/);
  if (!m) throw new Error(`BUILTIN_SOUND_ORDER not found in ${PI_AGENT_PATH}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("the embedded self-tests pass", () => {
  it("runs every assertion with no failures", () => {
    const r = __runOrderOriginTests();
    expect(r.failed).toBe(0);
    // A suite that ran zero assertions is not a passing suite.
    expect(r.passed).toBeGreaterThan(40);
  });
});

describe("the origin set is closed and complete", () => {
  it("has exactly the three origins that exist today", () => {
    expect([...ORDER_ORIGINS]).toEqual(["greenway", "leafly", "register"]);
  });

  it("the default origin is a real origin", () => {
    expect(ORDER_ORIGINS).toContain(DEFAULT_ORDER_ORIGIN);
  });

  it("the default is the LEAST restricted origin", () => {
    // toOrderOrigin() falls back to this for anything it cannot read, so the
    // default must never be an origin that suppresses customer email or hides
    // an order. A misread may cost a wrong chime; it must not cost an order.
    expect(mayEmailCustomerForOrigin(DEFAULT_ORDER_ORIGIN)).toBe(true);
    expect(isMarketplaceOrigin(DEFAULT_ORDER_ORIGIN)).toBe(false);
  });

  it("every pickup origin and marketplace origin is a real origin", () => {
    for (const o of [...PICKUP_ORDER_ORIGINS, ...MARKETPLACE_ORDER_ORIGINS]) {
      expect(ORDER_ORIGINS).toContain(o);
    }
  });

  it("every marketplace origin is also a pickup origin", () => {
    // A marketplace order the customer never collects makes no sense; if one
    // ever exists, the register/PA/printer assumptions below need revisiting.
    for (const o of MARKETPLACE_ORDER_ORIGINS) {
      expect(PICKUP_ORDER_ORIGINS as readonly string[]).toContain(o);
    }
  });

  it("register is NOT a pickup origin", () => {
    // The customer is standing at the counter. Announcing it would make the
    // speaker cry wolf and staff would learn to ignore it.
    expect(isPickupOrigin("register")).toBe(false);
    expect(shouldAnnounceOrigin("register")).toBe(false);
  });
});

describe("the chimes are ones the Raspberry Pi can actually play", () => {
  const builtins = piBuiltinSounds();

  it("reads the built-in list from the Pi agent", () => {
    expect(builtins).toEqual(["chime", "bell", "ding", "alert", "cash", "voice"]);
  });

  it("every origin has a default sound", () => {
    for (const o of ORDER_ORIGINS) {
      expect(typeof ORIGIN_DEFAULT_SOUND_IDS[o]).toBe("string");
      expect(ORIGIN_DEFAULT_SOUND_IDS[o].length).toBeGreaterThan(0);
    }
  });

  it("every default sound is a Pi built-in", () => {
    for (const o of ORDER_ORIGINS) {
      expect({ origin: o, sound: ORIGIN_DEFAULT_SOUND_IDS[o], known: builtins.includes(ORIGIN_DEFAULT_SOUND_IDS[o]) }).toEqual({
        origin: o,
        sound: ORIGIN_DEFAULT_SOUND_IDS[o],
        known: true,
      });
    }
  });

  it("no default sound contains a slash or a dot", () => {
    // is_builtin_sound() decides by SHAPE. A dot or slash makes the Pi treat
    // the id as a storage path, try to download it, 404, and fall back —
    // silently undoing the whole point of a per-origin chime.
    for (const o of ORDER_ORIGINS) {
      const s = ORIGIN_DEFAULT_SOUND_IDS[o];
      expect(s).not.toContain("/");
      expect(s).not.toContain(".");
      expect(s.trim()).toBe(s);
    }
  });

  it("the Pi really does decide built-in by shape (rule not drifted)", () => {
    // If this ever changes upstream, the assertion above stops meaning what it
    // says, so pin the rule itself rather than trusting a comment.
    expect(piSource).toMatch(/def is_builtin_sound/);
    expect(piSource).toMatch(/"\/" not in s and "\." not in s/);
  });

  it("THE OWNER'S REQUEST: website and Leafly get DIFFERENT chimes", () => {
    expect(ORIGIN_DEFAULT_SOUND_IDS.greenway).not.toBe(ORIGIN_DEFAULT_SOUND_IDS.leafly);
  });

  it("every announced origin has a distinct chime from every other", () => {
    // The point of the feature is discrimination at twenty feet; two announced
    // origins sharing a sound would defeat it.
    const announced = ORDER_ORIGINS.filter(shouldAnnounceOrigin);
    const sounds = announced.map((o) => ORIGIN_DEFAULT_SOUND_IDS[o]);
    expect(new Set(sounds).size).toBe(announced.length);
  });

  it("the website keeps the sound the shop already knows", () => {
    // Retraining everyone's ears to make room for a new sound is a cost with
    // no benefit; the NEW thing should get the NEW sound.
    expect(ORIGIN_DEFAULT_SOUND_IDS.greenway).toBe("chime");
  });
});

describe("resolveOriginSound never returns nothing", () => {
  it("falls back to the origin default", () => {
    for (const o of ORDER_ORIGINS) {
      expect(resolveOriginSound({ origin: o })).toBe(ORIGIN_DEFAULT_SOUND_IDS[o]);
    }
  });

  it("an explicit choice wins", () => {
    expect(resolveOriginSound({ origin: "leafly", configured: "cash" })).toBe("cash");
  });

  it("blank, whitespace, null and undefined all fall back", () => {
    for (const bad of ["", "   ", "\t", null, undefined]) {
      expect(resolveOriginSound({ origin: "leafly", configured: bad })).toBe(
        ORIGIN_DEFAULT_SOUND_IDS.leafly,
      );
    }
  });

  it("a configured value is trimmed", () => {
    expect(resolveOriginSound({ origin: "leafly", configured: "  ding  " })).toBe("ding");
  });

  it("never returns an empty string for any origin or any input", () => {
    // A speaker that plays nothing is indistinguishable from a broken speaker.
    for (const o of ORDER_ORIGINS) {
      for (const cfg of ["", "  ", null, undefined, "bell"]) {
        expect(resolveOriginSound({ origin: o, configured: cfg }).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("coercion cannot lose an order", () => {
  it("recognises every real origin", () => {
    for (const o of ORDER_ORIGINS) {
      expect(isOrderOrigin(o)).toBe(true);
      expect(toOrderOrigin(o)).toBe(o);
    }
  });

  it("normalises case and whitespace", () => {
    expect(toOrderOrigin("  LEAFLY  ")).toBe("leafly");
    expect(toOrderOrigin("Leafly")).toBe("leafly");
  });

  it("anything unrecognised becomes the default, never a throw", () => {
    for (const junk of [null, undefined, "", "   ", 42, {}, [], true, "weedmaps", "LEAFLY!"]) {
      expect(() => toOrderOrigin(junk)).not.toThrow();
      expect(ORDER_ORIGINS).toContain(toOrderOrigin(junk));
    }
    expect(toOrderOrigin("weedmaps")).toBe(DEFAULT_ORDER_ORIGIN);
  });

  it("isOrderOrigin is strict where toOrderOrigin is forgiving", () => {
    // The type guard must NOT accept a value the type does not include, even
    // one toOrderOrigin would happily normalise.
    expect(isOrderOrigin("  leafly  ")).toBe(false);
    expect(isOrderOrigin("LEAFLY")).toBe(false);
  });
});

describe("staff can tell the two apart (the owner's R5)", () => {
  it("every origin has a distinct, non-empty label", () => {
    const labels = ORDER_ORIGINS.map(orderOriginLabel);
    expect(new Set(labels).size).toBe(ORDER_ORIGINS.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });

  it("labels are short enough for a narrow register column", () => {
    for (const o of ORDER_ORIGINS) {
      expect(orderOriginLabel(o).length).toBeLessThanOrEqual(12);
    }
  });

  it("the Leafly label says Leafly", () => {
    expect(orderOriginLabel("leafly")).toBe("Leafly");
  });

  it("every origin has a distinct receipt line", () => {
    const lines = ORDER_ORIGINS.map(orderOriginReceiptLine);
    expect(new Set(lines).size).toBe(ORDER_ORIGINS.length);
  });

  it("the receipt line names the source unambiguously", () => {
    expect(orderOriginReceiptLine("leafly")).toContain("LEAFLY");
    expect(orderOriginReceiptLine("greenway")).toContain("greenwaymarijuana.com");
  });

  it("receipt lines are printable on a 42-column thermal receipt", () => {
    // The shop's receipt printer is 42 columns; a longer line wraps and looks
    // like a defect on a customer-facing document.
    for (const o of ORDER_ORIGINS) {
      expect(orderOriginReceiptLine(o).length).toBeLessThanOrEqual(42);
    }
  });
});

describe("the spoken announcement carries the fact and nothing else", () => {
  it("distinguishes Leafly from the website out loud", () => {
    expect(originAnnouncementText({ origin: "leafly" })).toContain("Leafly");
    expect(originAnnouncementText({ origin: "greenway" })).not.toContain("Leafly");
  });

  it("includes the order number when there is one", () => {
    expect(originAnnouncementText({ origin: "leafly", orderNumber: "A-42" })).toContain("A-42");
  });

  it("omits the number gracefully when there is not", () => {
    for (const n of [null, undefined, "", "   "]) {
      const text = originAnnouncementText({ origin: "greenway", orderNumber: n });
      expect(text).not.toContain("Number ");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it("never speaks a customer name or basket contents", () => {
    // Said out loud across a sales floor with other customers in it.
    const text = originAnnouncementText({ origin: "leafly", orderNumber: "A-42" });
    expect(text.toLowerCase()).not.toContain("gram");
    expect(text.toLowerCase()).not.toContain("thc");
    expect(text).toBe("New Leafly order. Number A-42.");
  });
});

describe("marketplace communication restrictions are inherited, not remembered", () => {
  it("we may NOT email a Leafly customer", () => {
    // Leafly is the sole originator of consumer order communications.
    expect(mayEmailCustomerForOrigin("leafly")).toBe(false);
  });

  it("we MAY email our own customer", () => {
    expect(mayEmailCustomerForOrigin("greenway")).toBe(true);
  });

  it("EVERY marketplace origin suppresses customer email", () => {
    // The rule is derived from the set, so a future marketplace inherits it by
    // joining MARKETPLACE_ORDER_ORIGINS rather than by somebody remembering.
    for (const o of MARKETPLACE_ORDER_ORIGINS) {
      expect(mayEmailCustomerForOrigin(o as OrderOrigin)).toBe(false);
    }
  });

  it("no NON-marketplace origin suppresses customer email", () => {
    for (const o of ORDER_ORIGINS) {
      if (isMarketplaceOrigin(o)) continue;
      expect(mayEmailCustomerForOrigin(o)).toBe(true);
    }
  });

  it("staff email is always allowed", () => {
    // The restriction protects the CUSTOMER's inbox. The shop must always be
    // able to tell its own people an order arrived.
    for (const o of ORDER_ORIGINS) {
      expect(mayEmailStaffForOrigin(o)).toBe(true);
    }
  });
});

describe("every origin is handled everywhere (no silent fallthrough)", () => {
  it("no function returns undefined for any origin", () => {
    for (const o of ORDER_ORIGINS) {
      expect(orderOriginLabel(o)).toBeTypeOf("string");
      expect(orderOriginReceiptLine(o)).toBeTypeOf("string");
      expect(originAnnouncementText({ origin: o })).toBeTypeOf("string");
      expect(resolveOriginSound({ origin: o })).toBeTypeOf("string");
      expect(shouldAnnounceOrigin(o)).toBeTypeOf("boolean");
      expect(isPickupOrigin(o)).toBeTypeOf("boolean");
      expect(isMarketplaceOrigin(o)).toBeTypeOf("boolean");
      expect(mayEmailCustomerForOrigin(o)).toBeTypeOf("boolean");
    }
  });

  it("all of it is deterministic", () => {
    // No clock, no randomness, no I/O: the same origin always decides the same
    // way, which is what makes these rules testable without hardware.
    for (const o of ORDER_ORIGINS) {
      expect(orderOriginLabel(o)).toBe(orderOriginLabel(o));
      expect(resolveOriginSound({ origin: o })).toBe(resolveOriginSound({ origin: o }));
      expect(originAnnouncementText({ origin: o, orderNumber: "X" })).toBe(
        originAnnouncementText({ origin: o, orderNumber: "X" }),
      );
    }
  });
});
