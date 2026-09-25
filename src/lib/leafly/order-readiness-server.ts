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
import {
  breakdownRefusals,
  diagnoseRefusals,
  explainEmptyCart,
  signatureRefusalBlockingNow as isSignatureRefusalBlockingNow,
  type EmptyCartAdvice,
  type RefusalDiagnosis,
  type RefusalRow,
} from "./refusal-diagnosis-core";
// SLICE L-45: does what Leafly SENDS carry the store key we hold?
import { summarizeRetailerKeyEvidence, type RetailerKeyEvidence } from "./retailer-key-core";

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
  /**
   * The refused deliveries, split by the reason we recorded at the time.
   *
   * SLICE L-16. `rejectedDeliveries` above is a bare count, and a bare count
   * cannot tell "Leafly signed with the wrong key" apart from "a port scanner
   * found the URL". The panel used to treat the count alone as proof of a key
   * mismatch, which turned six unsigned probes into a confident instruction to
   * go and rotate a working credential. `leafly_webhook_events.rejection_reason`
   * has been written since migration 0225 and this is the first reader of it
   * on the order side.
   */
  refusals: RefusalRow[];
  /** Verdict over the refusals, naming who (if anyone) has to act. */
  refusalDiagnosis: RefusalDiagnosis;
  /**
   * Is a refusal that could actually stop a checkout happening RIGHT NOW?
   *
   * Narrow on purpose: unsigned noise inside the window does not count,
   * because a scanner being turned away has no bearing on whether a real
   * shopper's cart survives.
   */
  signatureRefusalBlockingNow: boolean;
  /**
   * SLICE L-45. Compares the orderIntegrationKey carried by recent VERIFIED
   * deliveries with the keys saved on the Integrations page, and names the box
   * to fix when they disagree. Only a verdict and counts - never a key value -
   * so nothing secret can reach the rendered page.
   *
   * null means "not checked" (the caller did not supply the saved keys, or the
   * log could not be read). Deliberately NOT a verdict: a made-up "no key
   * saved" would be exactly the unverified claim these panels exist to avoid.
   */
  retailerKey: RetailerKeyEvidence | null;
  /** Non-empty when the log could not be read. Never blocks the page. */
  problem: string;
};

/**
 * The diagnosis for "we have no refusals to look at".
 *
 * Built by calling the real core on an empty list rather than hand-writing a
 * literal. A hand-written "healthy" would be a second, untested copy of the
 * core's own wording, free to drift away from it — and the one thing this
 * slice is about is the panel and the evidence never disagreeing again.
 */
const NO_REFUSALS: RefusalDiagnosis = diagnoseRefusals({
  breakdown: breakdownRefusals([]),
  verifiedDeliveryEverReceived: false,
  hmacKeyPresent: true,
});

const NO_EVIDENCE: DeliveryEvidence = {
  verifiedDeliveryEverReceived: false,
  totalDeliveries: 0,
  rejectedDeliveries: 0,
  lastDeliveryAt: null,
  lastVerifiedDeliveryAt: null,
  eventTypesSeen: [],
  refusals: [],
  refusalDiagnosis: NO_REFUSALS,
  signatureRefusalBlockingNow: false,
  retailerKey: null,
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
  options: {
    hmacKeyPresent?: boolean;
    nowIso?: string;
    /** SLICE L-45: the saved keys to compare against. Omit = not checked. */
    retailerKeys?: { orderKey: string | null; menuKey: string | null };
  } = {},
): Promise<DeliveryEvidence> {
  // Defaults to TRUE, and the direction matters. `diagnoseRefusals` treats a
  // missing key as "this is ours to fix" and suppresses the advice to contact
  // Leafly. If an unknown key state defaulted to false we would announce a
  // configuration fault we never checked for — inventing the very kind of
  // confident-but-unverified claim this slice removes. Callers that know the
  // answer pass it; `loadLeaflyOrderSetupState` below always does.
  const hmacKeyPresent = options.hmacKeyPresent !== false;
  const nowIso = options.nowIso ?? new Date().toISOString();

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
      // `rejection_reason` added in slice L-16. It has been written since
      // migration 0225 and never read here, which is the entire reason the
      // panel could only ever offer one explanation for a refusal.
      // `order_integration_key` added in slice L-45: written since migration
      // 0225, never compared with our saved key until now.
      .select("event_type, signature_verified, received_at, rejection_reason, order_integration_key")
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
      rejection_reason: string | null;
      order_integration_key?: string | null;
    }>;

    let rejected = 0;
    let lastVerifiedDeliveryAt: string | null = null;
    const eventTypes = new Set<string>();
    const refusals: RefusalRow[] = [];

    for (const row of rows) {
      const verified = row.signature_verified === true;
      if (!verified) {
        rejected += 1;
        // Collect the reason as recorded. No normalising, no defaulting to a
        // plausible reason — the core is built to report an absent or
        // unrecognised reason as exactly that.
        refusals.push({
          reason: row.rejection_reason,
          eventType: row.event_type,
          receivedAt: row.received_at,
        });
      }
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

    const verifiedEver = lastVerifiedDeliveryAt !== null;

    return {
      verifiedDeliveryEverReceived: verifiedEver,
      totalDeliveries: rows.length,
      rejectedDeliveries: rejected,
      lastDeliveryAt: rows[0]?.received_at ?? null,
      lastVerifiedDeliveryAt,
      eventTypesSeen: [...eventTypes].sort(),
      refusals,
      // Diagnose over ALL refusals in the sample, so a genuine mismatch from
      // last week is still visible and named.
      refusalDiagnosis: diagnoseRefusals({
        breakdown: breakdownRefusals(refusals),
        verifiedDeliveryEverReceived: verifiedEver,
        hmacKeyPresent,
      }),
      // But decide "is checkout broken right now" over the RECENT window only.
      // The two questions are different and were previously answered by the
      // same number: refusals from the hour the integration was being set up
      // are history, not a live fault.
      signatureRefusalBlockingNow: isSignatureRefusalBlockingNow(refusals, nowIso),
      // Only VERIFIED rows count inside the core: an unsigned body is
      // untrusted, and must never talk the owner into changing a working key.
      retailerKey: options.retailerKeys
        ? summarizeRetailerKeyEvidence({
            rows: rows.map((r) => ({
              signatureVerified: r.signature_verified,
              orderIntegrationKey: r.order_integration_key ?? null,
            })),
            orderKey: options.retailerKeys.orderKey,
            menuKey: options.retailerKeys.menuKey,
          })
        : null,
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
 * Pickup availability — the trap that empties a cart with a perfect signature
 * ------------------------------------------------------------------------- */

/**
 * Is the shop telling Leafly its items may be bought through the marketplace?
 *
 * ── WHY THIS IS ON THE ORDER READINESS PANEL AT ALL ──────────────────────────
 * It looks like a menu-sync setting, and it is stored as one. But
 * `preview-lookup.ts` reads the SAME field to decide orderability:
 *
 *     pickupEnabled = settings.sendPickupAvailability === true;
 *
 * and `decideOrderability` opens with
 *
 *     if (!input.pickupEnabled) return { availableForPickup: false,
 *                                        reason: "pickup_disabled" };
 *
 * so with the toggle off, the preview webhook answers Leafly that every line
 * is unsellable. Per the vendored spec the preview response *is* the cart —
 * the integration may "remove items entirely" — so Leafly honours that answer
 * and the shopper's basket empties. Proven by execution, not inferred:
 *
 *     pickupEnabled=true   cartItems -> [{v1, qty 1, 3000}]   EMPTY? no
 *     pickupEnabled=false  cartItems -> []                     EMPTY? YES
 *                          removed   -> ['removed_not_orderable']
 *
 * `sync-settings-core.ts` defaults it to FALSE. So a shop that has done
 * everything else correctly — six URLs registered, HMAC key saved, order
 * integration key saved, signatures verifying — still cannot take an order,
 * and every screen reports READY. That is exactly the state the owner was in,
 * and nothing on any panel mentioned this field.
 *
 * Returns null, not false, when it cannot be read. False is a diagnosis
 * ("this is why your cart empties") and a failed read must never produce one.
 */
export async function isPickupAvailabilityEnabled(): Promise<boolean | null> {
  try {
    const { getLeaflySyncSettings } = await import("@/lib/syndication/engine-store");
    const settings = await getLeaflySyncSettings();
    return settings.sendPickupAvailability === true;
  } catch {
    return null;
  }
}

/**
 * How many variants the published menu can actually price.
 *
 * Calls the SAME `buildLeaflyVariantLookup()` the preview webhook calls, so
 * the number on the panel is the number the webhook will really work from.
 * Deriving it from the products table instead would let the panel report a
 * healthy menu while the webhook sees none — and `variantCount` here counts
 * reconstructed Leafly ids, including the synthesized `${item.id}-default`
 * for items with no variants, which exists nowhere in the database.
 *
 * Returns null on failure, and ALSO when the feed did not load (`loaded:
 * false`). That case returns `variantCount: 0` by design, and reporting that
 * zero as fact would tell the owner his menu is empty when we simply could
 * not read it.
 */
export async function countPublishedLeaflyVariants(): Promise<number | null> {
  // SLICE L-18 — THE SETTINGS SAVE THAT NEVER FINISHED.
  //
  // This used to call `buildLeaflyVariantLookup()` directly, on every render
  // of a `force-dynamic` page, to produce one integer. That rebuilt the whole
  // published menu -- getPublishedVersion, a paged read of menu_items and
  // menu_variants, resolveProductImagesBatch, and the DOH registry -- and then
  // threw all of it away except `.size`. Every server action on the page ends
  // with revalidatePath("/admin/orders"), so each save paid for it again
  // before the screen could repaint. That wait IS the reported hang.
  //
  // The read now goes through a cached, display-only entry point tagged with
  // the live menu's own cache tag, so a menu publish clears it instantly and a
  // 60-second TTL is the floor underneath that.
  //
  // WHAT IS DELIBERATELY NOT CACHED: `buildLeaflyVariantLookup` itself. Its
  // other caller is the order_preview webhook, which prices a real shopper's
  // cart. See setup-cache-core.ts for why caching that function would both
  // break the house "never cache the money" rule AND, because unstable_cache
  // stores JSON and JSON.stringify deletes functions, hand the webhook a
  // `lookup` of undefined.
  //
  // The null-vs-zero distinction this function has always made is now carried
  // by a named type rather than by a bare `number | null`, and a failed read
  // is never written to the cache -- so a transient blip cannot pin "0
  // variants published" on the panel for a minute.
  const { loadPublishedVariantCountOutcome } = await import("./setup-cache-server");
  const { countForDisplay } = await import("./setup-cache-core");
  return countForDisplay(await loadPublishedVariantCountOutcome());
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
   * Is the shop telling Leafly its items may be bought through the
   * marketplace? Null when it could not be read — never guessed.
   *
   * SLICE L-16. This is its own field, and its own checklist step, because it
   * is the one setting that can empty a shopper's cart while every other
   * indicator on the page reads green.
   */
  pickupAvailabilityEnabled: boolean | null;
  /** Variants the preview webhook could price. Null when unreadable. */
  publishedVariantCount: number | null;
  /**
   * Why a shopper's cart would empty at "proceed to preorder", or that
   * nothing should be emptying it.
   */
  emptyCart: EmptyCartAdvice;
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
/**
 * SLICE L-26 — this reader's "we stopped waiting" value.
 *
 * ── WHY IT LIVES HERE AND NOT AT THE CALL SITE ────────────────────────────
 * `LeaflyOrderSetupState` has eleven fields, three of which are themselves
 * computed objects (`readiness`, `evidence`, `emptyCart`). A caller that
 * hand-built an empty one would be writing a second, unreviewed opinion
 * about what "nothing is known" means for Leafly readiness — and the moment
 * a field is added here, that copy silently goes stale and starts rendering
 * a confident answer to a question nobody asked.
 *
 * The module that owns the type owns its empty state. The page asks for it.
 *
 * ── WHY EVERY UNKNOWN IS null OR false, NEVER A GUESS ─────────────────────
 * Exactly the leaning already documented in `loadLeaflyOrderSetupState`:
 * when we do not know, say nothing rather than something false. The
 * three-valued fields stay null (`pickupAvailabilityEnabled`,
 * `publishedVariantCount`) so the checklist shows "not confirmed" rather
 * than ticking or accusing, and the reason is stated plainly in `problems`
 * where a human will read it.
 */
export function emptyLeaflyOrderSetupState(problem: string): LeaflyOrderSetupState {
  const { origin, originSource } = resolveSiteOrigin();
  const built = buildWebhookDestinations(origin);
  const readiness = assessOrderReadiness({
    menuConfigured: false,
    hmacKeyPresent: false,
    orderIntegrationKeyPresent: false,
    verifiedDeliveryEverReceived: false,
    anyOrderEverReceived: false,
    speakerReady: false,
    printerReady: false,
    pickupAvailabilityEnabled: null,
  });

  return {
    readiness,
    destinations: built.destinations,
    destinationProblem: built.problem,
    originSource,
    origin,
    evidence: { ...NO_EVIDENCE, problem },
    explanation: explainSilentOrder(readiness),
    pickupAvailabilityEnabled: null,
    publishedVariantCount: null,
    emptyCart: explainEmptyCart({
      signatureRefusalsRecent: false,
      // Both lean the same way the live reader does when a value is
      // unreadable: `true` and `1` are the values that make no accusation.
      pickupAvailabilityEnabled: true,
      menuVariantCount: 1,
    }),
    problems: [problem],
  };
}

export async function loadLeaflyOrderSetupState(): Promise<LeaflyOrderSetupState> {
  const problems: string[] = [];
  const { origin, originSource } = resolveSiteOrigin();

  // Two passes are needed, not one. `loadLeaflyDeliveryEvidence` has to know
  // whether an HMAC key is saved before it can decide whether a wall of
  // refusals means "email Leafly" or "you have not pasted your key yet", and
  // that is exactly the misdiagnosis this slice exists to remove. So the
  // credential reads are issued first, then the evidence read alongside the
  // remaining independent reads. Both passes are still fully parallel
  // internally; the cost is one extra round of latency, paid to stop the page
  // giving confident advice it has not checked.
  const [menuReadiness, hmacKey, retailer] = await Promise.all([
    // Rule 11: menu readiness already has a home, and that home is the ONLY
    // thing that refreshes the credential cache from the database first.
    import("./push")
      .then((m) => m.describeLeaflyReadinessAsync())
      .catch(() => null),
    import("./webhook-server")
      .then((m) => m.loadLeaflyHmacKey())
      .catch(() => null),
    // SLICE L-45: the full resolution (Order box, else the Menu key - Ben:
    // they are the same value), so the step below ticks when only the Menu
    // key is saved, and the evidence can be compared with BOTH boxes.
    import("./webhook-server")
      .then((m) => m.loadLeaflyRetailerKey())
      .catch(() => null),
  ]);
  const orderKey = retailer?.key ?? null;

  const hmacKeyPresent = Boolean(hmacKey && hmacKey.trim());

  const [evidence, everOrdered, speakerReady, printerReady, pickupEnabled, variantCount] =
    await Promise.all([
      loadLeaflyDeliveryEvidence(200, {
        hmacKeyPresent,
        // Only when the keys were actually read; otherwise "not checked".
        retailerKeys: retailer
          ? { orderKey: retailer.orderKey, menuKey: retailer.menuKey }
          : undefined,
      }),
      anyLeaflyOrderEverReceived(),
      isSpeakerReady(),
      isPrinterReady(),
      isPickupAvailabilityEnabled(),
      countPublishedLeaflyVariants(),
    ]);

  if (menuReadiness === null) {
    problems.push("The Leafly menu connection couldn’t be checked just now.");
  }
  if (evidence.problem) problems.push(evidence.problem);
  if (everOrdered === null) {
    problems.push("Whether any Leafly order has ever arrived couldn’t be checked just now.");
  }
  if (pickupEnabled === null) {
    problems.push(
      "Whether pickup ordering is switched on for Leafly couldn’t be checked just now.",
    );
  }
  if (variantCount === null) {
    problems.push("The published Leafly menu couldn’t be read just now.");
  }

  const input: ReadinessInput = {
    menuConfigured: menuReadiness?.configured === true,
    hmacKeyPresent,
    orderIntegrationKeyPresent: Boolean(orderKey && orderKey.trim()),
    verifiedDeliveryEverReceived: evidence.verifiedDeliveryEverReceived,
    // A null (could-not-check) becomes false here. That is safe in a way the
    // speaker/printer defaults are not: this flag only ever WIDENS what is
    // shown (it helps decide to show the panel) and never claims something
    // works. The uncertainty is already reported in `problems`.
    anyOrderEverReceived: everOrdered === true,
    speakerReady,
    printerReady,
    // Passed through as the three-valued fact it is. The core deliberately
    // does NOT treat null as done, so an unreadable setting shows as
    // not-confirmed rather than being quietly ticked off.
    pickupAvailabilityEnabled: pickupEnabled,
  };

  const readiness = assessOrderReadiness(input);
  const built = buildWebhookDestinations(origin);

  // WHY THE UNREADABLE CASES LEAN THE WAY THEY DO.
  //
  // `pickupAvailabilityEnabled: pickupEnabled !== false` — an unreadable
  // setting is passed as ENABLED, so we do not accuse the owner of having
  // pickup switched off when we never managed to look. The uncertainty is
  // already in `problems`, where it belongs.
  //
  // `menuVariantCount: variantCount ?? 1` — likewise. A null means "could not
  // read", and passing 0 would render the confident sentence "we have no
  // published menu to price the cart against" off the back of a failed read.
  // One is the smallest value that does not trigger that claim.
  //
  // Both leanings are the same principle: when we do not know, say nothing,
  // rather than say something false. That is the whole defect being repaired
  // here — the panel previously converted a count it had not interpreted into
  // a diagnosis it had not verified.
  const emptyCart = explainEmptyCart({
    signatureRefusalsRecent: evidence.signatureRefusalBlockingNow,
    pickupAvailabilityEnabled: pickupEnabled !== false,
    menuVariantCount: variantCount ?? 1,
  });

  return {
    readiness,
    destinations: built.destinations,
    destinationProblem: built.problem,
    originSource,
    origin,
    evidence,
    explanation: explainSilentOrder(readiness),
    pickupAvailabilityEnabled: pickupEnabled,
    publishedVariantCount: variantCount,
    emptyCart,
    problems,
  };
}
