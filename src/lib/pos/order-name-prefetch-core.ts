/**
 * pos/order-name-prefetch-core — WHEN the register asks for its fun name, and
 * what it is allowed to do with a late answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS TO FIX (Slice 23 → 24)
 *
 * Slice 23 shipped the fun receipt name to both channels. The website channel
 * worked on the first try, because there the name is claimed SERVER-side, in
 * the same request that inserts the order (orders-store.ts) — by the time the
 * confirmation page renders, the name is already a column on the row.
 *
 * The register cannot do that. It is a separate device that has to ASK the
 * server over HTTP (POST /api/pos/order-name), and Slice 23 fired that request
 * when the TENDER screen opened, parking the answer in a ref that the sale read
 * a moment later at payment. That is a race, and on real hardware the register
 * loses it:
 *
 *   - A quick-tender chip carries the cash amount straight into tender, so the
 *     budtender's very next tap is "Pay". Two taps, not two seconds.
 *   - The packaged iPad app runs at capacitor://localhost and calls an https
 *     origin, so the request is CROSS-ORIGIN: the browser must complete a CORS
 *     preflight OPTIONS round-trip BEFORE the POST is even sent. Two round
 *     trips, not one.
 *   - The endpoint is force-dynamic and does a scrypt device verification plus
 *     an advisory-locked database function before it can answer.
 *
 * When the ref is still null at payment, receipt-core falls back to the real
 * receipt number — silently, because that fallback is deliberate and correct
 * for the offline case. The owner therefore saw a receipt with the real number
 * and NO error of any kind. Reported from the counter as: "the printed receipt
 * did not print the fun overlay, it used the real receipt number instead."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE RULES THIS MODULE ENCODES
 *
 * 1. ASK EARLY. The trigger moves from "tender opened" to "the first item
 *    landed in the cart". That converts a sub-second budget into the whole
 *    duration of ringing up a sale. It does NOT fire on an empty cart, because
 *    an empty cart is not yet a sale and every draw consumes a name.
 *
 * 2. ASK ONCE. Every draw permanently consumes a name from the rotation and
 *    pulls the next repeat closer. Emptying the cart and re-adding, stepping
 *    back from tender, or a re-render must never draw a second name.
 *
 * 3. A LATE ANSWER IS STILL USEFUL — BUT ONLY BEFORE PRINT. If the name lands
 *    after the receipt was frozen but before anything was printed, we may still
 *    use it. Once ink is on paper the snapshot is closed forever: the slip in
 *    the customer's hand and the reprint months later must never disagree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PURE MODULE AND NOT JUST A useEffect
 *
 * Every rule above is a DECISION, and decisions that live inline in a 5,000
 * line component cannot be tested and quietly rot. Here each one is a function
 * over plain values with self-tests below, so the next change to SaleFlow
 * cannot silently reintroduce the race: `shouldRequestName` is what a
 * regression test can pin, and a test that asserts "tender is NOT the trigger"
 * is a sentence, not an archaeology dig.
 *
 * AGENTS.md rule 5: PURE core + __run…Tests(), no imports, no I/O.
 */

// ---------------------------------------------------------------------------
// 1) WHEN to ask
// ---------------------------------------------------------------------------

/** What the register knows at the moment it is deciding whether to ask. */
export type PrefetchGate = {
  /** How many distinct lines are in the cart right now. */
  cartLineCount: number;
  /** Has a request already been started for THIS sale? */
  alreadyRequested: boolean;
  /** Is a fun-name provider wired at all? (absent in some embeddings.) */
  providerAvailable: boolean;
};

/**
 * Should the register draw a fun name right now?
 *
 * True on exactly one edge: a provider exists, the cart has become non-empty,
 * and nothing has been drawn yet for this sale. Everything else is false.
 *
 * The cart-count test is `> 0` rather than `=== 1` on purpose. A sale can reach
 * a populated cart without ever passing through "exactly one line" — a resumed
 * hold and a loaded website order both seed a multi-line cart in one step — and
 * an `=== 1` test would silently never fire for those, which is precisely the
 * class of bug this module exists to end.
 */
export function shouldRequestName(gate: PrefetchGate): boolean {
  if (!gate.providerAvailable) return false;
  if (gate.alreadyRequested) return false;
  return gate.cartLineCount > 0;
}

// ---------------------------------------------------------------------------
// 2) WHAT a returned name is worth
// ---------------------------------------------------------------------------

/** The longest fun name the sale payload will carry (mirrors sale-event-core). */
export const PREFETCH_NAME_MAX_LEN = 40;

/**
 * Normalize whatever the network handed back into either a usable name or null.
 *
 * Null is not an error here — it is the owner's stated fallback ("if we do [go
 * without internet], the fall back can be to just use the real receipt
 * number"). So every unusable shape collapses to the same safe answer rather
 * than throwing: wrong type, blank, whitespace-only, or longer than the payload
 * will accept. An over-long name is DROPPED rather than truncated, because a
 * truncated fun name is a different name than the one the pool recorded as
 * assigned, and the receipt would then disagree with the back office.
 */
export function normalizePrefetchedName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > PREFETCH_NAME_MAX_LEN) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// 3) WHETHER a late answer may still be used
// ---------------------------------------------------------------------------

/** The receipt's lifecycle as far as a late-arriving name is concerned. */
export type LateFillState = {
  /** The name the frozen receipt currently carries (null = real number). */
  current: string | null;
  /** The name that just arrived from the server. */
  arrived: string | null;
  /** Has this receipt been sent to a printer (or emailed) yet? */
  alreadyPrinted: boolean;
  /**
   * Did the QUEUED sale payload carry a fun name? The register's offline queue
   * is append-only until the server durably ACKs (register-client-core), and
   * the payload is enqueued BEFORE the receipt is frozen — so if the name lost
   * the race to the enqueue, the back office will never have it.
   */
  payloadCarriedName: boolean;
};

/**
 * May a late-arriving name be written into the already-frozen receipt?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION IS DELIBERATELY ALMOST ALWAYS FALSE. READ BEFORE LOOSENING IT.
 *
 * The obvious "fix" for a name that arrives a moment too late is to paste it
 * onto the receipt before printing. That is WRONG here, and the reason is the
 * queue: `onEnqueue("sale", payload)` happens BEFORE the receipt is frozen,
 * and that queue is append-only until the server ACKs. There is no amend API,
 * by design — an append-only ledger is what makes the register's offline sales
 * trustworthy.
 *
 * So a name pasted onto the receipt AFTER the enqueue would be printed on the
 * customer's slip while the sale recorded in the back office carries no name at
 * all. A reprint rebuilds from that STORED payload
 * (receipt-reprint-core.rebuildReceiptFromPayload), so the reprint would show
 * the real receipt number while the original paper showed a fun name. Two
 * different receipts for one sale is a traceability defect, and it is strictly
 * worse than the cosmetic problem it was trying to solve.
 *
 * Hence `payloadCarriedName`: a late name may only be written into the receipt
 * when the SAME name already went into the queued payload. In practice that
 * makes this a narrow, honest guard rather than a rescue — the real fix for the
 * race is asking early (shouldRequestName), not patching afterwards.
 */
export function canFillLateName(state: LateFillState): boolean {
  // Once ink is on paper (or an email is sent) the snapshot is closed forever.
  if (state.alreadyPrinted) return false;
  // Never overwrite a name that is already on the receipt.
  if (state.current !== null) return false;
  // Nothing arrived: nothing to do.
  if (state.arrived === null) return false;
  // THE RULE THAT MATTERS: never print a name the back office does not have.
  return state.payloadCarriedName;
}

// ---------------------------------------------------------------------------
// 4) WHAT to tell the humans when the pool cannot be reached
// ---------------------------------------------------------------------------

/** Why the register has no fun name for this sale (null = it has one). */
export type PrefetchFailure = "offline" | "unreachable" | "empty-pool" | null;

/**
 * The register's status-footer line for a fun-name problem, or null for silence.
 *
 * The whole reason this defect cost a live shift is that it failed SILENTLY:
 * the receipt quietly printed the real number and nothing anywhere said why.
 * A visible line turns "why is the fun name gone?" from an investigation into
 * a glance.
 *
 * `offline` deliberately returns null. Offline is the documented, expected
 * fallback the owner asked for, the register already shows a prominent offline
 * indicator, and adding a second complaint about a known state is noise that
 * trains staff to ignore the footer.
 */
export function prefetchStatusNote(failure: PrefetchFailure): string | null {
  switch (failure) {
    case "unreachable":
      return "Receipt names unavailable — receipts will print the real receipt number.";
    case "empty-pool":
      return "No receipt names in the pool — receipts will print the real receipt number.";
    case "offline":
    case null:
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 5) INHERITANCE — a loaded website order already HAS a name (SLICE 26)
// ---------------------------------------------------------------------------

/**
 * THE DEFECT THIS SECTION EXISTS TO FIX
 *
 * A website order is given its fun name SERVER-side, in the same request that
 * inserts the row (orders-store.ts). The customer sees that name twice before
 * they ever reach the store: on the confirmation screen and in their email.
 *
 * Later they arrive, the budtender opens the pickup queue and loads the order
 * into a register sale. That load hands the device the order's LINES, its
 * customer and its id — but never its display_name (PickupOrderDetail and
 * LoadOrderResult both lack the field). So the register did what it does for
 * any sale: it drew a BRAND NEW name from the pool. The printed receipt then
 * disagreed with the confirmation page and the email for one and the same
 * order.
 *
 * Owner: "the fun overlay on the printed receipt is now different from the one
 * originally attached to the online order. I am all about consistency and I
 * feel like if I notice this, others will too."
 *
 * THE SECOND, QUIETER BUG IN THE SAME PLACE
 *
 * That fresh draw also CONSUMED a pool name. Every draw stamps the rotation
 * sequence and pulls the next repeat closer, so a shop doing mostly pickup
 * orders was burning two names per customer to print one. Inheriting fixes the
 * cosmetic complaint and stops the leak in the same move: an inherited name
 * costs the rotation nothing, and — because loading is not selling — an order
 * that is loaded and then abandoned now costs it nothing either.
 */

/** What to do about the name for a sale that may have been loaded from an order. */
export type NameInheritance =
  /** Reuse the name the customer has already seen. Consumes NO pool slot. */
  | { action: "inherit"; name: string }
  /** No name to inherit — draw one from the pool as usual. */
  | { action: "draw" };

/**
 * Decide whether a sale reuses a loaded website order's name or draws a new one.
 *
 * `inherit` on exactly one condition: this sale came from a website order AND
 * that order is carrying a non-blank display_name. Then the receipt prints the
 * name the customer already has in their inbox, and the pool is not touched.
 *
 * Everything else draws. The important "everything else" is a loaded order with
 * NO stored name, which happens for orders placed before the pool existed,
 * before migration 0147 was applied, or while the pool was empty. Those
 * customers were shown the plain GWY- order number, so there is no name to be
 * consistent WITH, and drawing gives the paper slip a name exactly as a
 * walk-in would get. A lookup that fails outright lands here too: not knowing
 * is treated as not having, because a sale must never wait on — or be degraded
 * by — a decorative read.
 *
 * The name is returned UNTOUCHED, deliberately. It is not re-validated against
 * PREFETCH_NAME_MAX_LEN here, because this function's job is to answer "whose
 * name is this?", not "is it printable?" — normalizePrefetchedName remains the
 * single gate for that, and an over-long inherited name simply degrades to the
 * real receipt number. Re-deciding to DRAW on an over-long name would be the
 * worst of both worlds: it would burn a pool slot AND print a name that
 * contradicts the customer's email, which is the exact defect above.
 */
export function resolveNameInheritance(input: {
  sourceOrderId: string | null;
  storedDisplayName: string | null | undefined;
}): NameInheritance {
  if (input.sourceOrderId === null) return { action: "draw" };
  if (typeof input.storedDisplayName !== "string") return { action: "draw" };
  const trimmed = input.storedDisplayName.trim();
  if (trimmed === "") return { action: "draw" };
  return { action: "inherit", name: trimmed };
}

/**
 * Is this a source-order id the name endpoint should even look up?
 *
 * The register asks for its name over an authenticated POST, and this value
 * decides which row that request reads. Anything that is not UUID-shaped is
 * dropped to null rather than forwarded, so a corrupted resume snapshot or a
 * stale local value degrades to an ordinary draw instead of becoming an
 * arbitrary string handed to the data layer.
 *
 * Mirrors the UUID guard the pickup route already applies to the same id.
 */
export function normalizeSourceOrderIdForName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Self-tests — run in CI via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------

export function __runOrderNamePrefetchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: order-name-prefetch-core: ${label}`);
    }
  };

  const gate = (over: Partial<PrefetchGate> = {}): PrefetchGate => ({
    cartLineCount: 1,
    alreadyRequested: false,
    providerAvailable: true,
    ...over,
  });

  // --- 1) when to ask -------------------------------------------------------
  ok("first item in cart triggers the draw", shouldRequestName(gate()));
  ok("empty cart never draws", !shouldRequestName(gate({ cartLineCount: 0 })));
  ok("second item does not draw again", !shouldRequestName(gate({ cartLineCount: 2, alreadyRequested: true })));
  ok("no provider means no draw", !shouldRequestName(gate({ providerAvailable: false })));
  ok(
    "a multi-line cart seeded in one step still draws (resumed hold / website order)",
    shouldRequestName(gate({ cartLineCount: 4 })),
  );
  ok(
    "emptying and refilling the cart never draws a second name",
    !shouldRequestName(gate({ cartLineCount: 1, alreadyRequested: true })),
  );
  ok(
    "an empty cart does not draw even after a previous request",
    !shouldRequestName(gate({ cartLineCount: 0, alreadyRequested: true })),
  );

  // THE REGRESSION PIN. Slice 23 asked at tender; Slice 24 asks at cart entry.
  // If someone ever moves the trigger back to the tender screen, the cart will
  // be non-empty and this stays true — so the pin that actually protects us is
  // the pair below: a draw MUST be available while the cart is still being
  // built, i.e. long before tender.
  ok(
    "SLICE 24: the name is drawn while the cart is still open, not at tender",
    shouldRequestName(gate({ cartLineCount: 1, alreadyRequested: false })),
  );

  // --- 2) what a name is worth ---------------------------------------------
  ok("a good name survives", normalizePrefetchedName("High Life") === "High Life");
  ok("surrounding whitespace is trimmed", normalizePrefetchedName("  High Life  ") === "High Life");
  ok("blank is null", normalizePrefetchedName("") === null);
  ok("whitespace-only is null", normalizePrefetchedName("   ") === null);
  ok("null is null", normalizePrefetchedName(null) === null);
  ok("undefined is null", normalizePrefetchedName(undefined) === null);
  ok("a number is not a name", normalizePrefetchedName(42) === null);
  ok("an object is not a name", normalizePrefetchedName({ name: "x" }) === null);
  ok(
    "a name exactly at the limit is kept",
    normalizePrefetchedName("x".repeat(PREFETCH_NAME_MAX_LEN)) === "x".repeat(PREFETCH_NAME_MAX_LEN),
  );
  ok(
    "an over-long name is dropped, never truncated",
    normalizePrefetchedName("x".repeat(PREFETCH_NAME_MAX_LEN + 1)) === null,
  );
  ok("the limit matches the sale payload's limit", PREFETCH_NAME_MAX_LEN === 40);

  // --- 3) late arrival ------------------------------------------------------
  const late = (over: Partial<LateFillState> = {}): LateFillState => ({
    current: null,
    arrived: "High Life",
    alreadyPrinted: false,
    payloadCarriedName: true,
    ...over,
  });

  ok("a late name fills an unprinted receipt the payload also carries", canFillLateName(late()));
  ok(
    "SLICE 24: a printed receipt is closed forever",
    !canFillLateName(late({ alreadyPrinted: true })),
  );
  ok(
    "a name already on the receipt is never overwritten",
    !canFillLateName(late({ current: "First Pick" })),
  );
  ok("nothing arrived means nothing to fill", !canFillLateName(late({ arrived: null })));
  ok(
    "printed AND already named is still refused",
    !canFillLateName(late({ current: "First Pick", alreadyPrinted: true })),
  );

  // THE APPEND-ONLY QUEUE PIN. The sale payload is enqueued BEFORE the receipt
  // is frozen and can never be amended, so printing a name the payload does not
  // carry would make the customer's slip and its own reprint disagree.
  ok(
    "SLICE 24: never print a fun name the queued sale payload does not carry",
    !canFillLateName(late({ payloadCarriedName: false })),
  );
  ok(
    "SLICE 24: an unrecorded late name is refused even on a pristine receipt",
    !canFillLateName({
      current: null,
      arrived: "Purple Rain",
      alreadyPrinted: false,
      payloadCarriedName: false,
    }),
  );

  // --- 4) the visible diagnostic -------------------------------------------
  ok("a healthy draw says nothing", prefetchStatusNote(null) === null);
  ok("offline stays silent (expected fallback)", prefetchStatusNote("offline") === null);
  ok(
    "an unreachable server is announced",
    (prefetchStatusNote("unreachable") ?? "").includes("real receipt number"),
  );
  ok(
    "an empty pool is announced distinctly",
    (prefetchStatusNote("empty-pool") ?? "").includes("pool"),
  );
  ok(
    "the two failure notes differ, so the cause is readable",
    prefetchStatusNote("unreachable") !== prefetchStatusNote("empty-pool"),
  );

  // --- 5) SLICE 26: inheriting a loaded website order's name ----------------
  const inh = (sourceOrderId: string | null, storedDisplayName: string | null | undefined) =>
    resolveNameInheritance({ sourceOrderId, storedDisplayName });
  const ORD = "4f6d2a1e-8c3b-4d5e-9a7f-1b2c3d4e5f60";

  ok(
    "SLICE 26: a loaded website order REUSES the name the customer already saw",
    inh(ORD, "Purple Rain").action === "inherit",
  );
  {
    const got = inh(ORD, "Purple Rain");
    ok(
      "SLICE 26: the inherited name is exactly the order's stored name",
      got.action === "inherit" && got.name === "Purple Rain",
    );
  }
  ok("a walk-in sale draws (no source order)", inh(null, "Purple Rain").action === "draw");
  ok("a walk-in with no stored name draws", inh(null, null).action === "draw");
  ok(
    "a loaded order with NO stored name draws (pre-pool / pre-0147 / empty pool)",
    inh(ORD, null).action === "draw",
  );
  ok("a loaded order with an undefined name draws", inh(ORD, undefined).action === "draw");
  ok("a loaded order with a blank name draws", inh(ORD, "").action === "draw");
  ok("a loaded order with a whitespace-only name draws", inh(ORD, "   ").action === "draw");
  {
    const got = inh(ORD, "  Purple Rain  ");
    ok(
      "an inherited name is trimmed, so it matches the confirmation page byte for byte",
      got.action === "inherit" && got.name === "Purple Rain",
    );
  }

  // THE POOL-LEAK PIN. Inheriting must consume NOTHING: the whole point is that
  // a pickup no longer burns a second name to print the first one. Expressed as
  // the only observable the pure layer has — inherit is never "draw".
  ok(
    "SLICE 26: inheriting never falls through to a draw (no pool slot is burned)",
    inh(ORD, "High Life").action !== "draw",
  );
  // An over-long inherited name is still INHERITED, not re-drawn. Drawing here
  // would burn a slot AND print a name contradicting the customer's email;
  // normalizePrefetchedName is the single gate that decides printability.
  ok(
    "an over-long inherited name is still inherited, never re-drawn",
    inh(ORD, "x".repeat(PREFETCH_NAME_MAX_LEN + 5)).action === "inherit",
  );

  // --- 5b) the source-order id guard ---------------------------------------
  ok("a UUID source order id survives", normalizeSourceOrderIdForName(ORD) === ORD);
  ok("a UUID is trimmed", normalizeSourceOrderIdForName(`  ${ORD}  `) === ORD);
  ok("an uppercase UUID survives", normalizeSourceOrderIdForName(ORD.toUpperCase()) === ORD.toUpperCase());
  ok("a non-UUID string is dropped", normalizeSourceOrderIdForName("not-a-uuid") === null);
  ok("a blank id is dropped", normalizeSourceOrderIdForName("") === null);
  ok("null is dropped", normalizeSourceOrderIdForName(null) === null);
  ok("undefined is dropped", normalizeSourceOrderIdForName(undefined) === null);
  ok("a number is not an id", normalizeSourceOrderIdForName(42) === null);
  ok("an object is not an id", normalizeSourceOrderIdForName({ id: ORD }) === null);
  ok(
    "an id with a trailing character is refused, not truncated",
    normalizeSourceOrderIdForName(`${ORD}x`) === null,
  );

  console.log(`pos/order-name-prefetch-core self-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
  return { passed, failed };
}
