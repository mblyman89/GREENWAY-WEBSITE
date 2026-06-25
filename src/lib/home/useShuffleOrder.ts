"use client";

import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Window-cached shuffle order, keyed by a signature, mirroring the menu page's
// "featured shuffle". A fresh random order is rolled once per full page load
// (per signature) and stays stable across React re-renders. The server / first
// client paint returns an empty map so SSR + hydration stay deterministic;
// the real order is applied after mount via useSyncExternalStore subscription.
// ---------------------------------------------------------------------------

type ShuffleWindow = Window & {
  __greenwayHomeShuffle?: Record<string, Record<string, number>>;
};

function createRanks(keys: string[]): Record<string, number> {
  return Object.fromEntries(
    [...keys]
      .map((key) => ({ key, rank: Math.random() }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ key }, index) => [key, index]),
  );
}

function getRanks(signature: string, keys: string[]): Record<string, number> {
  if (typeof window === "undefined") return EMPTY;
  const w = window as ShuffleWindow;
  if (!w.__greenwayHomeShuffle) w.__greenwayHomeShuffle = {};
  if (!w.__greenwayHomeShuffle[signature]) {
    w.__greenwayHomeShuffle[signature] = createRanks(keys);
  }
  return w.__greenwayHomeShuffle[signature];
}

const EMPTY: Record<string, number> = {};

// One-shot subscription: emit a single change after mount so the client swaps
// from the empty (SSR) map to the real shuffled order without warnings.
function subscribe(onChange: () => void) {
  const id = typeof window !== "undefined" ? window.setTimeout(onChange, 0) : undefined;
  return () => {
    if (id !== undefined) window.clearTimeout(id);
  };
}

/**
 * Returns a stable `{ key -> order }` map for the given signature + keys.
 * Empty on the server / first paint, then the rolled order after mount.
 */
export function useShuffleOrder(signature: string, keys: string[]): Record<string, number> {
  return useSyncExternalStore(
    subscribe,
    () => getRanks(signature, keys),
    () => EMPTY,
  );
}
