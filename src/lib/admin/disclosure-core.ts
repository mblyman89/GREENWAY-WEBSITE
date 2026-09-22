/**
 * src/lib/admin/disclosure-core.ts
 *
 * SLICE L-20 — ONE GREEN BAR, DEFINED ONCE.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION
 * ===========================================================================
 *   "Make the Leafly orders setup panel collapsible, with a green bar
 *    IDENTICAL to 'Set up a speaker — full step-by-step guide'."
 *
 * The word that decides the design is "identical". There are two ways to
 * satisfy it:
 *
 *   1. Copy the class string from `AnnouncerSetupGuide` into the Leafly
 *      panel. Identical today, and identical only until somebody adjusts one
 *      of them — at which point the shop has two green bars that are almost
 *      the same, which looks like a rendering bug rather than a design.
 *
 *   2. Define the bar ONCE and have both screens read it. Then "identical"
 *      is not a thing somebody has to remember; it is a thing the code
 *      cannot get wrong.
 *
 * This file is option 2. It holds the class strings and nothing else, so the
 * rule "the disclosure bar looks like THIS" has exactly one home — house rule
 * 11, applied to styling.
 *
 * ===========================================================================
 * WHY A PURE CORE AND NOT A COMPONENT FILE
 * ===========================================================================
 * The component (`DisclosurePanel`) is a thin wrapper around `<details>`. The
 * part worth testing is not the JSX, it is the CLASS CONTRACT: that the bar
 * is the accent colour, that it is a real border and not a background-only
 * tint, that the summary is a pointer, and — the one that actually bites —
 * that every token it names exists in `globals.css`.
 *
 * A pure core can assert all of that with no DOM, no render, and no React,
 * and it runs in the same self-test harness as the rest of the shop's
 * judgement code. The component then has nothing left to get wrong except
 * spelling, which the type system handles.
 *
 * ===========================================================================
 * WHY NATIVE <details> AND NOT A CLIENT COMPONENT
 * ===========================================================================
 * `<details>` collapses with zero JavaScript. That matters on this page
 * specifically: the orders board is the screen the shop leaves open all day
 * on a tablet, and a panel that needs hydration before it can be opened is a
 * panel that is stuck open — or stuck shut — during exactly the slow first
 * paint when somebody is in a hurry. It is also keyboard- and
 * screen-reader-accessible for free, and it prints correctly.
 *
 * Collapsed-by-default is the native behaviour, which is what the owner asked
 * for. `defaultOpen` exists for the one case where hiding the content would
 * hide a problem — see `shouldStartOpen`.
 */

/** The container: rounded, accent-bordered, faintly accent-tinted. */
export const DISCLOSURE_SHELL_CLASS =
  "mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.06] px-3.5 py-3";

/** The bar itself: the clickable summary line. */
export const DISCLOSURE_SUMMARY_CLASS =
  "cursor-pointer text-sm font-bold text-[var(--admin-text)]";

/**
 * Every `--admin-*` token the two class strings above depend on.
 *
 * Kept as data rather than re-parsed at each call site so the compliance test
 * can assert each one actually resolves in `globals.css`. A misspelled token
 * does not throw; CSS simply drops the declaration, and the result is an
 * invisible border on a panel nobody can find. That is a silent failure, and
 * silent failures are the ones this codebase keeps getting bitten by.
 */
export const DISCLOSURE_TOKENS = [
  "--admin-radius-lg",
  "--admin-accent",
  "--admin-text",
] as const;

/**
 * Should a disclosure panel start OPEN?
 *
 * The general answer is no — the owner asked for collapsed, and a page of
 * pre-expanded panels is the clutter he is trying to remove. But there is one
 * case where collapsing does real harm: when the panel is the only thing on
 * screen explaining why the rest of the screen is empty.
 *
 * That is not hypothetical. It is the M-2 bug, verbatim: the Leafly board
 * renders nothing until setup is complete, so if the setup panel is also
 * hidden, the owner sees a blank space and no explanation — which is exactly
 * the report that created that panel in the first place. Collapsing it by
 * default would quietly re-introduce a bug we already fixed.
 *
 * So: collapsed once the thing is working, open while it is not.
 *
 * @param blockingStepsRemaining  Steps that must be done before orders can arrive.
 * @param hasEverReceived         Whether any order has actually arrived.
 */
export function shouldStartOpen(
  blockingStepsRemaining: number,
  hasEverReceived: boolean,
): boolean {
  // A shop with working evidence on screen never needs the lecture expanded,
  // even if some optional step is outstanding.
  if (hasEverReceived) return false;
  return blockingStepsRemaining > 0;
}

/**
 * The summary line's text.
 *
 * Centralised for the same reason as the classes: the owner asked for the bar
 * to match the speaker guide, and the speaker guide leads with an emoji and
 * an em-dashed subtitle. Building the string in one place means the two bars
 * cannot drift into different grammar.
 */
export function disclosureLabel(icon: string, title: string, subtitle?: string | null): string {
  const head = `${icon} ${title}`.trim();
  const tail = subtitle?.trim();
  return tail ? `${head} — ${tail}` : head;
}

/* ───────────────────────────── self-tests ───────────────────────────── */

export function __runDisclosureTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (what: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[disclosure-core] FAIL: ${what}`);
    }
  };

  // ── The shell ──────────────────────────────────────────────────────────
  ok("the shell is a rounded card", DISCLOSURE_SHELL_CLASS.includes("rounded-[var(--admin-radius-lg)]"));
  ok(
    "the shell has a REAL border, not just a tint",
    DISCLOSURE_SHELL_CLASS.includes("border border-[var(--admin-accent)]"),
  );
  ok(
    "the border is the green accent, which is what makes it the green bar",
    DISCLOSURE_SHELL_CLASS.includes("border-[var(--admin-accent)]/40"),
  );
  ok(
    "the fill is a faint accent tint, not a solid block",
    DISCLOSURE_SHELL_CLASS.includes("bg-[var(--admin-accent)]/[0.06]"),
  );
  ok("the shell has horizontal padding", DISCLOSURE_SHELL_CLASS.includes("px-3.5"));
  ok("the shell has vertical padding", DISCLOSURE_SHELL_CLASS.includes("py-3"));
  ok("the shell is spaced from whatever precedes it", DISCLOSURE_SHELL_CLASS.includes("mt-3"));

  // The danger token must never appear here: a green bar that turns red on
  // one screen is a different component wearing the same name.
  ok("the shell never uses the danger colour", !DISCLOSURE_SHELL_CLASS.includes("--admin-danger"));
  ok("the shell never uses gold", !DISCLOSURE_SHELL_CLASS.includes("--admin-gold"));

  // ── The summary bar ────────────────────────────────────────────────────
  ok("the bar shows it is clickable", DISCLOSURE_SUMMARY_CLASS.includes("cursor-pointer"));
  ok("the bar is bold", DISCLOSURE_SUMMARY_CLASS.includes("font-bold"));
  ok("the bar is body-sized, not a heading", DISCLOSURE_SUMMARY_CLASS.includes("text-sm"));
  ok(
    "the bar uses the normal text colour so it reads as a control, not an alert",
    DISCLOSURE_SUMMARY_CLASS.includes("text-[var(--admin-text)]"),
  );

  // ── Token list is complete and honest ──────────────────────────────────
  const both = `${DISCLOSURE_SHELL_CLASS} ${DISCLOSURE_SUMMARY_CLASS}`;
  const used = [...both.matchAll(/(--admin-[a-z-]+)/g)].map((m) => m[1]);
  const uniqueUsed = [...new Set(used)].sort();
  const declared = [...DISCLOSURE_TOKENS].sort();
  ok(
    "DISCLOSURE_TOKENS lists exactly the tokens actually used",
    JSON.stringify(uniqueUsed) === JSON.stringify(declared),
  );
  ok("at least one token is used", uniqueUsed.length > 0);
  ok(
    "no token is declared that is not used",
    declared.every((t) => uniqueUsed.includes(t)),
  );

  // ── shouldStartOpen ────────────────────────────────────────────────────
  ok("a broken, never-used integration starts OPEN", shouldStartOpen(3, false) === true);
  ok("one blocking step left, nothing received → OPEN", shouldStartOpen(1, false) === true);
  ok("nothing blocking, nothing received → collapsed", shouldStartOpen(0, false) === false);
  ok("orders are arriving → collapsed even with steps left", shouldStartOpen(2, true) === false);
  ok("orders arriving and nothing left → collapsed", shouldStartOpen(0, true) === false);
  // Evidence beats the checklist. A shop with real orders on screen does not
  // need a setup panel forced open at it every time it loads the page.
  ok("evidence outranks the checklist", shouldStartOpen(99, true) === false);
  // Defensive: a negative count is nonsense, and nonsense must not open the
  // panel forever.
  ok("a nonsense negative count does not force it open", shouldStartOpen(-1, false) === false);

  // ── disclosureLabel ────────────────────────────────────────────────────
  ok(
    "icon and title are joined with a space",
    disclosureLabel("📖", "Set up a speaker") === "📖 Set up a speaker",
  );
  ok(
    "a subtitle is joined with an em dash, matching the speaker guide",
    disclosureLabel("🧩", "Leafly orders", "setup") === "🧩 Leafly orders — setup",
  );
  ok("a null subtitle adds no dash", disclosureLabel("🧩", "Leafly orders", null) === "🧩 Leafly orders");
  ok(
    "an empty subtitle adds no dash",
    disclosureLabel("🧩", "Leafly orders", "") === "🧩 Leafly orders",
  );
  ok(
    "a whitespace-only subtitle adds no dash",
    disclosureLabel("🧩", "Leafly orders", "   ") === "🧩 Leafly orders",
  );
  ok(
    "a subtitle is trimmed rather than double-spaced",
    disclosureLabel("🧩", "Leafly orders", "  setup  ") === "🧩 Leafly orders — setup",
  );
  ok("the label never ends in a dangling dash", !disclosureLabel("🧩", "T", "").endsWith("—"));
  ok(
    "the em dash is the real character, not a hyphen",
    disclosureLabel("a", "b", "c").includes("—") && !disclosureLabel("a", "b", "c").includes(" - "),
  );

  // The speaker guide's exact bar, reproduced through the shared helper. If
  // this ever fails, the two bars have drifted and the owner's "identical"
  // has been broken.
  ok(
    "the speaker guide's own label round-trips through the helper",
    disclosureLabel("📖", "Set up a speaker", "full step-by-step guide") ===
      "📖 Set up a speaker — full step-by-step guide",
  );

  return { passed, failed };
}
