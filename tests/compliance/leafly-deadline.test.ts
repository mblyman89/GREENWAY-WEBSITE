/**
 * REGRESSION — "i can click the acknowledge button, confirm the action, then
 * it sits waiting forever stuck."
 *
 * Reported by the owner about the Leafly orders panel on /admin/orders, after
 * a test order that otherwise worked end to end (it printed a receipt and the
 * speaker chimed).
 *
 * THE AUDIT
 * ---------
 * There were two independent defects behind that one sentence, and fixing
 * either alone would have left the complaint intact.
 *
 *   1. THE SERVER COULD GENUINELY HANG FOREVER.
 *
 *        grep -rn "AbortController\|AbortSignal.timeout" src/lib/leafly/
 *        → no matches
 *
 *      Six outbound `fetch()` calls, none of them bounded — while seventeen
 *      other client files in this repository already do it, and
 *      `src/lib/atm/pai-client.ts:94` names the reason out loud: "fetch()
 *      with a hard timeout via AbortController (no hanging syncs)". Leafly
 *      was the one client that never got it.
 *
 *      Worse than the count: `token.ts:97`, the OAuth mint, runs before
 *      every one of the other five. A black-holed mint hangs an operation
 *      that has not started yet and leaves no attributable log line.
 *      `order-ack-server.ts:218` is a `for(;;)` with a 401 retry, so the
 *      mint and the POST could each run twice, all unbounded.
 *
 *   2. THE BUTTON LOOKED IDENTICAL THE WHOLE TIME.
 *      A real `<form>` against a void-returning server action inside a
 *      server component: no pending state, no disabled state. This exact bug
 *      class is already documented in the same folder at
 *      `AnnouncerPanel.tsx:175` — "the owner reasonably read that as 'the
 *      button does nothing, it hangs'".
 *
 * WHAT THIS FILE PINS
 * -------------------
 * The pure rules (budgets, fault classification, retry safety) live in
 * `deadline-core.ts`, are covered by the self-test sweep with an assertion
 * floor, and get a mutation round of their own. This file pins the things a
 * pure core cannot see:
 *
 *   * that the deadline is actually WIRED into every Leafly fetch, in the
 *     real files, and cannot quietly come unplugged;
 *   * that the transport helper really aborts, really classifies, and really
 *     clears its timer;
 *   * that the button really shows a pending state.
 *
 * A perfectly-reasoned budget that no call site uses is exactly the bug we
 * started with.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEAFLY_AUTO_CANCEL_MS,
  LEAFLY_MAX_ATTEMPTS,
  LEAFLY_OPERATIONS,
  LEAFLY_TIMEOUT_MS,
  classifyNetworkFault,
  describeDeadlineFailure,
  isIrreversibleOperation,
  timeoutForOperation,
  worstCaseMs,
} from "@/lib/leafly/deadline-core";
import {
  LEAFLY_ACK_ACTION_BUSY_LABEL,
  LEAFLY_ACK_ACTION_LABEL,
  LEAFLY_STATUS_ACTION_WORDING,
  planLeaflyOrderActions,
} from "@/lib/leafly/order-ack-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The file with its comments removed.
 *
 * Needed because several of these files quote the OLD, broken code in their
 * headers as a deliberate record of what was fixed — `deadline-fetch.ts`
 * explains at length why it does NOT use `AbortSignal.timeout()`, and naming
 * the thing it rejects is the whole point of the paragraph. A naive
 * `not.toContain` over the raw text would therefore fail on the very
 * documentation that makes the choice reviewable, and the cheapest way to
 * make it pass would be to delete the explanation. So: assert against code.
 */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const LEAFLY_DIR = "src/lib/leafly";
const FETCH_HELPER = "src/lib/leafly/deadline-fetch.ts";
const ACTIONS_COMPONENT = "src/components/admin/orders/LeaflyOrderActions.tsx";

// ===========================================================================
// 1. THE DEFECT ITSELF: no unbounded fetch may exist in src/lib/leafly
// ===========================================================================
describe("no Leafly request may be unbounded", () => {
  const leaflyFiles = readdirSync(join(process.cwd(), LEAFLY_DIR))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ name: f, body: read(join(LEAFLY_DIR, f)) }));

  it("finds the Leafly library where this test thinks it is", () => {
    // Guards the whole describe block. If the directory is renamed or the
    // filter stops matching, every assertion below would vacuously pass over
    // an empty list — a green suite proving nothing.
    expect(leaflyFiles.length).toBeGreaterThan(20);
  });

  it("has ZERO raw fetch() calls outside the deadline helper", () => {
    // The literal regression. This is the grep from the audit, run as an
    // assertion instead of by hand, so the defect cannot return by way of a
    // new file that nobody thought to check.
    const offenders: string[] = [];
    for (const { name, body } of leaflyFiles) {
      if (name === "deadline-fetch.ts") continue;
      body.split("\n").forEach((line, i) => {
        // Match a real call, not the word "fetch" in prose. Comment lines are
        // excluded deliberately: several files quote the old code in their
        // headers as a record of what was fixed, and forbidding that would
        // push authors to delete the history instead of the bug.
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//")) return;
        if (/(?:^|[^.\w])fetch\s*\(/.test(code)) {
          offenders.push(`${name}:${i + 1}: ${code}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("routes every Leafly network call through leaflyFetchWithDeadline", () => {
    const callers = leaflyFiles.filter(
      (f) => f.name !== "deadline-fetch.ts" && f.body.includes("leaflyFetchWithDeadline("),
    );
    // Six physical call sites were found by the audit; they live in five
    // files (order-ack-server serves two operations from one fetch).
    expect(callers.map((c) => c.name).sort()).toEqual([
      "full-menu-server.ts",
      "order-ack-server.ts",
      "order-fetch-server.ts",
      "push.ts",
      "selection-server.ts",
      "token.ts",
    ]);
  });

  it("names a real operation at every call site", () => {
    // A call site that passed a typo'd operation would silently get the
    // tightest budget (see timeoutForOperation's fallback) — safe, but not
    // what anyone intended. The compiler already enforces this via the
    // LeaflyOperation type; this asserts the STRINGS present in the source
    // are all real, which also catches a string smuggled in via a variable
    // whose type was widened.
    const quoted = new Set<string>();
    for (const { name, body } of leaflyFiles) {
      if (name === "deadline-fetch.ts") continue;
      for (const m of body.matchAll(/leaflyFetchWithDeadline\(\s*"([a-z_]+)"/g)) {
        quoted.add(m[1]);
      }
    }
    for (const op of quoted) {
      expect(LEAFLY_OPERATIONS as readonly string[]).toContain(op);
    }
    // The literal operations that appear inline (the rest are passed through
    // a typed `operation` parameter).
    expect(quoted.has("token_mint")).toBe(true);
    expect(quoted.has("order_fetch")).toBe(true);
  });

  it("wires the three menu files through a typed operation parameter", () => {
    // These three share one `authedFetch` wrapper each, serving between one
    // and three endpoints. The operation must be a REQUIRED parameter rather
    // than a default, so a new endpoint cannot inherit someone else's budget.
    for (const f of ["push.ts", "full-menu-server.ts", "selection-server.ts"]) {
      const body = read(join(LEAFLY_DIR, f));
      expect(body).toContain("operation: LeaflyOperation,");
      // No default value — `operation: LeaflyOperation = "..."` would defeat it.
      expect(body).not.toMatch(/operation:\s*LeaflyOperation\s*=/);
    }
  });

  it("does not let the menu files swallow a failure they used to propagate", () => {
    // These three had NO try/catch before this slice, so a thrown fetch
    // reached the caller. That contract is preserved: the helper returns a
    // result, and the wrapper re-throws. If someone converts this to a
    // silent return, a failed menu push starts looking like a successful one.
    for (const f of ["push.ts", "full-menu-server.ts", "selection-server.ts"]) {
      const body = read(join(LEAFLY_DIR, f));
      expect(body).toContain("throw new Error(call.verdict.message);");
    }
  });
});

// ===========================================================================
// 2. THE TRANSPORT HELPER ACTUALLY ABORTS
// ===========================================================================
describe("leaflyFetchWithDeadline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Imported lazily: the module is `server-only`. */
  const load = async () => {
    const mod = await import("@/lib/leafly/deadline-fetch");
    return mod.leaflyFetchWithDeadline;
  };

  it("returns the response untouched when the call succeeds", async () => {
    const fn = await load();
    const body = new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => body));
    const out = await fn("acknowledge", "https://x.test/a", { method: "POST" });
    expect(out.ok).toBe(true);
    // Identity, not equality: a helper that reconstructs the Response would
    // lose the body stream and the call site would silently read "".
    expect(out.response).toBe(body);
  });

  it("passes a live AbortSignal to fetch", async () => {
    const fn = await load();
    const spy = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await fn("acknowledge", "https://x.test/a", { method: "POST" });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it("preserves the caller's init rather than replacing it", async () => {
    const fn = await load();
    const spy = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await fn("menu_push", "https://x.test/m", {
      method: "PUT",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: '{"items":[]}',
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"items":[]}');
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("aborts a request that outlives its budget, and says so", async () => {
    const fn = await load();
    // A fetch that resolves only when its signal fires — i.e. the hang.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      ),
    );
    const out = await fn("acknowledge", "https://x.test/a", { method: "POST" });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.didTimeout).toBe(true);
    expect(out.verdict.fault).toBe("timeout");
    expect(out.verdict.wasOurClock).toBe(true);
    // The whole point: a timeout is not evidence of non-delivery.
    expect(out.verdict.certainlyNotDelivered).toBe(false);
    expect(out.verdict.safeToRetry).toBe(false);
    // The budget is recorded so two timeout rows either side of a budget
    // change are distinguishable.
    expect(out.detail).toContain(`${LEAFLY_TIMEOUT_MS.acknowledge}ms`);
  }, 20_000);

  it("classifies a genuine connection refusal as offline, not as a timeout", async () => {
    const fn = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:443");
      }),
    );
    const out = await fn("acknowledge", "https://x.test/a", { method: "POST" });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    // We never got out of the building, so this IS safe to retry even though
    // acknowledge is the one-way door.
    expect(out.didTimeout).toBe(false);
    expect(out.verdict.fault).toBe("offline");
    expect(out.verdict.certainlyNotDelivered).toBe(true);
    expect(out.verdict.safeToRetry).toBe(true);
  });

  it("refuses to guess: an unrecognised error stays 'unknown'", async () => {
    const fn = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const out = await fn("acknowledge", "https://x.test/a", { method: "POST" });
    if (out.ok) throw new Error("unreachable");
    expect(out.verdict.fault).toBe("unknown");
    // Unknown fails towards caution on the irreversible operation.
    expect(out.verdict.safeToRetry).toBe(false);
  });

  it("never throws, whatever fetch does", async () => {
    const fn = await load();
    for (const thrown of [
      new Error("boom"),
      "a string, not an Error",
      null,
      undefined,
      { weird: true },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw thrown;
        }),
      );
      // The assertion is that this line completes at all.
      const out = await fn("menu_push", "https://x.test/m", { method: "PUT" });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("unreachable");
      expect(out.verdict.message.length).toBeGreaterThan(0);
    }
  });

  it("clears its timer on success so no stray handle survives the call", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const fn = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await fn("acknowledge", "https://x.test/a", { method: "POST" });
    expect(clear).toHaveBeenCalled();
  });

  it("clears its timer on failure too", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const fn = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 1.2.3.4:443");
      }),
    );
    await fn("acknowledge", "https://x.test/a", { method: "POST" });
    expect(clear).toHaveBeenCalled();
  });

  it("gives each operation its own budget rather than one shared number", async () => {
    // Verified through the observable behaviour — the timer that gets set —
    // rather than by re-reading the table the core already asserts.
    const fn = await load();
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    for (const op of LEAFLY_OPERATIONS) {
      setSpy.mockClear();
      await fn(op, "https://x.test/x", { method: "GET" });
      const delays = setSpy.mock.calls.map((c) => c[1]);
      expect(delays).toContain(LEAFLY_TIMEOUT_MS[op]);
    }
  });
});

// ===========================================================================
// 3. THE BUDGETS ARE SANE AGAINST LEAFLY'S OWN CLOCK
// ===========================================================================
describe("the budgets fit Leafly's fifteen-minute auto-cancel window", () => {
  it("leaves at least three quarters of the window after a failed acknowledge", () => {
    // 2 attempts x (12s call + 8s mint) = 40s out of 900s.
    expect(worstCaseMs("acknowledge") * 4).toBeLessThanOrEqual(LEAFLY_AUTO_CANCEL_MS);
  });

  it("counts the token mint inside the worst case, because a retry re-mints", () => {
    expect(worstCaseMs("acknowledge")).toBe(
      LEAFLY_MAX_ATTEMPTS.acknowledge *
        (LEAFLY_TIMEOUT_MS.acknowledge + LEAFLY_TIMEOUT_MS.token_mint),
    );
  });

  it("keeps every budget finite and positive", () => {
    for (const op of LEAFLY_OPERATIONS) {
      expect(Number.isFinite(LEAFLY_TIMEOUT_MS[op])).toBe(true);
      expect(LEAFLY_TIMEOUT_MS[op]).toBeGreaterThan(0);
    }
  });

  it("gives an unknown operation the tightest budget rather than none", () => {
    expect(timeoutForOperation("not-an-operation")).toBe(LEAFLY_TIMEOUT_MS.token_mint);
    expect(Number.isFinite(timeoutForOperation(""))).toBe(true);
  });

  it("treats acknowledge as the only irreversible operation", () => {
    const irreversible = LEAFLY_OPERATIONS.filter((op) => isIrreversibleOperation(op));
    expect(irreversible).toEqual(["acknowledge"]);
  });

  it("never reports an unknowable outcome on the one-way door as safe", () => {
    // The customer-safety invariant, restated independently of the core's
    // own matrix so a change to both would have to be made twice.
    for (const fault of ["timeout", "unknown"] as const) {
      const v = describeDeadlineFailure({ operation: "acknowledge", fault });
      expect(v.safeToRetry).toBe(false);
      expect(v.certainlyNotDelivered).toBe(false);
    }
  });

  it("classifies an abort as a timeout regardless of the message text", () => {
    expect(
      classifyNetworkFault({ aborted: true, message: "getaddrinfo ENOTFOUND leafly" }),
    ).toBe("timeout");
  });

  it("records the integration-status check's real attempt count", () => {
    // push.ts:711 is the ONLY call site that passes no maxRetries, so it
    // takes authedFetch's own `?? 2` default: Math.max(1, 2 + 1) = 3. The
    // number is not reachable from the settings screen, which is exactly why
    // it has to be written down rather than assumed to match a neighbour.
    expect(LEAFLY_MAX_ATTEMPTS.integration_status).toBe(3);
    const push = read(join(LEAFLY_DIR, "push.ts"));
    expect(push).toContain('authedFetch(statusUrl(), "GET", "integration_status")');
  });
});

// ===========================================================================
// 4. THE BUTTON CANNOT LOOK DEAD AGAIN
// ===========================================================================
describe("the Leafly action buttons acknowledge the press", () => {
  const component = read(ACTIONS_COMPONENT);

  it("is a client component — a server component CANNOT show a pending state", () => {
    expect(component.startsWith('"use client"')).toBe(true);
  });

  it("reads the pending flag from inside the form, not beside it", () => {
    // useFormStatus reports the nearest ANCESTOR form. Called in the same
    // component that renders the <form>, it returns false forever — and it
    // does so silently, which is why this is asserted rather than reviewed.
    //
    // Measured on code with comments stripped: the header discusses the hook
    // by name at length, so raw-text offsets would compare prose to markup.
    const code = codeOnly(component);
    expect(code).toContain("useFormStatus");
    const submitIdx = code.indexOf("function SubmitButton");
    const hookIdx = code.indexOf("useFormStatus()");
    const formIdx = code.indexOf("<form");
    expect(submitIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeGreaterThan(submitIdx);
    // The hook call sits above the <form> element in the code, i.e. in the
    // child component, not in ActionForm which renders the form.
    expect(hookIdx).toBeLessThan(formIdx);
  });

  it("disables EVERY submit control while the request is in flight", () => {
    // Not cosmetic. A second press on a slow acknowledge is the double
    // submit the deadline core refuses to call safe: the first POST may
    // already have landed, and acknowledging twice cannot be undone.
    //
    // Counted, not merely contained. The first version of this assertion was
    // `expect(component).toContain("disabled={pending}")`, and the mutation
    // round caught it out: SubmitButton renders TWO controls (a Button for
    // the primary/danger emphases, a chip for the rest), so neutering one of
    // them left the other's attribute in the file and the test stayed green.
    // A partially-disabled button is not a fixed button -- and the emphasis
    // that was left live is the chip, which is what most status actions use.
    const code = codeOnly(component);
    const submits = code.match(/type="submit"/g) ?? [];
    const disabled = code.match(/disabled=\{pending\}/g) ?? [];
    const busy = code.match(/aria-busy=\{pending\}/g) ?? [];

    expect(submits.length).toBeGreaterThanOrEqual(2);
    expect(disabled.length).toBe(submits.length);
    expect(busy.length).toBe(submits.length);

    // And nothing may hard-code the flag off, which is how a "temporary"
    // debugging edit becomes permanent.
    expect(code).not.toContain("disabled={false}");
    expect(code).not.toMatch(/aria-busy=\{false\}/);
  });

  it("swaps the label while pending, so the control visibly changes", () => {
    expect(component).toContain("action.busyLabel");
  });

  it("spins", () => {
    expect(component).toContain("animate-spin");
  });

  it("takes its wording from the core rather than inventing a participle", () => {
    // String surgery on the label ("Acknowledge" -> "Acknowledging") in the
    // component would drift from the reviewed labels and would never be seen
    // by a reviewer, because the text is only on screen for a moment.
    expect(component).not.toMatch(/\.replace\(/);
    expect(component).not.toMatch(/\+\s*"ing/);
  });
});

describe("every planned action carries busy wording", () => {
  it("gives the acknowledge button a busy label that claims nothing", () => {
    const plan = planLeaflyOrderActions({
      leaflyOrderId: "ord-1",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: null,
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });
    expect(plan.actions).toHaveLength(1);
    const ack = plan.actions[0];
    expect(ack.kind).toBe("acknowledge");
    expect(ack.label).toBe(LEAFLY_ACK_ACTION_LABEL);
    expect(ack.busyLabel).toBe(LEAFLY_ACK_ACTION_BUSY_LABEL);
    // While the request is in flight we do not know the outcome, so the
    // wording may not read as a completed acknowledgement.
    expect(ack.busyLabel).not.toMatch(/acknowledg/i);
    expect(ack.busyLabel).not.toBe(ack.label);
  });

  it("gives every status action a distinct, open-ended busy label", () => {
    const plan = planLeaflyOrderActions({
      leaflyOrderId: "ord-1",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: "2026-01-01T00:00:00.000Z",
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });
    expect(plan.actions.length).toBeGreaterThan(0);
    for (const a of plan.actions) {
      expect(a.busyLabel.trim().length).toBeGreaterThan(0);
      expect(a.busyLabel).not.toBe(a.label);
      expect(a.busyLabel.endsWith("\u2026")).toBe(true);
    }
  });

  it("keeps the wording table complete, so nothing falls back silently", () => {
    for (const [status, w] of Object.entries(LEAFLY_STATUS_ACTION_WORDING)) {
      expect(w.busyLabel, `${status} busy label`).toBeTruthy();
      expect(w.busyLabel, `${status} differs from label`).not.toBe(w.label);
    }
  });
});

// ===========================================================================
// 5. THE HELPER'S OWN DESIGN CHOICES, PINNED
// ===========================================================================
describe("the deadline helper's design cannot be quietly undone", () => {
  const helper = read(FETCH_HELPER);

  it("uses an explicit AbortController so 'did WE abort?' is a fact", () => {
    // AbortSignal.timeout() is terser, but it makes the caller sniff the
    // error message to find out whether the clock fired — i.e. guess. The
    // whole classification rests on knowing this for certain.
    //
    // Asserted against code, not prose: the file's header explains at length
    // why AbortSignal.timeout() was rejected, and that explanation is worth
    // more than the convenience of a raw substring check.
    const code = codeOnly(helper);
    expect(code).toContain("new AbortController()");
    expect(code).toContain("let weAborted = false;");
    expect(code).not.toContain("AbortSignal.timeout(");
  });

  it("clears the timer in a finally, not on the happy path only", () => {
    expect(helper).toMatch(/finally\s*\{\s*clearTimeout\(timer\);/);
  });

  it("has no escape hatch that disables the deadline", () => {
    // A "0 means unlimited" option is how this defect comes back wearing a
    // configuration flag.
    expect(codeOnly(helper)).not.toMatch(/Infinity/);
    expect(helper).not.toMatch(/timeout\s*===?\s*0/);
  });

  it("takes its budget from the core rather than hard-coding a number", () => {
    expect(helper).toContain("timeoutForOperation(operation)");
  });
});
