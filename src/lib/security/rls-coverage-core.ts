/**
 * src/lib/security/rls-coverage-core.ts  (GW-019 regression guard)
 *
 * PURE parser that proves EVERY table created by the SQL migrations also has
 * row-level security enabled somewhere in the migrations. In Supabase, a
 * table without RLS is fully readable AND writable through the auto-generated
 * PostgREST API by anyone holding the public anon key (which ships in the
 * browser bundle by design) — so a single forgotten `enable row level
 * security` line is an open side door. GW-019 found exactly four such tables;
 * this module turns the auditor's one-time check into a PERMANENT tripwire:
 * the vitest mirror (tests/compliance/rls-coverage.test.ts) feeds it the real
 * migration files on every PR, so the NEXT RLS-less table is a red X before
 * it ever reaches the database.
 *
 * Pure: string in, structured facts out. No fs, no env — the callers supply
 * file contents, which keeps this unit-testable with tsx and safe for the
 * compliance CI harness.
 *
 * Parsing rules (matched to this repo's real migration styles):
 *   1. Created tables:   `create table [if not exists] public.<name> (…)`
 *      (every migration in the repo uses the explicit `public.` prefix —
 *      verified by grep; there is no dynamic table creation).
 *   2. Static RLS:       `alter table [only] public.<name> enable row level security`
 *   3. Dynamic RLS:      `do $$ … foreach t in array array['a','b'] …
 *                         execute format('alter table public.%I enable row level
 *                         security', t) … $$` — used by 0039/0040/0113. For a
 *                        `do $$…$$` block that contains the RLS-enable text we
 *                        harvest every quoted identifier inside its
 *                        `array[…]` literals.
 *   4. `--` line comments are stripped first (outside string literals), so a
 *      commented-out statement never counts as coverage.
 */

export type MigrationFile = {
  /** File name, e.g. "0130_security_rls_hardening.sql" (for reporting). */
  name: string;
  /** Full SQL contents. */
  sql: string;
};

export type RlsCoverageReport = {
  /** Every table name created across the files (sorted, unique). */
  created: string[];
  /** Every table name with RLS enabled across the files (sorted, unique). */
  rlsEnabled: string[];
  /** Created tables with NO RLS enable anywhere — the security gaps. */
  gaps: string[];
  /** file name -> tables it creates (for pinpointing a gap's origin). */
  createdByFile: Record<string, string[]>;
};

/**
 * Strip `--` line comments, respecting single-quoted string literals so a
 * `--` inside a string (rare, but legal SQL) is not treated as a comment.
 */
export function stripLineComments(sql: string): string {
  const out: string[] = [];
  for (const line of sql.split("\n")) {
    let inQuote = false;
    let cut = line.length;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'") {
        // A doubled '' inside a literal is an escaped quote, not a boundary.
        if (inQuote && line[i + 1] === "'") {
          i++;
          continue;
        }
        inQuote = !inQuote;
      } else if (!inQuote && ch === "-" && line[i + 1] === "-") {
        cut = i;
        break;
      }
    }
    out.push(line.slice(0, cut));
  }
  return out.join("\n");
}

/** Table names created via `create table [if not exists] public.<name>`. */
export function extractCreatedTables(sql: string): string[] {
  const clean = stripLineComments(sql);
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) names.add(m[1].toLowerCase());
  return [...names].sort();
}

/**
 * Table names with RLS enabled — static `alter table` statements plus the
 * dynamic `do $$ … foreach … execute format(…enable row level security…)`
 * pattern (identifiers harvested from `array[…]` literals inside any DO
 * block that mentions the RLS-enable text).
 */
export function extractRlsEnabledTables(sql: string): string[] {
  const clean = stripLineComments(sql);
  const names = new Set<string>();

  // 1. Static form.
  const staticRe =
    /alter\s+table\s+(?:only\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(clean)) !== null) names.add(m[1].toLowerCase());

  // 2. Dynamic form inside DO blocks.
  const doBlockRe = /do\s+\$\$([\s\S]*?)\$\$/gi;
  let block: RegExpExecArray | null;
  while ((block = doBlockRe.exec(clean)) !== null) {
    const body = block[1];
    if (!/enable\s+row\s+level\s+security/i.test(body)) continue;
    const arrayRe = /array\s*\[([\s\S]*?)\]/gi;
    let arr: RegExpExecArray | null;
    while ((arr = arrayRe.exec(body)) !== null) {
      const quoted = arr[1].match(/'([a-z0-9_]+)'/gi) ?? [];
      for (const q of quoted) names.add(q.slice(1, -1).toLowerCase());
    }
  }
  return [...names].sort();
}

/**
 * Cross-file coverage: a table created in one migration may get its RLS in a
 * later one (e.g. 0070 creates, 0130 secures) — so gaps are computed over the
 * UNION of all files. `gaps` MUST be empty; each entry is a table any anon-key
 * holder could read and write directly.
 */
export function findRlsGaps(files: MigrationFile[]): RlsCoverageReport {
  const created = new Set<string>();
  const rlsEnabled = new Set<string>();
  const createdByFile: Record<string, string[]> = {};
  for (const f of files) {
    const c = extractCreatedTables(f.sql);
    if (c.length > 0) createdByFile[f.name] = c;
    for (const t of c) created.add(t);
    for (const t of extractRlsEnabledTables(f.sql)) rlsEnabled.add(t);
  }
  const gaps = [...created].filter((t) => !rlsEnabled.has(t)).sort();
  return {
    created: [...created].sort(),
    rlsEnabled: [...rlsEnabled].sort(),
    gaps,
    createdByFile,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runRlsCoverageTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  // --- comment stripping -----------------------------------------------------
  expect(
    "line comment removed",
    stripLineComments("select 1; -- a comment\nselect 2;") === "select 1; \nselect 2;",
  );
  expect(
    "double-dash inside a string literal survives",
    stripLineComments("select '--not a comment';").includes("--not a comment"),
  );
  expect(
    "escaped quote does not open a comment",
    stripLineComments("select 'it''s -- fine'; -- gone").includes("it''s -- fine") &&
      !stripLineComments("select 'it''s -- fine'; -- gone").includes("gone"),
  );

  // --- created tables ---------------------------------------------------------
  const createSql = `
    create table if not exists public.alpha (id uuid primary key);
    CREATE TABLE public.beta (id int);
    -- create table if not exists public.commented_out (id int);
    create table if not exists public.alpha (id uuid); -- duplicate ignored
  `;
  const created = extractCreatedTables(createSql);
  expect("finds both real tables", created.join(",") === "alpha,beta");
  expect("commented-out create is NOT counted", !created.includes("commented_out"));

  // --- static RLS --------------------------------------------------------------
  const staticSql = `
    alter table public.alpha enable row level security;
    ALTER TABLE ONLY public.beta ENABLE ROW LEVEL SECURITY;
    -- alter table public.gamma enable row level security;
  `;
  const staticRls = extractRlsEnabledTables(staticSql);
  expect("static RLS both found", staticRls.join(",") === "alpha,beta");
  expect("commented-out RLS is NOT counted", !staticRls.includes("gamma"));

  // --- dynamic RLS (the 0039/0040/0113 foreach pattern) -----------------------
  const dynamicSql = `
    do $$
    declare t text;
    begin
      foreach t in array array['delta','epsilon'] loop
        execute format('alter table public.%I enable row level security;', t);
        execute format('create policy %I_staff_read on public.%I for select using (public.is_staff());', t, t);
      end loop;
    end $$;
  `;
  const dynRls = extractRlsEnabledTables(dynamicSql);
  expect("dynamic foreach RLS found", dynRls.join(",") === "delta,epsilon");

  // A DO block WITHOUT the RLS text must not contribute names (e.g. a
  // trigger-only foreach loop, like 0039's updated_at block).
  const triggerOnly = `
    do $$
    declare t text;
    begin
      foreach t in array array['zeta'] loop
        execute format('drop trigger if exists %I_touch on public.%I;', t, t);
      end loop;
    end $$;
  `;
  expect("non-RLS DO block contributes nothing", extractRlsEnabledTables(triggerOnly).length === 0);

  // --- cross-file gap analysis --------------------------------------------------
  const report = findRlsGaps([
    { name: "0001_create.sql", sql: "create table if not exists public.aaa (id int); create table public.bbb (id int);" },
    { name: "0002_secure_aaa.sql", sql: "alter table public.aaa enable row level security;" },
  ]);
  expect("gap detected for the unsecured table", report.gaps.join(",") === "bbb");
  expect("created union is complete", report.created.join(",") === "aaa,bbb");
  expect("createdByFile pinpoints origin", (report.createdByFile["0001_create.sql"] ?? []).join(",") === "aaa,bbb");

  const closed = findRlsGaps([
    { name: "0001_create.sql", sql: "create table public.ccc (id int);" },
    { name: "0130_secure.sql", sql: "alter table public.ccc enable row level security;" },
  ]);
  expect("later migration closes the gap", closed.gaps.length === 0);

  // GW-019 shape: the four exact tables, created without RLS, then secured.
  const gw019Create = `
    create table if not exists public.kb_product_categories (id uuid);
    create table if not exists public.noncannabis_products (id uuid);
    create table if not exists public.noncannabis_sku_sequences (type text);
    create table if not exists public.noncannabis_adjustments (id uuid);
  `;
  const before = findRlsGaps([{ name: "0070.sql", sql: gw019Create }]);
  expect(
    "GW-019: all four tables reported as gaps before the fix",
    before.gaps.join(",") ===
      "kb_product_categories,noncannabis_adjustments,noncannabis_products,noncannabis_sku_sequences",
  );
  const after = findRlsGaps([
    { name: "0070.sql", sql: gw019Create },
    {
      name: "0130.sql",
      sql: `
        alter table public.kb_product_categories     enable row level security;
        alter table public.noncannabis_products      enable row level security;
        alter table public.noncannabis_sku_sequences enable row level security;
        alter table public.noncannabis_adjustments   enable row level security;
      `,
    },
  ]);
  expect("GW-019: zero gaps after the fix migration", after.gaps.length === 0);

  if (failures > 0) {
    throw new Error(`rls-coverage-core self-tests: ${failures} failure(s)`);
  }
  console.log("rls-coverage-core self-tests: ALL PASS");
}
