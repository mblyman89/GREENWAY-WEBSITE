/**
 * tests/compliance/leafly-id-image-runtime.test.ts — SLICE L-24, round two.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS: EIGHT MUTANTS SURVIVED
 * ===========================================================================
 * `scripts/compliance/mutation-l24-order-detail.py` ran 27 mutants against the
 * L-24 code. Nineteen died. EIGHT SURVIVED, and every survivor was in the two
 * places the original suite could only inspect as TEXT:
 *
 *   order-detail-server.ts  — the local access check could be replaced with
 *                             `if (false)`, a 403/404 could be relabelled
 *                             retryable, a zero-byte body could be passed off
 *                             as a success, and the one-shot auth retry could
 *                             be turned into an infinite loop.
 *   leafly-id-image/route.ts — the permission check could be deleted, the
 *                             kind validation could be disabled, and the
 *                             `no-store` header could be swapped for
 *                             `public, max-age=3600`.
 *
 * The existing tests asserted that the SOURCE contained "orders.manage" and
 * "no-store". A mutation that replaced `await requirePermission(...)` with
 * `await Promise.resolve()` left the phrase "orders.manage" sitting in a
 * comment, so the test stayed green while the route served government IDs to
 * anyone with a session. That is the precise failure mode house rule 141
 * warns about — "a test that reads source text is a last resort, not a
 * default" — and the probe proved it empirically rather than theoretically.
 *
 * So this file does not read source. It EXECUTES the route and the server
 * function against mocked collaborators and asserts on observable behaviour:
 * status codes, headers, returned bytes, and how many times Leafly was
 * called. Each `it` below is annotated with the mutant it kills.
 *
 * ===========================================================================
 * WHY MOCKS HERE, WHEN THE DEADLINE SUITE USES A REAL SOCKET
 * ===========================================================================
 * `leafly-deadline.test.ts` stands up a real `node:http` server because it is
 * testing TIMING, which a mock cannot reproduce. Nothing here is about
 * timing. These are branch decisions — permitted or refused, retryable or
 * final, one retry or two — and the collaborators being replaced (Supabase,
 * Leafly's token mint, Leafly's media endpoint) are exactly the ones that
 * cannot be reached from CI. Mocking them is what makes the branches
 * reachable at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mutable fixtures. Declared before the vi.mock factories because those
// factories are hoisted above the imports and must close over live bindings
// rather than capture values.
// ---------------------------------------------------------------------------

/** What `loadLeaflyOrderDetail` will appear to find in the database. */
let orderRow: {
  id: string;
  leafly_order_id: string | null;
  leafly_status: string | null;
  acknowledged_at: string | null;
  acknowledge_by: string | null;
  raw_order: unknown;
} | null = null;

/** Scripted Leafly media responses, consumed one per call. */
let mediaResponses: Array<{
  status: number;
  body: ArrayBuffer;
  contentType?: string;
}> = [];

/** Every media URL we asked Leafly for, in order. The retry counter. */
let mediaCalls: string[] = [];

/** How many times a fresh bearer token was minted. */
let tokenMints = 0;

/** How many times the token cache was thrown away. */
let tokenResets = 0;

/** Whether `requirePermission` should succeed. */
let permissionGranted = true;

/** Every permission the route actually demanded. */
let permissionsAsked: string[] = [];

/**
 * SLICE L-47 — every row written to the attempt ledger, keyed by table.
 * The media path now records its outcome for certification evidence, so the
 * fake client models `.insert()` (the real transform builder has it) and the
 * suite asserts on WHAT was written — above all, that no bytes were.
 */
let inserted: Array<{ table: string; row: Record<string, unknown> }> = [];

function bytes(n: number): ArrayBuffer {
  return new Uint8Array(n).fill(7).buffer;
}

// ---------------------------------------------------------------------------
// Collaborator mocks
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (perm: string) => {
    permissionsAsked.push(perm);
    if (!permissionGranted) throw new Error("forbidden");
  },
}));

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return true;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      limit: () => builder,
      // ── SLICE L-25 — THE MOCK MUST MODEL THE REAL CLIENT ──────────────────
      //
      // `abortSignal` is new here, and its absence broke this suite the
      // moment the real query was given a deadline. That is worth recording,
      // because the failure was in the MOCK, not in the code under test.
      //
      // L-25 bounded every database call on the acknowledge path: measured
      // against a black-hole server, an unbounded PostgREST query was still
      // hanging at 8006ms, which is why the owner's acknowledge button span
      // forever. The media read in `order-detail-server` is one of those
      // calls, so it now ends `.abortSignal(dbDeadline("order_read"))`.
      //
      // This builder did not offer that method, so the chain threw
      // "abortSignal is not a function", the route's catch turned it into a
      // 502, and assertions expecting 200 / 409 failed. Nothing about the
      // route's real behaviour changed.
      //
      // The lesson: a hand-rolled fake is a claim about the real client's
      // interface. `abortSignal` exists on the installed postgrest-js
      // transform builder, so a fake without it was always a lie — it just
      // had not been caught out yet. It is a passthrough here because the
      // deadline's EFFECT is proven elsewhere against a real server
      // (scripts/recon/supabase-hang-probe.mjs) and asserted in
      // tests/compliance/leafly-l25-db-deadline.test.ts; this suite is about
      // the media route's status codes.
      abortSignal: () => builder,
      maybeSingle: async () => ({ data: orderRow, error: null }),
      single: async () => ({ data: orderRow, error: null }),
    };
    return {
      from: (table: string) => ({
        ...builder,
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return { abortSignal: async () => ({ error: null }) };
        },
      }),
    };
  },
}));

vi.mock("@/lib/leafly/config", () => ({
  getLeaflyConfig: () => ({ environment: "sandbox" }),
}));

vi.mock("@/lib/leafly/runtime", () => ({
  refreshLeaflyConfig: async () => undefined,
}));

vi.mock("@/lib/leafly/token", () => ({
  getLeaflyAccessToken: async () => {
    tokenMints += 1;
    return `token-${tokenMints}`;
  },
  resetLeaflyTokenCache: () => {
    tokenResets += 1;
  },
}));

vi.mock("@/lib/leafly/webhook-server", () => ({
  loadLeaflyOrderIntegrationKey: async () => "integration-key",
}));

/**
 * The media transport. Returns the scripted response and records the URL.
 *
 * Shaped to match `DeadlineFetchResult` so the code under test is unmodified.
 */
vi.mock("@/lib/leafly/deadline-fetch", () => ({
  leaflyFetchWithDeadline: async (_op: string, url: string) => {
    mediaCalls.push(url);
    const next = mediaResponses.shift();
    if (!next) {
      return {
        ok: false,
        response: null,
        didTimeout: false,
        verdict: { message: "no scripted response", safeToRetry: false },
        detail: "test ran out of scripted responses",
      };
    }
    return {
      ok: true,
      response: {
        status: next.status,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === "content-type" ? (next.contentType ?? "image/jpeg") : null,
        },
        arrayBuffer: async () => next.body,
      } as unknown as Response,
    };
  },
}));

// Imported AFTER the mocks so the factories above are in force.
const { fetchLeaflyOrderMedia } = await import("@/lib/leafly/order-detail-server");
const { GET } = await import("@/app/api/admin/leafly-id-image/route");

/** An order whose ID images Leafly WILL still release. */
function openWindowOrder() {
  return {
    id: "row-1",
    // REQUIRED. Omitting it makes decideMediaAccess return `no_order_id`,
    // which is a refusal for an entirely different reason than the one each
    // test is probing — and, being a data fault rather than a closed window,
    // it is reported as RETRYABLE. A fixture that is wrong in that direction
    // turns a green "not retryable" assertion into an accident.
    leafly_order_id: "ord-1",
    leafly_status: "pending",
    acknowledged_at: null,
    acknowledge_by: null,
    raw_order: { orderId: "ord-1", total: "42.00" },
  };
}

/**
 * A real `NextRequest`, not a hand-rolled stub.
 *
 * The route reads `req.nextUrl.searchParams`, which a plain `Request` does
 * not have. Constructing the genuine article rather than faking `.nextUrl`
 * means the query parsing under test is Next's own — so a test cannot pass
 * because our stub was more forgiving than the framework.
 */
function request(query: string): NextRequest {
  return new NextRequest(`https://example.test/api/admin/leafly-id-image?${query}`);
}

beforeEach(() => {
  orderRow = openWindowOrder();
  mediaResponses = [];
  mediaCalls = [];
  tokenMints = 0;
  tokenResets = 0;
  permissionGranted = true;
  permissionsAsked = [];
  inserted = [];
});

// ===========================================================================
// 1. THE LOCAL ACCESS CHECK  (kills mutant 18)
// ===========================================================================
describe("L-24 — the local access check runs BEFORE Leafly is called", () => {
  it("refuses an acknowledged order without dialling Leafly at all", async () => {
    // MUTANT 18: `if (!detail.mediaAccess.allowed)` -> `if (false)`.
    //
    // The surviving mutant let an acknowledged order fall through to a live
    // request, so the operator saw a bare 403 from Leafly — which reads as
    // "no such order" — instead of "this was acknowledged, the images are
    // gone". The kill condition is the CALL COUNT: a correct implementation
    // never reaches the network.
    orderRow = { ...openWindowOrder(), acknowledged_at: "2026-01-01T00:00:00.000Z" };

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(false);
    expect(mediaCalls).toEqual([]);
    expect(tokenMints).toBe(0);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.summary).toContain("refused locally");
    }
  });

  it("still calls Leafly when the window is genuinely open", async () => {
    // The CONTROL for the assertion above. Without this, deleting the media
    // call entirely would also make the previous test pass — a test that
    // proves nothing because the behaviour it forbids is impossible.
    mediaResponses = [{ status: 200, body: bytes(64) }];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(true);
    expect(mediaCalls).toHaveLength(1);
  });
});

// ===========================================================================
// 2. A REFUSAL IS FINAL  (kills mutant 19)
// ===========================================================================
describe("L-24 — Leafly's refusal is never offered as retryable", () => {
  for (const status of [403, 404]) {
    it(`marks HTTP ${status} as NOT retryable`, async () => {
      // MUTANT 19: `retryable: false` -> `retryable: true` on the 403/404
      // branch. A retry button on a permanently closed door burns the only
      // fifteen minutes the operator has.
      mediaResponses = [{ status, body: bytes(0) }];

      const result = await fetchLeaflyOrderMedia({
        leaflyOrderId: "ord-1",
        kind: "government_id",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retryable).toBe(false);
        expect(result.summary).toContain(String(status));
      }
    });
  }

  it("DOES offer a retry on a 500, so 'not retryable' is a real decision", async () => {
    // The contrast case. If every failure were marked final, the assertions
    // above would pass for the wrong reason.
    mediaResponses = [{ status: 500, body: bytes(0) }];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });
});

// ===========================================================================
// 3. AN EMPTY BODY IS A FAILURE  (kills mutant 20)
// ===========================================================================
describe("L-24 — a zero-byte 200 is treated as a failure, not an image", () => {
  it("refuses an empty body instead of returning it as a success", async () => {
    // MUTANT 20: `if (bytes.byteLength === 0)` -> `if (false)`.
    //
    // A zero-byte 200 painted a broken-image icon with no explanation, which
    // an operator reads as "no ID on file" — the opposite of the truth.
    mediaResponses = [{ status: 200, body: bytes(0) }];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toContain("undefined");
    }
  });

  it("accepts a one-byte body, so the check is about EMPTY and not about size", async () => {
    mediaResponses = [{ status: 200, body: bytes(1) }];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.byteLength).toBe(1);
  });
});

// ===========================================================================
// 4. THE AUTH RETRY HAPPENS ONCE  (kills mutant 21)
// ===========================================================================
describe("L-24 — a 401 is retried exactly once, never in a loop", () => {
  it("retries a single time and then gives up", async () => {
    // MUTANT 21: `if (res.status === 401 && !didRetryAuth)` -> drop the flag.
    //
    // This is the most dangerous survivor in the set: the mutated loop never
    // terminates while Leafly keeps answering 401, on a code path a human is
    // waiting on. The kill condition is that the call count is BOUNDED.
    //
    // Three responses are scripted but only two may be consumed. A looping
    // implementation would exhaust the script and then spin on the
    // "no scripted response" result, which is itself a failure — so this
    // test is written to fail fast rather than hang CI.
    mediaResponses = [
      { status: 401, body: bytes(0) },
      { status: 401, body: bytes(0) },
      { status: 200, body: bytes(32) },
    ];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(mediaCalls).toHaveLength(2);
    expect(tokenResets).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("succeeds when the SECOND attempt works, proving the retry is real", async () => {
    // Without this, simply deleting the retry would pass the test above.
    mediaResponses = [
      { status: 401, body: bytes(0) },
      { status: 200, body: bytes(32) },
    ];

    const result = await fetchLeaflyOrderMedia({
      leaflyOrderId: "ord-1",
      kind: "government_id",
    });

    expect(result.ok).toBe(true);
    expect(mediaCalls).toHaveLength(2);
    expect(tokenResets).toBe(1);
    // A fresh token, not the cached one — the whole point of the retry.
    expect(tokenMints).toBe(2);
  });

  it("does not retry at all when the first attempt succeeds", async () => {
    mediaResponses = [{ status: 200, body: bytes(32) }];

    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });

    expect(mediaCalls).toHaveLength(1);
    expect(tokenResets).toBe(0);
  });
});

// ===========================================================================
// 5. THE ROUTE'S PERMISSION GATE  (kills mutant 23)
// ===========================================================================
describe("L-24 — the image route demands orders.manage at runtime", () => {
  it("returns 403 and never touches Leafly when permission is refused", async () => {
    // MUTANT 23: `await requirePermission("orders.manage")` -> `await
    // Promise.resolve()`. The old test asserted the source CONTAINED the
    // string "orders.manage" — which it still did, in the header comment —
    // so the route served government IDs to any authenticated session while
    // CI stayed green. This asserts the REFUSAL instead.
    permissionGranted = false;
    mediaResponses = [{ status: 200, body: bytes(64) }];

    const res = await GET(request("order=ord-1&kind=government_id"));

    expect(res.status).toBe(403);
    expect(mediaCalls).toEqual([]);
  });

  it("asks for exactly the permission that gates the acknowledge button", async () => {
    mediaResponses = [{ status: 200, body: bytes(64) }];

    await GET(request("order=ord-1&kind=government_id"));

    expect(permissionsAsked).toContain("orders.manage");
  });

  it("serves the image when permission is granted", async () => {
    // The control: proves the 403 above is caused by the gate and not by a
    // route that refuses everything.
    mediaResponses = [{ status: 200, body: bytes(64) }];

    const res = await GET(request("order=ord-1&kind=government_id"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("64");
  });
});

// ===========================================================================
// 6. KIND VALIDATION  (kills mutant 24)
// ===========================================================================
describe("L-24 — an unknown media kind never reaches an outbound URL", () => {
  for (const kind of ["passport", "../../secret", "government_id%00", ""]) {
    it(`rejects ${JSON.stringify(kind)} with a 400 and no outbound call`, async () => {
      // MUTANT 24: `if (!isLeaflyMediaKind(kindRaw))` -> `if (false)`, which
      // let an unvalidated path segment straight into a URL built against
      // Leafly's namespace.
      mediaResponses = [{ status: 200, body: bytes(64) }];

      const res = await GET(
        request(`order=ord-1&kind=${encodeURIComponent(kind)}`) as never,
      );

      expect(res.status).toBe(400);
      expect(mediaCalls).toEqual([]);
    });
  }

  it("accepts both kinds Leafly actually documents", async () => {
    for (const kind of ["government_id", "medical_id"]) {
      mediaCalls = [];
      mediaResponses = [{ status: 200, body: bytes(8) }];

      const res = await GET(request(`order=ord-1&kind=${kind}`));

      expect(res.status).toBe(200);
      expect(mediaCalls).toHaveLength(1);
      expect(mediaCalls[0]).toContain(kind);
    }
  });

  it("rejects a missing order id before validating anything else", async () => {
    const res = await GET(request("kind=government_id"));
    expect(res.status).toBe(400);
    expect(mediaCalls).toEqual([]);
  });
});

// ===========================================================================
// 7. THE CACHE CONTROL  (kills mutant 22)
// ===========================================================================
describe("L-24 — an ID image is never cacheable, on ANY response", () => {
  /**
   * The compliance control of the slice. A government ID in a shared
   * back-office tablet's disk cache outlives the fifteen minutes Leafly
   * grants access for. The mutant swapped the header for
   * `public, max-age=3600` and the source-reading test did not notice,
   * because the phrase "no-store" survived in the file's header comment.
   */
  function assertUncacheable(res: Response, label: string) {
    const cc = (res.headers.get("Cache-Control") ?? "").toLowerCase();
    expect(cc, `${label}: Cache-Control`).toContain("no-store");
    expect(cc, `${label}: must not be public`).not.toContain("public");
    expect(cc, `${label}: must not permit reuse`).not.toMatch(/max-age=[1-9]/);
  }

  it("on a successful image", async () => {
    mediaResponses = [{ status: 200, body: bytes(64) }];
    assertUncacheable(await GET(request("order=ord-1&kind=government_id")), "200");
  });

  it("on a permission refusal", async () => {
    permissionGranted = false;
    assertUncacheable(await GET(request("order=ord-1&kind=government_id")), "403");
  });

  it("on a bad kind", async () => {
    assertUncacheable(await GET(request("order=ord-1&kind=nope")), "400");
  });

  it("on a closed window", async () => {
    orderRow = { ...openWindowOrder(), acknowledged_at: "2026-01-01T00:00:00.000Z" };
    assertUncacheable(await GET(request("order=ord-1&kind=government_id")), "409");
  });

  it("sends nosniff and no referrer on the image itself", async () => {
    // Echoing Leafly's content type means a sniffing browser could
    // reinterpret the bytes; the referrer would leak the order id onward.
    mediaResponses = [{ status: 200, body: bytes(64) }];
    const res = await GET(request("order=ord-1&kind=government_id"));

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    // No filename: a filename is what makes "Save As" suggest keeping it.
    expect(res.headers.get("Content-Disposition")).toBe("inline");
  });

  it("never puts the integration key in a response header", async () => {
    // The upstream URL contains the order integration key. It must not be
    // echoed anywhere the browser can read.
    mediaResponses = [{ status: 500, body: bytes(0) }];
    const res = await GET(request("order=ord-1&kind=government_id"));

    for (const [, value] of res.headers.entries()) {
      expect(value).not.toContain("integration-key");
    }
  });
});

// ===========================================================================
// 8. THE FAILURE REASON REACHES THE OPERATOR
// ===========================================================================
describe("L-24 — a failed image explains itself in a header, not a body", () => {
  it("carries a decoded human sentence and a retryable flag", async () => {
    orderRow = { ...openWindowOrder(), acknowledged_at: "2026-01-01T00:00:00.000Z" };

    const res = await GET(request("order=ord-1&kind=government_id"));

    expect(res.status).toBe(409);
    const reason = decodeURIComponent(res.headers.get("x-leafly-media-reason") ?? "");
    expect(reason.length).toBeGreaterThan(10);
    expect(res.headers.get("x-leafly-media-retryable")).toBe("0");

    // An error BODY would be painted as an image by the browser.
    expect(await res.arrayBuffer()).toHaveProperty("byteLength", 0);
  });

  it("marks a transient upstream failure as retryable", async () => {
    mediaResponses = [{ status: 500, body: bytes(0) }];
    const res = await GET(request("order=ord-1&kind=government_id"));

    expect(res.status).toBe(502);
    expect(res.headers.get("x-leafly-media-retryable")).toBe("1");
  });
});

// ===========================================================================
// 9. SLICE L-47 — THE LEDGER ROW (certification evidence, never the image)
// ===========================================================================
describe("L-47 — every dialled ID-image request leaves one ledger row", () => {
  const ledger = () => inserted.filter((i) => i.table === "leafly_outbound_attempts").map((i) => i.row);

  it("records a success as operation=government_id, disposition=success, with NO bytes", async () => {
    mediaResponses = [{ status: 200, body: bytes(1234) }];
    const result = await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(result.ok).toBe(true);
    const rows = ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("government_id");
    expect(rows[0].disposition).toBe("success");
    expect(rows[0].response_status).toBe(200);
    expect(rows[0].response_body).toBeNull();
    expect(rows[0].leafly_order_id).toBe("ord-1");
    // No image, no URL (the URL carries the integration key), in ANY field.
    const flat = JSON.stringify(rows[0]);
    expect(flat).not.toContain("http");
    expect(flat).not.toMatch(/\\u0007|\\x07/);
    for (const v of Object.values(rows[0])) {
      expect(v instanceof ArrayBuffer || ArrayBuffer.isView(v as never)).toBe(false);
    }
    expect(String(rows[0].message)).toContain("1234 bytes");
  });

  it("records medical_id under its own operation name", async () => {
    mediaResponses = [{ status: 200, body: bytes(10) }];
    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "medical_id" });
    expect(ledger().map((r) => r.operation)).toEqual(["medical_id"]);
  });

  it("records Leafly's 403 as gone — the window closed", async () => {
    mediaResponses = [{ status: 403, body: bytes(0) }];
    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].disposition).toBe("gone");
    expect(ledger()[0].response_status).toBe(403);
  });

  it("records a zero-byte 200 as fix_request, NOT success", async () => {
    mediaResponses = [{ status: 200, body: bytes(0) }];
    const r = await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(r.ok).toBe(false);
    expect(ledger()[0].disposition).toBe("fix_request");
  });

  it("records a 401-then-200 as ONE row, the final answer", async () => {
    mediaResponses = [
      { status: 401, body: bytes(0) },
      { status: 200, body: bytes(5) },
    ];
    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].response_status).toBe(200);
    expect(ledger()[0].disposition).toBe("success");
  });

  it("records a network failure as retry with no status", async () => {
    mediaResponses = [];
    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].disposition).toBe("retry");
    expect(ledger()[0].response_status).toBeNull();
  });

  it("writes NOTHING for a local refusal — Leafly was never asked", async () => {
    orderRow = { ...openWindowOrder(), acknowledged_at: "2026-01-01T00:00:00.000Z" };
    await fetchLeaflyOrderMedia({ leaflyOrderId: "ord-1", kind: "government_id" });
    expect(mediaCalls).toHaveLength(0);
    expect(ledger()).toHaveLength(0);
  });
});
