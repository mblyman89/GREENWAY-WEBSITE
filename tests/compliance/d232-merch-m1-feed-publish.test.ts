/**
 * D232 slice M-1 (SOP-11): the shop's catalog feed reaches the back office
 * (F-11-1 / G-76), stale copy is gone (G-91), and Publish to greenwaymerch.com
 * is owner/admin only (Q-11-1, Michael verbatim: "Q1: owner/admin.").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_LABELS, can } from "@/lib/auth/roles";
import { __runFeedCoreTests, describeFeedAnswer, feedUrl, MAIN_SITE_ORIGIN } from "../../merch-site/lib/feed-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-1: the feed address (F-11-1)", () => {
  it("defaults to www and moves a bare host to www", () => {
    expect(MAIN_SITE_ORIGIN).toBe("https://www.greenwaymarijuana.com");
    expect(feedUrl("", "/api/merch-catalog")).toBe("https://www.greenwaymarijuana.com/api/merch-catalog");
    expect(feedUrl("https://greenwaymarijuana.com/api/merch-catalog", "/x")).toBe("https://www.greenwaymarijuana.com/api/merch-catalog");
  });
  it("a redirect is reported with the fix, never followed", () => {
    const r = describeFeedAnswer(308, "https://www.greenwaymarijuana.com/api/merch-catalog");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.problem).toContain("MERCH_CATALOG_URL");
    const cat = read("merch-site/lib/catalog.ts");
    expect(cat).toContain('redirect: "manual"');
    expect(cat).toContain("feedUrl(process.env.MERCH_CATALOG_URL");
    expect(cat).toContain("export const lastFeedStatus");
    const content = read("merch-site/lib/site-content.ts");
    expect(content).toContain('redirect: "manual"');
    expect(content).toContain("feedUrl(process.env.MERCH_CONTENT_URL");
  });
  it("no merch-site code builds a feed address from the bare domain any more", () => {
    expect(read("merch-site/lib/site.ts")).not.toContain('"https://greenwaymarijuana.com"');
  });
  it("the merch-site pure self-test passes and is in the runner", () => {
    expect(__runFeedCoreTests().failed).toBe(0);
    expect(read("merch-site/scripts/selftest.ts")).toContain("__runFeedCoreTests");
  });
});

describe("D232 M-1: Publish is owner/admin (Q-11-1)", () => {
  it("merch.publish is owner and admin only, listed and labelled", () => {
    expect(can("owner", "merch.publish")).toBe(true);
    expect(can("admin", "merch.publish")).toBe(true);
    for (const r of ["manager", "content_editor", "staff", "readonly"] as const) expect(can(r, "merch.publish")).toBe(false);
    expect(ALL_PERMISSIONS.filter((p) => p === "merch.publish")).toHaveLength(1);
    expect(PERMISSION_LABELS["merch.publish"]).toContain("owner & admin");
  });
  it("both publish server actions require merch.publish (not content.edit)", () => {
    const src = read("src/app/admin/merch-studio/catalog-actions.ts");
    expect(src.match(/requirePermission\("merch\.publish"\)/g)).toHaveLength(2);
    expect(src).not.toContain('requirePermission("content.edit")');
  });
  it("the button is disabled with a reason for everyone else", () => {
    const ui = read("src/components/admin/merch-studio/PublishPanel.tsx");
    expect(ui).toContain("disabled={!canPublish ||");
    expect(ui).toContain("Only the owner or an admin can publish");
    expect(read("src/app/admin/merch-studio/page.tsx")).toContain('can(session.profile.role, "merch.publish")');
  });
});

describe("D232 M-1: stale copy (G-91)", () => {
  it("the old Slice 5 and catalog-folder promises are gone from the studio", () => {
    expect(read("src/lib/merch-studio/fulfillment-core.ts")).not.toContain("drop it in merch-site/catalog/");
    expect(read("src/components/admin/merch-studio/DesignStudio.tsx")).not.toContain("Slice 5");
    expect(read("src/components/admin/merch-studio/FulfillmentPanel.tsx")).not.toContain("Slice 5");
    expect(read("docs/MERCH-SITE-FINISHING-GUIDE.md")).not.toContain("**don't add**");
  });
});
