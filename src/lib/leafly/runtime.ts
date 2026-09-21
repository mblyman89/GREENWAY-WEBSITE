/**
 * src/lib/leafly/runtime.ts
 *
 * Server-only glue that loads the back-office-entered Leafly credentials
 * (integration_credentials) and installs them into the config cache so the
 * synchronous config getters used across the Leafly client/push code see them.
 *
 * ###########################################################################
 * # FINDING J-4 -- "THE BACK OFFICE KEEPS FORGETTING THE CREDENTIALS"       #
 * #                                                                        #
 * # The owner, verbatim:                                                   #
 * #                                                                        #
 * #   "i click a button and it says i need to set the credentials. even    #
 * #    after getting the button to respond properly, a few minutes later,  #
 * #    ill click the button again, in this case the check integration      #
 * #    status, and it will say i need to enter the credentials. i hadn't   #
 * #    left the page, two clicks of the same button, one worked, the       #
 * #    second time failed."                                                #
 * #                                                                        #
 * # There were TWO independent causes, and both are addressed here.        #
 * #                                                                        #
 * # CAUSE 1 -- the cache is per-process, and the process is not stable.    #
 * #   `overrideCache` in config.ts is a module-level `let`. On Vercel each #
 * #   serverless instance has its own module scope. Two clicks can land on #
 * #   two different instances; the second sees an empty cache and silently #
 * #   falls back to environment variables. Nothing is wrong with the       #
 * #   credentials -- they were simply never loaded into THAT instance.     #
 * #   Fix: every readiness check must refresh first (see the async         #
 * #   variants in push.ts and the audited call sites).                     #
 * #                                                                        #
 * # CAUSE 2 -- a failure was indistinguishable from an absence.            #
 * #   This function used to be:                                            #
 * #                                                                        #
 * #     try { setLeaflyOverrideCache(await getLeaflyOverrides()); }        #
 * #     catch { setLeaflyOverrideCache(null); }                            #
 * #                                                                        #
 * #   A transient database blip therefore WIPED good credentials and       #
 * #   downgraded to env, and the UI then reported "you need to enter your  #
 * #   credentials" -- which is not merely unhelpful, it is false. The      #
 * #   owner's credentials were fine. Worse, it invites him to re-enter     #
 * #   working credentials to fix a database hiccup.                        #
 * #                                                                        #
 * #   Two changes:                                                         #
 * #     (a) On failure we KEEP whatever is already cached instead of       #
 * #         destroying it. A stale-but-working credential beats no         #
 * #         credential every time, and nothing here is security-sensitive: #
 * #         the value came from our own database moments earlier.          #
 * #     (b) The outcome is RETURNED, so callers can tell "no credentials   #
 * #         are configured" apart from "we could not find out". Those are  #
 * #         different sentences and only one of them asks the owner to do  #
 * #         something.                                                     #
 * ###########################################################################
 *
 * Call refreshLeaflyConfig() at the start of any public Leafly operation.
 */
import "server-only";

import { getLeaflyOverrides } from "@/lib/integrations/integration-credentials-store";
import { setLeaflyOverrideCache, hasLeaflyOverrideCache } from "./config";

/**
 * What happened when we tried to load credentials.
 *
 * - `loaded`    -- the database answered and we installed what it returned.
 * - `unchanged` -- the lookup failed, but a previously-loaded value is still
 *                  cached and remains in force.
 * - `unavailable` -- the lookup failed and we have nothing cached, so the
 *                  environment variables (if any) are what will be used.
 *                  This is the ONLY failure case where the owner might
 *                  genuinely need to act, and even then the cause may be the
 *                  database rather than his credentials.
 */
export type LeaflyConfigRefresh = {
  outcome: "loaded" | "unchanged" | "unavailable";
  /** True when the credential source was reachable. */
  sourceReachable: boolean;
};

/**
 * Fetch DB-merged Leafly credentials and install them for this process.
 *
 * Never throws: a credential lookup failing must not take down a push, a
 * status check or a page render. The outcome is reported in the return value
 * instead, which is what lets the UI say something true.
 */
export async function refreshLeaflyConfig(): Promise<LeaflyConfigRefresh> {
  try {
    const overrides = await getLeaflyOverrides();
    setLeaflyOverrideCache(overrides);
    return { outcome: "loaded", sourceReachable: true };
  } catch {
    // DO NOT wipe the cache here. See CAUSE 2 above -- destroying a good
    // credential because a query timed out is what produced the owner's
    // "two clicks, one worked" report.
    if (hasLeaflyOverrideCache()) {
      return { outcome: "unchanged", sourceReachable: false };
    }
    return { outcome: "unavailable", sourceReachable: false };
  }
}
