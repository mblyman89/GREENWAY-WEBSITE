/**
 * tests/compliance/r23-finalize-banner.test.ts  (Round 23, fix 1)
 *
 * Owner (verbatim): "on the receiving page in the manifest details to accept
 * products, after finalizing a manifest, there is a red error warning that
 * looks very intimidating and makes it seem like the manifest was rejected
 * when it was really accepted ... there is a green success bar, then red
 * error bar under it, then another green success bar under it."
 *
 * Root cause (verified): finalize ALWAYS redirects with `rejected=<n>`, and
 * the page lit its red "whole manifest rejected" bar on the truthy STRING
 * "0". finalize-banner-core tells the flows apart by `finalized`, and the
 * page renders exactly ONE banner from it, never red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { finalizeBanner, parseCount, __runFinalizeBannerCoreTests } from "@/lib/inventory/finalize-banner-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("R23 fix 1 - finalize-banner-core", () => {
  it("runs exactly 38 assertions, none failing, registered at that floor", () => {
    const r = __runFinalizeBannerCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(38);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("finalize-banner-core", __runFinalizeBannerCoreTests(), 38);');
  });

  it("THE BUG: a clean finalize (rejected=0) is ONE green banner, never a whole-manifest reject", () => {
    const b = finalizeBanner({ finalized: "accepted", accepted: "12", rejected: "0", drafts: "3", held: "0" })!;
    expect(b.kind).toBe("finalized");
    expect(b.tone).toBe("green");
    expect(b.headline).toBe("Delivery accepted \u2014 12 lots activated and on hand.");
    expect(b.details).toEqual([]);
    expect(b.drafts).toBe(3);
    expect(b.held).toBe(0);
  });

  it("refused lines and held lots become calm sub-lines, pluralised", () => {
    const b = finalizeBanner({ finalized: "partially_accepted", accepted: "1", rejected: "2", held: "1" })!;
    expect(b.tone).toBe("gold");
    expect(b.headline).toContain("1 lot activated");
    expect(b.details).toHaveLength(2);
    expect(b.details[0]).toMatch(/^2 lines were refused at the dock/);
    expect(b.details[0]).toContain("not an error");
    expect(b.details[1]).toMatch(/^1 lot is held in quarantine/);
    const one = finalizeBanner({ finalized: "accepted", accepted: "1", rejected: "1" })!;
    expect(one.details[0]).toMatch(/^1 line was refused/);
  });

  it("finalized with nothing accepted is neutral, and says no bill was raised", () => {
    const b = finalizeBanner({ finalized: "rejected", accepted: "0", rejected: "4" })!;
    expect(b.tone).toBe("neutral");
    expect(b.headline).toContain("no vendor bill was raised");
  });

  it("an unknown finalized status still never claims a reject", () => {
    const b = finalizeBanner({ finalized: "weird", accepted: "2", rejected: "0" })!;
    expect(b.kind).toBe("finalized");
    expect(b.tone).toBe("neutral");
  });

  it("the REAL whole-manifest reject (no finalized) is told apart - neutral, not red", () => {
    const b = finalizeBanner({ rejected: "1" })!;
    expect(b.kind).toBe("whole_reject");
    expect(b.tone).toBe("neutral");
    expect(finalizeBanner({ rejected: "0" })).toBeNull();
    expect(finalizeBanner({ finalized: "  ", rejected: "0" })).toBeNull();
  });

  it("accept-only (no finalized) is green; nothing at all is null", () => {
    expect(finalizeBanner({ accepted: "2" })?.kind).toBe("accepted_only");
    expect(finalizeBanner({ accepted: "2" })?.tone).toBe("green");
    expect(finalizeBanner({})).toBeNull();
  });

  it("parseCount: only plain digits count; garbage and negatives are 0", () => {
    expect(parseCount("7")).toBe(7);
    expect(parseCount(" 7 ")).toBe(7);
    for (const v of [undefined, "", "-1", "1e3", "abc", "1.5", "9999999999"]) expect(parseCount(v), String(v)).toBe(0);
  });

  it("the page renders ONE banner from the core, with no danger tone", () => {
    const page = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(page).toContain("const finalBanner = finalizeBanner({ finalized, accepted, rejected, drafts, held });");
    expect(page.match(/data-finalize-banner=/g)?.length).toBe(1);
    const block = page.slice(page.indexOf("{finalBanner && ("), page.indexOf("{finalBanner && (") + 2000);
    expect(block).not.toContain("admin-danger");
    // The old raw-string banners are gone (they keyed on the truthy string "0").
    expect(page).not.toMatch(/\{rejected && \(/);
    expect(page).not.toMatch(/\{finalized && \(/);
  });
});
