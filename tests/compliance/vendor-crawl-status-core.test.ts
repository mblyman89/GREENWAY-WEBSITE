/**
 * tests/compliance/vendor-crawl-status-core.test.ts
 *
 * SLICE 89 — seamless hub ↔ vendor flow. Pure logic behind the vendor page's
 * live crawl-status chip and the Harvest Console's light-up back-to-vendor
 * buttons (src/lib/kb/vendor-crawl-status-core.ts).
 */
import { describe, expect, it } from "vitest";
import {
  chipGlowFor,
  jobTouchesVendor,
  latestJobForVendor,
  summarizeVendorCrawl,
  targetVendorId,
  vendorTarget,
  type CrawlJob,
  type CrawlTarget,
} from "@/lib/kb/vendor-crawl-status-core";

const V1 = "11111111-1111-1111-1111-111111111111";
const V2 = "22222222-2222-2222-2222-222222222222";

function target(over: Partial<CrawlTarget> = {}): CrawlTarget {
  return {
    url: "https://farm.example.com/",
    entity_type: "vendor",
    entity_id: V1,
    display_name: "Farm Example",
    status: "pending",
    pages: 0,
    drafts_written: 0,
    error: "",
    ...over,
  };
}

function job(over: Partial<CrawlJob> = {}): CrawlJob {
  return {
    id: "job-1",
    label: "Vendor research: Farm Example",
    status: "running",
    created_at: 1_700_000_000,
    targets: [target()],
    ...over,
  };
}

describe("targetVendorId", () => {
  it("vendor with a plain id → the id", () => {
    expect(targetVendorId(target())).toBe(V1);
  });

  it("brands, leads and blanks have no vendor page", () => {
    expect(targetVendorId(target({ entity_type: "brand" }))).toBeNull();
    expect(targetVendorId(target({ entity_id: "lead:acme" }))).toBeNull();
    expect(targetVendorId(target({ entity_id: "  " }))).toBeNull();
    expect(targetVendorId({})).toBeNull();
  });
});

describe("chipGlowFor — the light-up lifecycle", () => {
  it("pending → waiting (dim)", () => {
    expect(chipGlowFor(target({ status: "pending" }))).toBe("waiting");
  });
  it("running → running (pulsing)", () => {
    expect(chipGlowFor(target({ status: "running" }))).toBe("running");
  });
  it("done → lit (the button lights up)", () => {
    expect(chipGlowFor(target({ status: "done" }))).toBe("lit");
  });
  it("failed → failed (red, still clickable)", () => {
    expect(chipGlowFor(target({ status: "failed" }))).toBe("failed");
  });
});

describe("latestJobForVendor", () => {
  it("null when no job targets the vendor", () => {
    expect(latestJobForVendor([job({ targets: [target({ entity_id: V2 })] })], V1)).toBeNull();
    expect(jobTouchesVendor(job(), V2)).toBe(false);
  });

  it("newest job wins", () => {
    const older = job({ id: "old", status: "completed", created_at: 100 });
    const newer = job({ id: "new", status: "completed", created_at: 200 });
    expect(latestJobForVendor([older, newer], V1)?.id).toBe("new");
  });

  it("an ACTIVE job beats a newer finished one (a just-started re-crawl replaces last week's banner)", () => {
    const finished = job({ id: "done", status: "completed", created_at: 300 });
    const active = job({ id: "live", status: "queued", created_at: 200 });
    expect(latestJobForVendor([finished, active], V1)?.id).toBe("live");
  });

  it("vendorTarget finds this vendor's row among many", () => {
    const j = job({ targets: [target({ entity_id: V2 }), target({ pages: 7 })] });
    expect(vendorTarget(j, V1)?.pages).toBe(7);
  });
});

describe("summarizeVendorCrawl — the vendor-page chip", () => {
  it("null when the vendor has never been crawled (chip renders nothing)", () => {
    expect(summarizeVendorCrawl([], V1)).toBeNull();
    expect(summarizeVendorCrawl([job({ targets: [target({ entity_id: V2 })] })], V1)).toBeNull();
  });

  it("queued → waiting message, keeps polling fast", () => {
    const s = summarizeVendorCrawl([job({ status: "queued" })], V1)!;
    expect(s.glow).toBe("waiting");
    expect(s.message).toContain("queued");
    expect(s.active).toBe(true);
  });

  it("running → live page count, keeps polling fast", () => {
    const s = summarizeVendorCrawl(
      [job({ targets: [target({ status: "running", pages: 12 })] })],
      V1,
    )!;
    expect(s.glow).toBe("running");
    expect(s.message).toContain("12 pages so far");
    expect(s.active).toBe(true);
  });

  it("done → LIT with the draft count, polling stops", () => {
    const s = summarizeVendorCrawl(
      [job({ status: "completed", targets: [target({ status: "done", pages: 25, drafts_written: 6 })] })],
      V1,
    )!;
    expect(s.glow).toBe("lit");
    expect(s.message).toContain("6 drafts ready below");
    expect(s.message).toContain("25 pages read");
    expect(s.active).toBe(false);
  });

  it("done with zero drafts is honest about it", () => {
    const s = summarizeVendorCrawl(
      [job({ status: "completed", targets: [target({ status: "done", pages: 3 })] })],
      V1,
    )!;
    expect(s.message).toContain("no new drafts");
  });

  it("done target inside a still-running batch job is LIT and stops polling for THIS vendor", () => {
    const s = summarizeVendorCrawl(
      [job({ status: "running", targets: [target({ status: "done", pages: 9, drafts_written: 2 }), target({ entity_id: V2, status: "running" })] })],
      V1,
    )!;
    expect(s.glow).toBe("lit");
    expect(s.active).toBe(false);
  });

  it("failed → plain-English error, polling stops", () => {
    const s = summarizeVendorCrawl(
      [job({ status: "completed", targets: [target({ status: "failed", error: "robots.txt disallows" })] })],
      V1,
    )!;
    expect(s.glow).toBe("failed");
    expect(s.message).toContain("robots.txt disallows");
    expect(s.active).toBe(false);
  });

  it("failed with a blank error still explains itself", () => {
    const s = summarizeVendorCrawl(
      [job({ targets: [target({ status: "failed", error: "  " })] })],
      V1,
    )!;
    expect(s.message).toContain("site unreachable");
  });

  it("singular grammar: 1 page / 1 draft", () => {
    const s = summarizeVendorCrawl(
      [job({ status: "completed", targets: [target({ status: "done", pages: 1, drafts_written: 1 })] })],
      V1,
    )!;
    expect(s.message).toContain("1 draft ready below");
    expect(s.message).toContain("1 page read");
  });
});
