"use client";

/**
 * TypeCardImagesEditor — the "Type Cards" tab on the Home page editor.
 *
 * Lets the owner set an optional product photo for each of the six "Shop by
 * Category" tiles (Flower, Prerolls, Concentrates, Edibles, Liquids, Topicals).
 * Each image is picked from the Media Library via the shared ContentImageField
 * control and mirrored into a hidden `lane_image_<key>` input; the whole set is
 * saved together through saveTypeCardImagesAction, which writes them onto the
 * home.category section's settings.laneImages JSON.
 *
 * A blank lane renders the clean text-only tile (byte-identical to the card the
 * site shipped with), so nothing changes on the live site until an image is set.
 */
import { useState } from "react";
import {
  ContentImageField,
  type MediaChoice,
} from "@/components/admin/ContentImageField";
import { Button } from "@/components/admin/ui";
import {
  HOME_TYPE_LANE_KEYS,
  type HomeTypeLaneKey,
} from "@/lib/cms/home-section-settings-core";

const LANE_LABELS: Record<HomeTypeLaneKey, string> = {
  flower: "Flower",
  prerolls: "Prerolls",
  concentrates: "Concentrates",
  edibles: "Edibles",
  liquids: "Liquids",
  topicals: "Topicals",
};

export function TypeCardImagesEditor({
  laneImages,
  mediaChoices,
  saveAction,
}: {
  /** Current per-lane image map (unset lanes are ""). */
  laneImages: Record<HomeTypeLaneKey, string>;
  mediaChoices: MediaChoice[];
  saveAction: (formData: FormData) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<HomeTypeLaneKey, string>>({
    ...laneImages,
  });

  const dirty = HOME_TYPE_LANE_KEYS.some(
    (lane) => (values[lane] ?? "") !== (laneImages[lane] ?? ""),
  );

  return (
    <form action={saveAction} className="space-y-5">
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-base">🗂️</span>
          <h3 className="text-sm font-semibold text-white">
            Shop by Category — tile images
          </h3>
          {dirty ? (
            <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
              ● unsaved edits
            </span>
          ) : null}
        </div>
        <p className="mb-5 text-xs text-white/50">
          Give each category tile its own product photo. Choose a square-ish,
          textless image — the tile lays the category name in a bar across the
          bottom, so the picture stays clear. Leave a tile blank to keep the
          clean text-only card. Changes publish when you click Save.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {HOME_TYPE_LANE_KEYS.map((lane) => (
            <div key={lane} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {LANE_LABELS[lane]}
                </span>
                {values[lane] ? (
                  <span className="rounded-full bg-[var(--admin-accent)]/15 px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
                    image set
                  </span>
                ) : (
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] font-semibold text-white/40">
                    no image (text-only)
                  </span>
                )}
              </div>
              {/* Mirror the chosen value so the server action can read it. */}
              <input
                type="hidden"
                name={`lane_image_${lane}`}
                value={values[lane] ?? ""}
              />
              <ContentImageField
                value={values[lane] ?? ""}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [lane]: next }))
                }
                mediaChoices={mediaChoices}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={!dirty}>
          Save tile images
        </Button>
        {dirty ? (
          <span className="text-xs text-white/50">
            Saving publishes these images to the live homepage.
          </span>
        ) : null}
      </div>
    </form>
  );
}
