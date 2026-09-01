/**
 * tests/compliance/slice4a-commit-integrity-gate.test.ts  (SLICE 4A)
 *
 * Guardrails for the publish commit gate's EVIDENCE INTEGRITY check.
 *
 * The gate's reconciliation arithmetic is self-referential: `rowsIn` is
 * computed from the same buckets the gate validates, so balanced arithmetic
 * over a truncated read still "balances". SLICE 4A corroborates the read
 * against independent witnesses before trusting the equation.
 *
 * These tests are BEHAVIOURAL where possible (run the real pure core) and
 * source-text only where the guarantee lives in wiring we cannot execute
 * without a live database.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateEvidenceIntegrity,
  type CommitEvidenceInput,
} from "@/lib/pos/commit-integrity-core";
import { evaluateCommitGate } from "@/lib/pos/import-commit-core";
import {
  buildFactReviewBuckets,
  type FactReviewItemInput,
} from "@/lib/pos/fact-review-core";

const ROOT = process.cwd();

/**
 * Read a source file with comments stripped. These files deliberately QUOTE
 * the old broken patterns in their explanatory comments, so a naive grep would
 * match the very thing we are asserting is gone.
 */
function readCode(relPath: string): string {
  const raw = readFileSync(join(ROOT, relPath), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function item(over: Partial<FactReviewItemInput>): FactReviewItemInput {
  return {
    sourceItemId: "pos-1",
    name: "Item",
    brandName: "Brand",
    category: "flower",
    hidden: false,
    hiddenReason: null,
    priceMinorUnits: 1000,
    servingsPerPack: null,
    mgPerServing: null,
    packageThcMg: null,
    packageCbdMg: null,
    ratioLabel: null,
    netWeightGrams: null,
    netVolumeMl: null,
    factProvenance: {},
    ...over,
  } as FactReviewItemInput;
}

// ---------------------------------------------------------------------------
// The two regressions this slice exists to stop
// ---------------------------------------------------------------------------

describe("SLICE 4A — truncated evidence can never open the gate", () => {
  it("refuses when the read returns fewer items than the version records", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 1000,
      recordedItemCount: 4179,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("short_read");
  });

  it("tells the owner exactly how many products are missing", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 1000,
      recordedItemCount: 4179,
    });
    expect(v.message).toContain("3179 missing");
    expect(v.message).toContain("nothing was published");
  });

  it("catches even a single missing product", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4178,
      recordedItemCount: 4179,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("short_read");
  });

  it("balanced arithmetic over a truncated read is NOT enough to publish", () => {
    // 1,000 items reconcile perfectly among themselves...
    const items = Array.from({ length: 1000 }, (_, i) =>
      item({ sourceItemId: `pos-${i}`, name: `P${i}` }),
    );
    const buckets = buildFactReviewBuckets(items, []);

    const arithmeticOnly = evaluateCommitGate(buckets);
    expect(arithmeticOnly.ready).toBe(true); // the blind spot, demonstrated

    // ...but the version records 4,179, so the evidence check refuses.
    const corroborated = evaluateCommitGate(buckets, {
      observedItems: 1000,
      recordedItemCount: 4179,
    });
    expect(corroborated.ready).toBe(false);
    expect(corroborated.evidence?.reason).toBe("short_read");
  });
});

describe("SLICE 4A — the fail-open on an empty read is closed", () => {
  it("zero items against a non-empty version is refused", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 0,
      recordedItemCount: 4179,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("empty_but_expected");
  });

  it("an empty read no longer reconciles as a publishable empty import", () => {
    // getVersionItems() returns [] on ANY read error. Fed to the gate that
    // used to mean rowsIn = 0, which is "trivially balanced" => publish.
    const emptyBuckets = buildFactReviewBuckets([], []);

    const before = evaluateCommitGate(emptyBuckets);
    expect(before.ready).toBe(true); // the old fail-open, demonstrated

    const after = evaluateCommitGate(emptyBuckets, {
      observedItems: 0,
      recordedItemCount: 4179,
    });
    expect(after.ready).toBe(false);
    expect(after.evidence?.reason).toBe("empty_but_expected");
  });

  it("an explicit read failure refuses even when the counts agree", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 10,
      recordedItemCount: 10,
      readFailed: true,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("read_failed");
  });

  it("a failed fact-review read refuses the publish", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 10,
      recordedItemCount: 10,
      reviewsReadFailed: true,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.message).toContain("fact-review");
  });
});

// ---------------------------------------------------------------------------
// Not vacuous: healthy imports must still publish
// ---------------------------------------------------------------------------

describe("SLICE 4A — healthy imports are not blocked", () => {
  it("agreeing witnesses publish", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: 4179,
      serverItemCount: 4179,
    });
    expect(v.trustworthy).toBe(true);
    expect(v.reason).toBeNull();
  });

  it("a genuinely empty version is still publishable", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 0,
      recordedItemCount: 0,
      serverItemCount: 0,
    });
    expect(v.trustworthy).toBe(true);
  });

  it("draft-injection drift (observed ABOVE recorded) is benign, not fatal", () => {
    // draft-injection.ts increments item_count as a read-modify-write inside
    // best-effort error handling, so rows can legitimately exceed the counter.
    const v = evaluateEvidenceIntegrity({
      observedItems: 4185,
      recordedItemCount: 4179,
    });
    expect(v.trustworthy).toBe(true);
    expect(v.driftAbove).toBe(6);
    expect(v.message).toContain("approved drafts");
  });

  it("a corroborated healthy import passes the full gate", () => {
    const items = [
      item({ sourceItemId: "pos-a", name: "A" }),
      item({ sourceItemId: "pos-b", name: "B" }),
    ];
    const verdict = evaluateCommitGate(buildFactReviewBuckets(items, []), {
      observedItems: 2,
      recordedItemCount: 2,
      serverItemCount: 2,
    });
    expect(verdict.ready).toBe(true);
    expect(verdict.evidence?.trustworthy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Witness handling
// ---------------------------------------------------------------------------

describe("SLICE 4A — witnesses are handled honestly", () => {
  it("an unavailable witness is never treated as zero", () => {
    // null must mean "could not consult", not "there are no rows".
    const v = evaluateEvidenceIntegrity({
      observedItems: 500,
      recordedItemCount: null,
      serverItemCount: null,
    });
    expect(v.trustworthy).toBe(false);
    expect(v.reason).toBe("missing_witness");
    expect(v.expectedItems).toBeNull();
  });

  it("the server COUNT catches truncation the stored counter missed", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 1000,
      recordedItemCount: 1000, // stale/undercounted
      serverItemCount: 4179, // ground truth
    });
    expect(v.trustworthy).toBe(false);
    expect(v.expectedItems).toBe(4179);
  });

  it("the server COUNT alone is sufficient corroboration", () => {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: null,
      serverItemCount: 4179,
    });
    expect(v.trustworthy).toBe(true);
  });

  it("non-finite or negative witnesses are discarded, not trusted", () => {
    const nan = evaluateEvidenceIntegrity({
      observedItems: 5,
      recordedItemCount: Number.NaN,
      serverItemCount: 5,
    });
    expect(nan.expectedItems).toBe(5);
    expect(nan.trustworthy).toBe(true);

    const negative = evaluateEvidenceIntegrity({
      observedItems: 5,
      recordedItemCount: -3,
    });
    expect(negative.reason).toBe("missing_witness");
  });

  it("every refusal is plain English and leaks no placeholders", () => {
    const cases: CommitEvidenceInput[] = [
      { observedItems: 0, recordedItemCount: 10 },
      { observedItems: 1, recordedItemCount: 10 },
      { observedItems: 10, recordedItemCount: 10, readFailed: true },
      { observedItems: 10, recordedItemCount: null },
      { observedItems: 10, recordedItemCount: 10, reviewsReadFailed: true },
    ];
    for (const c of cases) {
      const v = evaluateEvidenceIntegrity(c);
      expect(v.message.trim().length).toBeGreaterThan(0);
      expect(v.message).not.toContain("undefined");
      expect(v.message).not.toContain("NaN");
      expect(v.message).not.toContain("[object");
    }
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("SLICE 4A — omitting evidence preserves the old behaviour", () => {
  it("no evidence supplied => no evidence verdict, arithmetic unchanged", () => {
    const verdict = evaluateCommitGate(buildFactReviewBuckets([], []));
    expect(verdict.ready).toBe(true);
    expect(verdict.evidence == null).toBe(true);
  });

  it("pending reviews still block regardless of evidence", () => {
    // A row enters needs-review only via a REVIEW_DIAGNOSTIC_CODES code whose
    // context matches the item by displayName/productName (verified in
    // fact-review-core.ts:51 and :342-355) -- not by any arbitrary code.
    const items = [item({ sourceItemId: "pos-a", name: "A" })];
    const buckets = buildFactReviewBuckets(items, [
      {
        severity: "warning",
        code: "cannabinoid_missing",
        message: "check me",
        context: { displayName: "A" },
      },
    ]);
    const verdict = evaluateCommitGate(buckets, {
      observedItems: 1,
      recordedItemCount: 1,
      serverItemCount: 1,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.message).toContain("await a human decision");
  });
});

// ---------------------------------------------------------------------------
// Wiring guarantees (source-text; cannot execute without a live database)
// ---------------------------------------------------------------------------

describe("SLICE 4A — the publish path actually supplies the witnesses", () => {
  const service = readCode("src/lib/pos/import-service.ts");

  it("the gate is called WITH evidence, not bare", () => {
    expect(service).toMatch(/evaluateCommitGate\(\s*buckets\s*,\s*\{/);
  });

  it("all three witnesses are passed", () => {
    expect(service).toContain("observedItems: items.length");
    expect(service).toContain("recordedItemCount:");
    expect(service).toContain("serverItemCount");
  });

  it("item_count is selected so the recorded witness is real", () => {
    expect(service).toMatch(/\.select\("id, status, error_count, import_id, is_test, item_count"\)/);
  });

  it("the server COUNT witness is fetched", () => {
    expect(service).toContain("countVersionItems(versionId)");
  });

  it("diagnostics are still read without a limit (SLICE 3 must not regress)", () => {
    expect(service).toContain("getImportDiagnostics(importId)");
    expect(service).not.toMatch(/getImportDiagnostics\([^)]*limit/);
  });
});

describe("SLICE 4A — countVersionItems is cap-immune and honest", () => {
  const menuVersion = readCode("src/lib/pos/menu-version.ts");

  it("uses a server-side exact COUNT with head:true", () => {
    expect(menuVersion).toMatch(/count:\s*"exact",\s*head:\s*true/);
  });

  it("returns null (never 0) when the count cannot be read", () => {
    const fn = menuVersion.slice(
      menuVersion.indexOf("export async function countVersionItems"),
    );
    const body = fn.slice(0, fn.indexOf("\nexport async function getVersionItems"));
    expect(body).toContain("return null");
    expect(body).not.toMatch(/return\s+0\s*;/);
  });
});
