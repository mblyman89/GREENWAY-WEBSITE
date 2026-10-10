/**
 * src/lib/payments/vendor-ach-enrollment-core.ts — R39 S4 (PURE)
 *
 * The owner's words (R39, end of Q13): "For the vendor records, I want it to
 * be shown in their vendor detail page and to be flagged or know to me in some
 * way that we need to get them to give us their bank info, or if they opt
 * out, a way for me to check a box that they opted out."
 *
 * This module is the brain of that vendor ACH card. It combines:
 *   - the two vendor flags added by 0258 (ach_needs_bank_info, ach_opted_out
 *     with its reason / who / when), and
 *   - the vault record (vendor_bank_details: status + verified_at),
 * into ONE status, a plain next step, and any contradictions worth showing
 * (for example "opted out" but an active vault record still on file).
 *
 * planVendorAchFlagChange() is the only way the server action builds an
 * update. It mirrors the 0258 CHECK constraints exactly, so the app refuses
 * with a readable message before Postgres would:
 *   vendors_ach_opt_out_shape:
 *     (opted_out AND trim(reason) <> '' AND opted_out_at IS NOT NULL)
 *     OR (NOT opted_out AND opted_out_at IS NULL)
 *   vendors_ach_flags_exclusive: NOT (opted_out AND needs_bank_info)
 * The tests read the 0258 SQL to keep these in step.
 *
 * No I/O. Never prints bank numbers; the vault card does that (masked).
 */

export const MIN_OPT_OUT_REASON_CHARS = 5;

export type VendorAchFlags = {
  /** False before migration 0258 adds the columns (select * returns no key). */
  columnsReady: boolean;
  needsBankInfo: boolean;
  optedOut: boolean;
  optedOutReason: string | null;
  optedOutAt: string | null;
  optedOutBy: string | null;
};

/** Read the flags off a vendors row from `select *`. Missing keys = columns not there yet. */
export function readVendorAchFlags(row: Record<string, unknown> | null | undefined): VendorAchFlags {
  const r = row ?? {};
  const columnsReady = "ach_needs_bank_info" in r && "ach_opted_out" in r;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    columnsReady,
    needsBankInfo: r.ach_needs_bank_info === true,
    optedOut: r.ach_opted_out === true,
    optedOutReason: str(r.ach_opted_out_reason),
    optedOutAt: str(r.ach_opted_out_at),
    optedOutBy: str(r.ach_opted_out_by),
  };
}

export type VendorAchVault = {
  hasRecord: boolean;
  status: string | null;
  verifiedAt: string | null;
};

export type VendorAchState =
  | "not_ready" // 0258 not applied: flags can't be stored yet
  | "opted_out" // vendor chose not to be paid by ACH (checkbox)
  | "needs_bank_info" // flagged: go get their bank info
  | "ready" // active + verified vault record: can be paid by ACH
  | "unverified" // active vault record not yet verified
  | "on_hold" // vault record on hold
  | "inactive" // vault record revoked or archived
  | "blocked_unknown" // vault status we don't know
  | "not_set_up"; // nothing on file and nobody has flagged it yet

export type VendorAchCard = {
  state: VendorAchState;
  label: string;
  tone: "neutral" | "green" | "gold" | "orange";
  /** What to do next, in plain words. */
  nextStep: string;
  /** Things that disagree with each other; shown as warnings. */
  warnings: string[];
  /** Which flag buttons the card offers. */
  actions: VendorAchFlagAction[];
  /** True when this vendor belongs in the vault's "needs follow-up" list. */
  followUp: boolean;
};

export type VendorAchFlagAction = "flag_needs_info" | "clear_needs_info" | "opt_out" | "opt_in";

export function vendorAchCard(flags: VendorAchFlags, vault: VendorAchVault): VendorAchCard {
  const warnings: string[] = [];
  const status = vault.hasRecord ? vault.status : null;
  const vaultUsable = status === "active";

  if (!flags.columnsReady) {
    return {
      state: "not_ready",
      label: "ACH flags not available yet",
      tone: "neutral",
      nextStep: "Apply migration 0258 to turn on the 'needs bank info' flag and the 'opted out' checkbox.",
      warnings,
      actions: [],
      followUp: false,
    };
  }

  if (flags.optedOut) {
    if (vaultUsable) {
      warnings.push(
        "This vendor is marked opted out, but an ACTIVE bank record is still in the vault. Payments by ACH are refused while opted out; archive the vault record or un-check opted out.",
      );
    }
    if (flags.needsBankInfo) {
      // 0258 forbids this; if it is ever seen the data was edited outside the app.
      warnings.push("Both 'opted out' and 'needs bank info' are set. The database should not allow this. Check the record.");
    }
    return {
      state: "opted_out",
      label: "Opted out of ACH",
      tone: "neutral",
      nextStep: `Pay this vendor another way (check). Reason on file: ${flags.optedOutReason ?? "(missing)"}.`,
      warnings,
      actions: ["opt_in"],
      followUp: false,
    };
  }

  if (flags.needsBankInfo) {
    if (vaultUsable) {
      warnings.push("Flagged as needing bank info, but an active bank record is already in the vault. Clear the flag if it is no longer needed.");
    }
    return {
      state: "needs_bank_info",
      label: "Needs bank info",
      tone: "orange",
      nextStep:
        "Ask the vendor for a signed ACH authorization form with their bank details. Upload it, enter it in the vault, then verify it by calling a number you already have.",
      warnings,
      actions: ["clear_needs_info", "opt_out"],
      followUp: true,
    };
  }

  if (!vault.hasRecord) {
    return {
      state: "not_set_up",
      label: "No ACH set up",
      tone: "gold",
      nextStep: "Flag it as 'needs bank info' to chase the vendor, or check 'opted out' if they want to be paid another way.",
      warnings,
      actions: ["flag_needs_info", "opt_out"],
      followUp: true,
    };
  }

  const base = { warnings, actions: ["flag_needs_info", "opt_out"] as VendorAchFlagAction[] };
  if (status === "active") {
    if (vault.verifiedAt) {
      return { ...base, state: "ready", label: "ACH ready", tone: "green", nextStep: "Nothing to do. This vendor can be paid by ACH.", followUp: false };
    }
    return {
      ...base,
      state: "unverified",
      label: "ACH not yet verified",
      tone: "gold",
      nextStep: "Call the vendor at a number on file for 90+ days (or confirm in person), then mark the bank record verified in the vault.",
      followUp: true,
    };
  }
  if (status === "on_hold") {
    return {
      ...base,
      state: "on_hold",
      label: "ACH on hold",
      tone: "orange",
      nextStep: "A bank change or problem is waiting. Do the callback and release the hold in the vault.",
      followUp: true,
    };
  }
  if (status === "revoked" || status === "archived") {
    return {
      ...base,
      state: "inactive",
      label: status === "revoked" ? "ACH revoked" : "ACH archived",
      tone: "neutral",
      nextStep: "Not payable by ACH. Get a new signed form and re-open it in the vault, flag it as needing bank info, or check opted out.",
      followUp: true,
    };
  }
  return {
    ...base,
    state: "blocked_unknown",
    label: "ACH blocked",
    tone: "orange",
    nextStep: `The vault status "${String(status)}" is not one the app knows, so payments are blocked. Check the vault.`,
    followUp: true,
  };
}

/** The update the server action writes. Keys are exactly the 0258 column names. */
export type VendorAchFlagPatch = {
  ach_needs_bank_info: boolean;
  ach_opted_out: boolean;
  ach_opted_out_reason: string | null;
  ach_opted_out_by: string | null;
  ach_opted_out_at: string | null;
};

/**
 * Build the vendors update for one checkbox/button press, or refuse.
 * Every result satisfies both 0258 CHECK constraints.
 */
export function planVendorAchFlagChange(input: {
  current: VendorAchFlags;
  action: string;
  reason: string;
  actorId: string;
  nowIso: string;
}): { ok: true; patch: VendorAchFlagPatch; summary: string } | { ok: false; error: string } {
  const { current, action, actorId, nowIso } = input;
  const reason = input.reason.trim();
  if (!current.columnsReady) return { ok: false, error: "Apply migration 0258 first; the ACH flag columns are not in the database yet." };
  const keepOptOut = {
    ach_opted_out: current.optedOut,
    ach_opted_out_reason: current.optedOut ? current.optedOutReason : null,
    ach_opted_out_by: current.optedOut ? current.optedOutBy : null,
    ach_opted_out_at: current.optedOut ? current.optedOutAt : null,
  };
  switch (action) {
    case "flag_needs_info":
      if (current.optedOut) return { ok: false, error: "This vendor is opted out. Un-check 'opted out' first, then flag it." };
      if (current.needsBankInfo) return { ok: false, error: "Already flagged as needing bank info." };
      return { ok: true, patch: { ach_needs_bank_info: true, ...keepOptOut }, summary: "Flagged: needs bank info." };
    case "clear_needs_info":
      if (!current.needsBankInfo) return { ok: false, error: "This vendor isn't flagged as needing bank info." };
      return { ok: true, patch: { ach_needs_bank_info: false, ...keepOptOut }, summary: "Cleared the 'needs bank info' flag." };
    case "opt_out":
      if (current.optedOut) return { ok: false, error: "Already marked opted out." };
      if (reason.length < MIN_OPT_OUT_REASON_CHARS) {
        return { ok: false, error: `Say why they opted out (at least ${MIN_OPT_OUT_REASON_CHARS} characters), for example "prefers paper checks".` };
      }
      if (!actorId) return { ok: false, error: "Missing who is making this change." };
      // Opting out clears "needs bank info" (vendors_ach_flags_exclusive).
      return {
        ok: true,
        patch: { ach_needs_bank_info: false, ach_opted_out: true, ach_opted_out_reason: reason, ach_opted_out_by: actorId, ach_opted_out_at: nowIso },
        summary: "Marked opted out of ACH.",
      };
    case "opt_in":
      if (!current.optedOut) return { ok: false, error: "This vendor isn't marked opted out." };
      return {
        ok: true,
        // needs-info is always false while opted out (vendors_ach_flags_exclusive), so it stays false.
        patch: { ach_needs_bank_info: false, ach_opted_out: false, ach_opted_out_reason: null, ach_opted_out_by: null, ach_opted_out_at: null },
        summary: "Un-checked opted out. The vendor can be set up for ACH again.",
      };
    default:
      return { ok: false, error: "Unknown ACH flag action." };
  }
}

/** The 0258 CHECK constraints, as code. Used by tests and as a last check before writing. */
export function patchSatisfiesConstraints(p: VendorAchFlagPatch): boolean {
  const shape =
    (p.ach_opted_out && (p.ach_opted_out_reason ?? "").trim().length > 0 && p.ach_opted_out_at !== null) ||
    (!p.ach_opted_out && p.ach_opted_out_at === null);
  const exclusive = !(p.ach_opted_out && p.ach_needs_bank_info);
  return shape && exclusive;
}

/** Pay-time rule: a vendor who opted out is never paid by ACH, whatever the vault says. */
export function optOutPayRefusal(flags: VendorAchFlags, vendorName: string): string | null {
  if (!flags.optedOut) return null;
  return `${vendorName} opted out of ACH (${flags.optedOutReason ?? "no reason recorded"}). Pay another way, or un-check "opted out" on the vendor's page first.`;
}

/** Most urgent first. Unknown states sort last (and still show). */
const FOLLOW_UP_ORDER: readonly VendorAchState[] = ["blocked_unknown", "on_hold", "needs_bank_info", "unverified", "inactive", "not_set_up"];

export type VendorFollowUpRow = { vendorId: string; name: string; state: VendorAchState; label: string; nextStep: string; warnings: string[] };

/**
 * The vault's "Vendors to follow up" list: every vendor whose card says
 * followUp (or has a warning), most urgent first, then by name.
 * Opted-out and ACH-ready vendors are left out unless something disagrees.
 * Before 0258 (flags not ready) it returns [] so the page shows no false list.
 */
export function vendorFollowUpList(
  vendors: readonly { id: string; name: string; flags: VendorAchFlags; vault: VendorAchVault }[],
): VendorFollowUpRow[] {
  const rows: VendorFollowUpRow[] = [];
  for (const v of vendors) {
    const card = vendorAchCard(v.flags, v.vault);
    if (card.state === "not_ready") continue;
    if (!card.followUp && card.warnings.length === 0) continue;
    rows.push({ vendorId: v.id, name: v.name, state: card.state, label: card.label, nextStep: card.nextStep, warnings: card.warnings });
  }
  const rank = (s: VendorAchState) => {
    const i = FOLLOW_UP_ORDER.indexOf(s);
    return i === -1 ? FOLLOW_UP_ORDER.length : i;
  };
  return rows.sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));
}

export function __runVendorAchEnrollmentTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL vendor-ach-enrollment: ${msg}`);
    }
  };
  const F = (o: Partial<VendorAchFlags> = {}): VendorAchFlags => ({
    columnsReady: true,
    needsBankInfo: false,
    optedOut: false,
    optedOutReason: null,
    optedOutAt: null,
    optedOutBy: null,
    ...o,
  });
  const none: VendorAchVault = { hasRecord: false, status: null, verifiedAt: null };
  const act = (verifiedAt: string | null = "2026-01-02T00:00:00Z"): VendorAchVault => ({ hasRecord: true, status: "active", verifiedAt });

  // readVendorAchFlags
  ok(!readVendorAchFlags({ id: "x" }).columnsReady, "no columns -> not ready");
  ok(readVendorAchFlags({ ach_needs_bank_info: false, ach_opted_out: false }).columnsReady, "columns present -> ready");
  ok(!readVendorAchFlags({ ach_needs_bank_info: "true", ach_opted_out: 1 }).needsBankInfo, "only boolean true counts");
  ok(readVendorAchFlags({ ach_needs_bank_info: false, ach_opted_out: true, ach_opted_out_reason: "  " }).optedOutReason === null, "blank reason -> null");
  ok(!readVendorAchFlags(null).columnsReady, "null row -> not ready");

  // card states
  ok(vendorAchCard(F({ columnsReady: false }), act()).state === "not_ready", "not ready wins");
  ok(vendorAchCard(F({ columnsReady: false }), act()).actions.length === 0, "no buttons before 0258");
  ok(vendorAchCard(F(), none).state === "not_set_up", "nothing -> not_set_up");
  ok(vendorAchCard(F(), none).followUp, "not_set_up is follow-up");
  ok(vendorAchCard(F({ needsBankInfo: true }), none).state === "needs_bank_info", "flagged");
  ok(vendorAchCard(F({ needsBankInfo: true }), none).actions.join() === "clear_needs_info,opt_out", "flagged buttons");
  ok(vendorAchCard(F({ optedOut: true, optedOutReason: "paper checks" }), none).state === "opted_out", "opted out");
  ok(!vendorAchCard(F({ optedOut: true }), none).followUp, "opted out is not follow-up");
  ok(vendorAchCard(F({ optedOut: true }), none).actions.join() === "opt_in", "opted-out buttons");
  ok(vendorAchCard(F({ optedOut: true }), act()).warnings.length === 1, "opted out + active vault warns");
  ok(vendorAchCard(F({ optedOut: true }), { hasRecord: true, status: "archived", verifiedAt: null }).warnings.length === 0, "opted out + archived is fine");
  ok(vendorAchCard(F({ needsBankInfo: true }), act()).warnings.length === 1, "stale needs flag warns");
  ok(vendorAchCard(F(), act()).state === "ready", "active verified -> ready");
  ok(!vendorAchCard(F(), act()).followUp, "ready not follow-up");
  ok(vendorAchCard(F(), act(null)).state === "unverified", "active unverified");
  ok(vendorAchCard(F(), { hasRecord: true, status: "on_hold", verifiedAt: "x" }).state === "on_hold", "on hold");
  ok(vendorAchCard(F(), { hasRecord: true, status: "revoked", verifiedAt: "x" }).label === "ACH revoked", "revoked label");
  ok(vendorAchCard(F(), { hasRecord: true, status: "archived", verifiedAt: "x" }).state === "inactive", "archived inactive");
  ok(vendorAchCard(F(), { hasRecord: true, status: "Active", verifiedAt: "x" }).state === "blocked_unknown", "case-typo blocked");
  ok(vendorAchCard(F(), { hasRecord: false, status: "active", verifiedAt: "x" }).state === "not_set_up", "status ignored without record");

  // planner
  const now = "2026-05-01T12:00:00.000Z";
  const plan = (cur: VendorAchFlags, action: string, reason = "") => planVendorAchFlagChange({ current: cur, action, reason, actorId: "u1", nowIso: now });
  const p1 = plan(F(), "flag_needs_info");
  ok(p1.ok && p1.patch.ach_needs_bank_info && patchSatisfiesConstraints(p1.patch), "flag ok");
  ok(!plan(F({ optedOut: true, optedOutReason: "x", optedOutAt: now }), "flag_needs_info").ok, "flag refused when opted out");
  ok(!plan(F({ needsBankInfo: true }), "flag_needs_info").ok, "double flag refused");
  const p2 = plan(F({ needsBankInfo: true }), "clear_needs_info");
  ok(p2.ok && !p2.patch.ach_needs_bank_info, "clear ok");
  ok(!plan(F(), "clear_needs_info").ok, "clear refused when not set");
  ok(!plan(F(), "opt_out", "abc").ok, "short reason refused");
  ok(!plan(F(), "opt_out", "     abcd     ").ok, "reason trimmed before length check");
  const p3 = plan(F({ needsBankInfo: true }), "opt_out", "prefers checks");
  ok(p3.ok && p3.patch.ach_opted_out && !p3.patch.ach_needs_bank_info && p3.patch.ach_opted_out_at === now && p3.patch.ach_opted_out_by === "u1", "opt out clears needs and stamps");
  ok(p3.ok && patchSatisfiesConstraints(p3.patch), "opt out satisfies constraints");
  ok(!plan(F({ optedOut: true }), "opt_out", "prefers checks").ok, "double opt out refused");
  const p4 = plan(F({ optedOut: true, optedOutReason: "x", optedOutAt: now, optedOutBy: "u1" }), "opt_in");
  ok(p4.ok && !p4.patch.ach_opted_out && p4.patch.ach_opted_out_at === null && p4.patch.ach_opted_out_reason === null && p4.patch.ach_opted_out_by === null, "opt in clears all");
  ok(!plan(F(), "opt_in").ok, "opt in refused when not opted out");
  ok(!plan(F({ columnsReady: false }), "flag_needs_info").ok, "refused before 0258");
  ok(!plan(F(), "delete").ok, "unknown action refused");
  ok(!planVendorAchFlagChange({ current: F(), action: "opt_out", reason: "prefers checks", actorId: "", nowIso: now }).ok, "opt out needs actor");
  const p5 = plan(F({ optedOut: true, optedOutReason: "checks", optedOutAt: now, optedOutBy: "u1" }), "clear_needs_info");
  ok(!p5.ok, "clear refused when not flagged even if opted out");

  // constraints oracle
  ok(!patchSatisfiesConstraints({ ach_needs_bank_info: true, ach_opted_out: true, ach_opted_out_reason: "x", ach_opted_out_by: null, ach_opted_out_at: now }), "exclusive enforced");
  ok(!patchSatisfiesConstraints({ ach_needs_bank_info: false, ach_opted_out: true, ach_opted_out_reason: " ", ach_opted_out_by: null, ach_opted_out_at: now }), "blank reason fails shape");
  ok(!patchSatisfiesConstraints({ ach_needs_bank_info: false, ach_opted_out: false, ach_opted_out_reason: null, ach_opted_out_by: null, ach_opted_out_at: now }), "stamp without opt out fails shape");

  // follow-up list
  const fl = vendorFollowUpList([
    { id: "1", name: "Zed", flags: F(), vault: none },
    { id: "2", name: "Amy", flags: F({ needsBankInfo: true }), vault: none },
    { id: "3", name: "Bob", flags: F(), vault: act() },
    { id: "4", name: "Cat", flags: F({ optedOut: true, optedOutReason: "checks" }), vault: none },
    { id: "5", name: "Dan", flags: F(), vault: { hasRecord: true, status: "on_hold", verifiedAt: null } },
    { id: "6", name: "Eve", flags: F({ optedOut: true, optedOutReason: "checks" }), vault: act() },
    { id: "7", name: "Fay", flags: F({ columnsReady: false }), vault: none },
  ]);
  ok(fl.map((r) => r.name).join() === "Dan,Amy,Zed,Eve", "follow-up order + filter");
  ok(fl.find((r) => r.name === "Eve")?.warnings.length === 1, "opted out with active vault listed for its warning");
  ok(vendorFollowUpList([{ id: "a", name: "B", flags: F(), vault: none }, { id: "b", name: "A", flags: F(), vault: none }]).map((r) => r.name).join() === "A,B", "ties by name");

  // pay refusal
  ok(optOutPayRefusal(F(), "Acme") === null, "not opted out -> no refusal");
  ok((optOutPayRefusal(F({ optedOut: true, optedOutReason: "checks" }), "Acme") ?? "").includes("Acme opted out of ACH (checks)"), "opted out -> refusal");

  console.log(`vendor-ach-enrollment: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
