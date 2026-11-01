/**
 * src/lib/platform/db-contract.ts  (G-71a, owner message 12)
 *
 * The database contract: every public table/view and function the server code
 * talks to, read from db-contract.generated.json (built by
 * scripts/platform/build-db-contract.ts, CI-checked for staleness). The daily
 * platform-health check asks production whether the server can reach each one.
 */
import contract from "./db-contract.generated.json";

export const DB_CONTRACT_TABLES: readonly string[] = contract.tables;
export const DB_CONTRACT_FUNCTIONS: readonly string[] = contract.functions;
