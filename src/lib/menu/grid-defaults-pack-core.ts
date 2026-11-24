/**
 * USAGE-10a: pack the /menu grid items before they cross into the client.
 *
 * Roughly 100 KB of every /menu write is the same value repeated on thousands
 * of rows (`description: ""`, `inventoryStatus: "in-stock"`, the zero-CBD
 * object, the Supabase image prefix...). The server sends each field's most
 * common value ONCE (`d`) and omits it from every row that carries it; the
 * client restores it before any reader runs, so every card, filter and deal
 * check sees a value identical to the unpacked item. Exact round-trip:
 * a row that lacked a defaulted field lists it in `_a` so it stays absent.
 *
 * Display data only (rule 18): prices are packed like any other field and
 * restored byte-identical; nothing here decides money.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";

type Row = Record<string, unknown>;
export type PackedGridItems = { p: string; d: Row; i: Row[] };

/** Fields never defaulted (identity). */
const NEVER_DEFAULT = new Set(["id", "_a"]);
/** A value must repeat at least this often to be worth a default. */
const MIN_REPEATS = 20;
const IMG_MARK = "~";

function imagePrefix(items: readonly Row[]): string {
  // The most common directory wins; other URLs pass through untouched. A raw
  // URL that already starts with the marker disables packing (exactness).
  const counts = new Map<string, number>();
  for (const r of items) {
    const u = r.imageUrl;
    if (typeof u !== "string" || !u) continue;
    if (u.startsWith(IMG_MARK)) return "";
    const dir = u.slice(0, u.lastIndexOf("/") + 1);
    if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [dir, c] of counts) if (c > n) [best, n] = [dir, c];
  return n >= MIN_REPEATS ? best : "";
}

export function packGridItems(items: readonly GreenwayMenuItem[]): PackedGridItems {
  const rows = items as unknown as Row[];
  const p = imagePrefix(rows);
  const tally = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (NEVER_DEFAULT.has(k) || v === undefined) continue;
      const key = JSON.stringify(v);
      let m = tally.get(k);
      if (!m) tally.set(k, (m = new Map()));
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  const d: Row = {};
  const dj: Record<string, string> = {};
  for (const [k, m] of tally) {
    let best = "";
    let n = 0;
    for (const [v, c] of m) if (c > n) [best, n] = [v, c];
    // Only default when the bytes saved beat the `_a` entries the rows that
    // lack the field would then need.
    const present = [...m.values()].reduce((x, y) => x + y, 0);
    const absent = rows.length - present;
    if (n >= MIN_REPEATS && n * (k.length + best.length + 4) > absent * (k.length + 3) + best.length) {
      d[k] = JSON.parse(best);
      dj[k] = best;
    }
  }
  const keys = Object.keys(d);
  const i = rows.map((r) => {
    const out: Row = {};
    const absent: string[] = [];
    for (const k of keys) if (!(k in r) || r[k] === undefined) absent.push(k);
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue;
      if (k in dj && JSON.stringify(v) === dj[k]) continue;
      out[k] = k === "imageUrl" && p && typeof v === "string" && v.startsWith(p) ? IMG_MARK + v.slice(p.length) : v;
    }
    if (absent.length) out._a = absent;
    return out;
  });
  return { p, d, i };
}

export function unpackGridItems(packed: PackedGridItems): GreenwayMenuItem[] {
  const { p, d, i } = packed;
  const keys = Object.keys(d);
  return i.map((r) => {
    const absent = Array.isArray(r._a) ? (r._a as string[]) : [];
    const out: Row = {};
    for (const k of keys) {
      if (k in r || absent.includes(k)) continue;
      const v = d[k];
      out[k] = v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
    }
    for (const [k, v] of Object.entries(r)) {
      if (k === "_a") continue;
      out[k] = k === "imageUrl" && p && typeof v === "string" && v.startsWith(IMG_MARK) ? p + v.slice(1) : v;
    }
    return out as unknown as GreenwayMenuItem;
  });
}

// ── Self-test ──────────────────────────────────────────────────────────────
export function __runGridDefaultsPackTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`grid-defaults-pack: FAIL ${label}`);
    }
  };
  const base = "https://x.supabase.co/storage/v1/object/public/img/";
  const rows: Row[] = Array.from({ length: 60 }, (_, n) => ({
    id: `p${n}`,
    name: `Item ${n}`,
    description: "",
    inventoryStatus: n % 7 === 0 ? "low-stock" : "in-stock",
    totalCbd: { type: "cbd", unit: "%", value: "0" },
    price: n % 3 === 0 ? 10 : 20 + n,
    ...(n % 5 === 0 ? {} : { posInventoryType: "Concentrate for Inhalation" }),
    ...(n % 4 === 0 ? {} : { imageUrl: `${base}${n}.webp` }),
    ...(n === 9 ? { imageUrl: "/local/fallback.png" } : {}),
  }));
  const items = rows as unknown as GreenwayMenuItem[];
  const packed = packGridItems(items);
  const back = unpackGridItems(JSON.parse(JSON.stringify(packed)));
  const canon = (r: Row) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
  check("exact round-trip on every row", back.every((r, n) => canon(r as unknown as Row) === canon(rows[n]!)));
  check("ids are never defaulted", !("id" in packed.d));
  check("blank description defaulted", packed.d.description === "");
  check("image prefix shared", packed.p === base);
  check("absent optional field stays absent", !("posInventoryType" in (back[0] as unknown as Row)));
  check("non-prefixed image untouched", (back[9] as unknown as Row).imageUrl === "/local/fallback.png");
  check("packed is smaller", JSON.stringify(packed).length < JSON.stringify(rows).length * 0.7);
  const a = back[1] as unknown as Row;
  const b = back[2] as unknown as Row;
  check("restored objects are not shared references", a.totalCbd !== b.totalCbd);
  check("empty list round-trips", unpackGridItems(packGridItems([])).length === 0);
  return { passed, failed };
}
