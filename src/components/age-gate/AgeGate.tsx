"use client";

import Image from "next/image";
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
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/[0.9] p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/10 bg-[var(--charcoal)] px-7 py-9 text-center shadow-2xl shadow-black/50 md:px-10 md:py-11">
        {/* Cursive Greenway wordmark — same mark used in the site header */}
        <div className="flex justify-center">
          <Image
            src="/brand/greenway-marijuana-wordmark-transparent.png"
            alt="Greenway Marijuana"
            width={5891}
            height={1170}
            priority
            className="h-auto w-52 object-contain md:w-60"
            sizes="240px"
          />
        </div>

        <h2
          id="age-gate-title"
          className="mt-5 text-xl font-black uppercase tracking-[0.14em] text-[var(--orange)] md:text-2xl"
        >
          Age Verification
        </h2>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-zinc-300">
          To enter this site, you must be 21 years of age or older.
          <br />
          By entering, you agree to our Terms of Service and Privacy Policy.
        </p>

        <button
          type="button"
          onClick={confirmAge}
          className="mt-7 w-full rounded-full bg-[var(--orange)] px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[var(--orange)]/30"
        >
          Yes, I am 21+
        </button>

        <a
          href="https://www.google.com"
          className="mt-4 inline-block text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-500 transition hover:text-zinc-300"
        >
          No, I am under 21
        </a>

        <p className="mt-6 text-[0.62rem] font-black uppercase tracking-[0.2em] text-zinc-600">
          Please consume responsibly
        </p>
      </div>
    </div>
  );
}
