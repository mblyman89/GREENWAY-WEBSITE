/**
 * tests/compliance/leafly-order-detail.test.ts — SLICE L-24.
 *
 * ===========================================================================
 * THE DEFECT THIS SUITE DEFENDS AGAINST
 * ===========================================================================
 * The acknowledge button has carried this sentence since L-6:
 *
 *   "...it permanently ends your access to the customer's ID images — so
 *    open the order and read what you need FIRST."
 *
 * The owner tried to comply and found there was no way to open an order. The
 * warning named a consequence correctly and instructed an action the product
 * had never built. This suite exists to stop that gap reopening, and to pin
 * down the two rules that are easy to get subtly wrong: WHERE the media URLs
 * live, and WHEN Leafly will still serve them.
 *
 * Every claim about Leafly's behaviour here is quoted from the vendored spec
 * at `docs/leafly-specs/order-api-v1.openapi.json`, not remembered.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_MEDIA_KINDS,
  LEAFLY_MEDIA_REQUIRED_STATUS,
  MEDIA_KIND_LABEL,
  decideMediaAccess,
  formatDetailMoney,
  isLeaflyMediaKind,
  leaflyMediaUrl,
  maskMedicalCardNumber,
  readOrderDetail,
  toMinorUnits,
  __runLeaflyOrderDetailTests,
} from "@/lib/leafly/order-detail-core";
import { LEAFLY_MAX_ATTEMPTS, LEAFLY_TIMEOUT_MS } from "@/lib/leafly/deadline-core";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// ===========================================================================
// 1. THE SPEC SAYS WHAT WE THINK IT SAYS
// ===========================================================================
/**
 * These assertions read the VENDORED SPEC FILE rather than trusting a comment.
 * The whole slice rests on two claims about Leafly's API, and if either turns
 * out to be a misreading, every sentence this feature shows an operator
 * becomes a confident lie. Reading the file in CI means a spec refresh that
 * changes the rules breaks the build instead of silently invalidating the UI.
 */
describe("L-24 — the vendored spec actually contains the endpoints we built", () => {
  const spec = JSON.parse(read("docs/leafly-specs/order-api-v1.openapi.json")) as {
    paths: Record<string, unknown>;
  };
  const paths = Object.keys(spec.paths);

  it("has a government_id endpoint at the ROOT of the namespace, not under /orders/", () => {
    // The trap this slice most easily could have fallen into. Media does NOT
    // live under `/orders/{id}/`. Asking the wrong path returns 404, and on
    // this integration a 404 reads as "Leafly does not have that order" —
    // a wrong answer a human will act on.
    const gov = paths.find((p) => p.includes("government_id"));
    expect(gov).toBeDefined();
    expect(gov).toContain("{order_integration_key}/government_id/");
    expect(gov).not.toContain("/orders/");
  });

  it("has a medical_id endpoint with the same shape", () => {
    const med = paths.find((p) => p.includes("medical_id"));
    expect(med).toBeDefined();
    expect(med).toContain("{order_integration_key}/medical_id/");
    expect(med).not.toContain("/orders/");
  });

  it("states that media is only available before acknowledgement AND while pending", () => {
    // The sentence the whole access decision is built on. Both halves are
    // asserted separately so a spec that drops either one fails loudly.
    const raw = read("docs/leafly-specs/order-api-v1.openapi.json");
    expect(raw).toContain("only usable prior to order acknowledgement");
    expect(raw).toContain("pending status");
  });

  it("covers every media kind this codebase knows about", () => {
    // Guards against us inventing a third kind, or the spec gaining one we
    // never implemented. Both are silent failures otherwise.
    for (const kind of LEAFLY_MEDIA_KINDS) {
      expect(paths.some((p) => p.includes(kind))).toBe(true);
    }
    const specKinds = paths.filter(
      (p) => p.includes("government_id") || p.includes("medical_id"),
    );
    expect(specKinds).toHaveLength(LEAFLY_MEDIA_KINDS.length);
  });
});

// ===========================================================================
// 2. THE ACCESS WINDOW IS AN "AND", NOT AN "OR"
// ===========================================================================
/**
 * The single most important group in this file.
 *
 * It is tempting to simplify the two spec conditions into one — "if it isn't
 * acknowledged, it's pending" — and that is FALSE in the case that matters
 * most. Leafly auto-cancels an unacknowledged order after fifteen minutes,
 * which produces an order that is unacknowledged AND canceled. That is not an
 * exotic corner; it is what every missed order looks like.
 */
describe("L-24 — when Leafly will still release the customer's ID", () => {
  const base = { leaflyOrderId: "ord_1" };

  it("allows access only when unacknowledged AND pending", () => {
    const v = decideMediaAccess({ ...base, acknowledgedAt: null, leaflyStatus: "pending" });
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("ready");
    expect(v.permanentlyClosed).toBe(false);
  });

  it("refuses once acknowledged, even while still pending", () => {
    const v = decideMediaAccess({
      ...base,
      acknowledgedAt: "2025-01-01T00:00:00Z",
      leaflyStatus: "pending",
    });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("already_acknowledged");
    expect(v.permanentlyClosed).toBe(true);
  });

  it("refuses when unacknowledged but no longer pending — the auto-cancel case", () => {
    // THE case a one-condition check gets wrong. An order Leafly cancelled
    // because nobody acknowledged it in time is unacknowledged and canceled.
    const v = decideMediaAccess({ ...base, acknowledgedAt: null, leaflyStatus: "canceled" });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("not_pending");
    expect(v.permanentlyClosed).toBe(true);
  });

  it("refuses when both conditions fail, and blames the acknowledgement", () => {
    // When both are true the operator is told about the ACKNOWLEDGEMENT,
    // because that is the one a human did on purpose and can learn from.
    // "Not pending" there is true and useless — it names the consequence.
    const v = decideMediaAccess({
      ...base,
      acknowledgedAt: "2025-01-01T00:00:00Z",
      leaflyStatus: "canceled",
    });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("already_acknowledged");
  });

  it("treats a missing order id as OUR fault and NOT permanent", () => {
    // A repaired row would have an id. Calling this permanent would tell the
    // operator to give up on a recoverable data problem.
    const v = decideMediaAccess({ leaflyOrderId: null, acknowledgedAt: null, leaflyStatus: "pending" });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("no_order_id");
    expect(v.permanentlyClosed).toBe(false);
  });

  it("treats whitespace-only ids, timestamps and statuses as absent", () => {
    expect(decideMediaAccess({ leaflyOrderId: "   ", leaflyStatus: "pending" }).code).toBe(
      "no_order_id",
    );
    // A blank acknowledged_at must NOT read as acknowledged — that would hide
    // the images from an order whose window is genuinely open.
    expect(
      decideMediaAccess({ ...base, acknowledgedAt: "   ", leaflyStatus: "pending" }).allowed,
    ).toBe(true);
    expect(decideMediaAccess({ ...base, leaflyStatus: "  " }).code).toBe("not_pending");
  });

  it("accepts PENDING in any casing, because status casing is not ours to police", () => {
    for (const s of ["pending", "PENDING", "Pending", "  pending  "]) {
      expect(decideMediaAccess({ ...base, leaflyStatus: s }).allowed).toBe(true);
    }
  });

  it("never says 'allowed' and 'permanently closed' at the same time", () => {
    // An internal contradiction here would render a warning badge over a
    // working image, or a working button over a dead one.
    const statuses = [null, "", "pending", "PENDING", "confirmed", "ready", "canceled", "pickedUp"];
    const acks = [null, "", "2025-01-01T00:00:00Z"];
    const ids = [null, "", "ord_1"];
    for (const leaflyStatus of statuses) {
      for (const acknowledgedAt of acks) {
        for (const leaflyOrderId of ids) {
          const v = decideMediaAccess({ leaflyOrderId, acknowledgedAt, leaflyStatus });
          expect(v.allowed && v.permanentlyClosed).toBe(false);
          expect(v.message.length).toBeGreaterThan(20);
          // Never a bare code or a template artefact leaking to a human.
          expect(v.message).not.toContain("undefined");
          expect(v.message).not.toContain("null");
        }
      }
    }
  });

  it("tells the operator what to do instead whenever the window is shut", () => {
    // A refusal that does not name an alternative leaves somebody stuck at a
    // counter with a customer in front of them.
    for (const leaflyStatus of ["canceled", "ready", "confirmed"]) {
      const v = decideMediaAccess({ ...base, leaflyStatus });
      expect(v.allowed).toBe(false);
      expect(v.message.toLowerCase()).toContain("physical id");
    }
    const acked = decideMediaAccess({ ...base, acknowledgedAt: "2025-01-01T00:00:00Z" });
    expect(acked.message.toLowerCase()).toContain("physical id");
  });

  it("pins the required status to the spec's word", () => {
    expect(LEAFLY_MEDIA_REQUIRED_STATUS).toBe("pending");
  });
});

// ===========================================================================
// 3. THE URL SHAPE
// ===========================================================================
describe("L-24 — media URLs point where Leafly actually serves them", () => {
  it("puts the kind at the root of the namespace", () => {
    const url = leaflyMediaUrl("https://api.leafly.com/v1/order_integration", "KEY", "ord_1", "government_id");
    expect(url).toBe("https://api.leafly.com/v1/order_integration/KEY/government_id/ord_1");
    expect(url).not.toContain("/orders/");
  });

  it("percent-encodes both the key and the order id", () => {
    // The key is owner-typed and the id arrives from a webhook. An unencoded
    // slash in either silently retargets the request at a different endpoint,
    // which is the exact reasoning leaflyAcknowledgeUrl already documents.
    const url = leaflyMediaUrl("https://b.test", "a/b?c", "x y/z", "medical_id");
    expect(url).toBe("https://b.test/a%2Fb%3Fc/medical_id/x%20y%2Fz");
    // Exactly three slashes after the scheme: base, key, kind, id.
    expect(url.replace("https://", "").split("/")).toHaveLength(4);
  });

  it("uses a different path for each kind", () => {
    const g = leaflyMediaUrl("https://b.test", "k", "o", "government_id");
    const m = leaflyMediaUrl("https://b.test", "k", "o", "medical_id");
    expect(g).not.toBe(m);
  });

  it("validates kinds strictly, so a typo cannot become a request", () => {
    expect(isLeaflyMediaKind("government_id")).toBe(true);
    expect(isLeaflyMediaKind("medical_id")).toBe(true);
    expect(isLeaflyMediaKind("Government_ID")).toBe(false);
    expect(isLeaflyMediaKind("drivers_license")).toBe(false);
    expect(isLeaflyMediaKind("")).toBe(false);
    expect(isLeaflyMediaKind(null)).toBe(false);
    expect(isLeaflyMediaKind(undefined)).toBe(false);
    expect(isLeaflyMediaKind(1)).toBe(false);
    expect(isLeaflyMediaKind({})).toBe(false);
  });

  it("has a human label for every kind", () => {
    for (const k of LEAFLY_MEDIA_KINDS) {
      expect(MEDIA_KIND_LABEL[k].length).toBeGreaterThan(3);
      // The label is for a staff member, so it must not be the wire value.
      expect(MEDIA_KIND_LABEL[k]).not.toBe(k);
    }
  });
});

// ===========================================================================
// 4. MONEY
// ===========================================================================
describe("L-24 — money is converted on the decimal text, not the binary value", () => {
  it("does not lose a cent on a half-cent value", () => {
    // THE defect the core's own self-test caught during development.
    //   Math.round(1.005 * 100) === 100   (a cent silently lost)
    // because 1.005 * 100 is 100.49999999999999 in IEEE 754.
    expect(1.005 * 100).toBeLessThan(100.5); // the trap, demonstrated
    expect(toMinorUnits(1.005)).toBe(101); // the fix, asserted
    expect(toMinorUnits("1.005")).toBe(101);
  });

  it("handles ordinary prices exactly", () => {
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits("100")).toBe(10_000);
    expect(toMinorUnits(0)).toBe(0);
  });

  it("strips currency decoration Leafly or a proxy might add", () => {
    expect(toMinorUnits("$19.99")).toBe(1999);
    expect(toMinorUnits(" 1,234.50 ")).toBe(123_450);
  });

  it("returns null — never zero — for anything unreadable", () => {
    // A missing total and a free item are different facts. Rendering the
    // first as $0.00 is how a bag leaves the counter without payment.
    for (const bad of [null, undefined, "", "   ", "abc", {}, [], NaN, Infinity, true]) {
      expect(toMinorUnits(bad)).toBeNull();
    }
  });

  it("renders a missing amount as a dash and a real zero as $0.00", () => {
    expect(formatDetailMoney(null)).toBe("—");
    expect(formatDetailMoney(0)).toBe("$0.00");
    expect(formatDetailMoney(1999)).toBe("$19.99");
    expect(formatDetailMoney(-1999)).toBe("-$19.99");
    expect(formatDetailMoney(100_000)).toBe("$1,000.00");
  });
});

// ===========================================================================
// 5. READING A STORED PAYLOAD WITHOUT FALLING OVER
// ===========================================================================
describe("L-24 — the detail reader survives every payload it can be handed", () => {
  it("never throws, whatever raw_order contains", () => {
    // `raw_order` is jsonb written by a webhook handler that must answer 200
    // even for a payload it does not recognise, so garbage there is an
    // EXPECTED state. A detail view that throws takes the whole board down.
    for (const junk of [null, undefined, "", "a string", 42, [], [1, 2], true, {}]) {
      expect(() => readOrderDetail(junk)).not.toThrow();
      const d = readOrderDetail(junk);
      expect(Array.isArray(d.lines)).toBe(true);
    }
  });

  it("reads a realistic Leafly order", () => {
    const d = readOrderDetail({
      id: "ord_abc",
      status: "pending",
      firstName: "Jane",
      lastName: "Doe",
      emailAddress: "jane@example.test",
      phoneNumber: "+15095550123",
      dateOfBirth: "1990-04-01",
      subtotal: "40.00",
      taxes: "14.80",
      total: "54.80",
      cartItems: [
        { name: "Blue Dream 3.5g", quantity: 2, totalPrice: "30.00" },
        { name: "Pre-roll", quantity: 1, totalPrice: "10.00" },
      ],
    });
    expect(d.customerName).toBe("Jane Doe");
    expect(d.totalMinorUnits).toBe(5480);
    expect(d.taxesMinorUnits).toBe(1480);
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]?.quantity).toBe(2);
    expect(d.lines[0]?.lineTotalMinorUnits).toBe(3000);
  });

  it("survives an UberEats order, where Leafly documents most fields as absent", () => {
    // The spec warns these orders "share a very restricted set of customer
    // details" — "No email address", masked phone. A reader that assumed
    // those were present would crash on the exact order type Leafly warns
    // about, which is the worst possible place for a crash.
    const d = readOrderDetail({
      id: "ord_ue",
      marketplace: "uberEats",
      status: "pending",
      emailAddress: null,
      phoneNumber: null,
      firstName: "Sam",
      lastName: null,
    });
    expect(d.marketplace).toBe("uberEats");
    expect(d.emailAddress).toBeNull();
    expect(d.phoneNumber).toBeNull();
    expect(d.customerName).toBe("Sam");
  });

  it("keeps an unnamed or malformed cart line rather than dropping it", () => {
    // A line the staff cannot see at all is worse than one they must look up:
    // the bag would go out short and nobody would know why.
    const d = readOrderDetail({
      cartItems: [{ quantity: 3, totalPrice: "9.00" }, null, "junk", { name: "Real", quantity: 1 }],
    });
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]?.name).toBe("Unnamed item");
    expect(d.lines[0]?.quantity).toBe(3);
    // A line with no price shows a dash, not a free item.
    expect(d.lines[1]?.lineTotalMinorUnits).toBeNull();
  });

  it("defaults a missing or nonsensical quantity to one, never zero", () => {
    // Zero would render "0× Blue Dream", which reads as "do not pick this".
    for (const q of [undefined, null, 0, -4, "2", NaN]) {
      const d = readOrderDetail({ cartItems: [{ name: "X", quantity: q }] });
      expect(d.lines[0]?.quantity).toBe(1);
    }
    expect(readOrderDetail({ cartItems: [{ name: "X", quantity: 2.7 }] }).lines[0]?.quantity).toBe(2);
  });
});

// ===========================================================================
// 6. THE MEDICAL CARD NUMBER IS NOT SHOWN IN FULL
// ===========================================================================
describe("L-24 — a medical card number is masked", () => {
  it("shows at most the last four characters", () => {
    const m = maskMedicalCardNumber("WA-987654321");
    expect(m).not.toBeNull();
    expect(m).not.toContain("WA-");
    expect(m?.endsWith("4321")).toBe(true);
  });

  it("masks short values entirely rather than revealing most of them", () => {
    expect(maskMedicalCardNumber("1234")).toBe("••••");
    expect(maskMedicalCardNumber("7")).toBe("•");
  });

  it("returns null for absent values instead of a row of dots", () => {
    expect(maskMedicalCardNumber(null)).toBeNull();
    expect(maskMedicalCardNumber("")).toBeNull();
    expect(maskMedicalCardNumber("   ")).toBeNull();
  });
});

// ===========================================================================
// 7. THE NEW OPERATION IS BUDGETED LIKE THE BUTTON IT PRECEDES
// ===========================================================================
describe("L-24 — media_fetch carries an attended budget", () => {
  it("matches the acknowledge, because it happens in the same fifteen minutes", () => {
    expect(LEAFLY_TIMEOUT_MS.media_fetch).toBe(LEAFLY_TIMEOUT_MS.acknowledge);
    expect(LEAFLY_MAX_ATTEMPTS.media_fetch).toBe(2);
  });

  it("is short enough that nobody gives up and acknowledges blind", () => {
    // The second-order risk: if looking at the ID is slow, the operator's
    // temptation is to skip it — and skipping it destroys the images.
    expect(LEAFLY_TIMEOUT_MS.media_fetch).toBeLessThanOrEqual(15_000);
  });
});

// ===========================================================================
// 8. THE WARNING NOW TELLS THE TRUTH
// ===========================================================================
/**
 * The owner's actual complaint, as an assertion.
 *
 * The acknowledge hint instructs the operator to open the order first. These
 * tests assert that the instruction is now backed by a control that exists
 * and is reachable from the order card. If somebody deletes the panel and
 * leaves the sentence, this fails — which is the state the owner found.
 */
describe("L-24 — the acknowledge warning no longer instructs the impossible", () => {
  const ackCore = read("src/lib/leafly/order-ack-core.ts");
  const panel = read("src/components/admin/orders/LeaflyOrdersPanel.tsx");
  const detail = read("src/components/admin/orders/LeaflyOrderDetail.tsx");

  it("still carries the warning that started this", () => {
    expect(ackCore).toContain("open the order and read what you need FIRST");
  });

  it("renders a detail panel on the order card, so the instruction can be followed", () => {
    expect(panel).toContain("LeaflyOrderDetailPanel");
    expect(panel).toContain("loadLeaflyOrderDetailAction");
  });

  it("offers both ID images from that panel", () => {
    expect(detail).toContain("government_id");
    expect(detail).toContain("medical_id");
  });

  it("never caches an ID image anywhere", () => {
    // The compliance control of this slice. A government ID sitting in a
    // shared tablet's disk cache outlives the fifteen minutes Leafly grants.
    const route = read("src/app/api/admin/leafly-id-image/route.ts");
    expect(route).toContain("no-store");
    expect(route).toContain("force-dynamic");
    expect(route).toContain("orders.manage");
    // next/image would route ID photos through the on-disk optimiser.
    expect(detail).not.toContain('from "next/image"');
  });

  it("fetches media through the deadline helper in binary mode", () => {
    // Both halves matter: the helper (or it can hang for five minutes), and
    // binary (or the image is destroyed by UTF-8 decoding).
    const server = read("src/lib/leafly/order-detail-server.ts");
    expect(server).toContain("leaflyFetchWithDeadline");
    expect(server).toContain("binary: true");
    expect(server).toContain('"media_fetch"');
  });

  it("never logs or persists the image bytes", () => {
    const server = read("src/lib/leafly/order-detail-server.ts");
    // The summary strings may carry a byte COUNT and a status. They must not
    // carry the URL (which contains the integration key) or the bytes.
    expect(server).not.toMatch(/console\.\w+\([^)]*bytes\s*\)/);
    expect(server).not.toMatch(/console\.\w+\([^)]*\burl\b/);
  });
});

// ===========================================================================
// 9. THE SELF-TESTS ARE REGISTERED AND FLOORED
// ===========================================================================
describe("L-24 — the pure self-tests cannot be quietly disarmed", () => {
  it("passes its own suite with no failures", () => {
    const r = __runLeaflyOrderDetailTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(150);
  });

  it("is registered with the CI harness behind a meaningful floor", () => {
    const harness = read("scripts/compliance/run-pure-selftests.ts");
    expect(harness).toContain("__runLeaflyOrderDetailTests()");
    const m = harness.match(
      /assertRan\(\s*"leafly-order-detail-core"\s*,\s*__runLeaflyOrderDetailTests\(\)\s*,\s*(\d+)\s*\)/,
    );
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(140);
  });

  it("raised the deadline core's floor to cover the ninth operation", () => {
    // Adding media_fetch took that core from 667 to 737 assertions. A floor
    // left at 640 would let the entire operation be deleted unnoticed.
    const harness = read("scripts/compliance/run-pure-selftests.ts");
    const m = harness.match(
      /assertRan\(\s*"leafly-deadline-core"\s*,\s*__runLeaflyDeadlineTests\(\)\s*,\s*(\d+)\s*\)/,
    );
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(700);
  });
});
