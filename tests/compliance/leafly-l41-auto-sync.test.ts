/**
 * SLICE L-41 -- "i can not get the auto sync feature to turn on"
 *
 * Two defects, both pinned here:
 *
 *   1. THE READ. The save action stores `{ ..., schedule: {...} }`; the
 *      scheduler handed the whole blob to the schedule resolver and read every
 *      saved schedule as OFF. Reproduced below through the REAL save shape.
 *   2. THE SEND. Once readable, the scheduler would have sent through the
 *      all-or-nothing `pushLeaflyMenu` and failed on every tick. Automatic
 *      runs now use the same build as "Send my whole menu, hold back only the
 *      bad ones", and the verb is chosen by the pure planner.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readStoredLeaflySchedule,
  resolveLeaflySettings,
} from "@/lib/syndication/sync-settings-core";
import { resolveScheduleSettings, describeSchedule } from "@/lib/leafly/schedule-core";
import {
  __runLeaflyAutoSyncTests,
  planAutomaticTransmission,
} from "@/lib/leafly/auto-sync-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("L-41 defect 1: a saved schedule reads back as saved", () => {
  // Exactly what saveLeaflyScheduleAction does: resolve the form into a
  // schedule, spread it into the existing settings, write the whole object.
  const existing = resolveLeaflySettings({ sendImages: true });
  const schedule = resolveScheduleSettings({
    enabled: true,
    dailyFullHour: 4,
    intradayEnabled: true,
    intradayMinutes: 60,
    repairSizes: true,
  });
  const stored = JSON.parse(JSON.stringify({ ...existing, schedule })) as Record<string, unknown>;

  it("the stored blob keeps the schedule nested", () => {
    expect((stored.schedule as Record<string, unknown>).enabled).toBe(true);
    expect(stored.enabled).toBeUndefined();
  });

  it("the new reader reads it as ON, with every field intact", () => {
    const s = readStoredLeaflySchedule(stored);
    expect(s.enabled).toBe(true);
    expect(s.dailyFullHour).toBe(4);
    expect(s.intradayMinutes).toBe(60);
    expect(s.repairSizes).toBe(true);
  });

  it("the old reader (the bug) really did read it as OFF -- so this test can see the bug", () => {
    expect(resolveScheduleSettings(stored).enabled).toBe(false);
  });

  it("the scheduler uses the new reader, not the whole blob", () => {
    const src = code("src/lib/leafly/schedule-server.ts");
    const fn = /export async function getLeaflyScheduleSettings\([\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(fn).toContain("readStoredLeaflySchedule(raw)");
    expect(fn).not.toContain("resolveScheduleSettings(raw)");
  });

  it("the save action and the panel both carry repairSizes explicitly", () => {
    expect(code("src/app/admin/integrations/leafly/actions.ts")).toContain('repairSizes: readBool("repairSizes")');
    expect(code("src/components/admin/syndication/LeaflySchedulePanel.tsx")).toContain(
      'fd.set("repairSizes", repairSizes ? "true" : "false")',
    );
  });

  it("toggling the repair changes the preview sentence, so the Save button knows it is dirty", () => {
    const a = describeSchedule({ ...schedule, repairSizes: false });
    const b = describeSchedule({ ...schedule, repairSizes: true });
    expect(a).not.toBe(b);
  });
});

describe("L-41 defect 2: automatic runs send through the path that works", () => {
  const scheduler = code("src/lib/leafly/schedule-server.ts");
  const auto = code("src/lib/leafly/auto-sync-server.ts");

  it("the scheduler calls pushLeaflyAutomatic, never pushLeaflyMenu", () => {
    expect(scheduler).toContain("pushLeaflyAutomatic({ kind, repair: settings.repairSizes })");
    expect(scheduler).not.toMatch(/pushLeaflyMenu\s*\(/);
  });

  it("automatic runs build with the full-menu engine the owner trusts", () => {
    expect(auto).toContain("fullMenuInternals.buildFullMenuDecision(");
    expect(auto).toContain("planAutomaticTransmission(");
  });

  it("the verb is the planner's, not a literal POST", () => {
    expect(auto).toContain("autoSyncMethod(plan)");
    // A literal VALUE (`method: "POST",`), not the result type union.
    expect(auto).not.toMatch(/method:\s*"POST"\s*[,}]/);
  });

  it("deletes only after a successful send, and only the planner's genuinely-gone ids", () => {
    expect(auto).toMatch(/if \(sendOk && plan\.action === "put" && plan\.deleteIds\.length > 0\)/);
    expect(auto).toContain("buildLeaflyDeletePayload(plan.deleteIds)");
  });

  it("split families are protected from deletion via splitParentId", () => {
    expect(auto).toContain("familyOf: (id) => splitParentId(id) ?? id");
  });

  it("adds no new outbound Leafly call site -- it reuses push.ts's bounded authedFetch", () => {
    expect(auto).not.toContain("leaflyFetchWithDeadline");
    expect(auto).not.toMatch(/(?:^|[^.\w])fetch\s*\(/m);
    expect(code("src/lib/leafly/push.ts")).toContain(
      "authedFetch(menuItemsUrl(), input.method, input.operation, input.body",
    );
  });

  it("the held-back products are named in the durable log", () => {
    expect(auto).toContain("Held back ${heldNames.length}: ${heldNames.join(\"; \")}");
  });

  it("the full-menu button file still has no POST or DELETE (unchanged guarantee)", () => {
    const fm = read("src/lib/leafly/full-menu-server.ts");
    expect(fm).not.toMatch(/authedFetch\([^)]*"POST"/);
    expect(fm).not.toMatch(/authedFetch\([^)]*"DELETE"/);
  });
});

describe("L-41 planner, exercised directly", () => {
  it("self-tests pass with a floor", () => {
    const r = __runLeaflyAutoSyncTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(66);
  });

  it("the owner's real situation: daily run with a few bad products -> PUT, nothing held back is deleted", () => {
    const send = Array.from({ length: 200 }, (_, i) => ({ id: `ok${i}`, hash: `h${i}` }));
    const withheldIds = ["bad1", "bad2", "bad3"];
    const previous = new Map<string, string>([
      ...send.map((s) => [s.id, s.hash] as [string, string]),
      ["bad1", "old"],
      ["retired", "x"],
    ]);
    const p = planAutomaticTransmission({
      kind: "daily_full",
      planProceeds: true,
      planNarrative: "",
      send,
      withheldIds,
      previous,
      forceResend: false,
    });
    expect(p.action).toBe("put");
    expect(p.postDowngraded).toBe(true);
    expect(p.putIds.length).toBe(200);
    expect(p.deleteIds).toEqual(["retired"]);
    expect(p.protectedIds).toEqual(["bad1"]);
  });
});
