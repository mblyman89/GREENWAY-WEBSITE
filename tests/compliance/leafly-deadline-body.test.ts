/**
 * tests/compliance/leafly-deadline-body.test.ts
 *
 * SLICE L-23 — REGRESSION: "It thinks for 5 minutes, vercels max, then
 * refreshes the page not working."
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS WHEN leafly-deadline.test.ts ALREADY DOES
 * ===========================================================================
 * L-17 diagnosed the owner's "it sits waiting forever stuck" correctly,
 * added `AbortController` to every Leafly fetch, and proved it with a suite
 * that asserts the deadline is wired into all six call sites. Every one of
 * those assertions is still true. The owner tested again and got the SAME
 * hang.
 *
 * The reason is a property of `fetch()` that a wiring test cannot see:
 *
 *   **`fetch()` resolves when the response HEADERS arrive, not when the
 *   response is complete.**
 *
 * The helper returned at that moment and `finally { clearTimeout(timer) }`
 * disarmed the guard. Each of the six call sites then read the body —
 * `await res.text()`, `await res.json()` — with no deadline of any kind. A
 * server that sends headers and then stalls mid-body therefore hung exactly
 * as before, and on Vercel that runs to the platform's five-minute limit.
 *
 * L-17's tests all passed throughout, because an `AbortController` was
 * genuinely present, genuinely wired, and genuinely cleared. It was simply
 * cleared too early. This is the recurring lesson of the last six slices in
 * its purest form: **asserting that a safety mechanism is PRESENT is not the
 * same as asserting that it WORKS.**
 *
 * ===========================================================================
 * SO THIS FILE USES A REAL SERVER, NOT A MOCK
 * ===========================================================================
 * A mocked `fetch` cannot reproduce this bug at all: a mock resolves with a
 * fully-formed `Response` whose body is already in memory, so the stall that
 * causes the hang is structurally impossible to express. Any test built on a
 * `vi.fn()` double would have passed against the broken code.
 *
 * These tests therefore start a genuine `node:http` server that flushes
 * headers, writes a partial chunk, and then goes silent — the shape of a
 * proxy or load balancer that dies mid-response — and assert on WALL-CLOCK
 * TIME. If the deadline regresses, these tests hang and then fail, which is
 * precisely the behaviour being defended against.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LEAFLY_TIMEOUT_MS,
  NULL_BODY_STATUSES,
  mayCarryBody,
  outcomeSettledByStatusAlone,
} from "@/lib/leafly/deadline-core";

/**
 * The helper under test is `server-only`, which throws when imported into a
 * test. It is loaded dynamically after the guard is neutralised, exactly as
 * the other server-module suites in this folder do.
 */
type FetchHelper = typeof import("@/lib/leafly/deadline-fetch").leaflyFetchWithDeadline;
let leaflyFetchWithDeadline: FetchHelper;

/** Servers created per-test, torn down in afterAll so nothing leaks. */
const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** Headers flushed, a partial body chunk, then silence forever. */
const stallMidBody: http.RequestListener = (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.flushHeaders();
  res.write('{"partial":');
  // No end(). The socket stays open and the body never completes.
};

beforeAll(async () => {
  ({ leaflyFetchWithDeadline } = await import("@/lib/leafly/deadline-fetch"));
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections?.();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("L-23 — the deadline covers the response body, not just the connection", () => {
  /**
   * THE LOAD-BEARING TEST. This is the owner's bug, reproduced.
   *
   * Against the pre-L-23 helper this test does not merely fail — it hangs
   * until vitest's own timeout kills it, which is the same failure the owner
   * experienced, scaled down.
   *
   * `token_mint` is used because it carries the tightest budget in the table
   * (8s), keeping the test fast while exercising the identical code path as
   * the acknowledge.
   */
  it("gives up on a body that never finishes arriving", async () => {
    const url = await listen(stallMidBody);
    const started = Date.now();

    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "GET" });

    const elapsed = Date.now() - started;
    const budget = LEAFLY_TIMEOUT_MS.token_mint;

    // It must have GIVEN UP, not returned a Response the caller would then
    // block on. This is the assertion the old code fails.
    expect(result.ok).toBe(false);

    // And it must have given up ON TIME. Without the fix this line is never
    // reached, because the await above never settles.
    expect(elapsed).toBeLessThan(budget + 4000);

    // It really was our clock, reported honestly rather than sniffed out of
    // an error string.
    if (!result.ok) {
      expect(result.didTimeout).toBe(true);
      expect(result.verdict.wasOurClock).toBe(true);
    }
  }, 30_000);

  /**
   * The attempt log has to be able to tell the two incidents apart. "We never
   * reached Leafly" and "Leafly answered and then went quiet" need different
   * responses from a human, and a log that flattens them is a log that sends
   * someone to check the wrong thing.
   */
  it("records that the time ran out during the BODY, and names the status it holds", async () => {
    const url = await listen(stallMidBody);
    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "GET" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("during body");
      // The status line genuinely arrived, so the log must say so.
      expect(result.detail).toContain("200");
    }
  }, 30_000);

  /**
   * A connect-phase failure must still read as a connect-phase failure. The
   * new phase must not relabel the fault L-17 fixed.
   */
  it("still reports a connection failure as a connect-phase failure", async () => {
    // Port 1 on loopback: nothing listens, so the connection is refused
    // before any status line exists.
    const result = await leaflyFetchWithDeadline("token_mint", "http://127.0.0.1:1/", {
      method: "GET",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).not.toContain("during body");
      // Nothing was received, so no status may be invented.
      expect(result.verdict.message).not.toMatch(/HTTP \d/);
    }
  }, 30_000);

  /**
   * ADDED AFTER THE MUTATION PROBE. A connect-phase TIMEOUT — distinct from
   * the refused connection above, which is not a timeout at all.
   *
   * The probe mutated the phase to a hardcoded `"body"` and this suite did
   * not notice, because the only timeout it exercised WAS a body stall. A
   * test that can only observe one value of a two-valued thing cannot pin it
   * down. This server accepts the connection and then never sends a status
   * line, so the deadline expires with nothing received.
   *
   * The operation is `acknowledge` deliberately. It is the button the owner
   * is actually pressing, it is the one irreversible operation, and it is
   * the only one whose connect-phase sentence admits "we cannot tell" — the
   * admission that matters, because pressing an acknowledge twice cannot be
   * undone. Pairing this with the body-phase acknowledge test below puts the
   * two sentences the button can show side by side, which is what makes the
   * hardcoded-phase mutant impossible to miss.
   */
  it("reports a timeout with no status as a CONNECT-phase timeout", async () => {
    const url = await listen(() => {
      // Connection accepted. No writeHead, no flushHeaders, no end.
      // The client never receives a status line.
    });

    const result = await leaflyFetchWithDeadline("acknowledge", url, { method: "POST" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.didTimeout).toBe(true);
      expect(result.detail).toContain("during connect");
      expect(result.detail).not.toContain("during body");
      // Nothing arrived, so no status may be invented and no delivery may
      // be claimed. The honest sentence is the uncertain one.
      expect(result.verdict.message).toMatch(/cannot tell/i);
      expect(result.verdict.message).not.toMatch(/HTTP \d/);
      expect(result.verdict.message).not.toMatch(/did reach Leafly|DID receive/i);
      // Nothing was delivered that we know of, but acknowledge is the one-way
      // door, so the safe-to-retry flag must still refuse to promise.
      expect(result.verdict.safeToRetry).toBe(false);
    }
  }, 30_000);

  /**
   * ADDED AFTER THE MUTATION PROBE. The phase must reach the SENTENCE, not
   * just the log line.
   *
   * The probe deleted `phase` and `receivedStatus` from the
   * `describeDeadlineFailure` call — so the operator was told "we cannot tell
   * whether Leafly received it" while we were holding Leafly's status line —
   * and the suite passed, because it only ever asserted on `detail`. The
   * message is what a human actually reads, so the message is what must be
   * pinned.
   */
  it("tells the operator that Leafly DID answer when the body is what stalled", async () => {
    const url = await listen(stallMidBody);
    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "GET" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The fact that makes this sentence useful: the request arrived.
      expect(result.verdict.message).toMatch(/did reach Leafly/i);
      // The evidence for that claim, named rather than asserted vaguely.
      expect(result.verdict.message).toContain("200");
      // And it must NOT repeat the connect-phase hedge, which is now false.
      expect(result.verdict.message).not.toMatch(/cannot tell/i);
    }
  }, 30_000);
});

describe("L-23 — the 204 rescue, and its limits", () => {
  /**
   * THE MOST DANGEROUS CASE IN THE SLICE.
   *
   * Leafly's acknowledge endpoint returns **204 No Content**. A 204 has no
   * body to wait for, so if the status line has arrived the answer is already
   * complete. Reporting a timeout there would tell the operator that an
   * IRREVERSIBLE action failed while we are holding Leafly's own confirmation
   * that it succeeded — and would invite a second press against a door that
   * cannot open twice, after the shopper's ID images are already destroyed.
   */
  /**
   * REWRITTEN AFTER THE MUTATION PROBE, AND THIS IS THE MOST IMPORTANT
   * CORRECTION IN THE SLICE.
   *
   * The original version of this test used a 204 with `flushHeaders()` and a
   * lingering socket. That looked like a stall but was not one: Node ends the
   * message for a 204 (it cannot have a body), so `fetch` completed normally
   * and the rescue branch was NEVER EXECUTED. The probe proved it — deleting
   * the entire rescue (`if (false)`) left this test passing.
   *
   * That is exactly the failure mode this whole slice is about, committed by
   * me, in the test written to prevent it: a test that appears to exercise a
   * safety branch while never reaching it. It would have passed forever while
   * the branch it named rotted.
   *
   * The fix is to stall with a 304, which Node does NOT auto-end the same way
   * and which is a genuine null-body status, so the abort really does fire
   * mid-stream and the rescue branch really does run. A separate test below
   * covers the ordinary clean 204.
   */
  /**
   * REWRITTEN AFTER THE SECOND MUTATION PROBE, which reported this branch as
   * a HOLE: mutating the rescue to `if (false)` left the old version of this
   * test green, and so did substituting a hardcoded 200 for the real status.
   *
   * The old test stalled a real 304 socket and asserted the outcome. It
   * passed — but it never entered the rescue at all, because of a fact that
   * was measured rather than assumed (see the seam note in deadline-fetch.ts):
   * undici completes a null-body response the instant the status line lands,
   * under every framing. Nothing about a 204 or a 304 can be made to stall.
   *
   * So the test was asserting the right outcome via the wrong path, and any
   * damage to the rescue was invisible. That is the same failure mode as
   * L-17's: a green assertion that does not touch the mechanism it names.
   *
   * These two tests drive the ONE condition that reaches the rescue for real,
   * and which probe 2 confirmed happens: the deadline expires between the
   * status line arriving and the body read, so an already-complete 204
   * rejects with AbortError. The seam supplies that timing exactly, with no
   * reliance on a race.
   */
  it("rescues a null-body status when the deadline expires before the body read", async () => {
    for (const status of NULL_BODY_STATUSES) {
      const controllerSignal = { aborted: false };

      // A Response that has genuinely arrived — status line in hand — whose
      // body read then rejects exactly as undici's does once the deadline
      // fires. This is probe 2's measured behaviour, not an invention.
      const arrived = {
        status,
        statusText: "",
        headers: new Headers({ "X-Trace": "ack" }),
        text: () => {
          controllerSignal.aborted = true;
          return Promise.reject(
            Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
          );
        },
      } as unknown as Response;

      const result = await leaflyFetchWithDeadline(
        "acknowledge",
        "http://127.0.0.1:1/",
        { method: "POST" },
        { fetchImpl: () => Promise.resolve(arrived) },
      );

      // Proves we really went down the body-read path rather than short
      // circuiting somewhere harmless.
      expect(controllerSignal.aborted).toBe(true);

      // THE LOAD-BEARING ASSERTION. Reporting a failure here would tell the
      // operator an IRREVERSIBLE action failed while we hold Leafly's own
      // confirmation that it succeeded, inviting a second press after the
      // shopper's ID images are already destroyed.
      expect(result.ok).toBe(true);
      if (result.ok) {
        // The status we RECEIVED, not a substituted 200.
        expect(result.response.status).toBe(status);
        // The call sites do this next; it must not throw.
        await expect(result.response.text()).resolves.toBe("");
      }
    }
  }, 30_000);

  /**
   * The other half of the same hole. A stalled 200 reaches the identical
   * code path, and must NOT be rescued: a 200's body IS the payload, so
   * inventing an empty one hands the caller a successful-looking response
   * with nothing in it. Driven through the seam so the ONLY difference from
   * the test above is the status code.
   */
  it("does NOT rescue a status that can carry a body, via the same path", async () => {
    const arrived = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: () =>
        Promise.reject(
          Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
        ),
    } as unknown as Response;

    const result = await leaflyFetchWithDeadline(
      "acknowledge",
      "http://127.0.0.1:1/",
      { method: "POST" },
      { fetchImpl: () => Promise.resolve(arrived) },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response).toBeNull();
    }

    // NOT asserted here, deliberately: the "during body" wording and the
    // "Leafly answered HTTP 200" sentence are only produced when OUR timer
    // fired, and this seam rejects immediately without waiting out the
    // budget. Asserting them would have forced either a 12-second test or a
    // loosening of the `weAborted` check that keeps a genuine upstream abort
    // from being mislabelled as a Leafly timeout. Those two sentences are
    // pinned instead by the real-server stall tests above, which spend the
    // real budget and are the honest place to prove wording that depends on
    // the clock. What THIS test exists to prove is narrower and otherwise
    // untestable: that the rescue discriminates on the STATUS, and lets a
    // body-carrying status through to the failure path.
  }, 30_000);

  /**
   * The real-socket version is KEPT, unchanged in intent, because it proves
   * something the seam cannot: that a genuine null-body response over a real
   * connection is handled correctly and promptly. It simply is no longer the
   * test that claims to cover the rescue.
   */
  it("handles a real null-body response over a real socket without stalling", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(304, { "X-Trace": "ack" });
      res.flushHeaders();
      // No end(). The socket is held open exactly as a dying proxy would
      // leave it — and a 304 still completes, which is the measured fact
      // that made the seam above necessary.
    });

    const started = Date.now();
    const result = await leaflyFetchWithDeadline("acknowledge", url, { method: "POST" });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.status).toBe(304);
      await expect(result.response.text()).resolves.toBe("");
    }
    // It must not have burned the budget waiting for a body that cannot exist.
    expect(elapsed).toBeLessThan(LEAFLY_TIMEOUT_MS.acknowledge);
  }, 30_000);

  /**
   * The limit of the rescue. A 200's body IS the payload, so a stalled 200
   * must NOT be rescued — handing back an empty-bodied 200 would give the
   * caller a successful-looking response with nothing in it, which is how a
   * silently-empty order gets processed.
   */
  it("does NOT rescue a 200 whose body stalls", async () => {
    const url = await listen(stallMidBody);
    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "GET" });
    expect(result.ok).toBe(false);
  }, 30_000);
});

describe("L-23 — the buffered response behaves exactly like the original", () => {
  /**
   * The fix re-wraps the response so the six existing call sites keep working
   * unchanged. If the re-wrap loses the status, the headers or the body, it
   * breaks paths that handle money and irreversible actions — so each is
   * pinned rather than assumed.
   */
  it("preserves status, statusText, headers and a JSON body", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(201, { "Content-Type": "application/json", "X-Trace": "xyz" });
      res.end(JSON.stringify({ access_token: "tok", expires_in: 900 }));
    });

    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "POST" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.response.status).toBe(201);
    expect(result.response.ok).toBe(true);
    expect(result.response.headers.get("x-trace")).toBe("xyz");

    // token.ts reads .json(); order-ack-server.ts reads .text(). Both must work.
    const json = (await result.response.json()) as { access_token: string; expires_in: number };
    expect(json.access_token).toBe("tok");
    expect(json.expires_in).toBe(900);
  }, 30_000);

  it("preserves an error status and its body so the classifier still sees it", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unprocessable" }));
    });

    const result = await leaflyFetchWithDeadline("acknowledge", url, { method: "POST" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.response.status).toBe(422);
    expect(result.response.ok).toBe(false);
    expect(await result.response.text()).toContain("unprocessable");
  }, 30_000);

  /**
   * A clean 204 — the ordinary successful acknowledge — must survive the
   * re-wrap. The `Response` constructor throws if a null-body status is given
   * any body at all, INCLUDING the empty string that `.text()` returns, so
   * this would throw on every successful acknowledgement if the null-body
   * rule were dropped.
   */
  it("re-wraps a clean 204 without throwing", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(204, { "X-Trace": "ack" });
      res.end();
    });

    const result = await leaflyFetchWithDeadline("acknowledge", url, { method: "POST" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.response.status).toBe(204);
    expect(result.response.headers.get("x-trace")).toBe("ack");
    await expect(result.response.text()).resolves.toBe("");
  }, 30_000);

  /**
   * The body must be read INSIDE the budget, which means it is already in
   * memory when the caller gets it. Proven by timing the caller's read: a
   * buffered body returns effectively instantly.
   */
  it("hands back a body that is already buffered, so the caller never blocks", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("hello");
    });

    const result = await leaflyFetchWithDeadline("token_mint", url, { method: "GET" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const started = Date.now();
    const text = await result.response.text();
    const elapsed = Date.now() - started;

    expect(text).toBe("hello");
    expect(elapsed).toBeLessThan(250);
  }, 30_000);
});

describe("L-23 — the null-body rule the re-wrap depends on", () => {
  it("names exactly the three statuses that may not carry a body", () => {
    expect([...NULL_BODY_STATUSES]).toEqual([204, 205, 304]);
  });

  it("puts the acknowledge success code on the null-body side", () => {
    // Not a preference: docs/leafly-specs/order-api-v1.openapi.json documents
    // 204 as the acknowledge response.
    expect(mayCarryBody(204)).toBe(false);
    expect(outcomeSettledByStatusAlone(204)).toBe(true);
  });

  it("puts the status-push success code on the other side", () => {
    // The status endpoint returns 200, deliberately different from 204.
    expect(mayCarryBody(200)).toBe(true);
    expect(outcomeSettledByStatusAlone(200)).toBe(false);
  });

  it("defaults unknown input to may-carry-body, the direction that cannot throw", () => {
    expect(mayCarryBody(null)).toBe(true);
    expect(mayCarryBody(undefined)).toBe(true);
    expect(mayCarryBody(Number.NaN)).toBe(true);
    expect(outcomeSettledByStatusAlone(null)).toBe(false);
  });
});

/**
 * ADDED AFTER THE MUTATION PROBE.
 *
 * Two mutations survived by attacking the HARNESS rather than the code: one
 * dropped the assertion floor to zero, the other unregistered the core from
 * CI entirely. Both leave a suite that passes while proving nothing, and
 * neither is visible to a test that only exercises functions.
 *
 * The self-tests run in a separate harness (`run-pure-selftests.ts`), so this
 * suite cannot observe them by running them. It can, however, assert that the
 * registration still EXISTS and still carries a floor worth having — which is
 * the one thing that stops the 667 assertions above being quietly disarmed.
 */
describe("L-23 — the self-test registration cannot be quietly disarmed", () => {
  const harness = readFileSync(
    join(process.cwd(), "scripts/compliance/run-pure-selftests.ts"),
    "utf8",
  );

  it("still registers the deadline core with CI", () => {
    expect(harness).toContain("__runLeaflyDeadlineTests()");
    expect(harness).toMatch(/assertRan\(\s*"leafly-deadline-core"/);
  });

  it("keeps a floor high enough to notice the body-deadline assertions vanishing", () => {
    const m = harness.match(
      /assertRan\(\s*"leafly-deadline-core"\s*,\s*__runLeaflyDeadlineTests\(\)\s*,\s*(\d+)\s*\)/,
    );
    expect(m).not.toBeNull();
    const floor = Number(m?.[1]);
    // L-17 shipped 515 assertions with a floor of 500. L-23 added the
    // body-phase and null-body assertions, measured at 667. A floor at or
    // below L-17's would let every assertion this slice added be deleted
    // without CI noticing.
    expect(floor).toBeGreaterThan(515);
  });
});

// ===========================================================================
// SLICE L-24 — THE BINARY BODY
// ===========================================================================
/**
 * WHY THESE TESTS EXIST, AND WHY THEY USE A REAL SERVER.
 *
 * L-23 made the helper buffer the body inside the budget by calling
 * `.text()`. That was right for all six Leafly calls that existed, because
 * every one of them was JSON. L-24 added the two ID-image endpoints from the
 * vendored spec, which return `image/*` binary.
 *
 * `.text()` decodes as UTF-8. A JPEG is not UTF-8, so every high byte becomes
 * U+FFFD and re-encodes to three bytes: the payload is not merely mangled, it
 * GROWS, and the original cannot be recovered. This was measured against a
 * real JPEG over a real socket before the fix was written — the numbers are
 * quoted in the helper's header.
 *
 * The consequence is not cosmetic. The staff member opens an order to check
 * the customer's ID against the name on the cart, sees a broken image, and is
 * left choosing between acknowledging blind — which permanently destroys the
 * images — and cancelling a legitimate customer's order.
 *
 * A mocked `fetch` could not have caught this, because a mock returns
 * whatever Response you hand it. Only a real socket carrying real bytes
 * through the real undici pipeline exercises the decode. Hence `node:http`.
 */
describe("L-24 — an ID image survives the deadline helper intact", () => {
  /**
   * Real JPEG bytes: SOI, APP0/JFIF, a quantisation-table fragment, EOI.
   * Chosen over random bytes because the leading `ff d8 ff e0` is the JPEG
   * magic number — if the decode corrupts anything it corrupts that first,
   * which makes a failure instantly legible instead of a diff of noise.
   */
  const JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0xff, 0xd9,
  ]);

  const serveJpeg: http.RequestListener = (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": String(JPEG.length),
    });
    res.end(JPEG);
  };

  it("returns the image byte-for-byte when binary is requested", async () => {
    const base = await listen(serveJpeg);
    const r = await leaflyFetchWithDeadline(
      "media_fetch",
      `${base}/government_id/abc`,
      { method: "GET" },
      { binary: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = Buffer.from(await r.response.arrayBuffer());
    // The whole point, stated three ways so a partial regression cannot hide:
    // the length, the magic number, and the exact bytes.
    expect(got.length).toBe(JPEG.length);
    expect(got[0]).toBe(0xff);
    expect(got[1]).toBe(0xd8);
    expect(got.equals(JPEG)).toBe(true);
  });

  /**
   * THE CONTROL. This is the test that proves the flag is doing the work
   * rather than the bytes happening to survive for some unrelated reason.
   *
   * Same server, same URL, same helper — only the flag removed. If this ever
   * starts passing, either the default changed (and every JSON call site
   * needs re-checking) or the assertion above has stopped meaning anything.
   */
  it("CORRUPTS the same image without the flag — proving the flag is load-bearing", async () => {
    const base = await listen(serveJpeg);
    const r = await leaflyFetchWithDeadline("media_fetch", `${base}/government_id/abc`, {
      method: "GET",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = Buffer.from(await r.response.arrayBuffer());
    expect(got.equals(JPEG)).toBe(false);
    // UTF-8 replacement makes it LONGER, which is the counter-intuitive part
    // worth pinning: a naive reader expects truncation, not growth.
    expect(got.length).toBeGreaterThan(JPEG.length);
  });

  it("preserves the Content-Type so the browser can render the image", async () => {
    const base = await listen(serveJpeg);
    const r = await leaflyFetchWithDeadline(
      "media_fetch",
      `${base}/government_id/abc`,
      { method: "GET" },
      { binary: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Leafly documents `image/*` — it may send jpeg, png or heic. We must
    // pass through whatever they said rather than guessing a type, because
    // guessing wrong renders a broken image for a real ID.
    expect(r.response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("still bounds the body read when the image stalls mid-transfer", async () => {
    // The L-23 property must not be lost by adding a second read path. A
    // stalled IMAGE has to abort on the same clock a stalled JSON body does,
    // otherwise the binary branch reintroduces the original five-minute hang
    // on the one screen where a person is actively waiting.
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.flushHeaders();
      res.write(Buffer.from([0xff, 0xd8]));
      // No end(). Socket open, body never completes.
    });
    const started = Date.now();
    const r = await leaflyFetchWithDeadline(
      "media_fetch",
      `${base}/government_id/abc`,
      { method: "GET" },
      { binary: true },
    );
    const elapsed = Date.now() - started;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.didTimeout).toBe(true);
    // Bounded by media_fetch's own budget, not some other operation's.
    expect(elapsed).toBeLessThan(LEAFLY_TIMEOUT_MS.media_fetch + 4000);
    expect(elapsed).toBeGreaterThanOrEqual(LEAFLY_TIMEOUT_MS.media_fetch - 1500);
    // A GET that timed out is safe to repeat. Telling the operator otherwise
    // would push them towards acknowledging without looking.
    expect(r.verdict.safeToRetry).toBe(true);
  }, 30_000);

  it("does not throw on a null-body status when binary is requested", async () => {
    // The L-23 landmine, re-armed by the new branch: `new Response(body, ...)`
    // THROWS for a 204 given any body at all — and an empty ArrayBuffer is
    // still a body. If `mayCarryBody` were bypassed on the binary path this
    // would throw rather than fail, so the test asserts a clean result.
    const base = await listen((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const r = await leaflyFetchWithDeadline(
      "media_fetch",
      `${base}/government_id/missing`,
      { method: "GET" },
      { binary: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.status).toBe(204);
  });

  it("leaves the JSON path byte-identical — the six existing call sites are untouched", async () => {
    // The regression this slice most plausibly causes. `binary` defaults to
    // false; if that default ever flips, acknowledge and the menu pushes all
    // change behaviour silently.
    const payload = { id: "ord_1", status: "pending", total: "19.99" };
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    const r = await leaflyFetchWithDeadline("order_fetch", `${base}/orders/ord_1`, {
      method: "GET",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await r.response.json()).toEqual(payload);
  });

  it("treats an explicit binary:false exactly like an omitted flag", async () => {
    // Guards the `=== true` comparison. A truthiness check would behave the
    // same here, but `binary: undefined` from a spread options object must
    // not accidentally select the binary path either.
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    const r = await leaflyFetchWithDeadline(
      "order_fetch",
      `${base}/x`,
      { method: "GET" },
      { binary: false },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await r.response.json()).toEqual({ ok: true });
  });
});
