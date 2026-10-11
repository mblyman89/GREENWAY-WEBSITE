"use client";

/**
 * EditLinksGuide — R43 on-the-spot cheat sheet shown on the Website Hub
 * "Live preview" tab. Two halves:
 *
 *   1. "✎ Edit" buttons: what the green pills do and the /admin/edit link
 *      format behind them (so a link can also be typed or bookmarked by hand).
 *   2. Button link formats: every link shape a banner / card / section button
 *      can point at, with the exact values the menu understands. Values come
 *      straight from link-target-core (the same lists the "Pick a link…"
 *      picker uses), so this sheet can never drift from what actually works.
 *
 * Every example has a Copy button.
 */
import { useState } from "react";
import { HelpPanel } from "@/components/admin/ux";
import {
  MENU_CATEGORIES,
  MENU_SORTS,
  MENU_SPECIALS,
  MENU_STRAINS,
  PUBLIC_PAGES,
  buildMenuHref,
} from "@/lib/cms/link-target-core";
import { AREA_BUTTON_LABEL } from "@/lib/cms/edit-link-core";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          },
          () => undefined,
        );
      }}
      className="admin-focus shrink-0 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-2 py-0.5 text-[11px] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
      aria-label={`Copy ${text}`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Row({ code, note }: { code: string; note: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1">
      <code className="break-all rounded bg-[var(--admin-canvas)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--admin-text)]">
        {code}
      </code>
      <Copy text={code} />
      <span className="text-[11px] text-[var(--admin-text-muted)]">{note}</span>
    </li>
  );
}

function Values({ title, items }: { title: string; items: { value: string; label: string }[] }) {
  return (
    <p className="text-[11px] leading-relaxed text-[var(--admin-text-muted)]">
      <span className="font-semibold text-[var(--admin-text)]">{title}: </span>
      {items.map((i, n) => (
        <span key={i.value}>
          <code className="font-mono text-[var(--admin-text)]">{i.value}</code>
          {n < items.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

export function EditLinksGuide() {
  const menuExample = buildMenuHref({ categories: ["flower", "preroll"], strains: ["indica"], sort: "price-low" });
  const specialExample = buildMenuHref({ special: MENU_SPECIALS[1]?.value ?? "doobie-tuesday" });
  return (
    <HelpPanel id="edit-links-guide" title="✎ Edit buttons & link formats (cheat sheet)">
      <div className="space-y-4 text-xs text-[var(--admin-text-muted)]">
        <section className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">1 · The green ✎ Edit buttons</h3>
          <p>
            In the preview below (and on the real website while you are in Preview mode) every editable
            item shows a green pill. Click it and the back office opens on the exact editor, field or card
            that controls it — with a <strong>← Back to preview</strong> pill bottom-left to return.
            Hide or show the pills from the glowing <strong>Preview</strong> badge (bottom-right of the
            page). They hide automatically while Move mode is on.
          </p>
          <ul className="divide-y divide-[var(--admin-border)]">
            <li className="py-1">
              <strong className="text-[var(--admin-text)]">✎ Edit</strong> — one piece of wording or one image
              (a content block).
            </li>
            <li className="py-1">
              <strong className="text-[var(--admin-text)]">✎ Edit banner</strong> — a whole banner (picture,
              text, buttons, custom design).
            </li>
            {Object.entries(AREA_BUTTON_LABEL).map(([area, label]) => (
              <li key={area} className="py-1">
                <strong className="text-[var(--admin-text)]">{label}</strong> — the{" "}
                <code className="font-mono">{area}</code> area.
              </li>
            ))}
          </ul>
          <p className="pt-1">The links behind the pills (you can also type or bookmark these):</p>
          <ul>
            <Row code="/admin/edit?block=specials.hero.title" note="one content block, by its key" />
            <Row code="/admin/edit?owner=specials:hero" note="a banner (also loyalty:hero, specials:todays, section:<id>, shop-slide:<id>)" />
            <Row code="/admin/edit?area=home-typecards" note={`a named area (${Object.keys(AREA_BUTTON_LABEL).join(", ")})`} />
            <Row code="/admin/edit?block=specials.hero.title&from=hub&path=/specials" note="add from=hub|site & path=… to get the Back pill" />
          </ul>
          <p>
            Tip: hover any green ✎ Edit pill — its tooltip shows the block key (e.g.{" "}
            <code className="font-mono">Edit specials.hero.title</code>). Unknown keys safely open this
            preview instead of an error.
          </p>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">2 · Button link formats</h3>
          <p>
            Easiest: in any button&apos;s link box use <strong>Pick a link…</strong> — it builds these for you and
            checks them. To type one by hand, use one of these shapes:
          </p>
          <ul>
            <Row code="/specials" note="any public page (list below)" />
            <Row code="/menu/flower" note="one menu category: /menu/<category>" />
            <Row code={menuExample} note="filtered menu (any mix of the parameters below)" />
            <Row code={specialExample} note="menu showing one special collection" />
            <Row code="/menu?search=rosin" note="menu search" />
            <Row code="/menu?brands=Brand%20Name&maxPrice=40" note="brand / price filter (spaces become %20)" />
            <Row code="/blog/my-post-slug" note="one blog post: /blog/<slug>" />
            <Row code="tel:+13605551234" note="tap to call (use the real number)" />
            <Row code="mailto:info@example.com" note="tap to email (use the real address)" />
            <Row code="https://example.com" note="another website (opens off-site)" />
            <Row code="#faq" note="jump to a spot on the same page" />
          </ul>
          <p className="pt-1">
            Menu parameters, in the order Greenway writes them:{" "}
            <code className="font-mono text-[var(--admin-text)]">
              categories, strains, brands, vendors, weights, special, sort, maxPrice, maxThc, maxCbd, search
            </code>
            . Lists are comma-separated (<code className="font-mono">categories=flower,preroll</code>); start
            with <code className="font-mono">?</code> and join with <code className="font-mono">&amp;</code>.
          </p>
          <Values title="Public pages" items={PUBLIC_PAGES.map((p) => ({ value: p.path, label: p.label }))} />
          <Values title="categories" items={MENU_CATEGORIES} />
          <Values title="strains" items={MENU_STRAINS} />
          <Values title="special" items={MENU_SPECIALS} />
          <Values title="sort" items={MENU_SORTS} />
        </section>
      </div>
    </HelpPanel>
  );
}
