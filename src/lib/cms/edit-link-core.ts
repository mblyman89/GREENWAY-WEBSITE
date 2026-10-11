/**
 * edit-link-core — R43. The ONE tiny, import-free helper the public preview
 * overlay (PreviewEditOverlay, a client component on every page) uses to build
 * a green "✎ Edit" link. It deliberately imports nothing so the public bundle
 * does not pull in the content seed / editor map; the heavy resolving happens
 * server-side in /admin/edit (src/app/admin/edit/page.tsx -> edit-target-core).
 *
 * Link format (also documented in the hub's "Edit buttons & link formats" help):
 *   /admin/edit?block=<content block key>&from=hub|site&path=<public path>
 *   /admin/edit?owner=<banner owner id>&from=…&path=…
 *   /admin/edit?area=<named area>&from=…&path=…
 * Exactly one of block / owner / area is sent (block wins, then owner).
 */
export type EditSpot = { block?: string; owner?: string; area?: string };

export function overlayEditHref(spot: EditSpot, ctx: { from: "hub" | "site"; path: string }): string {
  const params: [string, string][] = [];
  if (spot.block) params.push(["block", spot.block]);
  else if (spot.owner) params.push(["owner", spot.owner]);
  else if (spot.area) params.push(["area", spot.area]);
  params.push(["from", ctx.from]);
  if (ctx.path) params.push(["path", ctx.path]);
  return `/admin/edit?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** Human label for the button / its aria-label. */
export function editSpotLabel(spot: EditSpot): string {
  if (spot.block) return `Edit ${spot.block}`;
  if (spot.owner) return "Edit this banner";
  if (spot.area) return "Edit this section";
  return "Edit";
}

/**
 * Button text for each named area (data-gw-edit-area). The destination of
 * each area lives in edit-target-core EDIT_AREAS; a self-test there asserts
 * both lists have exactly the same keys.
 */
export const AREA_BUTTON_LABEL: Readonly<Record<string, string>> = {
  "home-carousel": "✎ Edit slides",
  "home-typecards": "✎ Edit cards",
  "specials-cards": "✎ Edit deal cards",
  "shop-banner": "✎ Edit banner",
};

/** True for a same-site admin path (the only thing a ✎ Edit click may open). */
export function isSafeAdminHref(href: unknown): href is string {
  return typeof href === "string" && /^\/admin(\/|\?|#|$)/.test(href) && !href.startsWith("//") && !/[\s\\]/.test(href);
}

/** Block hotspots that a surrounding banner's ✎ Edit already covers (no duplicate pills). */
export function bannerCoversBlock(blockKey: string): boolean {
  return /^home\.(category|brand)\./.test(blockKey);
}

export type FocusPlan = {
  /** Content block key from ?block= (focus #block-<key> or #f-<key>). */
  blockKey: string | null;
  /** Element id from the #hash (section-<id>, slide-<id>, loyalty-hero, …). */
  anchorId: string | null;
  /** "← Back to preview" pill, when the owner arrived from a ✎ Edit button. */
  back: { href: string; label: string } | null;
};

const ANCHOR_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,140}$/;
const BLOCK_RE = /^[a-z][a-z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/;
const PUBLIC_PATH_RE = /^\/(?!\/)[^\s\\]*$/;

/**
 * Decide what an admin page should focus after a ✎ Edit landed on it. Reads
 * only the URL (search string incl. "?" and hash incl. "#"); never throws.
 */
export function planFocus(search: string, hash: string): FocusPlan {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    params = new URLSearchParams();
  }
  const rawBlock = params.get("block");
  const blockKey = rawBlock && rawBlock.length <= 120 && BLOCK_RE.test(rawBlock) ? rawBlock : null;
  let anchor: string | null = null;
  try {
    anchor = hash && hash.startsWith("#") ? decodeURIComponent(hash.slice(1)) : null;
  } catch {
    anchor = null;
  }
  const anchorId = anchor && ANCHOR_RE.test(anchor) ? anchor : null;

  const from = params.get("gwfrom");
  const rawPath = params.get("gwpath") ?? "/";
  const path = PUBLIC_PATH_RE.test(rawPath) && rawPath.length <= 300 ? rawPath : "/";
  let back: FocusPlan["back"] = null;
  if (from === "hub") {
    back = { href: `/admin/website-sync?tab=preview&path=${encodeURIComponent(path)}`, label: "← Back to Website Hub preview" };
  } else if (from === "site") {
    back = { href: `/api/admin/preview/enable?path=${encodeURIComponent(path)}`, label: "← Back to the page (preview)" };
  }
  return { blockKey, anchorId, back };
}
