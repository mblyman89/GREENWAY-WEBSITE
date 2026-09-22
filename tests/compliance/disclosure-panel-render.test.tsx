/**
 * tests/compliance/disclosure-panel-render.test.tsx
 *
 * SLICE L-20 — THE BAR, ACTUALLY RENDERED.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * The first run of `mutate-leafly-l20-collapsible.py` left SIX survivors, and
 * every one of them was the same mistake in a different place:
 *
 *   - the component inlines its own classes instead of the core's
 *   - the summary bar stops reading the shared class
 *   - the label is built inline instead of by the shared helper
 *   - the step count disappears from the collapsed bar
 *   - the badge moves outside <summary>, so it is hidden when collapsed
 *   - the badge prop is ignored entirely
 *
 * The companion test file asserts on SOURCE TEXT, and source text cannot see
 * any of these. Swap `DISCLOSURE_SHELL_CLASS` for an equivalent-looking
 * literal and the file still "contains" everything a grep looks for, while
 * the two bars quietly stop being identical — which is the one thing the
 * owner actually asked for.
 *
 * This is the same lesson slices L-18 and L-19 each learned the hard way:
 * asserting that a string appears in a file proves that a string appears in
 * a file. So this file RENDERS the component and asserts on the HTML a
 * browser would receive.
 *
 * ===========================================================================
 * WHAT THIS CAN AND CANNOT PROVE
 * ===========================================================================
 * CAN: that both bars emit byte-identical class attributes; that the badge is
 *      inside <summary> (and therefore visible while collapsed); that `open`
 *      is present or absent exactly as the shared rule decides; that the
 *      label grammar matches.
 *
 * CANNOT: that a click expands it (that is the browser's native behaviour,
 *      not ours), or that the green has contrast. Those need a human.
 *      Native <details> is used precisely so the open/close behaviour is the
 *      platform's problem and not code we could get wrong.
 *
 * Follows the house precedent in `leafly-helper-render.test.tsx` — house
 * rule 11: the repo already decided how to render-test a server component.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DisclosurePanel } from "@/components/admin/ui/DisclosurePanel";
import {
  DISCLOSURE_SHELL_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
} from "@/lib/admin/disclosure-core";

/** The class attribute of the outermost element. */
function shellClass(html: string): string {
  return (html.match(/^<details[^>]*class="([^"]*)"/) ?? [])[1] ?? "";
}

/** The class attribute of the <summary>. */
function summaryClass(html: string): string {
  return (html.match(/<summary[^>]*class="([^"]*)"/) ?? [])[1] ?? "";
}

/** Everything between <summary> and </summary> — i.e. the collapsed bar. */
function summaryInner(html: string): string {
  const m = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
  return m ? m[1] : "";
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("L-20 the rendered bar uses the shared classes", () => {
  it("the shell's class attribute IS the core's string, exactly", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="📖" title="T">
        <p>body</p>
      </DisclosurePanel>,
    );
    // Not "contains" — equals. An inlined look-alike would pass a substring
    // check while drifting from the speaker guide.
    expect(shellClass(html)).toBe(DISCLOSURE_SHELL_CLASS);
  });

  it("the summary's class attribute IS the core's string, exactly", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="📖" title="T">
        <p>body</p>
      </DisclosurePanel>,
    );
    expect(summaryClass(html)).toBe(DISCLOSURE_SUMMARY_CLASS);
  });

  it("the rendered bar is a native <details>/<summary>", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="📖" title="T">
        <p>body</p>
      </DisclosurePanel>,
    );
    expect(html.startsWith("<details")).toBe(true);
    expect(html).toContain("<summary");
    expect(html).toContain("</details>");
  });

  it("the children are rendered", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="📖" title="T">
        <p>the body text</p>
      </DisclosurePanel>,
    );
    expect(textOf(html)).toContain("the body text");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * "IDENTICAL" — PROVEN BY COMPARING TWO RENDERS.
 *
 * This is the assertion that actually encodes the owner's request. The
 * speaker guide's bar and the Leafly panel's bar must be the same bar. Here
 * both are rendered with their real props and their class attributes are
 * compared directly.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 the two bars are byte-identical", () => {
  const speaker = renderToStaticMarkup(
    <DisclosurePanel icon="📖" title="Set up a speaker" subtitle="full step-by-step guide">
      <p>speaker body</p>
    </DisclosurePanel>,
  );
  const leafly = renderToStaticMarkup(
    <DisclosurePanel icon="🧩" title="Leafly orders" subtitle="setup">
      <p>leafly body</p>
    </DisclosurePanel>,
  );

  it("same shell classes", () => {
    expect(shellClass(leafly)).toBe(shellClass(speaker));
  });

  it("same summary classes", () => {
    expect(summaryClass(leafly)).toBe(summaryClass(speaker));
  });

  it("same grammar — icon, title, em dash, subtitle", () => {
    expect(textOf(speaker)).toContain("📖 Set up a speaker — full step-by-step guide");
    expect(textOf(leafly)).toContain("🧩 Leafly orders — setup");
  });

  it("the em dash is a real em dash in the output, not a hyphen", () => {
    expect(textOf(leafly)).toContain("—");
    expect(textOf(leafly)).not.toContain("Leafly orders - setup");
  });

  it("a panel with no subtitle has no dangling separator", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="🧩" title="Leafly orders">
        <p>b</p>
      </DisclosurePanel>,
    );
    expect(textOf(html)).toContain("🧩 Leafly orders");
    expect(textOf(html)).not.toContain("—");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * THE BADGE MUST BE VISIBLE WHILE COLLAPSED.
 *
 * The whole point of putting the step count on the bar is that the owner can
 * tell whether he needs to open the panel WITHOUT opening it. A badge that
 * renders after </summary> is inside the collapsed region and is therefore
 * invisible until it is too late to be useful.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 the collapsed bar carries its own status", () => {
  const withBadge = renderToStaticMarkup(
    <DisclosurePanel icon="🧩" title="Leafly orders" subtitle="setup" badge={<b>3 steps left</b>}>
      <p>hidden body</p>
    </DisclosurePanel>,
  );

  it("the badge is rendered at all", () => {
    expect(textOf(withBadge)).toContain("3 steps left");
  });

  it("the badge is INSIDE the summary, so a collapsed panel still shows it", () => {
    expect(textOf(summaryInner(withBadge))).toContain("3 steps left");
  });

  it("the title is still on the bar next to the badge", () => {
    const bar = textOf(summaryInner(withBadge));
    expect(bar).toContain("Leafly orders");
    expect(bar).toContain("setup");
  });

  it("the body is NOT in the summary", () => {
    // Sanity: if the body leaked into the bar, the panel is not collapsing
    // anything and the badge test above would be meaningless.
    expect(textOf(summaryInner(withBadge))).not.toContain("hidden body");
  });

  it("omitting the badge still renders a correct bar", () => {
    const plain = renderToStaticMarkup(
      <DisclosurePanel icon="🧩" title="Leafly orders" subtitle="setup">
        <p>b</p>
      </DisclosurePanel>,
    );
    expect(textOf(summaryInner(plain))).toBe("🧩 Leafly orders — setup");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * OPEN AND CLOSED, AS ACTUALLY EMITTED.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 defaultOpen reaches the DOM", () => {
  it("collapsed by default — no `open` attribute", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="🧩" title="T">
        <p>b</p>
      </DisclosurePanel>,
    );
    expect(/<details[^>]*\sopen/.test(html)).toBe(false);
  });

  it("defaultOpen renders the `open` attribute", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="🧩" title="T" defaultOpen>
        <p>b</p>
      </DisclosurePanel>,
    );
    expect(/<details[^>]*\sopen/.test(html)).toBe(true);
  });

  it("an id is emitted so other screens can deep-link to it", () => {
    const html = renderToStaticMarkup(
      <DisclosurePanel icon="🧩" title="T" id="leafly-order-setup">
        <p>b</p>
      </DisclosurePanel>,
    );
    expect(html).toContain('id="leafly-order-setup"');
  });
});
