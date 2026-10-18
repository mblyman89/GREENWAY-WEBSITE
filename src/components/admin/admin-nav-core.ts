/**
 * admin-nav-core.ts (Slice 65)
 *
 * PURE, dependency-light helpers for the top-tab navigation. No React, no
 * "server-only", no Next imports — so it is unit-testable with tsx.
 *
 * The nav DATA lives in admin-nav-data.ts; this module only computes derived
 * view-state from that data + the current pathname (grouping, active tab,
 * active item), which the top-nav component renders.
 */

export type NavItemLike = {
  label: string;
  href: string;
  group: string;
  icon: string;
  comingSoon?: boolean;
  /** R73 S3: optional sub-heading inside a dropdown (e.g. Website → Cannabis / Merchandise). */
  subgroup?: string;
};

/**
 * R73 S3: the sub-heading to render ABOVE item `i`, or null. A heading shows
 * at the first item of each run of the same `subgroup`; items with no
 * subgroup never get one (so every other dropdown renders unchanged).
 */
export function subgroupHeaderAt(items: NavItemLike[], i: number): string | null {
  const cur = items[i]?.subgroup;
  if (!cur) return null;
  const prev = i > 0 ? items[i - 1]?.subgroup : undefined;
  return prev === cur ? null : cur;
}

/**
 * Does `pathname` fall under `href`?
 * "/admin" only matches exactly (it's the dashboard root); every other href
 * matches itself or any deeper path. We also guard against false prefix hits
 * like "/admin/loyalty-signups" matching "/admin/loyalty" by requiring the
 * next character (if any) to be a "/".
 */
export function isHrefActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

/**
 * Of a set of items, which one best matches the current path? The BEST match is
 * the active item whose href is the LONGEST (most specific) — so
 * "/admin/inventory/cycle-counts" wins over "/admin/inventory".
 */
export function activeItemHref<T extends NavItemLike>(
  items: T[],
  pathname: string,
): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const it of items) {
    if (isHrefActive(it.href, pathname) && it.href.length > bestLen) {
      best = it.href;
      bestLen = it.href.length;
    }
  }
  return best;
}

export type NavGroupView<T extends NavItemLike> = {
  group: string;
  items: T[];
  /** true when the current path is inside this group (drives active tab). */
  active: boolean;
};

/**
 * Collate visible items into ordered, non-empty groups and flag the active one.
 * `groupOrder` preserves the intended tab order; groups with no visible items
 * are dropped (e.g. a readonly user with nothing in "Admin").
 */
export function buildNavGroups<T extends NavItemLike>(
  items: T[],
  groupOrder: string[],
  pathname: string,
): NavGroupView<T>[] {
  const activeHref = activeItemHref(items, pathname);
  const out: NavGroupView<T>[] = [];
  for (const group of groupOrder) {
    const groupItems = items.filter((i) => i.group === group);
    if (groupItems.length === 0) continue;
    const active =
      activeHref != null && groupItems.some((i) => i.href === activeHref);
    out.push({ group, items: groupItems, active });
  }
  return out;
}

/** Initials for the account chip (from a display name or email). */
export function initialsFrom(nameOrEmail: string): string {
  const parts = (nameOrEmail || "")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "");
  return parts.join("") || "G";
}

// ---------------------------------------------------------------------------
// Tests (run via a temporary tsx harness; see verification notes). Pure.
// ---------------------------------------------------------------------------
export function __runAdminNavTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // isHrefActive
  ok(isHrefActive("/admin", "/admin"), "dashboard exact");
  ok(!isHrefActive("/admin", "/admin/orders"), "dashboard not prefix");
  ok(isHrefActive("/admin/orders", "/admin/orders"), "self match");
  ok(isHrefActive("/admin/orders", "/admin/orders/123"), "child match");
  ok(!isHrefActive("/admin/loyalty", "/admin/loyalty-signups"), "no false prefix");
  ok(isHrefActive("/admin/loyalty", "/admin/loyalty/tiers"), "true child");

  // activeItemHref — longest match wins
  const items: NavItemLike[] = [
    { label: "Inventory", href: "/admin/inventory", group: "Catalog", icon: "" },
    { label: "Cycle", href: "/admin/inventory/cycle-counts", group: "Catalog", icon: "" },
    { label: "Orders", href: "/admin/orders", group: "Operations", icon: "" },
    { label: "Dashboard", href: "/admin", group: "Operations", icon: "" },
  ];
  eq(activeItemHref(items, "/admin/inventory/cycle-counts"), "/admin/inventory/cycle-counts", "longest wins");
  eq(activeItemHref(items, "/admin/inventory"), "/admin/inventory", "parent when exact");
  eq(activeItemHref(items, "/admin"), "/admin", "dashboard active");
  eq(activeItemHref(items, "/admin/nope"), null, "no match null");

  // buildNavGroups — order preserved, empties dropped, active flagged
  const groups = buildNavGroups(items, ["Operations", "Catalog", "Admin"], "/admin/inventory/cycle-counts");
  eq(groups.map((g) => g.group), ["Operations", "Catalog"], "empty Admin dropped, order kept");
  eq(groups.find((g) => g.group === "Catalog")?.active, true, "Catalog active");
  eq(groups.find((g) => g.group === "Operations")?.active, false, "Operations inactive");

  // subgroupHeaderAt (R73 S3)
  const sg: NavItemLike[] = [
    { label: "A", href: "/a", group: "Website", icon: "", subgroup: "Cannabis" },
    { label: "B", href: "/b", group: "Website", icon: "", subgroup: "Cannabis" },
    { label: "C", href: "/c", group: "Website", icon: "", subgroup: "Merchandise" },
  ];
  eq([0, 1, 2].map((i) => subgroupHeaderAt(sg, i)), ["Cannabis", null, "Merchandise"], "headers at run starts");
  eq(subgroupHeaderAt(items, 0), null, "no subgroup -> no header");
  eq(subgroupHeaderAt(sg, 9), null, "out of range -> null");

  // initials
  eq(initialsFrom("Mike Blyman"), "MB", "name initials");
  eq(initialsFrom("owner@greenway.com"), "OG", "email initials");
  eq(initialsFrom(""), "G", "fallback initial");

  console.log(`admin-nav-core: PASSED ${passed} assertions`);
}
