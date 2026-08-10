/**
 * tests/compliance/pai-endpoints.test.ts  (SLICE A-2c-2)
 *
 * Vitest mirror for the PURE PAI endpoint resolver — the single source of truth
 * for which report .event to fetch and how to ask for its CSV. Pins:
 *   • the CONFIRMED report paths (from Michael's live address bar),
 *   • the confirmed www. base + Filter/CustomCommand URL shapes,
 *   • the OVERRIDABLE CSV custom-command value (default flagged honestly),
 *   • joinUrl slash handling.
 * pai-client.ts and sync-server.ts are server-only (import "server-only") and
 * are covered by the in-module pure self-tests via the compliance runner; the
 * guessing-prevention logic lives here and is exercised directly.
 */
import { describe, expect, it } from "vitest";
import {
  PAI_REPORT_EVENT,
  PAI_REPORT_EVENT_UNIVERSAL,
  PAI_DEFAULT_CUSTOM_CMD,
  PAI_DEFAULT_BASE,
  joinUrl,
  resolvePaiReportPlan,
  resolveAllPaiReportPlans,
  buildPaiGuidDownloadBody,
  buildPaiGuidDownloadUrl,
  __runPaiEndpointsTests,
} from "@/lib/atm/pai-endpoints";

describe("PAI confirmed report event paths (never guessed)", () => {
  it("matches the endpoints Michael confirmed from his address bar", () => {
    expect(PAI_REPORT_EVENT.cashLoad).toBe("GetATMCashLoadsReport.event");
    expect(PAI_REPORT_EVENT.simpleSummary).toBe("GetTerminalTrxDataReport.event");
    expect(PAI_REPORT_EVENT.fundsMovement).toBe("GetFundsMovementByAcctByDayReport.event");
  });
  it("uses the confirmed www. base and DownloadCSV default", () => {
    expect(PAI_DEFAULT_BASE).toBe("https://www.paireports.com/myreports/");
    expect(PAI_DEFAULT_CUSTOM_CMD).toBe("DownloadCSV");
  });
});

describe("joinUrl (exactly one slash)", () => {
  it("handles trailing/leading slashes", () => {
    expect(joinUrl("https://x/m/", "A.event")).toBe("https://x/m/A.event");
    expect(joinUrl("https://x/m", "A.event")).toBe("https://x/m/A.event");
    expect(joinUrl("https://x/m/", "/A.event")).toBe("https://x/m/A.event");
  });
});

describe("resolvePaiReportPlan (default)", () => {
  it("builds Filter + CustomCommand URLs for Simple Summary", () => {
    const p = resolvePaiReportPlan("simpleSummary", null, null);
    expect(p.filterUrl).toBe(
      "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter",
    );
    expect(p.downloadUrl).toBe(
      "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=CustomCommand&CustomCmdList=DownloadCSV",
    );
    expect(p.customCmdList).toBe("DownloadCSV");
    expect(p.usingDefaultCustomCmd).toBe(true);
  });
  it("uses the confirmed event path for cash load and funds movement", () => {
    expect(resolvePaiReportPlan("cashLoad", null, null).filterUrl).toContain("GetATMCashLoadsReport.event");
    expect(resolvePaiReportPlan("fundsMovement", null, null).filterUrl).toContain(
      "GetFundsMovementByAcctByDayReport.event",
    );
  });
});

describe("resolvePaiReportPlan (config override — the 'never guess' escape hatch)", () => {
  it("uses a captured CustomCmdList value and clears the default flag", () => {
    const p = resolvePaiReportPlan("simpleSummary", null, { customCmdList: "OpenCSVInExcel" });
    expect(p.customCmdList).toBe("OpenCSVInExcel");
    expect(p.usingDefaultCustomCmd).toBe(false);
    expect(p.downloadUrl.endsWith("CustomCmdList=OpenCSVInExcel")).toBe(true);
  });
  it("url-encodes an unusual command value", () => {
    const p = resolvePaiReportPlan("cashLoad", null, { customCmdList: "Open CSV" });
    expect(p.downloadUrl.endsWith("CustomCmdList=Open%20CSV")).toBe(true);
  });
  it("respects a custom portal base URL", () => {
    const p = resolvePaiReportPlan("cashLoad", "https://paireports.com/myreports/", null);
    expect(p.filterUrl.startsWith("https://paireports.com/myreports/")).toBe(true);
  });
  it("ignores a non-string customCmdList and falls back to the default", () => {
    const p = resolvePaiReportPlan("simpleSummary", null, { customCmdList: 123 as unknown as string });
    expect(p.customCmdList).toBe("DownloadCSV");
    expect(p.usingDefaultCustomCmd).toBe(true);
  });
});

describe("combinedUrl (robust single-request pattern from PAI's official SDK)", () => {
  it("carries Filter + CustomCommand together (default, no range)", () => {
    const p = resolvePaiReportPlan("simpleSummary", null, null);
    expect(p.combinedUrl).toBe(
      "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter&ReportCmd=CustomCommand&CustomCmdList=DownloadCSV",
    );
  });
  it("carries the date filter WITH the download when a range is supplied", () => {
    const p = resolvePaiReportPlan("fundsMovement", null, null, { from: "2024-02-29", to: "2026-08-11" });
    expect(p.combinedUrl).toContain("ReportCmd=Filter&ReportCmd=CustomCommand");
    expect(p.combinedUrl).toContain(`F_SettlementDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`);
  });
  it("uses a PER-REPORT date field name override", () => {
    const cfg = { dateFieldName: { fundsMovement: "F_PostDate" } };
    const p = resolvePaiReportPlan("fundsMovement", null, cfg, { from: "2024-02-29", to: "2026-08-11" });
    expect(p.usingDefaultDateField).toBe(false);
    expect(p.combinedUrl).toContain(`F_PostDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`);
  });
});

describe("resolveAllPaiReportPlans", () => {
  it("returns all three report plans", () => {
    const all = resolveAllPaiReportPlans(null, null);
    expect(all.cashLoad.kind).toBe("cashLoad");
    expect(all.simpleSummary.kind).toBe("simpleSummary");
    expect(all.fundsMovement.kind).toBe("fundsMovement");
  });

  it("pins the per-kind report GUID onto each plan when supplied", () => {
    const all = resolveAllPaiReportPlans(null, null, null, {
      cashLoad: "G-cash",
      simpleSummary: "",
      fundsMovement: "G-funds",
    });
    expect(all.cashLoad.combinedUrl).toContain("&ReportGUID=G-cash");
    expect(all.fundsMovement.combinedUrl).toContain("&ReportGUID=G-funds");
    // Empty guid for a kind → no pin (falls back to PAI's default).
    expect(all.simpleSummary.combinedUrl).not.toContain("ReportGUID");
  });

  it("with NO guid map produces the byte-for-byte proven path (no pins)", () => {
    const all = resolveAllPaiReportPlans(null, null, null);
    expect(all.cashLoad.combinedUrl).not.toContain("ReportGUID");
    expect(all.fundsMovement.combinedUrl).not.toContain("ReportGUID");
  });
});

describe("reportGuid pinning (serve EXACTLY the saved report — fixes same-named reports)", () => {
  it("appends &ReportGUID=<guid> to filterUrl, downloadUrl AND combinedUrl", () => {
    const p = resolvePaiReportPlan("fundsMovement", null, null, null, "G-abc");
    expect(p.filterUrl).toContain("&ReportGUID=G-abc");
    expect(p.downloadUrl).toContain("&ReportGUID=G-abc");
    expect(p.combinedUrl).toContain("&ReportGUID=G-abc");
  });

  it("URL-encodes the GUID", () => {
    const p = resolvePaiReportPlan("fundsMovement", null, null, null, "G a/b");
    expect(p.combinedUrl).toContain(`&ReportGUID=${encodeURIComponent("G a/b")}`);
  });

  it("omits ReportGUID entirely when the GUID is absent, empty, or whitespace", () => {
    expect(resolvePaiReportPlan("fundsMovement", null, null).combinedUrl).not.toContain("ReportGUID");
    expect(resolvePaiReportPlan("fundsMovement", null, null, null, "").combinedUrl).not.toContain("ReportGUID");
    expect(resolvePaiReportPlan("fundsMovement", null, null, null, "   ").combinedUrl).not.toContain("ReportGUID");
  });

  it("carries date filter + command + guid together in combinedUrl", () => {
    const p = resolvePaiReportPlan(
      "fundsMovement",
      null,
      null,
      { from: "2024-02-29", to: "2026-08-11" },
      "G-xyz",
    );
    expect(p.combinedUrl).toContain("ReportCmd=Filter&ReportCmd=CustomCommand");
    expect(p.combinedUrl).toContain("F_SettlementDate=");
    expect(p.combinedUrl).toContain("&ReportGUID=G-xyz");
  });
});

describe("buildPaiGuidDownloadBody (PAI SDK: POST Report.event by GUID)", () => {
  it("uses the confirmed universal Report.event path", () => {
    expect(PAI_REPORT_EVENT_UNIVERSAL).toBe("Report.event");
  });

  it("builds GUID + Filter + CustomCommand + DownloadCSV by default (no filters)", () => {
    const p = new URLSearchParams(buildPaiGuidDownloadBody("G-123"));
    expect(p.get("ReportGUID")).toBe("G-123");
    expect(p.getAll("ReportCmd")).toEqual(["Filter", "CustomCommand"]);
    expect(p.get("CustomCmdList")).toBe("DownloadCSV");
  });

  it("honors a custom command and falls back to DownloadCSV when blank", () => {
    expect(new URLSearchParams(buildPaiGuidDownloadBody("G", { customCmdList: "OpenCSV" })).get("CustomCmdList")).toBe("OpenCSV");
    expect(new URLSearchParams(buildPaiGuidDownloadBody("G", { customCmdList: "   " })).get("CustomCmdList")).toBe("DownloadCSV");
  });

  it("adds F_<Col>=<value> and E_<Col>=false for each filter, and skips blank columns", () => {
    const p = new URLSearchParams(
      buildPaiGuidDownloadBody("G", { filters: [{ column: "Settlement Date", value: "02/29/2024 - 08/11/2026" }] }),
    );
    expect(p.get("F_Settlement Date")).toBe("02/29/2024 - 08/11/2026");
    expect(p.get("E_Settlement Date")).toBe("false");
    expect(buildPaiGuidDownloadBody("G", { filters: [{ column: "  ", value: "x" }] })).not.toContain("F_");
  });

  it("trims the GUID", () => {
    expect(new URLSearchParams(buildPaiGuidDownloadBody("  G-9  ")).get("ReportGUID")).toBe("G-9");
  });
});

describe("buildPaiGuidDownloadUrl (per-report .event GET path pinned by GUID)", () => {
  it("uses the per-kind .event path with Filter + CustomCommand and pins the GUID", () => {
    const u = buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, PAI_REPORT_EVENT.simpleSummary, "G-SS");
    expect(u).toContain("GetTerminalTrxDataReport.event?ReportCmd=Filter&ReportCmd=CustomCommand");
    expect(u).toContain("CustomCmdList=DownloadCSV");
    expect(u.endsWith("&ReportGUID=G-SS")).toBe(true);
  });

  it("honors a custom command and URL-encodes / trims the GUID", () => {
    expect(buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "  a b  ", { customCmdList: "OpenCSV" })).toContain("CustomCmdList=OpenCSV");
    expect(buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "a b").endsWith("ReportGUID=a%20b")).toBe(true);
  });

  it("omits the ReportGUID param when the GUID is blank", () => {
    expect(buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "  ")).not.toContain("ReportGUID=");
  });
});

describe("pai-endpoints in-module self-tests", () => {
  it("runs __runPaiEndpointsTests without throwing", () => {
    expect(() => __runPaiEndpointsTests()).not.toThrow();
  });
});
