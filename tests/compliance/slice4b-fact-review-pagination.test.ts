/**
 * tests/compliance/slice4b-fact-review-pagination.test.ts  (SLICE 4B)
 *
 * Guardrails for the fact-review read that feeds the publish commit gate.
 *
 * `pos_fact_reviews` rows record that a human APPROVED / FIXED / REJECTED a
 * flagged product. The read was unpaged, so on a large import every decision
 * past PostgREST's 1,000-row cap silently vanished -- and a review with no
 * recorded decision counts as PENDING, producing a refusal the owner cannot
 * clear because the decision genuinely exists.
 *
 * It also swallowed errors by returning [], which is indistinguishable from
 * "no decisions" -- a fail-open for the gate.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pagedAll } from "@/lib/supabase/chunked-in";
import { evaluateEvidenceIntegrity } from "@/lib/pos/commit-integrity-core";

const ROOT = process.cwd();

function readCode(relPath: string): string {
  const raw = readFileSync(join(ROOT, relPath), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// Behavioural: the real pager against a server that enforces the real cap
// ---------------------------------------------------------------------------

const SERVER_CAP = 1000;

type Review = { id: string; updated_at: string; action: string };

/** A fake PostgREST that truncates at db.max_rows exactly like the real one. */
function makeServer(rows: Review[]) {
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    fetchPage: async (from: number, to: number): Promise<Review[]> => {
      requests += 1;
      return rows.slice(from, to + 1).slice(0, SERVER_CAP);
    },
  };
}

describe("SLICE 4B — every recorded decision survives the row cap", () => {
  it("recovers 2,500 decisions that an unpaged read would cut to 1,000", async () => {
    // All decided. Under the old unpaged read the gate would see only 1,000.
    const rows: Review[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `rev-${String(i).padStart(5, "0")}`,
      updated_at: "2026-09-01T10:00:00Z", // identical on purpose: bulk approve
      action: "approve",
    }));
    const server = makeServer(rows);

    const got = await pagedAll<Review>(server.fetchPage);

    expect(got.length).toBe(2500);
    expect(new Set(got.map((r) => r.id)).size).toBe(2500); // no duplicates
    expect(server.requests).toBe(3); // 1000 + 1000 + 500
  });

  it("the OLD unpaged read loses 60% of the decisions", async () => {
    const rows: Review[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `rev-${i}`,
      updated_at: "2026-09-01T10:00:00Z",
      action: "approve",
    }));
    const server = makeServer(rows);

    // One request, exactly what the pre-4B code did.
    const single = await server.fetchPage(0, 100_000);

    expect(single.length).toBe(1000);
    const lost = rows.length - single.length;
    expect(lost).toBe(1500);
    // Those 1,500 decided rows would read as PENDING and block the publish.
  });

  it("terminates when the total is an exact multiple of the page size", async () => {
    const rows: Review[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `rev-${i}`,
      updated_at: "2026-09-01T10:00:00Z",
      action: "approve",
    }));
    const server = makeServer(rows);

    const got = await pagedAll<Review>(server.fetchPage);

    expect(got.length).toBe(2000);
    expect(server.requests).toBe(3); // 1000, 1000, then an empty page to stop
  });

  it("an empty import performs exactly one request and returns nothing", async () => {
    const server = makeServer([]);
    const got = await pagedAll<Review>(server.fetchPage);
    expect(got).toEqual([]);
    expect(server.requests).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The fail-open this closes
// ---------------------------------------------------------------------------

describe("SLICE 4B — a failed review read cannot be mistaken for 'nothing pending'", () => {
  it("a failed read refuses the publish even though it returned an empty list", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: 4179,
      serverItemCount: 4179,
      observedReviews: 0,
      reviewsReadFailed: true,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("read_failed");
    expect(v.message).toContain("fact-review");
  });

  it("a successful read with genuinely zero decisions still publishes", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: 4179,
      serverItemCount: 4179,
      observedReviews: 0,
      reviewsReadFailed: false,
    });
    expect(v.trustworthy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source guarantees
// ---------------------------------------------------------------------------

describe("SLICE 4B — the store pages and reports failure", () => {
  const store = readCode("src/lib/pos/fact-review-store.ts");

  it("uses pagedAll rather than a single unpaged request", () => {
    expect(store).toContain("pagedAll<PosFactReview>");
    expect(store).toContain("from \"@/lib/supabase/chunked-in\"");
  });

  it("pages with .range()", () => {
    expect(store).toMatch(/\.range\(from,\s*to\)/);
  });

  it("orders by a UNIQUE tiebreaker so pages cannot shuffle", () => {
    // updated_at is not unique -- a bulk approve stamps many rows identically.
    expect(store).toMatch(/\.order\("updated_at"[\s\S]{0,80}\.order\("id"/);
  });

  it("exposes an explicit ok flag distinguishing empty from failed", () => {
    expect(store).toContain("listFactReviewsResult");
    expect(store).toMatch(/ok:\s*false/);
    expect(store).toMatch(/ok:\s*true/);
  });

  it("keeps the plain listFactReviews wrapper for display screens", () => {
    expect(store).toContain("export async function listFactReviews(");
  });
});

describe("SLICE 4B — the publish gate consumes the failure signal", () => {
  const service = readCode("src/lib/pos/import-service.ts");

  it("the publish path uses the failure-aware read", () => {
    expect(service).toContain("listFactReviewsResult(importId)");
  });

  it("the failure flag reaches the gate", () => {
    expect(service).toContain("reviewsReadFailed: !reviewsResult.ok");
  });

  it("resolutions are built from the returned reviews", () => {
    expect(service).toContain("factReviewsToResolutions(reviewsResult.reviews)");
  });

  it("SLICE 4A witnesses are still supplied (no regression)", () => {
    expect(service).toContain("observedItems: items.length");
    expect(service).toContain("countVersionItems(versionId)");
  });
});
