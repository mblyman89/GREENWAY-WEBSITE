/**
 * user-guards-core.ts — pure, testable guard rails for the Staff Users page.
 *
 * Task S-c: the owner asked for the users page to be "protected from malicious
 * behavior" with guard rails that still let him remove someone's access fast
 * when he has to let them go. Every rule below is enforced SERVER-SIDE in
 * src/app/admin/users/actions.ts — the UI hints are convenience only.
 *
 * The rules (rank comes from ROLE_RANK in roles.ts — owner 100 … readonly 10):
 *
 *  1. You cannot change YOUR OWN role or deactivate YOURSELF. Someone else
 *     with users.manage has to do it — this stops both accidental lockouts
 *     and a compromised session from quietly promoting itself.
 *  2. You cannot touch anyone RANKED ABOVE you. An admin can't demote or
 *     deactivate the owner.
 *  3. You cannot GRANT a role above your own. An admin can't mint owners —
 *     only an owner can create another owner (privilege ceiling; this closes
 *     the escalation hole where any admin could promote themselves a puppet
 *     owner account).
 *  4. The LAST ACTIVE OWNER can never be demoted or deactivated — the store
 *     can never be locked out of its own back office.
 *
 * Pure functions only (no imports beyond types/rank) so the whole matrix is
 * pinned by fast unit tests.
 */
import { ROLE_RANK, ALL_ROLES } from "./roles";
import type { StaffRole } from "@/lib/supabase/types";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Supabase ban durations: ~100 years = permanent; "none" lifts the ban. */
export const BAN_PERMANENT = "876000h";
export const BAN_LIFT = "none";

const ok: GuardResult = { ok: true };
const no = (reason: string): GuardResult => ({ ok: false, reason });

export function isKnownRole(role: string): role is StaffRole {
  return (ALL_ROLES as string[]).includes(role);
}

/** Rule 3 as a standalone check — also used for invites. */
export function guardGrantRole(actorRole: StaffRole, newRole: StaffRole): GuardResult {
  if (ROLE_RANK[newRole] > ROLE_RANK[actorRole]) {
    return no(
      `Only someone who is already ${newRole === "owner" ? "an owner" : `at least ${newRole}`} can grant the ${newRole} role.`,
    );
  }
  return ok;
}

export function guardRoleChange(input: {
  actorId: string;
  actorRole: StaffRole;
  targetId: string;
  targetRole: StaffRole;
  targetActive: boolean;
  newRole: StaffRole;
  /** count of staff_profiles with role='owner' AND active=true */
  activeOwnerCount: number;
}): GuardResult {
  const { actorId, actorRole, targetId, targetRole, targetActive, newRole, activeOwnerCount } =
    input;

  if (actorId === targetId) {
    return no("You can't change your own role — ask another owner or admin to do it.");
  }
  if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole]) {
    return no("You can't change the role of someone ranked above you.");
  }
  const grant = guardGrantRole(actorRole, newRole);
  if (!grant.ok) return grant;
  if (
    targetRole === "owner" &&
    newRole !== "owner" &&
    targetActive &&
    activeOwnerCount <= 1
  ) {
    return no("That's the last active owner — promote someone else to owner first.");
  }
  return ok;
}

export function guardActiveChange(input: {
  actorId: string;
  actorRole: StaffRole;
  targetId: string;
  targetRole: StaffRole;
  targetActive: boolean;
  /** true = reactivate, false = deactivate */
  nextActive: boolean;
  activeOwnerCount: number;
}): GuardResult {
  const { actorId, actorRole, targetId, targetRole, targetActive, nextActive, activeOwnerCount } =
    input;

  if (actorId === targetId && !nextActive) {
    return no("You can't deactivate yourself — ask another owner or admin to do it.");
  }
  if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole]) {
    return no(
      nextActive
        ? "You can't reactivate someone ranked above you."
        : "You can't deactivate someone ranked above you.",
    );
  }
  if (!nextActive && targetRole === "owner" && targetActive && activeOwnerCount <= 1) {
    return no("That's the last active owner — you can't lock the store out of its own back office.");
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* Self-tests                                                          */
/* ------------------------------------------------------------------ */

export function __runUserGuardTests(): number {
  let n = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`user-guards self-test failed: ${msg}`);
    n += 1;
  };

  const OWNER = { actorId: "o1", actorRole: "owner" as StaffRole };
  const ADMIN = { actorId: "a1", actorRole: "admin" as StaffRole };

  // --- guardGrantRole (privilege ceiling)
  assert(guardGrantRole("owner", "owner").ok, "owner can grant owner");
  assert(guardGrantRole("owner", "staff").ok, "owner can grant staff");
  assert(!guardGrantRole("admin", "owner").ok, "admin canNOT grant owner");
  assert(guardGrantRole("admin", "admin").ok, "admin can grant admin (same rank)");
  assert(guardGrantRole("admin", "manager").ok, "admin can grant manager");
  assert(!guardGrantRole("manager", "admin").ok, "manager canNOT grant admin");

  // --- guardRoleChange
  // rule 1: self
  assert(
    !guardRoleChange({
      ...OWNER,
      targetId: "o1",
      targetRole: "owner",
      targetActive: true,
      newRole: "admin",
      activeOwnerCount: 3,
    }).ok,
    "cannot change own role even with plenty of owners",
  );
  // rule 2: superiors
  assert(
    !guardRoleChange({
      ...ADMIN,
      targetId: "o1",
      targetRole: "owner",
      targetActive: true,
      newRole: "admin",
      activeOwnerCount: 5,
    }).ok,
    "admin cannot demote an owner",
  );
  // rule 3: escalation
  assert(
    !guardRoleChange({
      ...ADMIN,
      targetId: "s1",
      targetRole: "staff",
      targetActive: true,
      newRole: "owner",
      activeOwnerCount: 1,
    }).ok,
    "admin cannot promote anyone to owner",
  );
  // rule 4: last owner
  assert(
    !guardRoleChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: true,
      newRole: "admin",
      activeOwnerCount: 1,
    }).ok,
    "last active owner cannot be demoted",
  );
  assert(
    guardRoleChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: true,
      newRole: "admin",
      activeOwnerCount: 2,
    }).ok,
    "an owner CAN be demoted when another active owner remains",
  );
  // inactive owner being demoted doesn't hit the last-owner rule
  assert(
    guardRoleChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: false,
      newRole: "admin",
      activeOwnerCount: 1,
    }).ok,
    "demoting an INACTIVE owner is fine (they're not the last active one)",
  );
  // owner→owner no-op passes
  assert(
    guardRoleChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: true,
      newRole: "owner",
      activeOwnerCount: 1,
    }).ok,
    "keeping the last owner as owner is fine",
  );
  // normal promote/demote works
  assert(
    guardRoleChange({
      ...ADMIN,
      targetId: "s1",
      targetRole: "staff",
      targetActive: true,
      newRole: "manager",
      activeOwnerCount: 1,
    }).ok,
    "admin promotes staff to manager",
  );

  // --- guardActiveChange
  assert(
    !guardActiveChange({
      ...OWNER,
      targetId: "o1",
      targetRole: "owner",
      targetActive: true,
      nextActive: false,
      activeOwnerCount: 5,
    }).ok,
    "cannot deactivate yourself",
  );
  assert(
    guardActiveChange({
      ...OWNER,
      targetId: "o1",
      targetRole: "owner",
      targetActive: false,
      nextActive: true,
      activeOwnerCount: 5,
    }).ok,
    "reactivating yourself is allowed (you can't anyway while inactive, but not blocked here)",
  );
  assert(
    !guardActiveChange({
      ...ADMIN,
      targetId: "o1",
      targetRole: "owner",
      targetActive: true,
      nextActive: false,
      activeOwnerCount: 5,
    }).ok,
    "admin cannot deactivate an owner",
  );
  assert(
    !guardActiveChange({
      ...ADMIN,
      targetId: "o1",
      targetRole: "owner",
      targetActive: false,
      nextActive: true,
      activeOwnerCount: 5,
    }).ok,
    "admin cannot reactivate an owner either",
  );
  assert(
    !guardActiveChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: true,
      nextActive: false,
      activeOwnerCount: 1,
    }).ok,
    "last active owner cannot be deactivated",
  );
  assert(
    guardActiveChange({
      ...OWNER,
      targetId: "o2",
      targetRole: "owner",
      targetActive: true,
      nextActive: false,
      activeOwnerCount: 2,
    }).ok,
    "an owner CAN be deactivated when another active owner remains",
  );
  assert(
    guardActiveChange({
      ...ADMIN,
      targetId: "s1",
      targetRole: "staff",
      targetActive: true,
      nextActive: false,
      activeOwnerCount: 1,
    }).ok,
    "admin deactivates staff — the let-someone-go path stays fast",
  );
  assert(
    guardActiveChange({
      ...ADMIN,
      targetId: "s1",
      targetRole: "staff",
      targetActive: false,
      nextActive: true,
      activeOwnerCount: 1,
    }).ok,
    "admin reactivates staff",
  );

  // --- isKnownRole
  assert(isKnownRole("owner") && isKnownRole("readonly"), "known roles pass");
  assert(!isKnownRole("superuser") && !isKnownRole(""), "unknown roles fail");

  // --- ban constants sanity
  assert(BAN_PERMANENT === "876000h" && BAN_LIFT === "none", "ban constants pinned");

  return n;
}
