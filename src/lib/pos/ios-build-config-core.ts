/**
 * src/lib/pos/ios-build-config-core.ts  (SLICE 9)
 *
 * PURE validators for the two native build settings that stand between the
 * register and a working iPad, plus the one build-time variable the packaged
 * app cannot run without.
 *
 * WHY THIS FILE EXISTS
 * The register web app, the Vite packaging build, the Xcode project, the CORS
 * bridge and the artwork were all finished long ago. What was NOT finishable
 * without a paid Apple Developer account were the settings Apple validates at
 * install/upload time. Those settings live in Info.plist, which is XML, which
 * nothing in this repository was checking. A wrong value there does not fail
 * `tsc`, does not fail `eslint`, and does not fail `vitest` — it fails on the
 * iPad, or worse, at upload, after the owner has spent an evening on it.
 *
 * So the rule this module encodes is: every native value that can silently
 * brick the install is validated here, purely, and asserted against the REAL
 * Info.plist by tests/compliance/pos-ios-build-config.test.ts.
 *
 * ── THE THREE FACTS THIS MODULE ENFORCES ───────────────────────────────────
 *
 * 1. REQUIRED DEVICE CAPABILITY MUST BE arm64, NEVER armv7.
 *    Capacitor's `npx cap add ios` scaffolds `UIRequiredDeviceCapabilities`
 *    with `armv7`. That value is a leftover from 32-bit iPhones. Every device
 *    that can run this app is 64-bit — including the owner's oldest test unit,
 *    an iPad Pro 12.9-inch 1st gen (model ML3K2LL/A, identifier iPad6,8,
 *    Apple A9X), which is arm64 and has no 32-bit mode at all.
 *
 *    Apple, UIRequiredDeviceCapabilities reference: "The App Store prevents
 *    customers from installing an app on a device that doesn't support the
 *    required capabilities for that app." Declaring armv7 therefore advertises
 *    a requirement no supported device satisfies.
 *
 *    Apple also warns, in the same reference, that this key is effectively
 *    one-way once shipped: "For app updates, you can only maintain or relax
 *    capability requirements. Submitting an update with added requirements
 *    would prevent some customers who previously downloaded your app from
 *    running the update." Fixing it BEFORE the first upload is free; fixing it
 *    after is not. That is why this is in the first slice.
 *
 * 2. ENCRYPTION EXPORT COMPLIANCE MUST BE DECLARED IN THE BUNDLE.
 *    `ITSAppUsesNonExemptEncryption` is the answer to the export-compliance
 *    question. When the key is absent, App Store Connect asks a human on EVERY
 *    upload before the build can be used. The register uses HTTPS only, which
 *    is exactly the exemption case, so the honest answer is `false` and it
 *    belongs in the file rather than in a human's memory.
 *
 * 3. THE PACKAGED APP MUST BE TOLD ITS SERVER, AND MUST REFUSE TO GUESS.
 *    In the browser the register calls "/api/pos/sync", which resolves against
 *    the page's own origin. Inside the app the SAME string resolves against
 *    `capacitor://localhost` — a path inside the app bundle that does not
 *    exist — so every call fails. `REGISTER_API_BASE` is what prevents that,
 *    and a build produced without it is dead on arrival. `describeApiBaseForBuild`
 *    exists so the build script can fail LOUD, at build time, on the Mac, with
 *    an explanation — instead of shipping an app that boots and then cannot
 *    ring a sale.
 *
 * PURE MODULE: no next/*, no I/O, no env reads at import time. Everything is a
 * function of its arguments (repo rule 5), so the same logic is exercised by
 * the embedded self-tests, by vitest, and by the build script.
 */

import { resolveApiBase } from "./api-base-core";

// ---------------------------------------------------------------------------
// 1. Required device capabilities
// ---------------------------------------------------------------------------

/**
 * The ONLY architecture capability this app may declare.
 *
 * Verified against Apple's "Required Device Capabilities" support page, which
 * lists `arm64` as a current value and `armv7` as a legacy 32-bit one.
 */
export const REQUIRED_DEVICE_CAPABILITY = "arm64";

/**
 * The scaffolded value we are replacing. Kept as a named constant so the
 * guard test can assert it is GONE rather than merely that arm64 is present
 * (both could be true at once, which would still be wrong).
 */
export const FORBIDDEN_DEVICE_CAPABILITY = "armv7";

/**
 * Capability values that must never appear for this app.
 *
 * The register is a cash till. It does not use the camera (ID scanning is a
 * keyboard-wedge/Bluetooth reader, not an image capture), the GPS, telephony,
 * or NFC. Declaring any of them would narrow the install base for no reason
 * and, per Apple's one-way rule above, could not be relaxed later without
 * stranding devices. "Specify only the features that your app absolutely
 * requires." — Apple, UIRequiredDeviceCapabilities.
 */
export const FORBIDDEN_CAPABILITIES: readonly string[] = [
  "armv6",
  "armv7",
  "telephony",
  "sms",
  "nfc",
  "gps",
  "still-camera",
  "video-camera",
  "front-facing-camera",
  "auto-focus-camera",
  "camera-flash",
  "microphone",
  "healthkit",
  "arkit",
  "gamekit",
];

export type CapabilityProblem = {
  code: "empty" | "forbidden" | "missing-arm64" | "duplicate";
  detail: string;
};

/**
 * Validate the `UIRequiredDeviceCapabilities` array.
 *
 * Returns [] when the array is exactly what this app should declare. Any
 * problem is returned with a plain-English `detail` so the failure message a
 * human reads explains the consequence, not just the rule.
 */
export function auditRequiredDeviceCapabilities(
  values: readonly string[],
): CapabilityProblem[] {
  const problems: CapabilityProblem[] = [];

  if (values.length === 0) {
    problems.push({
      code: "empty",
      detail:
        "UIRequiredDeviceCapabilities is empty. Declare arm64 so the App Store " +
        "only offers this app to 64-bit devices.",
    });
    return problems;
  }

  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim().toLowerCase();
    if (seen.has(v)) {
      problems.push({ code: "duplicate", detail: `"${v}" is listed more than once.` });
      continue;
    }
    seen.add(v);

    if (FORBIDDEN_CAPABILITIES.includes(v)) {
      const why =
        v === FORBIDDEN_DEVICE_CAPABILITY || v === "armv6"
          ? `"${v}" is a 32-bit architecture. Every device that can run this app ` +
            "is 64-bit (the oldest test unit, iPad Pro 12.9-inch 1st gen / iPad6,8, " +
            "is Apple A9X — arm64 only), so this requirement can never be satisfied."
          : `"${v}" is hardware this register does not use. Declaring it needlessly ` +
            "blocks devices, and Apple only allows requirements to be relaxed, never added, after release.";
      problems.push({ code: "forbidden", detail: why });
    }
  }

  if (!seen.has(REQUIRED_DEVICE_CAPABILITY)) {
    problems.push({
      code: "missing-arm64",
      detail:
        `"${REQUIRED_DEVICE_CAPABILITY}" is not declared. It is the one capability ` +
        "this app genuinely requires.",
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 2. Encryption export compliance
// ---------------------------------------------------------------------------

/**
 * The register's honest answer to the export-compliance question.
 *
 * `false` = "my app uses no non-exempt encryption". The register speaks HTTPS
 * to its own server and nothing else: no proprietary crypto, no encryption
 * beyond what Apple itself provides. That is the textbook exemption.
 *
 * This is a COMPLIANCE STATEMENT, not a preference. It is correct only while
 * the app's cryptography remains limited to standard HTTPS. If the app ever
 * ships its own encryption, this value and this comment must be revisited.
 */
export const USES_NON_EXEMPT_ENCRYPTION = false;

export type EncryptionDeclaration =
  | { declared: true; value: boolean }
  | { declared: false; value: null };

/**
 * Explain, in plain English, what a given declaration means for the owner's
 * upload experience. Used by the guard test and by the walkthrough document so
 * the two can never drift apart.
 */
export function describeEncryptionDeclaration(d: EncryptionDeclaration): string {
  if (!d.declared) {
    return (
      "ITSAppUsesNonExemptEncryption is missing. App Store Connect will stop and ask " +
      "an export-compliance question on EVERY upload before the build can be used."
    );
  }
  if (d.value) {
    return (
      "ITSAppUsesNonExemptEncryption is true, which claims this app ships non-exempt " +
      "encryption. That is not true of this register (HTTPS only) and would invite " +
      "documentation requirements that do not apply."
    );
  }
  return (
    "ITSAppUsesNonExemptEncryption is false — the correct, honest answer for an app " +
    "whose only cryptography is standard HTTPS. Uploads proceed without the question."
  );
}

// ---------------------------------------------------------------------------
// 3. The build-time server address
// ---------------------------------------------------------------------------

/** The environment variable the Vite build reads (register-app/vite.config.ts). */
export const API_BASE_ENV_VAR = "REGISTER_API_BASE";

export type BuildTarget = "browser" | "native";

export type ApiBaseVerdict =
  | { ok: true; base: string; message: string }
  | { ok: false; base: null; message: string };

/**
 * Decide whether a build may proceed with the given API base.
 *
 * The asymmetry is deliberate and is the whole point:
 *
 *   • browser build → an EMPTY base is correct. The page is served from the
 *     same origin as the API, so relative paths already work. Requiring a base
 *     here would force a pointless cross-origin hop.
 *
 *   • native build  → an empty base is FATAL. "/api/pos/sync" would resolve to
 *     capacitor://localhost/api/pos/sync, a file that does not exist in the
 *     bundle. The app would install, launch, and then be unable to unlock,
 *     sync, or ring a sale. Better to fail on the Mac in one second than at
 *     the counter in front of a customer.
 *
 * Validation of the URL itself is delegated to `resolveApiBase` (api-base-core)
 * rather than duplicated, so there is exactly one definition of a legal base:
 * https only (localhost exempt), origin-only, no trailing slash.
 */
export function describeApiBaseForBuild(
  raw: string | null | undefined,
  target: BuildTarget,
): ApiBaseVerdict {
  const value = (raw ?? "").trim();

  if (value === "") {
    if (target === "browser") {
      return {
        ok: true,
        base: "",
        message:
          "No API base set — correct for the browser build. The register will use " +
          "same-origin relative paths, exactly as it does today.",
      };
    }
    return {
      ok: false,
      base: null,
      message:
        `${API_BASE_ENV_VAR} is not set, so the packaged iPad app would have no server ` +
        "address. Inside the app, \"/api/pos/sync\" resolves against capacitor://localhost " +
        "— a file inside the app bundle that does not exist — so the register would " +
        "install, launch, and then be unable to unlock, sync, or ring a sale.\n" +
        `Fix: ${API_BASE_ENV_VAR}="https://your-back-office-domain" npm run register:build:ios`,
    };
  }

  const resolved = resolveApiBase(value);
  if (!resolved.ok) {
    return {
      ok: false,
      base: null,
      message: `${API_BASE_ENV_VAR} is set to "${value}", which is not usable: ${resolved.error}`,
    };
  }

  return {
    ok: true,
    base: resolved.base,
    message: `The app will call ${resolved.base}/api/pos/… for every request.`,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (repo rule 5)
// ---------------------------------------------------------------------------

export function __runIosBuildConfigCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ios-build-config-core FAIL: ${label}`);
    }
  };

  // ── constants ───────────────────────────────────────────────────────────
  ok(REQUIRED_DEVICE_CAPABILITY === "arm64", "the required capability is arm64");
  ok(FORBIDDEN_DEVICE_CAPABILITY === "armv7", "the scaffolded value we remove is armv7");
  ok(FORBIDDEN_CAPABILITIES.includes("armv7"), "armv7 is on the forbidden list");
  ok(FORBIDDEN_CAPABILITIES.includes("armv6"), "armv6 is on the forbidden list");
  ok(!FORBIDDEN_CAPABILITIES.includes("arm64"), "arm64 is NOT forbidden");
  ok(USES_NON_EXEMPT_ENCRYPTION === false, "the app declares no non-exempt encryption");
  ok(API_BASE_ENV_VAR === "REGISTER_API_BASE", "env var name matches vite.config.ts");

  // ── capability audit: the good case ─────────────────────────────────────
  ok(auditRequiredDeviceCapabilities(["arm64"]).length === 0, "['arm64'] is clean");
  ok(
    auditRequiredDeviceCapabilities(["ARM64"]).length === 0,
    "capability comparison is case-insensitive",
  );
  ok(
    auditRequiredDeviceCapabilities([" arm64 "]).length === 0,
    "surrounding whitespace is tolerated",
  );

  // ── capability audit: the exact bug this slice fixes ─────────────────────
  const armv7Only = auditRequiredDeviceCapabilities(["armv7"]);
  ok(armv7Only.length === 2, "['armv7'] reports BOTH forbidden and missing-arm64");
  ok(
    armv7Only.some((p) => p.code === "forbidden"),
    "['armv7'] is reported as forbidden",
  );
  ok(
    armv7Only.some((p) => p.code === "missing-arm64"),
    "['armv7'] is reported as missing arm64",
  );
  ok(
    armv7Only.some((p) => p.detail.includes("iPad6,8")),
    "the armv7 message names the owner's actual test iPad",
  );

  // both present is still wrong — armv7 must be GONE, not merely joined
  const both = auditRequiredDeviceCapabilities(["armv7", "arm64"]);
  ok(both.length === 1 && both[0].code === "forbidden", "arm64 does not excuse armv7");

  // ── capability audit: other failure modes ───────────────────────────────
  const empty = auditRequiredDeviceCapabilities([]);
  ok(empty.length === 1 && empty[0].code === "empty", "an empty array is reported once");
  const dup = auditRequiredDeviceCapabilities(["arm64", "arm64"]);
  ok(dup.length === 1 && dup[0].code === "duplicate", "a duplicate is reported");
  ok(
    auditRequiredDeviceCapabilities(["arm64", "still-camera"]).some(
      (p) => p.code === "forbidden",
    ),
    "camera is refused — the register does not take pictures",
  );
  ok(
    auditRequiredDeviceCapabilities(["arm64", "nfc"]).some((p) => p.code === "forbidden"),
    "nfc is refused — nothing in the register reads NFC",
  );
  ok(
    auditRequiredDeviceCapabilities(["arm64", "bluetooth-le"]).length === 0,
    "bluetooth-le is permitted (not required, but not forbidden) for future hardware",
  );

  // ── encryption declaration ──────────────────────────────────────────────
  ok(
    describeEncryptionDeclaration({ declared: false, value: null }).includes("EVERY upload"),
    "a missing declaration explains the repeated upload question",
  );
  ok(
    describeEncryptionDeclaration({ declared: true, value: false }).includes("correct"),
    "false is described as correct",
  );
  ok(
    describeEncryptionDeclaration({ declared: true, value: true }).includes("not true"),
    "true is described as inaccurate for this app",
  );

  // ── API base: the browser/native asymmetry ──────────────────────────────
  const browserEmpty = describeApiBaseForBuild("", "browser");
  ok(browserEmpty.ok && browserEmpty.base === "", "empty base is OK for the browser build");
  const nativeEmpty = describeApiBaseForBuild("", "native");
  ok(!nativeEmpty.ok, "empty base is FATAL for the native build");
  ok(
    nativeEmpty.message.includes("capacitor://localhost"),
    "the native failure explains WHY, naming the origin",
  );
  ok(
    nativeEmpty.message.includes(API_BASE_ENV_VAR),
    "the native failure names the variable to set",
  );
  ok(
    describeApiBaseForBuild(null, "native").ok === false,
    "null is treated as unset for native",
  );
  ok(
    describeApiBaseForBuild(undefined, "browser").ok === true,
    "undefined is fine for browser",
  );
  ok(
    describeApiBaseForBuild("   ", "native").ok === false,
    "whitespace-only is treated as unset",
  );

  // ── API base: validation is delegated, not duplicated ───────────────────
  const good = describeApiBaseForBuild("https://greenwaywebsite1.vercel.app", "native");
  ok(good.ok, "a valid https base is accepted for native");
  ok(
    good.ok && good.base === "https://greenwaywebsite1.vercel.app",
    "the accepted base is returned normalized",
  );
  const trailing = describeApiBaseForBuild("https://example.com/", "native");
  ok(
    trailing.ok && trailing.base === "https://example.com",
    "a trailing slash is normalized away",
  );
  ok(
    describeApiBaseForBuild("http://example.com", "native").ok === false,
    "http is refused — a POS carries PII and device keys",
  );
  ok(
    describeApiBaseForBuild("not a url", "native").ok === false,
    "a malformed base is refused",
  );
  ok(
    good.message.includes("/api/pos/"),
    "the success message shows what the app will actually call",
  );

  return { passed, failed };
}
