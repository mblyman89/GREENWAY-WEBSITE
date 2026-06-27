"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

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
      options: { emailRedirectTo: `${window.location.origin}/admin` },
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
