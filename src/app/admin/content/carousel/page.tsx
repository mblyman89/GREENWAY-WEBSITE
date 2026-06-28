import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CarouselSlideCard } from "@/components/admin/CarouselSlideCard";
import { type MediaChoice } from "@/components/admin/ContentImageField";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listCarouselSlides } from "@/lib/cms/carousel-store";
import { listMedia } from "@/lib/media/store";
import { MAX_CAROUSEL_SLIDES } from "@/lib/cms/carousel-types";
import {
  seedCarouselAction,
  addCarouselSlideAction,
  saveCarouselSlideAction,
  publishCarouselSlideAction,
  deleteCarouselSlideAction,
  moveCarouselSlideAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function CarouselManagerPage({
  searchParams,
}: {
  searchParams: Promise<{
    added?: string;
    saved?: string;
    published?: string;
    deleted?: string;
    moved?: string;
    seeded?: string;
    error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Home Carousel"
          subtitle="Manage the rotating banners at the top of the homepage."
        />
        <div className="px-5 py-6 text-sm text-[#ffd700] sm:px-8">
          Supabase is not configured yet.
        </div>
      </div>
    );
  }

  const slides = await listCarouselSlides();

  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));

  const atCap = slides.length >= MAX_CAROUSEL_SLIDES;
  const flash =
    sp.error
      ? { tone: "error" as const, text: decodeURIComponent(sp.error) }
      : sp.added
        ? { tone: "ok" as const, text: "New slide added — scroll down to edit it." }
        : sp.saved
          ? { tone: "ok" as const, text: "Draft saved. Publish when you're ready." }
          : sp.published
            ? { tone: "ok" as const, text: "Slide published to the homepage." }
            : sp.deleted
              ? { tone: "ok" as const, text: "Slide deleted." }
              : sp.moved
                ? { tone: "ok" as const, text: "Slide order updated." }
                : sp.seeded && sp.seeded !== "0"
                  ? { tone: "ok" as const, text: `Loaded ${sp.seeded} starter slide(s).` }
                  : null;

  return (
    <div>
      <AdminPageHeader
        title="Home Carousel"
        subtitle={`The rotating banners at the very top of the homepage. Up to ${MAX_CAROUSEL_SLIDES} slides. Edit a draft, then publish to go live.`}
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {flash ? (
          <div
            className={
              flash.tone === "ok"
                ? "rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]"
                : "rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            }
          >
            {flash.text}
          </div>
        ) : null}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/60">
            {slides.length} of {MAX_CAROUSEL_SLIDES} slides
            {" · "}
            <a
              href="/api/admin/preview/enable?path=/"
              target="_blank"
              rel="noreferrer"
              className="text-[#7ed957] underline-offset-2 hover:underline"
            >
              Preview the homepage ↗
            </a>
          </p>
          <div className="flex items-center gap-2">
            {slides.length === 0 ? (
              <form action={seedCarouselAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5"
                >
                  Load starter slides
                </button>
              </form>
            ) : null}
            <form action={addCarouselSlideAction}>
              <button
                type="submit"
                disabled={atCap}
                title={
                  atCap
                    ? `You can have up to ${MAX_CAROUSEL_SLIDES} slides.`
                    : "Add a new slide"
                }
                className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Add slide
              </button>
            </form>
          </div>
        </div>

        {slides.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f0f0f] p-10 text-center">
            <p className="text-sm text-white/70">
              No slides yet. Click <strong>Load starter slides</strong> to bring
              in the current homepage banners, or <strong>+ Add slide</strong> to
              start fresh.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {slides.map((slide, index) => (
              <CarouselSlideCard
                key={slide.id}
                slide={slide}
                index={index}
                total={slides.length}
                mediaChoices={mediaChoices}
                saveAction={saveCarouselSlideAction}
                publishAction={publishCarouselSlideAction}
                deleteAction={deleteCarouselSlideAction}
                moveAction={moveCarouselSlideAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
