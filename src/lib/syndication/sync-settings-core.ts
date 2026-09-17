/**
 * src/lib/syndication/sync-settings-core.ts  (Task X)
 *
 * PURE owner-tunable transmission parameters for the Leafly / Weedmaps sync
 * engine: defaults, clamping, and (de)serialization from a stored row. No DB,
 * no network, no "server-only".
 *
 * Every knob is grounded in a verified constraint
 * (docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md):
 *  - pacing: Weedmaps global limit is 420 requests/10s ⇒ default 150ms between
 *    per-item writes (~66 req/10s, far under the cap while still fast). Owner
 *    can tune 0–5000ms.
 *  - retries: 429/5xx exponential backoff, max attempts owner-tunable 0–5.
 *  - transmission toggles: descriptions / cannabinoids / images / genetics-
 *    strain — full owner control over what enrichment is transmitted.
 *  - forceResend: overrides payload-hash idempotency for a full resync.
 *  - Leafly syncMode default "post" (full sync, Leafly's recommended daily op)
 *    with "put" (upsert) for incremental updates.
 */

export type LeaflySyncMode = "post" | "put";

export type ChannelSyncSettings = {
  /** Milliseconds between per-item writes (Weedmaps) / between retries base. */
  pacingMs: number;
  /** Max retry attempts on 429/5xx (0 = no retries). */
  maxRetries: number;
  /** Transmit plain-text descriptions. */
  sendDescriptions: boolean;
  /** Transmit THC/CBD (Leafly compounds / Weedmaps cannabinoid measurements). */
  sendCannabinoids: boolean;
  /** Transmit the product's exact photo (never fallbacks). */
  sendImages: boolean;
  /** Transmit strain name (+ genetics on Weedmaps). */
  sendStrains: boolean;
  /** Skip idempotency (resend unchanged items) on the next sync. */
  forceResend: boolean;
};

export type LeaflySyncSettings = ChannelSyncSettings & {
  /** post = full sync (deletes omitted items) · put = upsert only. */
  syncMode: LeaflySyncMode;
  /**
   * SLICE L-3 (finding L-09). Offer Greenway's in-stock items for ORDERING on Leafly by
   * sending `availableForPickup: true`.
   *
   * This is the only toggle in this file that changes what a member of the public can DO
   * rather than what they can SEE. With it on, a stranger can place a real order that the
   * shop has fifteen minutes to acknowledge before Leafly auto-cancels it
   * (`cancelReason: order_api_unacknowledged`). It therefore defaults **off**, and it
   * stays off until the owner turns it on with staff ready for that clock.
   *
   * Off does NOT mean "send nothing": it means send an explicit `false`, which actively
   * withdraws orderability from any item Leafly already has. Silence would leave a stale
   * `true` in place. See `orderability-core.ts`.
   */
  sendPickupAvailability: boolean;
};

export type WeedmapsSyncSettings = ChannelSyncSettings & {
  /** Unpublish (published:false) out-of-stock items instead of deleting them. */
  unpublishWhenOutOfStock: boolean;
};

export const PACING_MS_MIN = 0;
export const PACING_MS_MAX = 5000;
export const MAX_RETRIES_MIN = 0;
export const MAX_RETRIES_MAX = 5;

export const DEFAULT_LEAFLY_SETTINGS: LeaflySyncSettings = {
  pacingMs: 0, // Leafly is one request per sync — no per-item pacing needed.
  maxRetries: 3,
  sendDescriptions: true,
  sendCannabinoids: true,
  // SLICE L-3 (the tail of finding L-10). This used to read `false` with the comment
  // "Leafly v2 items payload has no image field (verified) — kept off." That claim was
  // simply untrue: `imageUrl` is a documented property of the v2 item schema
  // (`docs/leafly-specs/schemas/v2-items.json`), and L-2 proved it by wiring real
  // emission plus suppression. The default is now `true`, matching Weedmaps, because
  // product photos are a Leafly certification data-quality item and the owner's toggle
  // should start in the state that serves him. He can still turn it off, and turning it
  // off now genuinely removes the image instead of doing nothing.
  sendImages: true,
  sendStrains: true,
  forceResend: false,
  syncMode: "post",
  // Ordering starts OFF. See the field's doc comment: this one is a promise to fulfil.
  sendPickupAvailability: false,
};

export const DEFAULT_WEEDMAPS_SETTINGS: WeedmapsSyncSettings = {
  pacingMs: 150, // ~66 writes/10s, well under the enforced 420/10s.
  maxRetries: 3,
  sendDescriptions: true,
  sendCannabinoids: true,
  sendImages: true,
  sendStrains: true,
  forceResend: false,
  unpublishWhenOutOfStock: true,
};

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "1" || value === 1) return true;
  if (value === "false" || value === "off" || value === "0" || value === 0) return false;
  return fallback;
}

/** Parse a stored/submitted partial into complete, clamped Leafly settings. */
export function resolveLeaflySettings(raw: Record<string, unknown> | null | undefined): LeaflySyncSettings {
  const d = DEFAULT_LEAFLY_SETTINGS;
  const r = raw ?? {};
  const mode = r["syncMode"];
  return {
    pacingMs: clampInt(r["pacingMs"], PACING_MS_MIN, PACING_MS_MAX, d.pacingMs),
    maxRetries: clampInt(r["maxRetries"], MAX_RETRIES_MIN, MAX_RETRIES_MAX, d.maxRetries),
    sendDescriptions: asBool(r["sendDescriptions"], d.sendDescriptions),
    sendCannabinoids: asBool(r["sendCannabinoids"], d.sendCannabinoids),
    sendImages: asBool(r["sendImages"], d.sendImages),
    sendStrains: asBool(r["sendStrains"], d.sendStrains),
    forceResend: asBool(r["forceResend"], d.forceResend),
    syncMode: mode === "put" ? "put" : "post",
    sendPickupAvailability: asBool(r["sendPickupAvailability"], d.sendPickupAvailability),
  };
}

/** Parse a stored/submitted partial into complete, clamped Weedmaps settings. */
export function resolveWeedmapsSettings(raw: Record<string, unknown> | null | undefined): WeedmapsSyncSettings {
  const d = DEFAULT_WEEDMAPS_SETTINGS;
  const r = raw ?? {};
  return {
    pacingMs: clampInt(r["pacingMs"], PACING_MS_MIN, PACING_MS_MAX, d.pacingMs),
    maxRetries: clampInt(r["maxRetries"], MAX_RETRIES_MIN, MAX_RETRIES_MAX, d.maxRetries),
    sendDescriptions: asBool(r["sendDescriptions"], d.sendDescriptions),
    sendCannabinoids: asBool(r["sendCannabinoids"], d.sendCannabinoids),
    sendImages: asBool(r["sendImages"], d.sendImages),
    sendStrains: asBool(r["sendStrains"], d.sendStrains),
    forceResend: asBool(r["forceResend"], d.forceResend),
    unpublishWhenOutOfStock: asBool(r["unpublishWhenOutOfStock"], d.unpublishWhenOutOfStock),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runSyncSettingsTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // Defaults
  const l = resolveLeaflySettings(null);
  ok("leafly defaults", JSON.stringify(l) === JSON.stringify(DEFAULT_LEAFLY_SETTINGS));
  ok("leafly default mode post", l.syncMode === "post");
  // SLICE L-3. The previous assertion here read "leafly images default off (no v2 image
  // field)" and locked a FALSE premise into the test suite: it made the disproven claim
  // load-bearing, so correcting the default would have looked like a regression. The v2
  // schema does define `imageUrl`. Images now default ON.
  ok("leafly images default ON (v2 imageUrl exists and is wired)", l.sendImages === true);
  // Ordering is the one toggle that must NOT default on: `true` lets the public place
  // real orders against a fifteen-minute acknowledgement deadline.
  ok("leafly pickup availability defaults OFF", l.sendPickupAvailability === false);
  const w = resolveWeedmapsSettings(undefined);
  ok("wm defaults", JSON.stringify(w) === JSON.stringify(DEFAULT_WEEDMAPS_SETTINGS));
  ok("wm default pacing 150ms", w.pacingMs === 150);
  ok("wm unpublish default true", w.unpublishWhenOutOfStock === true);

  // Clamping
  ok("clampInt below min", clampInt(-50, 0, 5000, 150) === 0);
  ok("clampInt above max", clampInt(99999, 0, 5000, 150) === 5000);
  ok("clampInt junk -> fallback", clampInt("abc", 0, 5000, 150) === 150);
  ok("clampInt string number", clampInt("300", 0, 5000, 150) === 300);
  ok("clampInt rounds", clampInt(150.7, 0, 5000, 0) === 151);

  const clamped = resolveWeedmapsSettings({ pacingMs: 999999, maxRetries: -2 });
  ok("wm pacing clamped to max", clamped.pacingMs === PACING_MS_MAX);
  ok("wm retries clamped to min", clamped.maxRetries === MAX_RETRIES_MIN);

  // Booleans from form-ish values
  const boolish = resolveLeaflySettings({ sendImages: "on", sendCannabinoids: "false", forceResend: 1 });
  ok("'on' -> true", boolish.sendImages === true);
  ok("'false' -> false", boolish.sendCannabinoids === false);
  ok("1 -> true", boolish.forceResend === true);

  // syncMode parsing
  ok("mode put accepted", resolveLeaflySettings({ syncMode: "put" }).syncMode === "put");
  ok("mode junk -> post", resolveLeaflySettings({ syncMode: "delete" }).syncMode === "post");

  // Round-trip: resolved settings resolve to themselves
  const round = resolveWeedmapsSettings(resolveWeedmapsSettings({ pacingMs: 300 }) as unknown as Record<string, unknown>);
  ok("round trip stable", round.pacingMs === 300 && round.unpublishWhenOutOfStock === true);

  // --- SLICE L-3: the ordering toggle ------------------------------------
  // It must be settable BOTH ways from form-ish input, because "off" has to be
  // expressible: an owner turning ordering off is withdrawing a public offer, and a
  // parser that silently fell back to the default would ignore him.
  ok(
    "pickup availability can be turned on",
    resolveLeaflySettings({ sendPickupAvailability: "on" }).sendPickupAvailability === true,
  );
  ok(
    "pickup availability can be turned back off",
    resolveLeaflySettings({ sendPickupAvailability: "false" }).sendPickupAvailability === false,
  );
  ok(
    "pickup availability accepts a real boolean true",
    resolveLeaflySettings({ sendPickupAvailability: true }).sendPickupAvailability === true,
  );
  // Unrecognised junk must fall back to the SAFE default, not to "on".
  ok(
    "pickup availability junk -> defaults OFF (fail closed)",
    resolveLeaflySettings({ sendPickupAvailability: "maybe" }).sendPickupAvailability === false,
  );
  // A stored settings row written before L-3 has no such key at all. It must read as
  // off rather than undefined, or an old row would make `availableForPickup` undefined.
  ok(
    "settings saved before L-3 (key absent) read as OFF",
    resolveLeaflySettings({ pacingMs: 0, syncMode: "post" }).sendPickupAvailability === false,
  );
  ok(
    "pickup availability is always a real boolean",
    typeof resolveLeaflySettings(null).sendPickupAvailability === "boolean",
  );
  // Leafly round-trip, including the new key.
  const lfRound = resolveLeaflySettings(
    resolveLeaflySettings({ sendPickupAvailability: true, sendImages: false }) as unknown as Record<string, unknown>,
  );
  ok(
    "leafly round trip preserves both new-field states",
    lfRound.sendPickupAvailability === true && lfRound.sendImages === false,
  );

  console.log(`sync-settings: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} sync-settings test(s) failed`);
}
