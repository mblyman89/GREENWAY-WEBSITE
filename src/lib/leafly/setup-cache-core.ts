/**
 * src/lib/leafly/setup-cache-core.ts
 *
 * SLICE L-18 — THE SAVE THAT NEVER FINISHES.
 *
 * ===========================================================================
 * THE COMPLAINT
 * ===========================================================================
 *   > "Settings save hangs on the online orders dashboard."
 *
 * ===========================================================================
 * WHAT IS ACTUALLY HAPPENING (measured by reading, not guessed)
 * ===========================================================================
 * `/admin/orders` is `export const dynamic = "force-dynamic"` (page.tsx:60),
 * so every single render runs `loadLeaflyOrderSetupState()` (page.tsx:199).
 * That function fans out to six reads, one of which is:
 *
 *   countPublishedLeaflyVariants()      order-readiness-server.ts:469
 *     -> buildLeaflyVariantLookup()     preview-lookup.ts:45
 *        -> loadSyndicationFeed()       feed-source.ts:18
 *           -> getPublishedVersion()
 *           -> getVersionItems()            paged over menu_items + menu_variants
 *           -> resolveProductImagesBatch()  batch image enrichment
 *           -> getMedicalRegistryForKeys()  DOH registry
 *
 * The ENTIRE published menu is rebuilt from the database, with image
 * enrichment and the DOH registry, so that the panel can print ONE INTEGER:
 * "N variants published". Nothing else on the page uses the lookup.
 *
 * Then every server action on the page ends with
 * `revalidatePath("/admin/orders")` (announcer-actions.ts:245, and 20 more
 * call sites in actions.ts), and the page re-renders — paying the full
 * rebuild again before the screen repaints. That is the "hang": the save
 * itself is a single fast UPDATE, but the owner cannot see it land until a
 * full menu rebuild has finished behind it.
 *
 * ===========================================================================
 * WHY THIS IS A *POLICY* FILE AND NOT A ONE-LINE CACHE CALL
 * ===========================================================================
 * `buildLeaflyVariantLookup()` has exactly two callers, and they are not
 * remotely alike:
 *
 *   1. src/app/api/webhooks/leafly/order-preview/route.ts:126
 *        THE MONEY PATH. It prices a real shopper's real cart. Leafly's spec
 *        runs order_preview INLINE in the cart update, and (per Leafly's own
 *        integration engineer) it is the ONE webhook that is never retried.
 *
 *   2. src/lib/leafly/order-readiness-server.ts:472
 *        A COUNT ON A SETUP PANEL. Display only. Charges nobody.
 *
 * The house already has a written rule for exactly this situation, in
 * `menu-cache-policy-core.ts`:
 *
 *        CACHE THE DISPLAY. NEVER CACHE THE MONEY.
 *
 * So this slice does NOT cache `buildLeaflyVariantLookup`. It adds a separate,
 * opt-in, display-only entry point for the count, and leaves the preview
 * webhook reading straight through to the database exactly as it does today.
 * That is the same shape the menu cache slice used: a second cached function
 * rather than a cached shared loader, so the money path cannot accidentally
 * inherit the fast behaviour.
 *
 * ===========================================================================
 * THE TWO TRAPS THIS FILE EXISTS TO NAME  (both verified, not theorised)
 * ===========================================================================
 *
 * TRAP 1 — `unstable_cache` SERIALISES ITS RESULT AS JSON.
 *   Verified in next@16.2.9 at
 *   node_modules/next/dist/server/web/spec-extension/unstable-cache.js:23
 *       body: JSON.stringify(result)
 *   and read back at line 168 with JSON.parse.
 *
 *   `buildLeaflyVariantLookup()` returns `{ lookup, variantCount, loaded }`
 *   where `lookup` IS A FUNCTION. `JSON.stringify` drops functions silently —
 *   no error, no warning. So wrapping that function in `unstable_cache` would
 *   return an object whose `lookup` is `undefined`, and the very next line of
 *   the preview webhook calls `lookup(id)`. Every shopper's cart would throw.
 *
 *   The obvious one-line fix is therefore a LIVE OUTAGE ON THE MONEY PATH,
 *   and it fails in a way no type check catches, because the cached wrapper
 *   keeps the original return type. `isCacheableShape()` below is the guard.
 *
 * TRAP 2 — `unstable_cache` CANNOT TELL SUCCESS FROM FAILURE.
 *   It caches whatever the callback returns. `buildLeaflyVariantLookup`
 *   catches its own errors and returns `{ variantCount: 0, loaded: false }`.
 *   Cache that, and a single transient database blip pins "0 variants
 *   published" on the setup panel for the whole TTL — telling the owner his
 *   Leafly menu is empty when it is not. `countPublishedLeaflyVariants`
 *   already distinguishes these two cases by returning `null` for "could not
 *   check" (order-readiness-server.ts:466-467); this file makes that
 *   distinction survive caching. `isCacheableOutcome()` below is the guard:
 *   a failed read is returned to the caller but NEVER stored.
 *
 * Everything here is PURE: no imports, no I/O, no Next.js, no database. It
 * carries its own self-test and is registered in run-pure-selftests.ts.
 */

/* -------------------------------------------------------------------------- *
 * 1. Who is allowed to serve a cached answer
 * -------------------------------------------------------------------------- */

/**
 * A caller of the Leafly published-menu lookup, and whether it may be served
 * from cache.
 *
 * This mirrors `MENU_READ_SURFACES` in `menu-cache-policy-core.ts` on purpose.
 * That table governs the LIVE MENU loaders. This one governs the LEAFLY
 * variant lookup, which is a different function with a different (and much
 * shorter) caller list. Keeping them separate means neither table can quietly
 * grow a surface that belongs to the other, and each stays short enough to be
 * read in full by a human.
 */
export type LeaflyLookupSurface = {
  /** Human-readable name, used in failure messages. */
  readonly name: string;
  /** Where it lives, so a reader can go and check the claim. */
  readonly anchor: string;
  /** True = may serve a cached copy. False = must read through to the database. */
  readonly cacheable: boolean;
  /**
   * Does this surface decide what somebody is CHARGED, or what stock is
   * committed?
   *
   * An EXPLICIT field rather than something inferred from the prose below.
   * The first draft of this file tried to detect money surfaces by grepping
   * `reason` for /price|cart|charge/, and it immediately misfired: the setup
   * panel's reason contains the words "it charges nobody", so a NEGATION read
   * as a positive and the safety test failed on a surface that is perfectly
   * safe. An ambiguous probe is not a probe. Whoever adds a surface here must
   * answer this question deliberately, in a boolean, and the self-test below
   * enforces the one rule that follows from it: money is never cacheable.
   */
  readonly touchesMoney: boolean;
  /** Why. Written for a person, not a compiler. */
  readonly reason: string;
};

/**
 * Every caller of `buildLeaflyVariantLookup()`, classified.
 *
 * If a surface is not in this list, it has not been considered, and
 * `isLeaflyLookupCacheable()` answers false for it. Fail closed: a new caller
 * nobody reviewed gets the slow, correct behaviour.
 */
export const LEAFLY_LOOKUP_SURFACES: readonly LeaflyLookupSurface[] = [
  {
    name: "Order setup panel variant count",
    anchor: "src/lib/leafly/order-readiness-server.ts:472",
    cacheable: true,
    touchesMoney: false,
    reason:
      "Prints one integer on a setup panel so the owner can see his menu is published. Display only; it charges nobody and decides nothing.",
  },
  {
    name: "Order preview webhook",
    anchor: "src/app/api/webhooks/leafly/order-preview/route.ts:126",
    cacheable: false,
    touchesMoney: true,
    reason:
      "Prices a real shopper's real cart inline during cart update, and Leafly never retries it. A cached price is a wrong price, and a cached stock level oversells product that is physically gone.",
  },
  {
    // SLICE L-48 — "Update Order's Cart". Staff add, swap or re-quantity items
    // on a live Leafly order; the menu read supplies the default unit price
    // sent to Leafly and the stock check that stops an oversell.
    name: "Order cart update (Change items)",
    anchor: "src/lib/leafly/order-cart-server.ts:205",
    cacheable: false,
    touchesMoney: true,
    reason:
      "Sets the unit price Leafly bills a real customer for an added or swapped item, and checks stock before the change is sent. A cached menu would bill a stale price and add product that is already sold.",
  },
];

/**
 * May this surface serve a cached copy?
 *
 * Unknown surfaces answer FALSE. Fail closed, exactly as
 * `isCacheableSurface()` does for the live menu.
 */
export function isLeaflyLookupCacheable(name: string): boolean {
  const found = LEAFLY_LOOKUP_SURFACES.find((s) => s.name === name);
  return found ? found.cacheable : false;
}

/** The exact set of names permitted to serve cached data. */
export const CACHEABLE_LEAFLY_LOOKUP_SURFACES: readonly string[] =
  LEAFLY_LOOKUP_SURFACES.filter((s) => s.cacheable).map((s) => s.name);

/* -------------------------------------------------------------------------- *
 * 2. TRAP 1 — is this value even survivable as JSON?
 * -------------------------------------------------------------------------- */

/**
 * Would this value survive a `JSON.stringify` / `JSON.parse` round trip with
 * its meaning intact?
 *
 * This is the guard against the trap that would have taken the shop's order
 * preview down. `unstable_cache` stores `JSON.stringify(result)` and returns
 * `JSON.parse(...)` of it, and `JSON.stringify` deletes functions, `undefined`
 * and symbols from objects WITHOUT ERROR. A cached function therefore comes
 * back as `undefined`, keeps its original TypeScript type, and explodes at the
 * call site instead of at the cache.
 *
 * Returns false for anything containing a function, a symbol, or a value
 * `JSON.stringify` refuses outright (a BigInt, a circular reference).
 *
 * Deliberately conservative: `undefined` as an OBJECT PROPERTY is a silent
 * deletion and is rejected, because "the key vanished" is precisely the
 * failure mode we are defending against.
 */
export function isCacheableShape(value: unknown): boolean {
  return inspectShape(value, new Set()) === null;
}

/**
 * The same check, but it tells you WHAT is wrong and WHERE.
 *
 * Returns null when the value is safe, or a human sentence naming the
 * offending path when it is not. A guard that only says "no" invites the next
 * person to delete it; one that says "`lookup` is a function, and JSON.stringify
 * deletes functions" gets fixed instead.
 */
export function describeUncacheableShape(value: unknown): string | null {
  return inspectShape(value, new Set());
}

/**
 * `seen` is the set of objects on the CURRENT PATH from the root, not every
 * object ever visited.
 *
 * That distinction is the difference between detecting a cycle and rejecting
 * a perfectly ordinary shape. `[shared, shared]` -- the same object appearing
 * twice side by side -- is not circular; `JSON.stringify` serialises it into
 * two independent copies without complaint. A visited-set that is never
 * unwound would call that a circular reference and refuse to cache a value
 * that is completely safe.
 *
 * So the object is added on the way down and REMOVED on the way back up
 * (the `seen.delete` below), which is what makes this a cycle check rather
 * than a duplicate check. A Set is used instead of a WeakSet because entries
 * must be removable and the set is short-lived and rooted on the stack.
 */
function inspectShape(value: unknown, seen: Set<object>, path = "value"): string | null {
  const t = typeof value;

  if (t === "function") {
    return `${path} is a function, and JSON.stringify deletes functions — it would come back undefined`;
  }
  if (t === "symbol") {
    return `${path} is a symbol, and JSON.stringify deletes symbols — it would come back undefined`;
  }
  if (t === "bigint") {
    return `${path} is a BigInt, and JSON.stringify throws on BigInt`;
  }
  if (t === "undefined") {
    return `${path} is undefined, and JSON.stringify deletes undefined properties — the key would vanish`;
  }
  if (value === null || t === "string" || t === "boolean") return null;

  if (t === "number") {
    // NaN and Infinity both serialise to the literal `null`, which is a silent
    // change of meaning: a count of NaN would read back as "no answer".
    if (!Number.isFinite(value as number)) {
      return `${path} is ${String(value)}, and JSON.stringify turns that into null — the value would change meaning`;
    }
    return null;
  }

  if (t === "object") {
    const obj = value as object;
    if (seen.has(obj)) {
      return `${path} is a circular reference, and JSON.stringify throws on circular structures`;
    }
    seen.add(obj);

    // A Date survives as a string, not a Date. That IS a change of type, so it
    // is called out rather than quietly allowed.
    if (obj instanceof Date) {
      return `${path} is a Date, and JSON round-tripping returns a string instead — store an ISO string explicitly`;
    }
    // Maps and Sets serialise to `{}`. Total, silent data loss.
    if (obj instanceof Map) {
      return `${path} is a Map, and JSON.stringify turns it into {} — every entry would be lost`;
    }
    if (obj instanceof Set) {
      return `${path} is a Set, and JSON.stringify turns it into {} — every entry would be lost`;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i += 1) {
        const bad = inspectShape(obj[i], seen, `${path}[${i}]`);
        if (bad) {
          seen.delete(obj);
          return bad;
        }
      }
      seen.delete(obj);
      return null;
    }

    for (const [k, v] of Object.entries(obj)) {
      const bad = inspectShape(v, seen, `${path}.${k}`);
      if (bad) {
        seen.delete(obj);
        return bad;
      }
    }
    // Unwind: this object is no longer on the path, so a later sibling that
    // references it again is a duplicate, not a cycle.
    seen.delete(obj);
    return null;
  }

  return `${path} has type ${t}, which is not safe to store as JSON`;
}

/* -------------------------------------------------------------------------- *
 * 3. TRAP 2 — is this OUTCOME one we are willing to remember?
 * -------------------------------------------------------------------------- */

/**
 * The three things a "count the published variants" read can produce.
 *
 * Modelled explicitly because the difference between the last two is the
 * difference between telling the owner the truth and lying to him for a
 * minute. `countPublishedLeaflyVariants()` already returns `null` rather than
 * `0` when the feed did not load, for exactly this reason
 * (order-readiness-server.ts:464-467). This type carries that distinction
 * into the cache layer instead of letting it be flattened back into a number.
 */
export type VariantCountOutcome =
  /** The menu was read and it really does have this many orderable variants. */
  | { readonly kind: "counted"; readonly count: number }
  /** The menu was read and it genuinely has nothing published. A real fact. */
  | { readonly kind: "empty" }
  /** The read failed. NOT a fact about the menu — a fact about the read. */
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * May this outcome be written to the cache?
 *
 * Only a successful read may be stored. An `unreadable` outcome is returned to
 * the caller (so the panel can say "couldn't check just now") but never
 * persisted, because persisting it would turn one transient database blip into
 * a full TTL of the panel insisting the owner's Leafly menu is empty.
 *
 * `empty` IS cacheable: "you have published nothing" is a true and useful
 * answer, and it is the answer before the first push. Conflating it with
 * `unreadable` is the exact bug this type exists to prevent.
 */
export function isCacheableOutcome(outcome: VariantCountOutcome): boolean {
  return outcome.kind === "counted" || outcome.kind === "empty";
}

/**
 * Turn the raw shape `buildLeaflyVariantLookup()` returns into an outcome.
 *
 * `loaded: false` is the module's own signal that it caught an error and is
 * returning a placeholder; its `variantCount` of 0 is meaningless in that
 * case and must never be reported as zero published variants.
 */
export function classifyVariantCount(input: {
  loaded: boolean;
  variantCount: number;
}): VariantCountOutcome {
  if (!input.loaded) {
    return {
      kind: "unreadable",
      reason: "the published menu could not be loaded",
    };
  }
  if (!Number.isFinite(input.variantCount) || input.variantCount < 0) {
    return {
      kind: "unreadable",
      reason: "the published menu returned a count that is not a whole number",
    };
  }
  const count = Math.floor(input.variantCount);
  return count === 0 ? { kind: "empty" } : { kind: "counted", count };
}

/**
 * The number to show, or null for "we could not check".
 *
 * Null and zero are different sentences on screen and must stay different in
 * code. This is the single place that decision is made.
 */
export function countForDisplay(outcome: VariantCountOutcome): number | null {
  switch (outcome.kind) {
    case "counted":
      return outcome.count;
    case "empty":
      return 0;
    case "unreadable":
      return null;
  }
}

/**
 * The verdict on whether a read may be written to the cache.
 *
 * `store` is the answer. `outcome` is what the CALLER should be handed either
 * way — note that a refused write still returns a usable outcome, because
 * "we could not check just now" is a perfectly good thing to show the owner.
 * `reason` is populated only on a refusal and exists so the refusal can be
 * explained rather than merely happening.
 */
export type CacheWriteVerdict = {
  readonly store: boolean;
  readonly outcome: VariantCountOutcome;
  readonly reason: string | null;
};

/**
 * THE ONE PLACE that decides whether a variant-count read may be remembered.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO IFS IN THE SERVER SHELL
 * ──────────────────────────────────────────────────────────
 * It used to be two ifs in `setup-cache-server.ts`. The mutation probe found
 * the problem with that: the shell is an I/O module, so the only tests that
 * could reach those ifs were grepping its source text — and a mutant that
 * replaced `if (!isCacheableOutcome(outcome))` with `if (false)` left every
 * grepped token intact and SURVIVED. A guard that no test can execute is not
 * a guard, it is a comment with punctuation (rule 13c).
 *
 * Moving the judgement here makes it a pure function that a test can call with
 * a hostile value and watch refuse. House rule 11 as well: "may I store this?"
 * now has exactly one home, and the shell does what a shell should do — I/O,
 * and asking someone else what it means.
 *
 * TWO INDEPENDENT REASONS TO REFUSE, IN ORDER:
 *
 *  1. TRAP 2 — the read FAILED. `unstable_cache` cannot tell success from
 *     failure; it stores whatever it is given. Storing `unreadable` turns one
 *     transient database blip into a full TTL of the setup panel insisting the
 *     owner's Leafly menu is empty. Checked first, because it is the one that
 *     actually happens.
 *
 *  2. TRAP 1 — the value would not SURVIVE JSON. Today a `VariantCountOutcome`
 *     cannot legally hold a function, so this cannot fire from typed code. It
 *     is here for the day someone widens the type to carry the lookup "just
 *     for convenience" — which is the precise mistake this whole slice exists
 *     to prevent, and which would hand the order-preview webhook an
 *     `undefined` lookup and throw on a real shopper's real cart. The
 *     parameter is deliberately typed `unknown` so that widening cannot make
 *     this branch unreachable at the type level either.
 */
export function decideCacheWrite(outcome: unknown): CacheWriteVerdict {
  // Not a recognisable outcome at all. Refuse, and describe it rather than
  // crashing — this is the belt-and-braces path, and it must not be the thing
  // that takes the page down.
  if (!isVariantCountOutcome(outcome)) {
    return {
      store: false,
      outcome: {
        kind: "unreadable",
        reason: "the published menu count came back in a shape this code does not recognise",
      },
      reason: "not a VariantCountOutcome",
    };
  }

  // 1. A failed read is returned, never remembered.
  if (!isCacheableOutcome(outcome)) {
    return { store: false, outcome, reason: "the read failed, so there is nothing true to remember" };
  }

  // 2. A value that JSON would mangle is never remembered either.
  const shapeProblem = describeUncacheableShape(outcome);
  if (shapeProblem !== null) {
    return {
      store: false,
      outcome: {
        kind: "unreadable",
        reason: `refusing to cache a value that would not survive JSON: ${shapeProblem}`,
      },
      reason: shapeProblem,
    };
  }

  return { store: true, outcome, reason: null };
}

/**
 * A narrow runtime check for the outcome union.
 *
 * Exported because a guard the tests cannot call is a guard nobody can prove.
 */
export function isVariantCountOutcome(value: unknown): value is VariantCountOutcome {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "counted" || kind === "empty" || kind === "unreadable";
}

/* -------------------------------------------------------------------------- *
 * 4. The cache identity
 * -------------------------------------------------------------------------- */

/**
 * The tag this entry is stored under.
 *
 * It is deliberately the SAME tag the live menu uses (`live-menu`, from
 * `menu-cache-policy-core.ts`). The value being cached is derived from the
 * published menu, so the event that makes it stale is precisely the event that
 * makes the live menu stale: a publish or a reset. Reusing the tag means the
 * existing invalidation at `src/lib/site/public-surfaces.ts:61` already clears
 * this entry, with no second invalidation call to remember and no chance of
 * the two drifting apart.
 *
 * The string is duplicated rather than imported ONLY because this module is
 * pure and imports nothing. The self-test below is handed the real constant by
 * the compliance test, so a drift fails CI rather than passing silently — the
 * same technique `bridge-core.ts` uses for BRIDGE_TERMINAL_STATUSES.
 */
export const LEAFLY_SETUP_CACHE_TAG = "live-menu";

/** The key parts. Distinct from the tag: the tag is invalidated, the key is stored. */
export const LEAFLY_SETUP_CACHE_KEY = ["leafly", "published-variant-count", "v1"] as const;

/**
 * Safety-net expiry, in seconds.
 *
 * WHY A TTL AT ALL, GIVEN THE TAG: because `menu_items` rows of the published
 * version are mutated in place by paths that never call `revalidateTag` — a
 * sale decrements stock, staff flag an item out of stock, a price is
 * corrected. The live-menu policy documents exactly this and takes the same
 * two-defence approach. A cache with no expiry is a promise that every future
 * developer will remember something.
 *
 * WHY 60, MATCHING THE LIVE MENU: this number is a count of published
 * variants on a setup panel. It changes only on a menu push, which already
 * fires the tag. Sixty seconds is the floor under that, and choosing the same
 * value as the live menu means there is one number to reason about rather
 * than two.
 */
export const LEAFLY_SETUP_CACHE_TTL_SECONDS = 60;

/** The options object handed to `unstable_cache`, built in one place. */
export function leaflySetupCacheOptions(): { revalidate: number; tags: string[] } {
  return {
    revalidate: LEAFLY_SETUP_CACHE_TTL_SECONDS,
    tags: [LEAFLY_SETUP_CACHE_TAG],
  };
}

/* -------------------------------------------------------------------------- *
 * 5. What the operator is told
 * -------------------------------------------------------------------------- */

/**
 * One sentence describing how fresh the count on screen is.
 *
 * The owner is entitled to know that a number on his screen may be up to a
 * minute old, and to know that this does NOT apply to anything that takes
 * money. Saying so in the UI is cheaper than answering the question later.
 */
export function describeSetupCountFreshness(outcome: VariantCountOutcome): string {
  switch (outcome.kind) {
    case "counted":
      return `${outcome.count} variants are published to Leafly. This count refreshes the moment you push your menu, and at most ${LEAFLY_SETUP_CACHE_TTL_SECONDS} seconds otherwise. Shopper pricing is never cached.`;
    case "empty":
      return `No variants are published to Leafly yet. This count refreshes the moment you push your menu, and at most ${LEAFLY_SETUP_CACHE_TTL_SECONDS} seconds otherwise. Shopper pricing is never cached.`;
    case "unreadable":
      return `The published Leafly menu couldn’t be read just now (${outcome.reason}). This is not the same as an empty menu — nothing has been cached, and the next load will try again.`;
  }
}

/* -------------------------------------------------------------------------- *
 * 6. Self-test
 * -------------------------------------------------------------------------- */

/**
 * The module proves its own invariants.
 *
 * `liveMenuTag` is injected by the compliance test with the REAL constant from
 * `menu-cache-policy-core.ts`, so the claim "we share the live menu's tag"
 * is checked against the actual string rather than against a copy of it.
 */
export function __runLeaflySetupCacheTests(opts?: {
  liveMenuTag?: string;
  liveMenuTtlSeconds?: number;
}): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[leafly-setup-cache] FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    ok(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  // ── TRAP 1: the shape guard ────────────────────────────────────────────────
  // The exact value that would have broken the money path.
  const realLookupShape = {
    lookup: (id: string) => (id === "x" ? null : null),
    variantCount: 42,
    loaded: true,
  };
  ok(
    "THE TRAP: the real buildLeaflyVariantLookup result is NOT cacheable",
    !isCacheableShape(realLookupShape),
  );
  const why = describeUncacheableShape(realLookupShape);
  ok("the trap is explained", typeof why === "string" && why.length > 20);
  ok("the explanation names the offending key", (why ?? "").includes("lookup"));
  ok("the explanation names the mechanism", (why ?? "").includes("function"));

  // And prove the premise, rather than asserting it: JSON really does drop it.
  const roundTripped = JSON.parse(JSON.stringify(realLookupShape)) as Record<string, unknown>;
  eq("JSON really does delete the function", roundTripped.lookup, undefined);
  eq("JSON keeps the count beside it", roundTripped.variantCount, 42);

  // The safe shape — what this slice actually caches — passes.
  ok("a plain count object IS cacheable", isCacheableShape({ kind: "counted", count: 42 }));
  ok("the empty outcome IS cacheable", isCacheableShape({ kind: "empty" }));
  eq("a safe shape has no complaint", describeUncacheableShape({ kind: "empty" }), null);

  // Primitives.
  ok("a number is cacheable", isCacheableShape(0));
  ok("a negative number is cacheable", isCacheableShape(-1));
  ok("a string is cacheable", isCacheableShape("hello"));
  ok("an empty string is cacheable", isCacheableShape(""));
  ok("a boolean is cacheable", isCacheableShape(true));
  ok("false is cacheable", isCacheableShape(false));
  ok("null is cacheable", isCacheableShape(null));
  ok("bare undefined is NOT cacheable", !isCacheableShape(undefined));

  // Numbers that change meaning.
  ok("NaN is NOT cacheable", !isCacheableShape(NaN));
  ok("Infinity is NOT cacheable", !isCacheableShape(Infinity));
  ok("-Infinity is NOT cacheable", !isCacheableShape(-Infinity));
  ok("the NaN complaint names null", (describeUncacheableShape(NaN) ?? "").includes("null"));

  // Nesting — the guard has to actually recurse, not just check the top level.
  ok("a nested function is caught", !isCacheableShape({ a: { b: { c: () => 1 } } }));
  ok(
    "a nested function is located",
    (describeUncacheableShape({ a: { b: { c: () => 1 } } }) ?? "").includes("value.a.b.c"),
  );
  ok("a function in an array is caught", !isCacheableShape([1, 2, () => 3]));
  ok(
    "an array element is located by index",
    (describeUncacheableShape([1, 2, () => 3]) ?? "").includes("[2]"),
  );
  ok("a deep-but-clean object is cacheable", isCacheableShape({ a: { b: { c: [1, "x", null] } } }));
  ok("an empty object is cacheable", isCacheableShape({}));
  ok("an empty array is cacheable", isCacheableShape([]));

  // The other silent-loss cases.
  ok("a Map is NOT cacheable", !isCacheableShape(new Map([["a", 1]])));
  ok("an empty Map is still NOT cacheable", !isCacheableShape(new Map()));
  ok("a Set is NOT cacheable", !isCacheableShape(new Set([1])));
  ok("a Date is NOT cacheable", !isCacheableShape(new Date()));
  ok("a symbol is NOT cacheable", !isCacheableShape(Symbol("s")));
  ok("a BigInt is NOT cacheable", !isCacheableShape(BigInt(1)));
  ok(
    "the Map complaint explains the loss",
    (describeUncacheableShape(new Map([["a", 1]])) ?? "").includes("{}"),
  );
  ok(
    "the Date complaint suggests the fix",
    (describeUncacheableShape(new Date()) ?? "").includes("ISO"),
  );

  // Circularity must not hang the guard.
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  ok("a circular object is NOT cacheable", !isCacheableShape(circular));
  ok(
    "the circular complaint says so",
    (describeUncacheableShape(circular) ?? "").includes("circular"),
  );
  // The same object appearing twice side by side is NOT circular and is fine.
  const shared = { n: 1 };
  ok("a repeated (non-circular) reference is still cacheable", isCacheableShape([shared, shared]));

  // ── TRAP 2: the outcome guard ─────────────────────────────────────────────
  const counted = classifyVariantCount({ loaded: true, variantCount: 412 });
  eq("a real count is counted", counted.kind, "counted");
  eq("the count is carried", counted.kind === "counted" ? counted.count : -1, 412);

  const empty = classifyVariantCount({ loaded: true, variantCount: 0 });
  eq("a genuine zero is empty, not unreadable", empty.kind, "empty");

  const unreadable = classifyVariantCount({ loaded: false, variantCount: 0 });
  eq("a failed load is unreadable", unreadable.kind, "unreadable");
  ok(
    "THE TRAP: a failed load is NEVER cached",
    !isCacheableOutcome(classifyVariantCount({ loaded: false, variantCount: 0 })),
  );
  ok(
    "a failed load with a nonzero count is still unreadable",
    classifyVariantCount({ loaded: false, variantCount: 99 }).kind === "unreadable",
  );

  ok("a real count IS cacheable", isCacheableOutcome(counted));
  ok("a genuine empty menu IS cacheable", isCacheableOutcome(empty));
  ok("an unreadable menu is NOT cacheable", !isCacheableOutcome(unreadable));

  // Zero and null must never collapse into one another.
  eq("empty displays as 0", countForDisplay(empty), 0);
  eq("unreadable displays as null", countForDisplay(unreadable), null);
  eq("counted displays its number", countForDisplay(counted), 412);
  ok(
    "zero and could-not-check are different values",
    countForDisplay(empty) !== countForDisplay(unreadable),
  );

  // Garbage counts are treated as a failed read, not as a number.
  eq("NaN count is unreadable", classifyVariantCount({ loaded: true, variantCount: NaN }).kind, "unreadable");
  eq(
    "Infinite count is unreadable",
    classifyVariantCount({ loaded: true, variantCount: Infinity }).kind,
    "unreadable",
  );
  eq(
    "a negative count is unreadable",
    classifyVariantCount({ loaded: true, variantCount: -5 }).kind,
    "unreadable",
  );
  eq(
    "a fractional count is floored, not rejected",
    classifyVariantCount({ loaded: true, variantCount: 7.9 }).kind === "counted"
      ? (classifyVariantCount({ loaded: true, variantCount: 7.9 }) as { count: number }).count
      : -1,
    7,
  );
  // 0.5 floors to 0, which is genuinely empty rather than a count of zero.
  eq(
    "a fraction below one becomes empty",
    classifyVariantCount({ loaded: true, variantCount: 0.5 }).kind,
    "empty",
  );

  // Every outcome the classifier can produce must be handled by both readers.
  const allOutcomes: VariantCountOutcome[] = [counted, empty, unreadable];
  ok(
    "every outcome has a display value decision",
    allOutcomes.every((o) => countForDisplay(o) !== undefined),
  );
  ok(
    "every outcome has a freshness sentence",
    allOutcomes.every((o) => describeSetupCountFreshness(o).trim().length > 30),
  );
  ok(
    "exactly one outcome kind is refused by the cache",
    allOutcomes.filter((o) => !isCacheableOutcome(o)).length === 1,
  );

  // ── The surface table ─────────────────────────────────────────────────────
  // SLICE L-48 — three: the cart update joined as a second money surface.
  eq("exactly three surfaces are classified", LEAFLY_LOOKUP_SURFACES.length, 3);
  ok(
    "THE SECOND MONEY PATH: the cart update MUST NOT be cacheable",
    isLeaflyLookupCacheable("Order cart update (Change items)") === false,
  );
  ok(
    "THE MONEY PATH: the order preview webhook MUST NOT be cacheable",
    isLeaflyLookupCacheable("Order preview webhook") === false,
  );
  ok(
    "the setup panel count IS cacheable",
    isLeaflyLookupCacheable("Order setup panel variant count"),
  );
  eq("exactly one surface may be cached", CACHEABLE_LEAFLY_LOOKUP_SURFACES.length, 1);
  ok("an unclassified surface is NOT cacheable", !isLeaflyLookupCacheable("Some Future Caller"));
  ok("an empty name is NOT cacheable", !isLeaflyLookupCacheable(""));
  ok(
    "every surface anchors to a file and line",
    LEAFLY_LOOKUP_SURFACES.every((s) => /^src\/.+:\d+$/.test(s.anchor)),
  );
  ok(
    "every surface explains itself in a full sentence",
    LEAFLY_LOOKUP_SURFACES.every((s) => s.reason.trim().length > 20 && s.reason.trim().endsWith(".")),
  );
  ok(
    "no duplicate surface names",
    new Set(LEAFLY_LOOKUP_SURFACES.map((s) => s.name)).size === LEAFLY_LOOKUP_SURFACES.length,
  );
  // THE INVARIANT, stated once against the explicit flag rather than against
  // prose. This is the rule the whole slice rests on.
  const money = LEAFLY_LOOKUP_SURFACES.filter((s) => s.touchesMoney);
  ok("at least one surface is known to touch money", money.length > 0);
  ok("NO surface that touches money is cacheable", money.every((s) => !s.cacheable));
  eq("exactly two money surfaces: the preview webhook and the cart update", money.length, 2);
  eq("the first money surface is named", money[0]?.name, "Order preview webhook");
  eq("the second money surface is named", money[1]?.name, "Order cart update (Change items)");
  ok(
    "every cacheable surface is explicitly money-free",
    LEAFLY_LOOKUP_SURFACES.filter((s) => s.cacheable).every((s) => !s.touchesMoney),
  );
  // And the guard against the mistake that produced this field: a reason that
  // merely MENTIONS charging must not be mistaken for one that does it.
  ok(
    "the cacheable surface does say it charges nobody",
    LEAFLY_LOOKUP_SURFACES.some((s) => s.cacheable && /charges nobody/i.test(s.reason)),
  );
  ok(
    "...and saying so does not make it a money surface",
    LEAFLY_LOOKUP_SURFACES.filter((s) => /charges nobody/i.test(s.reason)).every(
      (s) => !s.touchesMoney,
    ),
  );

  // ── Cache identity ────────────────────────────────────────────────────────
  ok("the tag is non-empty", LEAFLY_SETUP_CACHE_TAG.trim().length > 0);
  ok("the tag has no whitespace", !/\s/.test(LEAFLY_SETUP_CACHE_TAG));
  ok("key parts are all non-empty", LEAFLY_SETUP_CACHE_KEY.every((k) => k.trim().length > 0));
  ok(
    "the key is distinct from the tag",
    !LEAFLY_SETUP_CACHE_KEY.includes(LEAFLY_SETUP_CACHE_TAG as never),
  );
  ok("the TTL is a positive integer", Number.isInteger(LEAFLY_SETUP_CACHE_TTL_SECONDS) && LEAFLY_SETUP_CACHE_TTL_SECONDS > 0);
  ok("the TTL is finite — never cache forever", Number.isFinite(LEAFLY_SETUP_CACHE_TTL_SECONDS));
  ok("the TTL self-heals within two minutes", LEAFLY_SETUP_CACHE_TTL_SECONDS <= 120);
  ok("the TTL is long enough to be a real cache", LEAFLY_SETUP_CACHE_TTL_SECONDS >= 30);

  const opt = leaflySetupCacheOptions();
  eq("options carry the TTL", opt.revalidate, LEAFLY_SETUP_CACHE_TTL_SECONDS);
  eq("options carry exactly one tag", opt.tags.length, 1);
  eq("options tag IS the invalidation tag", opt.tags[0], LEAFLY_SETUP_CACHE_TAG);

  // The injected cross-check: we claim to share the live menu's tag, so the
  // real constant is compared against ours rather than a copy of it.
  if (opts?.liveMenuTag !== undefined) {
    eq(
      "we share the live menu's cache tag, so publishing clears us too",
      LEAFLY_SETUP_CACHE_TAG,
      opts.liveMenuTag,
    );
  }
  if (opts?.liveMenuTtlSeconds !== undefined) {
    eq(
      "our TTL matches the live menu's, so there is one number to reason about",
      LEAFLY_SETUP_CACHE_TTL_SECONDS,
      opts.liveMenuTtlSeconds,
    );
  }

  // ── The operator sentences ────────────────────────────────────────────────
  ok(
    "the counted sentence states the number",
    describeSetupCountFreshness(counted).includes("412"),
  );
  ok(
    "the counted sentence promises pricing is never cached",
    describeSetupCountFreshness(counted).includes("never cached"),
  );
  ok(
    "the empty sentence does not claim a failure",
    !describeSetupCountFreshness(empty).toLowerCase().includes("couldn’t"),
  );
  ok(
    "the unreadable sentence distinguishes itself from empty",
    describeSetupCountFreshness(unreadable).includes("not the same as an empty menu"),
  );
  ok(
    "the unreadable sentence promises nothing was stored",
    describeSetupCountFreshness(unreadable).includes("nothing has been cached"),
  );
  ok(
    "the freshness sentences state the TTL",
    describeSetupCountFreshness(counted).includes(String(LEAFLY_SETUP_CACHE_TTL_SECONDS)),
  );

  // ── The premise, proven rather than asserted ───────────────────────────
  // Every shape this guard rejects, it rejects for a REASON that can be
  // demonstrated here with the real JSON functions. If a future reader thinks
  // the guard is paranoid, these five lines are the answer.
  eq("Map really does serialise to {}", JSON.stringify(new Map([["a", 1]])), "{}");
  eq("Set really does serialise to {}", JSON.stringify(new Set([1, 2])), "{}");
  eq("NaN really does serialise to null", JSON.stringify(NaN), "null");
  eq("Infinity really does serialise to null", JSON.stringify(Infinity), "null");
  eq(
    "an undefined property really does vanish",
    JSON.stringify({ a: 1, b: undefined }),
    '{"a":1}',
  );
  eq(
    "a Date really does come back as a string",
    typeof JSON.parse(JSON.stringify({ d: new Date(0) })).d,
    "string",
  );
  ok(
    "a repeated reference really does survive as two copies",
    JSON.stringify([shared, shared]) === "[{\"n\":1},{\"n\":1}]",
  );

  // ── The guard agrees with reality on the safe cases too ────────────────
  // A guard that says "no" to everything would pass every test above. These
  // assert it says YES to exactly what we intend to store, and that the
  // stored value survives the round trip unchanged.
  for (const safe of [counted, empty] as VariantCountOutcome[]) {
    ok(`${safe.kind} is judged cacheable`, isCacheableShape(safe));
    eq(
      `${safe.kind} survives a JSON round trip unchanged`,
      JSON.stringify(JSON.parse(JSON.stringify(safe))),
      JSON.stringify(safe),
    );
    ok(
      `${safe.kind} still classifies the same after a round trip`,
      isCacheableOutcome(JSON.parse(JSON.stringify(safe)) as VariantCountOutcome),
    );
  }
  // The unreadable outcome is JSON-safe but must STILL be refused by the
  // outcome guard. Shape-safe and policy-safe are two different questions,
  // and conflating them is how a failed read gets cached.
  ok("the unreadable outcome is JSON-safe", isCacheableShape(unreadable));
  ok("...but is still refused by the outcome guard", !isCacheableOutcome(unreadable));

  // ── decideCacheWrite: the single gate both traps now run through ─────────
  // These exist because the two ifs this replaced lived in an I/O module where
  // no test could execute them, and a mutation that deleted them SURVIVED.
  // Here they are reachable, so a deletion is a red suite.
  {
    const good = decideCacheWrite(counted);
    ok("a real count is allowed into the cache", good.store);
    eq("...and comes back unchanged", good.outcome, counted);
    eq("...with nothing to explain", good.reason, null);

    const emptyVerdict = decideCacheWrite(empty);
    ok("a genuinely empty menu is allowed into the cache", emptyVerdict.store);
    eq("...and is still reported as empty", emptyVerdict.outcome.kind, "empty");

    const failed = decideCacheWrite(unreadable);
    ok("TRAP 2: a failed read is refused", !failed.store);
    eq("...but is still handed back to the caller", failed.outcome.kind, "unreadable");
    ok(
      "...with a reason that says why it was not stored",
      (failed.reason ?? "").includes("nothing true to remember"),
    );

    // TRAP 1 is unreachable from typed code today, which is exactly why it is
    // tested with an untyped value: the branch must survive the day someone
    // widens the outcome type to carry the lookup "for convenience".
    const widened = decideCacheWrite({ kind: "counted", count: 42, lookup: () => null });
    ok("TRAP 1: a counted outcome carrying a function is refused", !widened.store);
    eq("...and is downgraded to unreadable", widened.outcome.kind, "unreadable");
    ok(
      "...naming JSON as the mechanism",
      (widened.reason ?? "").includes("JSON.stringify deletes functions"),
    );
    ok(
      "...and telling the caller it would not survive JSON",
      widened.outcome.kind === "unreadable" &&
        widened.outcome.reason.includes("would not survive JSON"),
    );

    // Each trap must be able to fire on its own. If one subsumed the other,
    // deleting either would leave the suite green.
    ok(
      "the two traps are independent: shape-bad but policy-good is still refused",
      !decideCacheWrite({ kind: "empty", when: new Date(0) }).store,
    );
    ok(
      "the two traps are independent: policy-bad but shape-good is still refused",
      !decideCacheWrite({ kind: "unreadable", reason: "blip" }).store,
    );

    // Order matters: a value that is BOTH a failed read AND JSON-hostile must
    // be reported as a failed read, because that is the actionable diagnosis.
    const bothBad = decideCacheWrite({ kind: "unreadable", reason: "blip", at: new Date(0) });
    ok("both-bad is refused", !bothBad.store);
    ok(
      "both-bad is diagnosed as the failed read, not the shape",
      (bothBad.reason ?? "").includes("nothing true to remember"),
    );

    // Junk must be refused without throwing. This is the belt-and-braces path
    // and it must never be the thing that takes /admin/orders down.
    for (const junk of [null, undefined, 42, "counted", [], { kind: "nope" }, {}]) {
      const v = decideCacheWrite(junk);
      ok(`junk (${JSON.stringify(junk) ?? "undefined"}) is refused`, !v.store);
      eq(
        `junk (${JSON.stringify(junk) ?? "undefined"}) still yields a usable outcome`,
        v.outcome.kind,
        "unreadable",
      );
    }

    // The type guard itself.
    ok("a counted outcome is recognised", isVariantCountOutcome(counted));
    ok("an empty outcome is recognised", isVariantCountOutcome(empty));
    ok("an unreadable outcome is recognised", isVariantCountOutcome(unreadable));
    ok("a bare object is not", !isVariantCountOutcome({}));
    ok("null is not", !isVariantCountOutcome(null));
    ok("an unknown kind is not", !isVariantCountOutcome({ kind: "pending" }));

    // Whatever is stored must still be readable after the round trip the cache
    // actually performs. This closes the loop between "we allowed it" and
    // "it came back the same".
    for (const candidate of [counted, empty] as VariantCountOutcome[]) {
      const verdict = decideCacheWrite(candidate);
      ok(`${candidate.kind}: allowed`, verdict.store);
      const roundTripped = JSON.parse(JSON.stringify(verdict.outcome)) as unknown;
      ok(
        `${candidate.kind}: what we stored is still a valid outcome when read back`,
        isVariantCountOutcome(roundTripped),
      );
      eq(
        `${candidate.kind}: and it still means the same number`,
        countForDisplay(roundTripped as VariantCountOutcome),
        countForDisplay(candidate),
      );
    }
  }

  return { passed, failed };
}
