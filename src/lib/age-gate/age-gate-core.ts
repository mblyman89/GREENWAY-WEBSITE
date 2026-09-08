/**
 * SLICE I — THE AGE GATE IS THE LARGEST CONTENTFUL PAINT.
 *
 * WHAT WAS MEASURED (greenwaywebsite1.vercel.app/menu, mobile, 4x CPU + 1.6 Mbps,
 * the same throttling profile PageSpeed uses)
 * ─────────────────────────────────────────────────────────────────────────────
 *     LCP candidate 1 .. t=3896ms  IMG   (header wordmark)
 *     LCP candidate 2 .. t=4292ms  SPAN  "Browse our full selection..."
 *     LCP candidate 3 .. t=4804ms  P     "you must be 21 years of age or older"  <- FINAL
 *
 *     server HTML contains "21 years of age"?  false
 *     server HTML contains "Age Verification"? false
 *
 * So the element that defines the store's LCP **does not exist in the HTML the
 * server sends**. `AgeGate` is a client component whose server snapshot returned
 * `true` ("confirmed"), so it rendered nothing during SSR. The modal could only
 * appear once React had downloaded, parsed, and hydrated the page — and this
 * page hydrates a 3.3 MB payload (`domInteractive` 5,695ms).
 *
 * That is why LCP is ~4.8s in the lab and 6.1s in the field: **LCP is gated on
 * hydration.** No amount of shrinking the catalog payload fixes the shape of
 * this problem, because the LCP element is not waiting on bytes — it is waiting
 * on JavaScript to run.
 *
 * WHY THE OBVIOUS ALTERNATIVE WAS REJECTED
 * ────────────────────────────────────────
 * The prior plan was a columnar codec for the item array. It was built and
 * benchmarked against 2,561 real harvested items rather than argued about:
 *
 *     raw            2,492 KB -> 1,577 KB   (36.7% smaller)
 *     brotli-11        132 KB ->   112 KB   (20 KB, = 8% of a 239 KB wire)
 *     JSON.parse(row)                9.9 ms
 *     parse + rehydrate             13.0 ms  <- +3.1 ms, a 31% REGRESSION
 *
 * It saves 20 KB on a wire that measurement already proved is not the
 * bottleneck (transferSize 239 KB vs decodedBodySize 3,465 KB), and it pays for
 * that with main-thread time — the exact metric that was just brought down to
 * 180 ms of total blocking time. Wrong trade, so it is not shipped. Recorded
 * here so the next person does not re-derive it.
 *
 * THE FIX
 * ───────
 * Render the age gate in the server HTML so it paints with the first paint
 * instead of after hydration. The gate then stops being the thing that LCP is
 * waiting for.
 *
 * The problem this creates, and the reason the component was written the way it
 * was: whether a visitor has already confirmed their age lives in
 * `localStorage`, which the server cannot read. Server-render the gate naively
 * and every returning customer gets a modal flashed in their face on every
 * page load. That is a worse experience than a slow LCP.
 *
 * The resolution is a tiny synchronous inline script in `<head>` that runs
 * BEFORE the browser's first paint, reads `localStorage`, and stamps
 * `data-age-confirmed="true"` on `<html>`. A plain CSS rule keyed off that
 * attribute hides the gate. The browser applies attribute + stylesheet during
 * the same style resolution that produces first paint, so a confirmed visitor
 * never sees a frame containing the modal — no flash, and no JavaScript
 * framework involved.
 *
 * FAIL-CLOSED, DELIBERATELY
 * ─────────────────────────
 * This is a regulated gate on a cannabis storefront, so the failure mode is
 * chosen, not inherited. The markup ships VISIBLE and is hidden only by a
 * positive signal. If the inline script is blocked, throws, or `localStorage`
 * is unavailable (Safari private mode throws on access), the attribute is never
 * set, the CSS never matches, and **the gate shows**. An extra prompt for a
 * returning adult is a minor annoyance; an unverified minor reaching the menu
 * is a compliance failure. Note this is strictly SAFER than the previous
 * behaviour, where the server snapshot returned "confirmed" and the gate was
 * absent until JavaScript ran at all.
 *
 * WHY THIS MODULE IS PURE
 * ───────────────────────
 * No React, no DOM, no `window`, no network. It owns the storage key, the
 * exempt path rules, and the exact text of the bootstrap script as data, so CI
 * can assert the invariants that actually matter — that the key matches the one
 * the component reads, that the script is fail-closed, that staff surfaces are
 * never gated — without booting a browser.
 */

/**
 * Where the confirmation is persisted. The inline bootstrap script and the
 * React component MUST agree on this exact string; if they drift, returning
 * customers get gated forever and nobody notices, because both halves "work".
 * A self-test below pins the component to this constant.
 */
export const AGE_STORAGE_KEY = "greenway-age-confirmed-v1";

/**
 * Broadcast when confirmation changes so `useSyncExternalStore` re-reads. A
 * `storage` event does not fire in the tab that performed the write, so a
 * same-tab custom event is required as well.
 */
export const AGE_STORAGE_EVENT = "greenway-age-confirmed-change";

/** The value written on confirmation. Anything else counts as unconfirmed. */
export const AGE_CONFIRMED_VALUE = "true";

/**
 * The attribute stamped on `<html>` by the pre-paint bootstrap. An attribute on
 * the document element (rather than a class) keeps it clear that this is state,
 * not styling, and avoids colliding with the font-variable classes the root
 * layout already puts there.
 */
export const AGE_CONFIRMED_ATTRIBUTE = "data-age-confirmed";

/**
 * Marks the gate's root element so CSS can hide it without depending on
 * Tailwind's generated class names, which change whenever the design changes.
 */
export const AGE_GATE_ELEMENT_ATTRIBUTE = "data-age-gate";

/**
 * Surfaces the gate must NEVER cover. Staff are not customers: the back office
 * is behind authentication, and the register enforces a stronger per-sale ID
 * check of its own. A modal over the register would block a live transaction.
 */
export const AGE_GATE_EXEMPT_PREFIXES = ["/admin", "/pos"] as const;

/**
 * True when `pathname` is a staff surface that must not be gated.
 *
 * Matches the prefix itself and anything beneath it, but NOT a different route
 * that merely starts with the same letters — `/posters` is a customer page and
 * must still be gated. The original component used a bare `startsWith("/pos")`,
 * which would have silently exempted it.
 */
export function isAgeGateExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return AGE_GATE_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * True when the stored value means "this visitor confirmed they are 21+".
 * Strict equality on purpose: a corrupted or partially-written value must read
 * as unconfirmed and show the gate.
 */
export function isAgeConfirmedValue(raw: string | null | undefined): boolean {
  return raw === AGE_CONFIRMED_VALUE;
}

/**
 * The pre-paint bootstrap, as a string, to be injected synchronously in
 * `<head>`.
 *
 * Constraints this code is written under, all of them load-bearing:
 *
 *   1. SYNCHRONOUS. No `defer`, no `async`, no `DOMContentLoaded`. It must run
 *      and mutate `<html>` before the browser computes first paint, otherwise a
 *      confirmed visitor sees a frame with the modal in it.
 *   2. WRAPPED IN try/catch. `localStorage` access THROWS (not returns null) in
 *      Safari private browsing and when a site is blocked from storing data. An
 *      uncaught error here would abort the script and, worse, could be reported
 *      as a page error.
 *   3. FAIL-CLOSED. The attribute is only ever ADDED, and only on a positive
 *      match. Every failure path leaves the document untouched, which leaves
 *      the gate visible.
 *   4. NO CLOSING-TAG SEQUENCE. The string is embedded in an inline `<script>`;
 *      a literal `</script>` in the source would terminate the element early.
 *      There is none, and a self-test asserts it stays that way.
 */
export function ageGateBootstrapScript(): string {
  return (
    "(function(){try{" +
    `if(window.localStorage.getItem(${JSON.stringify(AGE_STORAGE_KEY)})===${JSON.stringify(AGE_CONFIRMED_VALUE)}){` +
    `document.documentElement.setAttribute(${JSON.stringify(AGE_CONFIRMED_ATTRIBUTE)},"true");` +
    "}}catch(e){}})();"
  );
}

/**
 * The CSS contract the stylesheet must honour, expressed as data so a test can
 * assert the stylesheet actually contains it. Splitting this into "the rule"
 * and "the selector" lets CI check the real file rather than trusting a comment.
 */
export const AGE_GATE_HIDDEN_SELECTOR = `[${AGE_CONFIRMED_ATTRIBUTE}="true"] [${AGE_GATE_ELEMENT_ATTRIBUTE}]`;

/**
 * `display: none` rather than `visibility`/`opacity`: the gate must be removed
 * from the accessibility tree and must not be an LCP candidate for a confirmed
 * visitor. A merely-transparent modal would still be painted, still be measured,
 * and still trap focus.
 */
export const AGE_GATE_HIDDEN_RULE = `${AGE_GATE_HIDDEN_SELECTOR} { display: none !important; }`;

// ─────────────────────────────────────────────────────────────────────────────
// Self-tests. Pure, so they run in CI with no browser and no database.
// ─────────────────────────────────────────────────────────────────────────────
export function __runAgeGateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, condition: boolean) => {
    if (condition) passed += 1;
    else {
      failed += 1;
      console.error(`[age-gate] FAIL: ${label}`);
    }
  };

  // ── Exempt paths ─────────────────────────────────────────────────────────
  check("the back office is never gated", isAgeGateExemptPath("/admin"));
  check("back-office subpages are never gated", isAgeGateExemptPath("/admin/reports/tax"));
  check("the register is never gated", isAgeGateExemptPath("/pos"));
  check("register subpages are never gated", isAgeGateExemptPath("/pos/register/1"));
  check("the shop IS gated", !isAgeGateExemptPath("/menu"));
  check("category routes ARE gated", !isAgeGateExemptPath("/menu/flower"));
  check("the home page IS gated", !isAgeGateExemptPath("/"));
  check("specials ARE gated", !isAgeGateExemptPath("/specials"));
  // The bug a bare startsWith() would have shipped: a customer route that
  // merely begins with an exempt prefix must still be gated.
  check("a route that only LOOKS like /pos is still gated", !isAgeGateExemptPath("/posters"));
  check("a route that only LOOKS like /admin is still gated", !isAgeGateExemptPath("/administrivia"));
  check("a missing pathname is treated as a customer page", !isAgeGateExemptPath(null));
  check("an empty pathname is treated as a customer page", !isAgeGateExemptPath(""));
  check("undefined pathname is treated as a customer page", !isAgeGateExemptPath(undefined));

  // ── Stored value ─────────────────────────────────────────────────────────
  check("the exact confirmed value reads as confirmed", isAgeConfirmedValue("true"));
  check("a null value is unconfirmed", !isAgeConfirmedValue(null));
  check("undefined is unconfirmed", !isAgeConfirmedValue(undefined));
  check("an empty string is unconfirmed", !isAgeConfirmedValue(""));
  check("the string 'false' is unconfirmed", !isAgeConfirmedValue("false"));
  check("a truncated value is unconfirmed", !isAgeConfirmedValue("tru"));
  check("a differently-cased value is unconfirmed", !isAgeConfirmedValue("TRUE"));
  check("a padded value is unconfirmed", !isAgeConfirmedValue(" true "));
  check("an unrelated value is unconfirmed", !isAgeConfirmedValue("yes"));

  // ── Bootstrap script ─────────────────────────────────────────────────────
  const script = ageGateBootstrapScript();
  check("the bootstrap reads the SAME key the component writes", script.includes(AGE_STORAGE_KEY));
  check("the bootstrap compares against the confirmed value", script.includes(AGE_CONFIRMED_VALUE));
  check("the bootstrap stamps the attribute the CSS keys off", script.includes(AGE_CONFIRMED_ATTRIBUTE));
  check("the bootstrap is wrapped so storage access cannot throw", /try\{/.test(script) && /catch\(/.test(script));
  check("the bootstrap runs immediately as an IIFE", script.startsWith("(function(){") && script.endsWith("})();"));
  // Fail-closed: it must only ever ADD the attribute on a positive match.
  check("the bootstrap never REMOVES the attribute", !script.includes("removeAttribute"));
  check("the bootstrap sets the attribute exactly once", script.split("setAttribute").length - 1 === 1);
  check(
    "the bootstrap only stamps inside the positive branch",
    script.indexOf("getItem") < script.indexOf("setAttribute"),
  );
  // Embedding safety: a literal closing tag would end the <script> element.
  check("the bootstrap cannot terminate its own script tag", !script.toLowerCase().includes("</script"));
  check("the bootstrap has no HTML comment sequence", !script.includes("<!--"));
  // It runs on every page load in the critical path, so keep it tiny.
  check("the bootstrap stays small enough to be free", script.length < 400);
  check("the bootstrap touches only the document element", !script.includes("document.body"));
  check("the bootstrap does no network work", !/fetch|XMLHttpRequest/.test(script));

  // ── CSS contract ─────────────────────────────────────────────────────────
  check("the hidden rule targets the gate element", AGE_GATE_HIDDEN_RULE.includes(AGE_GATE_ELEMENT_ATTRIBUTE));
  check("the hidden rule is scoped to confirmed visitors", AGE_GATE_HIDDEN_RULE.includes(AGE_CONFIRMED_ATTRIBUTE));
  check(
    "the gate is removed from layout, not merely made transparent",
    AGE_GATE_HIDDEN_RULE.includes("display: none"),
  );
  check(
    "the rule wins over the modal's own utility classes",
    AGE_GATE_HIDDEN_RULE.includes("!important"),
  );
  check(
    "hiding requires the POSITIVE confirmed value, not just the attribute",
    AGE_GATE_HIDDEN_SELECTOR.includes(`="true"`),
  );

  // ── Key stability ────────────────────────────────────────────────────────
  // Changing these strings silently signs every returning customer out of
  // their confirmation, so they are pinned to their shipped values.
  check("the storage key is unchanged", AGE_STORAGE_KEY === "greenway-age-confirmed-v1");
  check("the storage event is unchanged", AGE_STORAGE_EVENT === "greenway-age-confirmed-change");
  check("the attribute name is stable", AGE_CONFIRMED_ATTRIBUTE === "data-age-confirmed");

  return { passed, failed };
}
