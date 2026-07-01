"use client";

// Browser-side helpers that wrap @simplewebauthn/browser and our API routes.
// Kept tiny and dependency-light so both the login button and the Settings
// passkey manager can share the exact same ceremony calls.
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

export function supportsPasskeys(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** Register a passkey for the currently signed-in user. Throws on failure. */
export async function registerPasskey(): Promise<void> {
  const optRes = await fetch("/api/webauthn/register/options", { method: "POST" });
  const optJson = await optRes.json();
  if (!optRes.ok) throw new Error(optJson.error ?? "Could not start registration.");

  const attResp = await startRegistration({ optionsJSON: optJson.options });

  const verRes = await fetch("/api/webauthn/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: optJson.handle, response: attResp }),
  });
  const verJson = await verRes.json();
  if (!verRes.ok || !verJson.verified) {
    throw new Error(verJson.error ?? "Could not save this passkey.");
  }
}

/**
 * Sign in with a passkey for the given email. Returns the one-time token_hash
 * that the caller exchanges via supabase.auth.verifyOtp() to establish the
 * session (keeps Supabase client ownership of the session in the UI layer).
 */
export async function authenticatePasskey(email: string): Promise<{ tokenHash: string; email: string }> {
  const optRes = await fetch("/api/webauthn/authenticate/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const optJson = await optRes.json();
  if (!optRes.ok) throw new Error(optJson.error ?? "Could not start sign-in.");

  const authResp = await startAuthentication({ optionsJSON: optJson.options });

  const verRes = await fetch("/api/webauthn/authenticate/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: optJson.handle, response: authResp }),
  });
  const verJson = await verRes.json();
  if (!verRes.ok || !verJson.verified || !verJson.tokenHash) {
    throw new Error(verJson.error ?? "Passkey sign-in failed.");
  }
  return { tokenHash: verJson.tokenHash as string, email: verJson.email as string };
}
