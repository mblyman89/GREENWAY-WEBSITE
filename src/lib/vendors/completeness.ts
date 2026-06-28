/**
 * src/lib/vendors/completeness.ts
 *
 * A small, dependency-free "how complete is this profile?" scorer for vendors
 * and brands. Used by the vendor list cards and the vendor editor to show a
 * friendly completeness meter + the single most useful "next thing to add".
 *
 * Pure functions only (no DB, no React) so they can run on the server, be unit
 * tested, and be reused anywhere. Logo presence is passed in as a boolean since
 * resolving a media URL is a separate concern.
 */
import type { Vendor, Brand } from "@/lib/vendors/types";

export type CompletenessItem = {
  /** Stable key for the field being checked. */
  key: string;
  /** Plain-language label shown to staff. */
  label: string;
  /** Whether this field is filled in. */
  done: boolean;
  /** Relative importance — higher weights count more toward the score. */
  weight: number;
};

export type CompletenessResult = {
  /** 0–100 rounded percentage. */
  percent: number;
  /** Number of completed items. */
  completed: number;
  /** Total number of tracked items. */
  total: number;
  /** Every tracked field with its done/not-done state. */
  items: CompletenessItem[];
  /** The highest-weight unfinished item, or null when 100%. */
  nextUp: CompletenessItem | null;
  /** A friendly status word for the meter. */
  level: "empty" | "started" | "good" | "complete";
};

function score(items: CompletenessItem[]): CompletenessResult {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const doneWeight = items.reduce((s, i) => (i.done ? s + i.weight : s), 0);
  const percent = totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100);
  const completed = items.filter((i) => i.done).length;

  // The most valuable thing still missing (highest weight, first one).
  const nextUp =
    [...items]
      .filter((i) => !i.done)
      .sort((a, b) => b.weight - a.weight)[0] ?? null;

  const level: CompletenessResult["level"] =
    percent >= 100 ? "complete" : percent >= 70 ? "good" : percent > 0 ? "started" : "empty";

  return { percent, completed, total: items.length, items, nextUp, level };
}

function filled(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
}

/**
 * Completeness for a vendor profile. `hasLogo` is supplied by the caller (the
 * page already resolves logo URLs in a batch).
 */
export function vendorCompleteness(v: Vendor, hasLogo: boolean): CompletenessResult {
  const items: CompletenessItem[] = [
    { key: "logo", label: "Logo image", done: hasLogo, weight: 3 },
    { key: "mission_statement", label: "Mission statement", done: filled(v.mission_statement), weight: 2 },
    { key: "about", label: "About / description", done: filled(v.about), weight: 3 },
    { key: "website", label: "Website link", done: filled(v.website), weight: 1 },
    { key: "email", label: "Contact email", done: filled(v.email), weight: 1 },
    { key: "social", label: "A social link", done: Boolean(v.social_json && Object.values(v.social_json).some((x) => filled(x))), weight: 1 },
  ];
  return score(items);
}

/** Completeness for a brand profile. */
export function brandCompleteness(b: Brand, hasLogo: boolean): CompletenessResult {
  const items: CompletenessItem[] = [
    { key: "logo", label: "Logo image", done: hasLogo, weight: 3 },
    { key: "about", label: "About / description", done: filled(b.about), weight: 3 },
    { key: "product_philosophy", label: "Product philosophy", done: filled(b.product_philosophy), weight: 2 },
    { key: "website", label: "Website link", done: filled(b.website), weight: 1 },
  ];
  return score(items);
}
