/**
 * R74 S53 - onboarding batch lookup auto-send, live stage/ETA, attach
 * facts + strain types on onboarding, three Gemini options only, and the
 * Batch Lookups page cleanup (Round 34).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runOnboardingBatchSendCoreTests,
  autoSendControl,
  batchesFor,
  deliveryLookupHeader,
  onboardingBatchStage,
  planOnboardingAttach,
  attachSentence,
  onboardingLookupBanner,
  OBL_CODES,
} from "../../src/lib/ai/onboarding-batch-send-core";
import { OPEN_CONTROL } from "../../src/lib/ai/batch-console-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const JOB = "11111111-1111-4111-8111-111111111111";

describe("R74 S53 pure core", () => {
  it("self-test passes with exactly 38 assertions and is pinned in the runner", () => {
    const r = __runOnboardingBatchSendCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(38);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runOnboardingBatchSendCoreTests");
    expect(runner).toMatch(/r\.passed < 38/);
  });

  it("auto-send turns a manual, zero-budget control into one that sends this job first", () => {
    const cur = { ...OPEN_CONTROL, mode: "manual" as const, budget: 0, paused: true, pausedJobIds: [JOB] };
    const plan = autoSendControl(cur, { jobIds: [JOB], unsentItems: 450 });
    expect(plan.changed).toBe(true);
    expect(plan.next.paused).toBe(false);
    expect(plan.next.pausedJobIds).not.toContain(JOB);
    expect(plan.next.priorityJobIds[0]).toBe(JOB);
    expect(plan.next.budget).toBeGreaterThanOrEqual(batchesFor(450));
  });

  it("nothing to send leaves the control untouched", () => {
    const plan = autoSendControl(OPEN_CONTROL, { jobIds: [JOB], unsentItems: 0 });
    expect(plan.changed).toBe(false);
    expect(plan.next).toBe(OPEN_CONTROL);
  });

  it("header names vendor and manifest; banner codes resolve; sentence never claims approval", () => {
    expect(deliveryLookupHeader("Ace Farms", "0042")).toContain("Ace Farms");
    expect(deliveryLookupHeader("Ace Farms", "0042")).toContain("0042");
    for (const c of OBL_CODES) expect(onboardingLookupBanner(c, null)).not.toBeNull();
    expect(attachSentence({ products: 3, facts: 9, strains: 2, skipped: 0, left: 0, errors: [] })).toMatch(/Nothing was approved/);
    expect(typeof onboardingBatchStage).toBe("function");
    expect(typeof planOnboardingAttach).toBe("function");
  });
});

describe("R74 S53 server wiring", () => {
  const send = read("src/lib/ai/onboarding-batch-send-server.ts");
  const attach = read("src/lib/catalog/onboarding-confidence-server.ts");
  const strain = read("src/lib/inventory/onboarding-strain-store.ts");

  it("server files are server-only", () => {
    for (const s of [send, attach, strain]) expect(s).toMatch(/import "server-only"/);
  });

  it("auto-send writes the control, guards the engine flag and kicks a tick after the response", () => {
    expect(send).toContain("writeBatchControl(");
    expect(send).toContain("batchEngineOn(");
    expect(send).toMatch(/runAfterResponse\(\s*"onboarding-batch-send"/);
    expect(send).toContain("runGeminiBatchTick(");
  });

  it("strain store only fills an empty strain and stamps human provenance", () => {
    expect(strain).toContain('.or("chosen_strain_type.is.null,chosen_strain_type.eq.unknown")');
    expect(strain).toContain("ONBOARDING_PICK_PROVENANCE.human");
    expect(strain).toContain("validateStrainTypeChoice");
  });

  it("onboarding attach never approves", () => {
    expect(attach).not.toMatch(/approveDraft/);
    expect(attach).toContain("attachProductFacts");
    expect(attach).toContain("setDraftStrainIfEmpty");
  });

  it("the tick honours priorityJobIds", () => {
    expect(read("src/lib/ai/gemini-batch-server.ts")).toContain("control.priorityJobIds");
  });
});

describe("R74 S53 onboarding page", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const actions = read("src/app/admin/inventory/drafts/actions.ts");

  it("press wiring: look-up-all and search-again auto-send; three new actions", () => {
    expect(actions).toContain("sendFromOnboarding(");
    for (const a of ["lookupVendorFromOnboardingAction", "sendToGoogleNowAction", "attachOnboardingConfidenceAction"]) {
      expect(actions).toContain(`export async function ${a}`);
    }
  });

  it("shows header, stage, counter, ETA, vendor button and attach panel", () => {
    for (const id of [
      "onboarding-lookup-header",
      "onboarding-batch-stage",
      "onboarding-batch-headline",
      "onboarding-batch-counter",
      "onboarding-batch-eta",
      "onboarding-send-now",
      "onboarding-vendor-lookup",
      "onboarding-attach",
      "onboarding-attach-confident",
      "onboarding-attach-all",
      "onboarding-attach-selected",
      "onboarding-lookup-result",
      "onboarding-more-tools",
    ]) {
      expect(page).toContain(`data-testid="${id}"`);
    }
  });

  it("extra Gemini tools are hidden behind ?tools=1", () => {
    expect(page).toContain('const showTools = sp.tools === "1"');
    expect(page).toMatch(/\(showTools \|\| sprintStatus\.tone === "bad"\) && <GeminiSprintStatus/);
    expect(page).toContain("showTools && harvest && harvest.total > 0");
    expect(page).toContain("showTools && focusIsRebuilt && focus.manifestId");
  });
});

describe("R74 S53 Batch Lookups cleanup", () => {
  const bl = read("src/app/admin/inventory/batch-lookups/page.tsx");
  it("retires Smart batching and Vendor confidence tabs but keeps them reachable", () => {
    expect(bl).toContain('new Set<Tab>(["smart", "confidence"])');
    expect(bl).toContain("visibleTabs");
    expect(bl).toContain('data-testid="batch-older-tools"');
  });
  it("tells the owner onboarding auto-sends and keeps the manual Send", () => {
    expect(bl).toContain('data-testid="batch-onboarding-note"');
    expect(bl).toContain("it sends by itself");
    expect(read("src/app/admin/inventory/batch-lookups/MissionTab.tsx")).toMatch(/allowBatchesAction/);
  });
});
