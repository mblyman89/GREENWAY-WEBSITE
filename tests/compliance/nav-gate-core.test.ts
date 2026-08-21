/**
 * tests/compliance/nav-gate-core.test.ts   (slice books-22)
 *
 * THE NAV AND THE PAGE MUST SAY THE SAME WORD.
 *
 * Standing rule 44, earned in books-21: a guard justified by a claim about the
 * repository, where the claim is never tested, is a lie with a citation.
 * admin-nav-data.ts contains exactly such a claim —
 *
 *   "Do NOT change these to \"reports.view\" -- that permission also grants
 *    manager and readonly, who would see the links and then hit a raw database
 *    refusal."
 *
 * — and until this file existed, nothing enforced it. These tests read the REAL
 * nav data and the REAL page files off disk and compare them role by role.
 *
 * They also cover the books-22 owner decision:
 *
 *   "I am fine with my admin manager to pay employees and vendors, but they
 *    shouldn't be able to see my personal finances, the plaid feeds, the
 *    crypto, the atm, or the audit log, which you are right, let's change it
 *    to be Security Log. I do also want you to make sure the doors are all
 *    closed and locked tight."
 *
 * Both halves of that sentence are tested: what the admin LOSES, and what the
 * admin KEEPS. Testing only the first half would let a future change quietly
 * strip the admin of paying vendors and still go green.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ACCOUNTING_GROUP,
  LYMAN_GROUP,
  OWNER_TAB_GROUPS,
  OWNER_TAB_EXCEPTIONS,
  ownerTabExceptionFor,
  ownerOnlyPermissions,
  isOwnerOnlyPermission,
  extractPageGuard,
  guardPermission,
  navAgreesWithPage,
  navItemsForRole,
  groupsVisibleTo,
  unexpectedOwnerTabLeaks,
  __runNavGateTests,
} from "@/lib/auth/nav-gate-core";
import { adminNav, navGroups } from "@/components/admin/admin-nav-data";
import { ALL_ROLES, ALL_PERMISSIONS, can, rolesForPermission } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";

const REPO = join(__dirname, "..", "..");
const NAV_SRC = readFileSync(
  join(REPO, "src", "components", "admin", "admin-nav-data.ts"),
  "utf8",
);
const TOPNAV_SRC = readFileSync(
  join(REPO, "src", "components", "admin", "AdminTopNav.tsx"),
  "utf8",
);

/**
 * Map a nav href to the page file that actually serves it.
 *
 * The literal path is tried first, then Next.js DYNAMIC SEGMENTS. Six nav
 * entries (/admin/pages/home, /vendors, /faq, /about, /locations,
 * /price-match) have no folder of their own -- they are all served by
 * src/app/admin/pages/[slug]/page.tsx. The first version of this helper
 * returned null for all six, and the sweep below skips whatever it cannot
 * find, so those six pages were being reported as checked while never being
 * read. Resolving the dynamic route is what makes them real.
 */
function pageFileFor(href: string): string | null {
  const parts = href.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
  const direct = join(REPO, "src", "app", "admin", ...parts, "page.tsx");
  if (existsSync(direct)) return direct;

  // Walk the segments, substituting a dynamic folder ([slug], [id], ...) for
  // the last literal segment that has no directory of its own.
  for (let i = parts.length - 1; i >= 0; i--) {
    const prefix = join(REPO, "src", "app", "admin", ...parts.slice(0, i));
    if (!existsSync(prefix)) continue;
    const dynamic = readdirSync(prefix).find((d) => d.startsWith("[") && d.endsWith("]"));
    if (!dynamic) continue;
    const candidate = join(prefix, dynamic, ...parts.slice(i + 1), "page.tsx");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Extract the source text of a top-level exported function, for the structural
 * checks in N7. Used where a behavioural check is impossible because the right
 * and wrong implementations return the same value today.
 */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`export function ${name}`);
  if (at === -1) return "";
  let depth = 0;
  let started = false;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) return source.slice(at, i + 1);
    }
  }
  return "";
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* N1  the module's own logic                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N1 nav-gate-core self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runNavGateTests()).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N2  the new permission                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N2 audit.view is owner-only and separate from users.manage", () => {
  it("audit.view is granted to the owner alone", () => {
    expect(rolesForPermission("audit.view")).toEqual(["owner"]);
  });

  it("every non-owner role is refused the Security Log", () => {
    for (const role of ALL_ROLES) {
      if (role === "owner") continue;
      expect(can(role, "audit.view"), `${role} must not read the Security Log`).toBe(false);
    }
  });

  it("the admin specifically cannot read the Security Log", () => {
    // This is the point of the slice. Michael: "they shouldn't be able to see
    // ... the audit log".
    expect(can("admin", "audit.view")).toBe(false);
  });

  it("but the admin KEEPS user management", () => {
    // The reason a new permission was needed at all: /admin/audit used to share
    // users.manage with /admin/users. Taking the log away by narrowing
    // users.manage would have taken user management away too, which the owner
    // did not ask for.
    expect(can("admin", "users.manage")).toBe(true);
  });

  it("and the admin KEEPS paying vendors and employees", () => {
    // Michael, verbatim: "I am fine with my admin manager to pay employees and
    // vendors". Tested so a future tightening cannot quietly remove it.
    expect(can("admin", "payables.manage")).toBe(true);
    expect(can("admin", "staffing.manage")).toBe(true);
  });

  it("is a real, registered permission (not a string that only appears in the nav)", () => {
    expect(ALL_PERMISSIONS).toContain("audit.view");
  });

  it("appears in the permission matrix UI list so the owner can see it", () => {
    expect(ALL_PERMISSIONS.filter((p) => p === "audit.view")).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N3  THE CENTRAL CHECK: nav permission == page guard, for every item        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N3 every nav item agrees with the page it points at", () => {
  it("resolves a page file for EVERY nav item, with nothing skipped", () => {
    // Guards the guard (standing rule 39). The sweep below can only skip, so a
    // helper that quietly resolved nothing would report perfect agreement
    // across zero items. "Most of them" is not good enough here: the whole
    // point of the slice is that no door is left unchecked, so the bar is ALL
    // of them, named individually when they fail.
    const unresolved = adminNav
      .filter((i) => pageFileFor(i.href) === null)
      .map((i) => `${i.label} -> ${i.href}`);
    expect(unresolved, `nav items with no page file:\n${unresolved.join("\n")}`).toEqual([]);
    expect(adminNav.length).toBeGreaterThan(70);
  });

  it("every nav item is compared against a REAL guard, not skipped as unknown", () => {
    // The sweep ignores `kind: "none"`. If the extractor stopped recognising a
    // guard style, agreement would go green by comparing nothing. This asserts
    // the number actually compared, so a silent loss of coverage fails here.
    const unclassified = adminNav
      .filter((i) => {
        const f = pageFileFor(i.href);
        return f !== null && extractPageGuard(readFileSync(f, "utf8")).kind === "none";
      })
      .map((i) => `${i.label} (${i.href})`);
    expect(
      unclassified,
      `pages whose guard could not be read — each one is an unchecked door:\n${unclassified.join("\n")}`,
    ).toEqual([]);
  });

  it("no nav item advertises a page the user would then be refused", () => {
    const mismatches: string[] = [];
    for (const item of adminNav) {
      const file = pageFileFor(item.href);
      if (!file) continue;
      const guard = extractPageGuard(readFileSync(file, "utf8"));
      if (guard.kind === "none") continue; // covered separately, below
      const verdict = navAgreesWithPage(item.permission, guard);
      if (!verdict.agrees) {
        mismatches.push(`${item.label} (${item.href}): ${verdict.reason}`);
      }
    }
    expect(mismatches, `nav/page permission mismatches:\n${mismatches.join("\n")}`).toEqual(
      [],
    );
  });

  it("every OWNER-TAB page has a guard — the nav hiding a link is not protection", () => {
    // A URL can be typed. For the two owner tabs specifically, an unguarded
    // page is a hole, not a style issue.
    const unguarded: string[] = [];
    for (const item of adminNav) {
      if (!OWNER_TAB_GROUPS.includes(item.group)) continue;
      const file = pageFileFor(item.href);
      if (!file) continue;
      const guard = extractPageGuard(readFileSync(file, "utf8"));
      // "staff" counts as unguarded FOR AN OWNER TAB: requireStaff() only
      // proves somebody is logged in, which is every cashier on the floor.
      if (guard.kind === "none" || guard.kind === "staff") {
        unguarded.push(`${item.label} (${item.href}) -> ${guard.kind}`);
      }
    }
    expect(unguarded, `owner-tab pages with no guard: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("every nav permission is a permission this system actually has", () => {
    const unknown = adminNav
      .filter((i) => !(ALL_PERMISSIONS as readonly string[]).includes(i.permission))
      .map((i) => `${i.label} -> ${i.permission}`);
    expect(unknown, `typo'd nav permissions: ${unknown.join(", ")}`).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N4  the two owner tabs                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N3b owner-only pages that are NOT in the menu", () => {
  it("names every owner-only page missing from the nav, so none is forgotten", () => {
    // Found while fact-checking the owner report: the first sweep only looked at
    // top-level screens and concluded "nothing else is owner-only". That was
    // wrong -- 79 admin pages are absent from the main menu, and one of them is
    // owner-only. It is reachable through the Reports tab strip, so nothing is
    // stranded, but the owner was ASKED rather than having it moved for him.
    //
    // This test pins the answer. If a NEW owner-only page appears outside the
    // menu, it fails and names it, so the decision gets made on purpose
    // instead of by omission.
    const known = [
      "/admin/reports/accounting",
      // books-23: the "new audit" form. Owner-only by design and deliberately
      // NOT a menu item -- it is reached from a button on the audit hub, which
      // IS in the menu. Giving "start a new audit" its own top-level link would
      // put the rarest action in the most prominent place.
      "/admin/inventory/audits/new",
    ];
    const navHrefs = new Set(adminNav.map((i) => i.href));
    const ownerOnly = new Set<string>(ownerOnlyPermissions());

    const offenders: string[] = [];
    const walk = (dir: string, urlPrefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("[")) continue; // dynamic routes have no nav link
        const sub = join(dir, entry.name);
        const url = `${urlPrefix}/${entry.name}`;
        if (existsSync(join(sub, "page.tsx")) && !navHrefs.has(url)) {
          const guard = extractPageGuard(readFileSync(join(sub, "page.tsx"), "utf8"));
          const perm = guardPermission(guard);
          if (perm !== null && ownerOnly.has(perm as Permission) && !known.includes(url)) {
            offenders.push(`${url} (${perm})`);
          }
        }
        walk(sub, url);
      }
    };
    walk(join(REPO, "src", "app", "admin"), "/admin");

    expect(
      offenders,
      "owner-only pages that are not in the menu and not on the known list. " +
        "Each one is a decision nobody made:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("the known exception really is owner-only, so the allowance is not stale", () => {
    // Rule 40/43: an allowance for a page that is no longer owner-only is dead
    // weight that hides the next real one.
    const src = readFileSync(
      join(REPO, "src", "app", "admin", "reports", "accounting", "page.tsx"),
      "utf8",
    );
    expect(guardPermission(extractPageGuard(src))).toBe("financials.view");
    expect(isOwnerOnlyPermission("financials.view")).toBe(true);
  });
});

describe("N4 the Accounting and Lyman tabs", () => {
  it("both groups are registered in navGroups, or they never render", () => {
    // A group can exist on every item and still be invisible: buildNavGroups
    // walks navGroups, so an unregistered group is silently dropped. That is a
    // whole tab that vanishes with no error anywhere.
    expect(navGroups).toContain(ACCOUNTING_GROUP);
    expect(navGroups).toContain(LYMAN_GROUP);
  });

  it("Accounting holds the nine books screens plus Inventory Auditing", () => {
    const hrefs = adminNav
      .filter((i) => i.group === ACCOUNTING_GROUP)
      .map((i) => i.href)
      .sort();
    expect(hrefs).toEqual(
      [
        "/admin/books/accounts",
        "/admin/books/bank",
        "/admin/books/bills",
        "/admin/books/conversion",
        "/admin/books/journal",
        "/admin/books/ledger",
        "/admin/books/payroll",
        "/admin/books/payroll-setup",
        "/admin/books/trial-balance",
        "/admin/inventory/audits",
      ].sort(),
    );
  });

  it("Lyman holds the four money pages, the Security Log and the calendar", () => {
    /*
     * books-23 added the Compliance Calendar here. Michael, verbatim:
     *
     *   "For 5, I want it to be for me alone too, the employees should have not
     *    be harassed by the system for my not making a payment of filing a
     *    report etc. I'll keep that burden for myself."
     *
     * It was in the "Admin" group on settings.manage, which is owner + admin,
     * and the dashboard banner it feeds was shown to ALL SIX ROLES -- a
     * budtender saw a red "past due" card linking to a page that refused them.
     */
    const hrefs = adminNav
      .filter((i) => i.group === LYMAN_GROUP)
      .map((i) => i.href)
      .sort();
    expect(hrefs).toEqual(
      [
        "/admin/atm",
        "/admin/audit",
        "/admin/compliance/calendar",
        "/admin/crypto",
        "/admin/loans",
        "/admin/plaid",
      ].sort(),
    );
  });

  it("the calendar is NOT left behind in the Admin group as well", () => {
    // A move is a delete plus an add. Copy-pasting the line and forgetting to
    // remove the original would show it twice -- once in a tab an admin can see
    // -- and every permission assertion in this file would still pass, because
    // both copies would name the same owner-only permission.
    const calendar = adminNav.filter((i) => i.href === "/admin/compliance/calendar");
    expect(calendar).toHaveLength(1);
    expect(calendar[0]!.group).toBe(LYMAN_GROUP);
  });

  it("every Lyman item is owner-only, with no exceptions", () => {
    for (const item of adminNav.filter((i) => i.group === LYMAN_GROUP)) {
      expect(
        isOwnerOnlyPermission(item.permission as "audit.view"),
        `${item.label} must be owner-only`,
      ).toBe(true);
    }
  });

  it("nothing leaks into an owner tab except the declared exception", () => {
    const leaks = unexpectedOwnerTabLeaks(adminNav);
    const rendered = leaks.map((l) => `${l.role} can see ${l.label} (${l.permission})`);
    expect(leaks, `owner-tab leaks:\n${rendered.join("\n")}`).toEqual([]);
  });

  it("claims NO owner-tab exception, because none is needed any more", () => {
    // books-23 split counting (inventory.count) from auditing (inventory.audit),
    // so the Inventory Auditing item became owner-only like everything else in
    // the tab and its exception was deleted. If somebody re-adds an entry here,
    // that is a decision that needs a reason, and this test makes them notice.
    expect(OWNER_TAB_EXCEPTIONS).toHaveLength(0);
    expect(ownerTabExceptionFor("/admin/inventory/audits")).toBeUndefined();
  });

  it("every item in an owner tab is genuinely owner-only, with nothing excused", () => {
    // The stronger statement that the empty exception list now permits: not
    // "leaks are excused where declared" but "there is nothing to excuse".
    const offenders: string[] = [];
    for (const item of adminNav) {
      if (item.group !== ACCOUNTING_GROUP && item.group !== LYMAN_GROUP) continue;
      if (!isOwnerOnlyPermission(item.permission as "audit.view")) {
        offenders.push(`${item.label} (${item.href}) is gated on ${item.permission}`);
      }
    }
    expect(offenders, `owner-tab items that are not owner-only:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("counting is reachable by staff, and the count sheet is the ONLY such page", () => {
    // The reason the exception could be deleted at all. If this page were ever
    // tightened to owner-only, staff would silently lose counting -- so assert
    // the permission that makes Michael's workflow possible, and assert the
    // roles it actually reaches.
    const countPage = join(
      REPO,
      "src",
      "app",
      "admin",
      "inventory",
      "audits",
      "[id]",
      "count",
      "page.tsx",
    );
    expect(existsSync(countPage), "the employee count sheet must exist").toBe(true);
    const guard = extractPageGuard(readFileSync(countPage, "utf8"));
    expect(guardPermission(guard)).toBe("inventory.count");
    expect(can("staff", "inventory.count")).toBe(true);
    expect(can("manager", "inventory.count")).toBe(true);
    // ...and the analyst role, which exists to read reports, must NOT be able to
    // write counts onto the shelf record.
    expect(can("readonly", "inventory.count")).toBe(false);
    expect(can("content_editor", "inventory.count")).toBe(false);

    // Every OTHER page under the audit tree is owner-only.
    const auditRoot = join(REPO, "src", "app", "admin", "inventory", "audits");
    const loose: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx" && full !== countPage) {
          const p = guardPermission(extractPageGuard(readFileSync(full, "utf8")));
          if (p !== "inventory.audit") loose.push(`${full} -> ${p}`);
        }
      }
    };
    walk(auditRoot);
    expect(loose, `audit pages that are not owner-only:\n${loose.join("\n")}`).toEqual([]);
    expect(isOwnerOnlyPermission("inventory.audit")).toBe(true);
  });

  it("a manager sees NEITHER owner tab — not one item in either", () => {
    // STRENGTHENED in books-23. This used to allow the manager exactly one
    // Accounting item, /admin/inventory/audits, because the audit tree had to
    // stay open for counting. Counting now has its own permission and its own
    // home in the Inventory group, so the allowance is gone and the statement
    // the test makes is the stronger one: a manager sees no owner-tab item at
    // all, and neither tab renders for them.
    const groups = groupsVisibleTo(adminNav, "manager");
    expect(groups).not.toContain(LYMAN_GROUP);
    expect(groups).not.toContain(ACCOUNTING_GROUP);

    const visibleAccounting = navItemsForRole(adminNav, "manager").filter(
      (i) => i.group === ACCOUNTING_GROUP,
    );
    expect(visibleAccounting.map((i) => i.href)).toEqual([]);

    // ...and the manager still has the floor work they need, or this slice broke
    // the job instead of tightening it (standing rule 34: gates run in BOTH
    // directions).
    expect(can("manager", "inventory.count")).toBe(true);
    expect(can("manager", "inventory.manage")).toBe(true);
  });

  it("no non-owner sees any books screen or any money page", () => {
    const forbidden = adminNav.filter(
      (i) => i.permission === "books.view" || i.permission === "finances.view",
    );
    expect(forbidden.length).toBeGreaterThanOrEqual(13);
    for (const role of ALL_ROLES) {
      if (role === "owner") continue;
      for (const item of forbidden) {
        expect(
          can(role, item.permission as "books.view"),
          `${role} must not see ${item.label}`,
        ).toBe(false);
      }
    }
  });

  it("the owner sees every item in both tabs", () => {
    const ownerItems = navItemsForRole(adminNav, "owner");
    const inTabs = adminNav.filter((i) => OWNER_TAB_GROUPS.includes(i.group));
    for (const item of inTabs) {
      expect(ownerItems, `owner must see ${item.label}`).toContain(item);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N5  the Security Log rename                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N5 the Security Log rename", () => {
  it("the nav calls it Security Log", () => {
    const item = adminNav.find((i) => i.href === "/admin/audit");
    expect(item).toBeTruthy();
    expect(item!.label).toBe("Security Log");
    expect(item!.permission).toBe("audit.view");
    expect(item!.group).toBe(LYMAN_GROUP);
  });

  it("no user-visible label says \"Audit Log\" any more", () => {
    // Rule 42: two namespaces of similar words eventually trade places.
    // "Audit Log" (security) sitting beside "Inventory Auditing" (stock counts)
    // is that trap, which is why the owner renamed it.
    expect(NAV_SRC).not.toContain('label: "Audit Log"');
  });

  it("the page itself is re-gated and re-titled", () => {
    const src = readFileSync(join(REPO, "src", "app", "admin", "audit", "page.tsx"), "utf8");
    expect(guardPermission(extractPageGuard(src))).toBe("audit.view");
    expect(src).toContain('title="Security Log"');
    expect(src).not.toContain('title="Activity Log"');
  });

  it("the page's own server actions are gated just as tightly", () => {
    // A guarded page whose server actions are looser is not guarded: the
    // actions are callable directly, without ever rendering the page.
    const src = readFileSync(
      join(REPO, "src", "app", "admin", "audit", "anomaly-actions.ts"),
      "utf8",
    );
    expect(src).toContain('requirePermission("audit.view")');
    expect(src).not.toContain('requirePermission("users.manage")');
  });

  it("the concierge describes the tabs that actually exist", () => {
    // The concierge is where a confused user asks "where is X". If it still
    // lists an "Audit Log" under Admin, it sends people to a menu that no
    // longer has it, and they conclude the feature was deleted.
    const kb = readFileSync(join(REPO, "src", "lib", "admin", "concierge-kb.ts"), "utf8");
    expect(kb).toContain("Accounting (owner only)");
    expect(kb).toContain("Lyman (owner only)");
    expect(kb).toContain("Security Log");
    expect(kb, "the concierge must not advertise the old menu").not.toContain('"Audit Log"');
  });

  it("the help FAQ says who can read it, not just that it exists", () => {
    const help = readFileSync(join(REPO, "src", "lib", "admin", "help-content.ts"), "utf8");
    expect(help).toContain("Security Log");
    expect(help).toContain("owner-only");
  });

  it("Inventory Auditing still says it is NOT the security log", () => {
    // The disambiguating comment predates this slice and is load-bearing.
    const line = NAV_SRC.split("\n").find((l) =>
      l.includes('label: "Inventory Auditing"'),
    );
    expect(line).toBeTruthy();
    expect(line!.toLowerCase()).toContain("security log");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N6  the render path — a group that renders as a tab must be reachable      */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N6 the top nav can actually render the new tabs", () => {
  it("neither owner tab is registered as a DIRECT_LINK group", () => {
    // Direct-link groups render only their FIRST item and drop the rest, so
    // registering a 10-item group as a direct link would silently hide nine
    // screens. Both tabs must be dropdowns.
    const m = TOPNAV_SRC.match(/DIRECT_LINK_GROUPS = new Set<[^>]*>\(\[([^\]]*)\]\)/);
    expect(m, "DIRECT_LINK_GROUPS must be findable").toBeTruthy();
    const body = m![1]!;
    expect(body).not.toContain("Accounting");
    expect(body).not.toContain("Lyman");
  });

  it("the tab bar is driven by navGroups, so registration is sufficient", () => {
    expect(TOPNAV_SRC).toContain("buildNavGroups<AdminNavItem>(visible, navGroups, pathname)");
  });

  it("the nav filters by permission before rendering anything", () => {
    // The tabs are built from `visible`, not from adminNav directly. If this
    // ever changed, every role would see every tab.
    expect(TOPNAV_SRC).toContain("adminNav.filter((item) => can(role, item.permission");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N7  the derived owner-only list cannot drift                               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N7 owner-only is derived, not copied", () => {
  it("names exactly the six owner-only permissions in use today", () => {
    // books-23 added TWO. `inventory.audit`: approving and posting an inventory
    // audit is an accounting act, and Michael's instruction was that "anything
    // accounting, bookkeeping, taxes, finance, should be hard gated to me only."
    // `compliance.calendar`: the filing deadlines, which he asked to carry
    // alone so staff are not chased for them.
    //
    // compliance.calendar is deliberately NOT finances.view even though both
    // resolve to ["owner"] today. That permission is labelled "View money
    // accounts (bank feed, ATM vault, crypto, loans)", and a CCTV retention
    // spot-check is not a money account. Keeping them separate is what lets a
    // compliance manager be hired one day without handing over the bank feed.
    expect(ownerOnlyPermissions().sort()).toEqual(
      [
        "audit.view",
        "books.view",
        "compliance.calendar",
        "finances.view",
        "financials.view",
        "inventory.audit",
      ].sort(),
    );
  });

  it("compliance.calendar and finances.view are genuinely separate permissions", () => {
    // Standing rule 49: they return the same answer today, so test the
    // STRUCTURE. If someone "simplifies" by aliasing one to the other, the
    // roster test above still passes and this one does not.
    expect(ALL_PERMISSIONS).toContain("compliance.calendar");
    expect(ALL_PERMISSIONS).toContain("finances.view");
    expect(ALL_PERMISSIONS.filter((x) => x === "compliance.calendar")).toHaveLength(1);
  });

  it("is DERIVED from the matrix, not a hardcoded list that looks the same", () => {
    // This test exists because a mutant SURVIVED. Replacing the derivation with
    // a hardcoded list of the same four permissions passed every other test in
    // this file -- because today the hardcoded answer and the derived answer
    // are identical. They stop being identical the first time somebody narrows
    // a permission to the owner and forgets to update the copy, which is the
    // exact drift the module's own comment promises it prevents:
    //
    //   "It is not a hand-copied list, because a hand-copied list is a second
    //    source of truth that drifts the first time someone edits the matrix
    //    and not the copy."
    //
    // Standing rule 44: that comment is a claim about this repository, and an
    // untested claim is a lie with a citation. No comparison of VALUES can test
    // it, because the values agree. So the STRUCTURE is tested instead -- the
    // answer must be computed from the matrix, and must not name permissions.
    const src = readFileSync(join(REPO, "src", "lib", "auth", "nav-gate-core.ts"), "utf8");
    const body = functionBody(src, "ownerOnlyPermissions");
    expect(body, "ownerOnlyPermissions must be findable").toBeTruthy();
    expect(body).toContain("ALL_PERMISSIONS");
    expect(body).toContain("rolesForPermission");

    const bakedIn = [...body.matchAll(/["']([a-z_]+\.[a-z_]+)["']/g)].map((m) => m[1]);
    expect(
      bakedIn,
      `ownerOnlyPermissions names permissions literally (${bakedIn.join(", ")}). ` +
        "That is a second source of truth: the matrix could be narrowed and this " +
        "list would keep answering yesterday's question.",
    ).toEqual([]);

    const single = functionBody(src, "isOwnerOnlyPermission");
    expect(single, "isOwnerOnlyPermission must be findable").toBeTruthy();
    expect(single).toContain("rolesForPermission");
    expect([...single.matchAll(/["']([a-z_]+\.[a-z_]+)["']/g)].map((m) => m[1])).toEqual([]);
  });

  it("means ONLY the owner, not merely 'the owner is allowed too'", () => {
    // The difference between `roles.length === 1 && roles[0] === "owner"` and
    // `roles.includes("owner")` is the whole slice: the owner is allowed to do
    // essentially everything, so the looser version would call almost every
    // permission owner-only and the leak detector would go quiet forever.
    const ownerAlso = ALL_PERMISSIONS.filter((p) => rolesForPermission(p).includes("owner"));
    const ownerOnly = ownerOnlyPermissions();
    expect(
      ownerAlso.length,
      "sanity: the owner is allowed far more than the owner-only set",
    ).toBeGreaterThan(ownerOnly.length + 10);
    for (const p of ownerOnly) {
      expect(rolesForPermission(p), `${p} must admit the owner and nobody else`).toEqual([
        "owner",
      ]);
    }
  });

  it("agrees with the matrix for every permission and every role", () => {
    for (const p of ALL_PERMISSIONS) {
      const derived = isOwnerOnlyPermission(p);
      const actual = ALL_ROLES.every((r) => (r === "owner" ? can(r, p) : !can(r, p)));
      expect(derived, `${p}`).toBe(actual);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* N8  the database door, not just the page door                              */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("N8 migration 0193 locks the Security Log at the database", () => {
  const MIGRATION = readFileSync(
    join(REPO, "supabase", "migrations", "0193_security_log_owner_only.sql"),
    "utf8",
  );

  it("re-gates the read policy to is_owner()", () => {
    expect(MIGRATION).toContain("create policy audit_owner_read on public.audit_logs");
    expect(MIGRATION).toContain("for select using (public.is_owner())");
  });

  it("drops BOTH historical policy names, so it lands on any older database", () => {
    // The database could be at 0001 (audit_staff_read) or at 0130
    // (audit_admin_read). Dropping only one would leave the other in place and
    // RLS is permissive: a second read policy would silently re-open the table.
    expect(MIGRATION).toContain("drop policy if exists audit_staff_read on public.audit_logs;");
    expect(MIGRATION).toContain("drop policy if exists audit_admin_read on public.audit_logs;");
    expect(MIGRATION).toContain("drop policy if exists audit_owner_read on public.audit_logs;");
  });

  it("never weakens the read gate back to is_admin() or is_staff()", () => {
    const policySection = MIGRATION.slice(MIGRATION.indexOf("§1"));
    expect(policySection).not.toMatch(/using\s*\(\s*public\.is_admin\(\)\s*\)/);
    expect(policySection).not.toMatch(/using\s*\(\s*public\.is_staff\(\)\s*\)/);
  });

  it("keeps history append-only, including against the service role", () => {
    expect(MIGRATION).toContain(
      "revoke update, delete on table public.audit_logs from anon, authenticated, service_role;",
    );
  });

  it("does NOT touch insert, or the log would stop recording", () => {
    // Tightening SELECT must not blind the log. Writes come from the service
    // role, which bypasses RLS, so there is nothing to change here -- and a
    // future edit that adds an insert policy should have to think about it.
    expect(MIGRATION).not.toMatch(/for\s+insert/i);
    expect(MIGRATION).not.toMatch(/revoke\s+insert/i);
  });

  it("refuses to run out of order, naming the file to run first", () => {
    expect(MIGRATION).toContain("MIGRATION_OUT_OF_ORDER");
    expect(MIGRATION).toContain("0185_books_owner_only.sql");
    expect(MIGRATION).toContain("to_regprocedure('public.is_owner()') is null");
    expect(MIGRATION).toContain("Nothing was changed.");
  });

  it("says the same word as the page it is protecting", () => {
    // The whole point: the database gate and the application gate must not
    // drift. 0130's comment claimed they matched, and this slice made that
    // claim false -- which is how this file came to exist.
    const page = readFileSync(join(REPO, "src", "app", "admin", "audit", "page.tsx"), "utf8");
    expect(guardPermission(extractPageGuard(page))).toBe("audit.view");
    expect(rolesForPermission("audit.view")).toEqual(["owner"]);
    expect(MIGRATION).toContain("public.is_owner()");
    expect(MIGRATION).toContain('requirePermission("audit.view")');
  });

  it("is honest about what it does and does not lock today", () => {
    // Standing rule 12/29: the readers all use the service role, so this is
    // defence in depth rather than today's lock. Overstating it would be a
    // silent plug of a different kind -- a security claim nobody verified.
    expect(MIGRATION).toContain("createSupabaseAdminClient()");
    expect(MIGRATION.toLowerCase()).toContain("bypasses row-level security");
  });
});
