"use client";

/**
 * SetPasswordForm — the client half of the invite flow (GW-017 fix).
 *
 * Invite links use Supabase's legacy token flow (PKCE unsupported for
 * invites), so the session tokens arrive in the URL FRAGMENT
 * (#access_token=…&refresh_token=…). Fragments never reach the server, so
 * this must be a client component that:
 *
 *   1. Captures and clears the fragment BEFORE creating the Supabase browser
 *      client (the client is PKCE-only and errors if it sees an implicit
 *      fragment during its own URL detection).
 *   2. Calls setSession(tokens) to establish the session (written to cookies
 *      by @supabase/ssr, so the server sees it too).
 *   3. Shows a password + confirm form and calls
 *      supabase.auth.updateUser({ password }).
 *   4. On success, sends the new staffer into /admin.
 *
 * If there is no fragment, it falls back to an existing cookie session (the
 * link may have gone through /auth/callback, or a signed-in staffer opened
 * this page to set a password) — so this page doubles as "set my password"
 * for anyone already signed in.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  parseAuthFragment,
  validateNewPassword,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/set-password-core";

type Stage = "checking" | "ready" | "no-session" | "link-error" | "saving" | "done";

export function SetPasswordForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React 18 dev double-invoke guard
    ran.current = true;

    (async () => {
      // Read + clear the fragment first — see file comment for why.
      const fragment = parseAuthFragment(window.location.hash);
      if (fragment.kind !== "none") {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      }

      const supabase = createSupabaseBrowserClient();

      if (fragment.kind === "error") {
        setError(fragment.message);
        setStage("link-error");
        return;
      }

      if (fragment.kind === "tokens") {
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: fragment.accessToken,
          refresh_token: fragment.refreshToken,
        });
        if (sessionError || !data.session) {
          setError(
            sessionError?.message ??
              "The sign-in link couldn't be verified. Ask for a fresh invite.",
          );
          setStage("link-error");
          return;
        }
        setEmail(data.session.user.email ?? null);
        setStage("ready");
        return;
      }

      // No fragment — maybe a session already exists.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setEmail(data.session.user.email ?? null);
        setStage("ready");
      } else {
        setStage("no-session");
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateNewPassword(password, confirm);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setStage("saving");
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setStage("ready");
      return;
    }
    setStage("done");
    router.refresh();
    router.push("/admin");
  }

  if (stage === "checking") {
    return (
      <p className="text-center text-sm text-white/50" role="status">
        Checking your invite link&hellip;
      </p>
    );
  }

  if (stage === "link-error" || stage === "no-session") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-4 text-sm text-white/80">
          {stage === "link-error"
            ? error
            : "This page needs a sign-in link to work. Open the invite email on this device, or sign in first."}
        </div>
        <Button href="/admin/login" variant="primary" size="lg" fullWidth>
          Go to sign-in
        </Button>
        <p className="text-center text-xs text-white/40">
          Tip: on the sign-in page you can use &ldquo;email me a sign-in link&rdquo; — that link
          brings you back here signed in.
        </p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 p-4 text-center text-sm text-white/80">
        Password saved. Taking you to the back office&hellip;
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {email && (
        <p className="text-center text-sm text-white/60">
          Choose a password for <span className="font-medium text-[var(--admin-accent)]">{email}</span>
        </p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
          New password
        </label>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
          Confirm password
        </label>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          placeholder="Type it again"
        />
      </div>

      {error && <p className="text-sm text-[var(--admin-orange)]">{error}</p>}

      <Button
        type="submit"
        disabled={stage === "saving"}
        variant="primary"
        size="lg"
        fullWidth
      >
        {stage === "saving" ? "Saving…" : "Save password & enter"}
      </Button>
    </form>
  );
}
