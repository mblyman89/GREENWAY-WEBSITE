"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supportsPasskeys, authenticatePasskey } from "@/lib/auth/webauthn-client";

type Mode = "password" | "magic";

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [canBiometric, setCanBiometric] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    // Detect passkey support after mount (browser-only API). Defer the state
    // update out of the effect body to avoid a synchronous cascading render.
    const id = requestAnimationFrame(() => setCanBiometric(supportsPasskeys()));
    return () => cancelAnimationFrame(id);
  }, []);

  async function handleBiometric() {
    setError(null);
    if (!email) {
      setError("Enter your email first, then use Face ID / Touch ID.");
      return;
    }
    setBioBusy(true);
    try {
      const { tokenHash } = await authenticatePasskey(email);
      const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
      if (error) throw new Error(error.message);
      router.refresh();
      router.push("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Biometric sign-in failed.");
      setBioBusy(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("loading");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    router.refresh();
    router.push("/admin");
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("loading");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Send the email link through the callback route so the session is
        // actually established (PKCE code exchange) before landing on /admin.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin`,
      },
    });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 p-4 text-center text-sm text-white/80">
        Check <span className="font-medium text-[#7ed957]">{email}</span> for a
        secure sign-in link.
      </div>
    );
  }

  return (
    <form
      onSubmit={mode === "password" ? handlePassword : handleMagic}
      className="space-y-4"
    >
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
          Email
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[#7ed957]"
          placeholder="you@greenwaymarijuana.com"
        />
      </div>

      {mode === "password" && (
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/50">
            Password
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder="••••••••"
          />
        </div>
      )}

      {error && <p className="text-sm text-[#ff7f00]">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-full bg-[#ff7f00] px-4 py-3 text-sm font-bold uppercase tracking-wide text-black transition hover:brightness-110 disabled:opacity-60"
      >
        {status === "loading"
          ? "Please wait…"
          : mode === "password"
            ? "Sign in"
            : "Email me a sign-in link"}
      </button>

      {canBiometric && mode === "password" && (
        <>
          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[0.65rem] uppercase tracking-wide text-white/30">or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            type="button"
            onClick={handleBiometric}
            disabled={bioBusy || status === "loading"}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#7ed957] transition hover:bg-[#7ed957]/20 disabled:opacity-60"
          >
            <span aria-hidden>👤</span>
            {bioBusy ? "Waiting for Face ID / Touch ID…" : "Sign in with Face ID / Touch ID"}
          </button>
          <p className="text-center text-[0.65rem] text-white/35">
            Enter your email above, then use the passkey saved on this device.
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "password" ? "magic" : "password"));
          setError(null);
        }}
        className="w-full text-center text-xs text-white/50 hover:text-white"
      >
        {mode === "password"
          ? "Use a one-time email link instead"
          : "Use email + password instead"}
      </button>
    </form>
  );
}
