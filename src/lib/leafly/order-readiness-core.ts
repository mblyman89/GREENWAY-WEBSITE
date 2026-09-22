/**
 * src/lib/leafly/order-readiness-core.ts
 *
 * SLICE L-15 — "WHY DID NOTHING HAPPEN?", ANSWERED ON SCREEN.
 *
 * ===========================================================================
 * THE SECOND HALF OF THE OWNER'S BUG
 * ===========================================================================
 * He reported four symptoms. Three of them (no record, no receipt, no noise)
 * share the root cause fixed by `order-fetch-core.ts`. The fourth was
 * different, and in some ways worse:
 *
 *   > "There is nothing in the online orders dashboard page that has a Leafly
 *   >  orders section."
 *
 * The section exists. `LeaflyOrdersPanel` is built, is mounted in
 * `src/app/admin/orders/page.tsx`, and is 711 lines of working UI. It rendered
 * nothing because of this, verbatim from the component:
 *
 *   if (!hasOrders && !hasProblem && !hasOutcome && !board.orderIntegrationKeyPresent) {
 *     return null;
 *   }
 *
 * And his own screenshot of the credentials page shows the reason:
 * **ORDER INTEGRATION KEY — Source: NOT SET.**
 *
 * So the panel was behaving exactly as written. The rule was defensible when
 * it was written — "the orders page does not grow a permanent empty section
 * for a feature that is not in use" — but it is wrong in one specific and
 * costly situation: when the owner is actively TRYING to set the feature up.
 * At that moment, an invisible panel is indistinguishable from a broken one,
 * and it answers the question "is this even installed?" with silence.
 *
 * ── THE DESIGN RULE THIS FILE ENCODES ───────────────────────────────────────
 * A feature may hide itself when it is genuinely dormant. It may NOT hide
 * itself when somebody is mid-setup, because the only thing more expensive
 * than a wrong answer is no answer. This core decides which of those two
 * states the shop is in, and — when it is the second — produces the exact
 * list of what is still missing, in the order it must be done.
 *
 * ===========================================================================
 * WHY THE STEPS ARE ORDERED, AND WHY THAT ORDER IS NOT ARBITRARY
 * ===========================================================================
 * The steps have real dependencies, taken from Leafly's own onboarding email
 * and from the spec:
 *
 *   1. Menu integration first. The spec: "Integrating with the Leafly Order
 *      API requires you to have an existing integration with Version 2.0 of
 *      the Leafly Menu API."
 *   2. Webhook destination URLs next. Leafly's engineering manager, verbatim:
 *      "in order to complete the sandbox setup for the order integration,
 *      we'll need one or more URLs to serve as the destination for event
 *      webhooks from Leafly." Until Leafly has these, Leafly never calls us,
 *      and NOTHING downstream can possibly happen. This is the step that was
 *      missed.
 *   3. HMAC key. Without it every delivery is refused 401 (fail-closed, by
 *      design) and the orders silently never land.
 *   4. Order integration key. Without it we cannot fetch or acknowledge, so
 *      Leafly auto-cancels at fifteen minutes.
 *   5. A speaker, so somebody hears it.
 *   6. A printer, so somebody can build the bag.
 *
 * Showing step 4 to somebody who has not done step 2 sends them to copy a key
 * that will sit unused. The order is the advice.
 *
 * PURITY (house rule 5): no imports, no I/O, no clock.
 */

/* ------------------------------------------------------------------------- *
 * 1. The six webhook destinations Leafly must be given
 * ------------------------------------------------------------------------- */

/**
 * Event name → the path we serve it on.
 *
 * Duplicated from `order-contract-core.ts` rather than imported, to keep this
 * module import-free. A compliance test asserts the two agree exactly, so a
 * drift fails CI instead of quietly handing Leafly a URL we do not serve —
 * which would produce a 404 at Leafly's end and a completely silent failure at
 * ours, the exact class of bug this whole slice exists to eliminate.
 */
export const LEAFLY_WEBHOOK_DESTINATIONS = [
  { event: "order_submit", path: "/api/webhooks/leafly/order-submit", requirement: "required" },
  { event: "order_cancel", path: "/api/webhooks/leafly/order-cancel", requirement: "required" },
  { event: "order_status", path: "/api/webhooks/leafly/order-status", requirement: "recommended" },
  { event: "order_preview", path: "/api/webhooks/leafly/order-preview", requirement: "recommended" },
  { event: "order_activate", path: "/api/webhooks/leafly/order-activate", requirement: "optional" },
  { event: "order_deactivate", path: "/api/webhooks/leafly/order-deactivate", requirement: "optional" },
] as const;

export type WebhookDestination = {
  event: string;
  url: string;
  requirement: "required" | "recommended" | "optional";
};

/**
 * Turn the site's public origin into the six absolute URLs to email Leafly.
 *
 * ── WHY THE ORIGIN IS VALIDATED RATHER THAN CONCATENATED ────────────────────
 * The output of this function gets pasted into an email to a third party who
 * will configure it and then send real customers' orders at it. A typo does
 * not fail loudly; it produces a webhook that silently never arrives — which
 * is, precisely, the bug being fixed. So a bad origin returns an empty list
 * and a reason, rather than a list of subtly wrong URLs.
 *
 * `http://localhost` is rejected deliberately even though it is a valid URL:
 * Leafly cannot reach it, and a list of localhost URLs looks exactly as
 * legitimate as a correct list once it is sitting in an email.
 */
export function buildWebhookDestinations(siteOrigin: string | null | undefined): {
  ok: boolean;
  destinations: WebhookDestination[];
  problem: string | null;
} {
  const raw = typeof siteOrigin === "string" ? siteOrigin.trim() : "";
  if (raw === "") {
    return {
      ok: false,
      destinations: [],
      problem: "This site's public web address isn’t configured, so the list can’t be built.",
    };
  }
  if (!/^https:\/\/[^\s/]+/i.test(raw)) {
    return {
      ok: false,
      destinations: [],
      problem:
        "This site's address must start with https:// and be reachable from the internet. " +
        "Leafly cannot send orders to a local or insecure address.",
    };
  }
  if (/localhost|127\.0\.0\.1|\.local(?::|\/|$)/i.test(raw)) {
    return {
      ok: false,
      destinations: [],
      problem:
        "This looks like a local development address. Leafly has to be given the live " +
        "public address, or the orders will be sent somewhere it cannot reach.",
    };
  }

  const origin = raw.replace(/\/+$/, "");
  return {
    ok: true,
    problem: null,
    destinations: LEAFLY_WEBHOOK_DESTINATIONS.map((d) => ({
      event: d.event,
      url: `${origin}${d.path}`,
      requirement: d.requirement,
    })),
  };
}

/* ------------------------------------------------------------------------- *
 * 2. Setup state
 * ------------------------------------------------------------------------- */

export type ReadinessInput = {
  /** A menu integration key is saved (the Order API's prerequisite). */
  menuConfigured: boolean;
  /** A webhook HMAC key is saved. Without it every delivery is refused. */
  hmacKeyPresent: boolean;
  /** An order integration key is saved. Without it we cannot fetch or ack. */
  orderIntegrationKeyPresent: boolean;
  /** Has Leafly ever delivered a webhook that passed signature verification? */
  verifiedDeliveryEverReceived: boolean;
  /** Have we ever stored a Leafly order row? */
  anyOrderEverReceived: boolean;
  /** Is at least one speaker paired and is the announcer switched on? */
  speakerReady: boolean;
  /** Is a receipt printer configured? */
  printerReady: boolean;
  /**
   * Is the shop telling Leafly its items may be bought through the
   * marketplace? (`sendPickupAvailability` in the Leafly sync settings.)
   *
   * SLICE L-16 — WHY THIS BECAME ITS OWN STEP, AND WHY IT IS THREE-VALUED.
   *
   * It reads like a menu-sync preference and it is stored as one, but
   * `preview-lookup.ts` threads the same field into `decideOrderability()`,
   * whose first line is `if (!input.pickupEnabled) return { availableForPickup:
   * false, reason: "pickup_disabled" }`. The preview webhook therefore answers
   * Leafly that every line in the cart is unsellable, and per the spec that
   * response IS the cart, so the shopper's basket empties.
   *
   * `sync-settings-core.ts` defaults it to FALSE. That combination produced
   * the exact state the owner was in: six URLs registered, HMAC key saved,
   * order key saved, signatures verifying, every step on this checklist
   * ticked, the headline reading "Everything needed is in place" — and a
   * shopper who could not complete a single order. A readiness panel that
   * reports READY for a shop that cannot take an order is not merely
   * incomplete, it is wrong, and it sends the owner looking at Leafly for a
   * fault that is one toggle away on our own settings page.
   *
   * `null` means "could not be read". It is a third value rather than a
   * collapse to false because false is a diagnosis here — it renders the
   * sentence "pickup ordering is switched off, so every item is removed" —
   * and a failed read must never produce a diagnosis.
   */
  pickupAvailabilityEnabled: boolean | null;
};

export type ReadinessStep = {
  id: string;
  title: string;
  /** What the owner actually has to do, in plain language. */
  detail: string;
  done: boolean;
  /** True when nothing downstream can work until this is done. */
  blocking: boolean;
};

export type OrderReadiness = {
  /** True when an order placed right now would land, ring, and print. */
  ready: boolean;
  /** True when the panel must be shown even though no order has arrived. */
  showPanel: boolean;
  steps: ReadinessStep[];
  /** The first unfinished blocking step, which is what to do next. */
  nextStep: ReadinessStep | null;
  /** One sentence for the top of the panel. */
  headline: string;
};

/**
 * Work out what is done, what is missing, and what to do next.
 *
 * ── THE ONE JUDGEMENT CALL, STATED OPENLY ───────────────────────────────────
 * `verifiedDeliveryEverReceived` is the only honest test of step 2. We cannot
 * ask Leafly whether it has our URLs; there is no such endpoint, and the spec
 * confirms the arrangement is made by email. But if Leafly has ever sent us a
 * delivery whose HMAC verified, then Leafly demonstrably has our URLs and our
 * key. That is evidence rather than inference.
 *
 * The inverse is NOT proof — no verified delivery could also mean nobody has
 * placed an order yet. So this step is reported as "not confirmed" rather than
 * "not done", and the wording on screen says so. Overclaiming here would be
 * the same sin as the original silent panel: a confident answer that is not
 * backed by evidence.
 */
export function assessOrderReadiness(input: ReadinessInput): OrderReadiness {
  const steps: ReadinessStep[] = [
    {
      id: "menu",
      title: "Menu integration connected",
      detail:
        "Leafly requires a working Menu API v2.0 integration before the Order API can be " +
        "switched on. Your products have to be on Leafly before anyone can order them.",
      done: input.menuConfigured,
      blocking: true,
    },
    {
      id: "webhook_urls",
      title: "Leafly has been given the six webhook addresses",
      detail:
        "This is the step that is most often missed, and it is invisible when it is missed. " +
        "Leafly only sends orders to addresses you have emailed to them — they cannot guess. " +
        "Copy the six addresses below and send them to api-support@leafly.com. " +
        "Until Leafly has these, nothing arrives, nothing rings, and nothing prints.",
      // Evidence-based, never assumed. See the note above.
      done: input.verifiedDeliveryEverReceived,
      blocking: true,
    },
    {
      id: "hmac",
      title: "Webhook HMAC key saved",
      detail:
        "Leafly signs every order it sends. Without this key we cannot tell a real order from " +
        "a stranger on the internet, so we refuse all of them — safely, but silently.",
      done: input.hmacKeyPresent,
      blocking: true,
    },
    {
      id: "order_key",
      title: "Order integration key saved",
      detail:
        "This identifies your store to Leafly. Without it we cannot collect the order’s " +
        "contents and we cannot accept it, so Leafly cancels it automatically after fifteen " +
        "minutes.",
      done: input.orderIntegrationKeyPresent,
      blocking: true,
    },
    {
      id: "pickup_availability",
      title: "Pickup ordering is switched on for Leafly",
      detail:
        "This is the one that empties a shopper’s basket while everything else looks perfect. " +
        "When Leafly asks us to confirm a cart, this setting is what decides whether we answer " +
        "that the items may be sold through a marketplace. With it off we answer “none of " +
        "these”, Leafly honours that answer, and the shopper sees an empty cart at checkout. " +
        "It ships switched off, so it has to be turned on deliberately in the Leafly sync " +
        "settings.",
      // `null` (unreadable) is NOT treated as done. This step is blocking, and
      // marking an unverified step complete is precisely how the panel came to
      // report READY for a shop that could not take an order. An unreadable
      // setting is reported as not-confirmed, and the reason is carried
      // separately in `problems`.
      done: input.pickupAvailabilityEnabled === true,
      blocking: true,
    },
    {
      id: "speaker",
      title: "A speaker is paired and the announcer is on",
      detail:
        "This is what makes the noise when an order arrives. Without it the order still lands, " +
        "but nobody is told.",
      done: input.speakerReady,
      blocking: false,
    },
    {
      id: "printer",
      title: "A receipt printer is set up",
      detail:
        "This prints the arrival ticket so somebody can build the bag. Without it the order " +
        "still lands and still makes a noise.",
      done: input.printerReady,
      blocking: false,
    },
  ];

  const blockingIncomplete = steps.filter((s) => s.blocking && !s.done);
  const ready = blockingIncomplete.length === 0;
  const nextStep = blockingIncomplete[0] ?? steps.find((s) => !s.done) ?? null;

  // The panel shows whenever ANY setup has begun, or any order has ever
  // arrived. It only stays hidden for a shop that has never touched Leafly
  // orders at all -- which preserves the original intent without leaving
  // somebody mid-setup staring at a blank page.
  const anyProgress =
    input.menuConfigured ||
    input.hmacKeyPresent ||
    input.orderIntegrationKeyPresent ||
    input.verifiedDeliveryEverReceived ||
    input.anyOrderEverReceived;

  let headline: string;
  if (input.anyOrderEverReceived && ready) {
    headline = "Leafly orders are set up and arriving.";
  } else if (ready) {
    headline =
      "Everything needed is in place. The next order a shopper places will arrive here, " +
      "make a noise, and print.";
  } else if (blockingIncomplete.length === 1) {
    headline = `One thing is still missing: ${blockingIncomplete[0].title.toLowerCase()}.`;
  } else {
    headline = `${blockingIncomplete.length} things are still missing before Leafly orders can arrive.`;
  }

  return { ready, showPanel: anyProgress, steps, nextStep, headline };
}

/**
 * Explain, in one paragraph, why a placed order produced no record at all.
 *
 * This exists because that is the exact question the owner asked, and because
 * a list of tick-boxes does not answer a "why". The wording is chosen to match
 * what he observed rather than what the system did internally.
 */
export function explainSilentOrder(readiness: OrderReadiness): string {
  if (readiness.ready) {
    return (
      "Everything Leafly needs is configured here. If an order still does not appear, the " +
      "most likely remaining cause is that Leafly has not yet activated the order " +
      "integration for this store — that is done on their side, not here."
    );
  }
  const next = readiness.nextStep;
  if (next && next.id === "webhook_urls") {
    return (
      "An order placed on Leafly right now would not reach this system at all. Leafly only " +
      "sends orders to web addresses you have given them, and there is no evidence yet that " +
      "they have ours — we have never received a signed delivery. That is why there was no " +
      "record, no receipt and no sound: nothing ever arrived to record, print or announce. " +
      "Send Leafly the six addresses below to fix it."
    );
  }
  if (next) {
    return (
      `An order placed right now would not complete, because ${next.title.toLowerCase()} is ` +
      `still outstanding. ${next.detail}`
    );
  }
  return "Some optional pieces are still missing, but orders will arrive.";
}

/* ------------------------------------------------------------------------- *
 * 3. Self-tests
 * ------------------------------------------------------------------------- */

const ALL_DONE: ReadinessInput = {
  menuConfigured: true,
  hmacKeyPresent: true,
  orderIntegrationKeyPresent: true,
  verifiedDeliveryEverReceived: true,
  anyOrderEverReceived: true,
  speakerReady: true,
  printerReady: true,
  pickupAvailabilityEnabled: true,
};

const NOTHING_DONE: ReadinessInput = {
  menuConfigured: false,
  hmacKeyPresent: false,
  orderIntegrationKeyPresent: false,
  verifiedDeliveryEverReceived: false,
  anyOrderEverReceived: false,
  speakerReady: false,
  printerReady: false,
  pickupAvailabilityEnabled: false,
};

export function __runLeaflyOrderReadinessTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  [leafly-order-readiness] FAILED: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    ok(`${label} (got ${JSON.stringify(actual)})`, actual === expected);

  // ---- 1. Destinations ---------------------------------------------------
  const built = buildWebhookDestinations("https://greenwaywebsite1.vercel.app");
  ok("a good origin builds", built.ok);
  eq("all six events are listed", built.destinations.length, 6);
  eq(
    "the submit url is absolute and correct",
    built.destinations.find((d) => d.event === "order_submit")?.url,
    "https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-submit",
  );
  ok(
    "every url is absolute https",
    built.destinations.every((d) => d.url.startsWith("https://")),
  );
  ok(
    "every url is unique — two events sharing a path would silently drop one",
    new Set(built.destinations.map((d) => d.url)).size === 6,
  );
  ok(
    "no url has a double slash after the origin",
    built.destinations.every((d) => !d.url.slice("https://".length).includes("//")),
  );
  eq(
    "a trailing slash on the origin does not double up",
    buildWebhookDestinations("https://x.com/").destinations[0]?.url,
    "https://x.com/api/webhooks/leafly/order-submit",
  );
  eq(
    "several trailing slashes are handled",
    buildWebhookDestinations("https://x.com///").destinations[0]?.url,
    "https://x.com/api/webhooks/leafly/order-submit",
  );
  // The two Leafly marks **Required** must be present, or certification fails.
  ok(
    "order_submit and order_cancel are marked required",
    built.destinations.filter((d) => d.requirement === "required").length === 2 &&
      built.destinations.some((d) => d.event === "order_submit" && d.requirement === "required") &&
      built.destinations.some((d) => d.event === "order_cancel" && d.requirement === "required"),
  );

  ok("an empty origin refuses", !buildWebhookDestinations("").ok);
  ok("a null origin refuses", !buildWebhookDestinations(null).ok);
  ok("an http origin refuses", !buildWebhookDestinations("http://example.com").ok);
  ok("localhost refuses", !buildWebhookDestinations("https://localhost:3000").ok);
  ok("127.0.0.1 refuses", !buildWebhookDestinations("https://127.0.0.1:3000").ok);
  ok(
    "a refusal produces NO urls — half an answer here goes into an email",
    buildWebhookDestinations("http://nope.com").destinations.length === 0,
  );
  ok(
    "a refusal always explains itself",
    (buildWebhookDestinations("")?.problem ?? "").length > 20,
  );

  // ---- 2. Readiness ------------------------------------------------------
  const all = assessOrderReadiness(ALL_DONE);
  ok("everything done is ready", all.ready);
  ok("everything done shows the panel", all.showPanel);
  ok("everything done has no next step", all.nextStep === null);
  ok("the headline says it is arriving", all.headline.includes("arriving"));

  const none = assessOrderReadiness(NOTHING_DONE);
  ok("nothing done is not ready", !none.ready);
  // The ORIGINAL BUG: a shop that has touched nothing still hides the panel.
  ok("a shop that has never started still hides the panel", !none.showPanel);
  eq("the first thing to do is the menu", none.nextStep?.id, "menu");

  // THE OWNER'S EXACT SITUATION, reconstructed from his screenshot:
  // menu connected, HMAC saved, order key NOT SET, no orders yet.
  const michael = assessOrderReadiness({
    ...NOTHING_DONE,
    menuConfigured: true,
    hmacKeyPresent: true,
    orderIntegrationKeyPresent: false,
    verifiedDeliveryEverReceived: false,
  });
  ok("his situation is not ready", !michael.ready);
  // This is the assertion that the whole UI change exists for. Under the old
  // rule the panel was hidden; it must now show.
  ok("HIS PANEL NOW SHOWS — the bug he reported", michael.showPanel);
  eq(
    "and the next thing to do is send Leafly the URLs, not copy a key",
    michael.nextStep?.id,
    "webhook_urls",
  );
  ok(
    "the explanation names the real cause",
    explainSilentOrder(michael).includes("addresses"),
  );
  ok(
    "the explanation ties it to all three silent symptoms",
    /record/i.test(explainSilentOrder(michael)) &&
      /receipt/i.test(explainSilentOrder(michael)) &&
      /sound/i.test(explainSilentOrder(michael)),
  );

  // Ordering matters: the URL step must come before the key step, because
  // copying a key changes nothing while Leafly has no address to call.
  const ids = michael.steps.map((s) => s.id);
  ok(
    "the URL step is offered before the order-key step",
    ids.indexOf("webhook_urls") < ids.indexOf("order_key"),
  );
  ok("the menu step comes first of all", ids[0] === "menu");
  ok(
    "speaker and printer are NOT blocking — an order must still land without them",
    michael.steps.filter((s) => !s.blocking).map((s) => s.id).sort().join(",") ===
      "printer,speaker",
  );

  // Keys saved but never a verified delivery: still blocked on the URLs.
  const keysButSilent = assessOrderReadiness({
    ...ALL_DONE,
    verifiedDeliveryEverReceived: false,
    anyOrderEverReceived: false,
  });
  ok("saved keys alone do not make it ready", !keysButSilent.ready);
  eq("it is still the URLs that are missing", keysButSilent.nextStep?.id, "webhook_urls");
  ok(
    "one missing thing is phrased in the singular",
    keysButSilent.headline.startsWith("One thing"),
  );

  const twoMissing = assessOrderReadiness({
    ...ALL_DONE,
    verifiedDeliveryEverReceived: false,
    orderIntegrationKeyPresent: false,
  });
  ok("two missing things are counted", twoMissing.headline.startsWith("2 things"));

  // Ready but nothing has arrived yet: a real and reassuring state.
  const readyQuiet = assessOrderReadiness({ ...ALL_DONE, anyOrderEverReceived: false });
  ok("ready with no orders yet is still ready", readyQuiet.ready);
  ok("and says the next order will arrive", readyQuiet.headline.includes("next order"));
  ok(
    "and the explanation points at Leafly's side, not ours",
    explainSilentOrder(readyQuiet).includes("their side"),
  );

  // A missing speaker must never block, but must still be listed.
  const noSpeaker = assessOrderReadiness({ ...ALL_DONE, speakerReady: false });
  ok("a missing speaker does not block readiness", noSpeaker.ready);
  ok(
    "but it is still shown as outstanding",
    noSpeaker.steps.some((s) => s.id === "speaker" && !s.done),
  );
  eq("and it is offered as the next thing to do", noSpeaker.nextStep?.id, "speaker");

  // Every step must be actionable, or the list is decoration.
  ok(
    "every step has a real title and a real instruction",
    all.steps.every((s) => s.title.trim().length > 5 && s.detail.trim().length > 30),
  );
  // Seven since slice L-16 added `pickup_availability`.
  ok("there are seven steps", all.steps.length === 7);
  ok(
    "step ids are unique",
    new Set(all.steps.map((s) => s.id)).size === all.steps.length,
  );
  ok(
    "exactly five steps are blocking",
    all.steps.filter((s) => s.blocking).length === 5,
  );

  // ---- SLICE L-16: the step that stops a false READY --------------------
  // THE DEFECT, RESTATED AS A TEST. A shop with every other step complete
  // could not take a single order, because `sendPickupAvailability` defaults
  // off and the preview webhook therefore told Leafly every item in the cart
  // was unsellable. This panel said "Everything needed is in place".
  {
    const pickupOff = assessOrderReadiness({ ...ALL_DONE, pickupAvailabilityEnabled: false });
    ok(
      "a shop that cannot sell through the marketplace is NOT ready",
      pickupOff.ready === false,
    );
    eq(
      "and pickup availability is named as the thing to do",
      pickupOff.nextStep?.id,
      "pickup_availability",
    );
    ok(
      "the pickup step is blocking, not advisory",
      pickupOff.steps.find((s) => s.id === "pickup_availability")?.blocking === true,
    );
    ok(
      "the headline never claims everything is in place while pickup is off",
      !/everything needed is in place/i.test(pickupOff.headline),
    );

    // The three-valued input is the point: unreadable must not be ticked off.
    const pickupUnknown = assessOrderReadiness({
      ...ALL_DONE,
      pickupAvailabilityEnabled: null,
    });
    ok(
      "an UNREADABLE pickup setting is not treated as done",
      pickupUnknown.steps.find((s) => s.id === "pickup_availability")?.done === false,
    );
    ok(
      "and an unreadable pickup setting does not let the shop read as ready",
      pickupUnknown.ready === false,
    );

    const pickupOn = assessOrderReadiness({ ...ALL_DONE, pickupAvailabilityEnabled: true });
    ok("with pickup on, a fully set-up shop is ready", pickupOn.ready === true);
    ok(
      "and the pickup step reads done",
      pickupOn.steps.find((s) => s.id === "pickup_availability")?.done === true,
    );

    // Exhaustive: only `true` may ever complete this step.
    for (const v of [true, false, null] as const) {
      const r = assessOrderReadiness({ ...ALL_DONE, pickupAvailabilityEnabled: v });
      ok(
        `pickup step done iff the setting is exactly true (${String(v)})`,
        (r.steps.find((s) => s.id === "pickup_availability")?.done === true) === (v === true),
      );
    }

    // Turning pickup off must not disturb any other step's verdict — a new
    // step that silently changed the others would hide the original faults.
    {
      const base = assessOrderReadiness(ALL_DONE);
      const others = pickupOff.steps.filter((s) => s.id !== "pickup_availability");
      ok(
        "adding the pickup step leaves every other step's verdict untouched",
        others.every(
          (s) => base.steps.find((b) => b.id === s.id)?.done === s.done,
        ),
      );
    }
  }
  // If anything is outstanding there must always be a next step, or the panel
  // tells somebody they are stuck with no way forward.
  ok(
    "an unready shop always has a next step",
    [none, michael, keysButSilent, twoMissing].every((r) => !r.ready && r.nextStep !== null),
  );

  return { passed, failed };
}
