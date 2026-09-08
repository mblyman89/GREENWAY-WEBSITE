"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  AGE_CONFIRMED_VALUE,
  AGE_GATE_ELEMENT_ATTRIBUTE,
  AGE_STORAGE_EVENT,
  AGE_STORAGE_KEY,
  isAgeConfirmedValue,
  isAgeGateExemptPath,
} from "@/lib/age-gate/age-gate-core";

function subscribeToAgeConfirmation(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(AGE_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(AGE_STORAGE_EVENT, onStoreChange);
  };
}

function getAgeConfirmationSnapshot() {
  // Reading localStorage THROWS (not returns null) in Safari private browsing
  // and wherever a site is denied storage. Treat any failure as unconfirmed so
  // the gate shows: over-prompting an adult is a nuisance, letting an
  // unverified visitor through is a compliance failure.
  try {
    return isAgeConfirmedValue(window.localStorage.getItem(AGE_STORAGE_KEY));
  } catch {
    return false;
  }
}

/**
 * SLICE I — the server snapshot now reports UNCONFIRMED.
 *
 * It used to return `true`, which meant the modal rendered nothing during SSR
 * and could only appear after React hydrated. Measurement on the live deploy
 * (mobile, 4x CPU, 1.6 Mbps) showed the consequence: the final
 * largest-contentful-paint candidate was this component's own paragraph at
 * t=4804ms, and the served HTML contained no age-gate markup at all. The
 * store's LCP was being defined by an element that did not exist until
 * hydration of a 3.3 MB payload had finished.
 *
 * Returning `false` renders the gate into the server HTML, so it paints with
 * the first paint. Returning customers do not see it, because the inline
 * bootstrap in `<head>` stamps `data-age-confirmed` on `<html>` before the
 * first paint and a `display: none` rule in globals.css hides it during the
 * same style pass — no flash, no JavaScript required.
 *
 * There is no hydration mismatch to worry about: the server always renders the
 * gate, and the client's first render is what `useSyncExternalStore` reports
 * from `getServerSnapshot` during hydration. React then re-renders with the
 * real localStorage value and unmounts the modal for confirmed visitors, by
 * which point CSS has already hidden it.
 */
function getServerAgeConfirmationSnapshot() {
  return false;
}

export function AgeGate() {
  const pathname = usePathname();
  const isConfirmed = useSyncExternalStore(
    subscribeToAgeConfirmation,
    getAgeConfirmationSnapshot,
    getServerAgeConfirmationSnapshot,
  );

  function confirmAge() {
    try {
      window.localStorage.setItem(AGE_STORAGE_KEY, AGE_CONFIRMED_VALUE);
    } catch {
      // Storage denied. The modal still closes for this page view via the
      // event below; the visitor will simply be asked again next time.
    }
    // The pre-paint bootstrap only runs on a fresh document load, so stamp the
    // attribute here too. Otherwise the CSS rule would not match until the next
    // navigation and a confirmed visitor could see the gate flash on a
    // client-side route change.
    document.documentElement.setAttribute("data-age-confirmed", "true");
    window.dispatchEvent(new Event(AGE_STORAGE_EVENT));
  }

  // The age gate is for customers only — never block the staff back office
  // or the register (the POS has its own, stronger ID gate per sale).
  if (isAgeGateExemptPath(pathname)) return null;

  if (isConfirmed) return null;

  return (
    <div
      // Hook for the pre-paint CSS rule. Keyed off a data attribute rather than
      // the Tailwind classes below so that restyling the modal cannot silently
      // break the no-flash behaviour.
      {...{ [AGE_GATE_ELEMENT_ATTRIBUTE]: "" }}
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
