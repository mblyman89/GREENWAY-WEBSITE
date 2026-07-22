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

  console.log(`rpc-fallback-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`rpc-fallback-core self-tests: ${fail} failure(s)`);
}
