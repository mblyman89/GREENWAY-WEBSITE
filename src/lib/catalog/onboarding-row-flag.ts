/**
 * src/lib/catalog/onboarding-row-flag.ts  (S11)
 *
 * The ONE place the ONBOARDING_V2_ROW flag is read from the environment for
 * the onboarding server actions (row-level error anchoring in
 * drafts/actions.ts, the post-Save refresh in ai-lookup-actions.ts). Keeping
 * the read here means those action files never touch process.env directly
 * (the S30 ledger guard pins drafts/actions.ts as environment-free).
 *
 * The parsing idiom lives in the pure core (fact-chips-core.ts):
 * unset / anything else = on; off / 0 / false / no / disabled = off.
 */
import { ONBOARDING_V2_ROW_ENV, onboardingV2RowEnabled } from "@/lib/catalog/fact-chips-core";

/** True unless ONBOARDING_V2_ROW is set to an off-word (bible S11.7 rollback). */
export function onboardingV2RowOn(): boolean {
  return onboardingV2RowEnabled(process.env[ONBOARDING_V2_ROW_ENV]);
}
