/**
 * src/lib/announcer/announcer-enqueue.ts
 *
 * SLICE 29 — turning "an order was placed" into "the speakers make a noise".
 *
 * SERVER-ONLY. This is the thin I/O shell around the pure planner in
 * announcer-fanout-core.ts: read the devices, read the settings, ask the pure
 * code what to insert, insert it. Every decision lives in the core; every
 * database call lives here.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ----------------------------------------
 * This runs on the customer's checkout path, immediately after their order is
 * committed. A doorbell must never be able to fail a sale. So:
 *
 *   - the whole body is wrapped in try/catch and returns a result object;
 *   - it never throws, for any input, in any failure mode;
 *   - it never returns a rejected promise;
 *   - a missing table, a dead database, a malformed row, or a bug in here
 *     costs the shop a sound, never an order.
 *
 * The caller is expected to not even await the outcome for correctness — see
 * the call site in orders-store.ts. The return value exists for logging and for
 * the back-office Test button, which DOES want to know what happened.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  planFanout,
  summarizeFanout,
  type FanoutDevice,
  type FanoutPlan,
} from "./announcer-fanout-core";
import { getAnnouncerSettings } from "./announcer-store";

export type EnqueueResult = {
  /** True when the fan-out ran to completion, even if it queued nothing. */
  ok: boolean;
  /** How many queue rows were actually written. */
  queued: number;
  /** How many speakers were deliberately passed over, and implicitly why. */
  skipped: number;
  /** One line safe to drop straight into a server log. */
  summary: string;
};

function failure(summary: string): EnqueueResult {
  return { ok: false, queued: 0, skipped: 0, summary: `announcer: ${summary}` };
}

/**
 * The columns the planner needs. Selected explicitly rather than with `*` so a
 * future column rename fails here, loudly, in one place.
 */
const DEVICE_COLUMNS = "id, enabled, volume, sound_id, custom_sound_path";

/**
 * Fan one announcement out to every eligible speaker.
 *
 * `isTest` comes from the back-office Test button. A test bypasses quiet hours
 * (you press Test precisely to check the speaker works right now) but it does
 * not bypass the master off switch or a disabled device — see shouldAnnounce().
 */
export async function enqueueAnnouncement(input: {
  orderId: string | null;
  orderNumber: string | null;
  isTest?: boolean;
  /** Injectable for tests. Defaults to the real clock. */
  now?: Date;
}): Promise<EnqueueResult> {
  try {
    if (!isSupabaseServiceConfigured) return failure("service not configured");

    const admin = createSupabaseAdminClient();
    const isTest = input.isTest === true;

    // Settings first, because getAnnouncerSettings() is contractually
    // incapable of throwing or returning null — if the table is unreachable the
    // shop gets announcing defaults rather than silence.
    const settings = await getAnnouncerSettings();

    // The master switch short-circuits before we read the device list. Nothing
    // is going to be queued, so there is no reason to touch another table on
    // the checkout path.
    if (!settings.enabled) {
      return { ok: true, queued: 0, skipped: 0, summary: "announcer: turned off in settings" };
    }

    const { data: deviceRows, error: deviceError } = await admin
      .from("announcer_devices")
      .select(DEVICE_COLUMNS);

    if (deviceError) return failure(`could not read speakers (${deviceError.message})`);
    if (!Array.isArray(deviceRows) || deviceRows.length === 0) {
      return { ok: true, queued: 0, skipped: 0, summary: "announcer: no speakers paired" };
    }

    // Custom sound paths are resolved against what actually exists, so a sound
    // file deleted out from under a device falls back to a built-in rather than
    // queueing a path the Pi will 404 on. Only the paths currently referenced
    // are worth checking, and only if at least one device uses one.
    const referenced = deviceRows
      .map((d) => (d as FanoutDevice).custom_sound_path)
      .filter((p): p is string => typeof p === "string" && p.trim() !== "");

    let availableCustomPaths: string[] = [];
    if (referenced.length > 0) {
      const { data: soundRows } = await admin
        .from("announcer_sounds")
        .select("storage_path")
        .in("storage_path", referenced);
      availableCustomPaths = Array.isArray(soundRows)
        ? soundRows
            .map((s) => (s as { storage_path: unknown }).storage_path)
            .filter((p): p is string => typeof p === "string")
        : [];
    }

    const plan: FanoutPlan = planFanout({
      devices: deviceRows as FanoutDevice[],
      settings,
      now: input.now ?? new Date(),
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      isTest,
      availableCustomPaths,
    });

    if (plan.inserts.length === 0) {
      return { ok: true, queued: 0, skipped: plan.skipped.length, summary: summarizeFanout(plan) };
    }

    const { error: insertError } = await admin.from("announcer_queue").insert(plan.inserts);
    if (insertError) return failure(`could not queue (${insertError.message})`);

    return {
      ok: true,
      queued: plan.inserts.length,
      skipped: plan.skipped.length,
      summary: summarizeFanout(plan),
    };
  } catch (err) {
    // The catch-all that makes the promise above safe to ignore. Nothing that
    // happens in this function is allowed to reach the checkout path.
    const message = err instanceof Error ? err.message : String(err);
    return failure(`unexpected failure (${message})`);
  }
}

/**
 * Fire-and-forget wrapper for the order path.
 *
 * `createOrder` calls this WITHOUT awaiting, so the customer's confirmation is
 * never held up by a speaker. Because enqueueAnnouncement never rejects, this
 * cannot produce an unhandled rejection — the extra .catch() is belt-and-braces
 * against a future edit breaking that guarantee.
 */
export function enqueueAnnouncementInBackground(input: {
  orderId: string | null;
  orderNumber: string | null;
}): void {
  void enqueueAnnouncement(input)
    .then((result) => {
      if (!result.ok) console.error(result.summary);
    })
    .catch((err) => {
      console.error("announcer: enqueue threw despite its contract", err);
    });
}
