/**
 * src/lib/vendors/social-draft-core.ts — Slice H12a, PURE core.
 *
 * The crawler's social sweep ships one `research_social` reference draft per
 * crawl (crawler/app/pipeline.py) whose body is the human-readable list built
 * by format_social_links():
 *
 *     [Instagram] @greenwaymj — https://www.instagram.com/greenwaymj
 *     [Facebook] — https://www.facebook.com/GreenwayMarijuana
 *     [Linktree] @greenway — https://linktr.ee/greenway
 *
 * Before H12a the vendor page showed a generic "Accept & save" button on that
 * draft, but the accept action's allow-list only knows the prose profile
 * columns — so the owner got "Unsupported field." and the handles went
 * nowhere. These helpers parse that draft body back into the structured
 * SocialLinks shape so a DEDICATED accept action can gap-fill
 * vendors.social_json / brands.social_json (drafts-only lifecycle preserved:
 * a human still clicks Accept, and existing values are never overwritten).
 *
 * NO server imports — unit-tested in tests/compliance.
 */
import type { SocialLinks } from "./types";

/**
 * Platforms that map onto a typed SocialLinks key AND a vendor-form input.
 * The crawler can also emit Pinterest/Threads/Linktree/Snapchat lines; those
 * have no profile field (and would be silently wiped by the profile form's
 * social_json round-trip), so they are reported as `unsupported` for the
 * owner to copy manually instead of being half-saved.
 */
export const SOCIAL_DRAFT_PLATFORMS: ReadonlySet<keyof SocialLinks & string> = new Set([
  "instagram",
  "facebook",
  "twitter",
  "tiktok",
  "youtube",
  "linkedin",
]);

export type ParsedSocialDraft = {
  /** platform key → canonical profile URL (typed platforms only). */
  links: SocialLinks;
  /** Platform labels present in the draft but without a profile field. */
  unsupported: string[];
};

/**
 * One draft line: "[Label] @handle — https://url" (handle optional; the
 * separator is an em dash but en dash / hyphen are tolerated defensively).
 */
const LINE_RE = /^\[([A-Za-z]+)\]\s*(?:@(\S+))?\s*[—–-]\s*(https?:\/\/\S+)\s*$/;

/** Parse a research_social draft body back into structured links. */
export function parseSocialDraft(body: string | null | undefined): ParsedSocialDraft {
  const out: ParsedSocialDraft = { links: {}, unsupported: [] };
  for (const rawLine of String(body ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const platform = m[1].toLowerCase();
    const url = m[3];
    if (SOCIAL_DRAFT_PLATFORMS.has(platform)) {
      // First occurrence wins (the crawler dedupes by canonical URL already).
      if (!out.links[platform]) out.links[platform] = url;
    } else if (!out.unsupported.includes(m[1])) {
      out.unsupported.push(m[1]);
    }
  }
  return out;
}

export type SocialMergeResult = {
  /** Existing social_json with the parsed links gap-filled (never overwritten). */
  merged: SocialLinks;
  /** Platform keys that were empty and are now filled. */
  filled: string[];
  /** Platform keys the draft offered but the profile already had. */
  alreadySet: string[];
};

/**
 * Gap-fill ONLY: a platform the profile already has keeps its current value —
 * the owner's hand-entered handle always wins over a crawled URL. Deterministic
 * key order (SOCIAL_DRAFT_PLATFORMS iteration order) for stable audits.
 */
export function mergeSocialLinks(
  existing: SocialLinks | null | undefined,
  incoming: SocialLinks,
): SocialMergeResult {
  const merged: SocialLinks = { ...(existing ?? {}) };
  const filled: string[] = [];
  const alreadySet: string[] = [];
  for (const key of SOCIAL_DRAFT_PLATFORMS) {
    const candidate = (incoming[key] ?? "").trim();
    if (!candidate) continue;
    const current = (merged[key] ?? "").trim();
    if (current) {
      alreadySet.push(key);
    } else {
      merged[key] = candidate;
      filled.push(key);
    }
  }
  return { merged, filled, alreadySet };
}

/** Human summary for the redirect banner ("Instagram, TikTok saved…"). */
export function summarizeSocialAccept(result: SocialMergeResult, unsupported: string[]): string {
  const parts: string[] = [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (result.filled.length > 0) {
    parts.push(`Saved to the profile: ${result.filled.map(cap).join(", ")}.`);
  } else {
    parts.push("No new channels to save.");
  }
  if (result.alreadySet.length > 0) {
    parts.push(`Already on the profile (kept your values): ${result.alreadySet.map(cap).join(", ")}.`);
  }
  if (unsupported.length > 0) {
    parts.push(`No profile field for: ${unsupported.join(", ")} — copy manually if wanted.`);
  }
  return parts.join(" ");
}
