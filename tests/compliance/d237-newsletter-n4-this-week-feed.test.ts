/**
 * D237 N-4 (SOP-22 G-114, F-22-11): the "This week at Greenway" facts feed.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runThisWeekFeedCoreTests,
  buildThisWeekFeed,
  feedFactLines,
  offerText,
  parseLocalEventsText,
} from "@/lib/cms/this-week-feed-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D237 N-4 this-week facts feed", () => {
  it("pure core self-tests all pass", () => {
    const r = __runThisWeekFeedCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(44);
  });

  it("deal wording comes from the promotion row (Q-22-8), in integer cents", () => {
    expect(offerText({ discount_type: "fixed", discount_percent: 0, discount_fixed: 1250 })).toBe("$12.50 off");
    expect(offerText({ discount_type: "percent", discount_percent: 25, discount_fixed: 0 })).toBe("25% off");
  });

  it("a deal with below-cost items never reaches the AI facts", () => {
    const feed = buildThisWeekFeed({
      nowIso: "2026-11-11T20:00:00.000Z",
      vendors: [],
      lots: [],
      promotions: [
        { id: "x", title: "Risky", status: "published", weekday: 3, starts_at: null, ends_at: null, discount_type: "percent", discount_percent: 40, discount_fixed: 0, bonus_note: null, markdown_only: false },
      ],
      belowCost: { x: 3 },
    });
    expect(feed.runningNow[0].belowCost).toBe(3);
    expect(feedFactLines(feed).join("\n")).not.toContain("Risky");
  });

  it("local events box parses one-day and every-year lines", () => {
    const ev = parseLocalEventsText("2026-12-05 Tree lighting\n07-04 Fathoms O' Fun\nnot an event");
    expect(ev).toEqual([
      { date: "2026-12-05", name: "Tree lighting" },
      { date: "07-04", name: "Fathoms O' Fun" },
    ]);
  });

  it("server reader is bounded and paged (no .limit(>=1000))", () => {
    const s = read("src/lib/cms/this-week-feed-server.ts");
    expect(s).toContain("pagedAllChecked");
    expect(s).toContain("MAX_FEED_LOTS");
    expect(s).toContain('.order("id", { ascending: true })');
    expect(s).not.toMatch(/\.limit\(\d{4,}\)/);
    expect(s).toContain("auditPublishedPromotions");
  });

  it("the card is on Blog & Newsletter and the events save is audited", () => {
    const page = read("src/app/admin/blog/page.tsx");
    expect(page).toContain("<ThisWeekFeedCard");
    expect(page).toContain("getThisWeekFeed()");
    const a = read("src/app/admin/blog/actions.ts");
    expect(a).toContain("saveBlogLocalEventsAction");
    expect(a).toContain('"blog.local_events_save"');
  });
});
