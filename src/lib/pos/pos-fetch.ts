/**
 * pos/pos-fetch — the ONE network entry point for the register client.
 *
 * Every register request goes through posFetch() instead of calling fetch()
 * with a bare "/api/pos/..." path. That single seam is what lets the SAME
 * source code run in two places:
 *
 *   - Browser PWA at /pos     -> base "" -> relative path -> same-origin.
 *                                Byte-for-byte identical to the old behavior.
 *   - Packaged iPad app       -> base "https://…" -> absolute URL -> reaches
 *                                the real server instead of the app bundle.
 *
 * All URL rules live in the PURE api-base-core module (45 self-tests). This
 * file holds only the small amount of mutable module state needed to remember
 * the base for the life of the page.
 *
 * WHY MODULE STATE AND NOT A REACT CONTEXT
 * The base is a deployment constant: it is decided once at boot and never
 * changes while the app runs. Threading it through ~26 call sites as a prop
 * would be noise and would make every future call site a chance to forget it.
 * Setting it once at startup means a call site CANNOT get it wrong.
 */
import { buildApiUrl, describeApiBase, isCrossOriginApi, resolveApiBase } from "./api-base-core";

/**
 * Same-origin by default. The browser PWA never sets this, so it keeps using
 * relative paths exactly as it always has.
 */
let apiBase = "";

/**
 * Configure the register's server base. Called ONCE during boot.
 *
 * Returns the validation result so the caller can surface a plain-English
 * problem at startup rather than discovering it mid-sale. On ANY invalid
 * value we deliberately fall back to same-origin ("") — a register that still
 * works in the browser is strictly better than one that cannot talk at all.
 */
export function configurePosApiBase(raw: string | null | undefined): ReturnType<typeof resolveApiBase> {
  const result = resolveApiBase(raw);
  apiBase = result.base;
  return result;
}

/** The base currently in use ("" = same-origin). */
export function getPosApiBase(): string {
  return apiBase;
}

/** True when requests leave the page's own origin (i.e. the packaged app). */
export function isPosApiCrossOrigin(): boolean {
  return isCrossOriginApi(apiBase);
}

/** Plain-English description for the status footer / diagnostics. */
export function describePosApiBase(): string {
  return describeApiBase(apiBase);
}

/** The absolute-or-relative URL that a given register path resolves to. */
export function posApiUrl(path: string): string {
  return buildApiUrl(apiBase, path);
}

/**
 * Drop-in replacement for fetch() for every /api/pos/* call.
 *
 * Deliberately a THIN wrapper: it resolves the URL and forwards init unchanged.
 * It does not add headers, retries, or timeouts — the register already has its
 * own carefully-tuned queue/retry behavior in register-client-core, and
 * silently changing request semantics here would be invisible at the counter.
 */
export function posFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(posApiUrl(path), init);
}
