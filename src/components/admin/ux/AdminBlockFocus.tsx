"use client";

/**
 * AdminBlockFocus — R43. Admin-wide "land on the exact field" helper for the
 * green ✎ Edit buttons. Mounted once in the admin layout; renders nothing
 * unless the URL asks for it. Zero per-page wiring.
 *
 * After a ✎ Edit click, /admin/edit redirects to an editor URL such as
 *   /admin/medical-page?block=medical.hero.title&gwfrom=hub&gwpath=%2Fmedical
 *   /admin/pages/about#section-<uuid>
 *   /admin/loyalty-page?gwfrom=site&gwpath=%2Floyalty#loyalty-hero
 *
 * This component then (decision rules in the PURE edit-link-core.planFocus):
 *   • ?block=<key>  -> if the page has a ContentEditorShell card
 *     (#block-<key>) the shell already focuses it, so we do nothing; otherwise
 *     we focus the dedicated editor's field #f-<key> (Loyalty / Medical / Blog
 *     / Legal) — scroll, highlight ring, focus;
 *   • #<anchor>     -> scroll to that card, highlight it and dispatch
 *     `gw-expand` (collapsed cards such as Shop banner slides open themselves);
 *   • ?gwfrom=hub|site -> a small "← Back to preview" pill (bottom-left) so the
 *     owner can bounce straight back to the page they were inspecting. It is
 *     remembered for this editor (sessionStorage) so it survives Save / Publish
 *     (those redirect without the gw params), until dismissed.
 */
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { planFocus, type FocusPlan } from "@/lib/cms/edit-link-core";

const STORE_KEY = "gw-edit-back";
const RING = ["ring-2", "ring-[var(--admin-accent)]", "ring-offset-2", "ring-offset-[var(--admin-canvas)]"];

function highlight(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add(...RING);
  window.setTimeout(() => el.classList.remove(...RING), 2600);
}

/** Retry for a moment: client editors can mount a beat after the page. */
function whenPresent(find: () => HTMLElement | null, act: (el: HTMLElement) => void) {
  let tries = 0;
  const tick = () => {
    const el = find();
    if (el) return act(el);
    if (++tries < 20) window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 60);
}

type Stored = { path: string; back: NonNullable<FocusPlan["back"]> };

function readStored(path: string): Stored["back"] | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (v?.path !== path || !v.back || typeof v.back.href !== "string" || typeof v.back.label !== "string") return null;
    // Re-validate through the pure planner (never trust storage blindly).
    const url = new URL(v.back.href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!(url.pathname === "/admin/website-sync" || url.pathname === "/api/admin/preview/enable")) return null;
    return v.back;
  } catch {
    return null;
  }
}

export function AdminBlockFocus() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const [back, setBack] = useState<FocusPlan["back"]>(null);

  useEffect(() => {
    const plan = planFocus(`?${search}`, window.location.hash);

    if (plan.blockKey) {
      const key = plan.blockKey;
      // ContentEditorShell owns #block-<key> focusing; only handle f-<key>.
      if (!document.getElementById(`block-${key}`)) {
        whenPresent(
          () => (document.getElementById(`block-${key}`) ? null : document.getElementById(`f-${key}`)),
          (el) => {
            highlight(el);
            window.setTimeout(() => el.focus({ preventScroll: true }), 350);
          },
        );
      }
    }
    if (plan.anchorId) {
      const id = plan.anchorId;
      whenPresent(
        () => document.getElementById(id),
        (el) => {
          el.dispatchEvent(new CustomEvent("gw-expand"));
          highlight(el);
        },
      );
    }

    // Back-to-preview pill (deferred so the effect has no synchronous setState).
    let next: FocusPlan["back"] = plan.back;
    if (next) {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ path: pathname, back: next } satisfies Stored));
      } catch {
        // storage unavailable — the pill still shows for this load
      }
    } else {
      next = readStored(pathname);
    }
    const t = window.setTimeout(() => setBack(next), 0);
    return () => window.clearTimeout(t);
  }, [pathname, search]);

  if (!back) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full border border-[var(--admin-accent)]/60 bg-[var(--admin-surface)] py-1 pl-1 pr-1 shadow-lg shadow-black/40">
      <a
        href={back.href}
        className="admin-focus rounded-full bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
      >
        {back.label}
      </a>
      <button
        type="button"
        aria-label="Hide the back-to-preview button"
        onClick={() => {
          try {
            sessionStorage.removeItem(STORE_KEY);
          } catch {
            // ignore
          }
          setBack(null);
        }}
        className="admin-focus rounded-full px-2 py-1 text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
      >
        ✕
      </button>
    </div>
  );
}
