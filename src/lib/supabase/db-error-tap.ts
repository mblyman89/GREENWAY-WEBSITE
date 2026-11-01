/**
 * src/lib/supabase/db-error-tap.ts  (slice G-71d, owner message 12)
 *
 * Why: in R-RET the database refused the server (42501) on every customer
 * return. The code HANDLED the error, showed a message, and nothing anywhere
 * said "the platform moved under us" until a cashier reported it. A crash
 * reporter cannot see a handled error; this can.
 *
 * What: wraps the service-role client's fetch (on top of the L-27 transport
 * floor, which is kept). When PostgREST answers with a status that can carry
 * a platform code (400/401/403/404), it reads a CLONE of the body after the
 * caller has its response, and if the code is 42501 / 42883 / PGRST202 /
 * 42P01 / PGRST205 it records a platform_error_events row (and the store
 * alerts on the first permission refusal).
 *
 * Deliberate (standing rule 15):
 *   - Only the service-role client is tapped. A signed-in user's client can be
 *     refused by row level security as designed; the server role never should.
 *   - The caller's response is returned untouched and never waits on this.
 *   - Only the object name is kept from the URL (query strings can carry
 *     customer values); the message is scrubbed in the pure core.
 *   - The error store writes through its own untapped client: no loops.
 */
import "server-only";
import { after } from "next/server";
import { SUPABASE_GLOBAL_OPTIONS } from "./fetch-floor";
import { dbObjectFromUrl, kindForDbCode } from "@/lib/platform/platform-errors-core";

const WATCHED_STATUS = new Set([400, 401, 403, 404]);

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? "";
}

function methodOf(input: Parameters<typeof fetch>[0], init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input === "object" && input !== null && "method" in input) return (input as Request).method;
  return "GET";
}

async function inspect(res: Response, url: string, method: string): Promise<void> {
  try {
    const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    const code = body && typeof body.code === "string" ? body.code : null;
    if (!kindForDbCode(code)) return;
    const object = dbObjectFromUrl(url);
    if (!object) return;
    const { recordDbRefusal } = await import("@/lib/platform/platform-error-store");
    await recordDbRefusal(code as string, object, method, typeof body?.message === "string" ? body.message : "");
  } catch (e) {
    console.error(`[db-error-tap] ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Run after the response when inside a request (Next `after`), else in the background. */
function schedule(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

export function tapDbErrors(base: typeof fetch): typeof fetch {
  return async function tappedFetch(input, init) {
    const res = await base(input, init);
    if (!res.ok && WATCHED_STATUS.has(res.status)) {
      const url = urlOf(input);
      if (url.includes("/rest/v1/")) {
        let copy: Response | null = null;
        try {
          copy = res.clone();
        } catch {
          copy = null;
        }
        if (copy) {
          const c = copy;
          schedule(() => inspect(c, url, methodOf(input, init)));
        }
      }
    }
    return res;
  };
}

/**
 * The `global` options for the service-role client: the L-27 bounded fetch,
 * tapped. Built FROM SUPABASE_GLOBAL_OPTIONS.fetch so the transport floor is
 * never lost (tests/compliance/leafly-l27-auth-fetch-floor.test.ts).
 */
export const ADMIN_GLOBAL_OPTIONS = {
  ...SUPABASE_GLOBAL_OPTIONS,
  fetch: tapDbErrors(SUPABASE_GLOBAL_OPTIONS.fetch),
} as const;
