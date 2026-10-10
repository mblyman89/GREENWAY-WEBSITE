/**
 * ACH MENTOR GATES (R39 S1). Server/test only - reads source from disk, so it
 * must never be imported by a client component (standing rule 65b).
 *
 * Both directions are checked: every exported core function is taught (or
 * explicitly exempt), and no lesson teaches a function that no longer exists.
 * An empty scrape throws (rule 39): a gate that inspects nothing approves all.
 */

import { join } from "node:path";

import { exportedFunctionNames } from "@/lib/payroll/mentor-quote-gate";
import { ALL_ACH_AUTHORITY_IDS } from "./ach-authorities";
import { ACH_FUNCTION_LESSONS, ACH_PLUMBING_FUNCTIONS, ACH_TOPIC_LESSONS, PRENOTE_VS_TEST_CREDIT } from "./ach-mentor";

const ALL_LESSONS = [PRENOTE_VS_TEST_CREDIT, ...ACH_FUNCTION_LESSONS, ...ACH_TOPIC_LESSONS];

export const ACH_CORE_PATH = join(process.cwd(), "src", "lib", "payments", "ach-authorization-core.ts");

export function achCoreExportedFunctions(path: string = ACH_CORE_PATH): readonly string[] {
  const names = exportedFunctionNames(path, "ACH AUTHORIZATION CORE");
  if (names.length === 0) throw new Error("ach-mentor-gates: scraped zero exported functions; the gate is broken, not passing.");
  return names;
}

export function achMentorCoverage(path: string = ACH_CORE_PATH): {
  untaught: readonly string[];
  deadLessons: readonly string[];
  deadExemptions: readonly string[];
  doublyListed: readonly string[];
} {
  const fns = new Set(achCoreExportedFunctions(path));
  const taught = new Set(ACH_FUNCTION_LESSONS.map((l) => l.key));
  const exempt = new Set(Object.keys(ACH_PLUMBING_FUNCTIONS));
  return {
    untaught: [...fns].filter((f) => !taught.has(f) && !exempt.has(f)),
    deadLessons: [...taught].filter((t) => !fns.has(t)),
    deadExemptions: [...exempt].filter((e) => !fns.has(e)),
    doublyListed: [...taught].filter((t) => exempt.has(t)),
  };
}

/** Every authority id cited by a lesson must exist (belt to the type's braces). */
export function danglingAchLessonAuthorities(): readonly string[] {
  const known = new Set<string>(ALL_ACH_AUTHORITY_IDS);
  return ALL_LESSONS.flatMap((l) => l.authorities.filter((a) => !known.has(a)));
}

/** Authorities no lesson cites. Must be empty: a quote nobody teaches is dead weight. */
export function uncitedAchAuthorities(): readonly string[] {
  const cited = new Set<string>(ALL_LESSONS.flatMap((l) => l.authorities));
  return ALL_ACH_AUTHORITY_IDS.filter((id) => !cited.has(id));
}
