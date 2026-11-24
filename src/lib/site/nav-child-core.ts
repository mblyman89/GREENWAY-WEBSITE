/**
 * src/lib/site/nav-child-core.ts — USAGE-9b (2026-11-26)
 *
 * WHY: the desktop "Shop" dropdown renders 17 category links in the header of
 * every page. As server JSX, each one serialized its whole tree into the RSC
 * payload (four class strings plus the arrow span): about 730 bytes per row,
 * about 12 KB per page write. NavChildLink is a client component, so a row
 * is a client reference plus {href,label,helper} (about 150 bytes). The SSR
 * HTML is unchanged.
 */

/** Props a client row may receive: plain strings only (serializable, tiny). */
export const NAV_CHILD_PROPS = ["href", "label", "helper"] as const;

/** Count server-side `group/child` trees in a component source (want 0 in NavLink). */
export function inlineChildTreeCount(source: string): number {
  return (source.match(/group\/child rounded-2xl/g) ?? []).length;
}

export function __runNavChildTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`nav-child-core FAIL: ${name}`);
    }
  };
  ok(inlineChildTreeCount('className="group/child rounded-2xl border"') === 1, "counts an inline tree");
  ok(inlineChildTreeCount("<NavChildLink href={a} />") === 0, "a client reference is not a tree");
  ok(NAV_CHILD_PROPS.length === 3, "three string props");
  ok(!NAV_CHILD_PROPS.includes("children" as never), "no children prop (no JSX crosses the boundary)");
  if (failed > 0) throw new Error(`nav-child-core: ${failed} failed`);
  return { passed, failed };
}
