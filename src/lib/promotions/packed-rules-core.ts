/**
 * src/lib/promotions/packed-rules-core.ts — USAGE-9a (2026-11-26)
 *
 * WHY: the (site) layout serializes every published rule snapshot into the
 * RSC payload of EVERY page (product pages included) for the client cart,
 * product cards and deal badges. Measured on a live product page: 7.4 KB
 * decoded (8.35 KB escaped). About a quarter of that is default values:
 * `null`, `false`, `[]`, `discountFixed: 0`, and config keys that are `undefined`
 * (serialized as "$undefined").
 *
 * FIX: the server sends `packRuleSnapshots(snapshots)`, which omits a field
 * only when it equals its default. The client provider calls
 * `unpackRuleSnapshots`, which restores every default. The rules the client
 * prices with are therefore value-identical: the self-test checks the
 * round-trip on the committed seeds and on edge cases (weekday 0 = Sunday,
 * discountPercent 0, markdownOnly).
 *
 * MONEY: display/estimate only. The register, checkout and promo guard
 * never read this payload (rule 18 is unaffected).
 */
import { seedRuleSnapshots, type PublishedRuleSnapshot } from "./published-rules-core";

/** A snapshot with default-valued fields omitted (see RULE_DEFAULTS). */
export type PackedRuleSnapshot = Partial<PublishedRuleSnapshot> &
  Pick<PublishedRuleSnapshot, "id" | "title" | "discountType" | "discountPercent" | "priority">;

/**
 * Fields omitted when equal to these defaults. `weekday` defaults to null, so
 * 0 (Sunday) is always kept. `discountPercent` and `priority` are always kept.
 */
export const RULE_DEFAULTS = {
  promoKey: null,
  description: null,
  discountFixed: 0,
  perItemSale: false,
  bonusNote: null,
  weekday: null,
  startsAt: null,
  endsAt: null,
  storewide: false,
  targetCategories: [],
  targetBrands: [],
  targetProductKeys: [],
  excludeCategories: [],
  excludeBrands: [],
  excludeProductKeys: [],
  config: {},
} as const satisfies Partial<Record<keyof PublishedRuleSnapshot, unknown>>;

type DefaultKey = keyof typeof RULE_DEFAULTS;
const DEFAULT_KEYS = Object.keys(RULE_DEFAULTS) as DefaultKey[];

function isDefault(key: DefaultKey, value: unknown): boolean {
  const d = RULE_DEFAULTS[key];
  if (value === undefined) return true;
  if (Array.isArray(d)) return Array.isArray(value) && value.length === 0;
  if (key === "config") return !!value && typeof value === "object" && Object.keys(value).length === 0;
  return value === d;
}

/** Server side: drop undefined config keys, then omit default-valued fields. */
export function packRuleSnapshots(snapshots: readonly PublishedRuleSnapshot[]): PackedRuleSnapshot[] {
  return snapshots.map((s) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "config" && v && typeof v === "object") {
        const cfg: Record<string, unknown> = {};
        for (const [ck, cv] of Object.entries(v)) if (cv !== undefined) cfg[ck] = cv;
        if (Object.keys(cfg).length) out.config = cfg;
        continue;
      }
      if ((DEFAULT_KEYS as string[]).includes(k) && isDefault(k as DefaultKey, v)) continue;
      out[k] = v;
    }
    return out as PackedRuleSnapshot;
  });
}

/** Client side: restore every omitted default (fresh arrays/objects per rule). */
export function unpackRuleSnapshots(packed: readonly PackedRuleSnapshot[]): PublishedRuleSnapshot[] {
  return packed.map((p) => {
    const out: Record<string, unknown> = { ...p };
    for (const k of DEFAULT_KEYS) {
      if (out[k] !== undefined) continue;
      const d = RULE_DEFAULTS[k];
      out[k] = Array.isArray(d) ? [] : k === "config" ? {} : d;
    }
    return out as PublishedRuleSnapshot;
  });
}

/** Deep equality ignoring `undefined`-valued object keys (as RSC does in effect). */
export function sameRuleValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameRuleValues(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sameRuleValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export function __runPackedRulesTests(): { passed: number; failed: number } {
  const seeds = seedRuleSnapshots();
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`packed-rules-core FAIL: ${name}`);
    }
  };
  const base: PublishedRuleSnapshot = {
    id: "r1", promoKey: null, title: "Clearance", description: null, discountType: "percent",
    discountPercent: 0, discountFixed: 0, perItemSale: false, bonusNote: null, weekday: 0,
    startsAt: null, endsAt: null, priority: 0, storewide: false, targetCategories: [],
    targetBrands: [], targetProductKeys: ["pos-a"], excludeCategories: [], excludeBrands: [],
    excludeProductKeys: [], config: { qtyTiers: undefined, markdownOnly: true },
  };
  const packed = packRuleSnapshots([base])[0] as Record<string, unknown>;
  ok(packed.weekday === 0, "weekday 0 (Sunday) is kept");
  ok(packed.discountPercent === 0 && packed.priority === 0, "discountPercent/priority always kept");
  ok(!("description" in packed) && !("storewide" in packed) && !("targetBrands" in packed), "defaults omitted");
  ok(JSON.stringify(packed.config) === '{"markdownOnly":true}', "undefined config keys dropped");
  ok(sameRuleValues(unpackRuleSnapshots([packed as PackedRuleSnapshot])[0], base), "round-trip equals the input");
  const full = { ...base, weekday: null, storewide: true, discountFixed: 500, startsAt: "2026-01-01T00:00:00Z", config: {} };
  const rt = unpackRuleSnapshots(packRuleSnapshots([full]));
  ok(sameRuleValues(rt[0], full), "non-default values survive");
  ok(rt[0].weekday === null && Array.isArray(rt[0].excludeProductKeys) && rt[0].config !== undefined, "defaults restored with types");
  const two = unpackRuleSnapshots(packRuleSnapshots([base, base]));
  ok(two[0].targetBrands !== two[1].targetBrands, "restored arrays are not shared");
  ok(seeds.length > 0 && sameRuleValues(unpackRuleSnapshots(packRuleSnapshots(seeds)), seeds), "committed seeds round-trip");
  ok(JSON.stringify(packRuleSnapshots(seeds)).length <= JSON.stringify(seeds).length, "never larger");
  if (failed > 0) throw new Error(`packed-rules-core: ${failed} failed`);
  return { passed, failed };
}
