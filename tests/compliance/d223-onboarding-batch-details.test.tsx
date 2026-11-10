/**
 * tests/compliance/d223-onboarding-batch-details.test.tsx  (D223)
 *
 * Owner (verbatim, abridged): "The ai batch lookup shows multiple facts, but
 * when I expand it, it only shows me the lookup bar again, and not all the
 * facts it found. After a batch lookup, I want to be able to expand that box
 * and see everything it found for that product ... shown to me like how the
 * single lookup shows facts. I can pick and choose which to use and such."
 *
 * Root causes pinned here:
 *   1. The row panel's findings came only from the delivery's NEWEST job. A
 *      product that job skipped (looked up earlier, or under a sibling lot of
 *      the same product) opened on just the search bar, although the green box
 *      listed facts filed under the product. -> routeSnapshots over every
 *      finished item the history read already holds (own row first, else the
 *      same product), newest wins.
 *   2. While a batch runs, the page auto-refreshes; useState read only the
 *      first (empty) render, so the button said "batch found N facts" but the
 *      panel held nothing. -> initialKey + adoptBatchFindings swap the
 *      findings in (never over the person's own search or typed edits).
 *   3. No way from the green box to the full worksheet. -> "See all N facts
 *      the lookup found" link to the row's AI Lookup (opens it).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  __runLookupSnapshotCoreTests,
  adoptBatchFindings,
  aiLookupAnchorId,
  buildLookupSnapshot,
  parseLookupSnapshot,
  routeSnapshots,
  seeFindingsLabel,
  snapshotKey,
} from "@/lib/catalog/lookup-snapshot-core";
import { WaitingFactsPanel } from "@/components/admin/catalog/WaitingFactsPanel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const base = {
  result: {
    found: true, confidence: 88, hasAnyFindings: true, strainType: "hybrid", strainTypeConfidence: 92, autofillStrainType: true,
    summary: "Citrus.", effects: ["relaxed"], rejectedEffects: [], aromaNotes: ["citrus"], flavorNotes: [], lineage: "A x B",
    terpenes: ["myrcene"], hasKbDraft: true, description: "Bright.", shortDescription: "Bright.", category: "flower",
    potencyRatio: "", size: "3.5g", imageCandidates: [], hasEnrichmentDraft: false,
  },
  sources: ["https://brand.example/p"],
  model: "gemini",
  usedWebSearch: true,
  facts: null,
  schema: "v1",
};
const snapAt = (at: string) => buildLookupSnapshot({ ...base, at });

describe("D223 pure core", () => {
  it("self-tests pass at the raised floor", () => {
    const r = __runLookupSnapshotCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(74);
  });

  it("a row the newest job skipped still opens on the same product's findings", () => {
    const m = routeSnapshots({
      targets: [{ draftId: "row-1", keys: ["v|flower|gelato"] }],
      siblings: [{ id: "lot-on-old-delivery", identity_key: "v|flower|gelato" }],
      items: [{ draft_id: "lot-on-old-delivery", status: "done", result_json: { snapshot: snapAt("2026-11-01T00:00:00Z") }, finished_at: "2026-11-01T00:00:00Z" }],
      nowMs: Date.parse("2026-11-10T00:00:00Z"),
    });
    expect(m.get("row-1")?.where).toBe("same product");
    expect(m.get("row-1")?.snap.category).toBe("flower");
  });

  it("auto-refresh swaps new findings in, but never over the person's own work", () => {
    const k = snapshotKey(parseLookupSnapshot(snapAt("2026-11-01T00:00:00Z")));
    expect(adoptBatchFindings({ prevKey: "", nextKey: k, ranOwnSearch: false, editedWorksheet: false })).toBe(true);
    expect(adoptBatchFindings({ prevKey: "", nextKey: k, ranOwnSearch: true, editedWorksheet: false })).toBe(false);
  });
});

describe("D223 green box link", () => {
  const snap = parseLookupSnapshot(snapAt("2026-11-01T00:00:00Z"))!;
  const label = seeFindingsLabel(snap)!;
  const html = renderToStaticMarkup(
    createElement(WaitingFactsPanel, {
      draftId: "d1",
      view: { facts: [], emptyLine: "Nothing waiting." } as never,
      action: async () => {},
      returnManifest: null,
      returnStatus: "draft",
      seeAll: { label, href: `#${aiLookupAnchorId("d1")}` },
    }),
  );
  it("renders a plain link to the row's AI Lookup", () => {
    expect(label).toMatch(/^See all \d+ facts the lookup found$/);
    expect(html).toContain('data-testid="waiting-facts-see-all"');
    expect(html).toContain('href="#ai-lookup-d1"');
  });
  it("no link when nothing was stored", () => {
    const none = renderToStaticMarkup(
      createElement(WaitingFactsPanel, { draftId: "d1", view: { facts: [], emptyLine: "x" } as never, action: async () => {}, returnManifest: null, returnStatus: "draft" }),
    );
    expect(none).not.toContain("waiting-facts-see-all");
  });
});

describe("D223 wiring locks", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const panel = read("src/app/admin/inventory/drafts/AiLookupPanel.tsx");
  const hist = read("src/lib/catalog/lookup-history-server.ts");

  it("history read routes snapshots from rows it already reads (no new query)", () => {
    expect(hist).toContain("routeSnapshots({ targets: usable, siblings: siblings.rows, items: items.rows");
    expect(hist).not.toMatch(/select\(\s*["'`]\*["'`]\s*\)/);
  });
  it("page uses the newest of this job's and the history's findings, and passes the key + link", () => {
    expect(page).toMatch(/const batchSnap = newerSnapshot\(jobSnap, pastSnap\?\.snap \?\? null\)/);
    expect(page).toContain("initialKey={snapshotKey(batchSnap)}");
    expect(page).toContain("seeAll={seeFindingsLabel(batchSnap)");
    expect(page).toContain("snapshotNote(batchSnap, snapshotWhen(batchSnap.at), batchSnapWhere)");
  });
  it("panel adopts new findings on refresh, opens from the link, and a search marks own work", () => {
    expect(panel).toContain("adoptBatchFindings({ prevKey: shownKey, nextKey: initialKey, ranOwnSearch, editedWorksheet: edited })");
    expect(panel).toContain("id={anchorId}");
    expect(panel).toContain("setRanOwnSearch(true)");
    expect(panel).toContain("setEdited(true)");
  });
});
