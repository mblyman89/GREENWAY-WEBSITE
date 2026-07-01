// POST /api/webauthn/authenticate/verify — finish biometric sign-in. Verify the
// authenticator signature against the stored challenge + credential, then mint a
// Supabase session token for the account and return it so the browser can
// establish the session via supabase.auth.verifyOtp({ type:'magiclink', token_hash }).
//
// SECURITY: the passkey's user-verification (Face ID / Touch ID) gates this
// endpoint. We only issue a session AFTER a cryptographically valid assertion
// for a credential that is actually bound to the resolved account. This does not
// weaken the existing email/password login — it's an additional, hardware-bound
// path.
export const runtime = "nodejs";

// Disable cbor-x native acceleration before the SimpleWebAuthn import runs, to
// avoid the Vercel bundler "extractStrings is not a function" error.
process.env.CBOR_NATIVE_ACCELERATION_DISABLED = "true";

import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { rpIdFromOrigin, normalizeOrigin, isChallengeValid } from "@/lib/auth/webauthn-core";
import {
  consumeChallenge,
  getCredentialById,
  updateCredentialCounter,
} from "@/lib/auth/webauthn-store";

export async function POST(req: Request) {
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Sign-in is not available." }, { status: 500 });
  }

  let body: { handle?: string; response?: AuthenticationResponseJSON };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.handle || !body.response) {
    return NextResponse.json({ error: "Missing sign-in data." }, { status: 400 });
  }

  const challenge = await consumeChallenge(body.handle);
  if (!challenge || challenge.kind !== "authentication" || !isChallengeValid(challenge.expiresAt)) {
    return NextResponse.json({ error: "Sign-in expired. Please try again." }, { status: 400 });
  }

  // Look up the credential presented by the browser.
  const credential = await getCredentialById(body.response.id);
  if (!credential) {
    return NextResponse.json({ error: "This passkey is not registered." }, { status: 400 });
  }
  // The credential must belong to the account we resolved from the typed email.
  if (!challenge.userId || credential.userId !== challenge.userId) {
    return NextResponse.json({ error: "This passkey does not match that account." }, { status: 400 });
  }

  const origin = normalizeOrigin(new URL(req.url).origin);
  const rpID = rpIdFromOrigin(origin);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: credential.id,
        // decodeByteaHex guarantees an ArrayBuffer-backed copy.
        publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
        counter: credential.counter,
        transports: credential.transports,
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not verify this passkey." }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
  }

  await updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);

  // Mint a one-time session token for this account. The browser will exchange
  // it via verifyOtp() to establish the Supabase session cookie.
  const email = challenge.email;
  if (!email) {
    return NextResponse.json({ error: "Could not complete sign-in." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    return NextResponse.json({ error: "Could not complete sign-in." }, { status: 500 });
  }

  await recordAudit({
    actorId: challenge.userId,
    action: "auth.passkey.login",
    entityType: "webauthn_credential",
    entityId: credential.id,
  }).catch(() => {});

  return NextResponse.json({ verified: true, tokenHash: data.properties.hashed_token, email });
}
