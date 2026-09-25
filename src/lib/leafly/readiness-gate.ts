/**
 * READINESS GATE -- one place that decides whether Leafly can be called.
 *
 * ###########################################################################
 * # FINDING J-4, PART 2                                                     #
 * #                                                                        #
 * # Five server actions each opened with the same two lines:               #
 * #                                                                        #
 * #   if (!isLeaflyConfigured()) {                                         #
 * #     return { ok: false, error: "Leafly is not configured. ..." };      #
 * #   }                                                                    #
 * #                                                                        #
 * #   actions.ts:97   (old push; L-42 replaced it: replaceLeaflyMenuAction)#
 * #   actions.ts:492  fetchLeaflyStatusAction     <- the owner's button    #
 * #   actions.ts:553  fetchLeaflyMenuReadbackAction                        #
 * #   actions.ts:720  deleteLeaflyItemsAction                              #
 * #   selection-actions.ts:265  pushLeaflySelectionAction                  #
 * #                                                                        #
 * # `isLeaflyConfigured()` (push.ts:127) is SYNCHRONOUS. It reads the      #
 * # in-process override cache and, when that cache is empty, silently      #
 * # falls back to environment variables. None of these five awaited        #
 * # `refreshLeaflyConfig()` first, so on a cold or different Vercel        #
 * # lambda the cache was empty and the action reported "not configured"    #
 * # for credentials that were sitting in the database the whole time.      #
 * #                                                                        #
 * # That is exactly the owner's report: "two clicks of the same button,    #
 * # one worked, the second time failed" -- with                            #
 * # `fetchLeaflyStatusAction` (line 492) being the very button he named.   #
 * #                                                                        #
 * # Fixing five copies of a check invites a sixth copy that forgets. So    #
 * # there is now ONE gate, it always refreshes first, and it distinguishes #
 * # the three outcomes that the old boolean flattened into one.            #
 * ###########################################################################
 *
 * WHY "COULD NOT DETERMINE" IS A SEPARATE ANSWER
 *
 * The old code had one failure sentence: "Leafly is not configured. Set the
 * menu integration key and OAuth credentials first." When the real problem was
 * a database timeout, that sentence was FALSE and it asked the owner to
 * re-enter credentials that already worked. Telling somebody to fix something
 * that is not broken is how trust in a status indicator is lost.
 */
import "server-only";

import { describeLeaflyReadiness, type LeaflyReadiness } from "./push";
import { refreshLeaflyConfig, type LeaflyConfigRefresh } from "./runtime";

export type LeaflyGate =
  | { ok: true; readiness: LeaflyReadiness; refresh: LeaflyConfigRefresh }
  | { ok: false; error: string; readiness: LeaflyReadiness; refresh: LeaflyConfigRefresh };

/**
 * Refresh credentials from the database, then report whether Leafly is usable.
 *
 * ALWAYS refreshes. The cost is one cached database read; the alternative is
 * the intermittent false negative described above.
 */
export async function requireLeaflyReady(): Promise<LeaflyGate> {
  const refresh = await refreshLeaflyConfig();
  const readiness = describeLeaflyReadiness();

  if (readiness.configured) {
    return { ok: true, readiness, refresh };
  }

  // Not configured -- but WHY not? These are different situations and only
  // one of them is the owner's to fix.
  if (refresh.outcome === "unavailable") {
    return {
      ok: false,
      readiness,
      refresh,
      error:
        "Could not read your saved Leafly credentials just now — the credential store did not " +
        "respond. This is usually temporary and does NOT mean your credentials are missing. " +
        "Please try again in a moment. If it keeps happening, check the database connection " +
        "before re-entering anything.",
    };
  }

  const missing: string[] = [];
  if (!readiness.hasMenuIntegrationKey) missing.push("menu integration key");
  if (!readiness.hasOAuthCredentials) missing.push("OAuth client id and secret");

  return {
    ok: false,
    readiness,
    refresh,
    error:
      `Leafly is not configured: the ${missing.join(" and ")} ` +
      `${missing.length === 1 ? "is" : "are"} not set. Enter ${missing.length === 1 ? "it" : "them"} ` +
      `on this page under Leafly credentials, then try again.`,
  };
}
