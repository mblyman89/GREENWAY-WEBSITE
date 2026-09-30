/**
 * src/lib/admin/reset-errors.ts
 *
 * The factory reset's error messages, in words the owner can act on (D-82).
 * Split out of reset-service.ts so it can be tested without a database.
 */
import { RESET_CONFIRM_PHRASE } from "@/lib/accounting/factory-reset-core";

/**
 * Turn a raw Postgres error into something the owner can act on. The DB raises
 * machine-readable prefixes; left alone they surface as wall-of-text alerts.
 *
 * Pure (no database, no session) so tests/compliance/d82-factory-reset-scales.test.ts
 * can run it on the exact error the owner saw. Used by reset-service.ts.
 */
export function describeRpcError(error: { message: string; code?: string | null }): string {
  const message = error.message ?? "";
  const code = error.code ?? "";
  if (/RESET_NOT_OWNER/.test(message)) {
    return "Only the owner can run the factory reset. You are signed in, but not as the owner account.";
  }
  if (/RESET_BAD_CONFIRMATION/.test(message)) {
    return `Nothing was deleted. To confirm, type exactly: ${RESET_CONFIRM_PHRASE}`;
  }
  if (/RETENTION GUARD/.test(message)) {
    // The DB message already names the counts and the citation; it is the most
    // useful text available and is passed through intact.
    return message;
  }
  // D-82. Postgres 57014 is "canceling statement due to statement timeout".
  // Supabase stops any API call as the signed-in user after 8 seconds, and the
  // 0209 reset deleted row by row, so it ran out of time once there was a
  // realistic amount of test data. The whole reset is one transaction, so a
  // timeout rolls everything back: nothing was deleted.
  if (code === "57014" || /statement timeout/i.test(message)) {
    return (
      "Nothing was deleted - the reset ran out of time and the database undid it. " +
      "This happens when the database still has the old, slow version of the reset. " +
      "Use the one-time upgrade box on this page (Copy, paste into Supabase, Run), then press the button again."
    );
  }
  // 55P03 is lock_not_available: 0240 waits at most 20 seconds for a table
  // something else is using, then gives up cleanly instead of hanging.
  if (code === "55P03" || /lock timeout/i.test(message)) {
    return (
      "Nothing was deleted - another part of the system was busy with the same data for more than 20 seconds. " +
      "Close any other Greenway tabs that are importing or syncing (Cultivera, CCRS, Plaid), wait a minute, and press the button again."
    );
  }
  if (/RESET_(SCHEMA_DRIFT|NO_PRIVILEGE|KEPT_TABLE_POINTS_AT_WIPE)/.test(message)) {
    return `Nothing was deleted. The reset stopped itself before touching anything because the database does not look the way it expects: ${message}`;
  }
  if (/(function|schema cache).*(does not exist|not found)/i.test(message)) {
    return (
      `The factory reset function is not installed in this database yet. Apply ` +
      `supabase/migrations/0209_factory_reset.sql in the Supabase SQL editor, then try again.`
    );
  }
  return `Reset failed: ${message}`;
}
