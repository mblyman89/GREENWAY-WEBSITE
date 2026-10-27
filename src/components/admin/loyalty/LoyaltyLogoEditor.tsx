"use client";

/**
 * R64 — edit the logo at the top of the Loyalty signup form: pick any picture
 * from the Media Library (or paste a link), choose its size, set the alt
 * text, or hide it. Same Save draft → Publish flow as every page block.
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import {
  LOYALTY_LOGO_BLOCK,
  LOYALTY_LOGO_DEFAULT_ALT,
  LOYALTY_LOGO_DEFAULT_SRC,
  LOYALTY_LOGO_SIZES,
  loyaltyLogoClass,
  resolveLoyaltyLogo,
  serializeLoyaltyLogo,
  type LoyaltyLogo,
} from "@/lib/loyalty/loyalty-logo-core";

export function LoyaltyLogoEditor({
  draftJson,
  publishedJson,
  mediaChoices,
  saveDraftAction,
  publishAction,
}: {
  draftJson: string | null;
  publishedJson: string | null;
  mediaChoices: MediaChoice[];
  saveDraftAction: (fd: FormData) => void | Promise<void>;
  publishAction: (fd: FormData) => void | Promise<void>;
}) {
  const [logo, setLogo] = useState<LoyaltyLogo>(() => resolveLoyaltyLogo(draftJson ?? publishedJson));
  const saved = serializeLoyaltyLogo(resolveLoyaltyLogo(draftJson ?? publishedJson));
  const value = serializeLoyaltyLogo(logo);
  const dirty = value !== saved;
  const live = serializeLoyaltyLogo(resolveLoyaltyLogo(publishedJson)) === saved;
  const set = (p: Partial<LoyaltyLogo>) => setLogo((l) => ({ ...l, ...p }));

  return (
    <form className="space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <input type="hidden" name="block_key" value={LOYALTY_LOGO_BLOCK} />
      <input type="hidden" name="draft_value" value={value} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-[var(--admin-text)]">Signup form logo</h2>
        <span className={`text-xs font-semibold ${live ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
          {live ? "Live & up to date" : "Draft not published yet"}
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
        <input type="checkbox" checked={logo.show} onChange={(e) => set({ show: e.target.checked })} />
        Show a logo at the top of the form
      </label>

      {logo.show ? (
        <>
          <div className="flex justify-center rounded-[var(--admin-radius-sm)] bg-zinc-950 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny in-editor thumbnail */}
            <img loading="lazy" decoding="async" src={logo.src} alt="" className={`h-auto object-contain ${loyaltyLogoClass(logo.size)}`} />
          </div>
          <ContentImageField value={logo.src} onChange={(src) => set({ src })} mediaChoices={mediaChoices} />
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="underline text-[var(--admin-text-muted)]" onClick={() => set({ src: LOYALTY_LOGO_DEFAULT_SRC, alt: LOYALTY_LOGO_DEFAULT_ALT })}>
              Use the original Greenway logo
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--admin-text)]">
              Size
              <select
                value={logo.size}
                onChange={(e) => set({ size: e.target.value as LoyaltyLogo["size"] })}
                className="mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              >
                {LOYALTY_LOGO_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-[var(--admin-text)]">
              Description for screen readers (alt text)
              <input
                type="text"
                maxLength={200}
                value={logo.alt}
                onChange={(e) => set({ alt: e.target.value })}
                className="mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              />
            </label>
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-3">
        <Button type="submit" variant="save" size="sm" formAction={saveDraftAction}>
          Save draft
        </Button>
        <Button type="submit" variant="primary" size="sm" formAction={publishAction} disabled={dirty}>
          Publish
        </Button>
        <span className="text-xs text-[var(--admin-text-muted)]">{dirty ? "Save draft first, then Publish." : "Publish makes the saved draft live."}</span>
      </div>
    </form>
  );
}
