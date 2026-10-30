/**
 * src/lib/compliance/ccrs-hub-flow-core.ts — W-1 (2026-10-30 owner request).
 *
 * PURE. How the CCRS hub keeps the owner where he was working.
 *
 * Owner, verbatim (2026-10-30): "it keeps jumping back to production mode when
 * I am trying to test. The resolve email buttons do not work."
 *
 * Verified causes (W-1 recon, Part 09 W-1):
 *   1. Every redirect after a week or email action dropped `env`, and the page
 *      treats a missing env as production (parseLedgerEnv). A PREprod tester
 *      pressed a button and landed on production, where his PREprod files and
 *      their new states are not shown.
 *   2. The email actions redirect to `#ccrs-mail`, but the result message was
 *      rendered only at the top of the page: the browser scrolled past it, so
 *      a refusal ("Nothing recorded: ...") looked like a dead button.
 *   3. An error email was matched against waiting files of BOTH envs even when
 *      its subject says PRE, so two look-alike files (one per env) made it
 *      "ambiguous" and nothing was recorded.
 *
 * Every URL the hub's server actions redirect to is built HERE, so the env
 * can never be dropped again (pinned by tests/compliance/w1-ccrs-hub-env.test.ts).
 */
import type { LedgerEnv } from "./ccrs-ledger-core";

export const CCRS_HUB_BASE = "/admin/compliance/ccrs";

/** The anchors the hub scrolls to after an action. */
export type HubAnchor = "ccrs-mail" | "ccrs-files" | "ccrs-week" | null;

const WEEK_KEY_RE = /^W-\d{4}-\d{2}-\d{2}$/;

/** Anything but exactly "preprod" is production (same rule as parseLedgerEnv). */
export function hubEnv(raw: unknown): LedgerEnv {
  return raw === "preprod" ? "preprod" : "prod";
}

/**
 * The hub URL. `week` is kept only when it looks like a week key (a crafted
 * value cannot inject parameters). PREprod is always written as env=preprod;
 * production is written as env=prod so the URL says which mode it is in.
 */
export function hubHref(o: {
  week?: string | null;
  env: LedgerEnv;
  params?: Record<string, string | null | undefined>;
  anchor?: HubAnchor;
}): string {
  const q = new URLSearchParams();
  const week = (o.week ?? "").trim();
  if (week && WEEK_KEY_RE.test(week)) q.set("week", week);
  q.set("env", o.env === "preprod" ? "preprod" : "prod");
  for (const [k, v] of Object.entries(o.params ?? {})) {
    if (k === "week" || k === "env") continue;
    if (v !== null && v !== undefined && v !== "") q.set(k, v);
  }
  return `${CCRS_HUB_BASE}?${q.toString()}${o.anchor ? `#${o.anchor}` : ""}`;
}

/** A page link that keeps the env (week switcher, ledger, urgent banner). */
export function hubWeekLink(week: string, env: LedgerEnv): string {
  return hubHref({ week, env });
}

/** The `?saved=1&note=...` / `?error=...` pair every action ends with. */
export function flashParams(ok: boolean, text: string): Record<string, string> {
  return ok ? { saved: "1", note: text } : { error: text };
}

export type HubFlash = { tone: "ok" | "error"; text: string } | null;

/** What the page shows next to the panel the action scrolled to. */
export function flashFrom(sp: { saved?: string; note?: string; error?: string }): HubFlash {
  if (sp.error && sp.error.trim()) return { tone: "error", text: sp.error.trim().slice(0, 4000) };
  if (sp.saved) return { tone: "ok", text: (sp.note ?? "").trim().slice(0, 4000) || "Saved." };
  return null;
}

/**
 * Which env an error email may be tied to.
 *
 * The email's own subject is the only evidence about its env (the hub page
 * the owner happens to be on is NOT: an Apply on the production page must
 * never tie a PREprod email to a production file). A PRE subject is still a
 * hint (U-66), so the scope is tried FIRST and the old both-env pool is used
 * only when the hinted env has no waiting file of that type at all. A narrower
 * pool can only turn "ambiguous" into "unique" inside the hinted env; it can
 * never tie rows the classifier did not prove.
 */
export function echoEnvScope(mailEnv: LedgerEnv | null): LedgerEnv | null {
  return mailEnv === "preprod" || mailEnv === "prod" ? mailEnv : null;
}

/**
 * The waiting files an error CSV of `fileType` is matched against. With a
 * scope, the files of that env when it has any of this type; otherwise every
 * env (the pre-W-1 pool, so nothing that matched before stops matching).
 */
export function scopeEchoPool<T extends { env: LedgerEnv; fileType: string }>(files: readonly T[], fileType: string, scope: LedgerEnv | null): T[] {
  const ofType = files.filter((f) => f.fileType === fileType);
  if (!scope) return ofType;
  const inScope = ofType.filter((f) => f.env === scope);
  return inScope.length > 0 ? inScope : ofType;
}

/** Bounded parallelism for per-file reads (each is a paged, complete-or-throw read). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in tests/compliance/pure-selftests.test.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsHubFlowTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-hub-flow-core: ${m}`);
    }
  };
  ok(hubEnv("preprod") === "preprod" && hubEnv("prod") === "prod" && hubEnv(undefined) === "prod" && hubEnv("PREPROD") === "prod", "env parse");
  const a = hubHref({ week: "W-2026-10-25", env: "preprod", params: flashParams(true, "Done & dusted"), anchor: "ccrs-mail" });
  ok(a.startsWith("/admin/compliance/ccrs?week=W-2026-10-25&env=preprod&saved=1&note=Done+%26+dusted"), `preprod kept: ${a}`);
  ok(a.endsWith("#ccrs-mail"), "anchor kept");
  ok(hubHref({ week: "W-2026-10-25", env: "prod" }) === "/admin/compliance/ccrs?week=W-2026-10-25&env=prod", "prod explicit");
  ok(hubHref({ week: "x&env=prod", env: "preprod" }) === "/admin/compliance/ccrs?env=preprod", "crafted week dropped, env still preprod");
  ok(hubHref({ week: "", env: "preprod", params: { env: "prod", week: "W-2026-01-04" } }) === "/admin/compliance/ccrs?env=preprod", "params cannot override env/week");
  ok(hubHref({ env: "preprod", params: flashParams(false, "bad") }) === "/admin/compliance/ccrs?env=preprod&error=bad", "error flash");
  ok(hubWeekLink("W-2026-10-25", "preprod") === "/admin/compliance/ccrs?week=W-2026-10-25&env=preprod", "week link keeps env");
  ok(!hubWeekLink("2026-10-25", "prod").includes("week="), "only a real week key is kept");
  ok(flashFrom({ error: " x " })?.tone === "error" && flashFrom({ saved: "1", note: "n" })?.text === "n", "flash");
  ok(flashFrom({ saved: "1" })?.text === "Saved." && flashFrom({}) === null, "flash default/none");
  ok(echoEnvScope("preprod") === "preprod" && echoEnvScope(null) === null, "scope from the email only");
  const files = [
    { id: "p1", env: "prod" as LedgerEnv, fileType: "Product" },
    { id: "q1", env: "preprod" as LedgerEnv, fileType: "Product" },
    { id: "q2", env: "preprod" as LedgerEnv, fileType: "Sale" },
    { id: "p2", env: "prod" as LedgerEnv, fileType: "Area" },
  ];
  ok(scopeEchoPool(files, "Product", "preprod").map((f) => f.id).join() === "q1", "a PRE email sees only PREprod Product files");
  ok(scopeEchoPool(files, "Product", null).map((f) => f.id).join() === "p1,q1", "no scope: both envs (pre-W-1 pool)");
  ok(scopeEchoPool(files, "Area", "preprod").map((f) => f.id).join() === "p2", "scope with nothing of that type falls back");
  ok(scopeEchoPool(files, "Sale", "prod").map((f) => f.id).join() === "q2", "fallback either way");
  ok(scopeEchoPool(files, "Strain", "prod").length === 0, "no file of the type");
  return { passed, failed };
}
