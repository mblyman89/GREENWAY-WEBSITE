/**
 * S-17d (CCRS Bible Part 07 §D, Part 17 §K.5, Part 05 D-20): the hand-over
 * from Cultivera to Greenway's own reporting.
 *
 * Owner facts (2026-10-19): last Cultivera sale before close Sat 10/31/2026;
 * first new-system sale Sun 11/01/2026 morning; Cultivera plans to upload
 * 11/07/2026 for 10/25-10/31. The owner assumed Greenway's first upload is
 * 11/14. It is NOT: the week 11/01-11/07 is due Sun 11/08 [FAQ L0041].
 *
 * Every rule is grounded in text committed in the repo (Part 02 verbatim
 * copies and the 2026-10-19 evidence), so these reads run in CI.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EMPTY_HANDOVER_FACTS,
  HANDOVER_CITES,
  __runCcrsHandoverTests,
  handoverFactsFromSetting,
  planHandover,
  type HandoverPlan,
} from "@/lib/compliance/ccrs-handover-core";
import { isoWeekday } from "@/lib/compliance/ccrs-week-core";
import { HandoverPlanCard } from "@/components/admin/compliance/HandoverPlanCard";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const PART02 = read("docs/ccrs-bible/02-authoritative-spec.md");
const FAQ19 = read("docs/ccrs-bible/evidence/2026-10-19-owner-request/lcb-2026-10-19/faq.txt").split("\n");
const L = (lines: string[], n: number) => lines[n - 1];

/** Part 02 verbatim line `L####|` inside the section that starts with `heading`. */
function part02Line(heading: string, pin: string): string {
  const start = PART02.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = PART02.slice(start);
  const next = rest.indexOf("\n## ", 5);
  const section = next > 0 ? rest.slice(0, next) : rest;
  const line = section.split("\n").find((l) => l.startsWith(`${pin}|`));
  expect(line, `${heading} ${pin}`).toBeDefined();
  return line as string;
}
const GUIDE = "## 1. CCRS Upload User Guide";
const FAQ = "## 2. CCRS FAQ";

const codes = (p: HandoverPlan) => p.warnings.map((w) => w.code);
const OWNER = {
  greenwayFirstSaleDate: "2026-11-01",
  facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-11-07" },
  todayIso: "2026-10-20",
};

describe("S-17d grounding: the rules come from the LCB text committed in the repo", () => {
  it("[FAQ L0041] week is Sunday - Saturday, due no later than Sunday for the previous week", () => {
    const l = part02Line(FAQ, "L0041");
    expect(l).toContain("Week is defined as Sunday - Saturday.");
    expect(l).toContain("no later than Sunday for the previous week");
    expect(l).toContain("After the transition period");
    // Same sentence on the 2026-10-19 page.
    expect(L(FAQ19, 254)).toContain("no later than Sunday for the previous week");
  });
  it("[FAQ L0049] no report when there is nothing new; no 'no change' report exists", () => {
    const l = part02Line(FAQ, "L0049");
    expect(l).toContain("if there is nothing new to report, there is no report to submit");
  });
  it("[G L1390] / [G L1190] duplicate errors when the same sale or transfer arrives twice", () => {
    expect(part02Line(GUIDE, "L1390")).toContain("Duplicate Sale for Licensee");
    expect(part02Line(GUIDE, "L1190")).toContain("Duplicate InventoryTransfer for Licensee");
  });
  it("[FAQ19] licensee responsible; only the active administrator removes an integrator; data copy", () => {
    expect(L(FAQ19, 346)).toContain("The licensee is ultimately responsible to meet data reporting obligations");
    expect(L(FAQ19, 336)).toContain("only the active administrator of the license can assign or remove an integrator");
    expect(L(FAQ19, 448)).toContain("A license can request their data from the examiner unit for CCRS");
  });
  it("calendar facts the owner's question depends on are real weekdays", () => {
    expect(isoWeekday("2026-10-25")).toBe(0);
    expect(isoWeekday("2026-10-31")).toBe(6);
    expect(isoWeekday("2026-11-01")).toBe(0);
    expect(isoWeekday("2026-11-07")).toBe(6);
    expect(isoWeekday("2026-11-08")).toBe(0);
    expect(isoWeekday("2026-11-14")).toBe(6);
    expect(isoWeekday("2026-11-15")).toBe(0);
    // Independent of our helper: the JS Date of the platform.
    expect(new Date("2026-11-08T12:00:00Z").getUTCDay()).toBe(0);
    expect(new Date("2026-11-14T12:00:00Z").getUTCDay()).toBe(6);
  });
  it("every cite string names a real pin or bible part", () => {
    expect(HANDOVER_CITES.week).toContain("[FAQ L0041]");
    expect(HANDOVER_CITES.duplicateSale).toContain("[G L1390]");
    expect(HANDOVER_CITES.duplicateTransfer).toContain("[G L1190]");
    expect(HANDOVER_CITES.responsible).toContain("[FAQ19 L0346]");
    expect(HANDOVER_CITES.removeIntegrator).toContain("[FAQ19 L0336]");
    expect(HANDOVER_CITES.freshCopy).toContain("[FAQ19 L0448]");
  });
});

describe("S-17d the owner's dates (Cultivera to Sat 10/31, Greenway from Sun 11/01, Cultivera uploads 11/07)", () => {
  const p = planHandover(OWNER);
  it("first Greenway week is 11/01-11/07, due Sun 11/08 (not 11/14)", () => {
    expect(p.greenwayFirstWeek).toEqual({ start: "2026-11-01", end: "2026-11-07", due: "2026-11-08", key: "W-2026-11-01" });
    expect(p.greenwayFirstDue).toBe("2026-11-08");
    expect(p.greenwayFirstDue).not.toBe("2026-11-14");
  });
  it("can upload Sat 11/07 after close; the next week 11/08-11/14 is due 11/15", () => {
    expect(p.greenwayEarliestUpload).toBe("2026-11-07");
    expect(p.greenwaySecondWeek).toEqual({ start: "2026-11-08", end: "2026-11-14", due: "2026-11-15", key: "W-2026-11-08" });
  });
  it("Cultivera's last week is 10/25-10/31, due Sun 11/01", () => {
    expect(p.integratorLastWeek).toEqual({ start: "2026-10-25", end: "2026-10-31", due: "2026-11-01", key: "W-2026-10-25" });
    expect(p.integratorLastSaleAssumed).toBe(false);
  });
  it("flags the 11/07 upload as 6 days after its due Sunday, without calling it a violation", () => {
    const w = p.warnings.find((x) => x.code === "FINAL_UPLOAD_AFTER_DUE");
    expect(w?.severity).toBe("warn");
    expect(w?.text).toContain("due Sun 2026-11-01");
    expect(w?.text).toContain("6 day(s) after");
    expect(w?.text).toContain("not verified");
    expect(w?.text).not.toMatch(/violation|illegal|penalt/i);
  });
  it("flags the overlap risk: get it in writing that the 11/07 upload holds nothing from 11/01 on", () => {
    const w = p.warnings.find((x) => x.code === "FINAL_UPLOAD_AFTER_START");
    expect(w?.text).toContain("nothing dated 2026-11-01 or later");
    expect(w?.text).toContain("Duplicate Sale for Licensee");
    expect(w?.cite).toContain("U-61");
  });
  it("no gap, no overlap, no split week; ready (nothing blocks)", () => {
    expect(codes(p)).not.toContain("SALES_GAP");
    expect(codes(p)).not.toContain("SALES_OVERLAP");
    expect(codes(p)).not.toContain("START_NOT_SUNDAY");
    expect(p.ready).toBe(true);
  });
  it("fresh copy window is 1 day (11/07 to 11/08) and says to upload on time anyway", () => {
    expect(p.freshCopyWindowDays).toBe(1);
    const w = p.warnings.find((x) => x.code === "FRESH_COPY_WINDOW");
    expect(w?.severity).toBe("info");
    expect(w?.text).toContain("upload on time anyway");
  });
  it("steps H-1..H-6 with the right days", () => {
    expect(p.steps.map((s) => s.id)).toEqual(["H-1", "H-2", "H-3", "H-4", "H-5", "H-6"]);
    const by = Object.fromEntries(p.steps.map((s) => [s.id, s]));
    expect(by["H-1"].text).toContain("on or before Sun 2026-11-01");
    expect(by["H-2"].when).toBe("2026-10-31");
    expect(by["H-3"].when).toBe("2026-11-07");
    expect(by["H-4"].when).toBe("2026-11-08");
    expect(by["H-4"].text).toContain("due Sun 2026-11-15");
    expect(by["H-5"].when).toBeNull();
    expect(by["H-5"].cite).toContain("Part 07 §D step 6");
    expect(by["H-6"].when).toBe("2026-11-07");
  });
});

describe("S-17d edges", () => {
  const base = { todayIso: "2026-10-20" };
  it("on-time Cultivera (upload Sat 10/31 or Sun 11/01) is not late; 11/01 is after start", () => {
    const sat = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-10-31" } });
    expect(codes(sat)).not.toContain("FINAL_UPLOAD_AFTER_DUE");
    expect(codes(sat)).not.toContain("FINAL_UPLOAD_AFTER_START");
    expect(sat.freshCopyWindowDays).toBe(8);
    const sun = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-11-01" } });
    expect(codes(sun)).not.toContain("FINAL_UPLOAD_AFTER_DUE");
    expect(codes(sun)).toContain("FINAL_UPLOAD_AFTER_START");
    const mon = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-11-02" } });
    expect(mon.warnings.find((w) => w.code === "FINAL_UPLOAD_AFTER_DUE")?.text).toContain("1 day(s) after");
  });
  it("first day of sales not set: blocks, no dates invented", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: null, facts: EMPTY_HANDOVER_FACTS });
    expect(p.ready).toBe(false);
    expect(codes(p)).toEqual(["START_NOT_SET"]);
    expect(p.greenwayFirstDue).toBeNull();
    expect(p.steps).toEqual([]);
  });
  it("junk first day is treated as not set", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-31", facts: EMPTY_HANDOVER_FACTS });
    expect(codes(p)).toEqual(["START_NOT_SET"]);
  });
  it("mid-week start: split week warned; first week still the one containing it", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-04", facts: EMPTY_HANDOVER_FACTS });
    expect(codes(p)).toContain("START_NOT_SUNDAY");
    expect(p.greenwayFirstWeek?.start).toBe("2026-11-01");
    expect(p.greenwayFirstDue).toBe("2026-11-08");
  });
  it("Saturday start (the day before a Sunday) is also a split week", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-10-31", facts: EMPTY_HANDOVER_FACTS });
    expect(codes(p)).toContain("START_NOT_SUNDAY");
    expect(p.greenwayFirstDue).toBe("2026-11-01");
  });
  it("unknown facts: assumed last sale is start-1, and both unknowns are warned", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: EMPTY_HANDOVER_FACTS });
    expect(p.integratorLastSaleAssumed).toBe(true);
    expect(p.integratorLastSaleUsed).toBe("2026-10-31");
    expect(codes(p)).toEqual(["LAST_SALE_UNKNOWN", "FINAL_UPLOAD_UNKNOWN"]);
    expect(p.freshCopyWindowDays).toBeNull();
    expect(p.ready).toBe(true);
  });
  it("overlap: last Cultivera sale on/after the first new sale blocks", () => {
    for (const last of ["2026-11-01", "2026-11-03"]) {
      const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: last, integratorFinalUploadDate: "2026-11-08" } });
      expect(codes(p)).toContain("SALES_OVERLAP");
      expect(p.ready).toBe(false);
    }
  });
  it("gap: days with no system recorded warn (not block); exactly start-1 is no gap", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-29", integratorFinalUploadDate: "2026-10-31" } });
    const w = p.warnings.find((x) => x.code === "SALES_GAP");
    expect(w?.text).toContain("Fri 2026-10-30 to Sat 2026-10-31");
    expect(p.ready).toBe(true);
  });
  it("final upload before the last sale blocks", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-10-30" } });
    expect(codes(p)).toContain("FINAL_UPLOAD_BEFORE_LAST_SALE");
    expect(p.ready).toBe(false);
    const same = planHandover({ ...base, greenwayFirstSaleDate: "2026-11-01", facts: { integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "2026-10-31" } });
    expect(codes(same)).not.toContain("FINAL_UPLOAD_BEFORE_LAST_SALE");
  });
  it("year boundary: start Sun 2027-01-03 -> due Sun 2027-01-10; Sat start 2026-12-26 week due 12/27", () => {
    const p = planHandover({ ...base, greenwayFirstSaleDate: "2027-01-03", facts: EMPTY_HANDOVER_FACTS });
    expect(p.greenwayFirstWeek?.start).toBe("2027-01-03");
    expect(p.greenwayFirstDue).toBe("2027-01-10");
    expect(p.integratorLastWeek?.start).toBe("2026-12-27");
    expect(p.integratorLastWeek?.due).toBe("2027-01-03");
  });
  it("settings parser keeps real dates only", () => {
    expect(handoverFactsFromSetting(undefined)).toEqual(EMPTY_HANDOVER_FACTS);
    expect(handoverFactsFromSetting("x")).toEqual(EMPTY_HANDOVER_FACTS);
    expect(handoverFactsFromSetting({ integratorLastSaleDate: "2026-10-31", integratorFinalUploadDate: "11/07/2026" })).toEqual({
      integratorLastSaleDate: "2026-10-31",
      integratorFinalUploadDate: null,
    });
  });
  it("self-test passes", () => {
    const r = __runCcrsHandoverTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });
});

describe("S-17d hub card render", () => {
  const action = async () => {};
  it("shows the first due date, every warning code, every step, and the form when allowed", () => {
    const p = planHandover(OWNER);
    const html = renderToStaticMarkup(
      <HandoverPlanCard plan={p} facts={OWNER.facts} canEdit weekKey="W-2026-10-11" env="prod" action={action} />,
    );
    expect(html).toContain("Your first upload: week 2026-11-01 to 2026-11-07, due Sunday 2026-11-08.");
    for (const w of p.warnings) expect(html).toContain(`data-code="${w.code}"`);
    for (const s of p.steps) expect(html).toContain(`data-step="${s.id}"`);
    expect(html).toContain('name="integrator_last_sale"');
    expect(html).toContain('value="2026-10-31"');
    expect(html).toContain('name="integrator_final_upload"');
    expect(html).toContain('value="2026-11-07"');
    expect(html).toContain('name="week_key" value="W-2026-10-11"');
  });
  it("read-only without permission; no due line when the start is not set", () => {
    const p = planHandover({ greenwayFirstSaleDate: null, facts: EMPTY_HANDOVER_FACTS, todayIso: "2026-10-20" });
    const html = renderToStaticMarkup(
      <HandoverPlanCard plan={p} facts={EMPTY_HANDOVER_FACTS} canEdit={false} weekKey="W-2026-10-11" env="prod" action={action} />,
    );
    expect(html).not.toContain("Your first upload");
    expect(html).not.toContain("<form");
    expect(html).toContain('data-code="START_NOT_SET"');
    expect(html).toContain("Change settings");
  });
});

describe("S-17d wiring pins", () => {
  const page = read("src/app/admin/compliance/ccrs/page.tsx");
  const actions = read("src/app/admin/compliance/ccrs/actions.ts");
  const store = read("src/lib/compliance/ccrs-handover-store.ts");
  it("hub plans from the S-12d first day of sales and the stored facts", () => {
    expect(page).toContain(
      "planHandover({ greenwayFirstSaleDate: obligationCtx.startDate, facts: handoverFacts, todayIso })",
    );
    expect(page).toContain("action={setHandoverFactsAction}");
    expect(page).toContain("canEdit={canEdit}");
  });
  it("action is permission-gated, audited and revalidates", () => {
    const i = actions.indexOf("export async function setHandoverFactsAction");
    expect(i).toBeGreaterThan(-1);
    const body = actions.slice(i, actions.indexOf("\n}\n", i));
    expect(body).toContain('requirePermission("settings.manage")');
    expect(body).toContain('action: "ccrs_handover.facts_set"');
    expect(body).toContain("revalidatePath(BASE)");
    expect(body).toContain('formData.get("integrator_last_sale")');
    expect(body).toContain('formData.get("integrator_final_upload")');
  });
  it("store uses its own site_settings key, validates both dates, and fails safe", () => {
    expect(store).toContain('HANDOVER_SETTING_KEY = "ccrs_handover_facts"');
    expect(store).toContain("validateStartDate(opts.lastSaleRaw, today)");
    expect(store).toContain("validateStartDate(opts.finalUploadRaw, today)");
    expect(store).toContain("if (error) return EMPTY_HANDOVER_FACTS;");
    expect(store).not.toContain("compliance_obligation_start");
  });
});

describe("S-17d docs: the stale Oct 18 cutover plan is superseded by the owner's dates", () => {
  const cut = read("docs/audit/CUTOVER-CHECKLIST.md");
  it("CUTOVER-CHECKLIST opens with the superseding notice and the real dates", () => {
    const head = cut.slice(0, 3000);
    expect(head).toContain("SUPERSEDED DATES (2026-10-19, owner facts, CCRS Bible Part 05 D-20)");
    expect(head).toContain("first self-reported upload is due **Sunday 2026-11-08**");
    expect(head).toContain("week 2026-11-01 to 2026-11-07");
  });
  it("C-120 names the real first upload; IDs are not renumbered", () => {
    const c120 = cut.slice(cut.indexOf("**C-120"), cut.indexOf("**C-121"));
    expect(c120).toContain("Sunday, November 8");
    expect(c120).toContain("week of Nov 1–7");
    expect(c120).not.toContain("October 18");
    for (const id of ["C-107", "C-110", "C-111", "C-112", "C-120", "C-121", "C-122", "C-130", "C-131", "C-132", "C-133"]) {
      expect(cut).toContain(`**${id} `);
    }
  });
  it("bible records the corrected answer (11/08, not 11/14) and the open transition-period question", () => {
    const d = read("docs/ccrs-bible/05-owner-decisions-log.md");
    expect(d).toContain("## D-20");
    expect(d).toContain("due **Sun 2026-11-08**, not 11/14");
    const u = read("docs/ccrs-bible/12-unverified-register.md");
    expect(u).toContain("| U-64 |");
    const p7 = read("docs/ccrs-bible/07-cultivera-cutover-and-identifier-continuity.md");
    expect(p7).toContain("S-17d");
  });
});
