/**
 * src/lib/auth/nav-gate-core.ts   (slice books-22)
 *
 * THE NAVIGATION IS A SECURITY SURFACE. This module says so in code.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every link in the admin nav carries a `permission`. Every admin page carries
 * its own guard — `requirePermission(...)` or `requireBooksAccess()`. Nothing
 * made those two agree. They were kept in step by a comment in
 * admin-nav-data.ts that reads, in part:
 *
 *   "Do NOT change these to \"reports.view\" -- that permission also grants
 *    manager and readonly, who would see the links and then hit a raw database
 *    refusal."
 *
 * That comment is correct and it is well-written and it is not a gate. It
 * cannot fail a build. Standing rule 44 was earned the hard way one slice ago:
 * a guard justified by a claim about the repository, where the claim itself was
 * never tested, is a lie with a citation. So the claim gets tested here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO FAILURES THIS PREVENTS, AND WHY THEY POINT OPPOSITE WAYS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * They are not the same bug and a single check will not catch both
 * (standing rule 34 — a gate must fire in both directions).
 *
 *   1. NAV TOO LOOSE — the nav advertises a page the user cannot open. The
 *      user clicks, the page refuses, and the screen fills with error text
 *      from a database that was never meant to be talked to that way. This is
 *      the dangerous one, because the obvious "fix" is to loosen the PAGE, and
 *      the page is the thing protecting the ledger.
 *
 *   2. NAV TOO TIGHT — the nav hides a page the user is entitled to use. No
 *      error, no ticket, no clue. The feature simply appears not to exist, and
 *      the owner concludes it was never built. Silent and slow.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS DERIVED VERSUS WHAT IS DECLARED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ownerOnlyPermissions()` is DERIVED from the permission matrix at call time.
 * It is not a hand-copied list, because a hand-copied list is a second source
 * of truth that drifts the first time someone edits the matrix and not the
 * copy. If a permission is narrowed to the owner tomorrow, this function
 * notices tomorrow.
 *
 * The GROUP membership rules are DECLARED, because they are policy — the
 * owner's decision about what belongs behind which tab — and policy has to be
 * written down somewhere it can be read and argued with.
 */

import type { StaffRole } from "@/lib/supabase/types";
import {
  ALL_PERMISSIONS,
  ALL_ROLES,
  can,
  rolesForPermission,
  type Permission,
} from "./roles";

/* ========================================================================== */
/* §1  WHAT "OWNER ONLY" MEANS, DERIVED FROM THE MATRIX                       */
/* ========================================================================== */

/**
 * Every permission held by the owner and nobody else, computed from the live
 * matrix.
 *
 * Deliberately a FUNCTION and not a `const` array: a const would be evaluated
 * once at module load and then be a snapshot, which is exactly the stale second
 * copy this module exists to avoid.
 */
export function ownerOnlyPermissions(): Permission[] {
  return ALL_PERMISSIONS.filter((p) => {
    const roles = rolesForPermission(p);
    return roles.length === 1 && roles[0] === "owner";
  });
}

/** Is this single permission owner-only? */
export function isOwnerOnlyPermission(permission: Permission): boolean {
  const roles = rolesForPermission(permission);
  return roles.length === 1 && roles[0] === "owner";
}

/* ========================================================================== */
/* §2  THE OWNER TABS (books-22 policy)                                       */
/* ========================================================================== */

/**
 * The nav group that holds the bookkeeping surface.
 *
 * OWNER DECISION, recorded verbatim (Michael, books-22):
 *   "Yes two tabs is good with me, the first let's call Accounting and the
 *    owner menu should be called Lyman."
 */
export const ACCOUNTING_GROUP = "Accounting" as const;

/** The nav group that holds the owner's own money and the Security Log. */
export const LYMAN_GROUP = "Lyman" as const;

export const OWNER_TAB_GROUPS: readonly string[] = [
  ACCOUNTING_GROUP,
  LYMAN_GROUP,
] as const;

/**
 * Items inside an owner tab that are deliberately NOT owner-only, each with the
 * reason. An exception that is written down is a decision; an exception that is
 * merely tolerated by a loose test is an oversight waiting to be discovered by
 * somebody else.
 *
 * Standing rule 12 (no silent plugs) applies to access control too: if the
 * suite is going to permit something, it must name it and say why.
 */
export type OwnerTabException = {
  readonly href: string;
  readonly permission: Permission;
  readonly why: string;
};

/**
 * EMPTY, AND THAT IS THE POINT (books-23).
 *
 * This list used to hold one entry, for /admin/inventory/audits gated on
 * `inventory.manage`. The reason given was that the audit tree had to stay open
 * because the employee count sheet lived underneath it, so a manager "can look
 * and can count".
 *
 * That reason stopped being true in books-23. Counting moved to its own
 * permission, `inventory.count`, and the pages split cleanly in two:
 *
 *   /admin/inventory/audits/[id]/count  -> inventory.count  (owner/admin/manager/staff)
 *   everything else under /admin/inventory/audits -> inventory.audit (owner alone)
 *
 * So the tab no longer needs an exception: the item in it is owner-only like
 * every other item, and the count sheet is reached from Cycle Counts, which sits
 * in the Inventory group where floor staff already work.
 *
 * The entry was DELETED rather than reworded. An allowance for a page that is no
 * longer loose is dead weight that makes the next real exception look normal
 * (standing rule 43). The type, the lookup and `unexpectedOwnerTabLeaks` are all
 * kept and all still tested against synthetic fixtures in the self-tests below,
 * so the machinery is ready if Michael ever does need to share a screen -- it is
 * simply not being used to excuse anything today.
 */
export const OWNER_TAB_EXCEPTIONS: readonly OwnerTabException[] = [] as const;

export function ownerTabExceptionFor(href: string): OwnerTabException | undefined {
  return OWNER_TAB_EXCEPTIONS.find((e) => e.href === href);
}

/* ========================================================================== */
/* §3  THE PAGE GUARDS, AS DATA                                               */
/* ========================================================================== */

/**
 * `requireBooksAccess()` is the books pages' guard. It is `is_owner()` in
 * application form, so in permission terms it is equivalent to "books.view".
 * Recorded here so the test can compare a books page against a nav entry
 * without special-casing the string in the test body.
 */
export const BOOKS_ACCESS_EQUIVALENT_PERMISSION: Permission = "books.view";

/**
 * The guard a page uses, extracted from its source.
 * `kind: "none"` means no guard was found — which for anything under an owner
 * tab is itself a failure.
 */
export type PageGuard =
  | { kind: "permission"; permission: string }
  | { kind: "books-access" }
  | { kind: "staff" }
  | { kind: "none" };

/**
 * `requireStaff()` only proves somebody is logged in. In role terms that is
 * every role this system has, which is exactly what "dashboard.view" grants.
 *
 * This mapping exists because of a defect found while attacking this very test
 * file (standing rule 38: green on the first run is a suspect). The original
 * extractor returned `kind: "none"` for a `requireStaff()` page, and the sweep
 * SKIPPED anything it could not classify. That meant downgrading a page from
 * `requirePermission("finances.view")` to `requireStaff()` -- opening one of
 * Michael's money pages to every cashier in the building -- would have made
 * the check disappear rather than fail. A guard that vanishes when the code
 * gets worse is standing rule 40: an unreachable guard is an untested guard.
 */
export const STAFF_ONLY_EQUIVALENT_PERMISSION: Permission = "dashboard.view";

/**
 * Read a page's guard out of its source text.
 *
 * Text-scanning rather than importing, on purpose: these are Next.js server
 * components that pull in Supabase and "server-only", so importing them into a
 * unit test is not possible. The trade-off is that this function is only as
 * good as its patterns, which is why `extractPageGuard` is itself tested
 * against hand-written fixtures — including the case where it finds nothing
 * (standing rule 39: a checker nobody checked is not evidence).
 */
export function extractPageGuard(source: string): PageGuard {
  const code = stripComments(source);
  if (/requireBooksAccess\s*\(/.test(code)) return { kind: "books-access" };
  const m = code.match(/requirePermission\s*\(\s*["']([a-z_.]+)["']\s*\)/);
  if (m && m[1]) return { kind: "permission", permission: m[1] };
  if (/requireStaff\s*\(/.test(code)) return { kind: "staff" };
  return { kind: "none" };
}

/**
 * Remove `//` and block comments before scanning for a guard.
 *
 * Not cosmetic. src/app/admin/books/payroll/page.tsx documents OTHER pages'
 * guards inside a comment:
 *
 *   src/app/admin/payroll/page.tsx  -> requirePermission("settings.manage")
 *
 * A raw text scan reads that sentence as if it were this page's own guard. The
 * books page happens to be caught first by `requireBooksAccess`, so today the
 * bug is invisible -- which is the only reason it is worth fixing now, while it
 * is cheap. Delete the books check and a page whose real protection is a
 * PROSE MENTION would report itself as guarded.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/** The permission a guard is equivalent to, or null when there is no guard. */
export function guardPermission(guard: PageGuard): string | null {
  if (guard.kind === "books-access") return BOOKS_ACCESS_EQUIVALENT_PERMISSION;
  if (guard.kind === "staff") return STAFF_ONLY_EQUIVALENT_PERMISSION;
  if (guard.kind === "permission") return guard.permission;
  return null;
}

/* ========================================================================== */
/* §4  AGREEMENT — THE CHECK ITSELF                                           */
/* ========================================================================== */

export type NavItemLike = {
  readonly label: string;
  readonly href: string;
  readonly permission: string;
  readonly group: string;
};

export type AgreementVerdict = {
  readonly agrees: boolean;
  /** Plain English, aimed at whoever is about to ship the mismatch. */
  readonly reason: string;
};

/**
 * Do a nav entry and a page guard admit exactly the same set of roles?
 *
 * Compared ROLE BY ROLE rather than by string equality, because two different
 * permission names can legitimately admit the same roles, and it is the roles
 * that decide who gets a refusal. String equality would reject a correct pair
 * (nav "books.view" vs page `requireBooksAccess()`) and — much worse — would
 * accept a wrong one the moment two names drifted apart in the matrix while
 * still looking alike.
 */
export function navAgreesWithPage(
  navPermission: string,
  guard: PageGuard,
): AgreementVerdict {
  const pagePermission = guardPermission(guard);
  if (pagePermission === null) {
    return {
      agrees: false,
      reason:
        "This page has no guard at all. Every admin page needs one: the nav " +
        "hiding a link is not protection, because the URL can be typed.",
    };
  }

  const navKnown = (ALL_PERMISSIONS as readonly string[]).includes(navPermission);
  const pageKnown = (ALL_PERMISSIONS as readonly string[]).includes(pagePermission);
  if (!navKnown) {
    return {
      agrees: false,
      reason:
        `The nav asks for "${navPermission}", which is not a permission this ` +
        `system has. A typo here fails open or closed at random.`,
    };
  }
  if (!pageKnown) {
    return {
      agrees: false,
      reason:
        `The page asks for "${pagePermission}", which is not a permission this ` +
        `system has.`,
    };
  }

  const disagreements: string[] = [];
  for (const role of ALL_ROLES) {
    const navAllows = can(role, navPermission as Permission);
    const pageAllows = can(role, pagePermission as Permission);
    if (navAllows !== pageAllows) {
      disagreements.push(
        navAllows
          ? `${role} is shown the link and then refused by the page`
          : `${role} may use the page but is never shown the link`,
      );
    }
  }

  if (disagreements.length > 0) {
    return {
      agrees: false,
      reason:
        `The nav says "${navPermission}" and the page says "${pagePermission}", ` +
        `and they disagree: ${disagreements.join("; ")}.`,
    };
  }

  return {
    agrees: true,
    reason: `Nav "${navPermission}" and page "${pagePermission}" admit the same roles.`,
  };
}

/* ========================================================================== */
/* §5  WHAT A ROLE ACTUALLY SEES                                              */
/* ========================================================================== */

/** The items a role can see, in nav order. */
export function navItemsForRole<T extends NavItemLike>(
  items: readonly T[],
  role: StaffRole,
): T[] {
  return items.filter((i) => can(role, i.permission as Permission));
}

/** The group names a role can see at all (groups with zero items disappear). */
export function groupsVisibleTo<T extends NavItemLike>(
  items: readonly T[],
  role: StaffRole,
): string[] {
  const seen = new Set<string>();
  for (const i of navItemsForRole(items, role)) seen.add(i.group);
  return [...seen];
}

/**
 * Every owner-tab item a non-owner can see, other than the declared exceptions.
 * An empty array is a pass. Returning the offenders rather than a boolean means
 * a failure names itself instead of just going red.
 */
export function unexpectedOwnerTabLeaks<T extends NavItemLike>(
  items: readonly T[],
): { role: StaffRole; label: string; href: string; permission: string }[] {
  const leaks: { role: StaffRole; label: string; href: string; permission: string }[] = [];
  for (const role of ALL_ROLES) {
    if (role === "owner") continue;
    for (const item of items) {
      if (!OWNER_TAB_GROUPS.includes(item.group)) continue;
      if (!can(role, item.permission as Permission)) continue;
      if (ownerTabExceptionFor(item.href)) continue;
      leaks.push({ role, label: item.label, href: item.href, permission: item.permission });
    }
  }
  return leaks;
}

/* ========================================================================== */
/* §6  EMBEDDED SELF-TESTS (pure, no I/O)                                     */
/* ========================================================================== */

export function __runNavGateTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  // ── derivation, not duplication ──
  const ownerOnly = ownerOnlyPermissions();
  ok(ownerOnly.includes("books.view"), "books.view is owner-only");
  ok(ownerOnly.includes("finances.view"), "finances.view is owner-only");
  ok(ownerOnly.includes("financials.view"), "financials.view is owner-only");
  ok(ownerOnly.includes("audit.view"), "audit.view is owner-only");
  ok(!ownerOnly.includes("users.manage"), "users.manage is NOT owner-only");
  ok(!ownerOnly.includes("inventory.manage"), "inventory.manage is NOT owner-only");
  ok(isOwnerOnlyPermission("audit.view"), "audit.view via single check");
  ok(!isOwnerOnlyPermission("settings.manage"), "settings.manage is owner+admin");

  // ── guard extraction, including the empty case ──
  ok(
    extractPageGuard('await requirePermission("audit.view");').kind === "permission",
    "extracts a requirePermission call",
  );
  ok(
    guardPermission(extractPageGuard('await requirePermission("audit.view");')) ===
      "audit.view",
    "extracts the permission string",
  );
  ok(
    extractPageGuard("const x = await requireBooksAccess();").kind === "books-access",
    "recognises requireBooksAccess",
  );
  ok(
    guardPermission(extractPageGuard("await requireBooksAccess();")) === "books.view",
    "books access maps to books.view",
  );
  ok(extractPageGuard("export default function Page() {}").kind === "none", "finds nothing when there is nothing");
  ok(
    extractPageGuard("await requireStaff();").kind === "staff",
    "recognises requireStaff as a real (but weak) guard",
  );
  ok(
    guardPermission(extractPageGuard("await requireStaff();")) === "dashboard.view",
    "requireStaff is every role, i.e. dashboard.view",
  );
  ok(
    !navAgreesWithPage("finances.view", extractPageGuard("await requireStaff();")).agrees,
    "a money page downgraded to requireStaff must FAIL, not be skipped",
  );
  ok(
    extractPageGuard('await requirePermission("x.y"); await requireStaff();').kind ===
      "permission",
    "an explicit permission wins over the requireStaff it calls internally",
  );
  ok(
    extractPageGuard('// see other/page.tsx -> requirePermission("settings.manage")').kind ===
      "none",
    "a guard named only in a line comment is not a guard",
  );
  ok(
    extractPageGuard('/* requirePermission("settings.manage") */').kind === "none",
    "a guard named only in a block comment is not a guard",
  );
  ok(
    extractPageGuard('/* docs */ await requirePermission("audit.view");').kind ===
      "permission",
    "stripping comments does not eat the real guard beside them",
  );
  ok(guardPermission({ kind: "none" }) === null, "no guard means null");
  ok(
    guardPermission(extractPageGuard("await requirePermission('audit.view')")) ===
      "audit.view",
    "single quotes work too",
  );

  // ── agreement, both directions ──
  ok(
    navAgreesWithPage("audit.view", { kind: "permission", permission: "audit.view" }).agrees,
    "identical permissions agree",
  );
  ok(
    navAgreesWithPage("books.view", { kind: "books-access" }).agrees,
    "nav books.view agrees with requireBooksAccess",
  );
  ok(
    !navAgreesWithPage("reports.view", { kind: "books-access" }).agrees,
    "TOO LOOSE is caught: reports.view nav over an owner-only page",
  );
  ok(
    navAgreesWithPage("reports.view", { kind: "books-access" }).reason.includes(
      "shown the link and then refused",
    ),
    "the too-loose message names the symptom",
  );
  ok(
    !navAgreesWithPage("books.view", { kind: "permission", permission: "reports.view" })
      .agrees,
    "TOO TIGHT is caught: owner-only nav over a page others may use",
  );
  ok(
    navAgreesWithPage("books.view", { kind: "permission", permission: "reports.view" })
      .reason.includes("never shown the link"),
    "the too-tight message names the symptom",
  );
  ok(
    !navAgreesWithPage("books.view", { kind: "none" }).agrees,
    "a page with NO guard never agrees",
  );
  ok(
    !navAgreesWithPage("books.veiw", { kind: "books-access" }).agrees,
    "a typo'd nav permission is caught",
  );
  ok(
    !navAgreesWithPage("books.view", { kind: "permission", permission: "books.veiw" })
      .agrees,
    "a typo'd page permission is caught",
  );

  // ── equal-roles-by-different-name must still agree ──
  ok(
    navAgreesWithPage("books.view", { kind: "permission", permission: "finances.view" })
      .agrees,
    "two different owner-only names admit the same roles, so they agree",
  );

  // ── visibility ──
  const sample: NavItemLike[] = [
    { label: "Ledger", href: "/admin/books/ledger", permission: "books.view", group: "Accounting" },
    { label: "ATM", href: "/admin/atm", permission: "finances.view", group: "Lyman" },
    { label: "Orders", href: "/admin/orders", permission: "orders.view", group: "Dashboard" },
  ];
  ok(navItemsForRole(sample, "owner").length === 3, "owner sees all three");
  ok(navItemsForRole(sample, "manager").length === 1, "manager sees only orders");
  ok(
    !groupsVisibleTo(sample, "manager").includes("Accounting"),
    "manager sees no Accounting tab at all",
  );
  ok(
    !groupsVisibleTo(sample, "manager").includes("Lyman"),
    "manager sees no Lyman tab at all",
  );
  ok(groupsVisibleTo(sample, "owner").length === 3, "owner sees three groups");
  ok(unexpectedOwnerTabLeaks(sample).length === 0, "no leaks in the clean sample");

  // ── a leak is detected, and the declared exception is not a leak ──
  const leaky: NavItemLike[] = [
    ...sample,
    { label: "Oops", href: "/admin/oops", permission: "reports.view", group: "Lyman" },
  ];
  const leaks = unexpectedOwnerTabLeaks(leaky);
  ok(leaks.length > 0, "a manager-visible item in Lyman is reported");
  ok(leaks.every((l) => l.href === "/admin/oops"), "only the offender is reported");
  ok(leaks.some((l) => l.role === "manager"), "the leaking role is named");

  // books-23: the real exception list is now EMPTY, so the machinery is exercised
  // against a synthetic entry instead. Testing it through whatever happens to be
  // in the live list would mean this logic stopped being tested the moment the
  // list emptied -- which is exactly what just happened (standing rule 50: a
  // module that only its own test imports is dead code wearing a green check
  // mark; the sibling failure is a check that only passes because there is
  // nothing left to check).
  ok(OWNER_TAB_EXCEPTIONS.length === 0, "no owner-tab exception is claimed today");
  ok(
    ownerTabExceptionFor("/admin/inventory/audits") === undefined,
    "the retired Inventory Auditing exception is really gone",
  );
  ok(ownerTabExceptionFor("/admin/atm") === undefined, "unrelated hrefs have no exception");

  const synthetic: readonly OwnerTabException[] = [
    {
      href: "/admin/synthetic",
      permission: "reports.view",
      why:
        "Synthetic fixture used to prove the exception mechanism still works while " +
        "the live list is empty. Not a real allowance for any real page.",
    },
  ];
  const findSynthetic = (href: string) => synthetic.find((e) => e.href === href);
  ok(findSynthetic("/admin/synthetic") !== undefined, "a declared exception is findable");
  ok(findSynthetic("/admin/atm") === undefined, "an undeclared href is not found");
  ok(
    (findSynthetic("/admin/synthetic")?.why.length ?? 0) > 80,
    "the exception explains itself at length, not with a shrug",
  );

  console.log(`nav-gate-core: PASSED ${passed} assertions`);
}
