/**
 * REGRESSION — "when I open an order, everything is completely blank. There
 * is no info at all."
 *
 * Reported by the owner mid-slice, about the order detail panel built the
 * round before. He asked the right follow-up question himself:
 *
 *   > "Is this why we can't acknowledge an order? Are we not getting the
 *   >  proper data from Leafly to acknowledge in the first place?"
 *
 * ===========================================================================
 * WHAT WAS ACTUALLY WRONG
 * ===========================================================================
 * `leafly_orders.raw_order` is written TWICE in an order's life:
 *
 *   1. `upsertLeaflyOrderFromWebhook()` stores the `order_submit` webhook.
 *      Per Leafly's own example that is FIVE fields — eventTime, eventType,
 *      orderId, orderIntegrationKey, acknowledgeBy. No customer. No cart.
 *      No totals.
 *
 *   2. `collectLeaflyOrder()` performs the separate, authenticated
 *      `GET /{key}/orders/{id}` and OVERWRITES `raw_order` with the real
 *      Order — which is where cartItems, subtotal, total, firstName and
 *      lastName actually live.
 *
 * When step 2 fails, the row keeps the five-field envelope. The detail view
 * then rendered that envelope through the real reader and produced a form
 * in which every field was null.
 *
 * Measured, not argued (`scripts/recon/blank-detail-probe.ts`):
 *
 *   BLANK FIELDS: 18 / 18
 *   readLeaflyOrderPayload => {"ok":false,
 *                              "reason":"the stored Leafly payload has no order id"}
 *   CONTROL (real Order payload): customerName = "Jane Doe", lines = 1,
 *                                 total = 4803
 *
 * The reader was never broken. The data was never there.
 *
 * ===========================================================================
 * WHY THIS IS A COMPLIANCE DEFECT AND NOT A COSMETIC ONE
 * ===========================================================================
 * Leafly's rule is that acknowledging marks an order "as having been
 * retrieved **in whole** by your system". An order we never downloaded has
 * not been retrieved at all, so acknowledging it:
 *
 *   * asserts something untrue to a third party,
 *   * permanently destroys our only access to the customer's ID images, and
 *   * leaves staff with no cart from which to build the bag.
 *
 * Rendering it as an empty form actively invited that, because an empty
 * form reads as "Leafly sent an order with nothing in it" rather than "we
 * failed to download it".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyDetailPayload,
  readOrderDetail,
} from "@/lib/leafly/order-detail-core";
import { describeUncollectedOrder } from "@/lib/leafly/db-deadline-core";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Leafly's own `order_submit` example, verbatim from the vendored spec.
 * This is the exact object that was sitting in `raw_order` when the owner
 * opened an order and saw nothing.
 */
const SUBMISSION_WEBHOOK = {
  eventTime: "2024-05-01T17:04:00Z",
  eventType: "order_submit",
  orderId: "5f8d0d55-b9a1-4a1e-9f2b-2f1a9c0d3e77",
  orderIntegrationKey: "6a7b8c9d",
  acknowledgeBy: "2024-05-01T17:19:00Z",
};

/** A real Order, of the shape `GET /{key}/orders/{id}` returns. */
const REAL_ORDER = {
  id: "5f8d0d55-b9a1-4a1e-9f2b-2f1a9c0d3e77",
  firstName: "Jane",
  lastName: "Doe",
  cartItems: [{ productName: "Blue Dream", quantity: 1, price: 4803 }],
  total: 4803,
};

describe("the blank order detail the owner reported", () => {
  it("reproduces it: the webhook envelope reads as entirely empty", () => {
    const detail = readOrderDetail(SUBMISSION_WEBHOOK);

    // Every field the panel shows, blank. This is what "completely blank,
    // there is no info at all" looked like from the code's side.
    expect(detail.customerName).toBeNull();
    expect(detail.dateOfBirth).toBeNull();
    expect(detail.phoneNumber).toBeNull();
    expect(detail.emailAddress).toBeNull();
    expect(detail.lines).toHaveLength(0);
    expect(detail.subtotalMinorUnits).toBeNull();
    expect(detail.taxesMinorUnits).toBeNull();
    expect(detail.totalMinorUnits).toBeNull();
  });

  it("proves the reader is not at fault: a real order parses fine", () => {
    // The CONTROL. If this also came back blank the bug would be in the
    // reader, and the fix would be somewhere else entirely.
    const detail = readOrderDetail(REAL_ORDER);
    expect(detail.customerName).toBe("Jane Doe");
    expect(detail.lines).toHaveLength(1);
    expect(detail.totalMinorUnits).toBe(4803);
  });

  it("names the state instead of rendering the blanks", () => {
    expect(classifyDetailPayload(SUBMISSION_WEBHOOK)).toBe("never_fetched");
    expect(classifyDetailPayload(REAL_ORDER)).toBe("collected");
  });

  it("does not mistake a genuinely empty cart for a missing download", () => {
    // The tempting-but-wrong discriminator is "has no cartItems". A real
    // order can legitimately have an empty cart, and calling that "never
    // collected" would send staff chasing a download that already happened.
    expect(classifyDetailPayload({ id: "abc", cartItems: [] })).toBe("collected");
  });
});

describe("the sentence shown in place of the empty form", () => {
  it("blames our collection, not Leafly, and names the order", () => {
    const sentence = describeUncollectedOrder({
      leaflyOrderId: "abc-123",
      windowExpired: false,
    });
    expect(sentence).toContain("abc-123");
    expect(sentence).toMatch(/never managed to download/i);
    // The distinction that stops a pointless call to Leafly support.
    expect(sentence).toMatch(/OUR side/i);
  });

  it("forbids acknowledging an order we do not have", () => {
    const sentence = describeUncollectedOrder({
      leaflyOrderId: "abc-123",
      windowExpired: false,
    });
    expect(sentence).toMatch(/Do NOT acknowledge/);
    // It must say WHY, or it is just an instruction to be ignored.
    expect(sentence).toMatch(/ID images/i);
  });

  it("stops offering a retry once the window has expired", () => {
    const expired = describeUncollectedOrder({
      leaflyOrderId: "abc-123",
      windowExpired: true,
    });
    expect(expired).toMatch(/auto-cancelled/i);
    // Offering a collection that cannot succeed wastes the only minutes
    // the operator has.
    expect(expired).not.toContain("Press “Get the order details from Leafly”");
  });

  it("degrades a blank order id to readable prose", () => {
    const anon = describeUncollectedOrder({ leaflyOrderId: "   ", windowExpired: false });
    expect(anon).toContain("this order");
    expect(anon).not.toMatch(/\s{2,},/);
  });
});

describe("the recovery path is actually wired up", () => {
  it("exposes a collect action that does not acknowledge as a side effect", () => {
    const source = read("src/app/admin/orders/leafly-actions.ts");
    expect(source).toContain("collectLeaflyOrderAction");

    // Isolate the action body and prove it never acknowledges. Collecting
    // is reversible and destroys nothing; acknowledging is a one-way door
    // that ends ID-image access. Fusing them would mean a button labelled
    // "get the details" also burns the window.
    const start = source.indexOf("export async function collectLeaflyOrderAction");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 3_000);
    expect(body).toContain("collectLeaflyOrder");
    expect(body).not.toContain("acknowledgeLeaflyOrder(");
  });

  it("bounds the collect action with the same backstop as acknowledge", () => {
    // A recovery button that hangs reproduces the exact spinner it is
    // offered as the cure for.
    const source = read("src/app/admin/orders/leafly-actions.ts");
    const start = source.indexOf("export async function collectLeaflyOrderAction");
    const body = source.slice(start, start + 3_000);
    expect(body).toContain("withActionDeadline");
  });

  it("threads payloadState from the loader to the panel", () => {
    // Every link in the chain, because a break anywhere returns the panel
    // to rendering blanks.
    expect(read("src/lib/leafly/order-detail-server.ts")).toContain("payloadState");
    expect(read("src/app/admin/orders/leafly-actions.ts")).toContain("payloadState");
    expect(read("src/components/admin/orders/LeaflyOrderDetail.tsx")).toContain(
      "payloadState",
    );
  });

  it("renders the explanation INSTEAD of the empty detail grid", () => {
    const source = read("src/components/admin/orders/LeaflyOrderDetail.tsx");
    expect(source).toContain("never_fetched");
    expect(source).toContain("UncollectedOrder");
    // The recovery control, by the exact label the pure sentence promises.
    expect(source).toContain("Get the order details from Leafly");
  });

  it("gives the panel a real <form> so it survives a hydration failure", () => {
    // This button is the recovery path for an order that is already broken,
    // inside a fifteen-minute window. A control that needs everything else
    // to be healthy is not a recovery control.
    const source = read("src/components/admin/orders/LeaflyOrderDetail.tsx");
    const start = source.indexOf("function UncollectedOrder");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("export function LeaflyOrderDetailPanel"));
    expect(body).toContain("<form action={collect}>");
    expect(body).toContain('type="submit"');
  });
});
