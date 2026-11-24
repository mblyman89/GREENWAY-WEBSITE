/**
 * src/lib/site/footer-glyph-core.ts — USAGE-9e (2026-11-26)
 *
 * WHY: the footer renders 7 glyph buttons (5 social + 2 app store) in BOTH its
 * mobile and desktop trees: 14 FooterLinkUnavailable client elements per page.
 * Each one carried a 236-byte className and the 115-byte default
 * "not available" message as props, about 4.9 KB of identical strings in
 * every page's RSC. Both now live here as the client component's defaults.
 * The footer passes neither the class nor the message, unless an editor has
 * changed the message (block "footer.link.unavailable.message").
 *
 * SAFE: the rendered class and message are byte-identical. A blank or
 * default-equal message was already shown as the default.
 */

/** Steel-blue circular glyph trigger (formerly Footer.tsx GLYPH_CLASS). */
export const FOOTER_GLYPH_CLASS =
  "inline-flex h-11 w-11 items-center justify-center rounded-full transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--greenway)]";

/** Shown when a footer link has no destination yet. */
export const FOOTER_UNAVAILABLE_DEFAULT =
  "This isn't available just yet — check back soon! In the meantime, give us a call or stop by the shop.";

/** The message prop to send: undefined when the client default would show anyway. */
export function unavailableMessageProp(message: string | null | undefined): string | undefined {
  const m = (message ?? "").trim();
  return m && m !== FOOTER_UNAVAILABLE_DEFAULT ? message ?? undefined : undefined;
}

/** What the client shows for a (possibly omitted) message prop. */
export function resolvedUnavailableMessage(message: string | null | undefined): string {
  return message && message.trim().length > 0 ? message : FOOTER_UNAVAILABLE_DEFAULT;
}

export function __runFooterGlyphTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`footer-glyph-core FAIL: ${name}`);
    }
  };
  ok(unavailableMessageProp(FOOTER_UNAVAILABLE_DEFAULT) === undefined, "default message is not sent");
  ok(unavailableMessageProp("") === undefined && unavailableMessageProp(null) === undefined, "blank is not sent");
  ok(unavailableMessageProp("Call us!") === "Call us!", "an edited message is sent");
  for (const m of [FOOTER_UNAVAILABLE_DEFAULT, "", "  ", null, "Call us!"]) {
    ok(resolvedUnavailableMessage(unavailableMessageProp(m)) === resolvedUnavailableMessage(m), `shown text unchanged for ${JSON.stringify(m)}`);
  }
  ok(FOOTER_GLYPH_CLASS.includes("h-11 w-11") && FOOTER_GLYPH_CLASS.includes("rounded-full"), "glyph class intact");
  if (failed > 0) throw new Error(`footer-glyph-core: ${failed} failed`);
  return { passed, failed };
}
