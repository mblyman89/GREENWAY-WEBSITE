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
  PAI_DEFAULT_CUSTOM_CMD,
  PAI_DEFAULT_BASE,
  joinUrl,
  resolvePaiReportPlan,
  resolveAllPaiReportPlans,
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
});

describe("pai-endpoints in-module self-tests", () => {
  it("runs __runPaiEndpointsTests without throwing", () => {
    expect(() => __runPaiEndpointsTests()).not.toThrow();
  });
});
