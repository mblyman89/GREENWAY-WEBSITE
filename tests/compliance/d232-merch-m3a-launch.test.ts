/**
 * D232 slice M-3a (SOP-11 B.5 item 1, G-78 part): the Setup & Launch coach,
 * 13 steps proven by Merch Health where it can, plus Form 8.1 (printable).
 * Michael verbatim: "Q1: owner/admin." / "guidance first, but build the
 * button too please and all that goes with it."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  __runMerchLaunchCoreTests,
  LAUNCH_STEPS,
  MERCH_LAUNCH_KEY,
  emptyLaunchProgress,
  setTick,
  summarizeLaunch,
  progressLine,
} from "@/lib/merch/merch-launch-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-3a: launch core", () => {
  it("self-test passes", () => {
    expect(__runMerchLaunchCoreTests().failed).toBe(0);
  });
  it("has 13 steps (S-1..S-12 + T) with SOP refs and a done-when line", () => {
    expect(LAUNCH_STEPS.map((s) => s.id)).toEqual([
      "S-1", "S-2", "S-3", "S-4", "S-5", "S-6", "S-7", "S-8", "S-9", "S-10", "S-11", "S-12", "T",
    ]);
    for (const s of LAUNCH_STEPS) {
      expect(s.sop.length).toBeGreaterThan(0);
      expect(s.doneWhen.length).toBeGreaterThan(0);
      expect(s.todo.length).toBeGreaterThanOrEqual(3);
    }
    expect(MERCH_LAUNCH_KEY).toBe("merch_launch_progress");
  });
  it("with no health run, nothing is done and the first step is next", () => {
    const sum = summarizeLaunch(null, emptyLaunchProgress());
    expect(sum.done).toBe(0);
    expect(sum.total).toBe(13);
    expect(sum.next?.step.id).toBe("S-1");
    expect(progressLine(sum)).toContain("0 of 13 done");
  });
  it("a manual-only step is done once ticked", () => {
    const sum = summarizeLaunch(null, setTick(emptyLaunchProgress(), "S-1", true, { at: "2027-01-10T15:00:00Z", by: "owner@x" }));
    expect(sum.done).toBe(1);
    expect(sum.next?.step.id).not.toBe("S-1");
  });
});

describe("D232 M-3a: wiring", () => {
  it("page, record and actions are owner/admin (settings.manage)", () => {
    for (const p of [
      "src/app/admin/merch-studio/launch/page.tsx",
      "src/app/admin/merch-studio/launch/record/page.tsx",
      "src/app/admin/merch-studio/launch/actions.ts",
    ]) {
      expect(read(p)).toContain('requirePermission("settings.manage")');
    }
  });
  it("ticks and notes are audited", () => {
    const a = read("src/app/admin/merch-studio/launch/actions.ts");
    expect(a).toContain("merch.launch_step_ticked");
    expect(a).toContain("merch.launch_step_unticked");
    expect(a).toContain("merch.launch_note_saved");
  });
  it("the Studio links Setup & Launch and shows the setup banner", () => {
    const s = read("src/app/admin/merch-studio/page.tsx");
    expect(s).toContain("/admin/merch-studio/launch");
    expect(s).toContain("Setup needs you");
    expect(s).toContain("latestMerchHealthReport");
  });
  it("Form 8.1 record page prints", () => {
    const r = read("src/app/admin/merch-studio/launch/record/page.tsx");
    expect(r).toMatch(/8\.1/);
    expect(read("src/components/admin/merch-studio/LaunchControls.tsx")).toContain("window.print");
  });
  it("helpers mention Setup & Launch", () => {
    expect(read("src/lib/admin/page-helpers-core.ts")).toContain("Setup & Launch");
  });
});
