/**
 * Compile-time constants injected by register-app/vite.config.ts.
 *
 * These are NOT environment variables read at runtime — Vite textually
 * replaces them during the build, so the shipped app contains the literal
 * values and there is no `process` or `import.meta.env` in the bundle.
 *
 * Declared as `string` (never optional) because the Vite config always
 * defines both, defaulting to "" and "dev". The empty-string case is the one
 * register-host-core treats as a fatal misconfiguration for a packaged build.
 */
declare const __REGISTER_API_BASE__: string;
declare const __REGISTER_BUILD_VERSION__: string;
