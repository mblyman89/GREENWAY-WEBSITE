// POST /api/webauthn/authenticate/options — begin biometric sign-in. The user
// types their email (no session yet); we resolve the account, generate
// authentication options limited to that account's passkeys, and stash the
// challenge. Returns PublicKeyCredentialRequestOptionsJSON for startAuthentication().
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { rpIdFromOrigin } from "@/lib/auth/webauthn-core";
import { getCredentialsForUser, saveChallenge, purgeExpiredChallenges } from "@/lib/auth/webauthn-store";

// Resolve a Supabase auth user id by email (service-role admin listing).
async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const target = email.trim().toLowerCase();
  // Scan a bounded number of pages so a large tenant still resolves.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Enter your email first." }, { status: 400 });
  }

  await purgeExpiredChallenges().catch(() => {});

  const origin = new URL(req.url).origin;
  const rpID = rpIdFromOrigin(origin);

  const userId = await findUserIdByEmail(email);
  const creds = userId ? await getCredentialsForUser(userId) : [];

  // Privacy: never reveal whether an email exists or has passkeys. If there are
  // no credentials we still return valid options with an empty allow-list; the
  // browser will simply find no matching passkey and the ceremony ends locally.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
  });

  const handle = await saveChallenge({
    kind: "authentication",
    challenge: options.challenge,
    userId: userId ?? null,
    email,
  });
  if (!handle) {
    return NextResponse.json({ error: "Could not start sign-in. Try again." }, { status: 500 });
  }

  return NextResponse.json({ handle, options });
}
