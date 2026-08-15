/**
 * tests/compliance/competitor-roster-core.test.ts
 *
 * Adversarial coverage for the owner-managed competitor roster guard layer.
 *
 * The owner asked to maintain this roster himself instead of editing SQL. That
 * means untrusted human input now reaches a table that DRIVES every benchmark:
 * a bad license number attaches a rival's sales to the wrong store, a second
 * "self" row makes every us-vs-them number ambiguous, and a producer/processor
 * mislabelled as a retailer silently corrupts retail price medians.
 *
 * So these tests attack the validator rather than confirm it. NEVER GUESS:
 * every case asserts that unverifiable input is REJECTED, not repaired.
 */
import { describe, it, expect } from "vitest";

import {
  COMPETITOR_AREAS,
  COMPETITOR_KINDS,
  MAX_NOTE_LEN,
  MAX_TRADENAME_LEN,
  normalizeLicenseNumber,
  parseFormBool,
  retailRoster,
  rowKind,
  summarizeRoster,
  supplyRoster,
  tidy,
  trackedLicenses,
  validateRosterUpsert,
  type RosterRowLike,
} from "@/lib/discovery/competitor-roster-core";

// ---------------------------------------------------------------------------
// License numbers - the single most dangerous field on the form
// ---------------------------------------------------------------------------
describe("normalizeLicenseNumber", () => {
  it("accepts a plain 6-digit license", () => {
    expect(normalizeLicenseNumber("413541")).toBe("413541");
  });

  it("PRESERVES leading zeros (verified real case: 081400 GREEN TIKI)", () => {
    // The seeded roster in 0080 contains '081400'. If we ever coerced through a
    // number this becomes 81400 and silently matches nothing.
    expect(normalizeLicenseNumber("081400")).toBe("081400");
  });

  it("accepts a 10-digit lab license (docs/ccrs-data-model.md:33)", () => {
    expect(normalizeLicenseNumber("1234567890")).toBe("1234567890");
  });

  it("strips only cosmetic separators from a spreadsheet paste", () => {
    expect(normalizeLicenseNumber(" 413-541 ")).toBe("413541");
    expect(normalizeLicenseNumber("413.541")).toBe("413541");
  });

  it("REJECTS wrong lengths instead of padding or truncating", () => {
    // 5 digits is the classic typo. Padding it would invent a real license.
    expect(normalizeLicenseNumber("41354")).toBeNull();
    expect(normalizeLicenseNumber("4135411")).toBeNull();
    expect(normalizeLicenseNumber("123456789")).toBeNull();
  });

  it("REJECTS non-numeric input", () => {
    expect(normalizeLicenseNumber("41354X")).toBeNull();
    expect(normalizeLicenseNumber("GREENWAY")).toBeNull();
    expect(normalizeLicenseNumber("")).toBeNull();
    expect(normalizeLicenseNumber(null)).toBeNull();
    expect(normalizeLicenseNumber(undefined)).toBeNull();
    expect(normalizeLicenseNumber({})).toBeNull();
  });

  it("REJECTS numeric-looking junk that would sneak past a loose parse", () => {
    // parseInt("413541abc") === 413541. A loose parser accepts this. We don't.
    expect(normalizeLicenseNumber("413541abc")).toBeNull();
    // Exponent / float forms.
    expect(normalizeLicenseNumber("4.13541e5")).toBeNull();
    expect(normalizeLicenseNumber("-413541")).toBeNull();
  });

  it("accepts a numeric 6-digit value without mangling it", () => {
    expect(normalizeLicenseNumber(413541)).toBe("413541");
  });

  it("REJECTS a number that lost its leading zero before reaching us", () => {
    // 081400 typed into a numeric cell arrives as 81400 - 5 digits. We must
    // refuse rather than guess which zero to add back.
    expect(normalizeLicenseNumber(81400)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Booleans - a wrong `is_self` corrupts every comparison
// ---------------------------------------------------------------------------
describe("parseFormBool", () => {
  it("accepts the real checkbox and hidden-input encodings", () => {
    for (const v of [true, "1", "true", "TRUE", "on", "yes", " On "]) {
      expect(parseFormBool(v)).toBe(true);
    }
  });

  it("treats anything unrecognized as FALSE, never guessing true", () => {
    for (const v of [false, "0", "false", "off", "no", "", null, undefined, "maybe", {}]) {
      expect(parseFormBool(v)).toBe(false);
    }
  });
});

describe("tidy", () => {
  it("collapses whitespace and trims", () => {
    expect(tidy("  POT   ZONE \n PO  ", 50)).toBe("POT ZONE PO");
  });

  it("clamps to the max length (paste-bomb defense)", () => {
    expect(tidy("x".repeat(1000), 10)).toHaveLength(10);
  });

  it("returns empty string for non-text", () => {
    expect(tidy(null, 10)).toBe("");
    expect(tidy(undefined, 10)).toBe("");
    expect(tidy({}, 10)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Whole-row validation
// ---------------------------------------------------------------------------
const SELF: RosterRowLike = {
  license_number: "413541",
  tradename: "GREENWAY MARIJUANA",
  kind: "retailer",
  is_self: true,
  is_active: true,
};
const RIVAL: RosterRowLike = {
  license_number: "415229",
  tradename: "POT ZONE",
  kind: "retailer",
  is_self: false,
  is_active: true,
};

describe("validateRosterUpsert - happy path", () => {
  it("accepts a well-formed retailer", () => {
    const r = validateRosterUpsert(
      {
        license_number: "434843",
        tradename: "  THE NOVEL TREE  ",
        city: "BREMERTON",
        county: "KITSAP",
        area: "bremerton",
        kind: "retailer",
        note: "new competitor",
      },
      [SELF, RIVAL],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      license_number: "434843",
      tradename: "THE NOVEL TREE",
      city: "BREMERTON",
      county: "KITSAP",
      area: "bremerton",
      kind: "retailer",
      is_self: false,
      is_active: true,
      note: "new competitor",
    });
    expect(r.warnings).toEqual([]);
  });

  it("accepts a producer/processor - the owner's net-new capability", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "PHAT PANDA", kind: "producer_processor" },
      [SELF],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("producer_processor");
    // No area chosen => "other" => no misleading warning.
    expect(r.value.area).toBe("other");
    expect(r.warnings).toEqual([]);
  });

  it("defaults is_active to true when the field is absent", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "X", kind: "retailer" },
      [],
    );
    expect(r.ok && r.value.is_active).toBe(true);
  });

  it("empty optional text becomes null, not an empty string", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "X", kind: "retailer", city: "   ", note: "" },
      [],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.city).toBeNull();
    expect(r.value.county).toBeNull();
    expect(r.value.note).toBeNull();
  });
});

describe("validateRosterUpsert - refusals", () => {
  it("blocks a missing license number", () => {
    const r = validateRosterUpsert({ tradename: "X", kind: "retailer" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain("License number is required");
  });

  it("blocks a malformed license and QUOTES what was typed", () => {
    const r = validateRosterUpsert({ license_number: "41354", tradename: "X" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("41354");
    expect(r.errors[0]).toContain("6 digits");
  });

  it("blocks a missing store name", () => {
    const r = validateRosterUpsert({ license_number: "999888", kind: "retailer" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain("name is required");
  });

  it("blocks a duplicate license and names the existing entry", () => {
    const r = validateRosterUpsert(
      { license_number: "415229", tradename: "POT ZONE AGAIN", kind: "retailer" },
      [SELF, RIVAL],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("POT ZONE");
    expect(r.errors[0]).toContain("already on the roster");
  });

  it("ALLOWS editing an existing row without tripping the duplicate rule", () => {
    const r = validateRosterUpsert(
      { license_number: "415229", tradename: "POT ZONE (RENAMED)", kind: "retailer" },
      [SELF, RIVAL],
      "415229",
    );
    expect(r.ok).toBe(true);
  });

  it("blocks a SECOND self row", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "IMPOSTER", kind: "retailer", is_self: "1" },
      [SELF, RIVAL],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("GREENWAY MARIJUANA");
    expect(r.errors[0]).toContain("Only one entry");
  });

  it("lets the EXISTING self row stay self when edited", () => {
    const r = validateRosterUpsert(
      { license_number: "413541", tradename: "GREENWAY MARIJUANA", kind: "retailer", is_self: "1" },
      [SELF, RIVAL],
      "413541",
    );
    expect(r.ok).toBe(true);
  });

  it("blocks marking our own store as a producer/processor", () => {
    const r = validateRosterUpsert(
      {
        license_number: "413541",
        tradename: "GREENWAY MARIJUANA",
        kind: "producer_processor",
        is_self: "1",
      },
      [SELF],
      "413541",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain("cannot be marked as a producer");
  });

  it("blocks deactivating our own store", () => {
    const r = validateRosterUpsert(
      {
        license_number: "413541",
        tradename: "GREENWAY MARIJUANA",
        kind: "retailer",
        is_self: "1",
        is_active: "0",
      },
      [SELF],
      "413541",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain("cannot be deactivated");
  });

  it("blocks an unknown area rather than silently bucketing it", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "X", kind: "retailer", area: "seattle" },
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("seattle");
  });

  it("blocks an unknown kind", () => {
    const r = validateRosterUpsert(
      { license_number: "999888", tradename: "X", kind: "grower" },
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("grower");
  });

  it("reports EVERY problem at once, not one at a time", () => {
    const r = validateRosterUpsert({ license_number: "bad", tradename: "", area: "nope" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateRosterUpsert - warnings (allowed, but flagged for the human)", () => {
  it("warns when no kind was chosen and saves it Unclassified", () => {
    const r = validateRosterUpsert({ license_number: "999888", tradename: "X" }, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Critically: NOT defaulted to retailer.
    expect(r.value.kind).toBe("unknown");
    expect(r.warnings.join(" ")).toContain("Unclassified");
  });

  it("warns that area does not drive benchmarks for a producer/processor", () => {
    const r = validateRosterUpsert(
      {
        license_number: "999888",
        tradename: "PHAT PANDA",
        kind: "producer_processor",
        area: "tacoma",
      },
      [],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.area).toBe("tacoma");
    expect(r.warnings.join(" ")).toContain("won't affect area benchmarks");
  });

  it("clamps an oversized name and note without failing the save", () => {
    const r = validateRosterUpsert(
      {
        license_number: "999888",
        tradename: "N".repeat(500),
        kind: "retailer",
        note: "z".repeat(5000),
      },
      [],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tradename).toHaveLength(MAX_TRADENAME_LEN);
    expect(r.value.note).toHaveLength(MAX_NOTE_LEN);
  });
});

// ---------------------------------------------------------------------------
// Views - where a mislabelled row would do real damage
// ---------------------------------------------------------------------------
describe("roster views", () => {
  const rows: RosterRowLike[] = [
    SELF,
    RIVAL,
    { license_number: "999888", tradename: "PHAT PANDA", kind: "producer_processor", is_active: true },
    { license_number: "777666", tradename: "MYSTERY LLC", kind: "unknown", is_active: true },
    { license_number: "555444", tradename: "CLOSED SHOP", kind: "retailer", is_active: false },
    { license_number: "333222", tradename: "LEGACY ROW", is_active: true }, // pre-migration, no kind
  ];

  it("retailRoster keeps ONLY active retailers", () => {
    expect(retailRoster(rows).map((r) => r.license_number)).toEqual(["413541", "415229"]);
  });

  it("retailRoster excludes producer/processors - the corruption this prevents", () => {
    expect(retailRoster(rows).some((r) => r.license_number === "999888")).toBe(false);
  });

  it("retailRoster excludes unclassified AND legacy rows with no kind", () => {
    const ids = retailRoster(rows).map((r) => r.license_number);
    expect(ids).not.toContain("777666");
    expect(ids).not.toContain("333222");
  });

  it("supplyRoster keeps only active producer/processors", () => {
    expect(supplyRoster(rows).map((r) => r.license_number)).toEqual(["999888"]);
  });

  it("rowKind treats a legacy row with no kind as unknown, never retailer", () => {
    expect(rowKind({ license_number: "333222" })).toBe("unknown");
    expect(rowKind({ license_number: "333222", kind: null })).toBe("unknown");
    expect(rowKind({ license_number: "333222", kind: "nonsense" })).toBe("unknown");
  });

  it("trackedLicenses carries EVERY active row regardless of kind", () => {
    // The aggregator should watch producer/processors too - that is the point
    // of the owner's request. Only inactive rows drop out.
    expect(trackedLicenses(rows)).toEqual(["333222", "413541", "415229", "777666", "999888"]);
  });

  it("trackedLicenses is sorted + deduped so slot assignment is reproducible", () => {
    const dupes: RosterRowLike[] = [
      { license_number: "415229" },
      { license_number: "413541" },
      { license_number: " 415-229 " },
    ];
    expect(trackedLicenses(dupes)).toEqual(["413541", "415229"]);
  });

  it("trackedLicenses drops unparseable licenses instead of passing junk down", () => {
    expect(trackedLicenses([{ license_number: "oops" }, { license_number: "413541" }])).toEqual([
      "413541",
    ]);
  });

  it("summarizeRoster counts honestly", () => {
    expect(summarizeRoster(rows)).toEqual({
      total: 6,
      active: 5,
      inactive: 1,
      retailers: 2,
      producerProcessors: 1,
      unclassified: 2,
      selfCount: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Constants must stay in lockstep with the database enum
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("area list matches the 0080 enum exactly", () => {
    expect([...COMPETITOR_AREAS]).toEqual([
      "port_orchard",
      "bremerton",
      "silverdale",
      "tacoma",
      "key_peninsula",
      "kitsap_other",
      "other",
    ]);
  });

  it("kind list is the three declared values", () => {
    expect([...COMPETITOR_KINDS]).toEqual(["retailer", "producer_processor", "unknown"]);
  });
});
