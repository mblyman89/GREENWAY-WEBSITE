/**
 * src/lib/inventory/leafly-badge-core.ts  (owner request: "LEAFLY" badge on
 * the back-office Inventory list, in the Status column)
 *
 * WHAT THE BADGE MEANS, AND WHERE THE TRUTH COMES FROM (verified, not assumed)
 * ==========================================================================
 * 1. A Leafly item id IS the menu product key. The Leafly payload sets
 *    `id: item.id` (payload-core.ts), and the syndication feed sets
 *    `id: item.source_item_id` (menu-feed-core.ts), i.e.
 *    `menu_items.source_item_id`.
 *
 * 2. A lot carries that SAME key. The Cultivera importer writes
 *    `inventory_lots.pos_product_key = lot.posProductKey` (import-service.ts),
 *    and import-lot-core's self-test pins "lot keyed to the menu card
 *    (source_item_id)". identity-server.ts joins on exactly this equality.
 *
 * 3. What is on Leafly is recorded after every SUCCESSFUL send.
 *    `syndication_sync_state` (channel "leafly", migration 0119) holds
 *    `item_hashes`, keyed by the Leafly item id. Every writer updates it
 *    only when Leafly said yes: push.ts (POST/PUT/DELETE), replace-menu,
 *    full-menu and auto-sync. Deletes remove the id. Held-back products are
 *    never written as sent. The Leafly menu browser already uses this record
 *    in production, because Leafly allows reading the menu back only in
 *    sandbox (push.ts getLeaflyMenu).
 *
 * 4. SPLIT PRODUCTS. A product whose sizes collide is sent to Leafly as
 *    several items with ids `<key>--<size-slug>` (collision-split-core.ts,
 *    SPLIT_ID_SEPARATOR = "--"). Those ids never appear on a lot, so the
 *    parent key must count as "on Leafly" too, or a split product would
 *    wrongly show no badge. The separator is repeated here because pure
 *    cores take no imports. A vitest pins the two together.
 *
 * THE HONEST LIMIT. This is OUR record of what Leafly accepted, not a live
 * read of Leafly's storefront. The badge's hover text says so. No badge
 * means only "we have no record of sending it", never a claim that Leafly
 * does not have it.
 */

/** Must equal collision-split-core.ts SPLIT_ID_SEPARATOR (pinned by a vitest). */
export const LEAFLY_SPLIT_ID_SEPARATOR = "--";

/**
 * The parent product key of a split Leafly id, or null when it is not one.
 * Same rule as fix-link-core.splitParentId: LAST marker, with a non-empty
 * parent and a non-empty slug.
 */
export function leaflyParentKey(id: string): string | null {
  const at = id.lastIndexOf(LEAFLY_SPLIT_ID_SEPARATOR);
  if (at <= 0) return null;
  const parent = id.slice(0, at);
  const slug = id.slice(at + LEAFLY_SPLIT_ID_SEPARATOR.length);
  if (parent.length === 0 || slug.length === 0) return null;
  return parent;
}

/**
 * Turn the recorded Leafly item ids into the set of product keys that are
 * on Leafly. Each id counts as itself, and a split id also counts for its
 * parent.
 */
export function buildLeaflyProductKeySet(ids: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id === "") continue;
    keys.add(id);
    const parent = leaflyParentKey(id);
    if (parent !== null) keys.add(parent);
  }
  return keys;
}

/** True only when the lot has a product key AND that key is on Leafly. */
export function isLotOnLeafly(
  posProductKey: string | null | undefined,
  onLeafly: ReadonlySet<string>,
): boolean {
  const key = typeof posProductKey === "string" ? posProductKey.trim() : "";
  if (key === "") return false;
  return onLeafly.has(key);
}

/** Hover text for the badge: what it means and how far to trust it. */
export function leaflyBadgeTitle(lastSyncedAt: string | null | undefined): string {
  const base =
    "This product is on your Leafly menu, according to our record of what Leafly accepted";
  const when = typeof lastSyncedAt === "string" && lastSyncedAt.trim() !== "" ? lastSyncedAt.trim() : null;
  return when
    ? `${base} (last successful send: ${when}).`
    : `${base}.`;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic), registered in the pure runner
// ---------------------------------------------------------------------------

export function __runLeaflyBadgeTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else failures.push(label);
  };

  // Split parent rule.
  ok(LEAFLY_SPLIT_ID_SEPARATOR === "--", "separator is two hyphens");
  ok(leaflyParentKey("pos-abc--3-5g") === "pos-abc", "split id -> parent");
  ok(leaflyParentKey("pos-abc") === null, "single hyphens are not a split");
  ok(leaflyParentKey("pos-45c6e282e0e8") === null, "real POS key is not a split");
  ok(leaflyParentKey("--3-5g") === null, "no parent -> not a split");
  ok(leaflyParentKey("pos-abc--") === null, "no slug -> not a split");
  ok(leaflyParentKey("a--b--7g") === "a--b", "LAST marker wins");

  // Set building.
  const set = buildLeaflyProductKeySet(["pos-1", " pos-2 ", "pos-3--1g", "pos-3--3-5g", "", "   "]);
  ok(set.has("pos-1"), "plain id is on Leafly");
  ok(set.has("pos-2"), "id is trimmed");
  ok(set.has("pos-3"), "split parent counts");
  ok(set.has("pos-3--1g"), "split id itself kept");
  ok(!set.has(""), "blank ids ignored");
  ok(set.size === 5, "exact set size");
  ok(buildLeaflyProductKeySet([]).size === 0, "empty record -> empty set");
  ok(buildLeaflyProductKeySet(new Map([["k", "h"]]).keys()).has("k"), "accepts map keys");
  ok(buildLeaflyProductKeySet([42 as unknown as string]).size === 0, "non-strings ignored");

  // Lot check.
  ok(isLotOnLeafly("pos-1", set), "matching lot has the badge");
  ok(isLotOnLeafly(" pos-1 ", set), "lot key is trimmed");
  ok(isLotOnLeafly("pos-3", set), "lot of a split product has the badge");
  ok(!isLotOnLeafly("pos-9", set), "unknown key -> no badge");
  ok(!isLotOnLeafly(null, set), "unlinked lot (null) -> no badge");
  ok(!isLotOnLeafly(undefined, set), "undefined -> no badge");
  ok(!isLotOnLeafly("", set), "empty key -> no badge");
  ok(!isLotOnLeafly("pos-", set), "prefix of a key is not a match");
  ok(!isLotOnLeafly("POS-1", set), "keys are case-sensitive, as stored");
  ok(!isLotOnLeafly("", new Set([""])), "empty key never matches, even a bad set");

  // Hover text.
  ok(leaflyBadgeTitle(null).endsWith("accepted."), "no timestamp -> plain sentence");
  ok(leaflyBadgeTitle("2026-01-02T03:04:05Z").includes("last successful send: 2026-01-02T03:04:05Z"), "timestamp shown");
  ok(leaflyBadgeTitle("  ").endsWith("accepted."), "blank timestamp ignored");
  ok(leaflyBadgeTitle(null).includes("our record"), "says it is our record, not a live read");

  if (failures.length > 0) {
    throw new Error(`leafly-badge-core: ${failures.length} failed: ${failures.join("; ")}`);
  }
  return { passed, failed: 0 };
}
