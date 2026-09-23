/**
 * tests/compliance/leafly-l27-auth-fetch-floor.test.ts
 *
 * SLICE L-27 — the transport floor that finally covers `auth.getUser()`.
 *
 * WHAT THIS FILE IS DEFENDING
 * ===========================================================================
 * The Leafly acknowledge button hung five times. The fifth report ("spun for
 * 5 minutes then quit") matched `maxDuration = 300` exactly, which meant the
 * platform was killing the function while every deadline we had stayed silent.
 *
 * The cause, measured in `scripts/recon/l27-auth-hang-probe.mjs`: supabase-js
 * gives `db: { timeout }` to the PostgREST sub-client ONLY, so
 * `supabase.auth.getUser()` — the first await of `requirePermission`, itself
 * the first statement of the acknowledge action — had no timeout at all and
 * ran upstream of L-25's 240s race.
 *
 * These tests pin the fix in place. Most of them exercise BEHAVIOUR against an
 * injected fetch rather than asserting on the shape of a config object,
 * because a test that only checks `{ fetch: <something> }` was passed proves
 * nothing about whether the something actually aborts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_FETCH_FLOOR_MS,
  SUPABASE_GLOBAL_OPTIONS,
  createBoundedFetch,
} from "@/lib/supabase/fetch-floor";
import { DB_REQUEST_FLOOR_MS } from "@/lib/supabase/db-floor";
import { SESSION_READ_TIMEOUT_MS } from "@/lib/supabase/query-deadline";
import {
  LEAFLY_ACK_TOTAL_BUDGET_MS,
  LEAFLY_DB_TIMEOUT_MS,
  PLATFORM_MAX_DURATION_MS,
} from "@/lib/leafly/db-deadline-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** A fetch that never answers until its signal aborts. The black hole. */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // unbounded on purpose: the test should time out
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    })) as unknown as typeof fetch;
}

describe("L-27 — the floor's value sits correctly between its neighbours", () => {
  it("is above every tighter deadline so those still win", () => {
    // If the transport floor were the TIGHTEST deadline it would pre-empt the
    // per-query budgets, and a slow-but-working query would be killed by the
    // wrong timer with the wrong message.
    expect(AUTH_FETCH_FLOOR_MS).toBeGreaterThanOrEqual(DB_REQUEST_FLOOR_MS);
    expect(AUTH_FETCH_FLOOR_MS).toBeGreaterThan(SESSION_READ_TIMEOUT_MS);
    expect(AUTH_FETCH_FLOOR_MS).toBeGreaterThan(
      Math.max(...Object.values(LEAFLY_DB_TIMEOUT_MS)),
    );
  });

  it("is far below the action budget and the platform killer", () => {
    // The whole point is to lose the race to the platform DELIBERATELY, with
    // enough headroom left to render a sentence.
    expect(AUTH_FETCH_FLOOR_MS).toBeLessThan(LEAFLY_ACK_TOTAL_BUDGET_MS);
    expect(AUTH_FETCH_FLOOR_MS).toBeLessThan(PLATFORM_MAX_DURATION_MS / 10);
  });

  it("the platform ceiling still matches the reported symptom", () => {
    // 300_000ms is the "5 minutes then quit" the owner measured. If anyone
    // changes this, the diagnosis recorded in fetch-floor.ts stops matching.
    expect(PLATFORM_MAX_DURATION_MS).toBe(300_000);
  });
});

describe("L-27 — createBoundedFetch actually aborts", () => {
  it("rejects a hanging request at the budget instead of waiting forever", async () => {
    const bounded = createBoundedFetch(hangingFetch(), 60);
    const started = Date.now();
    await expect(bounded("https://example.test/user")).rejects.toBeDefined();
    // Generous upper bound: this asserts "bounded", not "precisely 60ms".
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("aborts with a TimeoutError naming the budget, so logs are diagnosable", async () => {
    const bounded = createBoundedFetch(hangingFetch(), 40);
    await expect(bounded("https://example.test/user")).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await expect(bounded("https://example.test/user")).rejects.toThrow(/40ms/);
  });

  it("does not interfere with a request that answers in time", async () => {
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const bounded = createBoundedFetch(ok, 5_000);
    const res = await bounded("https://example.test/user");
    expect(res.status).toBe(200);
  });

  it("passes a signal down to the underlying implementation", async () => {
    // Without this, the wrapper could clear its own timer and still leave the
    // real request unbounded — the exact failure mode being fixed.
    let seen: AbortSignal | undefined;
    const spy = ((_i: unknown, init?: { signal?: AbortSignal }) => {
      seen = init?.signal;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    await createBoundedFetch(spy, 5_000)("https://example.test/user");
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("honours a caller's signal that aborts first", async () => {
    const controller = new AbortController();
    const bounded = createBoundedFetch(hangingFetch(), 30_000);
    const inflight = bounded("https://example.test/user", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller changed its mind"));
    await expect(inflight).rejects.toThrow(/caller changed its mind/);
  });

  it("short-circuits a caller signal that is ALREADY aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already gone"));
    const bounded = createBoundedFetch(hangingFetch(), 30_000);
    await expect(
      bounded("https://example.test/user", { signal: controller.signal }),
    ).rejects.toThrow(/already gone/);
  });

  it("removes its listener from a caller signal it did not use", async () => {
    // A request-scoped signal reused across many queries would otherwise
    // accumulate one listener per query and leak for the signal's lifetime.
    const controller = new AbortController();
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const bounded = createBoundedFetch(ok, 5_000);

    let listeners = 0;
    const realAdd = controller.signal.addEventListener.bind(controller.signal);
    const realRemove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((...args: Parameters<typeof realAdd>) => {
      listeners += 1;
      return realAdd(...args);
    }) as typeof realAdd;
    controller.signal.removeEventListener = ((
      ...args: Parameters<typeof realRemove>
    ) => {
      listeners -= 1;
      return realRemove(...args);
    }) as typeof realRemove;

    for (let i = 0; i < 5; i += 1) {
      await bounded("https://example.test/user", { signal: controller.signal });
    }
    expect(listeners).toBe(0);
  });

  it("falls back to the real floor when handed a nonsense budget", async () => {
    // A bad number must never silently mean "no timeout".
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bounded = createBoundedFetch(hangingFetch(), bad as number);
      const inflight = bounded("https://example.test/user");
      // It must be armed at the default rather than unbounded. We assert the
      // arming, not the wait, by racing a short sentinel.
      const sentinel = Symbol("still-pending");
      const outcome = await Promise.race([
        inflight.then(() => "settled").catch(() => "settled"),
        new Promise((r) => setTimeout(() => r(sentinel), 50)),
      ]);
      expect(outcome).toBe(sentinel);
      void inflight.catch(() => undefined);
    }
  });
});

describe("L-27 — the shared options object", () => {
  it("exposes a bounded fetch, not the bare platform one", () => {
    expect(typeof SUPABASE_GLOBAL_OPTIONS.fetch).toBe("function");
    expect(SUPABASE_GLOBAL_OPTIONS.fetch).not.toBe(globalThis.fetch);
  });
});

describe("L-27 — every Supabase factory installs the floor", () => {
  const factories = [
    "src/lib/supabase/admin.ts",
    "src/lib/supabase/server.ts",
    "src/middleware.ts",
  ];

  for (const rel of factories) {
    it(`${rel} passes global: SUPABASE_GLOBAL_OPTIONS`, () => {
      const src = read(rel);
      expect(src).toContain("SUPABASE_GLOBAL_OPTIONS");
      expect(src).toMatch(/global:\s*SUPABASE_GLOBAL_OPTIONS/);
    });
  }

  it("the middleware cannot 500 the back office when auth aborts", () => {
    // Now that the call can REJECT rather than hang, an unhandled rejection
    // here would fail every /admin/* request.
    const src = read("src/middleware.ts");
    expect(src).toMatch(/auth\.getUser\(\)\s*\.catch\(/);
  });
});

describe("L-27 — the session helper fails CLOSED and stays honest", () => {
  const src = read("src/lib/auth/session.ts");

  it("guards the auth call so a timeout cannot become a 500", () => {
    expect(src).toMatch(/try\s*\{[\s\S]*auth\.getUser\(\)[\s\S]*\}\s*catch/);
  });

  it("returns null on auth failure — never a truthy object", () => {
    // THE SECURITY INVARIANT. 26 call sites do `if (session) { ...allow... }`.
    // Any truthy failure value would turn an outage into an auth bypass.
    const signature = src.match(
      /export async function getStaffSession\([^)]*\):\s*([^{]+)\{/,
    );
    expect(signature?.[1]).toContain("Promise<StaffSession | null>");
    expect(signature?.[1]).not.toContain("unavailable");
  });

  it("records the failure in REQUEST scope, not module scope", () => {
    // A module-level `let` would leak one operator's outage into another
    // operator's screen on the same warm instance.
    expect(src).toMatch(/cache\(/);
    expect(src).toContain('from "react"');
  });

  it("exposes the distinction for explanation only", () => {
    expect(src).toMatch(/export function authCheckUnavailable\(\)/);
  });
});

describe("L-27 — the operator is told the truth", () => {
  it("the login page distinguishes an outage from a wrong password", () => {
    const src = read("src/app/admin/login/page.tsx");
    expect(src).toContain("authCheckUnavailable");
    expect(src).toMatch(/not with your password/i);
  });

  it("and the explanation is driven by the REAL check, not a constant", () => {
    // Caught by the L-27 mutation sweep: the first version of this suite only
    // asserted that the identifier appeared somewhere in the file, so
    // replacing `authCheckUnavailable()` with a hard-coded `false` — which
    // silently restores the old behaviour of blaming the operator — SURVIVED.
    // Pin the call itself, and pin that the message is selected by it.
    const src = read("src/app/admin/login/page.tsx");
    expect(src).toMatch(/const\s+unavailable\s*=\s*authCheckUnavailable\(\)/);
    expect(src).toMatch(/unavailable\s*\n?\s*\?/);
  });

  it("and warns about the irreversible Leafly button specifically", () => {
    // An acknowledge whose outcome we never learned is the one state where
    // pressing the button again is genuinely dangerous.
    const src = read("src/app/admin/login/page.tsx");
    expect(src).toMatch(/Leafly/);
    expect(src).toMatch(/second time|again/i);
  });
});

describe("L-27 — AbortSignal.any remains banned on this path", () => {
  // Re-asserted here, not only in the L-26 file, because THIS slice is the one
  // that adds a new place where composing two signals is the obvious move.
  // nodejs/node#57736 and #55428 (both `confirmed-bug`): it holds sources
  // weakly, so after GC the timer never fires and the request hangs forever —
  // which would silently recreate the exact bug being fixed.
  /**
   * Comments are stripped before matching, on purpose.
   *
   * `fetch-floor.ts` DISCUSSES `AbortSignal.any()` at length — it has to,
   * because "why not just use the obvious API" is the first question any
   * future reader will ask, and the answer (two confirmed Node bugs) is the
   * reason this file composes signals by hand. A naive grep cannot tell the
   * warning apart from the offence and would forbid explaining the hazard,
   * which is the opposite of what this ban is for.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("fetch-floor.ts composes signals by hand, in CODE", () => {
    const code = stripComments(read("src/lib/supabase/fetch-floor.ts"));
    expect(code).not.toMatch(/AbortSignal\s*\.\s*any\s*\(/);
    expect(code).toMatch(/addEventListener\(\s*["']abort["']/);
  });

  it("CONTROL: the matcher catches a reintroduction in code", () => {
    const decoy = stripComments(
      "// we must never call AbortSignal.any(x)\nconst s = AbortSignal.any([a, b]);",
    );
    expect(decoy).toMatch(/AbortSignal\s*\.\s*any\s*\(/);
  });

  it("CONTROL: and does NOT fire on a comment that only warns about it", () => {
    const warning = stripComments(
      "// never use AbortSignal.any() — nodejs/node#57736\nconst c = new AbortController();",
    );
    expect(warning).not.toMatch(/AbortSignal\s*\.\s*any\s*\(/);
  });

  it("clears its timer so completed requests leave nothing armed", () => {
    const src = read("src/lib/supabase/fetch-floor.ts");
    expect(src).toMatch(/finally\s*\{[\s\S]*clearTimeout\(timer\)/);
  });
});
