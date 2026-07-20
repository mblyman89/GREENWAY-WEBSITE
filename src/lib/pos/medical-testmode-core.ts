/**
 * POS Slice 5 — Medical "TEST MODE" endorsement simulation (pure core).
 *
 * WHY THIS EXISTS
 * ---------------
 * The medical tax exemptions (sales tax + the 37% excise) only come off the
 * price when the STORE holds a valid LCB medical endorsement — in the code that
 * is `bundle.medical.endorsed`, which the server sets from the durable
 * `medical_endorsement_config.is_medically_endorsed` DB row (src/lib/medical/
 * store.ts → getMedTaxSettings). Greenway is NOT medically endorsed yet, so on
 * a real device nothing comes off the price and the owner cannot SEE the medical
 * flow work end to end.
 *
 * This core provides a PER-DEVICE, fully-reversible, migration-free way to
 * SIMULATE the endorsement so the owner can rehearse a medical sale (scan the
 * age ID, tick the medical box, type the recognition-card facts, register a few
 * DOH-compliant products in the back office, and watch the tax drop). It is a
 * TEST switch — it never touches the server or the database, it lives in
 * localStorage exactly like the theme (B44) and favorites, and it degrades to
 * OFF on any corruption. RegisterShell surfaces a loud "⚠️ MEDICAL TEST MODE"
 * banner whenever it is on so it can never be mistaken for the real endorsement.
 *
 * SAFETY POSTURE (verified against this codebase, not guessed)
 * ------------------------------------------------------------
 *  - The override ONLY flips `medical.endorsed` to true, and ONLY when the
 *    bundle ALREADY carries a `medical` config block. It never FABRICATES a
 *    medical config that the server did not ship — without the DOH registry
 *    (bundle.medical.registry) the excise decision has no compliant-product
 *    data to act on, so a fabricated block could mislead. No block ⇒ no change.
 *  - When test mode is OFF (the default) the bundle is returned UNTOUCHED
 *    (same reference), so the real server-driven endorsement value is authoritative.
 *  - Turning it on does NOT bypass any per-sale requirement: the recognition
 *    card capture, the "verified in the DOH database" attestation, expiry
 *    checks, high-THC gating, 3× limits, and the WAC 314-55-090(2) record
 *    capture all still run exactly as in a real endorsed sale. It only removes
 *    the store-level endorsement blocker for rehearsal.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

import type { PosMenuBundle } from "./sale-flow-core";

/** localStorage key (per device, like gw-pos-theme / gw-pos-favorites). */
export const MEDICAL_TESTMODE_KEY = "gw-pos-medical-testmode";

/**
 * Parse a stored/untrusted value into the boolean test-mode flag. ONLY the
 * exact string "on" (what we serialize) enables it; anything else — null,
 * corruption, a legacy value, a future version — degrades to OFF. A test
 * switch must FAIL SAFE: a bad blob can never silently drop real tax.
 */
export function parseMedicalTestMode(raw: unknown): boolean {
  return raw === "on";
}

/** Serialize the flag to its stored form ("on" | "off"). */
export function serializeMedicalTestMode(on: boolean): string {
  return on ? "on" : "off";
}

/** Toggle helper (strict two-state flip). */
export function toggleMedicalTestMode(on: boolean): boolean {
  return !on;
}

/**
 * Button label: names what the toggle WOULD DO next (standard toggle wording),
 * so the owner always knows the action, not the current state.
 */
export function medicalTestModeToggleLabel(on: boolean): string {
  return on ? "Turn OFF medical test mode" : "Turn ON medical test mode (simulate endorsement)";
}

/**
 * Apply the per-device test-mode override to a menu bundle.
 *
 *  - `on === false`  → return the bundle UNCHANGED (same reference). The real
 *                      server endorsement value stays authoritative.
 *  - bundle has NO `medical` block → return UNCHANGED. We never fabricate a
 *                      medical config (no DOH registry ⇒ nothing to price on).
 *  - already `endorsed: true` → return UNCHANGED (no needless new object).
 *  - otherwise       → return a SHALLOW COPY with `medical.endorsed = true`.
 *
 * Returns a new bundle object only when it actually changes something, so
 * referential-equality checks upstream stay cheap.
 */
export function applyMedicalTestMode(bundle: PosMenuBundle, on: boolean): PosMenuBundle {
  if (!on) return bundle;
  if (!bundle.medical) return bundle;
  if (bundle.medical.endorsed === true) return bundle;
  return {
    ...bundle,
    medical: { ...bundle.medical, endorsed: true },
  };
}

/**
 * Should the loud "TEST MODE" banner show? Only when the toggle is on AND the
 * bundle actually carries a medical config the override could act on — if there
 * is no medical block, the toggle is inert and a banner would just confuse.
 */
export function medicalTestModeBannerActive(bundle: PosMenuBundle | null, on: boolean): boolean {
  return on === true && !!bundle && !!bundle.medical;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runMedicalTestModeCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  ok(MEDICAL_TESTMODE_KEY === "gw-pos-medical-testmode", "stable localStorage key");

  // parseMedicalTestMode — fail-safe: ONLY "on" enables it.
  ok(parseMedicalTestMode("on") === true, "parse 'on' → true");
  ok(parseMedicalTestMode("off") === false, "parse 'off' → false");
  ok(parseMedicalTestMode(null) === false, "null degrades to OFF");
  ok(parseMedicalTestMode(undefined) === false, "undefined degrades to OFF");
  ok(parseMedicalTestMode("") === false, "empty string degrades to OFF");
  ok(parseMedicalTestMode("ON") === false, "case-sensitive (stored by us) — 'ON' is OFF");
  ok(parseMedicalTestMode("true") === false, "'true' is not our token → OFF");
  ok(parseMedicalTestMode(1) === false, "number degrades to OFF");
  ok(parseMedicalTestMode({ on: true }) === false, "object degrades to OFF");

  // serialize round-trips through parse.
  ok(serializeMedicalTestMode(true) === "on", "serialize true → 'on'");
  ok(serializeMedicalTestMode(false) === "off", "serialize false → 'off'");
  ok(parseMedicalTestMode(serializeMedicalTestMode(true)) === true, "true round-trips");
  ok(parseMedicalTestMode(serializeMedicalTestMode(false)) === false, "false round-trips");

  // toggle + label.
  ok(toggleMedicalTestMode(false) === true, "off toggles on");
  ok(toggleMedicalTestMode(true) === false, "on toggles off");
  ok(
    medicalTestModeToggleLabel(false).includes("Turn ON"),
    "label names the ON action when off",
  );
  ok(
    medicalTestModeToggleLabel(true).includes("Turn OFF"),
    "label names the OFF action when on",
  );

  // applyMedicalTestMode — the safety-critical part.
  const bundleEndorsedFalse = {
    products: [],
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" } },
  } as unknown as PosMenuBundle;
  const bundleNoMedical = { products: [] } as unknown as PosMenuBundle;
  const bundleAlreadyEndorsed = {
    products: [],
    medical: { endorsed: true, exciseExemptionUntil: "2029-06-30", registry: {} },
  } as unknown as PosMenuBundle;

  // OFF → unchanged (same reference), even with a medical block present.
  ok(applyMedicalTestMode(bundleEndorsedFalse, false) === bundleEndorsedFalse, "OFF returns same reference");

  // ON + medical block that is endorsed:false → NEW bundle with endorsed:true.
  const flipped = applyMedicalTestMode(bundleEndorsedFalse, true);
  ok(flipped !== bundleEndorsedFalse, "ON with unendorsed block returns a NEW bundle");
  ok(flipped.medical?.endorsed === true, "ON flips endorsed to true");
  ok(
    // registry + sunset preserved untouched.
    flipped.medical?.exciseExemptionUntil === "2029-06-30" && !!flipped.medical?.registry.p1,
    "ON preserves registry + sunset date",
  );
  ok(
    // ORIGINAL bundle is not mutated (shallow copy, not in-place).
    bundleEndorsedFalse.medical?.endorsed === false,
    "ON does not mutate the original bundle",
  );

  // ON + NO medical block → unchanged (never fabricate a config).
  ok(applyMedicalTestMode(bundleNoMedical, true) === bundleNoMedical, "ON with no medical block → unchanged");

  // ON + already endorsed → unchanged reference (no needless object).
  ok(applyMedicalTestMode(bundleAlreadyEndorsed, true) === bundleAlreadyEndorsed, "ON when already endorsed → same reference");

  // banner visibility.
  ok(medicalTestModeBannerActive(bundleEndorsedFalse, true) === true, "banner ON when toggle on + medical block");
  ok(medicalTestModeBannerActive(bundleEndorsedFalse, false) === false, "banner OFF when toggle off");
  ok(medicalTestModeBannerActive(bundleNoMedical, true) === false, "banner OFF when no medical block (toggle inert)");
  ok(medicalTestModeBannerActive(null, true) === false, "banner OFF when no bundle yet");

  console.log(`medical-testmode-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`medical-testmode-core self-tests failed: ${failures.join("; ")}`);
  }
}
