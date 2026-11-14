/**
 * tests/compliance/d244-r18-approve-all.test.ts - D244 round 6, slices R-18 and R-19.
 *
 * Owner (verbatim): "I need a way to select many/ all and approve many/ all
 * drafts awaiting my review on the bulk ai draft page in enrichment. I need a
 * way to approve all of the 20,000 records awaiting me in the kb data
 * pipeline. The bronze, silver, gold page."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KB_BULK_PAGE,
  KB_BULK_UPDATE_CHUNK,
  KB_DEFAULT_MIN_QUALITY,
  addKbTotals,
  chunkIds,
  cleanCursor,
  emptyKbTotals,
  kbBulkConfirm,
  kbBulkDecide,
  kbBulkSummary,
  kbScanText,
  sourceGroup,
  __runKbBulkReviewTests,
} from "@/lib/ai/kb/kb-bulk-review-core";
import { acceptAllEligible } from "@/lib/enrichment/ai-draft-v2-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("R-18: Bulk AI approve every draft (any confidence)", () => {
  const ALL = read("src/app/admin/products/bulk-ai/approve-all-actions.ts");
  const BAR = read("src/app/admin/products/bulk-ai/BulkApproveBar.tsx");
  const SRV = read("src/lib/enrichment/accept-drafts-server.ts");
  const PAGE = read("src/app/admin/products/bulk-ai/page.tsx");
  const DESC = read("src/app/admin/products/bulk-ai/AcceptAllDescriptions.tsx");

  it("threshold 0 takes every v2 draft but never a potency best guess", () => {
    const rows = [
      { id: "a", field_key: "description", status: "pending", confidence: 0.3, source: "ai2:pos", created_at: "2025-01-01" },
      { id: "b", field_key: "potency", status: "pending", confidence: 0.2, source: "ai2:pos|best-guess", created_at: "2025-01-01" },
      { id: "c", field_key: "effects", status: "pending", confidence: 0.1, source: "ai2:kb", created_at: "2025-01-01" },
    ];
    expect(acceptAllEligible(rows, 80)).toEqual([]);
    const zero = acceptAllEligible(rows, 0);
    expect(zero).toContain("a");
    expect(zero).toContain("c");
    expect(zero).not.toContain("b");
  });

  it("the server takes a clamped threshold and lists every pending key by page", () => {
    expect(SRV).toContain("threshold: number = ACCEPT_ALL_THRESHOLD");
    expect(SRV).toContain("Math.max(0, Math.min(100, Math.round(threshold)))");
    expect(SRV).toContain("export async function listPendingDraftKeys(");
    expect(SRV).toContain('.gt("id", cursor)');
  });

  it("the action needs products.enrich, threshold 0, compliance via the shared accept path, audited", () => {
    expect(ALL.match(/requirePermission\("products\.enrich"\)/g)?.length).toBe(2);
    expect(ALL).toContain("acceptHighConfidenceForKey(key, session.userId, 0)");
    expect(ALL).toContain('via: "bulk-approve-every"');
    expect(ALL).toContain("andPublish: false");
    expect(ALL).toContain("cleanApproveKeys(rawKeys, BULK_APPROVE_CHUNK)");
  });

  it("the bar has the every-draft button with confirm, chunks and Stop", () => {
    expect(BAR).toContain('data-testid="bulk-approve-every"');
    expect(BAR).toContain("listEveryPendingDraftKeyAction()");
    expect(BAR).toContain("approveEveryDraftChunkAction");
    expect(BAR).toContain('data-testid="bulk-approve-stop"');
    expect(BAR).toContain("if (!window.confirm(msg)) return;");
    expect(BAR).toContain("disabled={running}");
  });

  it("the older description drafts get Accept all", () => {
    expect(PAGE).toContain("<AcceptAllDescriptions ids={pendingDesc.map((s) => s.id)} />");
    expect(DESC).toContain('data-testid="accept-all-descriptions"');
    expect(DESC).toContain("disabled={running || ids.length === 0}");
    expect(DESC).toContain("chunkList(ids, BULK_APPROVE_IDS_CHUNK)");
  });
});

describe("R-19: KB publish every draft that passes", () => {
  const ACT = read("src/app/admin/knowledge-base/bulk-publish-actions.ts");
  const BAR = read("src/app/admin/knowledge-base/KbBulkPublishBar.tsx");
  const STORE = read("src/lib/ai/kb/store.ts");

  it("core self-tests", () => {
    const r = __runKbBulkReviewTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(17);
  });

  it("decides by source, name, quality and compliance", () => {
    const good = { id: "1", display_name: "Blue Dream 1g", category: "flower", aroma_notes: ["berry"], flavor_notes: ["sweet"], description: "Sweet berry.", sources: ["CCRS"], confidence: 0.9, source: "ccrs:x" };
    expect(kbBulkDecide(good, { minQuality: KB_DEFAULT_MIN_QUALITY, source: "all" }, true)).toEqual({ publish: true });
    expect(kbBulkDecide(good, { minQuality: 0, source: "all" }, false)).toEqual({ publish: false, reason: "compliance" });
    expect(kbBulkDecide(good, { minQuality: 0, source: "crawl" }, true)).toEqual({ publish: false, reason: "source" });
    expect(sourceGroup("ccrs:x")).toBe("ccrs");
    expect(kbScanText(good)).toContain("Sweet berry.");
  });

  it("20,000 drafts are 40 pages; updates go 100 ids at a time", () => {
    expect(KB_BULK_PAGE).toBe(500);
    expect(KB_BULK_UPDATE_CHUNK).toBe(100);
    expect(chunkIds(Array.from({ length: 500 }, (_, i) => i)).length).toBe(5);
    expect(cleanCursor("not-a-uuid")).toBe("");
  });

  it("messages", () => {
    const t = addKbTotals(emptyKbTotals(), { scanned: 500, published: 480, quality: 15, compliance: 5 });
    expect(kbBulkSummary(t, false)).toBe("Published 480 records into the KB (checked 500 drafts). Stayed drafts for you: 15 below the quality bar, 5 with a compliance flag.");
    expect(kbBulkConfirm(20000, 65, "all")).toContain("Up to 20,000 drafts");
  });

  it("the action: permission, compliance scan with banned phrases, draft-only update, audit, dry run default", () => {
    expect(ACT).toContain('requirePermission("products.enrich")');
    expect(ACT).toContain("checkCompliance(text, banned).blockingFlags.length === 0");
    expect(ACT).toContain("loadBannedPhrases()");
    expect(ACT).toContain('action: "kb.bulk.publish_passing"');
    expect(ACT).toContain("const dryRun = input?.dryRun !== false;");
    expect(STORE).toContain("export async function listKbDraftPage(");
    expect(STORE).toContain("export async function publishKbDraftIds(");
    expect(STORE).toMatch(/update\(\{ status: "published", active: true, updated_by: actorId \}\)\s*\.eq\("status", "draft"\)\s*\.in\("id", ids\)/);
  });

  it("the bar is on the pipeline and the review inbox, with Check first, confirm and Stop", () => {
    expect(BAR).toContain('data-testid="kb-bulk-check"');
    expect(BAR).toContain('data-testid="kb-bulk-publish"');
    expect(BAR).toContain('data-testid="kb-bulk-stop"');
    expect(BAR).toContain("window.confirm(kbBulkConfirm(drafts, minQuality, source))");
    expect(BAR).toContain("disabled={running || drafts === 0}");
    expect(read("src/app/admin/knowledge-base/pipeline/page.tsx")).toContain("<KbBulkPublishBar drafts={counts.draft} />");
    expect(read("src/app/admin/knowledge-base/review/page.tsx")).toContain("<KbBulkPublishBar drafts={draftCount} />");
  });

  it("docs: SOP-10 4.16, strategy rows, selftest registration, help", () => {
    const sop = read("docs/sop/SOP-10-product-enrichment.md");
    expect(sop).toContain("### 4.16 Knowledge Base: publish every draft that passes (D244 R-19)");
    expect(sop).toContain("6. **Every draft, any confidence (R-18).**");
    const strat = read("docs/sop-program/D244-enrichment-powerhouse-strategy.md");
    expect(strat).toMatch(/\| R-18 \| #\d+ \| merged \|/);
    expect(strat).toMatch(/\| R-19 \| #\d+ \| merged \|/);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("kb-bulk-review-core", __runKbBulkReviewTests(), 17)');
    expect(read("src/lib/admin/help-content.ts")).toContain("How do I approve thousands of KB drafts at once?");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("KB publish every draft that passes (D244 R-19");
  });
});
