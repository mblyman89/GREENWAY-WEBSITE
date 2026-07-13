/**
 * src/lib/syndication/sync-plan-core.ts  (Task X)
 *
 * PURE delta-sync planning + payload-hash idempotency for menu syndication.
 * No DB, no network, no "server-only" — unit-testable with tsx.
 *
 * Professional best practices encoded (docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md §3):
 *  - Delta awareness: given the id set last successfully synced per channel and
 *    the current feed, compute creates / updates / deletes. Weedmaps has NO bulk
 *    endpoint and needs explicit per-item DELETEs; Leafly's POST full-sync
 *    deletes implicitly but PUT (upsert) does not — so both channels need this.
 *  - Idempotency via payload hashing: hash each item's outbound payload; when a
 *    previous hash matches, the item is UNCHANGED and can be skipped ("skipped —
 *    no changes") unless the owner forces a full resend.
 */

/** Stable stringify: object keys sorted recursively so hashes don't depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * FNV-1a 32-bit hash (hex). Deterministic, dependency-free, fast — used purely
 * for change detection (not security). Applied to the stable stringification.
 */
export function hashPayload(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps everything in 32-bit space).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type SyncPlanInput = {
  /** id -> payload hash from the LAST SUCCESSFUL sync (empty map = first sync). */
  previous: Map<string, string>;
  /** id -> current outbound payload hash from the live feed. */
  current: Map<string, string>;
};

export type SyncPlan = {
  /** Ids present now but not previously synced. */
  creates: string[];
  /** Ids present in both whose payload hash changed. */
  updates: string[];
  /** Ids present in both whose payload hash is identical (safe to skip). */
  unchanged: string[];
  /** Ids previously synced but absent from the current feed (need explicit delete/unpublish). */
  deletes: string[];
  /** creates + updates (+ unchanged when force=true) — what a live push would send. */
  toSend: string[];
  counts: { creates: number; updates: number; unchanged: number; deletes: number; toSend: number };
};

/**
 * Compute the channel-agnostic sync plan. `force=true` resends unchanged items
 * (owner-triggered full resync); deletes are always surfaced regardless.
 */
export function computeSyncPlan(input: SyncPlanInput, force = false): SyncPlan {
  const creates: string[] = [];
  const updates: string[] = [];
  const unchanged: string[] = [];
  const deletes: string[] = [];

  for (const [id, hash] of input.current) {
    const prev = input.previous.get(id);
    if (prev === undefined) creates.push(id);
    else if (prev !== hash) updates.push(id);
    else unchanged.push(id);
  }
  for (const id of input.previous.keys()) {
    if (!input.current.has(id)) deletes.push(id);
  }

  creates.sort();
  updates.sort();
  unchanged.sort();
  deletes.sort();

  const toSend = force ? [...creates, ...updates, ...unchanged].sort() : [...creates, ...updates].sort();

  return {
    creates,
    updates,
    unchanged,
    deletes,
    toSend,
    counts: {
      creates: creates.length,
      updates: updates.length,
      unchanged: unchanged.length,
      deletes: deletes.length,
      toSend: toSend.length,
    },
  };
}

/** Build an id -> payload-hash map from items that carry a stable id. */
export function hashItems<T extends { [key: string]: unknown }>(
  items: T[],
  idOf: (item: T) => string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(idOf(item), hashPayload(item));
  }
  return map;
}

/** Human summary line for logs/UI, e.g. "3 new, 5 changed, 120 unchanged, 2 removed". */
export function describeSyncPlan(plan: SyncPlan): string {
  return `${plan.counts.creates} new, ${plan.counts.updates} changed, ${plan.counts.unchanged} unchanged, ${plan.counts.deletes} removed`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runSyncPlanTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // stableStringify: key order independence
  ok(
    "stable stringify sorts keys",
    stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }),
  );
  ok("stable stringify nested", stableStringify({ a: { z: 1, y: [2, { c: 3, b: 4 }] } }) ===
    '{"a":{"y":[2,{"b":4,"c":3}],"z":1}}');
  ok("stable stringify drops undefined values", stableStringify({ a: 1, b: undefined }) === '{"a":1}');
  ok("stable stringify null", stableStringify(null) === "null");
  ok("stable stringify string", stableStringify("hi") === '"hi"');

  // hashPayload: deterministic, order-insensitive, change-sensitive
  const h1 = hashPayload({ name: "Blue Dream", price: 3500 });
  const h2 = hashPayload({ price: 3500, name: "Blue Dream" });
  const h3 = hashPayload({ name: "Blue Dream", price: 3600 });
  ok("hash deterministic across key order", h1 === h2);
  ok("hash changes when data changes", h1 !== h3);
  ok("hash is 8-char hex", /^[0-9a-f]{8}$/.test(h1));

  // computeSyncPlan
  const previous = new Map([
    ["a", "hash-a"],
    ["b", "hash-b-old"],
    ["gone", "hash-gone"],
  ]);
  const current = new Map([
    ["a", "hash-a"], // unchanged
    ["b", "hash-b-new"], // updated
    ["c", "hash-c"], // created
  ]);
  const plan = computeSyncPlan({ previous, current });
  ok("plan creates", JSON.stringify(plan.creates) === '["c"]');
  ok("plan updates", JSON.stringify(plan.updates) === '["b"]');
  ok("plan unchanged", JSON.stringify(plan.unchanged) === '["a"]');
  ok("plan deletes", JSON.stringify(plan.deletes) === '["gone"]');
  ok("plan toSend excludes unchanged", JSON.stringify(plan.toSend) === '["b","c"]');
  ok("plan counts", plan.counts.creates === 1 && plan.counts.updates === 1 && plan.counts.unchanged === 1 && plan.counts.deletes === 1 && plan.counts.toSend === 2);

  const forced = computeSyncPlan({ previous, current }, true);
  ok("forced plan resends unchanged", JSON.stringify(forced.toSend) === '["a","b","c"]');
  ok("forced still surfaces deletes", JSON.stringify(forced.deletes) === '["gone"]');

  // first sync: everything is a create
  const first = computeSyncPlan({ previous: new Map(), current });
  ok("first sync all creates", first.counts.creates === 3 && first.counts.deletes === 0);

  // empty feed: everything previously synced is a delete
  const emptied = computeSyncPlan({ previous, current: new Map() });
  ok("emptied feed all deletes", emptied.counts.deletes === 3 && emptied.counts.toSend === 0);

  // hashItems
  const items = [
    { id: "x", name: "X" },
    { id: "y", name: "Y" },
  ];
  const hashed = hashItems(items, (i) => i.id);
  ok("hashItems keys", hashed.size === 2 && hashed.has("x") && hashed.has("y"));
  ok("hashItems values are hashes", /^[0-9a-f]{8}$/.test(hashed.get("x") ?? ""));

  ok("describeSyncPlan", describeSyncPlan(plan) === "1 new, 1 changed, 1 unchanged, 1 removed");

  console.log(`sync-plan: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} sync-plan test(s) failed`);
}
