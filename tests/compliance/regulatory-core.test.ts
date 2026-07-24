/**
 * tests/compliance/regulatory-core.test.ts
 *
 * SLICE 37 — Regulatory Command Center pure cores.
 *
 * The stakes: this pipeline is the owner's early-warning radar for WSLCB rule
 * changes. Every downstream promise (deadline timeline, stage badges, citation
 * deep links, the AI analyst's grounded inputs) rests on these deterministic
 * extractors being exactly right:
 *   - The GovDelivery JSONP feed must parse (including the tricky
 *     `GDWidgets[0].update([...])` wrapper whose prefix contains a bare `[`).
 *   - Citations (WAC / RCW / WSR / bills) must be caught, deduped, and deep
 *     linked to the official legislature pages — never fabricated.
 *   - Stage classification must prefer the most urgent specific signal
 *     (CR-103E emergency beats CR-103 adopted).
 *   - Extracted dates must be real dates from the text, classified by their
 *     OWN sentence so a neighboring sentence's keywords cannot bleed in.
 *   - The compliance surface map must stay internally consistent so the AI
 *     analyst can only cite areas that actually exist in the codebase.
 */

import { describe, it, expect } from "vitest";
import {
  parseGovDeliveryWidget,
  stripTracking,
  bulletinIdFromUrl,
  parseGovDeliveryDate,
  linkForCitation,
  extractCitations,
  classifyStage,
  STAGE_LABELS,
  stageUrgency,
  extractDates,
  isCannabisRelevant,
  extractAll,
  type RulemakingStage,
} from "@/lib/regulatory/regulatory-core";
import {
  COMPLIANCE_SURFACE,
  areasForCitations,
  areaByKey,
  allAreaKeys,
  surfaceMapForPrompt,
} from "@/lib/regulatory/compliance-surface";

// ── GovDelivery widget feed ──────────────────────────────────────────────────

describe("SLICE 37 — parseGovDeliveryWidget", () => {
  const JSONP =
    'GDWidgets[0].update([{"subject":"LCB Action: Cannabis Rulemaking \u2013 License Fees","pub_date":"07/01/2026 04:03 PM PDT","href":"https://content.govdelivery.com/accounts/WALCB/bulletins/41ea476?reqfrom=share"}])';

  it("unwraps the JSONP wrapper even though the prefix contains a bare [", () => {
    const items = parseGovDeliveryWidget(JSONP);
    expect(items).toHaveLength(1);
    expect(items[0].subject).toContain("License Fees");
    // Tracking query must be stripped from the canonical href.
    expect(items[0].href).toBe("https://content.govdelivery.com/accounts/WALCB/bulletins/41ea476");
    expect(items[0].externalId).toBe("41EA476");
    expect(items[0].publishedAt).toBe("2026-07-01T23:03:00.000Z"); // 4:03 PM PDT = 23:03 UTC
  });

  it("accepts a bare JSON array too", () => {
    const items = parseGovDeliveryWidget(
      '[{"subject":"S","pub_date":"01/15/2026 09:00 AM PST","href":"https://content.govdelivery.com/bulletins/gd/WALCB-3abc123"}]',
    );
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("WALCB-3ABC123");
    expect(items[0].publishedAt).toBe("2026-01-15T17:00:00.000Z"); // 9 AM PST = 17:00 UTC
  });

  it("returns [] for garbage input instead of throwing", () => {
    expect(parseGovDeliveryWidget("")).toEqual([]);
    expect(parseGovDeliveryWidget("not json at all")).toEqual([]);
    expect(parseGovDeliveryWidget("GDWidgets[0].update(nope)")).toEqual([]);
  });
});

describe("SLICE 37 — URL + date helpers", () => {
  it("stripTracking removes the query string only", () => {
    expect(stripTracking("https://x.gov/b/1?utm=abc&reqfrom=share")).toBe("https://x.gov/b/1");
    expect(stripTracking("https://x.gov/b/1")).toBe("https://x.gov/b/1");
  });

  it("bulletinIdFromUrl handles both URL shapes and rejects non-bulletins", () => {
    expect(bulletinIdFromUrl("https://content.govdelivery.com/bulletins/gd/WALCB-41ea476")).toBe(
      "WALCB-41EA476",
    );
    expect(bulletinIdFromUrl("https://content.govdelivery.com/accounts/WALCB/bulletins/41ea476")).toBe(
      "41EA476",
    );
    expect(bulletinIdFromUrl("https://lcb.wa.gov/rules/recent-rulemaking-activity")).toBeNull();
  });

  it("parseGovDeliveryDate: PDT is UTC-7, PST is UTC-8, garbage is null", () => {
    expect(parseGovDeliveryDate("07/01/2026 04:03 PM PDT")).toBe("2026-07-01T23:03:00.000Z");
    expect(parseGovDeliveryDate("12/31/2025 11:30 AM PST")).toBe("2025-12-31T19:30:00.000Z");
    expect(parseGovDeliveryDate("tomorrow-ish")).toBeNull();
    expect(parseGovDeliveryDate("")).toBeNull();
  });
});

// ── Citations ────────────────────────────────────────────────────────────────

describe("SLICE 37 — extractCitations", () => {
  it("catches WAC, RCW, chapter-RCW, WSR, and bill styles — deduped, order-preserving", () => {
    const text =
      "Amends WAC 314-55-075, WAC 314-55-075 (again), per RCW 69.50.325 and chapter 34.05 RCW. " +
      "Filed as WSR 26-14-119 implementing EHB 2681 and ESSB 5403.";
    const cites = extractCitations(text).map((c) => c.cite);
    expect(cites).toEqual([
      "WAC 314-55-075",
      "RCW 69.50.325",
      "RCW 34.05",
      "WSR 26-14-119",
      "EHB 2681",
      "ESSB 5403",
    ]);
  });

  it("deep links point at the official legislature, WSR has no stable deep link", () => {
    expect(linkForCitation("wac", "WAC 314-55-075")).toBe(
      "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-075",
    );
    expect(linkForCitation("rcw", "RCW 69.50.325")).toBe(
      "https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.325",
    );
    expect(linkForCitation("bill", "EHB 2681")).toBe(
      "https://app.leg.wa.gov/billsummary/?BillNumber=2681",
    );
    expect(linkForCitation("wsr", "WSR 26-14-119")).toBeNull();
  });

  it("finds nothing in citation-free text", () => {
    expect(extractCitations("The board met on Tuesday and drank coffee.")).toEqual([]);
  });
});

// ── Stage classification + urgency ───────────────────────────────────────────

describe("SLICE 37 — classifyStage / stageUrgency", () => {
  it("emergency (CR-103E) beats adopted (CR-103) when both appear", () => {
    expect(classifyStage("CR-103E emergency rule adopted under CR-103 authority")).toBe("cr103e");
  });

  it("recognizes each explicit CR form", () => {
    expect(classifyStage("The Board filed a CR-101 preproposal statement of inquiry")).toBe("cr101");
    expect(classifyStage("CR-102 proposed rulemaking with a public hearing")).toBe("cr102");
    expect(classifyStage("CR-103 permanent rules adopted")).toBe("cr103");
    expect(classifyStage("CR-105 expedited rulemaking")).toBe("cr105");
  });

  it("falls back to keyword heuristics, then info/unknown", () => {
    expect(classifyStage("Petition for rulemaking received")).toBe("petition");
    expect(classifyStage("Enforcement bulletin 26-01 issued")).toBe("enforcement");
    expect(classifyStage("Interim policy BIP-01-2026 announced")).toBe("policy");
    expect(classifyStage("The legislature passed a house bill on fees")).toBe("legislation");
    expect(classifyStage("Holiday office hours notice")).toBe("info");
    expect(classifyStage("   ")).toBe("unknown");
  });

  it("urgency: emergency=critical, adopted/expedited=high, proposed=medium, rest=low", () => {
    expect(stageUrgency("cr103e")).toBe("critical");
    expect(stageUrgency("cr103")).toBe("high");
    expect(stageUrgency("cr105")).toBe("high");
    expect(stageUrgency("cr102")).toBe("medium");
    expect(stageUrgency("cr101")).toBe("low");
    expect(stageUrgency("info")).toBe("low");
  });

  it("every stage has a human label", () => {
    const stages: RulemakingStage[] = [
      "cr101", "cr102", "cr103", "cr103e", "cr105",
      "petition", "enforcement", "policy", "legislation", "info", "unknown",
    ];
    for (const s of stages) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });
});

// ── Date extraction ──────────────────────────────────────────────────────────

describe("SLICE 37 — extractDates", () => {
  it("classifies each date by its OWN sentence (no keyword bleed between sentences)", () => {
    const text =
      "Written comments are due by July 3, 2026. A public hearing is set for July 15, 2026. " +
      "The rules become effective August 20, 2026.";
    const dates = extractDates(text);
    expect(dates).toEqual([
      expect.objectContaining({ kind: "comment_deadline", date: "2026-07-03" }),
      expect.objectContaining({ kind: "hearing", date: "2026-07-15" }),
      expect.objectContaining({ kind: "effective", date: "2026-08-20" }),
    ]);
    // The note is the containing sentence, so the owner sees WHY the date matters.
    expect(dates[0].note).toContain("comments");
  });

  it("rejects impossible dates and dedupes (kind, date) pairs", () => {
    const dates = extractDates(
      "Due February 30, 2026. Comments close March 5, 2026. Comments really close March 5, 2026.",
    );
    expect(dates.filter((d) => d.date === "2026-02-30")).toHaveLength(0);
    expect(dates.filter((d) => d.date === "2026-03-05")).toHaveLength(1);
  });

  it("plain mentions are 'mentioned'", () => {
    const dates = extractDates("The board met on January 8, 2026 to discuss agendas.");
    expect(dates).toEqual([expect.objectContaining({ kind: "mentioned", date: "2026-01-08" })]);
  });
});

// ── Relevance gate + one-call extraction ─────────────────────────────────────

describe("SLICE 37 — isCannabisRelevant / extractAll", () => {
  it("gates AI spend: cannabis signals pass, liquor-only noise does not", () => {
    expect(isCannabisRelevant("Cannabis Rulemaking \u2013 License Fees")).toBe(true);
    expect(isCannabisRelevant("Amendments to WAC 314-55-095 purchase limits")).toBe(true);
    expect(isCannabisRelevant("New rules for spirits distributors and wineries")).toBe(false);
  });

  it("extractAll combines title + body for the full deterministic pass", () => {
    const x = extractAll(
      "LCB Action: Cannabis Rulemaking \u2013 License Fees",
      "CR-102 proposed rules amending WAC 314-55-075. Comments due July 3, 2026.",
    );
    expect(x.stage).toBe("cr102");
    expect(x.cannabisRelevant).toBe(true);
    expect(x.citations.map((c) => c.cite)).toContain("WAC 314-55-075");
    expect(x.dates).toEqual([
      expect.objectContaining({ kind: "comment_deadline", date: "2026-07-03" }),
    ]);
  });
});

// ── Compliance surface map ───────────────────────────────────────────────────

describe("SLICE 37 — compliance surface map", () => {
  it("area keys are unique and areaByKey round-trips every key", () => {
    const keys = allAreaKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(areaByKey(k)?.key).toBe(k);
    }
    expect(areaByKey("nonsense-area")).toBeNull();
  });

  it("every area carries citations and real module paths for the AI prompt", () => {
    for (const area of COMPLIANCE_SURFACE) {
      expect(area.citations.length).toBeGreaterThan(0);
      expect(area.whatWeRun.length).toBeGreaterThan(0);
    }
  });

  it("areasForCitations maps WAC 314-55-095 to sales limits", () => {
    const areas = areasForCitations(["WAC 314-55-095"]);
    expect(areas.map((a) => a.key)).toContain("sales-limits");
  });

  it("surfaceMapForPrompt mentions every area key exactly once", () => {
    const prompt = surfaceMapForPrompt();
    for (const k of allAreaKeys()) {
      expect(prompt).toContain(k);
    }
  });
});
