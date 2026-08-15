/**
 * scripts/compliance/check-books-identity.ts   (slice F5-M, bug fix)
 *
 * A STANDING GUARD AGAINST THE BUG THAT LOCKED MICHAEL OUT OF HIS OWN BOOKS.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, AND WHY A TEST COULD NOT SEE IT
 * ---------------------------------------------------------------------------
 * `ledger-store.ts` reached the database using the SERVICE-ROLE key. That key
 * belongs to the server, not to a person, so the token it presents has no
 * subject claim. Inside PostgreSQL:
 *
 *     auth.uid()  =>  NULL          is_admin()  =>  FALSE
 *
 * and every books function refused with TB_FORBIDDEN / GL_FORBIDDEN. The owner
 * was not being rejected for being an owner -- an ADMIN was rejected the same
 * way. Nobody was being rejected, because nobody was being identified.
 *
 * The SQL suites could not catch this. `gl-schema-harness.sql` models identity
 * as a session flag (`harness.is_admin`), which expresses "which user am I"
 * beautifully and cannot express "there is no user at all" -- the exact
 * condition that was broken. So the gap is closed here instead, at the only
 * place it is visible: which CLIENT the books code chooses.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A LINT-STYLE CHECK AND NOT A UNIT TEST
 * ---------------------------------------------------------------------------
 * The failure mode is a future edit -- someone hits a permissions error, sees
 * `createSupabaseAdminClient` used successfully elsewhere in the codebase, and
 * "fixes" it by switching the books over. Everything would appear to work for
 * them, because the service key can read anything. What would actually happen
 * is that the ledger stops checking who is reading it, and then locks the owner
 * out the moment a `security definer` function is involved. That edit must fail
 * loudly and immediately, with an explanation, which is what this does.
 *
 * Exit code 0 = the books still travel on the signed-in user's session.
 * Exit code 1 = someone re-introduced the outage.
 *
 * Usage: npx tsx scripts/compliance/check-books-identity.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

let failures = 0;
let checks = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function pass(message: string): void {
  checks += 1;
  console.log(`  ok: ${message}`);
}

function read(rel: string): string {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8");
  } catch {
    fail(`${rel} could not be read. This check cannot pass without it.`);
    return "";
  }
}

/**
 * Strip comments so this check reads CODE, not prose.
 *
 * THIS FUNCTION EXISTS BECAUSE THIS CHECK GOT IT WRONG ON ITS FIRST RUN.
 * `books-client.ts` explains the outage at length, and that explanation
 * necessarily contains the words `createSupabaseAdminClient`. The first
 * version of this file searched the raw text and duly failed the very file
 * that implements the fix -- a false positive of exactly the kind that teaches
 * people to ignore a failing check, which is far more dangerous than no check
 * at all. A guard that fires on a correct file is a broken guard, so it reads
 * only executable code now, and the documentation is free to name the mistake
 * it is warning about.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments, including JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, leaving URLs alone
}

console.log("=== books identity check ===");

// ---------------------------------------------------------------------------
// 1. The books must NOT use the service-role client.
// ---------------------------------------------------------------------------
const LEDGER_STORE = "src/lib/accounting/ledger-store.ts";
const ledger = codeOnly(read(LEDGER_STORE));

if (ledger.includes("createSupabaseAdminClient")) {
  fail(
    `${LEDGER_STORE} uses createSupabaseAdminClient (the service-role key).\n` +
      "      That key carries no user, so auth.uid() is NULL and is_admin() is\n" +
      "      FALSE inside the database -- which is exactly what locked the owner\n" +
      "      out of his own books. The books must travel on the signed-in user's\n" +
      "      session via createBooksClient() so the database can see who is\n" +
      "      asking and apply its own rules.",
  );
} else {
  pass(`${LEDGER_STORE} does not use the service-role key`);
}

if (ledger.includes("createBooksClient")) {
  pass(`${LEDGER_STORE} uses createBooksClient (the user's own session)`);
} else {
  fail(
    `${LEDGER_STORE} does not use createBooksClient. Every books read must go\n` +
      "      through it, or the database cannot tell who is reading the ledger.",
  );
}

// Every database call in the books store must be on a client obtained the right
// way. Counting them stops a single stray call from slipping in beside the
// correct ones -- the file had FIVE, and one missed call is one dead page.
const callSites = (ledger.match(/await createBooksClient\(\)/g) ?? []).length;
const rpcCalls = (ledger.match(/\.rpc\(/g) ?? []).length;
const fromCalls = (ledger.match(/\.from\(/g) ?? []).length;

if (callSites >= 1) {
  pass(`${callSites} books call sites obtain the session client`);
} else {
  fail("no createBooksClient() call sites found -- the books reach nothing");
}

if (rpcCalls + fromCalls > 0) {
  pass(`${rpcCalls} RPC calls and ${fromCalls} table reads are covered`);
}

// ---------------------------------------------------------------------------
// 2. The books client itself must be built from the request session.
// ---------------------------------------------------------------------------
const BOOKS_CLIENT = "src/lib/supabase/books-client.ts";
const booksClient = codeOnly(read(BOOKS_CLIENT));

if (booksClient.includes("createSupabaseServerClient")) {
  pass(`${BOOKS_CLIENT} is built from the request's own session`);
} else {
  fail(
    `${BOOKS_CLIENT} does not build on createSupabaseServerClient. If it ever\n` +
      "      returns a service-role client, every guarantee above is void.",
  );
}

if (booksClient.includes("createSupabaseAdminClient")) {
  fail(
    `${BOOKS_CLIENT} references the service-role client. That is the defect\n` +
      "      this file was created to prevent.",
  );
} else {
  pass(`${BOOKS_CLIENT} does not reference the service-role client`);
}

// ---------------------------------------------------------------------------
// 3. The chart of accounts must ask for columns that actually exist.
//
// Verified against the live schema by prove-books-lockout-part2.sh. Three of
// the seven names were wrong, and PostgREST only ever reported the first, so
// each is pinned here by name rather than trusting one error message.
// ---------------------------------------------------------------------------
const DEAD_COLUMNS: { wrong: string; right: string }[] = [
  { wrong: "account_type", right: "type" },
  { wrong: "cost_class", right: "default_cost_class" },
  { wrong: "entity_id", right: "allowed_entity_codes" },
];

const selectMatch = ledger.match(/\.from\("gl_accounts"\)\s*\.select\("([^"]+)"\)/);
if (!selectMatch) {
  fail(
    "could not find the gl_accounts select in ledger-store.ts. If the query was\n" +
      "      restructured, this check must be updated to keep watching it.",
  );
} else {
  const selected = selectMatch[1].split(",").map((c) => c.trim());
  pass(`gl_accounts select found: ${selected.join(", ")}`);

  for (const { wrong, right } of DEAD_COLUMNS) {
    if (selected.includes(wrong)) {
      fail(
        `the gl_accounts query asks for "${wrong}", which does not exist on that\n` +
          `      table. The real column is "${right}". This is what broke the chart\n` +
          "      of accounts page in production.",
      );
    } else {
      pass(`does not ask for the non-existent column "${wrong}"`);
    }
  }

  // The real column list, confirmed against a live database.
  const REAL_COLUMNS = new Set([
    "id", "code", "name", "type", "normal_balance", "is_contra", "is_control",
    "control_subledger", "requires_cost_class", "allowed_entity_codes",
    "is_system", "parent_code", "description", "active", "created_at",
    "updated_at", "default_cost_class", "category_slug",
  ]);

  for (const col of selected) {
    if (!REAL_COLUMNS.has(col)) {
      fail(
        `the gl_accounts query asks for "${col}", which is not a column on\n` +
          "      gl_accounts. Confirmed against the real schema built from\n" +
          "      migrations 0172-0178.",
      );
    }
  }
  pass("every selected column exists on gl_accounts");
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
console.log("");
if (failures > 0) {
  console.error(`BOOKS IDENTITY CHECK FAILED: ${failures} problem(s).`);
  process.exit(1);
}
console.log(`BOOKS IDENTITY CHECK PASSED: ${checks} checks.`);
