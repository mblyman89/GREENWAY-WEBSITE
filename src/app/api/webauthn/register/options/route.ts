// POST /api/webauthn/register/options — begin passkey registration for the
// currently signed-in staff user. Returns PublicKeyCredentialCreationOptionsJSON
// for @simplewebauthn/browser startRegistration(), and stashes the challenge.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getStaffSession } from "@/lib/auth/session";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  rpIdFromOrigin,
  SUPPORTED_ALGORITHM_IDS,
  PLATFORM_AUTHENTICATOR_SELECTION,
} from "@/lib/auth/webauthn-core";
import { getCredentialsForUser, saveChallenge } from "@/lib/auth/webauthn-store";

export async function POST(req: Request) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in to add a passkey." }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const rpID = rpIdFromOrigin(origin);

  const existing = await getCredentialsForUser(session.userId);

  // Derive a stable WebAuthn user handle from the Supabase user id.
  const webauthnUserId = isoBase64URL.fromUTF8String(session.userId);

  const options = await generateRegistrationOptions({
    rpName: "Greenway Back Office",
    rpID,
    userName: session.email,
    userDisplayName: session.profile.full_name ?? session.email,
    userID: isoBase64URL.toBuffer(webauthnUserId),
    attestationType: "none",
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: PLATFORM_AUTHENTICATOR_SELECTION,
  });

  const handle = await saveChallenge({
    kind: "registration",
    challenge: options.challenge,
    userId: session.userId,
    email: session.email,
    webauthnUserId,
  });
  if (!handle) {
    return NextResponse.json({ error: "Could not start registration. Try again." }, { status: 500 });
  }

  return NextResponse.json({ handle, options });
}
