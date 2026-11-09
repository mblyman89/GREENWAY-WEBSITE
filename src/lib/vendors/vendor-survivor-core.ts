/**
 * src/lib/vendors/vendor-survivor-core.ts - D220 (owner: "I thought I had
 * merged the remaining duplicate vendors. can you help me finish merging all
 * the vendors").
 *
 * PURE. Given the card receiving matched, which card should the delivery land
 * on? A merged (archived) card still carries its license number, so the
 * license lookup in intake keeps finding it: on production 240 lots and 41
 * manifests had landed on merged cards, many AFTER the merge. This walks the
 * merge to the live survivor:
 *
 *   - vendors.merged_into_id (migration 0350) when present;
 *   - otherwise, for an ARCHIVED card only, the note merge_vendors() writes:
 *     `Merged into "X" (<uuid>) on YYYY-MM-DD.` (works before 0350 is applied);
 *   - chains (D -> C -> A) are followed, at most MAX_HOPS, loop-safe;
 *   - a hop to a card we cannot read stops at the last card we could read.
 *
 * The database has the same rule as a trigger (0350 trg_vendor_follow_merge),
 * so even a writer that skips this still lands on the survivor.
 */
import { mergedIntoFromNotes } from "@/lib/purchasing/vendor-menu-coverage-core";

export const MAX_SURVIVOR_HOPS = 16;

export type SurvivorCard = {
  id: string;
  status?: string | null;
  merged_into_id?: string | null;
  internal_notes?: string | null;
};

/** The card this one was merged into, or null when it is a live card. */
export function mergedTargetOf(card: SurvivorCard): string | null {
  const direct = (card.merged_into_id ?? "").trim().toLowerCase();
  if (direct && direct !== card.id.toLowerCase()) return direct;
  if ((card.status ?? "").trim().toLowerCase() !== "archived") return null;
  const fromNote = mergedIntoFromNotes(card.internal_notes);
  return fromNote && fromNote !== card.id.toLowerCase() ? fromNote : null;
}

/**
 * Walk from `startId` to the live survivor. `lookup` returns the card for an id
 * (or undefined when unknown). Returns the start id when it is not merged.
 */
export function resolveSurvivor(
  startId: string,
  lookup: (id: string) => SurvivorCard | undefined,
): { survivorId: string; hops: number; path: string[] } {
  const path = [startId];
  const seen = new Set<string>([startId.toLowerCase()]);
  let cur = startId;
  for (let hops = 0; hops < MAX_SURVIVOR_HOPS; hops += 1) {
    const card = lookup(cur);
    if (!card) break;
    const next = mergedTargetOf(card);
    if (!next || seen.has(next)) break;
    if (!lookup(next)) break;
    seen.add(next);
    path.push(next);
    cur = next;
  }
  return { survivorId: cur, hops: path.length - 1, path };
}
