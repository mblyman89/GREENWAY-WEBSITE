/**
 * R73 S3 - server-only loader for the owner-edited merch content.
 *
 * The owner edits it in the cannabis admin (Website -> Merchandise). The
 * cannabis site publishes ONLY the published merch values at
 * GET https://greenwaymarijuana.com/api/merch-content (read-only, no drafts,
 * nothing else). This site fetches that, re-cleans every value
 * (resolveMerchContent: unknown keys dropped, unsafe URLs blanked) and caches
 * it 60 s, so a Publish shows here within about a minute.
 *
 * Fails soft: unreachable / bad answer -> the built-in defaults, which are the
 * exact copy this site shipped before S3. No database, no secrets here.
 * Optional env MERCH_CONTENT_URL overrides the source (e.g. a preview URL).
 */
import { cache } from "react";
import { merchDefaults, resolveMerchContent, type MerchContent } from "./site-content-core";
import { feedUrl } from "./feed-core";

export const MERCH_CONTENT_REVALIDATE = 60;

/** D232 M-1: www by default; a bare greenwaymarijuana.com env value is moved to www (feed-core). */
export const contentSourceUrl = () => feedUrl(process.env.MERCH_CONTENT_URL, "/api/merch-content");

export const getMerchContent = cache(async (): Promise<MerchContent> => {
  const url = contentSourceUrl();
  if (!/^https:\/\//.test(url)) return merchDefaults();
  try {
    const res = await fetch(url, { next: { revalidate: MERCH_CONTENT_REVALIDATE }, signal: AbortSignal.timeout(4000), redirect: "manual" });
    if (!res.ok) return merchDefaults();
    const body = (await res.json()) as { content?: unknown } | null;
    return resolveMerchContent(body?.content ?? null);
  } catch {
    return merchDefaults();
  }
});
