/**
 * src/lib/accounting/books-access.ts   (slice F5-K)
 *
 * SERVER-ONLY. The single gate every books page goes through.
 *
 * WHY THIS IS ITS OWN FILE rather than a line in each page: there are several
 * books screens, and "gated on the wrong permission" is a mistake that has to
 * be made only once to matter. One function, used everywhere, with the
 * role rule proven in `books-view-core.ts` to match the database's own
 * `is_owner()` for every role in the system.
 *
 * OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
 *   "there is no reason anyone else needs to see my books or my financials
 *    ever, so I want strict controls over all of those things. The only thing
 *    an admin can do is pay vendors and pay employees."
 * So this gate is the OWNER ALONE. It was owner+admin until that decision.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT GUARANTEE.
 * This produces a pleasant screen for someone who should not be here. It is
 * NOT the thing that protects the ledger — the RPCs in 0175-0177 are all
 * `security definer` and check `is_owner()` themselves (migration 0179), so the
 * books stay shut even if this file were deleted. Belt and braces, deliberately.
 */

import "server-only";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { canReadBooks } from "./books-view-core";

/**
 * Require the ability to read the general ledger. Redirects a signed-in user
 * who is not the owner back to the dashboard, and a signed-out user to the
 * login page (via `requireStaff`).
 */
export async function requireBooksAccess() {
  const session = await requireStaff();
  if (!canReadBooks(session.profile.role)) {
    redirect("/admin?denied=books");
  }
  return session;
}
