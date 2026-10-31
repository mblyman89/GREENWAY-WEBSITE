/**
 * POS Slice 5 — Medical "TEST MODE" endorsement simulation (pure core).
 *
 * WHY THIS EXISTS
 * ---------------
 * The medical tax exemptions (sales tax + the 37% excise) only come off the
 * price when the STORE holds a valid LCB medical endorsement — in the code that
 * is `bundle.medical.endorsed`, which the server sets from the durable
 * `medical_endorsement_config` DB row, resolved fail-closed by
 * src/lib/medical/endorsement-switch-core.ts (slice A-06: switch on + number +
 * effective date ≤ today Pacific) and read through store.ts → getMedTaxSettings.
 * Until the owner turns the endorsement on in /admin/medical, nothing comes off
 * the price on a real device and the owner cannot SEE the medical flow work end
 * to end.
 *
 * SLICE A-06 (OD-40) — THE OWNER CONTROLS WHETHER THIS EXISTS AT ALL. The
 * server ships `bundle.medical.testModeAllowed` from the owner's "Register
 * medical test mode" switch on /admin/medical. Unless it is exactly `true`,
 * the register hides the menu item (medicalTestModeOffered), the override does
 * nothing (applyMedicalTestMode), no banner shows, and RegisterShell switches a
 * device's stored flag OFF on the next menu refresh. Owner's words: "so the
 * register can hide that ability, so that real sales cant be rung in as a test
 * medical sale."
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
  // A-06: the owner's switch. Not exactly true ⇒ no simulation, ever.
  if (bundle.medical.testModeAllowed !== true) return bundle;
  if (bundle.medical.endorsed === true) return bundle;
  return {
    ...bundle,
    medical: { ...bundle.medical, endorsed: true, simulated: true },
  };
}

/**
 * Phase 0.1 (F-01-14) — a REAL sale can never be paid while the endorsement is
 * only simulated. Test mode stays useful for rehearsal (the cart shows the tax
 * coming off), but taking payment is refused when any tax was removed, because
 * the server would store the device's lower tax with no WAC 314-55-090(2)
 * exemption record (WAC 314-55-090(3): unrecorded exemptions are presumed
 * incorrect). Returns the message to show, or null when the sale may proceed.
 */
export function medicalTestModeSaleBlock(
  bundle: Pick<PosMenuBundle, "medical"> | null,
  medicalSavingsMinor: number,
): string | null {
  if (!bundle?.medical?.simulated) return null;
  if (!(medicalSavingsMinor > 0)) return null;
  return "Medical TEST MODE is on, so the tax taken off this sale is only a simulation. A real sale cannot be paid this way. Turn OFF medical test mode (Menu), then ring the sale again at full tax.";
}

/**
 * Should the loud "TEST MODE" banner show? Only when the toggle is on AND the
 * bundle actually carries a medical config the override could act on — if there
 * is no medical block, the toggle is inert and a banner would just confuse.
 */
export function medicalTestModeBannerActive(bundle: PosMenuBundle | null, on: boolean): boolean {
  return on === true && medicalTestModeOffered(bundle);
}

/**
 * Slice A-06 (OD-40): may this register OFFER medical test mode at all? Only
 * when the server-shipped bundle carries a medical block whose
 * `testModeAllowed` is exactly `true` (the owner's /admin/medical switch).
 * No bundle yet, no medical block, a missing flag (older server) or `false`
 * ⇒ hidden. RegisterShell uses this to hide the MORE-menu item and to switch
 * a device's stored flag OFF when the owner hides it.
 */
export function medicalTestModeOffered(bundle: Pick<PosMenuBundle, "medical"> | null): boolean {
  return !!bundle && !!bundle.medical && bundle.medical.testModeAllowed === true;
}

/**
 * Slice A-06: should the device's stored test-mode flag be forced OFF now?
 * True when the flag is on but a menu bundle has arrived that does not offer
 * test mode. Before any bundle has loaded (null) we keep the flag — nothing
 * can be priced without a bundle, and the first bundle decides.
 */
export function medicalTestModeMustTurnOff(bundle: Pick<PosMenuBundle, "medical"> | null, on: boolean): boolean {
  if (on !== true) return false;
  if (!bundle) return false;
  return !medicalTestModeOffered(bundle);
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
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" }, testModeAllowed: true },
  } as unknown as PosMenuBundle;
  // A-06: the same bundle when the owner has test mode HIDDEN (flag false / missing).
  const bundleHidden = {
    products: [],
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" }, testModeAllowed: false },
  } as unknown as PosMenuBundle;
  const bundleOldServer = {
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
  ok(flipped.medical?.simulated === true, "ON marks the endorsement as simulated");
  ok(medicalTestModeSaleBlock(flipped, 500) !== null, "simulated + tax removed -> payment refused");
  ok(medicalTestModeSaleBlock(flipped, 0) === null, "simulated + no tax removed -> allowed");
  ok(medicalTestModeSaleBlock(bundleEndorsedFalse, 500) === null, "real bundle -> not blocked by test mode");
  ok(medicalTestModeSaleBlock(bundleAlreadyEndorsed, 500) === null, "real endorsement -> allowed");
  ok(medicalTestModeSaleBlock(null, 500) === null, "no bundle -> null");
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

  // A-06 (OD-40): the owner's switch gates everything.
  ok(applyMedicalTestMode(bundleHidden, true) === bundleHidden, "A-06: hidden ⇒ ON does nothing (same reference)");
  ok(applyMedicalTestMode(bundleHidden, true).medical?.endorsed === false, "A-06: hidden ⇒ tax stays on");
  ok(applyMedicalTestMode(bundleOldServer, true) === bundleOldServer, "A-06: missing flag (older server) ⇒ fail closed");
  ok(medicalTestModeOffered(bundleEndorsedFalse) === true, "A-06: offered when allowed");
  ok(medicalTestModeOffered(bundleHidden) === false, "A-06: not offered when hidden");
  ok(medicalTestModeOffered(bundleOldServer) === false, "A-06: not offered when flag missing");
  ok(medicalTestModeOffered(bundleNoMedical) === false, "A-06: not offered with no medical block");
  ok(medicalTestModeOffered(null) === false, "A-06: not offered before a bundle loads");
  ok(medicalTestModeBannerActive(bundleHidden, true) === false, "A-06: no banner when hidden");
  ok(medicalTestModeMustTurnOff(bundleHidden, true) === true, "A-06: hidden bundle forces a stored ON flag off");
  ok(medicalTestModeMustTurnOff(bundleOldServer, true) === true, "A-06: missing flag forces it off");
  ok(medicalTestModeMustTurnOff(bundleEndorsedFalse, true) === false, "A-06: allowed bundle keeps it");
  ok(medicalTestModeMustTurnOff(bundleHidden, false) === false, "A-06: already off ⇒ nothing to do");
  ok(medicalTestModeMustTurnOff(null, true) === false, "A-06: no bundle yet ⇒ wait for the first one");

  console.log(`medical-testmode-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`medical-testmode-core self-tests failed: ${failures.join("; ")}`);
  }
}
