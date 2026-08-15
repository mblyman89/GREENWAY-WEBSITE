/**
 * src/lib/supabase/books-client.ts   (slice F5-M, bug fix)
 *
 * SERVER-ONLY. The database connection the BOOKS use, and the reason it is not
 * the one everything else uses.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS FILE EXISTS TO FIX
 * ---------------------------------------------------------------------------
 * Michael, signed in as the owner, could not open the books. Every books screen
 * showed `TB_FORBIDDEN` or `GL_FORBIDDEN` -- "the general ledger is admin-only".
 * His first guess was that the OWNER role had been left out of the permission
 * check. That guess was tested first and proved WRONG:
 *
 *     is_admin()  =>  role in ('owner','admin')     [0001, line 138-144]
 *
 * Owner is right there. The real cause is subtler and worse.
 *
 * `ledger-store.ts` reached the database with `createSupabaseAdminClient()` --
 * the SERVICE-ROLE key. That key is not a user. It is a master key for the
 * server itself, and the token it presents carries no `sub` claim, because no
 * human is attached to it. So inside the database:
 *
 *     auth.uid()   =>  NULL          (nobody is signed in)
 *     is_admin()   =>  FALSE         (no row in staff_profiles matches NULL)
 *
 * and every `security definer` books function did exactly what it was built to
 * do: it refused. The books were not refusing Michael. They were refusing a
 * caller who never said who he was. It would have refused ANY role identically
 * -- proven by running it as an admin, who was refused the same way -- which is
 * why "sign in as an admin instead" would not have helped.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIX IS NOT "LET THE SERVICE KEY THROUGH"
 * ---------------------------------------------------------------------------
 * There is an easy repair available here and it is the wrong one. Adding
 * something like `if current_user = 'service_role' then return true` to
 * `is_admin()` would light the books up immediately. It would also mean the
 * ledger no longer knows WHO is reading it, and the guard that stops a
 * budtender reading the general ledger becomes a guard that stops nobody --
 * because every request from the website arrives over that same key. One line,
 * and the entire books permission model quietly evaporates. Rule 14 says refuse
 * rather than be confidently wrong; the same instinct applies to repairs.
 *
 * So the fix runs the other way: the books stop using the master key and start
 * using MICHAEL'S OWN SESSION. Then `auth.uid()` is genuinely him, `is_admin()`
 * is genuinely true, the RPCs open, and -- this is the part that matters -- the
 * database is once again enforcing the rule instead of being talked past. Row
 * Level Security comes back into the path too, having been bypassed entirely by
 * the service key.
 *
 * Measured, not assumed (prove-books-lockout-part3.sh, executed output):
 *     owner: is_admin() = TRUE     rows visible in gl_accounts = 193
 *     staff: is_admin() = FALSE    rows visible in gl_accounts = 0
 *     staff calling the trial balance -> refused TB_FORBIDDEN
 *     all 8 books functions: authenticated CAN execute
 *
 * The last line matters because migration 0177 contains no GRANT statements at
 * all; `gl_override_report` and `gl_set_owner_override` were never granted to
 * anyone explicitly. They work because PostgreSQL grants EXECUTE to PUBLIC by
 * default. That is a real dependency on a default, so it is checked by a test
 * rather than left to be discovered during an audit.
 */

import "server-only";

import { createSupabaseServerClient } from "./server";

/**
 * The client every books read must go through.
 *
 * This is the request's own authenticated session -- the same cookies the
 * browser sent -- so the database sees the actual signed-in human and can
 * apply its own rules to them.
 *
 * DO NOT replace this with `createSupabaseAdminClient()`. That is precisely
 * the defect this file was created to fix, and doing so would silently
 * re-lock the books for every user including the owner.
 */
export async function createBooksClient() {
  return createSupabaseServerClient();
}
