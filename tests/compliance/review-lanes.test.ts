/**
 * tests/compliance/review-lanes.test.ts — Slice H5 (review economics).
 *
 * Pins the PURE lane-routing rules in src/lib/kb/review-lanes-core.ts. These
 * rules are load-bearing for the drafts-only lifecycle:
 *
 *  • reference fields (research_*) must NEVER route to a writable lane —
 *    they can't be accepted into a profile column;
 *  • prospect drafts (entity_id "lead:<id>") must NEVER be writable until
 *    the lead is promoted to a real vendor row;
 *  • the FAST lane (per-vendor batch-accept) must exclude anything with a
 *    blocking compliance flag, low confidence, or thin text — batch-accept
 *    without those bars would bulk-publish junk or WAC-violating copy;
 *  • unknown/unexpected field keys must fail CLOSED (reference, read-only);
 *  • newest-per-field dedupe must keep exactly one primary draft per
 *    (entity_type, entity_id, field_key) — the newest — so batch-accept can
 *    never double-write a field.
 */
import { describe, it, expect } from "vitest";
import {
  ACCEPTABLE_FIELDS,
  REFERENCE_FIELDS,
  FAST_LANE_MIN_CHARS,
  FAST_LANE_MIN_CONFIDENCE,
  classifyLane,
  groupByVendor,
  isProspectTarget,
  newestPerField,
  type LaneSuggestionInput,
  type ReviewLane,
} from "@/lib/kb/review-lanes-core";

const LONG = "x".repeat(FAST_LANE_MIN_CHARS); // exactly at the non-thin bar

function draft(over: Partial<LaneSuggestionInput> & { id: string }): LaneSuggestionInput {
  return {
    entity_type: "vendor",
    entity_id: "v1",
    field_key: "about",
    suggested_value: LONG,
    confidence: 0.9,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// classifyLane — the routing matrix
// ---------------------------------------------------------------------------
describe("classifyLane — writable fields per entity type", () => {
  it("mirrors the accept actions: vendor about/mission, brand +product_philosophy", () => {
    expect([...ACCEPTABLE_FIELDS.vendor].sort()).toEqual(["about", "mission_statement"]);
    expect([...ACCEPTABLE_FIELDS.brand].sort()).toEqual([
      "about",
      "mission_statement",
      "product_philosophy",
    ]);
  });

  it("routes a clean, confident, non-thin writable draft to the fast lane", () => {
    expect(classifyLane(draft({ id: "a" }))).toBe("fast");
    expect(
      classifyLane(draft({ id: "b", entity_type: "brand", field_key: "product_philosophy" })),
    ).toBe("fast");
  });
});

describe("classifyLane — reference fields are never writable", () => {
  it.each([...REFERENCE_FIELDS])("%s → reference even at confidence 1.0", (key) => {
    expect(classifyLane(draft({ id: "r", field_key: key, confidence: 1.0 }))).toBe("reference");
  });

  it("product_philosophy on a VENDOR draft is not writable (fails closed)", () => {
    // Vendors have no product_philosophy column — brand-only field.
    expect(classifyLane(draft({ id: "x", field_key: "product_philosophy" }))).toBe("reference");
  });

  it("unknown field keys fail CLOSED to reference", () => {
    expect(classifyLane(draft({ id: "u", field_key: "totally_new_field" }))).toBe("reference");
  });

  it("unknown entity types fail CLOSED to reference", () => {
    expect(classifyLane(draft({ id: "e", entity_type: "product" }))).toBe("reference");
  });
});

describe("classifyLane — prospect drafts are dark inventory", () => {
  it("lead:<id> targets route to prospect regardless of field or confidence", () => {
    expect(isProspectTarget("lead:abc")).toBe(true);
    expect(isProspectTarget("v1")).toBe(false);
    expect(classifyLane(draft({ id: "p", entity_id: "lead:abc", confidence: 1.0 }))).toBe(
      "prospect",
    );
    // even reference fields on a lead stay in the prospect lane
    expect(
      classifyLane(draft({ id: "p2", entity_id: "lead:abc", field_key: "research_images" })),
    ).toBe("prospect");
  });
});

describe("classifyLane — fast-lane bars (batch-accept safety)", () => {
  it("blocking compliance flags demote to standard", () => {
    expect(classifyLane(draft({ id: "c" }), { hasBlockingFlags: true })).toBe("standard");
  });

  it("confidence below the bar demotes to standard", () => {
    expect(
      classifyLane(draft({ id: "lc", confidence: FAST_LANE_MIN_CONFIDENCE - 0.01 })),
    ).toBe("standard");
    expect(classifyLane(draft({ id: "nc", confidence: null }))).toBe("standard");
    expect(classifyLane(draft({ id: "uc", confidence: undefined }))).toBe("standard");
  });

  it("confidence exactly at the bar qualifies", () => {
    expect(classifyLane(draft({ id: "eq", confidence: FAST_LANE_MIN_CONFIDENCE }))).toBe("fast");
  });

  it("thin text demotes to standard (whitespace doesn't count)", () => {
    expect(classifyLane(draft({ id: "t", suggested_value: "short" }))).toBe("standard");
    expect(
      classifyLane(draft({ id: "w", suggested_value: `  ${"x".repeat(FAST_LANE_MIN_CHARS - 1)}  ` })),
    ).toBe("standard");
    expect(classifyLane(draft({ id: "n", suggested_value: null }))).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// newestPerField — re-harvest dedupe
// ---------------------------------------------------------------------------
describe("newestPerField — one primary draft per (entity, field)", () => {
  it("keeps the newest and supersedes the rest", () => {
    const older = draft({ id: "old", created_at: "2026-01-01T00:00:00Z" });
    const newer = draft({ id: "new", created_at: "2026-02-01T00:00:00Z" });
    const oldest = draft({ id: "oldest", created_at: "2025-12-01T00:00:00Z" });
    const { primary, superseded } = newestPerField([older, newer, oldest]);
    expect(primary.map((s) => s.id)).toEqual(["new"]);
    expect(superseded.map((s) => s.id).sort()).toEqual(["old", "oldest"]);
  });

  it("different fields / entities / types never supersede each other", () => {
    const a = draft({ id: "a", field_key: "about" });
    const b = draft({ id: "b", field_key: "mission_statement" });
    const c = draft({ id: "c", entity_id: "v2" });
    const d = draft({ id: "d", entity_type: "brand" });
    const { primary, superseded } = newestPerField([a, b, c, d]);
    expect(primary).toHaveLength(4);
    expect(superseded).toHaveLength(0);
  });

  it("is deterministic for identical timestamps (keeps exactly one)", () => {
    const a = draft({ id: "a" });
    const b = draft({ id: "b" });
    const { primary, superseded } = newestPerField([a, b]);
    expect(primary).toHaveLength(1);
    expect(superseded).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// groupByVendor — vendor-grouped review
// ---------------------------------------------------------------------------
describe("groupByVendor — brand drafts roll up to the parent vendor", () => {
  const laneOf = (s: LaneSuggestionInput): ReviewLane => classifyLane(s);

  it("groups vendor + brand drafts under one vendor key", () => {
    const vd = draft({ id: "v", entity_id: "vendor-1" });
    const bd = draft({ id: "b", entity_type: "brand", entity_id: "brand-1" });
    const groups = groupByVendor([vd, bd], new Map([["brand-1", "vendor-1"]]), laneOf);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendorKey).toBe("vendor-1");
    expect(groups[0].fast.map((s) => s.id).sort()).toEqual(["b", "v"]);
  });

  it("unlinked brands fall into the 'unknown' group, never a wrong vendor", () => {
    const bd = draft({ id: "b", entity_type: "brand", entity_id: "brand-orphan" });
    const groups = groupByVendor([bd], new Map(), laneOf);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendorKey).toBe("unknown");
  });

  it("prospect drafts group by their lead key", () => {
    const p = draft({ id: "p", entity_id: "lead:abc" });
    const groups = groupByVendor([p], new Map(), laneOf);
    expect(groups[0].vendorKey).toBe("lead:abc");
    expect(groups[0].prospect.map((s) => s.id)).toEqual(["p"]);
  });

  it("sorts biggest fast lane first (one-click wins on top)", () => {
    const smallFast = [draft({ id: "s1", entity_id: "vendor-small" })];
    const bigFast = [
      draft({ id: "b1", entity_id: "vendor-big" }),
      draft({ id: "b2", entity_id: "vendor-big", field_key: "mission_statement" }),
    ];
    const groups = groupByVendor([...smallFast, ...bigFast], new Map(), laneOf);
    expect(groups.map((g) => g.vendorKey)).toEqual(["vendor-big", "vendor-small"]);
  });
});
