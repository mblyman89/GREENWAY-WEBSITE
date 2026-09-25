#!/usr/bin/env python3
"""SLICE L-43 -- anchor-checked edit of webhook-server.ts and the two route files."""
import sys

def edit(path, pairs):
    s = open(path, encoding="utf8").read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f"{path}: ANCHOR COUNT {n}:\n{old[:200]}"); sys.exit(3)
        s = s.replace(old, new, 1)
    open(path, "w", encoding="utf8").write(s)
    print("edited", path)

edit("src/lib/leafly/webhook-server.ts", [
("""import {
  verifyLeaflySignature,
  findSignatureHeader,
  type LeaflyHmacEncoding,
  type LeaflyHmacVerdict,
} from "./hmac-core";""",
"""import {
  verifyLeaflySignature,
  findSignatureHeader,
  planLeaflyWebhookAdmission,
  type LeaflyHmacEncoding,
  type LeaflyHmacVerdict,
  type LeaflyWebhookAdmission,
} from "./hmac-core";"""),
(""" * Note `createHmac(...).digest(encoding)` \u2014 node renders the SAME digest bytes
 * in whichever encoding is asked for, which is exactly what the core needs to
 * try both candidates without computing the HMAC twice differently.""",
""" * Note `createHmac(...).digest(encoding)`. Since SLICE L-43 the core only ever
 * asks for "hex" (Leafly confirmed lowercase hex), and the type no longer
 * admits anything else."""),
("""export type HandledWebhook = {
  /** The HTTP status the route should return. */
  status: number;""",
"""export type HandledWebhook = {
  /** The HTTP status the route should return. */
  status: number;
  /**
   * SLICE L-43. What was decided about this delivery. `acknowledge_only` is
   * Leafly's expected empty, unsigned delivery: the route answers 2xx and
   * nothing else happened (no event row, no order, no bell).
   */
  admission: LeaflyWebhookAdmission["action"];"""),
("""  const { verdict, bodySha256 } = await verifyInboundLeaflyWebhook(rawBody, headers);
  const parsed = parseLeaflyWebhook(rawBody, expectedEvent);

  if (!verdict.ok) {""",
"""  const { verdict, bodySha256 } = await verifyInboundLeaflyWebhook(rawBody, headers);
  const parsed = parseLeaflyWebhook(rawBody, expectedEvent);
  // SLICE L-43. The three-way decision lives in the pure core. Before L-43
  // this was `if (!verdict.ok) -> 401`, which refused Leafly's expected empty,
  // unsigned delivery and counted it as a failed delivery against us.
  const admission = planLeaflyWebhookAdmission(verdict);

  if (admission.action === "acknowledge_only") {
    // Ben, item 1: an empty body arrives with no signature header, and that is
    // expected. Answer 2xx and do nothing. Deliberately NOT recorded: a row
    // here would carry signature_verified=false and read as a refused
    // signature on the owner's evidence panel -- the false alarm Ben warned
    // about. Deliberately NOT processed: nothing was authenticated.
    return {
      status: admission.status,
      admission: admission.action,
      parsed,
      duplicate: false,
      logLine: `[leafly ${expectedEvent}] empty unsigned delivery \u2014 expected per Leafly, answered ${admission.status}, nothing processed.`,
    };
  }

  if (admission.action === "refuse") {"""),
("""      responseStatus: 401,
    });
    return {
      status: 401,
      parsed,""",
"""      responseStatus: admission.status,
    });
    return {
      status: admission.status,
      admission: admission.action,
      parsed,"""),
("""  if (recorded.ok && recorded.duplicate) {
    return {
      status: 200,
      parsed,""",
"""  if (recorded.ok && recorded.duplicate) {
    return {
      status: 200,
      admission: admission.action,
      parsed,"""),
("""  return {
    status: 200,
    parsed,
    duplicate: false,
    logLine: `[leafly ${expectedEvent}] accepted""",
"""  return {
    status: 200,
    admission: admission.action,
    parsed,
    duplicate: false,
    logLine: `[leafly ${expectedEvent}] accepted"""),
])

edit("src/app/api/webhooks/leafly/order-preview/route.ts", [
("""  // Signature failure is the ONE case the spec allows a non-200 for.
  if (handled.status === 401) {
    console.warn(handled.logLine);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
""",
"""  // Signature failure is the ONE case the spec allows a non-200 for.
  if (handled.status === 401) {
    console.warn(handled.logLine);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // SLICE L-43. Leafly's expected empty, unsigned delivery. There is no cart
  // to price, and nothing was authenticated, so do not touch the menu lookup:
  // answer with the empty, schema-valid preview and stop.
  if (handled.admission === "acknowledge_only") {
    console.log(handled.logLine);
    return NextResponse.json({ cartItems: [], taxes: [] }, { status: 200 });
  }
"""),
])
