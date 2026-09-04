/**
 * tests/compliance/restage-plumbing.test.ts
 *
 * SLICE 18G — the two DB-boundary layers a pure test cannot reach.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL, GIVEN THE STANDING DOCTRINE
 * ─────────────────────────────────────────────────────────────────────────────
 * The doctrine in this repo is: text matching proves a word exists, never that
 * a value is right — prove it behaviourally. `classification-survives-restage`
 * does exactly that, executing the real planner and inspecting real values.
 *
 * But DEFECT 3 lived in FOUR layers, and only two of them are reachable that
 * way. The other two are the Supabase read and the Supabase insert:
 *
 *   loadCarryForwardItems()  — maps a menu_items row onto CarryForwardItem
 *   persistSnapshotItems()   — maps StagedSnapshotItem onto the insert payload
 *
 * Both are thin field-copy mappings wrapped around a network call. Executing
 * them needs a live database, which the pure suite deliberately does not have
 * (the `migrations` CI job has one; the `compliance` job must stay fast and
 * hermetic). So a value-level assertion is impossible here.
 *
 * The honest response is NOT to skip them. Two of the four layers is half a
 * fix, and the half that is unguarded is the half that touches production data.
 * So this file asserts the WEAKER claim it can actually make — that the columns
 * appear in both mappings — and says plainly that it is the weaker claim.
 *
 * What stops this from being a hollow grep:
 *   1. It is scoped to the exact function bodies, found by locating the
 *      function and reading to its end, not to the file as a whole. A mention
 *      in a comment elsewhere cannot satisfy it. (The 18E mutation round taught
 *      this the hard way: an unscoped indexOf matched an unrelated line
 *      hundreds of lines away and made an assertion vacuously true.)
 *   2. It asserts the key is being ASSIGNED FROM the source object
 *      (`low_thc_liquid: it.low_thc_liquid`), not merely named — so
 *      `low_thc_liquid: null` would FAIL. That is the exact mutation that would
 *      reintroduce the defect while leaving the column name in place.
 *   3. It pins the count of producers of a staged row, so adding a third
 *      producer forces a decision here rather than silently shipping a path
 *      nobody guarded.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const STAGING = "src/lib/pos/intake-menu-staging.ts";
const STAGING_CORE = "src/lib/pos/intake-menu-staging-core.ts";

/** The four columns the register reads to decide a statutory limit. */
const COLUMNS = ["low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package"] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Extract a balanced-brace body starting at a signature.
 *
 * Scoping matters more than it looks. The whole reason DEFECT 3 hid for so
 * long is that these columns ARE mentioned in these files — in types, in
 * comments, in neighbouring functions. An assertion that searched the file
 * would have passed throughout the entire period the bug was live.
 */
function bodyAfter(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) {
    throw new Error(
      `signature not found: ${signature}\n` +
        "The function was renamed or removed. Do not relax this test to make it " +
        "pass — re-derive the new name from source, because the guard is only " +
        "meaningful if it points at the code that actually runs.",
    );
  }
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${signature}`);
}

/**
 * Extract a single Supabase query chain, from `.from("<table>")` to the end of
 * that statement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: A MUTANT SURVIVED WITHOUT IT
 * ─────────────────────────────────────────────────────────────────────────
 * The first version of this file asserted that `.select("*")` appeared
 * somewhere inside loadCarryForwardItems(). The 18G mutation round narrowed
 * the menu_items select to an explicit column list and the assertion STILL
 * PASSED — because that function issues TWO queries, and the second one
 * (menu_variants, fetching variant rows) also selects "*". One `select("*")`
 * anywhere in the body satisfied a body-wide search.
 *
 * That is the same insufficient-scoping mistake this file's header already
 * warned about, made one level down: scoping to the function was not scoping
 * to the QUERY. The mutant was not softened; the guard was sharpened.
 */
function queryChainFor(body: string, table: string): string {
  const marker = `.from("${table}")`;
  const at = body.indexOf(marker);
  if (at < 0) {
    throw new Error(
      `no query against "${table}" found in this function body. The read was ` +
        "moved or the table renamed; re-derive it from source rather than " +
        "deleting this assertion.",
    );
  }
  const end = body.indexOf(";", at);
  return body.slice(at, end < 0 ? body.length : end + 1);
}

describe("SLICE 18G: the DB read carries the classification", () => {
  it("maps every limit column off the published row", () => {
    const body = bodyAfter(read(STAGING), "async function loadCarryForwardItems");
    for (const col of COLUMNS) {
      // Assert the ASSIGNMENT, not the mention. `${col}: null` must not pass.
      expect(
        body.includes(`${col}: it.${col}`),
        `loadCarryForwardItems does not carry ${col} off the row — a re-stage would ` +
          `blank it, and the register would stop applying that limit`,
      ).toBe(true);
    }
  });

  it("fetches the classification in the same query it maps from", () => {
    // The fix is only four lines BECAUSE the query already fetches everything.
    // Narrow that select to an explicit column list and the mapping above still
    // compiles, still runs, and silently yields undefined for every carried
    // product — the original defect, reintroduced from the other end.
    //
    // TWO scoping lessons are baked into this one assertion:
    //
    //  1. Scoped to the FUNCTION, not the file (the 18E lesson).
    //  2. Scoped to the menu_items QUERY, not the function body. That second
    //     step was added because a mutant survived without it:
    //     loadCarryForwardItems issues two queries, and the menu_variants one
    //     also selects "*", so a body-wide search stayed green while the item
    //     query had stopped returning the classification entirely.
    //
    // The assertion states the real requirement rather than pinning today's
    // spelling of it: the query must return these columns, whether by "*" or
    // by naming them. A deliberate future narrowing is allowed and is told
    // exactly which four names it must keep. (Narrowing would also strand the
    // ~20 other fields this mapper copies; that is a broader concern than
    // SLICE 18G and is not what this guard claims to cover.)
    const body = bodyAfter(read(STAGING), "async function loadCarryForwardItems");
    const itemsQuery = queryChainFor(body, "menu_items");
    const selectsEverything = itemsQuery.includes('.select("*")');
    for (const col of COLUMNS) {
      expect(
        selectsEverything || itemsQuery.includes(col),
        `the menu_items read does not return ${col}, but the mapping below reads ` +
          `it.${col}. It would be undefined, and every carried product would lose ` +
          `its classification on re-stage. Keep select("*") or name ${col} in the list.`,
      ).toBe(true);
    }
  });
});

describe("SLICE 18G: the DB write persists the classification", () => {
  it("includes every limit column in the insert payload", () => {
    const body = bodyAfter(read(STAGING), "async function persistSnapshotItems");
    for (const col of COLUMNS) {
      expect(
        body.includes(`${col}: it.${col}`),
        `persistSnapshotItems omits ${col} from the insert — the planner could carry ` +
          `it perfectly and the new row would still be NULL`,
      ).toBe(true);
    }
  });
});

describe("SLICE 18G: both producers of a staged row are covered", () => {
  /**
   * DEFECT 3 was reported (in 18E) as a carry-forward bug. It was not: the
   * newly-approved-product mapper dropped the same four columns, so the
   * approver's own answer never reached the register either. Fixing one and
   * not the other would have looked like a fix and still lost data.
   *
   * These two assertions are duplicated by the behavioural suite, on purpose:
   * that one proves the VALUES arrive, this one proves neither producer is
   * quietly deleted or bypassed later.
   */
  it("carryForward copies the classification from the carried item", () => {
    const body = bodyAfter(read(STAGING_CORE), "function carryForward(");
    for (const col of COLUMNS) {
      expect(
        body.includes(`${col}: item.${col}`),
        `carryForward does not carry ${col}`,
      ).toBe(true);
    }
  });

  it("masteredToSnapshot copies the classification from the approved card", () => {
    const body = bodyAfter(read(STAGING_CORE), "function masteredToSnapshot(");
    for (const col of COLUMNS) {
      expect(
        body.includes(`${col}: it.${col}`),
        `masteredToSnapshot does not carry ${col} — the approver's answer would be ` +
          `discarded on the way to the menu`,
      ).toBe(true);
    }
  });

  it("no third producer of a staged row has appeared unguarded", () => {
    // A StagedSnapshotItem is only ever built by these two functions. If a
    // third appears, it must be guarded too — and the type system already
    // forces it to SET the four columns (they are required on
    // StagedSnapshotItem), but nothing forces it to set them CORRECTLY.
    // Failing here is the prompt to add the assertion.
    const src = read(STAGING_CORE);
    const producers = src.match(/\):\s*StagedSnapshotItem\s*\{/g) ?? [];
    expect(
      producers.length,
      "the number of functions returning a StagedSnapshotItem changed; guard the new " +
        "one in this file and in classification-survives-restage.test.ts",
    ).toBe(2);
  });
});

describe("SLICE 18G: the recovery report stays read-only", () => {
  /**
   * The repair script proposes SQL for the owner to read; it must never
   * execute a write itself. That promise is only worth something if CI keeps
   * checking it, because the file is one careless edit away from becoming a
   * bulk rewrite of the columns the register enforces from — and a wrong
   * non-null value is more dangerous than the blank it replaced, since it
   * fails silently instead of visibly.
   *
   * The script can self-check via `--check-readonly`. This runs the same
   * assertion inside the suite so it cannot be skipped.
   */
  const RECOVERY_SCRIPT = "scripts/slice18g/recover-classifications.ts";

  it("contains no write operation in its executable lines", () => {
    const code = read(RECOVERY_SCRIPT)
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

    // Assembled, not written literally: a literal list matches its own
    // definition. That false positive is documented in the script itself.
    for (const op of ["update", "insert", "upsert", "delete", "rpc"]) {
      expect(
        code.includes(`.${op}(`),
        `${RECOVERY_SCRIPT} performs .${op}() — the recovery report must only ` +
          `propose SQL for a human to review, never apply it`,
      ).toBe(false);
    }
  });

  it("only ever proposes UPDATEs that are guarded against overwriting", () => {
    // Belt and braces on the rendered output: the SQL the owner is handed must
    // not contain a bare UPDATE. Asserted behaviourally in
    // classification-recovery.test.ts; asserted here at the source level so a
    // change to the renderer cannot quietly drop the guard from the template.
    const core = read("src/lib/pos/classification-recovery-core.ts");
    const body = bodyAfter(core, "export function renderRecoverySql");
    expect(
      body.includes("is null"),
      "renderRecoverySql no longer emits an `is null` guard; the proposed SQL could " +
        "overwrite a classification a human gave after the report was generated",
    ).toBe(true);
  });
});

describe("SLICE 18G: the null / false distinction is preserved in code", () => {
  it("never uses || to default a limit column", () => {
    // `a || null` turns FALSE into null; `a ?? null` does not. false is a
    // human's answer ("I looked, it is not a suppository") and it is what
    // silences the receiving dock's warning. Collapsing it to null would
    // resurrect the nagging that SLICE 18E existed to stop.
    //
    // Checked across both files, since either mapper could regress this way.
    for (const path of [STAGING, STAGING_CORE]) {
      const src = read(path);
      for (const col of COLUMNS) {
        const bad = new RegExp(`${col}\\s*:\\s*[A-Za-z_.]+\\s*\\|\\|`);
        expect(
          bad.test(src),
          `${path} uses || when assigning ${col}; that converts a human's "false" ` +
            `into "unanswered". Use ?? instead.`,
        ).toBe(false);
      }
    }
  });

  it("never hard-codes a limit column to false", () => {
    // Writing false where the answer is unknown invents a claim nobody made.
    // For otherwise_taken it would silence a question that was never asked;
    // for low_thc_liquid it would assert a carve-out that was never verified.
    for (const path of [STAGING, STAGING_CORE]) {
      const src = read(path);
      for (const col of COLUMNS) {
        const bad = new RegExp(`${col}\\s*:\\s*false`);
        expect(
          bad.test(src),
          `${path} hard-codes ${col} to false; an unanswered flag must stay null`,
        ).toBe(false);
      }
    }
  });
});
