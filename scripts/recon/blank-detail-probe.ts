/**
 * RECON ONLY (L-25). Run the SPEC'S OWN submission-webhook example through the
 * REAL production `readOrderDetail`, to establish by measurement what the owner
 * sees when he opens an order whose payload was never collected.
 *
 * Not a test. Evidence.
 */
import { readOrderDetail } from "../../src/lib/leafly/order-detail-core";
import { readLeaflyOrderPayload } from "../../src/lib/leafly/bridge-core";

// docs/leafly-specs/order-api-v1.openapi.json — the order_submit webhook body,
// verbatim. Five fields. This is what `upsertLeaflyOrderFromWebhook` writes
// into `leafly_orders.raw_order` the moment an order arrives.
const SUBMISSION_WEBHOOK = {
  eventTime: "2023-08-11T21:32:33.517Z",
  eventType: "order_submit",
  orderId: "e4dcae37-32d0-4498-ab3d-0c9a93c5f8ea",
  orderIntegrationKey: "iAYK0fC0rjQIGJQKIJvzRnObjElOC40PhLEK9PEUgFFm",
  acknowledgeBy: "2023-08-11T21:47:33.517Z",
};

const detail = readOrderDetail(SUBMISSION_WEBHOOK);

console.log("=== readOrderDetail(order_submit webhook) ===");
let nulls = 0;
let total = 0;
for (const [k, v] of Object.entries(detail)) {
  total += 1;
  const blank = v === null || (Array.isArray(v) && v.length === 0);
  if (blank) nulls += 1;
  console.log(`  ${blank ? "BLANK" : "value"}  ${k} = ${JSON.stringify(v)}`);
}
console.log("");
console.log(`BLANK FIELDS: ${nulls} / ${total}`);
console.log("");

const payload = readLeaflyOrderPayload(SUBMISSION_WEBHOOK);
console.log("=== readLeaflyOrderPayload (the receipt / local-order builder) ===");
console.log(" ", JSON.stringify(payload));
console.log("");

// And the CONTROL: a real Order payload, to prove the reader itself works.
const REAL_ORDER = {
  id: "e4dcae37-32d0-4498-ab3d-0c9a93c5f8ea",
  status: "pending",
  firstName: "Jane",
  lastName: "Doe",
  cartItems: [{ name: "Blue Dream 3.5g", quantity: 1, totalPrice: 35.0 }],
  subtotal: 35.0,
  taxes: 13.03,
  total: 48.03,
};
const control = readOrderDetail(REAL_ORDER);
console.log("=== CONTROL: readOrderDetail(real Order payload) ===");
console.log(`  customerName = ${JSON.stringify(control.customerName)}`);
console.log(`  lines        = ${control.lines.length}`);
console.log(`  total        = ${JSON.stringify(control.totalMinorUnits)}`);
