"use client";

/**
 * src/components/promotions/PublishedRulesProvider.tsx  (Task T / PR 1)
 *
 * Client-side carrier for the back office's PUBLISHED promotion rules.
 *
 * The root layout (a server component) loads the JSON-safe snapshot via
 * loadPublishedRuleSnapshots() and mounts this provider around the whole app,
 * so EVERY client surface that shows or charges a price — the smart cart
 * (CartProvider), product cards, the menu deal filter, the home/specials
 * banners — prices with the SAME rules the register uses. This closes the
 * split-brain (gap G-1) where the website priced with a hard-coded weekday
 * engine while the register priced with the DB rules engine.
 *
 * ZERO-BLANK GUARANTEE: when the provider is absent (tests, storybook-style
 * islands) or the snapshot is empty, consumers fall back to the committed
 * daily-deal seeds — identical behaviour to the legacy static engine.
 */
import { createContext, useContext, useMemo } from "react";
import {
  activeSnapshotsFor,
  seedRuleSnapshots,
  type PublishedRuleSnapshot,
} from "@/lib/promotions/published-rules-core";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";

const RulesContext = createContext<PublishedRuleSnapshot[] | null>(null);

// Module-level fallback: computed once, referentially stable.
let seedFallback: PublishedRuleSnapshot[] | null = null;
function seeds(): PublishedRuleSnapshot[] {
  if (!seedFallback) seedFallback = seedRuleSnapshots();
  return seedFallback;
}

export function PublishedRulesProvider({
  snapshots,
  children,
}: {
  snapshots: PublishedRuleSnapshot[];
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => (snapshots.length ? snapshots : seeds()),
    [snapshots],
  );
  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

/** Every published rule snapshot (all weekdays/windows), seed fallback. */
export function usePublishedRules(): PublishedRuleSnapshot[] {
  return useContext(RulesContext) ?? seeds();
}

/**
 * The rules ACTIVE for the store's current (Pacific) weekday. Returns
 * `undefined` on the server render / first client paint — exactly like
 * useStoreWeekday — so SSG markup matches and badges resolve right after.
 */
export function useActiveDealRules(): PublishedRuleSnapshot[] | undefined {
  const all = usePublishedRules();
  const weekday = useStoreWeekday();
  return useMemo(
    () => (weekday ? activeSnapshotsFor(all, weekday) : undefined),
    [all, weekday],
  );
}
