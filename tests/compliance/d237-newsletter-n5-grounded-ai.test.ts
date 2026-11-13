/**
 * D237 N-5 (SOP-22 G-115; F-22-10, F-22-16): the grounded AI content engine,
 * "New post from…".
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations" — Q-22-8 (a) prices and dates only in Sale/Vendor-day posts,
 * from the promotion, with the below-cost check; Q-22-9 (a) vendor claims only
 * with a source link, no AI superlatives.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runPostTemplatesCoreTests,
  POST_TEMPLATES,
  checkDraft,
  getTemplate,
  templateItems,
  type PostDraft,
} from "@/lib/cms/post-templates-core";
import type { ThisWeekFeed } from "@/lib/cms/this-week-feed-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const feed: ThisWeekFeed = {
  fromDay: "2026-11-05",
  toDay: "2026-11-11",
  newVendors: [],
  freshDrops: [],
  freshLotCount: 0,
  runningNow: [
    { id: "ok", title: "Flower Friday", when: "Fridays", offer: "20% off", bonusNote: null, markdown: false, belowCost: 0 },
    { id: "bad", title: "Too Deep", when: "Fridays", offer: "60% off", bonusNote: null, markdown: false, belowCost: 4 },
  ],
  comingUp: [],
  vendorDays: [],
  calendar: [],
};

describe("D237 N-5 grounded AI content engine", () => {
  it("pure core self-tests all pass", () => {
    const r = __runPostTemplatesCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });

  it("has the seven templates; only Sale and Vendor day may state prices", () => {
    expect(POST_TEMPLATES.map((t) => t.key)).toEqual([
      "new-vendor",
      "fresh-drops",
      "review-spotlight",
      "sale",
      "vendor-day",
      "holiday",
      "culture",
    ]);
    expect(POST_TEMPLATES.filter((t) => t.allowsPrice).map((t) => t.key)).toEqual(["sale", "vendor-day"]);
    expect(getTemplate("culture")?.category).toBe("CULTURE");
  });

  it("a below-cost deal is held back, never offered to the AI (Q-22-8)", () => {
    const r = templateItems("sale", feed);
    expect(r.items.map((i) => i.id)).toEqual(["deal:ok"]);
    expect(r.held[0]?.label).toBe("Too Deep");
  });

  it("superlatives and invented amounts are must-fix (Q-22-8, Q-22-9)", () => {
    const item = templateItems("sale", feed).items[0]!;
    const d: PostDraft = { headlines: ["The best deal in town"], excerpt: "Take 30% off.", sections: [{ heading: "Hi", paragraphs: ["x"] }], cta: "" };
    const issues = checkDraft(getTemplate("sale")!, item, d);
    expect(issues.filter((i) => i.level === "must-fix").map((i) => i.text).join(" ")).toMatch(/best.*30%|30%.*best|Superlatives[\s\S]*30%/);
  });

  it("server re-reads the facts and checks again on save (drafts only, audited)", () => {
    const srv = read("src/lib/cms/post-templates-server.ts");
    expect(srv).toContain('import "server-only"');
    expect(srv).toContain("getThisWeekFeed({ withBelowCost: true })");
    expect(srv).toContain("checkCompliance(draftText(draft))");
    const act = read("src/app/admin/blog/actions.ts");
    expect(act).toContain('action: "blog.ai.template_draft"');
    expect(act).toMatch(/final\.blocking\.length > 0/);
    expect(act).toContain("fromTemplate: final.t.key");
    // createPost always makes a draft.
    expect(read("src/lib/cms/blog-store.ts")).toContain('status: "draft" as PostStatus');
  });

  it("the picker is on New post and shows flags at draft time (F-22-16)", () => {
    const page = read("src/app/admin/blog/new/page.tsx");
    expect(page).toContain("<NewPostFromPicker aiEnabled={isAiConfigured} />");
    const ui = read("src/components/admin/blog/NewPostFromPicker.tsx");
    expect(ui).toContain("result.complianceFlags.map");
    expect(ui).toContain("result.pictures.map");
    expect(read("src/components/admin/blog/ThisWeekFeedCard.tsx")).toContain('href="/admin/blog/new#from"');
  });
});
