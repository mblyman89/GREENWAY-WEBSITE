/**
 * tests/compliance/server-only-stub.ts
 *
 * No-op stand-in for the "server-only" marker package so the harness can unit
 * test PURE functions that live in server-marked modules (e.g. the tax math in
 * src/lib/reports/tax.ts — computeLineTax/normalizeTaxableBase never touch the
 * database; the module only carries the marker because its Supabase loader
 * sibling does). This mirrors how Next itself treats the marker outside the
 * React Server Components bundler: it is a build-time guard, not runtime code.
 *
 * Tests must still never CALL anything that opens a database connection —
 * createSupabaseAdminClient() throws when env is unset, which is exactly the
 * failure you would see if a test drifted out of pure territory.
 */
export {};
