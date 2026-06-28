import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { CarouselSlideCard } from "@/components/admin/CarouselSlideCard";
import { type MediaChoice } from "@/components/admin/ContentImageField";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listMedia } from "@/lib/media/store";
import {
  isValidPageSlug,
  PAGE_SECTION_CONFIG,
  sectionCapFor,
} from "@/lib/cms/page-sections-types";
import { listSections } from "@/lib/cms/page-sections-store";
import { seedsForPage } from "@/lib/cms/page-sections-seed";
import { listCarouselSlides } from "@/lib/cms/carousel-store";
import { MAX_CAROUSEL_SLIDES } from "@/lib/cms/carousel-types";
import { listFaqItems } from "@/lib/cms/faq-store";
import { FaqItemCard } from "@/components/admin/FaqItemCard";
import {
  seedSectionsAction,
  addSectionAction,
  saveSectionAction,
  publishSectionAction,
  deleteSectionAction,
  moveSectionAction,
} from "./actions";
import {
  seedCarouselAction,
  addCarouselSlideAction,
  saveCarouselSlideAction,
  publishCarouselSlideAction,
  deleteCarouselSlideAction,
  moveCarouselSlideAction,
} from "../../content/carousel/actions";
import {
  seedFaqAction,
  addFaqAction,
  saveFaqAction,
  publishFaqAction,
  deleteFaqAction,
  moveFaqAction,
} from "../faq-actions";

export const dynamic = "force-dynamic";

type Flash = { tone: "ok" | "error"; text: string } | null;

function flashFor(sp: Record<string, string | undefined>): Flash {
  if (sp.error) return { tone: "error", text: decodeURIComponent(sp.error) };
  if (sp.added) return { tone: "ok", text: "New section added — scroll down to edit it." };
  if (sp.saved) return { tone: "ok", text: "Draft saved. Publish when you're ready." };
  if (sp.published) return { tone: "ok", text: "Published to the live page." };
  if (sp.deleted) return { tone: "ok", text: "Section deleted." };
  if (sp.moved) return { tone: "ok", text: "Order updated." };
  if (sp.seeded && sp.seeded !== "0")
    return { tone: "ok", text: `Loaded ${sp.seeded} starter section(s).` };
  return null;
}

export default async function PageBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("content.edit");
  const { slug } = await params;
  const sp = await searchParams;

  if (!isValidPageSlug(slug)) notFound();
  const config = PAGE_SECTION_CONFIG[slug];
  const isHome = slug === "home";
  const isFaq = slug === "faq";
  // Home has two tabs (carousel | sections); FAQ has (sections | qanda);
  // other pages only show sections.
  let tab: "carousel" | "sections" | "qanda" = "sections";
  if (isHome && sp.tab === "carousel") tab = "carousel";
  else if (isFaq && sp.tab === "qanda") tab = "qanda";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title={config.label}
          subtitle="Manage this page's banners and sections."
        />
        <div className="px-5 py-6 text-sm text-[#ffd700] sm:px-8">
          Supabase is not configured yet. Once the database is connected and
          migrations through 0013 are applied, this page&apos;s sections manage here.
        </div>
      </div>
    );
  }

  // Media choices for the image picker (shared by both tabs).
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));

  const flash = flashFor(sp);

  // The in-app preview screen lives in Site Content; the carousel/home Preview
  // link points there (not the live website) per the owner's request.
  const previewHref = `/admin/content?preview=${encodeURIComponent(config.previewPath)}`;

  return (
    <div>
      <AdminPageHeader
        title={config.label}
        subtitle={
          isHome
            ? "Manage the homepage: the rotating hero Carousel and the editable Sections below the daily-deal highlights."
            : `Manage the banners and sections on the ${config.label} page. Edit a draft, then publish to go live.`
        }
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

        {/* Tab bar (home: Carousel|Sections; faq: Sections|Q&A) */}
        {isHome ? (
          <div className="flex gap-1 rounded-xl border border-white/10 bg-[#0f0f0f] p-1">
            <a
              href={`/admin/pages/home?tab=carousel`}
              className={
                tab === "carousel"
                  ? "flex-1 rounded-lg bg-[#7ed957] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-white/70 transition hover:bg-white/5"
              }
            >
              Carousel
            </a>
            <a
              href={`/admin/pages/home?tab=sections`}
              className={
                tab === "sections"
                  ? "flex-1 rounded-lg bg-[#7ed957] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-white/70 transition hover:bg-white/5"
              }
            >
              Sections
            </a>
          </div>
        ) : null}

        {isFaq ? (
          <div className="flex gap-1 rounded-xl border border-white/10 bg-[#0f0f0f] p-1">
            <a
              href={`/admin/pages/faq?tab=sections`}
              className={
                tab === "sections"
                  ? "flex-1 rounded-lg bg-[#7ed957] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-white/70 transition hover:bg-white/5"
              }
            >
              Banners
            </a>
            <a
              href={`/admin/pages/faq?tab=qanda`}
              className={
                tab === "qanda"
                  ? "flex-1 rounded-lg bg-[#7ed957] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-white/70 transition hover:bg-white/5"
              }
            >
              Questions &amp; Answers
            </a>
          </div>
        ) : null}

        {/* Preview link → Site Content preview screen */}
        <p className="text-sm text-white/60">
          <a
            href={previewHref}
            className="text-[#7ed957] underline-offset-2 hover:underline"
          >
            Open the preview screen ↗
          </a>{" "}
          to see your changes before they go live.
        </p>

        {isHome && tab === "carousel" ? (
          <CarouselTab mediaChoices={mediaChoices} />
        ) : isFaq && tab === "qanda" ? (
          <QandaTab />
        ) : (
          <SectionsTab
            slug={slug}
            cap={sectionCapFor(slug)}
            mediaChoices={mediaChoices}
            hasSeeds={seedsForPage(slug).length > 0}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carousel tab (reuses the existing carousel manager pieces)
// ---------------------------------------------------------------------------

async function CarouselTab({ mediaChoices }: { mediaChoices: MediaChoice[] }) {
  const slides = await listCarouselSlides();
  const atCap = slides.length >= MAX_CAROUSEL_SLIDES;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">
          {slides.length} of {MAX_CAROUSEL_SLIDES} slides
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
              className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add slide
            </button>
          </form>
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f0f0f] p-10 text-center text-sm text-white/70">
          No slides yet. Load the starter slides or add one to begin.
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
  );
}

// ---------------------------------------------------------------------------
// Sections tab (generic page_sections)
// ---------------------------------------------------------------------------

async function SectionsTab({
  slug,
  cap,
  mediaChoices,
  hasSeeds,
}: {
  slug: string;
  cap: number;
  mediaChoices: MediaChoice[];
  hasSeeds: boolean;
}) {
  const sections = await listSections(slug);
  const atCap = sections.length >= cap;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">
          {sections.length} of {cap} sections
        </p>
        <div className="flex items-center gap-2">
          {sections.length === 0 && hasSeeds ? (
            <form action={seedSectionsAction}>
              <input type="hidden" name="page_slug" value={slug} />
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5"
              >
                Load starter sections
              </button>
            </form>
          ) : null}
          <form action={addSectionAction}>
            <input type="hidden" name="page_slug" value={slug} />
            <button
              type="submit"
              disabled={atCap}
              title={atCap ? `You can have up to ${cap} sections.` : "Add a new section"}
              className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add section
            </button>
          </form>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f0f0f] p-10 text-center text-sm text-white/70">
          No editable sections yet.{" "}
          {hasSeeds
            ? "Click Load starter sections to bring in this page's current banners, or "
            : ""}
          Click <strong>+ Add section</strong> to create one.
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              pageSlug={slug}
              index={index}
              total={sections.length}
              mediaChoices={mediaChoices}
              saveAction={saveSectionAction}
              publishAction={publishSectionAction}
              deleteAction={deleteSectionAction}
              moveAction={moveSectionAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Q&A tab (FAQ page only) — add/remove/reorder questions with draft+publish
// ---------------------------------------------------------------------------

async function QandaTab() {
  const items = await listFaqItems();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/60">
          {items.length} question{items.length === 1 ? "" : "s"}. Edit a draft,
          then publish to update the public FAQ page.
        </p>
        <div className="flex items-center gap-2">
          {items.length === 0 ? (
            <form action={seedFaqAction}>
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5"
              >
                Load starter Q&amp;A
              </button>
            </form>
          ) : null}
          <form action={addFaqAction}>
            <button
              type="submit"
              className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570]"
            >
              + Add question
            </button>
          </form>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f0f0f] p-10 text-center text-sm text-white/70">
          No questions yet. Click <strong>Load starter Q&amp;A</strong> to import
          your current FAQ, or <strong>+ Add question</strong> to write a new one.
        </div>
      ) : (
        <div className="space-y-5">
          {items.map((item, index) => (
            <FaqItemCard
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              saveAction={saveFaqAction}
              publishAction={publishFaqAction}
              deleteAction={deleteFaqAction}
              moveAction={moveFaqAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
