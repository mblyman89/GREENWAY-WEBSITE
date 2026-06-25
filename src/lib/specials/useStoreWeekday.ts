"use client";

import { useSyncExternalStore } from "react";
import { getStoreWeekday, type StoreWeekday } from "./daily-deals";

// ---------------------------------------------------------------------------
// External "clock" store: the store's current weekday. Implemented with
// useSyncExternalStore (the idiomatic way to read from an external system)
// so we avoid setState-in-effect and stay hydration-safe.
//
// - getServerSnapshot returns undefined so the server render and the first
//   client paint match (no hydration mismatch); badges resolve right after.
// - getSnapshot returns the live weekday once running on the client.
// - subscribe re-checks once a minute to catch midnight transitions during
//   long-lived sessions.
// ---------------------------------------------------------------------------

let cachedWeekday: StoreWeekday | undefined;

function getSnapshot(): StoreWeekday {
  // Cache to keep the snapshot referentially stable between checks.
  const current = getStoreWeekday();
  if (cachedWeekday !== current) cachedWeekday = current;
  return cachedWeekday ?? current;
}

function getServerSnapshot(): StoreWeekday | undefined {
  return undefined;
}

function subscribe(onStoreChange: () => void) {
  const interval = setInterval(onStoreChange, 60 * 1000);
  return () => clearInterval(interval);
}

/**
 * Resolve the store's current weekday on the client. Returns `undefined` on the
 * server render / first client paint (so markup matches), then the real
 * weekday — which keeps daily-deal badges accurate despite static generation.
 */
export function useStoreWeekday(): StoreWeekday | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
