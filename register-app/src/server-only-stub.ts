/**
 * Stub for the "server-only" package.
 *
 * The real package throws at build time if a module marked server-only is
 * pulled into a client bundle. Nothing in the register's verified import graph
 * imports it, and tests/compliance/pos-register-app-guard.test.ts fails loudly
 * if that ever changes.
 *
 * This file exists so that IF someone adds such an import, Vite resolves it to
 * this harmless stub and the guard test reports the real problem in plain
 * English, instead of the build dying with an unresolved-module error that
 * says nothing about why.
 *
 * Mirrors tests/compliance/server-only-stub.ts, which does the same job for
 * vitest.
 */
export {};
