/**
 * Look an authority up by an id that came from outside the type system (a
 * stored row, a URL). Returns null rather than throwing so the caller decides
 * what an unknown id means; callers holding a checked AchAuthorityId should
 * reference the record directly instead.
 */
export function achAuthorityById(id: string): AchAuthority | null {
  return ACH_AUTHORITIES.find((a) => a.id === id) ?? null;
}

/**
 * Which mirrored file a citation routes to, or null if it is not an ACH
 * publication. Used by scripts/verify-verbatim-quotes.ts so the router and
 * this registry cannot disagree about a prefix.
 */
export function achPublicationFileFor(cite: string): string | null {
  for (const [prefix, file] of Object.entries(ACH_PUBLICATION_FILES)) {
    if (cite.startsWith(prefix)) return file;
  }
  return null;
}
