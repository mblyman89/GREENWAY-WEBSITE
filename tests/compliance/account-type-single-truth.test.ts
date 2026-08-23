/**
 * tests/compliance/account-type-single-truth.test.ts   (books-42)
 *
 * THE ACCOUNT TYPE IS DECLARED FOUR TIMES. THIS PROVES THE FOUR STILL AGREE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS DEFENDING, IN PLAIN ENGLISH
 * ─────────────────────────────────────────────────────────────────────────────
 * An account's TYPE is the single most consequential label in these books,
 * because it decides which side of the §280E wall a dollar lands on.
 *
 *   cogs      →  above the line  →  reduces the income the IRS taxes
 *   expense   →  below the line  →  real money spent, not one cent deductible
 *
 * Those two words differ by four letters and by roughly 37% of the amount.
 *
 * The list of legal types is currently written out FOUR separate times:
 *
 *   1. supabase/migrations/0172_gl_foundation.sql   — the CHECK constraint on
 *      gl_accounts.type. This one is the real authority: the database will
 *      physically refuse anything else.
 *   2. src/lib/accounting/ledger-core.ts            — the type most modules import.
 *   3. src/lib/accounting/trial-balance-core.ts     — its own private copy.
 *   4. src/lib/accounting/cutover-core.ts           — another private copy.
 *
 * Today all four are character-for-character identical, so nothing is broken
 * and there is no bug to fix. This file exists because of what happens on the
 * day they stop being identical, which is the kind of thing nobody notices:
 *
 *   Someone adds a ninth type — say `contra_income` — to the migration and to
 *   `ledger-core`, because those are the two they were working in. The trial
 *   balance's private copy does not have it. TypeScript is structural, so a
 *   value typed against `ledger-core.AccountType` will not fit
 *   `trial-balance-core.AccountType`, and the compiler complains in the one
 *   file that does the conversion. The quickest way to make the red squiggle go
 *   away is a cast. Now a real account flows through the trial balance with a
 *   type the trial balance has never heard of, `wallSideOf()` returns undefined
 *   for it, and the amount silently lands on whichever side of the wall the
 *   fallthrough happens to pick.
 *
 * Nothing crashes. The statements still balance. The tax number is wrong.
 *
 * That is standing rule 50 — dead code wearing a green check — arriving through
 * the front door. The correct long-term fix is for the three TypeScript copies
 * to become one import, and that is worth doing. It is not done in this slice
 * because collapsing a type that four modules and their test suites depend on
 * is its own change with its own blast radius, and this slice is the financial
 * statements. So the duplication is TOLERATED and POLICED: the tests below fail
 * the moment the copies diverge, and the failure message says which file to
 * edit. A known duplicate with a gate on it is a manageable debt. A known
 * duplicate with nothing watching it is a future incident.
 *
 * Standing rule 12: never silently plug a hole. This is the opposite — the hole
 * is written down, measured, and alarmed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

import { wallSideOf, WALL_SIDE_BY_ACCOUNT_TYPE } from "@/lib/accounting/financial-statements-core";
import type { AccountType } from "@/lib/accounting/trial-balance-core";

const REPO = process.cwd();

/**
 * Pull a `export type AccountType = "a" | "b" | ...;` union out of a source
 * file, textually.
 *
 * Textual on purpose. Importing the types would compare what TypeScript
 * ERASED — and the erasure of two different unions is the same nothing. The
 * only way to compare what a developer actually wrote is to read what they
 * actually wrote.
 */
function unionFromTs(relPath: string): readonly string[] {
  const src = readFileSync(join(REPO, relPath), "utf8");
  const m = /export type AccountType =([^;]+);/.exec(src);
  if (m === null) {
    throw new Error(
      `ACCOUNT TYPE GATE BROKEN: no 'export type AccountType' found in ${relPath}. ` +
        "Either the declaration moved, or it was collapsed into an import — if it was collapsed " +
        "deliberately, delete that file from the list at the top of this test and say so in the " +
        "commit message.",
    );
  }
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** Pull the list out of the CHECK constraint in the migration. */
function unionFromSql(): readonly string[] {
  const src = readFileSync(join(REPO, "supabase/migrations/0172_gl_foundation.sql"), "utf8");
  // `[\s\S]` rather than `.` with the `s` flag: the constraint is wrapped over
  // two lines in the migration, and the `s` flag needs an es2018 target this
  // project does not use.
  const m = /check \(type in \(([\s\S]+?)\)\)/.exec(src);
  if (m === null) {
    throw new Error(
      "ACCOUNT TYPE GATE BROKEN: no CHECK constraint on gl_accounts.type found in " +
        "0172_gl_foundation.sql. The database is the real authority for this list, so if the " +
        "constraint is gone the gate has lost its reference point.",
    );
  }
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

const TS_COPIES: readonly { label: string; path: string }[] = [
  { label: "ledger-core", path: "src/lib/accounting/ledger-core.ts" },
  { label: "trial-balance-core", path: "src/lib/accounting/trial-balance-core.ts" },
  { label: "cutover-core", path: "src/lib/accounting/cutover-core.ts" },
];

// ---------------------------------------------------------------------------
// 1) THE GATE ITSELF.
// ---------------------------------------------------------------------------

describe("the account type list is declared four times and all four agree", () => {
  it("the database CHECK constraint really was read — the gate is not inspecting nothing", () => {
    // Rule 39: a gate that parses nothing approves everything. If the regex
    // rots, every comparison below becomes [] === [] and passes for ever.
    const sql = unionFromSql();
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toContain("cogs");
    expect(sql).toContain("expense");
  });

  it("each TypeScript copy really was read", () => {
    for (const c of TS_COPIES) {
      const u = unionFromTs(c.path);
      expect(u.length, `${c.label} parsed empty`).toBeGreaterThan(0);
    }
  });

  it("there are exactly eight types, in the database", () => {
    expect([...unionFromSql()].sort()).toEqual([
      "asset",
      "cogs",
      "equity",
      "expense",
      "income",
      "liability",
      "other_expense",
      "other_income",
    ]);
  });

  it("EVERY TypeScript copy matches the database, member for member", () => {
    const sql = [...unionFromSql()].sort();
    for (const c of TS_COPIES) {
      const ts = [...unionFromTs(c.path)].sort();
      expect(
        ts,
        `${c.path} has drifted from the CHECK constraint in 0172_gl_foundation.sql. ` +
          "The database is the authority. Whichever list is wrong, fix it there — do NOT cast " +
          "around the compiler error, because a cast here silently moves money across the §280E wall.",
      ).toEqual(sql);
    }
  });

  it("EVERY TypeScript copy matches every other one, in the same ORDER", () => {
    // Order is checked as well as membership. Identical order is what makes a
    // diff of these files readable, and a reordered copy is the first sign that
    // someone edited one without looking at the others.
    const first = unionFromTs(TS_COPIES[0].path);
    for (const c of TS_COPIES.slice(1)) {
      expect(unionFromTs(c.path), `${c.path} vs ${TS_COPIES[0].path}`).toEqual(first);
    }
  });

  it("the count of declarations is pinned, so a FIFTH copy cannot appear unnoticed", () => {
    // Adding a fifth private copy is exactly the move this gate exists to
    // catch. If someone adds one legitimately they must come here, add it to
    // TS_COPIES, and thereby bring it under the gate.
    const found: string[] = [];
    const roots = ["src/lib/accounting", "src/lib/reports", "src/lib/payroll"];
    for (const root of roots) {
      const out = walk(join(REPO, root));
      for (const f of out) {
        const src = readFileSync(f, "utf8");
        if (/export type AccountType =/.test(src)) found.push(f.slice(REPO.length + 1));
      }
    }
    expect(
      [...found].sort(),
      "a new private copy of AccountType has appeared. Add it to TS_COPIES in this file so it is " +
        "policed, or better, make it import from ledger-core.",
    ).toEqual([...TS_COPIES.map((c) => c.path)].sort());
  });
});

// ---------------------------------------------------------------------------
// 2) THE CONSEQUENCE: EVERY TYPE HAS A SIDE OF THE WALL.
//
// The list agreeing is only half the danger. The other half is a type that
// exists everywhere and that the §280E classifier has no opinion about.
// ---------------------------------------------------------------------------

describe("every account type has a defined side of the §280E wall", () => {
  it("wallSideOf answers for every type the database permits — no undefined", () => {
    for (const t of unionFromSql()) {
      const side = wallSideOf(t as AccountType);
      expect(side, `wallSideOf('${t}') is undefined — this dollar has no side of the wall`).toBeDefined();
      expect(["above_the_line", "below_the_line", "not_applicable"]).toContain(side);
    }
  });

  it("the classifier has no entries for types that do not exist", () => {
    const known = new Set(unionFromSql());
    for (const k of Object.keys(WALL_SIDE_BY_ACCOUNT_TYPE)) {
      expect(known.has(k), `WALL_SIDE_BY_ACCOUNT_TYPE has a dead entry for '${k}'`).toBe(true);
    }
  });

  it("cogs is ABOVE the line and expense is BELOW it — the whole ballgame", () => {
    expect(wallSideOf("cogs")).toBe("above_the_line");
    expect(wallSideOf("expense")).toBe("below_the_line");
  });

  it("income is above the line, because §280E taxes gross income", () => {
    expect(wallSideOf("income")).toBe("above_the_line");
  });

  it("balance sheet types are not applicable — the wall is a P&L idea", () => {
    expect(wallSideOf("asset")).toBe("not_applicable");
    expect(wallSideOf("liability")).toBe("not_applicable");
    expect(wallSideOf("equity")).toBe("not_applicable");
  });

  it("an unknown type returns undefined rather than defaulting to a side", () => {
    // Proof that the safety in the first test is real. If this returned
    // "below_the_line" for junk, that test would pass while the system
    // silently classified typos.
    expect(wallSideOf("contra_income" as AccountType)).toBeUndefined();
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
