import "server-only";

/**
 * src/lib/inventory/leafly-badge-server.ts
 *
 * Loads the data behind the Inventory list's LEAFLY badge: the product keys
 * recorded as on Leafly, from `syndication_sync_state` (channel "leafly"),
 * plus the hover text. The rules live in leafly-badge-core.ts.
 *
 * FAILS CLOSED. Any failure returns an empty set, so a lot shows no badge.
 * It never shows a badge it cannot back up, and the Inventory page never
 * breaks because of it.
 */
import { getSyncState } from "@/lib/syndication/engine-store";
import { buildLeaflyProductKeySet, leaflyBadgeTitle } from "./leafly-badge-core";

export type LeaflyBadgeData = { keys: Set<string>; title: string };

/** Store-clock (Pacific) label for the last successful send, or null. */
export function formatLeaflySyncedAt(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });
}

export async function loadLeaflyBadgeData(): Promise<LeaflyBadgeData> {
  try {
    const state = await getSyncState("leafly");
    return {
      keys: buildLeaflyProductKeySet(state.hashes.keys()),
      title: leaflyBadgeTitle(formatLeaflySyncedAt(state.lastSyncedAt)),
    };
  } catch {
    return { keys: new Set(), title: leaflyBadgeTitle(null) };
  }
}
