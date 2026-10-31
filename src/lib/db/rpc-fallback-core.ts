/**
 * src/lib/db/rpc-fallback-core.ts  (GW-012 fix)
 *
 * PURE classification of PostgREST/Supabase RPC errors so callers can decide
 * between "the migration adding this function hasn't been applied yet —
 * degrade gracefully to the legacy code path" and "a real failure — surface
 * it".
 *
 * Migrations are applied MANUALLY by the owner in the Supabase SQL editor,
 * so every new database function must tolerate a window where the code has
 * shipped but the function does not exist yet. PostgREST reports that as
 * code PGRST202 ("Could not find the function … in the schema cache"), and
 * Postgres itself as 42883 (undefined_function). The same policy already
 * exists ad hoc in merge-service / reset-service; this module makes it one
 * shared, self-tested vocabulary.
 */

export type RpcErrorLike = {
  code?: string | null;
  message?: string | null;
};

/** PostgREST "function not in schema cache" (migration not applied yet). */
export const RPC_MISSING_CODE_POSTGREST = "PGRST202";
/** Postgres undefined_function. */
export const RPC_MISSING_CODE_POSTGRES = "42883";

/**
 * True when the RPC error means the database function does not exist yet
 * (the owner has not run the migration that creates it) — the caller should
 * fall back to its legacy code path instead of failing.
 */
export function isMissingDbFunctionError(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").trim();
  if (code === RPC_MISSING_CODE_POSTGREST || code === RPC_MISSING_CODE_POSTGRES) return true;
  const message = (error.message ?? "").toLowerCase();
  if (!message) return false;
  // PostgREST phrases: "Could not find the function public.apply_lot_delta(…)
  // in the schema cache". Postgres: "function public.apply_lot_delta(…) does
  // not exist".
  return (
    (message.includes("function") && message.includes("does not exist")) ||
    (message.includes("could not find") && message.includes("function")) ||
    (message.includes("schema cache") && message.includes("function"))
  );
}

/** Postgres unique_violation — "the guard did its job, someone else won". */
export const UNIQUE_VIOLATION_CODE = "23505";

/** True when an insert failed because a unique constraint already holds. */
export function isUniqueViolation(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  if ((error.code ?? "").trim() === UNIQUE_VIOLATION_CODE) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("duplicate key value violates unique constraint");
}

/**
 * Postgres insufficient_privilege. Since Supabase's 2026-10-30 change (new
 * objects in `public` are no longer granted to anon / authenticated /
 * service_role automatically), a migration that revokes EXECUTE without
 * granting it back to service_role makes the server's own calls fail with
 * this code. It is NOT "the migration hasn't run" -- the object exists -- so
 * it must never trigger a legacy fallback. (R-RET, owner message 10.)
 */
export const PERMISSION_DENIED_CODE = "42501";

/** The migration that restores the server's (service_role) grants. */
export const SERVICE_ROLE_GRANTS_MIGRATION = "0330_service_role_grants.sql";

/** True when the database refused the server role access to an object. */
export function isPermissionDeniedError(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  if ((error.code ?? "").trim() === PERMISSION_DENIED_CODE) return true;
  return /permission denied for (function|procedure|table|relation|view|sequence|schema)\b/i.test(error.message ?? "");
}

/**
 * Plain-English explanation for a permission-denied error, naming the object
 * and the one thing the owner must do. Null when the error is something else.
 */
export function explainPermissionDenied(error: RpcErrorLike | null | undefined): string | null {
  if (!isPermissionDeniedError(error)) return null;
  const m = /permission denied for (function|procedure|table|relation|view|sequence|schema)\s+"?([\w.]+)"?/i.exec(
    error?.message ?? "",
  );
  const what = m ? `${m[1].toLowerCase() === "relation" ? "table" : m[1].toLowerCase()} ${m[2]}` : "a database object";
  return (
    `The database refused the server access to ${what} (permission denied). ` +
    `Since Supabase's October 30, 2026 change, new database objects need an explicit grant. ` +
    `Run migration ${SERVICE_ROLE_GRANTS_MIGRATION} in the Supabase SQL editor, then try again.`
  );
}

/** The message staff should see for a failed database call. */
export function dbErrorForStaff(error: RpcErrorLike | null | undefined, fallback = "The database call failed."): string {
  return explainPermissionDenied(error) ?? ((error?.message ?? "").trim() || fallback);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRpcFallbackCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // Missing-function detection — by code.
  ok(isMissingDbFunctionError({ code: "PGRST202", message: "" }), "PGRST202 → missing");
  ok(isMissingDbFunctionError({ code: "42883", message: "" }), "42883 → missing");

  // Missing-function detection — by message (code absent/odd).
  ok(
    isMissingDbFunctionError({
      code: null,
      message: "Could not find the function public.apply_lot_delta(p_lot_id, p_delta) in the schema cache",
    }),
    "PostgREST schema-cache phrase → missing",
  );
  ok(
    isMissingDbFunctionError({ message: "function public.apply_variant_delta(uuid, integer) does not exist" }),
    "Postgres does-not-exist phrase → missing",
  );

  // Real errors must NOT be classified as missing.
  ok(!isMissingDbFunctionError({ code: "23505", message: "duplicate key value violates unique constraint" }), "23505 is not missing-function");
  ok(!isMissingDbFunctionError({ code: "42501", message: "permission denied for function apply_lot_delta" }), "permission denied is not missing-function");
  ok(!isMissingDbFunctionError({ message: "column \"nope\" does not exist" }), "missing COLUMN is not missing FUNCTION");
  ok(!isMissingDbFunctionError(null), "null error → false");
  ok(!isMissingDbFunctionError({ message: "" }), "empty error → false");

  // Unique-violation detection.
  ok(isUniqueViolation({ code: "23505", message: "" }), "23505 → unique violation");
  ok(
    isUniqueViolation({ message: 'duplicate key value violates unique constraint "loyalty_ledger_earn_once_uniq"' }),
    "duplicate-key phrase → unique violation",
  );
  ok(!isUniqueViolation({ code: "PGRST202", message: "" }), "PGRST202 is not a unique violation");
  ok(!isUniqueViolation(null), "null → not a unique violation");

  // Permission denied (R-RET): the owner's exact register error.
  const owner = { code: "42501", message: "permission denied for function record_customer_return" };
  ok(isPermissionDeniedError(owner), "42501 -> permission denied");
  ok(!isMissingDbFunctionError(owner), "permission denied never triggers a legacy fallback");
  ok(isPermissionDeniedError({ message: "permission denied for table checklist_runs" }), "table phrase without code");
  ok(isPermissionDeniedError({ message: 'permission denied for sequence recall_events_event_number_seq' }), "sequence phrase");
  ok(!isPermissionDeniedError({ code: "23505", message: "duplicate key" }), "23505 is not permission denied");
  ok(!isPermissionDeniedError({ code: "PGRST202", message: "Could not find the function" }), "missing function is not permission denied");
  ok(!isPermissionDeniedError(null), "null -> not permission denied");
  const ex = explainPermissionDenied(owner) ?? "";
  ok(ex.includes("function record_customer_return"), "explanation names the function");
  ok(ex.includes(SERVICE_ROLE_GRANTS_MIGRATION), "explanation names migration 0330");
  ok(ex.includes("Supabase SQL editor"), "explanation says where to run it");
  ok((explainPermissionDenied({ message: 'permission denied for relation "supply_runs"' }) ?? "").includes("table supply_runs"), "relation -> table, quotes stripped");
  ok((explainPermissionDenied({ code: "42501", message: "" }) ?? "").includes("a database object"), "no object name -> generic");
  ok(explainPermissionDenied({ code: "23514", message: "check violated" }) === null, "other errors -> null");
  ok(dbErrorForStaff(owner).includes(SERVICE_ROLE_GRANTS_MIGRATION), "staff message for permission denied");
  ok(dbErrorForStaff({ message: "lot not found" }) === "lot not found", "other errors pass through");
  ok(dbErrorForStaff({ message: "  " }, "fallback") === "fallback", "blank -> fallback");
  ok(dbErrorForStaff(null, "fb") === "fb", "null -> fallback");

  console.log(`rpc-fallback-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`rpc-fallback-core self-tests: ${fail} failure(s)`);
}
