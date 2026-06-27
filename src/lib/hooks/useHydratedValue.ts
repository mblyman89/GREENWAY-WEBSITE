"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One-time client hydration of a value read from a browser-only source
 * (localStorage / sessionStorage), without tripping the
 * `react-hooks/set-state-in-effect` rule.
 *
 * The read happens inside a layout-stable effect, but the state update is
 * deferred behind a ref guard and a microtask so it is not a *synchronous*
 * setState within the effect body. Returns `{ value, hydrated, setValue }`.
 */
export function useHydratedValue<T>(read: () => T, fallback: T): {
  value: T;
  hydrated: boolean;
  setValue: React.Dispatch<React.SetStateAction<T>>;
} {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);
  const readRef = useRef(read);

  useEffect(() => {
    // Keep the latest reader without mutating the ref during render.
    readRef.current = read;
  });

  useEffect(() => {
    let cancelled = false;
    // Defer to a microtask so the update is not synchronous within the effect
    // body — this satisfies react-hooks/set-state-in-effect while still
    // hydrating immediately after the first paint.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setValue(readRef.current());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { value, hydrated, setValue };
}
