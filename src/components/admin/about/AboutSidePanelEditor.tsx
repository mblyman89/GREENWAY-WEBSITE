"use client";

/**
 * R64 — editor for the About page's right-hand container (beside the
 * statement card). Design Studio first (build a full card: picture, text
 * boxes, buttons, overlays), Basic mode second (just a picture / logo, fit
 * and alt text). Same Save draft → Publish flow as every page block.
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import { BasicMode, DesignCard } from "@/components/admin/banner-studio/BannerEditorShell";
import type { PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { cardDesign } from "@/lib/cms/banner-design-core";
import {
  ABOUT_SIDE_BLOCK,
  ABOUT_SIDE_DEFAULT_ALT,
  ABOUT_SIDE_DEFAULT_SRC,
  resolveAboutSide,
  serializeAboutSide,
  type AboutSidePanel,
} from "@/lib/about/about-side-core";

const INPUT =
  "mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]";

export function AboutSidePanelEditor({
  draftJson,
  publishedJson,
  mediaChoices,
  posts,
  saveDraftAction,
  publishAction,
}: {
  draftJson: string | null;
  publishedJson: string | null;
  mediaChoices: MediaChoice[];
  posts: PickerPost[];
  saveDraftAction: (fd: FormData) => void | Promise<void>;
  publishAction: (fd: FormData) => void | Promise<void>;
}) {
  const [panel, setPanel] = useState<AboutSidePanel>(() => resolveAboutSide(draftJson ?? publishedJson));
  const saved = serializeAboutSide(resolveAboutSide(draftJson ?? publishedJson));
  const value = serializeAboutSide(panel);
  const dirty = value !== saved;
  const live = serializeAboutSide(resolveAboutSide(publishedJson)) === saved;
  const set = (p: Partial<AboutSidePanel>) => setPanel((x) => ({ ...x, ...p }));

  return (
    <form className="space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <input type="hidden" name="block_key" value={ABOUT_SIDE_BLOCK} />
      <input type="hidden" name="draft_value" value={value} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-[var(--admin-text)]">Side panel</h2>
          <p className="text-xs text-[var(--admin-text-muted)]">
            The container to the right of the statement card on the About page (below it on phones).
          </p>
        </div>
        <span className={`text-xs font-semibold ${live ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
          {live ? "Live & up to date" : "Draft not published yet"}
        </span>
      </div>

      <DesignCard
        mediaChoices={mediaChoices}
        title="Design Studio"
        description="Turn this on to build a full card for the side panel: drag text and buttons anywhere, add extra text boxes and buttons, zoom or tint the picture. Turn it off any time to go back to the simple picture / logo in Basic mode."
        design={panel.design ?? null}
        onChange={(d) =>
          setPanel((p) => {
            const next = { ...p };
            if (d) next.design = d;
            else delete next.design;
            return next;
          })
        }
        legacy={{}}
        imageSrc={panel.src}
        imageAlt={panel.alt}
        preset="section"
        seed={{}}
        makeNew={() => cardDesign({ ratio: 1, ratioMobile: 1 })}
        posts={posts}
      />

      <BasicMode hint="one picture or logo, how it fits, alt text" defaultOpen={!panel.design?.enabled}>
        <div className="space-y-3">
          <div className="flex justify-center rounded-[var(--admin-radius-sm)] border border-[var(--gold)]/25 bg-black p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- small in-editor thumbnail */}
            <img loading="lazy" decoding="async"
              src={panel.src}
              alt=""
              className={`h-56 w-full ${panel.fit === "cover" ? "object-cover" : "object-contain"}`}
            />
          </div>
          <ContentImageField value={panel.src} onChange={(src) => set({ src })} mediaChoices={mediaChoices} />
          <button
            type="button"
            className="text-xs text-[var(--admin-text-muted)] underline"
            onClick={() => set({ src: ABOUT_SIDE_DEFAULT_SRC, alt: ABOUT_SIDE_DEFAULT_ALT, fit: "contain", padded: true })}
          >
            Use the original Greenway logo
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--admin-text)]">
              Fit
              <select value={panel.fit} onChange={(e) => set({ fit: e.target.value === "cover" ? "cover" : "contain" })} className={INPUT}>
                <option value="contain">Show the whole picture (best for logos)</option>
                <option value="cover">Fill the box (best for photos)</option>
              </select>
            </label>
            <label className="block text-sm text-[var(--admin-text)]">
              Description for screen readers (alt text)
              <input value={panel.alt} onChange={(e) => set({ alt: e.target.value })} className={INPUT} maxLength={200} />
            </label>
          </div>
          {panel.fit === "contain" ? (
            <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
              <input type="checkbox" checked={panel.padded} onChange={(e) => set({ padded: e.target.checked })} />
              Keep the padding around the picture
            </label>
          ) : null}
        </div>
      </BasicMode>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="save" size="sm" formAction={saveDraftAction}>
          Save draft
        </Button>
        <Button type="submit" variant="primary" size="sm" formAction={publishAction} disabled={dirty}>
          Publish
        </Button>
        {dirty ? <span className="text-xs text-[var(--admin-gold)]">Save the draft first, then publish.</span> : null}
      </div>
    </form>
  );
}
