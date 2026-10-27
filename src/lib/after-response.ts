import "server-only";
import { after } from "next/server";

/**
 * PERF2-P6: run best-effort housekeeping AFTER the response is sent, so a
 * button click returns as soon as the work the person is waiting on is done.
 * Next `after()` works in Server Functions and Route Handlers (and still runs
 * when the action ends in `redirect()`); on Vercel it extends the function
 * via waitUntil. Outside a request scope (scripts, tests, crons calling the
 * helper directly) `after` throws, so the task runs immediately instead -
 * same work, same order, never lost. The task never throws to the caller.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const run = () =>
    task().catch((err) => {
      console.error(`[after-response] ${label} failed:`, err);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
