/**
 * src/lib/ai/sprint-status.ts   (R74 S21)
 *
 * Server-only: hands the Vercel values the Gemini sprint panel needs to the
 * pure sprint-status-core. Reads ONLY the names in SPRINT_ENV_NAMES (the
 * same names provider.ts / router.ts / lookup-job-core read); no network, no
 * database. Secrets never leave this function: the core only ever says
 * "set" / "not set".
 */
import "server-only";
import { SPRINT_ENV_NAMES, sprintStatus, type SprintEnv, type SprintStatus } from "./sprint-status-core";

export function loadSprintStatus(env: Record<string, string | undefined> = process.env): SprintStatus {
  const picked: SprintEnv = {};
  for (const name of SPRINT_ENV_NAMES) picked[name] = env[name];
  return sprintStatus(picked);
}
