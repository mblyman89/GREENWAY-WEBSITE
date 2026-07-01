// POST /api/webauthn/register/verify — finish passkey registration: verify the
// authenticator response against the stored challenge and persist the credential
// bound to the signed-in user.
export const runtime = "nodejs";

// Disable cbor-x native acceleration before the SimpleWebAuthn import runs, to
// avoid the Vercel bundler "extractStrings is not a function" error.
process.env.CBOR_NATIVE_ACCELERATION_DISABLED = "true";

import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getStaffSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  rpIdFromOrigin,
  normalizeOrigin,
  isChallengeValid,
  defaultPasskeyLabel,
} from "@/lib/auth/webauthn-core";
import { consumeChallenge, insertCredential } from "@/lib/auth/webauthn-store";

export async function POST(req: Request) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in to add a passkey." }, { status: 401 });
  }

  let body: { handle?: string; response?: RegistrationResponseJSON };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.handle || !body.response) {
    return NextResponse.json({ error: "Missing registration data." }, { status: 400 });
  }

  const challenge = await consumeChallenge(body.handle);
  if (
    !challenge ||
    challenge.kind !== "registration" ||
    challenge.userId !== session.userId ||
    !isChallengeValid(challenge.expiresAt)
  ) {
    return NextResponse.json({ error: "Registration expired. Please try again." }, { status: 400 });
  }

  const origin = normalizeOrigin(new URL(req.url).origin);
  const rpID = rpIdFromOrigin(origin);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ error: "Could not verify this passkey." }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const ua = req.headers.get("user-agent");
  const ok = await insertCredential({
    id: credential.id,
    userId: session.userId,
    webauthnUserId: challenge.webauthnUserId ?? "",
    publicKey: credential.publicKey,
    counter: credential.counter,
    deviceType: credentialDeviceType ?? null,
    backedUp: credentialBackedUp,
    transports: credential.transports ?? null,
    label: defaultPasskeyLabel(ua),
  });
  if (!ok) {
    return NextResponse.json({ error: "Could not save this passkey." }, { status: 500 });
  }

  await recordAudit({
    actorId: session.profile.id,
    action: "auth.passkey.register",
    entityType: "webauthn_credential",
    entityId: credential.id,
  }).catch(() => {});

  return NextResponse.json({ verified: true });
}
