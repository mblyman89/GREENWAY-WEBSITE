/**
 * src/instrumentation.ts  (slice G-71d, owner message 12)
 *
 * Next.js 16 calls `onRequestError` when the server captures an error in a
 * page, route handler, server action or proxy
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * Each one becomes a row in platform_error_events (migration 0333) and a burst
 * of them emails staff (platform-error-store.ts): the "error alerting" item
 * the owner approved: "Let's build 1-4 first. I see real value in all of them."
 *
 * The docs say async work here must be awaited. The store never throws and is
 * throttled, so a crash storm cannot become a database storm. Node.js runtime
 * only: the store uses the service-role client (proxy runs on Node in Next 16).
 */
import type { Instrumentation } from "next";

export function register(): void {
  // Nothing to set up; onRequestError imports the store on first use.
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordRequestError } = await import("@/lib/platform/platform-error-store");
    await recordRequestError(err, { path: request.path, method: request.method }, { routeType: context.routeType, routePath: context.routePath });
  } catch (e) {
    console.error(`[instrumentation] could not record the error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
