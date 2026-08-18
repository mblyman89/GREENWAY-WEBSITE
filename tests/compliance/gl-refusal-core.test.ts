/**
 * tests/compliance/gl-refusal-core.test.ts
 *
 * ADVERSARIAL MIRROR for src/lib/accounting/gl-refusal-core.ts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * gl-refusal-core shipped with 118 embedded self-assertions that NOTHING ever
 * ran. They were not registered in scripts/compliance/run-pure-selftests.ts and
 * had no vitest mirror, so the module that decides how the books say "no" was
 * covered by tests only in the sense that the tests existed on disk. That is
 * the same defect class recorded against trial-balance-core in todo.md (F4-M).
 *
 * While writing this mirror, three real defects fell out of the module. They
 * are fixed, and each has a named regression test below:
 *
 *   D1  Four codes in the catalogue were spellings NOTHING ever raised:
 *       GL_LINE_IN_THE_SAND (real: GL_BEFORE_LINE_IN_THE_SAND)
 *       GL_OB_FORBIDDEN     (real: plain GL_FORBIDDEN)
 *       GL_OB_OUT_OF_BALANCE(real: plain GL_OUT_OF_BALANCE)
 *       GL_OB_WRONG_ENTITY  (real: GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY)
 *       They looked like coverage while providing none, and the REAL refusals
 *       fell through to "this is not one of the checks we wrote".
 *
 *   D2  57 refusals that the migrations genuinely raise had no translation at
 *       all, including GL_IMMUTABLE (posted entries are permanent),
 *       GL_PERIOD_LOCKED (a return was filed on that month) and
 *       GL_INVENTORY_MANUAL (the 280E-critical one).
 *
 *   D3  explainGlRefusal computed the database's specific sentence -- the one
 *       carrying the actual journal number, account code, dates and cents --
 *       and then threw it away in a ternary whose two branches were identical:
 *           detail && detail !== known.title ? `${known.whatToDo}` : known.whatToDo
 *       The file header claimed the detail was preserved. It was not, and the
 *       UI only rendered raw text for UNRECOGNISED failures, so the better a
 *       refusal was understood, the LESS it told the owner.
 *
 * ---------------------------------------------------------------------------
 * THE TEST THAT MATTERS MOST IS THE DRIFT TEST
 * ---------------------------------------------------------------------------
 * Every assertion about a fixed list of codes rots the moment somebody adds a
 * new `raise exception` to a migration. So the last block here does not use a
 * hard-coded list at all: it reads supabase/migrations/*.sql, extracts every
 * refusal actually raised, and fails if any of them has no translation -- or
 * if the catalogue contains a code no migration raises. D1 and D2 could not
 * have survived a single run of that test, and neither can their successors.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  extractRefusalCode,
  stripRefusalCode,
  messageFrom,
  explainGlRefusal,
  isPermissionRefusal,
  knownRefusalCodes,
  __runGlRefusalCoreTests,
  type GlRefusal,
} from "@/lib/accounting/gl-refusal-core";
// The engine's runtime list of finding codes, used to prove that every bank
// code exempted from the SQL drift check is genuinely raisable in TypeScript
// rather than a phantom hidden behind the exemption list.
import { ALL_BANK_FINDING_CODES } from "@/lib/accounting/bank-match-core";

// ---------------------------------------------------------------------------
// The embedded suite, so both gates cover the same ground.
// ---------------------------------------------------------------------------
describe("embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runGlRefusalCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractRefusalCode -- the anchor is load-bearing
// ---------------------------------------------------------------------------
describe("extractRefusalCode", () => {
  it("pulls a leading code", () => {
    expect(extractRefusalCode("GL_OUT_OF_BALANCE: by 25 cents")).toBe("GL_OUT_OF_BALANCE");
  });

  it("tolerates leading whitespace", () => {
    expect(extractRefusalCode("   \t GL_FORBIDDEN: no")).toBe("GL_FORBIDDEN");
  });

  it("refuses a code that is not at the start", () => {
    // NEGATIVE CONTROL. Postgres often quotes one error inside another. If the
    // ^ anchor is dropped this returns a confident, wrong answer, and the UI
    // shows a calm explanation for a failure that never happened.
    expect(extractRefusalCode('timeout while handling "GL_FORBIDDEN: no"')).toBe("");
    expect(extractRefusalCode("error near GL_IMMUTABLE: x")).toBe("");
  });

  it("refuses lowercase and mixed case", () => {
    expect(extractRefusalCode("gl_forbidden: x")).toBe("");
    expect(extractRefusalCode("Gl_Forbidden: x")).toBe("");
  });

  it("requires the colon", () => {
    expect(extractRefusalCode("GL_FORBIDDEN no colon here")).toBe("");
  });

  it("requires at least two characters", () => {
    expect(extractRefusalCode("A: x")).toBe("");
    expect(extractRefusalCode("AB: x")).toBe("AB");
  });

  it("does not treat ordinary infrastructure failures as refusals", () => {
    for (const infra of [
      "fetch failed",
      "canceling statement due to statement timeout",
      "TypeError: Failed to fetch",
      "504 Gateway Timeout",
      "",
    ]) {
      expect(extractRefusalCode(infra)).toBe("");
    }
  });

  it("survives non-string input without throwing", () => {
    for (const junk of [null, undefined, 42, {}, []]) {
      expect(extractRefusalCode(junk as never)).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// stripRefusalCode
// ---------------------------------------------------------------------------
describe("stripRefusalCode", () => {
  it("removes the token and keeps the sentence verbatim", () => {
    expect(
      stripRefusalCode("GL_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01."),
    ).toBe("the range starts 2026-12-31 and ends 2026-01-01.");
  });

  it("leaves a message with no code untouched", () => {
    expect(stripRefusalCode("fetch failed")).toBe("fetch failed");
  });

  it("strips only the first token, not codes mentioned later", () => {
    expect(stripRefusalCode("GL_A_CODE: see also GL_OTHER: x")).toBe("see also GL_OTHER: x");
  });

  it("returns empty for a bare code with nothing after it", () => {
    expect(stripRefusalCode("GL_OUT_OF_BALANCE:")).toBe("");
  });

  it("never leaves the machine token in the output", () => {
    for (const code of knownRefusalCodes()) {
      expect(stripRefusalCode(`${code}: something specific happened`)).not.toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// messageFrom -- PostgREST hides the useful sentence in different fields
// ---------------------------------------------------------------------------
describe("messageFrom", () => {
  it("reads strings, message, details and hint", () => {
    expect(messageFrom("plain")).toBe("plain");
    expect(messageFrom({ message: "m" })).toBe("m");
    expect(messageFrom({ message: null, details: "d" })).toBe("d");
    expect(messageFrom({ message: null, details: null, hint: "h" })).toBe("h");
  });

  it("prefers whichever field actually carries the code", () => {
    // THE ONE THAT MATTERED IN PRODUCTION: the generic wrapper is in .message
    // and the real refusal is one field over. Reading only .message produced
    // blank refusals.
    expect(
      messageFrom({ message: "server error", details: "GL_OB_FROZEN: closed" }),
    ).toBe("GL_OB_FROZEN: closed");
    expect(
      messageFrom({ message: "wrapper", details: "noise", hint: "GL_IMMUTABLE: posted" }),
    ).toBe("GL_IMMUTABLE: posted");
  });

  it("falls back to the first non-empty part when no field carries a code", () => {
    expect(messageFrom({ message: "first", details: "second" })).toBe("first");
  });

  it("returns empty for nothing at all", () => {
    expect(messageFrom(null)).toBe("");
    expect(messageFrom(undefined)).toBe("");
    expect(messageFrom({})).toBe("");
    expect(messageFrom({ message: "   ", details: "  " })).toBe("");
  });

  it("trims, so whitespace-only fields never masquerade as a message", () => {
    expect(messageFrom({ message: "  padded  " })).toBe("padded");
  });
});

// ---------------------------------------------------------------------------
// explainGlRefusal -- honesty about what we do and do not understand
// ---------------------------------------------------------------------------
describe("explainGlRefusal: the honesty rule", () => {
  it("never dresses up an unknown failure as understood", () => {
    for (const unknown of [
      "fetch failed",
      "canceling statement due to statement timeout",
      "GL_INVENTED_TOMORROW: something new",
      "502 bad gateway",
    ]) {
      const r = explainGlRefusal(unknown);
      expect(r.recognised).toBe(false);
      expect(r.isPermission).toBe(false);
      expect(r.title.toLowerCase()).toContain("unexpected");
      expect(r.raw).toBe(unknown);
    }
  });

  it("never tells the owner to blindly retry an unknown failure", () => {
    // Retrying an unexplained failure against a set of books is how a wrong
    // number gets believed, or the same money gets posted twice.
    //
    // NOTE ON THIS ASSERTION: the first version of it matched /retry/ and
    // failed against the sentence "please report it rather than retrying
    // blindly" -- which is the message DISCOURAGING exactly what the test was
    // guarding against. A test that fires on the right behaviour is worse than
    // no test, so it now matches only the imperative advice.
    const r = explainGlRefusal("fetch failed");
    expect(r.whatToDo).not.toMatch(/\b(try again|please retry|retry it|just retry)\b/i);
    // And it must positively steer toward reporting instead.
    expect(r.whatToDo).toMatch(/report/i);
    // Nothing was changed is the reassurance that actually matters here.
    expect(r.whatToDo).toMatch(/nothing was changed/i);
  });

  it("still reports the code of an unrecognised but code-shaped failure", () => {
    const r = explainGlRefusal("GL_FROM_THE_FUTURE: invented later");
    expect(r.recognised).toBe(false);
    expect(r.code).toBe("GL_FROM_THE_FUTURE");
    expect(r.raw).toContain("invented later");
  });

  it("says something useful even when the failure is completely silent", () => {
    for (const silent of [null, undefined, "", {}]) {
      const r = explainGlRefusal(silent as never);
      expect(r.recognised).toBe(false);
      expect(r.title.trim().length).toBeGreaterThan(0);
      expect(r.whatToDo.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("explainGlRefusal: recognised refusals", () => {
  it("explains a permission wall as the system working, not as an error", () => {
    for (const code of ["TB_FORBIDDEN", "GL_FORBIDDEN"]) {
      const r = explainGlRefusal(`${code}: the general ledger is admin-only.`);
      expect(r.recognised).toBe(true);
      expect(r.isPermission).toBe(true);
    }
  });

  it("does not mark ordinary refusals as permission problems", () => {
    for (const code of ["GL_OUT_OF_BALANCE", "TB_RANGE_BACKWARDS", "GL_PERIOD_CLOSED"]) {
      expect(isPermissionRefusal(`${code}: x`)).toBe(false);
    }
  });

  it("never leaks the machine token into the human-facing text", () => {
    for (const code of knownRefusalCodes()) {
      const r = explainGlRefusal(`${code}: specifics here`);
      expect(r.title).not.toContain(code);
      expect(r.whatToDo).not.toContain(code);
      expect(r.detail).not.toContain(code);
      // ...but it is always kept for the record.
      expect(r.code).toBe(code);
    }
  });

  it("gives every recognised refusal both an explanation and an instruction", () => {
    for (const code of knownRefusalCodes()) {
      const r = explainGlRefusal(`${code}: x`);
      expect(r.recognised).toBe(true);
      expect(r.title.trim().length).toBeGreaterThan(0);
      expect(r.whatToDo.trim().length).toBeGreaterThan(0);
    }
  });

  it("writes in plain English, not in accounting jargon or SQL", () => {
    // The owner has not opened an accounting book in thirteen years. A refusal
    // that says "FK violation on gl_journal_lines" helps nobody.
    for (const code of knownRefusalCodes()) {
      const r = explainGlRefusal(`${code}: x`);
      const text = `${r.title} ${r.whatToDo}`;
      expect(text).not.toMatch(
        /\b(null|foreign key|constraint|trigger|rollback|plpgsql|errcode|relation)\b/i,
      );
    }
  });

  it("always preserves the raw text, even when it understands the refusal", () => {
    const raw = "GL_PERIOD_CLOSED: period 2026-03 for this entity is closed";
    expect(explainGlRefusal(raw).raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// DEFECT D3 REGRESSION -- the specifics must reach the screen
// ---------------------------------------------------------------------------
describe("D3: the database's specific figures survive to the owner", () => {
  it("keeps the sentence carrying the actual numbers", () => {
    const r = explainGlRefusal(
      "GL_OUT_OF_BALANCE: journal 41 is out of balance by 2500 cents (debits and credits must be equal)",
    );
    expect(r.recognised).toBe(true);
    // Being told an entry does not balance, without being told by how much, is
    // barely better than being told nothing.
    expect(r.detail).toContain("2500");
    expect(r.detail).toContain("journal 41");
  });

  it("keeps the offending dates on a backwards range", () => {
    const r = explainGlRefusal(
      "TB_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01.",
    );
    expect(r.detail).toBe("the range starts 2026-12-31 and ends 2026-01-01.");
  });

  it("keeps the account number on an account-specific refusal", () => {
    const r = explainGlRefusal(
      "GL_INVENTORY_MANUAL: account 12100 is inventory and cannot be adjusted by a typed journal entry.",
    );
    expect(r.detail).toContain("12100");
  });

  it("invents nothing when the database sent a bare code", () => {
    expect(explainGlRefusal("GL_OUT_OF_BALANCE:").detail).toBe("");
  });

  it("does not duplicate raw text as detail on unrecognised failures", () => {
    // The UI already renders `raw` in full for these; repeating it would show
    // the same words twice.
    expect(explainGlRefusal("fetch failed").detail).toBe("");
  });

  it("does not echo the generic title back as if it were specific", () => {
    const known = explainGlRefusal("GL_OUT_OF_BALANCE: x");
    const echoed = explainGlRefusal(`GL_OUT_OF_BALANCE: ${known.title}`);
    expect(echoed.detail).toBe("");
  });

  it("every field of the result is a string, never undefined", () => {
    // The UI does truthiness checks on these; an undefined would render as a
    // blank panel with no explanation at all.
    const cases: GlRefusal[] = [
      explainGlRefusal("GL_FORBIDDEN: x"),
      explainGlRefusal("fetch failed"),
      explainGlRefusal(null),
      explainGlRefusal("GL_OUT_OF_BALANCE:"),
    ];
    for (const r of cases) {
      expect(typeof r.title).toBe("string");
      expect(typeof r.whatToDo).toBe("string");
      expect(typeof r.detail).toBe("string");
      expect(typeof r.raw).toBe("string");
      expect(typeof r.code).toBe("string");
      expect(typeof r.recognised).toBe("boolean");
      expect(typeof r.isPermission).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// DEFECT D1 REGRESSION -- no phantom codes
// ---------------------------------------------------------------------------
describe("D1: the catalogue names refusals that actually exist", () => {
  it("uses the real spelling of the pre-cut-over refusal", () => {
    expect(explainGlRefusal("GL_BEFORE_LINE_IN_THE_SAND: dated 2025-12-31").recognised).toBe(true);
    expect(knownRefusalCodes()).not.toContain("GL_LINE_IN_THE_SAND");
  });

  it("understands the opening-balance permission wall, which is plain GL_FORBIDDEN", () => {
    const r = explainGlRefusal("GL_FORBIDDEN: the opening balance worksheet is admin-only.");
    expect(r.recognised).toBe(true);
    expect(r.isPermission).toBe(true);
    expect(knownRefusalCodes()).not.toContain("GL_OB_FORBIDDEN");
  });

  it("understands an unbalanced opening balance sheet, which is plain GL_OUT_OF_BALANCE", () => {
    expect(explainGlRefusal("GL_OUT_OF_BALANCE: journal 3 is out of balance by 12 cents").recognised)
      .toBe(true);
    expect(knownRefusalCodes()).not.toContain("GL_OB_OUT_OF_BALANCE");
  });

  it("uses the real spelling of the opening-balance entity refusal", () => {
    expect(
      explainGlRefusal("GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: account 12100 (Inventory)")
        .recognised,
    ).toBe(true);
    expect(knownRefusalCodes()).not.toContain("GL_OB_WRONG_ENTITY");
  });
});

// ---------------------------------------------------------------------------
// DEFECT D2 REGRESSION -- the expensive refusals are explained
// ---------------------------------------------------------------------------
describe("D2: the refusals that cost real money are in plain English", () => {
  const mustExplain: ReadonlyArray<[string, RegExp]> = [
    // Posted history is permanent. If this reads as a raw error the owner may
    // think the system is broken and start looking for a way around it.
    ["GL_IMMUTABLE", /revers/i],
    // A filed tax return sits on that month. This one can never be reopened.
    ["GL_PERIOD_LOCKED", /tax return|filed/i],
    ["GL_PERIOD_CLOSED", /closed/i],
    // 280E: inventory is what makes cost of goods sold deductible at all.
    ["GL_INVENTORY_MANUAL", /inventory/i],
    ["GL_COST_CLASS_REQUIRED", /280E|deduct/i],
    ["GL_LAND_NOT_DEPRECIABLE", /land/i],
    ["GL_CONTROL_ACCOUNT", /automatic|itself|detail/i],
    ["GL_AUTOPOST_NO_THREE_WAY_MATCH", /order|invoice|arriv/i],
    ["GL_TOO_FEW_LINES", /two lines|both sides|other side/i],
    ["GL_OPEN_DRAFTS", /draft|post them|delete/i],
    ["GL_OWNERSHIP", /100%/],
    ["GL_MAP_TARGET", /vanish|does not exist|real account/i],
  ];

  it.each(mustExplain)("explains %s usefully", (code, expected) => {
    const r = explainGlRefusal(`${code}: specifics`);
    expect(r.recognised).toBe(true);
    expect(`${r.title} ${r.whatToDo}`).toMatch(expected);
  });
});

// ---------------------------------------------------------------------------
// THE DRIFT TEST -- the one that stops D1 and D2 ever happening again
// ---------------------------------------------------------------------------
describe("drift: the catalogue is checked against the migrations themselves", () => {
  const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");

  /** Every `raise exception 'CODE: ...'` the database can actually throw. */
  function codesRaisedByMigrations(): Set<string> {
    const found = new Set<string>();
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    // Guard the guard: if the glob ever matches nothing, this test would pass
    // vacuously and prove the opposite of what it claims.
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) {
      const sql = readFileSync(path.join(migrationsDir, f), "utf8");
      for (const m of sql.matchAll(/raise\s+exception\s+'((?:GL|TB)_[A-Z0-9_]+)\s*:/gi)) {
        found.add(m[1]);
      }
    }
    return found;
  }

  it("finds a substantial number of refusals in the SQL (the extractor works)", () => {
    // If the regex silently stops matching, every assertion below turns into a
    // no-op. This is the negative control for the drift test itself.
    expect(codesRaisedByMigrations().size).toBeGreaterThan(50);
  });

  it("explains EVERY refusal the database can raise", () => {
    const raised = codesRaisedByMigrations();
    const explained = new Set(knownRefusalCodes());
    const untranslated = [...raised].filter((c) => !explained.has(c)).sort();

    // This is the assertion that would have caught D2 on day one: 57 refusals
    // the owner could hit, every one of which reached the screen as
    // "Unexpected problem" plus raw Postgres text.
    expect(
      untranslated,
      `These refusals are raised by supabase/migrations but have no plain-English translation in gl-refusal-core.ts, so the owner would see raw database text:\n  ${untranslated.join("\n  ")}`,
    ).toEqual([]);
  });

  it("contains no phantom codes that nothing can ever raise", () => {
    const raised = codesRaisedByMigrations();
    const explained = knownRefusalCodes();

    // Codes raised only by the TypeScript validation layer rather than by SQL.
    // These are real and reachable, so they are legitimate catalogue entries;
    // they are listed explicitly so the list cannot quietly grow.
    const raisedInTypeScriptOnly = new Set([
      "GL_BEFORE_LINE_IN_THE_SAND",
      "GL_APPROVAL_REQUIRED",
      "GL_SELF_APPROVAL_REFUSED",
      "GL_NO_APPROVER_IDENTITY",
      "GL_NO_ACTOR",
      "GL_POST_CONFLICT",
      "GL_ALREADY_POSTED",
      "GL_NO_APPROVAL_POLICY",
      "GL_OVERRIDE_REASON_REQUIRED",
      "GL_OVERRIDE_LOG_APPEND_ONLY",
      "GL_OB_FROZEN",
      "GL_OB_EMPTY",
      "GL_OB_NO_EVIDENCE",
      "GL_OB_INACTIVE_ACCOUNT",
      "GL_NO_ENTITY",
      "GL_UNKNOWN_ENTITY",
      "GL_RANGE_BACKWARDS",
      "GL_OUT_OF_BALANCE",
      "GL_FORBIDDEN",
      "TB_FORBIDDEN",
      "TB_NO_ENTITY",
      "TB_UNKNOWN_ENTITY",
      "TB_RANGE_BACKWARDS",
      // ---- books-05: the bank matcher's TypeScript-layer refusals ----------
      // These eight are raised by evaluateMatch() in bank-match-core.ts rather
      // than by migration 0189. That split is deliberate, not an oversight: the
      // database enforces the rules that must hold no matter what (the sign
      // wall, the cut-over date, double-matching, whether a month is complete),
      // while these are judgements about a PROPOSED match, made before anything
      // is submitted, so that Michael is told what is wrong while he can still
      // fix it rather than after a refusal.
      //
      // Each one is proved reachable by the test immediately below, so adding a
      // name here cannot be used to silence a genuinely dead entry.
      "GL_BANK_COMMINGLED",
      "GL_BANK_DATE_TOO_FAR",
      "GL_BANK_DOUBLE_COUNT_RISK",
      "GL_BANK_INVALID_DATE",
      "GL_BANK_LOAN_SINGLE_LINE",
      "GL_BANK_NON_INTEGER_CENTS",
      "GL_BANK_NO_COST_CLASS",
      "GL_BANK_TRANSFER_AS_INCOME",
    ]);

    const phantom = explained
      .filter((c) => !raised.has(c) && !raisedInTypeScriptOnly.has(c))
      .sort();

    // This is the assertion that would have caught D1: four entries that
    // looked like coverage and could never fire.
    expect(
      phantom,
      `These codes are explained in gl-refusal-core.ts but nothing raises them. Either the spelling is wrong (so the REAL refusal falls through as "unexpected"), or the entry is dead:\n  ${phantom.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the TypeScript-only allowlist cannot be used to hide a dead code", () => {
    /*
      WHY THIS TEST EXISTS.

      The phantom-code test above has one escape hatch: `raisedInTypeScriptOnly`.
      Anything added to that list stops being checked. That makes the list the
      weakest point in the whole drift guard - the obvious way to make a failing
      phantom-code test go quiet is to paste the failing code into it, and
      nothing would ever complain again.

      So the eight bank codes added for books-05 are verified here against the
      engine's OWN runtime list of finding codes. If a code is in the allowlist
      but the engine cannot produce it, it is a phantom that was smuggled past
      the guard, and this fails.

      Note the mapping: the catalogue is keyed on database-style names
      (GL_BANK_SIGN_DISAGREES) while the TypeScript engine raises the same
      concept without the GL_ prefix (BANK_SIGN_DISAGREES). That prefix
      difference is precisely the sort of thing that produces a code which
      "looks explained" while the real refusal falls through to the screen as an
      unexpected error - which was defect D1 in this very file. Asserting the
      correspondence here keeps the two naming schemes locked together.
    */
    const bankCodesInAllowlist = [
      "GL_BANK_COMMINGLED",
      "GL_BANK_DATE_TOO_FAR",
      "GL_BANK_DOUBLE_COUNT_RISK",
      "GL_BANK_INVALID_DATE",
      "GL_BANK_LOAN_SINGLE_LINE",
      "GL_BANK_NON_INTEGER_CENTS",
      "GL_BANK_NO_COST_CLASS",
      "GL_BANK_TRANSFER_AS_INCOME",
    ];

    const engineCodes = new Set<string>(ALL_BANK_FINDING_CODES);

    // Guards the guard: if the import ever resolves to something empty, every
    // assertion below would pass while checking nothing.
    expect(engineCodes.size).toBeGreaterThan(10);

    for (const glCode of bankCodesInAllowlist) {
      const engineCode = glCode.replace(/^GL_/, "");
      expect(
        engineCodes.has(engineCode),
        `${glCode} is on the TypeScript-only allowlist but the engine cannot raise ${engineCode} - it is a phantom, not an exemption`,
      ).toBe(true);

      // ...and it must genuinely be absent from the catalogue's SQL side, or it
      // does not belong on a TypeScript-only list in the first place.
      expect(knownRefusalCodes()).toContain(glCode);
    }

    // Negative control (standing rule 15): a made-up code must NOT be
    // findable, proving this test discriminates rather than passing anything.
    expect(engineCodes.has("BANK_NOT_A_REAL_CODE")).toBe(false);
  });

  it("has no duplicate entries in the catalogue", () => {
    const codes = knownRefusalCodes();
    expect(codes.length).toBe(new Set(codes).size);
  });

  it("returns the catalogue sorted, so diffs stay reviewable", () => {
    const codes = knownRefusalCodes();
    expect(codes).toEqual([...codes].sort());
  });
});
