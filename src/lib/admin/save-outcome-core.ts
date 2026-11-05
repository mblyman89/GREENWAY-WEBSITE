/**
 * src/lib/admin/save-outcome-core.ts — D179 (S2 "busy buttons"), PURE.
 *
 * Owner (2026-11-05 strategy, approved): every button "turns gray and shows a
 * spinner with 'Saving…' the moment it's tapped; can't be tapped again; ends
 * with a big green check: 'Saved. You're done.'"
 *
 * PendingKeeper (H12f / L-30) already does the first two for every admin
 * server-action form. This core decides the THIRD part: what the person sees
 * when the save lands. It only ever claims what the URL proves:
 *
 *   • the save redirected with an error key (?error=, ?blocked=, ?…Error=,
 *     ?…_error=) → a red "That did not save" card with the server's own words;
 *   • the save redirected with a success key (?saved=, ?ok=, ?done=, …) or to
 *     a different page with no error key → the green "Saved. You're done.";
 *   • anything else (URL unchanged, timeout, the button simply re-rendered) →
 *     NO card. Silence is honest; a green check on a save that threw would
 *     teach staff to trust a lie.
 *
 * The check runs only for kind "form" pending records, never link clicks.
 */

export type SaveOutcome =
  | { kind: "success"; title: string; detail: string | null }
  | { kind: "error"; title: string; detail: string }
  | { kind: "none" };

/** Query keys that mean "the save did not happen" (exact or by suffix). */
const ERROR_KEYS = new Set(["error", "blocked", "aierror", "conflict", "conflicts", "fail", "failed"]);
const ERROR_SUFFIX = /(Error|_error|_warn|Warn|_blocked)$/;

/** Query keys that mean "the save happened". */
const SUCCESS_KEYS = new Set([
  "saved", "ok", "done", "created", "added", "deleted", "removed", "published",
  "updated", "imported", "uploaded", "staged", "seeded", "moved", "resolved",
  "replayed", "rung", "clocked", "sent", "approved", "sealed", "dropped",
  "counted", "closed", "opened", "valuesSaved", "valuesPublished", "success",
]);
const SUCCESS_SUFFIX = /(Saved|_saved|Done|_done)$/;

/** Detail text is shown verbatim but capped so a giant message can't cover the screen. */
export const OUTCOME_DETAIL_MAX = 220;

export const OUTCOME_SUCCESS_TITLE = "Saved. You're done.";
export const OUTCOME_ERROR_TITLE = "That did not save.";
/** Success card stays this long; error card stays until dismissed or this long. */
export const OUTCOME_SUCCESS_MS = 3_500;
export const OUTCOME_ERROR_MS = 12_000;

function isErrorKey(k: string): boolean {
  return ERROR_KEYS.has(k) || ERROR_SUFFIX.test(k);
}
function isSuccessKey(k: string): boolean {
  return SUCCESS_KEYS.has(k) || SUCCESS_SUFFIX.test(k);
}

/** A value worth showing: a real sentence, not "1", "true" or an id. */
function humanText(v: string | null): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length < 4 || !/\s/.test(t) || !/[a-z]/i.test(t)) return null;
  return t.length > OUTCOME_DETAIL_MAX ? `${t.slice(0, OUTCOME_DETAIL_MAX - 1)}…` : t;
}

function parse(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/**
 * What did this form save do? `hrefAtStart` is the URL when the button was
 * pressed, `hrefNow` the URL after the pending cleared because it NAVIGATED.
 * Keys already present before the press (a stale ?error= from an earlier try)
 * count only if their value changed.
 */
export function saveOutcomeFromUrls(hrefAtStart: string, hrefNow: string): SaveOutcome {
  const a = parse(hrefAtStart);
  const b = parse(hrefNow);
  if (!a || !b) return { kind: "none" };
  if (a.origin !== b.origin) return { kind: "none" };
  if (a.href === b.href) return { kind: "none" };

  const fresh = (k: string) => b.searchParams.get(k) !== a.searchParams.get(k);

  for (const [k, v] of b.searchParams) {
    if (isErrorKey(k) && v !== "" && fresh(k)) {
      return {
        kind: "error",
        title: OUTCOME_ERROR_TITLE,
        detail: humanText(v) ?? "The page explains why below. Nothing was changed.",
      };
    }
  }
  for (const [k, v] of b.searchParams) {
    if (isSuccessKey(k) && fresh(k)) {
      return { kind: "success", title: OUTCOME_SUCCESS_TITLE, detail: humanText(v) };
    }
  }
  // Landed on a DIFFERENT page with no error key: a create-then-open save.
  if (a.pathname !== b.pathname) {
    return { kind: "success", title: OUTCOME_SUCCESS_TITLE, detail: null };
  }
  return { kind: "none" };
}

/** Self-test (registered in scripts/compliance/run-pure-selftests.ts). */
export function __runSaveOutcomeTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`save-outcome-core: ${m}`);
    passed += 1;
  };
  const U = "https://g.test/admin/registers";
  const s = (to: string, from = U) => saveOutcomeFromUrls(from, to);

  ok(s(`${U}?saved=1`).kind === "success", "saved=1 is success");
  ok(s(`${U}?saved=1`).kind === "success" && (s(`${U}?saved=1`) as { detail: string | null }).detail === null, "'1' is not shown as text");
  const msg = s(`${U}?ok=${encodeURIComponent("Float set to $167.50")}`);
  ok(msg.kind === "success" && msg.detail === "Float set to $167.50", "sentence shown verbatim");
  const e = s(`${U}?error=${encodeURIComponent("Count must be a whole number")}`);
  ok(e.kind === "error" && e.detail === "Count must be a whole number", "error shown verbatim");
  ok(s(`${U}?error=x`).kind === "error", "terse error still red");
  ok((s(`${U}?error=x`) as { detail: string }).detail.includes("Nothing was changed"), "terse error gets a plain fallback");
  ok(s(`${U}?blocked=week`).kind === "error", "blocked is an error");
  ok(s(`${U}?booksError=abc%20def`).kind === "error", "…Error suffix");
  ok(s(`${U}?reg_error=bad%20pin`).kind === "error", "…_error suffix");
  ok(s(`${U}?float_warn=over%20float`).kind === "error", "…_warn suffix shown loud");
  ok(s(`${U}?saved=1&error=nope%20nope`).kind === "error", "error wins over saved");
  ok(s(U).kind === "none", "same URL: silence");
  ok(s(`${U}#top`, U).kind === "none", "hash only: no key, same path → silence");
  ok(s(`${U}?tab=cash`).kind === "none", "tab switch is not a save");
  ok(s("https://g.test/admin/registers/abc").kind === "success", "new page, no error → success");
  ok(s("https://g.test/admin/registers/abc?error=no%20way").kind === "error", "new page with error → error");
  ok(s("https://evil.test/admin?saved=1").kind === "none", "other origin never claims");
  ok(s("not a url").kind === "none", "garbage never claims");
  // stale keys
  ok(s(`${U}?error=old%20one&saved=1`, `${U}?error=old%20one`).kind === "success", "stale error ignored, fresh saved wins");
  ok(s(`${U}?error=new%20one`, `${U}?error=old%20one`).kind === "error", "changed error is fresh");
  ok(s(`${U}?saved=1&x=2`, `${U}?saved=1`).kind === "none", "unchanged saved + noise: silence");
  ok(s(`${U}?error=`).kind === "none", "empty error key is not an error");
  const long = "word ".repeat(200);
  const L = s(`${U}?error=${encodeURIComponent(long)}`);
  ok(L.kind === "error" && L.detail.length <= OUTCOME_DETAIL_MAX, "detail capped");
  ok(s(`${U}?rung=as_rung`).kind === "success", "D178 rung key is success");
  ok(s(`${U}?sealed=1`).kind === "success", "deposit bag sealed key is success");
  ok(s(`${U}?valuesSaved=1`).kind === "success", "…Saved suffix");
  ok(OUTCOME_SUCCESS_TITLE === "Saved. You're done.", "owner's exact words");
  ok(OUTCOME_ERROR_MS > OUTCOME_SUCCESS_MS, "errors stay longer than successes");
  return { passed, failed: 0 };
}
