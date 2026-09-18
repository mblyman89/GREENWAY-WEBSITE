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
 *
 * SLICE L-7 -- the automatic sync SCHEDULE lives here too, as a nested
 * `schedule` block, and this is a deliberate choice worth explaining.
 *
 * It would have been easier to give the scheduler its own settings table. That
 * would have been a second place to store "how Greenway talks to Leafly", a
 * second migration, a second resolver, and a second thing to keep in step --
 * and house rule 11 exists precisely to stop that. `syndication_sync_settings`
 * (migration 0119) is already a per-channel jsonb blob with a working save
 * path, an audit trail, and a factory-reset classification. The schedule is
 * one more thing the owner tunes about Leafly, so it belongs in the same row.
 *
 * It is NESTED under `schedule` rather than flattened alongside `pacingMs`
 * because the schedule's natural field names are generic -- `enabled`,
 * `intradayMinutes` -- and a top-level `enabled` in a blob that also configures
 * transmission would be genuinely ambiguous to the next person reading a stored
 * row: enabled what? Nesting makes the stored JSON self-describing and means
 * the schedule can never collide with a future transmission knob.
 *
 * The decisions about that schedule are NOT here. They live in
 * `src/lib/leafly/schedule-core.ts`, which owns the clamping, the defaults and
 * the due-ness logic; this file delegates to its resolver rather than
 * re-deriving any of it.
 */

import {
  DEFAULT_SCHEDULE_SETTINGS,
  resolveScheduleSettings,
  type LeaflyScheduleSettings,
} from "@/lib/leafly/schedule-core";

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
  /**
   * SLICE L-7. When the menu is sent automatically, without anyone pressing a button.
   *
   * Always a complete, clamped object -- never partial and never absent -- because
   * `resolveLeaflySettings` fills it from `resolveScheduleSettings`. A settings row
   * written before L-7 has no `schedule` key at all and resolves to the defaults, which
   * have automation OFF. That is the correct reading of an old row: nobody who saved
   * settings last month consented to automatic syncing.
   */
  schedule: LeaflyScheduleSettings;
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
  // Automation also starts OFF, for the same reason and by the same rule: the default
  // is owned by `schedule-core.ts`, not restated here, so there is exactly one place
  // that decides what an unconfigured schedule means.
  schedule: DEFAULT_SCHEDULE_SETTINGS,
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

/**
 * Is this a jsonb object we can read keys off? Arrays are excluded on purpose:
 * `typeof [] === "object"` in JavaScript, and an array reaching the schedule
 * resolver would read every field as undefined and look like a deliberate reset.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    // Delegated, not duplicated (rule 11). Anything that is not a usable object --
    // absent, null, a string, an array -- resolves to the safe defaults rather than
    // being coerced, because a malformed schedule must fail towards "off", not towards
    // "guess an hour and start calling a third party".
    schedule: resolveScheduleSettings(
      isPlainObject(r["schedule"]) ? (r["schedule"] as Record<string, unknown>) : null,
    ),
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
/**
 * SLICE L-7: this returned `void` and its two harness registrations therefore
 * could only assert "it did not throw" -- which a suite that ran zero
 * assertions would also satisfy. Now that this core resolves the automatic sync
 * schedule as well as the transmission toggles, that blind spot covered the
 * round trip that keeps an owner's automation setting from being silently
 * reset. Returning the counts lets both harnesses apply a floor.
 */
export function __runSyncSettingsTests(): { passed: number; failed: number } {
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

  // --- SLICE L-7: the nested schedule block -------------------------------
  // The point of these assertions is that the schedule survives a round trip
  // through this resolver. If it did not, saving a checkbox on the transmission
  // form would silently reset the owner's automatic syncing, because
  // `saveSyncSettings` upserts the WHOLE blob.
  {
    const withSched = resolveLeaflySettings({
      schedule: { enabled: true, dailyFullHour: 5, intradayMinutes: 30 },
    });
    ok("schedule block is read, not ignored", withSched.schedule.enabled === true);
    ok("schedule hour is read", withSched.schedule.dailyFullHour === 5);
    ok("schedule interval is read", withSched.schedule.intradayMinutes === 30);
  }
  {
    // A row saved before L-7 has no `schedule` key whatsoever.
    const legacy = resolveLeaflySettings({ pacingMs: 0, syncMode: "post" });
    ok("a pre-L-7 row still yields a complete schedule", typeof legacy.schedule === "object");
    ok("a pre-L-7 row reads as automation OFF", legacy.schedule.enabled === false);
    ok(
      "a pre-L-7 row gets the default daily hour, not zero",
      legacy.schedule.dailyFullHour === DEFAULT_SCHEDULE_SETTINGS.dailyFullHour,
    );
  }
  {
    // Malformed schedule values must fail towards OFF rather than being coerced.
    for (const junk of ["", "enabled", 0, 1, true, false, [], [1, 2], NaN] as unknown[]) {
      const r = resolveLeaflySettings({ schedule: junk });
      ok(
        `malformed schedule (${JSON.stringify(junk) ?? String(junk)}) resolves to OFF`,
        r.schedule.enabled === false && r.schedule.dailyFullHour === DEFAULT_SCHEDULE_SETTINGS.dailyFullHour,
      );
    }
  }
  {
    // An ARRAY is the interesting case: `typeof [] === "object"`, so a naive
    // check would pass it through and every field would read as undefined.
    const r = resolveLeaflySettings({ schedule: [{ enabled: true }] });
    ok("an array schedule does not smuggle values through", r.schedule.enabled === false);
  }
  {
    // Out-of-range values are clamped by the schedule core, not accepted here.
    const r = resolveLeaflySettings({ schedule: { enabled: true, dailyFullHour: 99, intradayMinutes: 1 } });
    ok("schedule hour is clamped through the delegate", r.schedule.dailyFullHour === 23);
    ok("schedule interval is clamped through the delegate", r.schedule.intradayMinutes === 15);
  }
  {
    // THE ROUND TRIP THAT MATTERS. Resolve -> store -> resolve must preserve the
    // schedule exactly, because that is literally the save path: the action
    // resolves the form, `saveSyncSettings` writes the whole object, and the
    // next read resolves it again.
    const first = resolveLeaflySettings({
      schedule: { enabled: true, dailyFullHour: 3, intradayEnabled: false, intradayMinutes: 45 },
      sendImages: false,
    });
    const second = resolveLeaflySettings(first as unknown as Record<string, unknown>);
    ok(
      "schedule survives a full resolve -> store -> resolve round trip",
      JSON.stringify(second.schedule) === JSON.stringify(first.schedule),
    );
    ok("round trip keeps automation ON when it was on", second.schedule.enabled === true);
    ok("round trip keeps the chosen hour", second.schedule.dailyFullHour === 3);
    ok("round trip keeps intraday OFF when it was off", second.schedule.intradayEnabled === false);
    ok("round trip does not disturb the transmission toggles", second.sendImages === false);
  }
  {
    // The defaults object itself must contain a real schedule, or
    // `DEFAULT_LEAFLY_SETTINGS` could be written to the database incomplete.
    ok("the defaults carry a schedule object", typeof DEFAULT_LEAFLY_SETTINGS.schedule === "object");
    ok("the default schedule has automation off", DEFAULT_LEAFLY_SETTINGS.schedule.enabled === false);
  }

  console.log(`sync-settings: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} sync-settings test(s) failed`);
  return { passed, failed };
}
