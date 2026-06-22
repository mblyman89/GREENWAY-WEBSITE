"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "greenway-age-confirmed-v1";
const STORAGE_EVENT = "greenway-age-confirmed-change";

function subscribeToAgeConfirmation(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
  };
}

function getAgeConfirmationSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerAgeConfirmationSnapshot() {
  return true;
}

export function AgeGate() {
  const isConfirmed = useSyncExternalStore(
    subscribeToAgeConfirmation,
    getAgeConfirmationSnapshot,
    getServerAgeConfirmationSnapshot,
  );

  function confirmAge() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }

  if (isConfirmed) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/[0.88] p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[2.25rem] border border-[var(--greenway)]/35 bg-[#0b0b0b] shadow-2xl shadow-green-950/40">
        <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[var(--greenway)] via-[var(--orange)] to-[var(--gold)]" />
        <div className="p-6 md:p-9">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[var(--greenway)] bg-[var(--greenway-dark)] text-2xl font-black text-[var(--greenway)] shadow-[0_0_28px_rgba(126,217,87,0.28)]">
              21+
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--greenway)]">Greenway Marijuana</p>
              <h2 id="age-gate-title" className="mt-2 text-4xl font-black tracking-tight text-white md:text-5xl">
                Adults only cannabis website.
              </h2>
            </div>
          </div>

          <p className="mt-6 text-base leading-7 text-zinc-300">
            Please confirm you are at least 21 years old before browsing Greenway Marijuana’s website. This confirmation is stored only in your browser and does not collect your birth date, name, or personal information.
          </p>

          <div className="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-300 md:grid-cols-3">
            <div>
              <p className="font-black uppercase tracking-[0.14em] text-[var(--greenway)]">Washington</p>
              <p className="mt-2">For adults 21+ where recreational cannabis is legal.</p>
            </div>
            <div>
              <p className="font-black uppercase tracking-[0.14em] text-[var(--orange)]">No live orders</p>
              <p className="mt-2">Current cart and checkout screens are preview-only.</p>
            </div>
            <div>
              <p className="font-black uppercase tracking-[0.14em] text-[var(--gold)]">Leafly ready</p>
              <p className="mt-2">Live ordering depends on certification and POS approval.</p>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <button
              type="button"
              onClick={confirmAge}
              className="rounded-full bg-[var(--orange)] px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[var(--orange)]/30"
            >
              I am 21 or older
            </button>
            <a
              href="https://www.google.com"
              className="rounded-full border border-white/15 px-7 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)] focus:outline-none focus:ring-4 focus:ring-[var(--greenway)]/25"
            >
              Exit site
            </a>
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-500">
            Age confirmation is a front-end preview safeguard and is not a substitute for required in-store ID verification, state compliance checks, or future production security review.
          </p>
        </div>
      </div>
    </div>
  );
}
