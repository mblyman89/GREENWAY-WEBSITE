/**
 * tests/compliance/leafly-setup-cache.test.ts
 *
 * SLICE L-18 — "the settings save hangs on the online orders dashboard."
 *
 * The pure core proves its own policy. This file proves the WIRING: that the
 * policy is actually applied, that the money path was not caught up in it, and
 * that the save buttons can no longer look dead.
 *
 * Every assertion here is designed to FAIL if the fix is reverted. A test that
 * cannot fail is worse than no test (rule 13c), so the mutation probe
 * `mutate-leafly-l18-setup-cache.py` breaks each of these deliberately and
 * requires the suite to notice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * ───────────────────────────────────────────────────────────────────────────
 * A FAKE INCREMENTAL CACHE, so the shell can be RUN rather than read.
 *
 * `setup-cache-server.ts` is an I/O module, and for most of this slice the
 * only way the tests touched it was `readFileSync` + `toContain`. The mutation
 * probe showed what that is worth: replacing the whole verdict check with
 * `if (false)` left every grepped token on the page and SURVIVED.
 *
 * So the two things the shell depends on are replaced with doubles:
 *
 *   next/cache        — a stand-in for `unstable_cache` that FAITHFULLY
 *                       reproduces the one behaviour under test: it stores
 *                       whatever the callback RETURNS, and stores nothing at
 *                       all when the callback THROWS. That is precisely why
 *                       the production code signals "do not store" by
 *                       throwing, and it is the property the tests below
 *                       assert against.
 *   preview-lookup    — the expensive menu rebuild, so a failed read can be
 *                       staged on demand instead of hoped for.
 *
 * `server-only` needs no double: vitest.config.ts:26 already aliases it to a
 * stub, which is what makes importing this shell possible at all.
 * ───────────────────────────────────────────────────────────────────────────
 */
type CacheOptions = { revalidate?: number; tags?: string[] };

const cacheSpy = vi.hoisted(() => ({
  /** Everything the fake cache actually committed to storage. */
  writes: [] as unknown[],
  /** How `unstable_cache` was configured at module load. */
  registrations: [] as { key: unknown; options: unknown }[],
}));

const previewSpy = vi.hoisted(() => ({
  impl: null as null | (() => Promise<{ lookup: unknown; variantCount: number; loaded: boolean }>),
  calls: 0,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    key: unknown,
    options: CacheOptions,
  ) => {
    cacheSpy.registrations.push({ key, options });
    return async () => {
      // Throwing must bypass the write. Returning must perform it. That
      // asymmetry IS the mechanism this slice relies on.
      const result = await fn();
      cacheSpy.writes.push(result);
      return result;
    };
  },
}));

vi.mock("../../src/lib/leafly/preview-lookup", () => ({
  buildLeaflyVariantLookup: async () => {
    previewSpy.calls += 1;
    if (!previewSpy.impl) throw new Error("test did not stage a preview-lookup result");
    return previewSpy.impl();
  },
}));

const { loadPublishedVariantCountOutcome } = await import(
  "../../src/lib/leafly/setup-cache-server"
);

import {
  classifyVariantCount,
  countForDisplay,
  decideCacheWrite,
  describeUncacheableShape,
  isCacheableOutcome,
  isCacheableShape,
  isLeaflyLookupCacheable,
  isVariantCountOutcome,
  leaflySetupCacheOptions,
  LEAFLY_LOOKUP_SURFACES,
  LEAFLY_SETUP_CACHE_TAG,
  LEAFLY_SETUP_CACHE_TTL_SECONDS,
  __runLeaflySetupCacheTests,
} from "../../src/lib/leafly/setup-cache-core";
import {
  MENU_CACHE_TAG,
  MENU_CACHE_TTL_SECONDS,
} from "../../src/lib/menu/menu-cache-policy-core";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Strip comments before asserting on code.
 *
 * These files deliberately QUOTE the rejected approach in their headers so a
 * future reader can see what was considered and why it was refused. A naive
 * `toContain` would match that prose and pass even if the real code were
 * deleted. Same helper, same reason, as the L-17 deadline test.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const CORE = "src/lib/leafly/setup-cache-core.ts";
const SERVER = "src/lib/leafly/setup-cache-server.ts";
const READINESS = "src/lib/leafly/order-readiness-server.ts";
const PREVIEW_ROUTE = "src/app/api/webhooks/leafly/order-preview/route.ts";
const PREVIEW_LOOKUP = "src/lib/leafly/preview-lookup.ts";
const PANEL = "src/components/admin/orders/AnnouncerPanel.tsx";
const SAVE_BUTTON = "src/components/admin/orders/SaveButton.tsx";

describe("L-18 the pure core", () => {
  it("passes its own self-tests, cross-checked against the real live-menu constants", () => {
    const r = __runLeaflySetupCacheTests({
      liveMenuTag: MENU_CACHE_TAG,
      liveMenuTtlSeconds: MENU_CACHE_TTL_SECONDS,
    });
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(95);
  });

  it("shares the live menu's cache tag, so publishing already clears it", () => {
    // Not a copy of the string — the real constant from the other module.
    expect(LEAFLY_SETUP_CACHE_TAG).toBe(MENU_CACHE_TAG);
    expect(leaflySetupCacheOptions().tags).toEqual([MENU_CACHE_TAG]);
  });

  it("keeps a bounded TTL as the floor under tag invalidation", () => {
    expect(LEAFLY_SETUP_CACHE_TTL_SECONDS).toBe(MENU_CACHE_TTL_SECONDS);
    expect(Number.isFinite(LEAFLY_SETUP_CACHE_TTL_SECONDS)).toBe(true);
    expect(LEAFLY_SETUP_CACHE_TTL_SECONDS).toBeGreaterThan(0);
    expect(LEAFLY_SETUP_CACHE_TTL_SECONDS).toBeLessThanOrEqual(120);
  });
});

describe("L-18 TRAP 1 — the JSON serialisation trap that would have broken checkout", () => {
  it("refuses the exact value buildLeaflyVariantLookup returns", () => {
    const real = { lookup: (_id: string) => null, variantCount: 42, loaded: true };
    expect(isCacheableShape(real)).toBe(false);
    const msg = describeUncacheableShape(real) ?? "";
    expect(msg).toMatch(/lookup/);
    expect(msg).toMatch(/function/);

    // NOT just "it said no". The message must be the SPECIFIC, actionable one
    // that names the mechanism, not the generic "has type function" fallback
    // every unhandled type lands on. The mutation probe proved this matters:
    // deleting the dedicated function branch still produced a rejection via
    // the fallback, so a test that only asserted /function/ stayed green while
    // the diagnosis quality silently regressed.
    expect(msg).toContain("JSON.stringify deletes functions");
    expect(msg).toContain("come back undefined");
    expect(msg).not.toContain("has type");
  });

  it("names the mechanism for EVERY rejected type, not just 'unsafe'", () => {
    // Each of these must hit its own dedicated branch with its own sentence.
    // The generic fallback ("has type X, which is not safe") is reserved for
    // types nobody enumerated, and must not be what a known type produces.
    const cases: [unknown, RegExp][] = [
      [{ a: () => 1 }, /deletes functions/],
      [{ a: undefined }, /deletes undefined properties/],
      [{ a: Symbol("s") }, /deletes symbols/],
      [{ a: BigInt(1) }, /throws on BigInt/],
      [{ a: new Map() }, /turns it into \{\}/],
      [{ a: new Set() }, /turns it into \{\}/],
      [{ a: new Date() }, /returns a string instead/],
      [{ a: NaN }, /turns that into null/],
    ];
    for (const [value, pattern] of cases) {
      const msg = describeUncacheableShape(value) ?? "";
      expect(msg).toMatch(pattern);
      expect(msg).not.toContain("has type");
    }
  });

  it("locates the offending key by path, so the fix is obvious", () => {
    expect(describeUncacheableShape({ a: { b: { c: () => 1 } } })).toContain("value.a.b.c");
    expect(describeUncacheableShape([1, () => 2])).toContain("value[1]");
    expect(describeUncacheableShape({ deep: [{ k: undefined }] })).toContain("value.deep[0].k");
  });

  it("an undefined property is rejected even though JSON does not throw", () => {
    // This is the quietest failure of the lot: JSON.stringify drops the key
    // without any error at all, so the value comes back structurally changed.
    expect(isCacheableShape({ kind: "counted", count: undefined })).toBe(false);
    expect(JSON.stringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("is not theoretical: JSON really does delete the function", () => {
    const real = { lookup: (_id: string) => null, variantCount: 42, loaded: true };
    const round = JSON.parse(JSON.stringify(real));
    expect(round.lookup).toBeUndefined();
    expect(round.variantCount).toBe(42);
  });

  it("accepts the small plain object this slice actually caches", () => {
    expect(isCacheableShape({ kind: "counted", count: 7 })).toBe(true);
    expect(isCacheableShape({ kind: "empty" })).toBe(true);
    expect(describeUncacheableShape({ kind: "empty" })).toBeNull();
  });

  it("distinguishes a cycle from a harmless repeated reference", () => {
    const shared = { n: 1 };
    // Two references to one object is NOT circular and must be allowed.
    expect(isCacheableShape([shared, shared])).toBe(true);
    expect(isCacheableShape({ a: shared, b: shared })).toBe(true);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isCacheableShape(cyclic)).toBe(false);
    expect(describeUncacheableShape(cyclic)).toMatch(/circular/);
  });

  it("catches silent-loss types anywhere in the tree", () => {
    expect(isCacheableShape({ a: { b: new Map() } })).toBe(false);
    expect(isCacheableShape({ a: [new Set()] })).toBe(false);
    expect(isCacheableShape({ a: { b: new Date() } })).toBe(false);
    expect(isCacheableShape([1, 2, () => 3])).toBe(false);
    expect(isCacheableShape({ a: NaN })).toBe(false);
  });
});

describe("L-18 TRAP 2 — a failed read is never remembered", () => {
  it("never caches an unreadable outcome", () => {
    const bad = classifyVariantCount({ loaded: false, variantCount: 0 });
    expect(bad.kind).toBe("unreadable");
    expect(isCacheableOutcome(bad)).toBe(false);
  });

  it("does cache a genuine empty menu, which is a real fact", () => {
    const empty = classifyVariantCount({ loaded: true, variantCount: 0 });
    expect(empty.kind).toBe("empty");
    expect(isCacheableOutcome(empty)).toBe(true);
  });

  it("keeps zero and could-not-check as different answers on screen", () => {
    const empty = classifyVariantCount({ loaded: true, variantCount: 0 });
    const bad = classifyVariantCount({ loaded: false, variantCount: 0 });
    expect(countForDisplay(empty)).toBe(0);
    expect(countForDisplay(bad)).toBeNull();
    expect(countForDisplay(empty)).not.toBe(countForDisplay(bad));
  });

  it("treats a nonsense count as a failed read, not as a number", () => {
    expect(classifyVariantCount({ loaded: true, variantCount: NaN }).kind).toBe("unreadable");
    expect(classifyVariantCount({ loaded: true, variantCount: -1 }).kind).toBe("unreadable");
    expect(classifyVariantCount({ loaded: true, variantCount: Infinity }).kind).toBe("unreadable");
  });
});

describe("L-18 the money path is untouched", () => {
  it("classifies the preview webhook as money, and money is never cacheable", () => {
    const money = LEAFLY_LOOKUP_SURFACES.filter((s) => s.touchesMoney);
    expect(money.length).toBeGreaterThan(0);
    expect(money.every((s) => !s.cacheable)).toBe(true);
    expect(isLeaflyLookupCacheable("Order preview webhook")).toBe(false);
  });

  it("fails closed for a caller nobody classified", () => {
    expect(isLeaflyLookupCacheable("Some Future Caller")).toBe(false);
    expect(isLeaflyLookupCacheable("")).toBe(false);
  });

  it("THE CRITICAL ONE: the preview webhook still calls the UNCACHED lookup", () => {
    const route = codeOnly(read(PREVIEW_ROUTE));
    // It must still call the real function...
    expect(route).toContain("buildLeaflyVariantLookup()");
    // ...and must NOT have been pointed at the cached, display-only helper.
    expect(route).not.toContain("loadPublishedVariantCountOutcome");
    expect(route).not.toContain("setup-cache-server");
  });

  it("buildLeaflyVariantLookup itself is never wrapped in a cache", () => {
    const lookup = codeOnly(read(PREVIEW_LOOKUP));
    expect(lookup).not.toContain("unstable_cache");
    expect(lookup).not.toContain("revalidate");
  });
});

describe("L-18 the wiring that actually removes the hang", () => {
  it("the setup panel count no longer calls the expensive builder directly", () => {
    const src = codeOnly(read(READINESS));
    const fn = src.slice(src.indexOf("export async function countPublishedLeaflyVariants"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // It must go through the cached entry point...
    expect(body).toContain("loadPublishedVariantCountOutcome");
    // ...and must NOT rebuild the menu itself any more.
    expect(body).not.toContain("buildLeaflyVariantLookup");
  });

  it("the cached read is tagged, so a publish clears it with no new call site", () => {
    const server = codeOnly(read(SERVER));
    expect(server).toContain("unstable_cache");
    expect(server).toContain("leaflySetupCacheOptions()");
    expect(server).toContain("LEAFLY_SETUP_CACHE_KEY");
  });

  it("the server shell defers the store/do-not-store judgement to the pure core", () => {
    const server = codeOnly(read(SERVER));
    expect(server).toContain("decideCacheWrite");
    expect(server).toContain("UncacheableRead");
    // The throw is the mechanism — unstable_cache has no "do not store" return.
    expect(server).toMatch(/throw new UncacheableRead/);
  });

  it("the cached read never throws out to the page", () => {
    const server = codeOnly(read(SERVER));
    const fn = server.slice(server.indexOf("export async function loadPublishedVariantCountOutcome"));
    expect(fn).toContain("catch");
    expect(fn).toContain("unreadable");
  });
});

/*
 * ───────────────────────────────────────────────────────────────────────────
 * THE GATE ITSELF — executed, not grepped.
 *
 * The first version of this slice put both traps in `setup-cache-server.ts`
 * as two plain ifs, and the only tests that could reach them read the file as
 * TEXT. The mutation probe duly replaced each condition with `if (false)` and
 * both mutants SURVIVED: the grepped tokens were all still on the page. A
 * guard no test can execute is not a guard (rule 13c).
 *
 * The judgement now lives in the pure core as `decideCacheWrite`, so these
 * tests call it with hostile values and watch it refuse.
 * ───────────────────────────────────────────────────────────────────────────
 */
describe("L-18 the cache-write gate", () => {
  it("lets a real count through, unchanged", () => {
    const v = decideCacheWrite({ kind: "counted", count: 7 });
    expect(v.store).toBe(true);
    expect(v.outcome).toEqual({ kind: "counted", count: 7 });
    expect(v.reason).toBeNull();
  });

  it("lets a genuinely empty menu through — 'you published nothing' is a fact", () => {
    const v = decideCacheWrite({ kind: "empty" });
    expect(v.store).toBe(true);
    expect(v.outcome.kind).toBe("empty");
  });

  it("TRAP 2: refuses a failed read, but still hands it back to the caller", () => {
    const v = decideCacheWrite(classifyVariantCount({ loaded: false, variantCount: 0 }));
    expect(v.store).toBe(false);
    // Refused for the CACHE, not withheld from the PAGE. The panel still gets
    // something it can render as "couldn't check just now".
    expect(v.outcome.kind).toBe("unreadable");
    expect(v.reason).toContain("nothing true to remember");
  });

  it("TRAP 1: refuses a widened outcome that smuggled the lookup back in", () => {
    // This is the checkout-breaking bug in its purest form. It cannot happen
    // from typed code today, which is exactly why the guard must be proved
    // with an untyped value — it exists for the future edit, not for today.
    const v = decideCacheWrite({ kind: "counted", count: 42, lookup: () => null });
    expect(v.store).toBe(false);
    expect(v.outcome.kind).toBe("unreadable");
    expect(v.reason).toContain("JSON.stringify deletes functions");
    if (v.outcome.kind === "unreadable") {
      expect(v.outcome.reason).toContain("would not survive JSON");
    }
  });

  it("the two traps are genuinely independent", () => {
    // Shape-hostile but policy-fine.
    expect(decideCacheWrite({ kind: "empty", when: new Date(0) }).store).toBe(false);
    // Policy-hostile but shape-fine.
    expect(decideCacheWrite({ kind: "unreadable", reason: "blip" }).store).toBe(false);
    // If either guard subsumed the other, deleting one would leave this green.
  });

  it("diagnoses a both-bad value as the failed read, which is the actionable half", () => {
    const v = decideCacheWrite({ kind: "unreadable", reason: "blip", at: new Date(0) });
    expect(v.store).toBe(false);
    expect(v.reason).toContain("nothing true to remember");
  });

  it("refuses junk without throwing, and still returns something renderable", () => {
    for (const junk of [null, undefined, 0, 42, "counted", [], {}, { kind: "pending" }]) {
      const v = decideCacheWrite(junk);
      expect(v.store).toBe(false);
      expect(v.outcome.kind).toBe("unreadable");
      // Never null/undefined — /admin/orders must not 500 over a cache concern.
      expect(countForDisplay(v.outcome)).toBeNull();
    }
  });

  it("anything it DOES allow survives the round trip the cache actually performs", () => {
    for (const candidate of [
      { kind: "counted", count: 1 },
      { kind: "counted", count: 999 },
      { kind: "empty" },
    ] as const) {
      const v = decideCacheWrite(candidate);
      expect(v.store).toBe(true);
      const back = JSON.parse(JSON.stringify(v.outcome)) as unknown;
      expect(isVariantCountOutcome(back)).toBe(true);
      expect(countForDisplay(back as never)).toBe(countForDisplay(candidate));
    }
  });

  it("the type guard does not wave through near-misses", () => {
    expect(isVariantCountOutcome({ kind: "counted", count: 1 })).toBe(true);
    expect(isVariantCountOutcome({ kind: "empty" })).toBe(true);
    expect(isVariantCountOutcome({ kind: "unreadable", reason: "x" })).toBe(true);
    expect(isVariantCountOutcome({ kind: "COUNTED" })).toBe(false);
    expect(isVariantCountOutcome({ count: 1 })).toBe(false);
    expect(isVariantCountOutcome(null)).toBe(false);
    expect(isVariantCountOutcome([])).toBe(false);
  });
});

describe("L-18 the save buttons can no longer look dead", () => {
  it("SaveButton is a client component that reads the form's pending state", () => {
    const src = read(SAVE_BUTTON);
    expect(src.startsWith('"use client"')).toBe(true);
    expect(codeOnly(src)).toContain("useFormStatus()");
  });

  it("it both disables AND announces, not one or the other", () => {
    const code = codeOnly(read(SAVE_BUTTON));
    expect(code).toContain("disabled={pending}");
    expect(code).toContain("aria-busy={pending}");
  });

  it("the busy label is required, so a button cannot silently reuse the idle one", () => {
    const code = codeOnly(read(SAVE_BUTTON));
    // No default value for busyLabel — a missing one must be a type error.
    expect(code).toMatch(/busyLabel:\s*string;/);
    expect(code).not.toMatch(/busyLabel\s*=\s*["'`]/);
  });

  it("every save form on the announcer panel uses it", () => {
    const code = codeOnly(read(PANEL));
    const saveButtons = code.match(/<SaveButton\b/g) ?? [];
    expect(saveButtons.length).toBe(3);

    // And no plain submit button is left behind on a SAVE form. The panel
    // still has non-save submits (pair, remove, toggle), which are out of
    // scope, so this asserts specifically that no `variant="save"` plain
    // Button survives.
    expect(code).not.toMatch(/<Button[^>]*variant="save"/);
  });

  it("each save button says something different while it is working", () => {
    const code = codeOnly(read(PANEL));
    const busy = [...code.matchAll(/busyLabel="([^"]+)"/g)].map((m) => m[1]);
    expect(busy.length).toBe(3);
    // Every one must actually be a busy phrase, not a copy of the idle label.
    for (const b of busy) expect(b).toMatch(/…$/);
    const idle = [...code.matchAll(/label="([^"]+)"\s+busyLabel=/g)].map((m) => m[1]);
    expect(idle.length).toBe(3);
    for (let i = 0; i < idle.length; i += 1) expect(busy[i]).not.toBe(idle[i]);
  });

  it("useFormStatus is called from a CHILD of the form, never the form's own component", () => {
    // The hook reports pending:false when called in the same component that
    // renders the <form>. The panel must therefore NOT call it at all.
    const panel = codeOnly(read(PANEL));
    expect(panel).not.toContain("useFormStatus");

    // And SaveButton, which does call it, must not render a <form> itself.
    const btn = codeOnly(read(SAVE_BUTTON));
    expect(btn).toContain("useFormStatus");
    expect(btn).not.toMatch(/<form\b/);
  });
});

/*
 * ───────────────────────────────────────────────────────────────────────────
 * THE SHELL, EXECUTED.
 *
 * These are the tests that kill "the shell ignores the gate's verdict" and
 * "the shell stops consulting the gate at all". Both of those mutants leave
 * the source text intact, so no amount of grepping can see them. The only way
 * to notice is to run the thing and look at what reached the cache.
 *
 * The assertion that matters in every case below is not the return value —
 * it is `cacheSpy.writes`. A cache that returns the right answer while
 * quietly remembering a failed read is the exact bug this slice prevents, and
 * it is invisible to any test that only checks the return value.
 * ───────────────────────────────────────────────────────────────────────────
 */
describe("L-18 the server shell, actually run", () => {
  beforeEach(() => {
    cacheSpy.writes.length = 0;
    previewSpy.calls = 0;
    previewSpy.impl = null;
  });

  it("registers the cache with the shared live-menu tag and a bounded TTL", () => {
    // Captured at module load, so this proves the real wiring, not a re-run.
    expect(cacheSpy.registrations.length).toBe(1);
    const { key, options } = cacheSpy.registrations[0];
    expect(key).toEqual(["leafly", "published-variant-count", "v1"]);
    expect(options).toEqual({
      revalidate: MENU_CACHE_TTL_SECONDS,
      tags: [MENU_CACHE_TAG],
    });
  });

  it("a good read is returned AND remembered", async () => {
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 12, loaded: true });
    const outcome = await loadPublishedVariantCountOutcome();
    expect(outcome).toEqual({ kind: "counted", count: 12 });
    // It reached storage — this is the whole point of the slice.
    expect(cacheSpy.writes).toEqual([{ kind: "counted", count: 12 }]);
  });

  it("what is stored is the small plain object, NOT the lookup function", async () => {
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 12, loaded: true });
    await loadPublishedVariantCountOutcome();
    expect(cacheSpy.writes.length).toBe(1);
    const stored = cacheSpy.writes[0] as Record<string, unknown>;
    // If the lookup ever rode along, JSON would delete it and the preview
    // webhook would get `undefined` on a real shopper's cart.
    expect(Object.keys(stored).sort()).toEqual(["count", "kind"]);
    expect(isCacheableShape(stored)).toBe(true);
  });

  it("an empty menu is remembered, because 'nothing published' is a real fact", async () => {
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 0, loaded: true });
    const outcome = await loadPublishedVariantCountOutcome();
    expect(outcome).toEqual({ kind: "empty" });
    expect(cacheSpy.writes).toEqual([{ kind: "empty" }]);
  });

  it("THE ONE THAT MATTERS: a failed read is returned but NEVER written", async () => {
    // This is buildLeaflyVariantLookup's own failure signal — it swallows the
    // error and returns loaded:false with a meaningless zero.
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 0, loaded: false });

    const outcome = await loadPublishedVariantCountOutcome();

    // The caller still gets something renderable...
    expect(outcome.kind).toBe("unreadable");
    expect(countForDisplay(outcome)).toBeNull();
    // ...and nothing whatsoever reached storage. If this array is non-empty,
    // one database blip has just pinned "0 variants published" on the owner's
    // setup panel for a full TTL.
    expect(cacheSpy.writes).toEqual([]);
  });

  it("a thrown read is also returned but never written", async () => {
    previewSpy.impl = async () => {
      throw new Error("connection reset");
    };
    const outcome = await loadPublishedVariantCountOutcome();
    expect(outcome.kind).toBe("unreadable");
    expect(cacheSpy.writes).toEqual([]);
  });

  it("a garbage count is treated as a failed read and is not written", async () => {
    for (const bad of [NaN, -1, Infinity]) {
      cacheSpy.writes.length = 0;
      previewSpy.impl = async () => ({ lookup: () => null, variantCount: bad, loaded: true });
      const outcome = await loadPublishedVariantCountOutcome();
      expect(outcome.kind).toBe("unreadable");
      expect(cacheSpy.writes).toEqual([]);
    }
  });

  it("never throws out to the page, whatever the menu does", async () => {
    const disasters: (() => Promise<never>)[] = [
      async () => {
        throw new Error("boom");
      },
      async () => {
        // A non-Error throw, which is the case naive catch blocks get wrong.
        throw "a bare string";
      },
      async () => {
        throw null;
      },
    ];
    for (const d of disasters) {
      previewSpy.impl = d as never;
      const outcome = await loadPublishedVariantCountOutcome();
      // /admin/orders must render. A caching concern may not take the page down.
      expect(outcome.kind).toBe("unreadable");
      expect(typeof (outcome as { reason: string }).reason).toBe("string");
    }
  });

  it("a failed read does not poison the next attempt", async () => {
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 0, loaded: false });
    expect((await loadPublishedVariantCountOutcome()).kind).toBe("unreadable");
    expect(cacheSpy.writes).toEqual([]);

    // The blip passes. Because nothing was stored, the very next call gets the
    // truth rather than a cached lie.
    previewSpy.impl = async () => ({ lookup: () => null, variantCount: 5, loaded: true });
    expect(await loadPublishedVariantCountOutcome()).toEqual({ kind: "counted", count: 5 });
    expect(cacheSpy.writes).toEqual([{ kind: "counted", count: 5 }]);
  });

  it("everything it ever writes is JSON-safe and reads back identical", async () => {
    for (const n of [0, 1, 7, 1000]) {
      previewSpy.impl = async () => ({ lookup: () => null, variantCount: n, loaded: true });
      await loadPublishedVariantCountOutcome();
    }
    expect(cacheSpy.writes.length).toBe(4);
    for (const w of cacheSpy.writes) {
      expect(isCacheableShape(w)).toBe(true);
      expect(isVariantCountOutcome(w)).toBe(true);
      // The round trip the real cache performs must be a no-op.
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    }
  });
});

describe("L-18 the core is registered and floored", () => {
  it("runs in the pure self-test harness with a floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runLeaflySetupCacheTests");
    expect(runner).toContain('"leafly-setup-cache-core"');
    // The real constants are injected, not copied.
    expect(runner).toContain("liveMenuTag: MENU_CACHE_TAG");
    expect(runner).toContain("liveMenuTtlSeconds: MENU_CACHE_TTL_SECONDS");
  });

  it("THE FLOOR IS A NUMBER, and that number is checked", () => {
    // The mutation probe dropped the floor from 95 to 0 and the suite stayed
    // green, because "it is registered" and "it is registered WITH A FLOOR
    // THAT BITES" are different claims. A floor of 0 makes assertRan a no-op:
    // half the self-tests could be deleted and nothing would notice.
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    const call = runner.slice(runner.indexOf('assertRan(\n    "leafly-setup-cache-core"'));
    const block = call.slice(0, call.indexOf("\n  );"));
    expect(block.length).toBeGreaterThan(0);

    // The last bare integer in the call is the floor argument.
    const floors = [...block.matchAll(/^\s*(\d+),\s*$/gm)].map((m) => Number(m[1]));
    expect(floors.length).toBe(1);
    const floor = floors[0];

    expect(Number.isInteger(floor)).toBe(true);
    expect(floor).toBeGreaterThanOrEqual(95);

    // And the floor must be REAL: at or below what the core actually scores,
    // or CI would fail; but not so far below that it stops meaning anything.
    const measured = __runLeaflySetupCacheTests({
      liveMenuTag: MENU_CACHE_TAG,
      liveMenuTtlSeconds: MENU_CACHE_TTL_SECONDS,
    }).passed;
    expect(floor).toBeLessThanOrEqual(measured);
    // No more than 20% slack — a floor far below the count is a floor that
    // lets a whole trap case be deleted silently.
    expect(floor).toBeGreaterThanOrEqual(Math.floor(measured * 0.8));
  });

  it("the core stays pure — no runtime imports", () => {
    const core = read(CORE);
    const importLines = core.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(importLines).toEqual([]);
  });
});
