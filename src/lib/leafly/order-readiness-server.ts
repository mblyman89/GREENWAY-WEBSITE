import "server-only";

/**
 * src/lib/leafly/order-readiness-server.ts
 *
 * SLICE M-2 (server half) — TURN "NOTHING HAPPENED" INTO A NAMED NEXT STEP.
 *
 * ===========================================================================
 * THE REPORT THIS FILE EXISTS TO ANSWER
 * ===========================================================================
 * The owner placed a real order on Leafly and observed FOUR silences at once:
 *
 *   1. no row in the back office
 *   2. no printed receipt
 *   3. no noise on the speaker
 *   4. no Leafly section on the online orders page
 *
 * Four silences look like one big failure. They are not. Symptom 4 was the
 * dashboard panel correctly hiding itself (`LeaflyOrdersPanel` returns null
 * when no key is saved and no order has ever arrived), and symptoms 1–3 were
 * downstream of Leafly never calling us at all. Neither of those is
 * discoverable from the screen, which is the actual defect: the system knew
 * why and said nothing.
 *
 * ===========================================================================
 * WHY EVERY FIELD HERE IS EVIDENCE AND NOT A GUESS
 * ===========================================================================
 * The hardest input is `verifiedDeliveryEverReceived` — "does Leafly have our
 * webhook URLs?". There is no endpoint that answers that. The arrangement is
 * made by email; the vendored spec says so and Leafly's own onboarding email
 * (Ben Scott, in Leafly_Sandbox_API_Access_-_Greenway.pdf) explicitly asks us
 * to supply the destination URLs per event.
 *
 * So we do not ask. We look for PROOF: has Leafly ever delivered a webhook to
 * us whose HMAC signature verified? If yes, Leafly demonstrably has our URLs
 * AND our key, because it could not have produced that request otherwise.
 * That is a positive proof from an observed fact.
 *
 * The inverse is deliberately NOT treated as proof of absence — "no verified
 * delivery yet" could equally mean nobody has placed an order. The core words
 * that step as "not confirmed", and this file's job is only to report the fact
 * truthfully, never to upgrade it into a conclusion.
 *
 * ===========================================================================
 * POSTURE
 * ===========================================================================
 * Never throws. This is read by the online orders page, which already has a
 * job: running Greenway's own orders all day. A Leafly diagnostic that 500s
 * the page it is diagnosing has made things strictly worse. Every failure
 * degrades to a `false` (with the reason recorded in `problems`) rather than
 * propagating.
 *
 * Makes NO decisions. Every judgement lives in `order-readiness-core.ts`,
 * where it is provable in CI with no database and no network. If you find an
 * `if` here that decides what the owner should do next, it is in the wrong
 * file.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  assessOrderReadiness,
  buildWebhookDestinations,
  explainSilentOrder,
  type OrderReadiness,
  type ReadinessInput,
  type WebhookDestination,
} from "./order-readiness-core";

/* ------------------------------------------------------------------------- *
 * The site's public origin
 * ------------------------------------------------------------------------- */

/**
 * Work out the https origin to hand Leafly.
 *
 * PRECEDENCE, and why. `NEXT_PUBLIC_SITE_URL` first, because it is the
 * established convention in this codebase for "the address the outside world
 * uses" — the printer's CloudPRNT poll URL, the POS CORS allow-list and the
 * password-reset links all read it (see printer-diagnostics-core.ts,
 * pos/cors.ts, auth/set-password-core.ts). Using a different source here would
 * mean two answers to one question.
 *
 * `VERCEL_URL` is the fallback ONLY because it is better than nothing during
 * a preview deploy, and it is deliberately second: on Vercel it names the
 * per-deployment host (…-git-branch-….vercel.app), which changes on every
 * push. A URL that changes on every push is a URL that will silently stop
 * receiving orders, so if it is ever used the caller is told so explicitly via
 * `originSource` rather than being quietly given a fragile address to email
 * to a third party.
 *
 * Returns the raw string. Validation is the core's job — it rejects blank,
 * non-https, localhost and .local, and returns ZERO urls on refusal rather
 * than a list of subtly wrong ones. A half-correct list is worse than none,
 * because it ends up pasted into an email and looks legitimate.
 */
function resolveSiteOrigin(): { origin: string; originSource: "configured" | "vercel" | "none" } {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (configured) return { origin: configured, originSource: "configured" };

  const vercel = (process.env.VERCEL_URL ?? "").trim();
  if (vercel) {
    // VERCEL_URL is a bare host with no scheme. Prefixing https is correct:
    // Vercel terminates TLS on every deployment host.
    const withScheme = /^https?:\/\//i.test(vercel) ? vercel : `https://${vercel}`;
    return { origin: withScheme, originSource: "vercel" };
  }

  return { origin: "", originSource: "none" };
}

/* ------------------------------------------------------------------------- *
 * Delivery evidence
 * ------------------------------------------------------------------------- */

export type DeliveryEvidence = {
  /** Has Leafly EVER sent us a webhook whose signature verified? */
  verifiedDeliveryEverReceived: boolean;
  /** Total deliveries logged, verified or not. */
  totalDeliveries: number;
  /** Deliveries we REFUSED because the signature did not verify. */
  rejectedDeliveries: number;
  /** When the most recent delivery of any kind arrived. */
  lastDeliveryAt: string | null;
  /** When the most recent VERIFIED delivery arrived. */
  lastVerifiedDeliveryAt: string | null;
  /** Distinct event types Leafly has actually sent us, verified or not. */
  eventTypesSeen: string[];
  /** Non-empty when the log could not be read. Never blocks the page. */
  problem: string;
};

const NO_EVIDENCE: DeliveryEvidence = {
  verifiedDeliveryEverReceived: false,
  totalDeliveries: 0,
  rejectedDeliveries: 0,
  lastDeliveryAt: null,
  lastVerifiedDeliveryAt: null,
  eventTypesSeen: [],
  problem: "",
};

/**
 * Read the webhook delivery log for proof of life.
 *
 * WHY REJECTED DELIVERIES ARE COUNTED SEPARATELY, AND WHY IT MATTERS MOST.
 * "Leafly has never called us" and "Leafly calls us and we refuse every call"
 * produce the SAME four silences the owner reported — no row, no bell, no
 * paper, no panel — but they have opposite fixes. The first is an email to
 * Leafly; the second is a wrong HMAC key in our own settings. Migration 0225
 * logs refused deliveries on purpose ("a burst of signature failures is the
 * signal that the HMAC key was rotated, and discarding that evidence would
 * make the problem invisible") and this is the reader that finally uses it.
 *
 * WHY ONE QUERY AND NOT FOUR COUNTS. Four `count: exact, head: true` queries
 * would be four round trips for a panel that renders on every page load, and
 * they could disagree with each other if a delivery landed between them. One
 * bounded read of the newest rows is consistent with itself. The bound is the
 * tradeoff, and it is stated in the field docs: the counts are "within the
 * most recent N deliveries", which is all the panel claims.
 */
export async function loadLeaflyDeliveryEvidence(
  sampleSize = 200,
): Promise<DeliveryEvidence> {
  if (!isSupabaseServiceConfigured) {
    return {
      ...NO_EVIDENCE,
      problem: "The database isn’t connected, so Leafly’s delivery history can’t be checked.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_webhook_events")
      .select("event_type, signature_verified, received_at")
      .order("received_at", { ascending: false })
      .limit(sampleSize);

    if (error) {
      // 42P01 is undefined_table: migration 0225 has not been applied yet.
      // That is a setup state, not a fault, and it gets its own sentence —
      // telling somebody to "check Leafly" when the table simply does not
      // exist yet would send them looking in the wrong place entirely.
      const code = (error as { code?: string }).code;
      return {
        ...NO_EVIDENCE,
        problem:
          code === "42P01"
            ? "The Leafly order tables haven’t been created in the database yet (migration 0225)."
            : `Leafly’s delivery history couldn’t be read: ${error.message}`,
      };
    }

    const rows = (Array.isArray(data) ? data : []) as Array<{
      event_type: string | null;
      signature_verified: boolean | null;
      received_at: string | null;
    }>;

    let rejected = 0;
    let lastVerifiedDeliveryAt: string | null = null;
    const eventTypes = new Set<string>();

    for (const row of rows) {
      const verified = row.signature_verified === true;
      if (!verified) rejected += 1;
      // Rows arrive newest-first, so the FIRST verified row we meet is the
      // most recent one. Comparing timestamps here would work too, but it
      // would silently depend on the ordering staying correct; taking the
      // first match depends on the ordering visibly.
      if (verified && lastVerifiedDeliveryAt === null) {
        lastVerifiedDeliveryAt = row.received_at ?? null;
      }
      const et = (row.event_type ?? "").trim();
      if (et) eventTypes.add(et);
    }

    return {
      verifiedDeliveryEverReceived: lastVerifiedDeliveryAt !== null,
      totalDeliveries: rows.length,
      rejectedDeliveries: rejected,
      lastDeliveryAt: rows[0]?.received_at ?? null,
      lastVerifiedDeliveryAt,
      eventTypesSeen: [...eventTypes].sort(),
      problem: "",
    };
  } catch (err) {
    return {
      ...NO_EVIDENCE,
      problem:
        err instanceof Error
          ? `Leafly’s delivery history couldn’t be read: ${err.message}`
          : "Leafly’s delivery history couldn’t be read.",
    };
  }
}

/**
 * Has any Leafly order row ever existed?
 *
 * Returns null on failure, NOT false. False means "Leafly has never sent us an
 * order", which is a diagnosis; a failed read that reported false would be a
 * diagnosis that is simply wrong, and it would push the owner toward emailing
 * Leafly about a problem that is actually a database outage. Same reasoning as
 * `countLeaflyOrdersAwaitingAck` in order-board-server.ts, which returns null
 * rather than 0 for exactly this reason.
 */
export async function anyLeaflyOrderEverReceived(): Promise<boolean | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("leafly_orders")
      .select("id", { count: "exact", head: true });
    if (error) return null;
    return (count ?? 0) > 0;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Speaker and printer
 * ------------------------------------------------------------------------- */

/**
 * Is the shop actually able to make a noise?
 *
 * TWO CONDITIONS, BOTH REQUIRED, and the pairing is the one people forget.
 * The announcer must be switched on AND at least one device must be paired.
 * Either alone is silence, and silence is indistinguishable from "no order
 * arrived" — which is precisely how the owner's report came to contain two
 * unrelated faults at once.
 *
 * Defaults to false on any failure. This is the one place where failing
 * pessimistic is right: claiming a working speaker we have not verified would
 * let the readiness panel say "this will ring" about a shop where it will not.
 */
export async function isSpeakerReady(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const { getAnnouncerSettings } = await import("@/lib/announcer/announcer-store");
    const settings = await getAnnouncerSettings();
    if (!settings.enabled) return false;

    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("announcer_devices")
      .select("id", { count: "exact", head: true });
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Is a receipt printer set up enough to print an arrival ticket?
 *
 * `auto_print_orders` is deliberately NOT part of this test. A shop may
 * legitimately choose to print on demand rather than automatically, and that
 * choice is not a readiness failure — reporting it as one would nag about a
 * setting the owner meant to set. What matters is that a printer exists and
 * has a poll token, because without that there is nowhere for the job to go.
 */
export async function isPrinterReady(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const { getPrinterSettings } = await import("@/lib/printing/printer-store");
    const settings = await getPrinterSettings();
    if (!settings) return false;
    return Boolean((settings.poll_token ?? "").trim());
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * The whole picture
 * ------------------------------------------------------------------------- */

export type LeaflyOrderSetupState = {
  readiness: OrderReadiness;
  /** The six absolute URLs to email Leafly. Empty when the origin is unusable. */
  destinations: WebhookDestination[];
  /** Why the URL list is empty, when it is. */
  destinationProblem: string | null;
  /** Where the origin came from, so a fragile preview URL is never passed off as final. */
  originSource: "configured" | "vercel" | "none";
  /** The origin actually used, echoed back so the screen can show what was assumed. */
  origin: string;
  evidence: DeliveryEvidence;
  /** One paragraph answering "why did my order vanish?". */
  explanation: string;
  /**
   * Things that went wrong while GATHERING this picture, as opposed to things
   * wrong with the setup. Kept separate on purpose: "we could not check" and
   * "we checked and it is broken" demand different responses from a human, and
   * flattening them is how a monitoring screen starts lying.
   */
  problems: string[];
};

/**
 * Gather everything the online orders page needs to explain itself.
 *
 * All the independent reads are issued together. They touch four unrelated
 * subsystems (credentials, webhook log, announcer, printer) and none of them
 * informs another, so serialising them would only add latency to a panel that
 * renders on a page the shop loads constantly.
 */
export async function loadLeaflyOrderSetupState(): Promise<LeaflyOrderSetupState> {
  const problems: string[] = [];
  const { origin, originSource } = resolveSiteOrigin();

  const [menuReadiness, hmacKey, orderKey, evidence, everOrdered, speakerReady, printerReady] =
    await Promise.all([
      // Rule 11: menu readiness already has a home, and that home is the ONLY
      // thing that refreshes the credential cache from the database first.
      // Re-deriving it here would reintroduce finding J-4 — the intermittent
      // false "not configured" on a cold lambda.
      import("./push")
        .then((m) => m.describeLeaflyReadinessAsync())
        .catch(() => null),
      import("./webhook-server")
        .then((m) => m.loadLeaflyHmacKey())
        .catch(() => null),
      import("./webhook-server")
        .then((m) => m.loadLeaflyOrderIntegrationKey())
        .catch(() => null),
      loadLeaflyDeliveryEvidence(),
      anyLeaflyOrderEverReceived(),
      isSpeakerReady(),
      isPrinterReady(),
    ]);

  if (menuReadiness === null) {
    problems.push("The Leafly menu connection couldn’t be checked just now.");
  }
  if (evidence.problem) problems.push(evidence.problem);
  if (everOrdered === null) {
    problems.push("Whether any Leafly order has ever arrived couldn’t be checked just now.");
  }

  const input: ReadinessInput = {
    menuConfigured: menuReadiness?.configured === true,
    hmacKeyPresent: Boolean(hmacKey && hmacKey.trim()),
    orderIntegrationKeyPresent: Boolean(orderKey && orderKey.trim()),
    verifiedDeliveryEverReceived: evidence.verifiedDeliveryEverReceived,
    // A null (could-not-check) becomes false here. That is safe in a way the
    // speaker/printer defaults are not: this flag only ever WIDENS what is
    // shown (it helps decide to show the panel) and never claims something
    // works. The uncertainty is already reported in `problems`.
    anyOrderEverReceived: everOrdered === true,
    speakerReady,
    printerReady,
  };

  const readiness = assessOrderReadiness(input);
  const built = buildWebhookDestinations(origin);

  return {
    readiness,
    destinations: built.destinations,
    destinationProblem: built.problem,
    originSource,
    origin,
    evidence,
    explanation: explainSilentOrder(readiness),
    problems,
  };
}
