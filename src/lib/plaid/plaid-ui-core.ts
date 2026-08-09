/**
 * src/lib/plaid/plaid-ui-core.ts — PURE presentation/validation helpers for the
 * /admin/plaid page (Slice P2). No React, no network, no DB — just data in →
 * view data out, so the logic is unit-testable in the run-pure-selftests harness.
 *
 * What lives here (P2 scope — the Connect flow + Health v0):
 *   1) resolvePlaidTab      — `?tab=` allow-list (connections | health), safe default.
 *   2) buildItemStatusView  — item status → chip tone + plain-English line (wraps
 *                             plaid-core.mapItemStatus so the page never re-derives copy).
 *   3) buildAccountSummary  — one account row → display strings (name, mask, type,
 *                             role label, balances formatted from CENTS).
 *   4) roleAssignmentCheck  — enforce "one account per role" BEFORE writing, with a
 *                             friendly conflict message (never guess; validate first).
 *   5) formatCentsUsd / maskLabel — tiny money & mask formatters (money stays in cents).
 *
 * MONEY: every balance is an integer number of CENTS (bigint in the DB). We only
 * turn cents into a "$x.xx" string at the very edge, here.
 */

import { mapItemStatus, validateAccountRole, type AccountRole, type ItemStatusView } from "./plaid-core";

// ---------------------------------------------------------------------------
// 1) Tab resolver — the page has two tabs in P2. Unknown/empty → "connections".
// ---------------------------------------------------------------------------

export type PlaidTab = "connections" | "health";

export function resolvePlaidTab(param: string | null | undefined): PlaidTab {
  const v = (param ?? "").trim().toLowerCase();
  if (v === "health") return "health";
  // aliases so a stray value never 404s the tab
  if (v === "status" || v === "connection" || v === "connections") return "connections";
  return "connections";
}

// ---------------------------------------------------------------------------
// 2) Item status view — chip tone + copy. Wraps plaid-core.mapItemStatus so the
//    UI is a thin pass-through (single source of truth for the message text).
// ---------------------------------------------------------------------------

export type ChipTone = "green" | "orange" | "red" | "neutral";

export type ItemStatusChip = {
  tone: ChipTone;
  label: string;
  message: string;
  /** True when the owner must re-authenticate ("Fix connection"). */
  needsUserAction: boolean;
};

export function buildItemStatusView(errorCode: string | null | undefined): ItemStatusChip {
  const view: ItemStatusView = mapItemStatus(errorCode);
  switch (view.status) {
    case "healthy":
      return { tone: "green", label: "Healthy", message: view.message, needsUserAction: false };
    case "login_required":
      return { tone: "orange", label: "Sign-in needed", message: view.message, needsUserAction: true };
    case "pending_disconnect":
      return { tone: "orange", label: "Needs refresh", message: view.message, needsUserAction: true };
    case "error":
    default:
      return { tone: "red", label: "Issue", message: view.message, needsUserAction: view.needsUserAction };
  }
}

// ---------------------------------------------------------------------------
// 3) Money & mask formatters (edge-only cents → string).
// ---------------------------------------------------------------------------

/**
 * Format integer CENTS as USD. null/undefined → "—" (unknown balance). Negative
 * values render with a leading minus (e.g. a credit card can owe money).
 */
export function formatCentsUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  const centsStr = rem.toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollarsStr}.${centsStr}`;
}

/** "•••• 4321" for a last-4 mask; "—" when we don't have one. */
export function maskLabel(mask: string | null | undefined): string {
  const m = (mask ?? "").trim();
  return m ? `•••• ${m}` : "—";
}

/** Human label for a role (or "Unassigned"). */
export function roleLabel(role: AccountRole | null | undefined): string {
  switch (role) {
    case "main":
      return "Main operating";
    case "atm":
      return "ATM deposits";
    case "credit":
      return "Credit card";
    default:
      return "Unassigned";
  }
}

// ---------------------------------------------------------------------------
// 4) Account summary row (for the Health tab list + role picker).
// ---------------------------------------------------------------------------

export type AccountSummaryInput = {
  accountId: string;
  name: string | null;
  officialName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  role: AccountRole | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
};

export type AccountSummaryView = {
  accountId: string;
  displayName: string;
  maskText: string;
  typeText: string;
  roleText: string;
  role: AccountRole | null;
  currentText: string;
  availableText: string;
};

export function buildAccountSummary(a: AccountSummaryInput): AccountSummaryView {
  const displayName = (a.name ?? a.officialName ?? "").trim() || "Account";
  const typeParts = [a.type, a.subtype].map((s) => (s ?? "").trim()).filter(Boolean);
  const typeText = typeParts.length ? typeParts.join(" · ") : "—";
  return {
    accountId: a.accountId,
    displayName,
    maskText: maskLabel(a.mask),
    typeText,
    roleText: roleLabel(a.role),
    role: a.role,
    currentText: formatCentsUsd(a.currentBalanceCents),
    availableText: formatCentsUsd(a.availableBalanceCents),
  };
}

// ---------------------------------------------------------------------------
// 5) Role-assignment guard — "one account per role".
//    Validates the requested role, then checks it isn't already taken by a
//    DIFFERENT account. Returns the canonical role to write, or a friendly
//    error. NEVER throws — the action shows the message. (Clearing a role,
//    i.e. role=null, is always allowed.)
// ---------------------------------------------------------------------------

export type ExistingRoleAssignment = { accountId: string; role: AccountRole | null };

export function roleAssignmentCheck(
  targetAccountId: string,
  requestedRole: string | null | undefined,
  existing: ExistingRoleAssignment[],
): { ok: true; role: AccountRole | null } | { ok: false; error: string } {
  const validated = validateAccountRole(requestedRole);
  if (!validated.ok) return validated;

  const role = validated.role;
  if (role === null) return { ok: true, role: null }; // clearing is always fine

  // Is this role already held by a DIFFERENT account?
  const holder = existing.find((e) => e.role === role && e.accountId !== targetAccountId);
  if (holder) {
    return {
      ok: false,
      error: `That "${roleLabel(role)}" role is already assigned to another account. Clear it there first, then assign it here.`,
    };
  }
  return { ok: true, role };
}

// ---------------------------------------------------------------------------
// Self-tests (run in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlaidUiCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // resolvePlaidTab ---------------------------------------------------------
  ok(resolvePlaidTab(undefined) === "connections", "no param → connections");
  ok(resolvePlaidTab("") === "connections", "empty → connections");
  ok(resolvePlaidTab("connections") === "connections", "connections passes through");
  ok(resolvePlaidTab("HEALTH") === "health", "case-insensitive health");
  ok(resolvePlaidTab("status") === "connections", "status alias → connections");
  ok(resolvePlaidTab("nonsense") === "connections", "unknown → connections");

  // buildItemStatusView -----------------------------------------------------
  const healthy = buildItemStatusView(null);
  ok(healthy.tone === "green" && !healthy.needsUserAction, "null code → green healthy");
  const login = buildItemStatusView("ITEM_LOGIN_REQUIRED");
  ok(login.tone === "orange" && login.needsUserAction, "login required → orange + needsUserAction");
  const pending = buildItemStatusView("PENDING_DISCONNECT");
  ok(pending.tone === "orange" && pending.needsUserAction, "pending disconnect → orange");
  const down = buildItemStatusView("INSTITUTION_DOWN");
  ok(down.tone === "red" && !down.needsUserAction, "institution down → red, no user action");
  const unknown = buildItemStatusView("SOME_NEW_CODE");
  ok(unknown.tone === "red", "unknown code → red");

  // formatCentsUsd ----------------------------------------------------------
  ok(formatCentsUsd(0) === "$0.00", "0 → $0.00");
  ok(formatCentsUsd(5) === "$0.05", "5c → $0.05");
  ok(formatCentsUsd(199) === "$1.99", "199 → $1.99");
  ok(formatCentsUsd(123456) === "$1,234.56", "123456 → $1,234.56 with grouping");
  ok(formatCentsUsd(-2500) === "-$25.00", "negative → -$25.00");
  ok(formatCentsUsd(null) === "—", "null → em dash");
  ok(formatCentsUsd(undefined) === "—", "undefined → em dash");
  ok(formatCentsUsd(Number.NaN) === "—", "NaN → em dash");
  ok(formatCentsUsd(100000000) === "$1,000,000.00", "million grouping");

  // maskLabel / roleLabel ---------------------------------------------------
  ok(maskLabel("4321") === "•••• 4321", "mask formats");
  ok(maskLabel(null) === "—", "no mask → em dash");
  ok(maskLabel("  ") === "—", "blank mask → em dash");
  ok(roleLabel("main") === "Main operating", "main label");
  ok(roleLabel("atm") === "ATM deposits", "atm label");
  ok(roleLabel("credit") === "Credit card", "credit label");
  ok(roleLabel(null) === "Unassigned", "null role → Unassigned");

  // buildAccountSummary -----------------------------------------------------
  const view = buildAccountSummary({
    accountId: "acc_1",
    name: "Business Checking",
    officialName: "TIMBERLAND BUSINESS CHECKING",
    mask: "0001",
    type: "depository",
    subtype: "checking",
    role: "main",
    currentBalanceCents: 4212300,
    availableBalanceCents: 4200000,
  });
  ok(view.displayName === "Business Checking", "prefers name over officialName");
  ok(view.maskText === "•••• 0001", "summary mask");
  ok(view.typeText === "depository · checking", "type · subtype");
  ok(view.roleText === "Main operating", "summary role label");
  ok(view.currentText === "$42,123.00", "summary current balance");
  ok(view.availableText === "$42,000.00", "summary available balance");

  const fallbackName = buildAccountSummary({
    accountId: "acc_2",
    name: null,
    officialName: "OFFICIAL ONLY",
    mask: null,
    type: null,
    subtype: null,
    role: null,
    currentBalanceCents: null,
    availableBalanceCents: null,
  });
  ok(fallbackName.displayName === "OFFICIAL ONLY", "falls back to officialName");
  ok(fallbackName.typeText === "—", "no type → em dash");
  ok(fallbackName.currentText === "—", "null balance → em dash");
  ok(fallbackName.roleText === "Unassigned", "null role summary");

  const noName = buildAccountSummary({
    accountId: "acc_3",
    name: "   ",
    officialName: null,
    mask: "9",
    type: "credit",
    subtype: null,
    role: "credit",
    currentBalanceCents: -250000,
    availableBalanceCents: 75000,
  });
  ok(noName.displayName === "Account", "blank name/official → 'Account'");
  ok(noName.typeText === "credit", "single type part");
  ok(noName.currentText === "-$2,500.00", "credit owed renders negative");

  // roleAssignmentCheck -----------------------------------------------------
  const existing: ExistingRoleAssignment[] = [
    { accountId: "acc_main", role: "main" },
    { accountId: "acc_atm", role: "atm" },
    { accountId: "acc_none", role: null },
  ];

  const assignFree = roleAssignmentCheck("acc_new", "credit", existing);
  ok(assignFree.ok && assignFree.role === "credit", "free role assigns");

  const clear = roleAssignmentCheck("acc_main", "", existing);
  ok(clear.ok && clear.role === null, "empty → clear (always allowed)");
  const clearNone = roleAssignmentCheck("acc_x", "none", existing);
  ok(clearNone.ok && clearNone.role === null, "'none' → clear");

  const reassignSame = roleAssignmentCheck("acc_main", "main", existing);
  ok(reassignSame.ok && reassignSame.role === "main", "same account re-asserting its role is fine");

  const conflict = roleAssignmentCheck("acc_new", "main", existing);
  ok(!conflict.ok, "role already taken by another account → conflict");
  if (!conflict.ok) ok(conflict.error.toLowerCase().includes("already assigned"), "conflict message is friendly");

  const invalid = roleAssignmentCheck("acc_new", "banana", existing);
  ok(!invalid.ok, "invalid role rejected");

  // A role held by null-account list shouldn't block (null never conflicts)
  const okAgainstNulls = roleAssignmentCheck("acc_new", "credit", [{ accountId: "a", role: null }]);
  ok(okAgainstNulls.ok, "null holders never conflict");

  if (failures.length > 0) {
    throw new Error("plaid-ui-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("plaid-ui-core: all self-tests passed");
}
