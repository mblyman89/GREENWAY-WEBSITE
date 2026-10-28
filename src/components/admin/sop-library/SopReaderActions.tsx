"use client";

/** Print and back-to-top buttons for the SOP reader (client: window APIs). */
import { useEffect, useState } from "react";

export function PrintSopButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="admin-focus inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[var(--admin-orange-soft)] px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-[var(--admin-orange)] ring-1 ring-[var(--admin-orange)]/40 shadow-[var(--admin-shadow-sm)] transition hover:bg-[var(--admin-orange)] hover:text-black"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
        <path d="M6 14h12v7H6z" />
      </svg>
      Print
    </button>
  );
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 900);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="admin-focus fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--admin-accent)] text-black shadow-[var(--admin-shadow-lg)] transition hover:brightness-110 print:hidden"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="m6 15 6-6 6 6" />
      </svg>
    </button>
  );
}
