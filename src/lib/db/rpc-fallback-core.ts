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
    `The system isn't allowed to use ${what} yet (a database permission is missing), so nothing was saved. ` +
    `This is a setup step, not something staff did wrong: since Supabase's October 30, 2026 change, new database parts need permission granted on purpose. ` +
    `The owner needs to run migration ${SERVICE_ROLE_GRANTS_MIGRATION} in the Supabase SQL editor, then try again.`
  );
}

/**
 * R-RET-2 (owner message 13: "please make the errors be more plain english").
 * Turn the database's technical wording into a sentence staff can act on.
 * Known Postgres / PostgREST codes get a plain explanation; a message our own
 * SQL functions raised ("record_customer_return: lot ... not found") keeps its
 * meaning but loses the internal function-name prefix. Null when there is no
 * better wording than the original.
 */
export function plainDbError(error: RpcErrorLike | null | undefined): string | null {
  if (!error) return null;
  const code = (error.code ?? "").trim();
  const message = (error.message ?? "").trim();
  const lower = message.toLowerCase();
  if (code === UNIQUE_VIOLATION_CODE || lower.includes("duplicate key value")) {
    return "This was already saved once (the system found a duplicate). Refresh the page to see it before trying again.";
  }
  if (code === "23503" || lower.includes("violates foreign key constraint")) {
    return "Something this depends on is missing or was just removed (for example the sale, product or lot). Refresh the page and try again.";
  }
  if (code === "23514" || lower.includes("violates check constraint")) {
    return "One of the values isn't allowed (for example a negative amount or a quantity of zero). Check the numbers and try again.";
  }
  if (code === "23502" || lower.includes("violates not-null constraint")) {
    return "A required piece of information was left blank. Fill in every field and try again.";
  }
  if (code === "22P02" || code === "22003" || lower.includes("invalid input syntax")) {
    return "One of the values is in the wrong format (for example letters where a number belongs). Check what you typed and try again.";
  }
  if (code === "40001" || code === "40P01" || lower.includes("deadlock detected") || lower.includes("could not serialize")) {
    return "Someone else was changing the same thing at the same moment. Wait a second and try again.";
  }
  if (code === "57014" || lower.includes("statement timeout") || lower.includes("canceling statement")) {
    return "The database took too long to answer. Wait a moment and try again.";
  }
  if (code === "PGRST116") {
    return "The record couldn't be found. It may have been changed or removed; refresh the page and try again.";
  }
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econnreset") || lower.includes("etimedout")) {
    return "The system couldn't reach the database (a network hiccup). Check the internet connection and try again.";
  }
  // A message raised by one of our SQL functions: "<function>: <reason>".
  const raised = /^([a-z][a-z0-9_]*):\s+(.+)$/.exec(message);
  if (raised && raised[1].includes("_")) {
    const reason = raised[2].trim();
    return reason.charAt(0).toUpperCase() + reason.slice(1) + (/[.!?]$/.test(reason) ? "" : ".");
  }
  return null;
}

/** The message staff should see for a failed database call. */
export function dbErrorForStaff(error: RpcErrorLike | null | undefined, fallback = "The database call failed."): string {
  return explainPermissionDenied(error) ?? plainDbError(error) ?? ((error?.message ?? "").trim() || fallback);
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

  // R-RET-2: plain-English translations.
  ok((plainDbError({ code: "23505", message: "duplicate key value violates unique constraint x" }) ?? "").includes("already saved"), "23505 plain");
  ok((plainDbError({ code: "23503", message: "" }) ?? "").includes("missing"), "23503 plain");
  ok((plainDbError({ code: "23514", message: "" }) ?? "").includes("isn't allowed"), "23514 plain");
  ok((plainDbError({ code: "23502", message: "" }) ?? "").includes("left blank"), "23502 plain");
  ok((plainDbError({ code: "22P02", message: "" }) ?? "").includes("wrong format"), "22P02 plain");
  ok((plainDbError({ code: "40P01", message: "" }) ?? "").includes("same moment"), "deadlock plain");
  ok((plainDbError({ code: "57014", message: "" }) ?? "").includes("too long"), "timeout plain");
  ok((plainDbError({ message: "TypeError: fetch failed" }) ?? "").includes("couldn't reach"), "network plain");
  ok(
    plainDbError({ code: "P0001", message: "record_customer_return: quantity must be greater than zero" }) ===
      "Quantity must be greater than zero.",
    "our SQL function prefix stripped",
  );
  ok(plainDbError({ message: "lot not found" }) === null, "no better wording -> null");
  ok(plainDbError(null) === null, "null -> null");
  ok(!dbErrorForStaff({ code: "23505", message: "duplicate key value violates unique constraint" }).includes("constraint"), "staff never see 'constraint'");
  ok(!(explainPermissionDenied(owner) ?? "").includes("refused the server"), "permission message is plain");

  console.log(`rpc-fallback-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`rpc-fallback-core self-tests: ${fail} failure(s)`);
}
