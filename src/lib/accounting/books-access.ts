/**
 * src/lib/accounting/books-access.ts   (slice F5-K)
 *
 * SERVER-ONLY. The single gate every books page goes through.
 *
 * WHY THIS IS ITS OWN FILE rather than a line in each page: there are several
 * books screens, and "gated on the wrong permission" is a mistake that has to
 * be made only once to matter. One function, used everywhere, with the
 * role rule proven in `books-view-core.ts` to match the database's own
 * `is_admin()` for every role in the system.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT GUARANTEE.
 * This produces a pleasant screen for someone who should not be here. It is
 * NOT the thing that protects the ledger — the RPCs in 0175-0177 are all
 * `security definer` and check `is_admin()` themselves, so the books stay shut
 * even if this file were deleted. Belt and braces, deliberately.
 */

import "server-only";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { canReadBooks } from "./books-view-core";

/**
 * Require the ability to read the general ledger. Redirects a signed-in user
 * who is not an owner/admin back to the dashboard, and a signed-out user to
 * the login page (via `requireStaff`).
 */
export async function requireBooksAccess() {
  const session = await requireStaff();
  if (!canReadBooks(session.profile.role)) {
    redirect("/admin?denied=books");
  }
  return session;
}
