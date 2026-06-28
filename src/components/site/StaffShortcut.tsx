"use client";

/**
 * StaffShortcut
 *
 * A small, unobtrusive "Back office" pill that ONLY appears for a logged-in
 * staff member. After finishing a magic-link sign-in, Supabase returns the user
 * to the Site URL (the home page) already authenticated — this gives them a
 * one-click path to /admin instead of having to type the URL.
 *
 * It is invisible to the public (no session => renders nothing) and does a
 * lightweight client-side session check, so it never affects SSR/SEO.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function StaffShortcut() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!signedIn) return null;

  return (
    <Link
      href="/admin"
      className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-[#7ed957]/50 bg-black/80 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-[#7ed957] shadow-lg shadow-black/50 backdrop-blur transition hover:bg-[#7ed957] hover:text-black"
    >
      <span aria-hidden>🗂</span> Back office
    </Link>
  );
}
