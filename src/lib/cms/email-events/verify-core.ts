/**
 * src/lib/cms/email-events/verify-core.ts  (Slice 50)
 *
 * PURE webhook signature verification — Node's built-in `crypto` only, no SDK
 * deps and no `server-only` import, so it is tsx-testable. Two schemes:
 *
 *   1. Resend (Svix): headers svix-id, svix-timestamp, svix-signature.
 *      signedContent = `${id}.${timestamp}.${rawBody}`
 *      secret = "whsec_<base64>"  → HMAC-SHA256 over signedContent with the
 *      base64-decoded secret → base64. The svix-signature header is a space-
 *      separated list of `v1,<sig>` entries; a match against ANY passes.
 *      Ref: Resend docs "Verify webhook requests" (Svix scheme).
 *
 *   2. SendGrid (Signed Event Webhook): headers
 *      X-Twilio-Email-Event-Webhook-Signature (base64 ECDSA, DER),
 *      X-Twilio-Email-Event-Webhook-Timestamp. Verify ECDSA P-256/SHA-256 over
 *      `${timestamp}${rawBody}` using the account's verification public key
 *      (base64 DER SPKI). Ref: sendgrid RequestValidator (timestamp + payload,
 *      Ecdsa.verify).
 */
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Resend / Svix HMAC
// ---------------------------------------------------------------------------

export function verifyResendSignature(params: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  secret: string; // "whsec_..." or raw base64
}): boolean {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = params;
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "base64");

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Header is space-separated "v1,<sig> v1a,<sig> ..."; compare each v1 entry.
  for (const part of svixSignature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version === "v1" && sig && timingSafeEqualB64(sig, expected)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// SendGrid ECDSA (P-256 / SHA-256)
// ---------------------------------------------------------------------------

/** Wrap a base64 DER SPKI public key into PEM so crypto can read it. */
export function sendgridPublicKeyToPem(base64Der: string): string {
  const clean = base64Der
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const lines = clean.match(/.{1,64}/g) ?? [clean];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

export function verifySendgridSignature(params: {
  rawBody: string;
  signature: string | null; // X-Twilio-Email-Event-Webhook-Signature (base64 DER)
  timestamp: string | null; // X-Twilio-Email-Event-Webhook-Timestamp
  publicKey: string; // base64 DER SPKI or PEM
}): boolean {
  const { rawBody, signature, timestamp, publicKey } = params;
  if (!signature || !timestamp || !publicKey) return false;

  const pem = publicKey.includes("BEGIN PUBLIC KEY")
    ? publicKey
    : sendgridPublicKeyToPem(publicKey);

  const signed = Buffer.from(`${timestamp}${rawBody}`, "utf8");
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, "base64");
  } catch {
    return false;
  }

  try {
    return crypto.verify(
      "sha256",
      signed,
      { key: pem, dsaEncoding: "der" },
      sig,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function timingSafeEqualB64(a: string, b: string): boolean {
  const ab = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx) — generate keys/signatures locally and round-trip verify.
// ---------------------------------------------------------------------------

export function __runVerifyTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  // --- Resend/Svix HMAC round-trip ---
  const rawSecret = crypto.randomBytes(24);
  const secret = "whsec_" + rawSecret.toString("base64");
  const id = "msg_2abc";
  const ts = "1714557600";
  const body = JSON.stringify({ type: "email.opened", data: { to: ["a@b.com"] } });
  const goodSig = crypto
    .createHmac("sha256", rawSecret)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");

  assert(
    verifyResendSignature({
      rawBody: body,
      svixId: id,
      svixTimestamp: ts,
      svixSignature: `v1,${goodSig}`,
      secret,
    }),
    "resend valid signature passes",
  );
  assert(
    !verifyResendSignature({
      rawBody: body,
      svixId: id,
      svixTimestamp: ts,
      svixSignature: "v1,AAAA",
      secret,
    }),
    "resend bad signature fails",
  );
  // multiple entries, one valid
  assert(
    verifyResendSignature({
      rawBody: body,
      svixId: id,
      svixTimestamp: ts,
      svixSignature: `v1a,deadbeef v1,${goodSig}`,
      secret,
    }),
    "resend multi-entry one-valid passes",
  );

  // --- SendGrid ECDSA round-trip ---
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const pubDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const sgTs = "1714557601";
  const sgBody = JSON.stringify([{ email: "x@y.com", event: "delivered", sg_event_id: "e1" }]);
  const sgSig = crypto
    .sign("sha256", Buffer.from(`${sgTs}${sgBody}`, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    })
    .toString("base64");

  assert(
    verifySendgridSignature({
      rawBody: sgBody,
      signature: sgSig,
      timestamp: sgTs,
      publicKey: pubDerB64,
    }),
    "sendgrid valid signature passes (base64 der key)",
  );
  // tampered body fails
  assert(
    !verifySendgridSignature({
      rawBody: sgBody + " ",
      signature: sgSig,
      timestamp: sgTs,
      publicKey: pubDerB64,
    }),
    "sendgrid tampered body fails",
  );
  // PEM form of the key also works
  assert(
    verifySendgridSignature({
      rawBody: sgBody,
      signature: sgSig,
      timestamp: sgTs,
      publicKey: sendgridPublicKeyToPem(pubDerB64),
    }),
    "sendgrid PEM key works",
  );

   
  console.log("verify-core: all tests passed");
}
