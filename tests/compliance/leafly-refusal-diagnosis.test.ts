/**
 * tests/compliance/leafly-refusal-diagnosis.test.ts
 *
 * SLICE L-16 — THE PANEL MUST NOT ACCUSE LEAFLY ON EVIDENCE IT HAS NOT READ.
 *
 * ===========================================================================
 * THE DEFECT THESE TESTS LOCK SHUT
 * ===========================================================================
 * The owner opened the back-office online orders dashboard and read this:
 *
 *   > Deliveries we refused / 6
 *   > "Leafly is reaching us but the signature didn't match. That almost
 *   >  always means the webhook HMAC key here doesn't match the one Leafly
 *   >  issued. Orders are being turned away."
 *
 * Every clause after the number was manufactured. The panel had a COUNT of
 * refused deliveries and nothing else; it had never read
 * `leafly_webhook_events.rejection_reason`, which has been written since
 * migration 0225. So it printed the single explanation it knew, unconditionally,
 * for all seven possible causes.
 *
 * In the one case it actually fired, it was wrong. Those six refusals were
 * `missing_header` — requests that arrived with no signature header at all,
 * several of them probes run by hand against the public URL while diagnosing
 * an unrelated problem. A request carrying no signature involved no key, and
 * therefore cannot be evidence about a key. A fully healthy integration was
 * reporting a credential fault, and the remedy it recommended — re-copy or
 * rotate the HMAC key — would have broken a working one.
 *
 * Worse, the same screen simultaneously showed "SIGNED DELIVERIES FROM LEAFLY:
 * received ✓", which can only be true if a signature had verified. The panel
 * was contradicting itself in two adjacent boxes and the owner, reasonably,
 * believed the louder one.
 *
 * ===========================================================================
 * WHAT IS BEING ASSERTED
 * ===========================================================================
 *  1. DRIFT PIN. `LEAFLY_REFUSAL_REASONS` is a hand-copied literal (the core
 *     is import-free by design). It is pinned here against the real
 *     `LEAFLY_HMAC_FAILURE_REASONS` so an eighth reason cannot be added to
 *     hmac-core and silently fall through to "unrecognised".
 *  2. AGREEMENT WITH hmac-core. Our "ours to fix" set must be exactly
 *     `isLeaflyHmacLocalFault`'s set. Two modules disagreeing about whose
 *     fault a failure is would put two different answers on two screens.
 *  3. NARROWNESS. Exactly one reason of the seven may point at Leafly.
 *  4. THE OWNER'S EXACT DATA. Six `missing_header` rows must not produce a key
 *     accusation, and must not block checkout.
 *  5. NO SELF-CONTRADICTION. Never "contact Leafly" and "this is ours" at once.
 */

import { describe, expect, it } from "vitest";

import {
  LEAFLY_HMAC_FAILURE_REASONS,
  isLeaflyHmacLocalFault,
  type LeaflyHmacFailureReason,
} from "../../src/lib/leafly/hmac-core";

import {
  LEAFLY_REFUSAL_REASONS,
  REFUSAL_RECENCY_MINUTES,
  breakdownRefusals,
  diagnoseRefusals,
  explainEmptyCart,
  refusalMeaning,
  refusalOwner,
  refusalsWithinWindow,
  signatureRefusalBlockingNow,
  __runLeaflyRefusalDiagnosisTests,
  type RefusalRow,
} from "../../src/lib/leafly/refusal-diagnosis-core";

import {
  assessOrderReadiness,
  type ReadinessInput,
} from "../../src/lib/leafly/order-readiness-core";

import { decideOrderability } from "../../src/lib/leafly/orderability-core";

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

const NOW = "2026-09-22T17:00:00.000Z";
const ago = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

const row = (reason: string | null, minutes = 1): RefusalRow => ({
  reason,
  receivedAt: ago(minutes),
  eventType: "order_preview",
});

const diagnose = (
  rows: RefusalRow[],
  opts: { verified?: boolean; keyPresent?: boolean } = {},
) =>
  diagnoseRefusals({
    breakdown: breakdownRefusals(rows),
    verifiedDeliveryEverReceived: opts.verified ?? true,
    hmacKeyPresent: opts.keyPresent ?? true,
  });

/* ------------------------------------------------------------------------- *
 * 1. The embedded self-tests must actually run
 * ------------------------------------------------------------------------- */

describe("the core's own self-tests", () => {
  it("run, and every assertion passes", () => {
    const result = __runLeaflyRefusalDiagnosisTests();
    expect(result.failed).toBe(0);
    // An empty suite that "passes" is the classic way a floor gets defeated.
    expect(result.passed).toBeGreaterThan(600);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. Drift pin — the hand-copied vocabulary must match hmac-core exactly
 * ------------------------------------------------------------------------- */

describe("the refusal vocabulary cannot drift from hmac-core", () => {
  it("lists exactly the reasons hmac-core can produce, in the same order", () => {
    expect([...LEAFLY_REFUSAL_REASONS]).toEqual([...LEAFLY_HMAC_FAILURE_REASONS]);
  });

  it("has a real, actionable sentence for every reason hmac-core can emit", () => {
    for (const reason of LEAFLY_HMAC_FAILURE_REASONS) {
      const meaning = refusalMeaning(reason);
      expect(meaning.trim().length).toBeGreaterThan(40);
      // It must not be the fallback. A new reason silently inheriting
      // "we do not recognise this" is the drift we are guarding against.
      expect(meaning).not.toMatch(/do not recognise/i);
    }
  });

  it("classifies every reason hmac-core can emit — none falls through to unknown", () => {
    for (const reason of LEAFLY_HMAC_FAILURE_REASONS) {
      expect(refusalOwner(reason)).not.toBe("unknown");
    }
  });

  it("agrees with isLeaflyHmacLocalFault about which failures are ours", () => {
    // THIS IS THE IMPORTANT ONE. hmac-core already makes this judgement to
    // choose 503 over 401 ("a 401 tells Leafly your signature is wrong, which
    // for a missing local key is a lie"). If this module disagreed, the HTTP
    // status and the owner-facing advice would tell two different stories
    // about the same delivery.
    for (const reason of LEAFLY_HMAC_FAILURE_REASONS) {
      const hmacSaysOurs = isLeaflyHmacLocalFault(reason as LeaflyHmacFailureReason);
      expect(refusalOwner(reason) === "us").toBe(hmacSaysOurs);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * 3. Narrowness — only ONE reason may ever point at Leafly
 * ------------------------------------------------------------------------- */

describe("only a genuine mismatch may point at Leafly", () => {
  it("mismatch is the sole reason owned by Leafly", () => {
    const leaflyOwned = LEAFLY_REFUSAL_REASONS.filter((r) => refusalOwner(r) === "leafly");
    expect(leaflyOwned).toEqual(["mismatch"]);
  });

  it.each(
    LEAFLY_REFUSAL_REASONS.filter((r) => r !== "mismatch").map((r) => [r] as const),
  )("a wall of %s never tells the owner to contact Leafly", (reason) => {
    const d = diagnose(Array.from({ length: 50 }, () => row(reason)));
    expect(d.contactLeafly).toBe(false);
    expect(d.verdict).not.toBe("key_mismatch");
  });

  it("a single genuine mismatch DOES tell the owner to contact Leafly", () => {
    const d = diagnose([row("mismatch")]);
    expect(d.verdict).toBe("key_mismatch");
    expect(d.contactLeafly).toBe(true);
  });

  it("one real mismatch is not drowned out by fifty scanner hits", () => {
    const rows = [
      ...Array.from({ length: 50 }, () => row("missing_header")),
      row("mismatch"),
    ];
    const d = diagnose(rows);
    expect(d.verdict).toBe("key_mismatch");
    expect(d.breakdown.keyMismatchCount).toBe(1);
    expect(d.breakdown.notLeaflyCount).toBe(50);
  });
});

/* ------------------------------------------------------------------------- *
 * 4. The owner's exact reported data
 * ------------------------------------------------------------------------- */

describe("REPRODUCES the owner's dashboard: six refusals, all unsigned", () => {
  // Reconstructed from his report. "DELIVERIES WE REFUSED: 6", with
  // "SIGNED DELIVERIES FROM LEAFLY: received ✓" in the adjacent box, and
  // "LAST CONTACT: order_preview, probe". The probes were unsigned.
  const sixProbes = Array.from({ length: 6 }, (_, i) => row("missing_header", i + 1));

  it("does NOT accuse the HMAC key — the bug, stated as a test", () => {
    const d = diagnose(sixProbes, { verified: true, keyPresent: true });
    expect(d.verdict).toBe("noise_only");
    expect(d.contactLeafly).toBe(false);
    expect(d.actionIsOurs).toBe(false);
  });

  it("does not repeat the old wording anywhere in its output", () => {
    const d = diagnose(sixProbes);
    const text = `${d.headline} ${d.detail}`;
    expect(text).not.toMatch(/doesn.t match the one Leafly issued/i);
    expect(text).not.toMatch(/orders are being turned away/i);
  });

  it("counts all six and attributes every one of them correctly", () => {
    const b = breakdownRefusals(sixProbes);
    expect(b.total).toBe(6);
    expect(b.notLeaflyCount).toBe(6);
    expect(b.keyMismatchCount).toBe(0);
    expect(b.oursCount).toBe(0);
    expect(b.unknownCount).toBe(0);
    expect(b.buckets).toHaveLength(1);
    expect(b.buckets[0]).toMatchObject({
      reason: "missing_header",
      count: 6,
      owner: "not_leafly",
    });
  });

  it("does not treat them as blocking checkout", () => {
    expect(signatureRefusalBlockingNow(sixProbes, NOW)).toBe(false);
  });

  it("resolves the two-boxes contradiction: verified ✓ AND refusals can both be true", () => {
    // The panel showed both and they are not in conflict — one verified
    // delivery plus six unsigned probes is a coherent, healthy history. The
    // old copy made them look contradictory, which is why the owner believed
    // something was broken.
    const d = diagnose(sixProbes, { verified: true });
    expect(d.verdict).toBe("noise_only");
    expect(d.detail).toMatch(/scanners|health checks|hand-run/i);
  });
});

/* ------------------------------------------------------------------------- *
 * 5. Precedence — the cheapest, most-certainly-ours cause wins
 * ------------------------------------------------------------------------- */

describe("precedence never sends the owner on a wild goose chase", () => {
  it("an unsaved HMAC key is reported as ours, even though everything also mismatches", () => {
    // With no key saved, every signature also fails to match, so both buckets
    // fill. Telling him to email Leafly would be wrong: he simply has not
    // pasted the key yet.
    const d = diagnose([row("mismatch"), row("missing_key")], { keyPresent: false });
    expect(d.verdict).toBe("our_config");
    expect(d.contactLeafly).toBe(false);
    expect(d.actionIsOurs).toBe(true);
  });

  it("a local crypto fault is ours, not Leafly's", () => {
    const d = diagnose([row("digest_unavailable")]);
    expect(d.verdict).toBe("our_config");
    expect(d.contactLeafly).toBe(false);
  });

  it("no refusals at all reads healthy and asks for nothing", () => {
    const d = diagnose([]);
    expect(d.verdict).toBe("healthy");
    expect(d.contactLeafly).toBe(false);
    expect(d.actionIsOurs).toBe(false);
  });

  it("an unrecognised reason is reported as-is, never guessed at", () => {
    const d = diagnose([row("some_future_reason")]);
    expect(d.verdict).toBe("unknown");
    expect(d.contactLeafly).toBe(false);
    expect(d.breakdown.unknownCount).toBe(1);
  });

  it("a missing reason is its own bucket, not folded into a known one", () => {
    const b = breakdownRefusals([row(null), row("")]);
    expect(b.total).toBe(2);
    expect(b.buckets.map((x) => x.reason)).toEqual(["(no reason recorded)"]);
    expect(b.unknownCount).toBe(2);
  });
});

/* ------------------------------------------------------------------------- *
 * 6. Invariants that must hold for EVERY input
 * ------------------------------------------------------------------------- */

describe("invariants across every combination", () => {
  const universe = [...LEAFLY_REFUSAL_REASONS, "banana", null, ""] as const;

  it("never both blames Leafly and claims the fix is ours", () => {
    for (const r of universe) {
      for (const verified of [true, false]) {
        for (const keyPresent of [true, false]) {
          const d = diagnose([row(r as string | null)], { verified, keyPresent });
          expect(d.contactLeafly && d.actionIsOurs).toBe(false);
        }
      }
    }
  });

  it("only ever says contact Leafly when the verdict is key_mismatch", () => {
    for (const r of universe) {
      for (const keyPresent of [true, false]) {
        const d = diagnose([row(r as string | null)], { keyPresent });
        if (d.contactLeafly) expect(d.verdict).toBe("key_mismatch");
      }
    }
  });

  it("reconciles: the four owner counts always sum to the total", () => {
    const rows = universe.map((r) => row(r as string | null));
    const b = breakdownRefusals(rows);
    expect(b.keyMismatchCount + b.oursCount + b.notLeaflyCount + b.unknownCount).toBe(b.total);
    expect(b.total).toBe(rows.length);
    // And the buckets must account for the same total.
    expect(b.buckets.reduce((sum, x) => sum + x.count, 0)).toBe(b.total);
  });

  it("orders buckets deterministically, so the panel does not flicker", () => {
    const rows = [
      row("mismatch"),
      row("missing_header"),
      row("missing_header"),
      row("empty_body"),
    ];
    const once = breakdownRefusals(rows).buckets.map((b) => `${b.reason}:${b.count}`);
    const twice = breakdownRefusals([...rows].reverse()).buckets.map(
      (b) => `${b.reason}:${b.count}`,
    );
    // Largest first, then alphabetically — independent of input order.
    expect(once).toEqual(["missing_header:2", "empty_body:1", "mismatch:1"]);
    expect(twice).toEqual(once);
  });

  it("always produces a headline and a detail somebody can read", () => {
    for (const r of universe) {
      const d = diagnose([row(r as string | null)]);
      expect(d.headline.trim().length).toBeGreaterThan(10);
      expect(d.detail.trim().length).toBeGreaterThan(30);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * 7. Recency — old setup history is not a live fault
 * ------------------------------------------------------------------------- */

describe("recency separates live faults from setup history", () => {
  it("a mismatch from a month ago does not block checkout today", () => {
    expect(signatureRefusalBlockingNow([row("mismatch", 60 * 24 * 30)], NOW)).toBe(false);
  });

  it("a mismatch from a minute ago does block checkout", () => {
    expect(signatureRefusalBlockingNow([row("mismatch", 1)], NOW)).toBe(true);
  });

  it("a row with no timestamp is kept, never assumed to be old", () => {
    const kept = refusalsWithinWindow([{ reason: "mismatch", receivedAt: null }], NOW);
    expect(kept).toHaveLength(1);
  });

  it("an unparseable now returns everything rather than concluding it is ancient", () => {
    const rows = [row("mismatch", 60 * 24 * 365), row("missing_header", 1)];
    expect(refusalsWithinWindow(rows, "not-a-date")).toHaveLength(2);
  });

  it("the window comfortably exceeds Leafly's fifteen-minute auto-cancel", () => {
    // Spec: an unacknowledged order is cancelled after 15 minutes. Anything
    // inside the window could relate to an order being tested right now.
    expect(REFUSAL_RECENCY_MINUTES).toBeGreaterThan(15);
  });

  it("still surfaces an old mismatch in the diagnosis even when it no longer blocks", () => {
    // Blocking and explaining are different questions. History must remain
    // visible — a key rotation leaving no trace is how the evidence is lost.
    const old = [row("mismatch", 60 * 24 * 30)];
    expect(signatureRefusalBlockingNow(old, NOW)).toBe(false);
    expect(diagnose(old).verdict).toBe("key_mismatch");
  });
});

/* ------------------------------------------------------------------------- *
 * 8. The empty cart — the symptom the owner actually reported
 * ------------------------------------------------------------------------- */

describe("the empty cart at 'proceed to preorder' is explained, not shrugged at", () => {
  const healthy = {
    signatureRefusalsRecent: false,
    pickupAvailabilityEnabled: true,
    menuVariantCount: 42,
  };

  it("names the refused signature first, because it fires first in the request path", () => {
    const a = explainEmptyCart({ ...healthy, signatureRefusalsRecent: true });
    expect(a.cause).toBe("signature_refused");
    expect(a.blocking).toBe(true);
  });

  it("names pickup being switched off — the trap that looks like nothing is wrong", () => {
    // PROVEN BY EXECUTION against the real buildLeaflyPreviewResponse:
    //   pickupEnabled=false -> cartItems [] , removed ['removed_not_orderable']
    const a = explainEmptyCart({ ...healthy, pickupAvailabilityEnabled: false });
    expect(a.cause).toBe("pickup_disabled");
    expect(a.blocking).toBe(true);
    expect(a.detail).toMatch(/pickup availability/i);
  });

  it("names a missing published menu", () => {
    const a = explainEmptyCart({ ...healthy, menuVariantCount: 0 });
    expect(a.cause).toBe("menu_unavailable");
    expect(a.blocking).toBe(true);
  });

  it("names unrecognised variants", () => {
    const a = explainEmptyCart({ ...healthy, everyLineUnknown: true });
    expect(a.cause).toBe("variants_unknown");
    expect(a.blocking).toBe(true);
  });

  it("says nothing should be emptying the cart when all four checks pass", () => {
    const a = explainEmptyCart(healthy);
    expect(a.cause).toBe("none");
    expect(a.blocking).toBe(false);
  });

  it("a NaN variant count never reads as a healthy menu", () => {
    const a = explainEmptyCart({ ...healthy, menuVariantCount: Number.NaN });
    expect(a.cause).toBe("menu_unavailable");
  });

  it("a negative variant count never reads as a healthy menu", () => {
    const a = explainEmptyCart({ ...healthy, menuVariantCount: -1 });
    expect(a.cause).toBe("menu_unavailable");
  });

  it("every cause except 'none' is blocking, exhaustively", () => {
    for (const s of [true, false]) {
      for (const p of [true, false]) {
        for (const m of [0, 1, 42, Number.NaN, -5]) {
          for (const u of [true, false, undefined]) {
            const a = explainEmptyCart({
              signatureRefusalsRecent: s,
              pickupAvailabilityEnabled: p,
              menuVariantCount: m,
              everyLineUnknown: u,
            });
            expect(a.blocking).toBe(a.cause !== "none");
          }
        }
      }
    }
  });
});

/* ------------------------------------------------------------------------- *
 * 8b. THE SAFETY INVARIANT — why the empty cart is NOT "fixed" in the route
 * ------------------------------------------------------------------------- */

describe("the obvious fix for the empty cart would be a licence problem", () => {
  it("PROVES pickup_disabled masks doh_restricted, so removals cannot be told apart", () => {
    // This is the finding that decided slice L-16's design. The tempting fix
    // was: "if pickup is off, echo the cart back unchanged so the shopper can
    // still order." It is unsafe. `removed_not_orderable` is the single code
    // used for BOTH the owner's toggle and the WAC 246-70 statutory block, and
    // `decideOrderability` tests the toggle FIRST — so with pickup off, a
    // High-THC product reports `pickup_disabled` and its statutory block is
    // invisible.
    //
    // Echoing the cart back would therefore offer a DOH High-THC product for
    // unattended marketplace pickup, where the registered-patient recognition
    // card cannot be checked. A confusing empty cart is a support call. That
    // would be a licence problem.
    const withPickupOff = decideOrderability({
      inStock: true,
      dohCategory: "high_thc",
      pickupEnabled: false,
    });
    const withPickupOn = decideOrderability({
      inStock: true,
      dohCategory: "high_thc",
      pickupEnabled: true,
    });

    expect(withPickupOff.reason).toBe("pickup_disabled");
    expect(withPickupOn.reason).toBe("doh_restricted");
    // Both refuse. The REASON is what differs, and it is the reason that is lost.
    expect(withPickupOff.availableForPickup).toBe(false);
    expect(withPickupOn.availableForPickup).toBe(false);
  });

  it("a High-THC item is never orderable, whatever the pickup toggle says", () => {
    for (const pickupEnabled of [true, false]) {
      for (const inStock of [true, false]) {
        const d = decideOrderability({ inStock, dohCategory: "high_thc", pickupEnabled });
        expect(d.availableForPickup).toBe(false);
      }
    }
  });

  it("an ordinary in-stock product is orderable only once pickup is switched on", () => {
    expect(
      decideOrderability({ inStock: true, dohCategory: null, pickupEnabled: false })
        .availableForPickup,
    ).toBe(false);
    expect(
      decideOrderability({ inStock: true, dohCategory: null, pickupEnabled: true })
        .availableForPickup,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * 9. Readiness must stop calling a non-selling shop READY
 * ------------------------------------------------------------------------- */

describe("readiness no longer reports READY for a shop that cannot sell", () => {
  const FULLY_SET_UP: ReadinessInput = {
    menuConfigured: true,
    hmacKeyPresent: true,
    orderIntegrationKeyPresent: true,
    verifiedDeliveryEverReceived: true,
    anyOrderEverReceived: false,
    speakerReady: true,
    printerReady: true,
    pickupAvailabilityEnabled: true,
  };

  it("REPRODUCES the false READY: everything done but pickup off", () => {
    // This was the owner's state. Every box ticked, headline "Everything
    // needed is in place", and not one order completable.
    const r = assessOrderReadiness({ ...FULLY_SET_UP, pickupAvailabilityEnabled: false });
    expect(r.ready).toBe(false);
    expect(r.nextStep?.id).toBe("pickup_availability");
    expect(r.headline).not.toMatch(/everything needed is in place/i);
  });

  it("an unreadable pickup setting is never ticked off", () => {
    const r = assessOrderReadiness({ ...FULLY_SET_UP, pickupAvailabilityEnabled: null });
    expect(r.steps.find((s) => s.id === "pickup_availability")?.done).toBe(false);
    expect(r.ready).toBe(false);
  });

  it("with pickup on, the shop reads ready again", () => {
    const r = assessOrderReadiness(FULLY_SET_UP);
    expect(r.ready).toBe(true);
  });

  it("the pickup step tells the owner where the setting lives", () => {
    const r = assessOrderReadiness(FULLY_SET_UP);
    const step = r.steps.find((s) => s.id === "pickup_availability");
    expect(step).toBeDefined();
    expect(step?.blocking).toBe(true);
    expect(step?.detail).toMatch(/sync settings/i);
  });
});
