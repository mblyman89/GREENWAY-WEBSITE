"use client";

/**
 * FooterLinkUnavailable
 *
 * A small, accessible client helper for footer links (the app-store buttons
 * and any social button) that don't have a destination saved yet.
 *
 * Behaviour:
 *  - When a link HAS a real URL, it renders a normal <a> and navigates.
 *  - When a link's URL is BLANK, it renders a <button> that, on click, shows
 *    a friendly, dismissible message instead of going to a broken "#" link.
 *
 * The message text is fully editable by staff (Admin -> Website -> Header &
 * Footer, block `footer.link.unavailable.message`) and is passed in from the
 * server component so this stays a tiny, dependency-free client island.
 *
 * Accessibility: the popover is a role="dialog" with a labelled close button,
 * closes on Escape, closes when clicking the backdrop, and returns focus to
 * the trigger. No external libraries.
 */

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type Props = {
  /** Where the link should go. Blank/whitespace = "not connected yet". */
  href: string | null | undefined;
  /** Accessible label for the trigger (e.g. "Apple App Store"). */
  label: string;
  /** Glyph image source. */
  src: string;
  /** Friendly message shown when there is no destination yet. */
  unavailableMessage: string;
  /** Open link in a new tab when a real URL exists (social links). */
  newTab?: boolean;
  /** Extra classes applied to the trigger (keeps footer styling identical). */
  className?: string;
};

const DEFAULT_MESSAGE =
  "This isn't available just yet — check back soon! In the meantime, give us a call or stop by the shop.";

export function FooterLinkUnavailable({
  href,
  label,
  src,
  unavailableMessage,
  newTab = false,
  className = "",
}: Props) {
  const hasDestination = typeof href === "string" && href.trim().length > 0;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogId = useId();
  const message =
    unavailableMessage && unavailableMessage.trim().length > 0
      ? unavailableMessage
      : DEFAULT_MESSAGE;

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger for keyboard users.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog for screen readers.
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const glyph = (
    <Image
      src={src}
      alt={label}
      width={88}
      height={88}
      className="h-11 w-11 object-contain"
      sizes="44px"
    />
  );

  // Real destination available -> behave like a normal footer link.
  if (hasDestination) {
    return (
      <a
        href={href as string}
        aria-label={`Open Greenway on ${label}`}
        {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}
        className={className}
      >
        {glyph}
      </a>
    );
  }

  // No destination yet -> button that reveals the editable friendly message.
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        aria-label={`${label} — not available yet`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={className}
      >
        {glyph}
      </button>

      {open ? (
        <>
          {/* Click-away backdrop (transparent, covers the viewport). */}
          <span
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-40"
          />
          <div
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${dialogId}-title`}
            className="absolute bottom-full left-1/2 z-50 mb-3 w-64 -translate-x-1/2 rounded-2xl border border-[var(--gold)]/40 bg-[#0b0b0b] p-4 text-left shadow-2xl shadow-black/60"
          >
            <p
              id={`${dialogId}-title`}
              className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[var(--gold)]"
            >
              Coming soon
            </p>
            <p className="mt-2 text-[0.78rem] font-semibold leading-5 text-zinc-200">
              {message}
            </p>
            <button
              type="button"
              ref={closeRef}
              onClick={close}
              className="mt-3 inline-flex rounded-full bg-[var(--greenway)] px-4 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
            >
              Got it
            </button>
            {/* Little arrow pointing at the trigger glyph. */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-full -mt-1 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--gold)]/40 bg-[#0b0b0b]"
            />
          </div>
        </>
      ) : null}
    </span>
  );
}
