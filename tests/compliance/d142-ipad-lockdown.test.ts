import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import capacitorConfig from "../../capacitor.config";
import { can } from "../../src/lib/auth/roles";
import {
  __runRegisterFingerprintTests,
  parseVersionCheck,
  registerVersionVerdict,
  sanitizeFingerprint,
  serializeVersionCheck,
} from "../../src/lib/pos/register-fingerprint-core";
import {
  __runIpadSetupTests,
  checklistProgress,
  DEFAULT_LOCKDOWN_POLICY,
  deviceHealthVerdict,
  guidedAccessGate,
  IPAD_SETUP_CHECKLIST,
  sanitizeDeviceHealthReport,
} from "../../src/lib/pos/ipad-setup-core";
import { computeRegisterFingerprintDetailed } from "../../scripts/pos/register-fingerprint";

/**
 * D142–D150: iPad offline hardening, lockdown and "am I on the newest
 * version?" (owner, 2026-11-03: "Please add to the lock screen of the app
 * something bold that says I am running the newest version and all is good.")
 */
const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

describe("D143 register version fingerprint", () => {
  it("pure self-tests pass", () => {
    const r = __runRegisterFingerprintTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("computes a stable fingerprint over the real register source with no unresolved imports", () => {
    const a = computeRegisterFingerprintDetailed(root);
    const b = computeRegisterFingerprintDetailed(root);
    expect(a).not.toBeNull();
    expect(a!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect(a!.files).toBeGreaterThan(30);
    expect(a!.manifest).not.toContain("unresolved:");
  });

  it("green only when the app and server fingerprints match", () => {
    expect(registerVersionVerdict({ appFingerprint: FP_A, serverFingerprint: FP_A, online: true }).state).toBe("current");
    expect(registerVersionVerdict({ appFingerprint: FP_A, serverFingerprint: FP_B, online: true }).state).toBe("outdated");
    expect(registerVersionVerdict({ appFingerprint: null, serverFingerprint: FP_A, online: true }).state).toBe("unverifiable");
    expect(registerVersionVerdict({ appFingerprint: FP_A, serverFingerprint: FP_A, online: true }).headline).toBe(
      "NEWEST VERSION — ALL GOOD",
    );
  });

  it("remembers the last confirmation only for the same build", () => {
    const raw = serializeVersionCheck(FP_A, 1_700_000_000_000);
    expect(parseVersionCheck(raw, FP_A)).toBe(1_700_000_000_000);
    expect(parseVersionCheck(raw, FP_B)).toBeNull();
    expect(sanitizeFingerprint("nothex!")).toBeNull();
  });

  it("is wired into the Vite build, the Next server and the version route", () => {
    expect(read("register-app/vite.config.ts")).toMatch(/__REGISTER_FINGERPRINT__:\s*JSON\.stringify\(computeRegisterFingerprint/);
    expect(read("register-app/src/main.tsx")).toContain("appFingerprint={__REGISTER_FINGERPRINT__");
    expect(read("next.config.ts")).toMatch(/REGISTER_FINGERPRINT:\s*computeRegisterFingerprint\(/);
    expect(read("src/app/api/pos/version/route.ts")).toMatch(/fingerprint:\s*sanitizeFingerprint\(process\.env\.REGISTER_FINGERPRINT\)/);
    expect(read("scripts/pos/preflight-ios-build.ts")).toContain("this build will be");
  });

  it("the lock screen renders the bold version banner", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain("<VersionBanner verdict={versionVerdict} />");
    expect(shell).toContain("data-version-state={verdict.state}");
  });
});

describe("D145–D148 iPad setup, lockdown and device health", () => {
  it("pure self-tests pass", () => {
    const r = __runIpadSetupTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("only the owner can change the lockdown policy or checklist", () => {
    expect(can("owner", "registers.lockdown")).toBe(true);
    for (const r of ["admin", "manager", "staff"] as const) expect(can(r, "registers.lockdown")).toBe(false);
    const actions = read("src/app/admin/registers/ipad-setup/actions.ts");
    expect(actions.match(/requirePermission\("registers\.lockdown"\)/g)?.length).toBe(2);
    expect(actions.match(/recordAudit\(/g)?.length).toBe(2);
  });

  it("checklist covers pinning the app with an owner-only Guided Access passcode", () => {
    const ids = IPAD_SETUP_CHECKLIST.map((i) => i.id);
    for (const id of ["ga-enable", "ga-passcode", "ga-start", "autolock", "rebuild", "drill-offline"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a tick the device disproves is not counted as done", () => {
    const marks = { "ga-start": { at: "2026-11-03T00:00:00Z", by: "Michael" } };
    const p = checklistProgress(marks, { guidedAccess: false });
    expect(p.contradicted).toContain("ga-start");
  });

  it("guided access gate: warn shows, block blocks, browser never blocked", () => {
    const native = sanitizeDeviceHealthReport({ native: { guidedAccess: false } })!.native;
    expect(guidedAccessGate(DEFAULT_LOCKDOWN_POLICY, native)).toMatchObject({ show: true, block: false });
    expect(guidedAccessGate({ ...DEFAULT_LOCKDOWN_POLICY, guidedAccess: "block" }, native)).toMatchObject({ show: true, block: true });
    expect(guidedAccessGate({ ...DEFAULT_LOCKDOWN_POLICY, guidedAccess: "block" }, null)).toEqual({ show: false });
  });

  it("flags stale active devices and outdated builds", () => {
    const v = deviceHealthVerdict({
      status: "active",
      lastSeenAt: "2026-11-01T00:00:00Z",
      report: sanitizeDeviceHealthReport({ fingerprint: FP_B, pending: 0 }),
      serverFingerprint: FP_A,
      policy: DEFAULT_LOCKDOWN_POLICY,
      nowMs: Date.parse("2026-11-05T00:00:00Z"),
    });
    expect(v.stale).toBe(true);
    expect(v.version).toBe("outdated");
    expect(v.overall).toBe("bad");
  });

  it("the sync route stores health and returns the lockdown policy", () => {
    const sync = read("src/app/api/pos/sync/route.ts");
    expect(sync).toContain("recordDeviceHealth(");
    expect(sync).toContain("const lockdown = await getIpadLockdownPolicy()");
  });

  it("the back office links to the iPad setup page", () => {
    expect(read("src/app/admin/registers/page.tsx")).toContain("${BASE}/ipad-setup");
  });
});

describe("D144 status bar does not collide with the register header", () => {
  it("native: status bar hidden in Info.plist, the view controller and SystemBars", () => {
    expect(read("ios/App/App/Info.plist")).toMatch(/<key>UIStatusBarHidden<\/key>\s*<true\/>/);
    const vc = read("ios/App/App/GreenwayBridgeViewController.swift");
    expect(vc).toMatch(/override public var prefersStatusBarHidden: Bool\s*\{\s*return true\s*\}/);
    expect((capacitorConfig.plugins as Record<string, { hidden?: boolean }> | undefined)?.SystemBars?.hidden).toBe(true);
  });

  it("the device-status plugin is registered inside capacitorDidLoad", () => {
    const vc = read("ios/App/App/GreenwayBridgeViewController.swift");
    const body = vc.match(/override public func capacitorDidLoad\(\)\s*\{([\s\S]*?)\n {4}\}/);
    expect(body).not.toBeNull();
    expect(body![1]).toContain("registerPluginInstance(GreenwayDevicePlugin())");
    expect(vc).toContain('jsName = "GreenwayDevice"');
  });

  it("the device bridge stays browser-safe (no server-only imports)", () => {
    const src = read("src/lib/pos/greenway-device.ts");
    expect(src).not.toMatch(/from "(next\/|server-only|node:)/);
  });
});
