import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runIosBuildConfigCoreTests,
  API_BASE_ENV_VAR,
  auditRequiredDeviceCapabilities,
  describeApiBaseForBuild,
  FORBIDDEN_DEVICE_CAPABILITY,
  REQUIRED_DEVICE_CAPABILITY,
  USES_NON_EXEMPT_ENCRYPTION,
} from "../../src/lib/pos/ios-build-config-core";

/**
 * SLICE 9 — the native build settings that decide whether the register runs.
 *
 * Like pos-capacitor-config.test.ts, these read the REAL Info.plist rather than
 * a fixture. A fixture would only prove the validator can validate a copy of
 * itself. The risk being managed is DRIFT — specifically, that someone re-runs
 * `npx cap add ios`, which regenerates Info.plist from Capacitor's template and
 * silently restores `armv7` and drops the export-compliance key.
 *
 * That regression is invisible to tsc, eslint and every other test in this
 * repository. It surfaces on the iPad, or at upload. So it gets a tripwire.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const infoPlistPath = path.join(repoRoot, "ios", "App", "App", "Info.plist");
const infoPlist = readFileSync(infoPlistPath, "utf8");

/** Same reader the preflight script uses, so the test proves the real parse. */
function readCapabilities(xml: string): string[] {
  const block = xml.match(
    /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) return [];
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].trim());
}

describe("pos/ios-build-config-core pure self-tests", () => {
  it("passes every embedded self-test", () => {
    const { passed, failed } = __runIosBuildConfigCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(30);
  });
});

describe("the real ios/App/App/Info.plist", () => {
  it("is well-formed XML with a single top-level dict", () => {
    expect(infoPlist).toContain("<!DOCTYPE plist");
    expect(infoPlist).toContain('<plist version="1.0">');
    // A truncated or double-written plist is a real failure mode of scripted
    // edits; count the structural tags rather than trusting the edit.
    expect(infoPlist.match(/<plist/g)?.length).toBe(1);
    expect(infoPlist.match(/<\/plist>/g)?.length).toBe(1);
  });

  it("requires arm64 and NOT armv7", () => {
    // The bug this slice fixes. Capacitor scaffolds `armv7`, a 32-bit
    // architecture. The oldest device that will ever run this app is Michael's
    // test unit — iPad Pro 12.9-inch 1st gen (ML3K2LL/A, iPad6,8, Apple A9X) —
    // which is arm64 only. `armv7` therefore declares a requirement that NO
    // supported device satisfies.
    const caps = readCapabilities(infoPlist);
    expect(caps).toEqual([REQUIRED_DEVICE_CAPABILITY]);
    expect(caps).not.toContain(FORBIDDEN_DEVICE_CAPABILITY);
    expect(auditRequiredDeviceCapabilities(caps)).toEqual([]);
  });

  it("contains the string armv7 nowhere at all", () => {
    // Belt and braces: catches a stray armv7 in a comment, a second array, or
    // a platform-suffixed key the regex above would not look at.
    expect(infoPlist).not.toContain("armv7");
    expect(infoPlist).not.toContain("armv6");
  });

  it("answers the export-compliance question in the bundle", () => {
    // Without this key App Store Connect stops and asks a human on EVERY
    // upload before the build can be used. `false` is the honest answer: the
    // register's only cryptography is standard HTTPS.
    expect(USES_NON_EXEMPT_ENCRYPTION).toBe(false);
    expect(infoPlist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/,
    );
    expect(infoPlist).not.toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<true\s*\/>/,
    );
  });

  it("declares no hardware the register does not use", () => {
    // Apple only permits device requirements to be RELAXED after release,
    // never added. Anything listed here is effectively permanent, so the list
    // stays at exactly one entry.
    const caps = readCapabilities(infoPlist);
    expect(caps).toHaveLength(1);
    for (const unused of ["telephony", "nfc", "gps", "still-camera", "microphone"]) {
      expect(caps).not.toContain(unused);
    }
  });

  it("still carries the agreed display name", () => {
    // Guards against a wholesale regeneration of the file, which would take
    // the name with it.
    expect(infoPlist).toContain("Greenway Point of Transaction");
  });
});

describe("the iPad build cannot be produced without a server address", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  it("exposes register:build:ios and gates it behind the preflight", () => {
    const build = pkg.scripts?.["register:build:ios"];
    expect(build).toBeDefined();
    // The preflight must run FIRST and be chained with && so a failure stops
    // the build rather than merely printing a warning above it.
    expect(build).toContain("register:preflight:ios");
    expect(build?.indexOf("register:preflight:ios")).toBeLessThan(
      build?.indexOf("vite build") ?? Infinity,
    );
    expect(build).toContain("&&");
  });

  it("keeps the plain register:build (browser) unchanged and ungated", () => {
    // The web PWA is served from the same origin as the API, so it needs no
    // base and must not inherit the native requirement.
    expect(pkg.scripts?.["register:build"]).toBe(
      "vite build --config register-app/vite.config.ts",
    );
    expect(pkg.scripts?.["register:build"]).not.toContain("preflight");
  });

  it("names the same environment variable the vite config actually reads", () => {
    // If these ever diverge, the preflight would validate a variable the build
    // ignores — a green check on a broken app.
    const vite = readFileSync(
      path.join(repoRoot, "register-app/vite.config.ts"),
      "utf8",
    );
    expect(vite).toContain(API_BASE_ENV_VAR);
    expect(vite).toContain("__REGISTER_API_BASE__");
  });

  it("refuses an empty or insecure base for native, but allows empty for browser", () => {
    expect(describeApiBaseForBuild("", "native").ok).toBe(false);
    expect(describeApiBaseForBuild("http://example.com", "native").ok).toBe(false);
    expect(describeApiBaseForBuild("", "browser").ok).toBe(true);
  });
});

describe("the preflight script itself", () => {
  const source = readFileSync(
    path.join(repoRoot, "scripts/pos/preflight-ios-build.ts"),
    "utf8",
  );

  it("delegates every judgement to the pure core", () => {
    // The script may do I/O; it may not re-implement the rules, or the rules
    // could drift from the ones under test.
    expect(source).toContain("ios-build-config-core");
    expect(source).toContain("auditRequiredDeviceCapabilities");
    expect(source).toContain("describeApiBaseForBuild");
    expect(source).not.toContain('"armv7"');
  });

  it("exits non-zero on failure so the build chain actually stops", () => {
    expect(source).toContain("process.exit(1)");
  });
});
