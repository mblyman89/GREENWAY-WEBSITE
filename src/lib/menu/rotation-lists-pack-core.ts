/**
 * src/lib/menu/rotation-lists-pack-core.ts — USAGE-9d (2026-11-26)
 *
 * WHY: the (site) layout sends the fallback-picture rotation lists to every
 * page (D225). Each URL repeated the same 80-character Supabase storage
 * prefix (`https://<project>.supabase.co/storage/v1/object/public/media/product/`):
 * 22 URLs, 2.7 KB decoded (3.9 KB escaped) per page write. The layout now
 * sends `{ p: <shared prefix>, l: { cat: [suffix…] } }` (about 1.0 KB) and the
 * client provider rebuilds the exact same URLs.
 *
 * SAFE: `unpackRotationLists(packRotationLists(x))` equals `x` for any input,
 * including lists with no shared prefix and empty input. Categories, order
 * and URLs are unchanged.
 */

export type RotationLists = Readonly<Record<string, readonly string[]>>;
export type PackedRotationLists = { p: string; l: Record<string, string[]> };

/** Longest common prefix of all URLs, cut back to the last "/" (a path prefix). */
export function sharedUrlPrefix(lists: RotationLists): string {
  const urls = Object.values(lists).flat();
  if (!urls.length) return "";
  let pre = urls[0]!;
  for (const u of urls) {
    let i = 0;
    while (i < pre.length && i < u.length && pre[i] === u[i]) i++;
    pre = pre.slice(0, i);
    if (!pre) return "";
  }
  return pre.slice(0, pre.lastIndexOf("/") + 1);
}

export function packRotationLists(lists: RotationLists): PackedRotationLists {
  const p = sharedUrlPrefix(lists);
  const l: Record<string, string[]> = {};
  for (const [cat, urls] of Object.entries(lists)) l[cat] = urls.map((u) => u.slice(p.length));
  return { p, l };
}

export function unpackRotationLists(packed: PackedRotationLists): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cat, rest] of Object.entries(packed.l ?? {})) out[cat] = rest.map((r) => packed.p + r);
  return out;
}

export function __runRotationListsPackTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`rotation-lists-pack-core FAIL: ${name}`);
    }
  };
  const base = "https://x.supabase.co/storage/v1/object/public/media/product/";
  const lists = { flower: [base + "a-1", base + "a-2"], blunt: [base + "b-1", base + "b-2"] };
  const packed = packRotationLists(lists);
  ok(packed.p === base, "prefix found");
  ok(packed.l.flower![0] === "a-1", "suffix stored");
  ok(JSON.stringify(unpackRotationLists(packed)) === JSON.stringify(lists), "round-trip exact (order kept)");
  ok(JSON.stringify(packed).length < JSON.stringify(lists).length, "smaller");
  const mixed = { a: ["https://a.com/x/1", "/brand/2"] };
  ok(packRotationLists(mixed).p === "", "no shared prefix -> empty");
  ok(JSON.stringify(unpackRotationLists(packRotationLists(mixed))) === JSON.stringify(mixed), "mixed round-trip");
  ok(JSON.stringify(unpackRotationLists(packRotationLists({}))) === "{}", "empty round-trip");
  ok(sharedUrlPrefix({ a: [base + "same", base + "same"] }) === base, "identical URLs cut at the last slash");
  if (failed > 0) throw new Error(`rotation-lists-pack-core: ${failed} failed`);
  return { passed, failed };
}
