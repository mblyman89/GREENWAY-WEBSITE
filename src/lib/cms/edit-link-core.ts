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
