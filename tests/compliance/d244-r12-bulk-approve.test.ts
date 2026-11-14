/**
 * tests/compliance/d244-r12-bulk-approve.test.ts - D244 round 4, slice R-12.
 *
 * Owner (verbatim): "another thing I would like to add is on the bulk draft
 * ai feature, to be able to select one or all drafts waiting for me to
 * approve. I want this page to auto approve the ones that are over 80%. all
 * 250 I am seeing in the list are 85%. so it should be safe to approve these."
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import {
  __runBulkApproveCoreTests,
  BULK_APPROVE_CHUNK,
  approveSummary,
  autoApproveKeys,
  chunkList,
  draftsNotCovered,
} from "@/lib/enrichment/bulk-approve-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const BAR = read("src/app/admin/products/bulk-ai/BulkApproveBar.tsx");
const ACT = read("src/app/admin/products/bulk-ai/approve-actions.ts");
const PAGE = read("src/app/admin/products/bulk-ai/page.tsx");

describe("R-12 pure core", () => {
  it("self-tests pass and are registered", () => {
    expect(__runBulkApproveCoreTests()).toEqual({ passed: 17, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("bulk-approve-core", __runBulkApproveCoreTests(), 17)');
  });
  it("auto-approve covers every product with a draft at 80%+; 250 products fit in small chunks", () => {
    const groups = Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, eligible: 7 }));
    const keys = autoApproveKeys(groups);
    expect(keys.length).toBe(250);
    expect(BULK_APPROVE_CHUNK).toBe(8);
    expect(chunkList(keys, BULK_APPROVE_CHUNK).length).toBe(32);
  });
  it("a ticked product covers its own ticked drafts; the summary says nothing was published", () => {
    expect(draftsNotCovered([{ id: "x", key: "a" }], ["a"])).toEqual([]);
    expect(approveSummary({ products: 250, accepted: 1750, blocked: 0, flagged: 0, failed: 0 })).toContain("Accepted 1750 drafts on 250 products.");
    expect(approveSummary({ products: 1, accepted: 1, blocked: 0, flagged: 0, failed: 0 })).toContain("Nothing was published");
  });
});

describe("R-12 wiring", () => {
  it("server actions need products.enrich, reuse the 80% rule and the compliance gate, audit, never publish", () => {
    expect(ACT.trimStart().startsWith('"use server";')).toBe(true);
    expect((ACT.match(/requirePermission\("products\.enrich"\)/g) ?? []).length).toBe(2);
    expect(ACT).toContain("acceptHighConfidenceForKey(key, session.userId)");
    expect(ACT).toContain("acceptDraftWithEdit(id, null, session.userId)");
    expect(ACT).toContain('action: "product.bulk_ai_accepted_all"');
    expect(ACT).toContain('via: "bulk-select"');
    expect(ACT).not.toContain("setEnrichmentStatusForKeys");
    expect(ACT).not.toContain("publishOnPhoto");
  });
  it("the bar: select all, approve selected, approve every draft at 80%+ (confirmed), chunked, buttons guarded", () => {
    expect(BAR).toContain('data-testid="bulk-approve-select-all"');
    expect(BAR).toContain('data-testid="bulk-approve-selected"');
    expect(BAR).toContain('data-testid="bulk-approve-all-80"');
    expect(BAR).toContain("window.confirm(autoApproveConfirm(");
    expect(BAR).toContain("chunkList(keys, BULK_APPROVE_CHUNK)");
    expect(BAR).toContain("disabled={running || autoKeys.length === 0}");
    expect(BAR).toContain("router.refresh()");
  });
  it("the page gives every product and every draft a tick box and shows the bar", () => {
    expect(PAGE).toContain("<BulkApproveBar autoKeys={autoApproveKeys(groups)} threshold={ACCEPT_ALL_THRESHOLD}");
    expect(PAGE).toContain("data-approve-key={g.key}");
    expect(PAGE).toContain("data-approve-id={r.id}");
  });
});
