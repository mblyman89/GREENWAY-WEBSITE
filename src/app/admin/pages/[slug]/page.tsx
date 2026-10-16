import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { CarouselSlideCard } from "@/components/admin/CarouselSlideCard";
import { BannerScheduleCalendar } from "@/components/admin/BannerScheduleCalendar";
import { homeSlideSchedule, normalizeHomeSlideAdvanced } from "@/lib/cms/home-slide-advanced-core";
import { type MediaChoice } from "@/components/admin/ContentImageField";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listMedia } from "@/lib/media/store";
import {
  isValidPageSlug,
  PAGE_SECTION_CONFIG,
  sectionCapFor,
} from "@/lib/cms/page-sections-types";
import { PageWordingCard } from "@/components/admin/PageWordingCard";
import { PAGES_WITH_WORDING } from "@/lib/cms/page-wording-core";
import { AboutCoreValuesCard } from "@/components/admin/AboutCoreValuesCard";
import { getCoreValuesDoc } from "@/lib/about/core-values-store";
import {
  saveCoreValuesDraftAction,
  publishCoreValuesAction,
} from "../about-values-actions";
import { listSections } from "@/lib/cms/page-sections-store";
import { listPublishedPostLinks } from "@/lib/cms/blog-store";
import { seedsForPage } from "@/lib/cms/page-sections-seed";
import { HomeDisplaySettingsCard } from "@/components/admin/HomeDisplaySettingsCard";
import { TypeCardImagesEditor } from "@/components/admin/TypeCardImagesEditor";
import { hasCustomTypeCards, readTypeCards } from "@/lib/cms/type-cards-core";
import {
  readHomeCardCount,
  DAILY_DEALS_COUNT_KEY,
} from "@/lib/cms/home-section-settings-core";
import { getHomeSectionByKey } from "@/lib/cms/page-sections-store";
import { listCarouselSlides } from "@/lib/cms/carousel-store";
import { MAX_CAROUSEL_SLIDES } from "@/lib/cms/carousel-types";
import { listFaqItems } from "@/lib/cms/faq-store";
import { FaqItemCard } from "@/components/admin/FaqItemCard";
import { Button } from "@/components/admin/ui";
import { EmptyState } from "@/components/admin/ux";
import { SchedulePanel } from "@/components/admin/SchedulePanel";
import { openSchedulesByTarget } from "@/lib/cms/content-schedule-server";
import {
  seedSectionsAction,
  addSectionAction,
  saveSectionAction,
  publishSectionAction,
  deleteSectionAction,
  moveSectionAction,
  saveHomeSettingsAction,
  saveTypeCardImagesAction,
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

/**
 * R42 Q3: pages whose builder banners render as an optional strip just above
 * the footer (<PageBuilderBanners>). Their own designed top stays untouched.
 */
const BOTTOM_STRIP_PAGES: ReadonlySet<string> = new Set(["about", "faq", "locations", "price-match"]);

type Flash = { tone: "ok" | "error"; text: string } | null;

// R61 S2: the Home editor tabs (roadmap §15). "carousel" keeps its old id so
// every existing ?tab=carousel link (schedule list, ✎ Edit, redirects) works.
const HOME_TABS = ["carousel", "types", "brands", "typecards", "more"] as const;
type HomeTab = (typeof HOME_TABS)[number];
const HOME_TAB_LABEL: Record<HomeTab, string> = {
  carousel: "Main banner",
  types: "Types banner",
  brands: "Brands banner",
  typecards: "Types cards",
  more: "More banners & settings",
};
/** The fixed home banner each single-banner tab shows. */
const HOME_TAB_KEY: Partial<Record<HomeTab, string>> = { types: "home.category", brands: "home.brand" };

function flashFor(sp: Record<string, string | undefined>): Flash {
  if (sp.error) return { tone: "error", text: decodeURIComponent(sp.error) };
  if (sp.scheduled) return { tone: "ok", text: decodeURIComponent(sp.scheduled) };
  if (sp.added) return { tone: "ok", text: "New section added — scroll down to edit it." };
  if (sp.saved && sp.tab === "typecards")
    return { tone: "ok", text: "Type Cards published to the homepage." };
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
  const isAbout = slug === "about";
  // R61 S2 (roadmap §15): Home has 4 main tabs — Main banner (the carousel,
  // shown first) | Types banner | Brands banner | Types cards — plus a small
  // "More banners & settings" tab (daily-deals count + any extra banners).
  // Old deep links keep working: ?tab=carousel = Main banner, ?tab=sections =
  // every home section on one screen (the pre-R61 view, so #section-<id>
  // anchors always land). FAQ keeps (sections | qanda); other pages: sections.
  let tab: HomeTab | "sections" | "qanda" = isHome ? "carousel" : "sections";
  if (isHome) {
    const want = sp.tab === "main" ? "carousel" : sp.tab;
    if (want && (HOME_TABS as readonly string[]).includes(want)) tab = want as HomeTab;
    else if (want === "sections") tab = "sections";
  } else if (isFaq && sp.tab === "qanda") tab = "qanda";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title={config.label}
          subtitle="Manage this page's banners and sections."
        />
        <div className="px-5 py-6 text-sm text-[var(--admin-gold)] sm:px-8">
          The database isn&apos;t fully set up yet. Once your administrator
          finishes the one-time setup, this page&apos;s banners and sections will
          appear here for you to edit.
        </div>
      </div>
    );
  }

  // Media choices for the image picker (shared by both tabs).
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => /^(image|video)\//.test(m.mime_type ?? "") && m.public_url) // R44: videos too (pickers show them only in video-capable slots)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
      mimeType: m.mime_type ?? null,
    }));

  const flash = flashFor(sp);

  // The in-app preview screen now lives on the Website Sync page's "Live
  // preview" tab (MIG-7: Site Content retired). The carousel/home Preview link
  // points there (not the live website) per the owner's request.
  const previewHref = "/admin/website-sync?tab=preview";

  // About page: load the owner-managed "Our Values" cards (single document,
  // draft-aware). Falls back to the shipped four cards pre-migration/pre-seed.
  const aboutValuesDoc = isAbout ? await getCoreValuesDoc() : null;

  return (
    <div>
      <AdminPageHeader
        title={config.label}
        subtitle={
          isHome
            ? "Manage the homepage: the Main banner (rotating carousel), the Types banner, the Brands banner and the Types cards — each in its own tab, all with the same Design Studio."
            : `Manage the banners and sections on the ${config.label} page. Edit a draft, then publish to go live.`
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {flash ? (
          <div
            className={
              flash.tone === "ok"
                ? "rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]"
                : "rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]"
            }
          >
            {flash.text}
          </div>
        ) : null}

        {/* Tab bar (home: R61 4 tabs + More; faq: Banners|Q&A) */}
        {isHome ? (
          <div className="flex flex-wrap gap-1 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1">
            {HOME_TABS.map((t) => {
              const active = tab === t || (t === "more" && tab === "sections");
              return (
                <a
                  key={t}
                  href={`/admin/pages/home?tab=${t}`}
                  className={
                    active
                      ? `${t === "more" ? "" : "flex-1 "}rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-center text-sm font-semibold text-black`
                      : `${t === "more" ? "" : "flex-1 "}rounded-[var(--admin-radius-sm)] px-4 py-2 text-center text-sm font-medium text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)]`
                  }
                >
                  {HOME_TAB_LABEL[t]}
                </a>
              );
            })}
          </div>
        ) : null}

        {isFaq ? (
          <div className="flex gap-1 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1">
            <a
              href={`/admin/pages/faq?tab=sections`}
              className={
                tab === "sections"
                  ? "flex-1 rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-[var(--admin-radius-sm)] px-4 py-2 text-center text-sm font-medium text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)]"
              }
            >
              Banners
            </a>
            <a
              href={`/admin/pages/faq?tab=qanda`}
              className={
                tab === "qanda"
                  ? "flex-1 rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-center text-sm font-semibold text-black"
                  : "flex-1 rounded-[var(--admin-radius-sm)] px-4 py-2 text-center text-sm font-medium text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)]"
              }
            >
              Questions &amp; Answers
            </a>
          </div>
        ) : null}

        {/* Preview link → Site Content preview screen */}
        <p className="text-sm text-[var(--admin-text-muted)]">
          <a
            href={previewHref}
            className="text-[var(--admin-accent)] underline-offset-2 hover:underline"
          >
            Open the preview screen ↗
          </a>{" "}
          to see your changes before they go live.
        </p>

        {/*
          MIG-1 MS-1.2: the all-inclusive "Page wording" card. For pages listed
          in PAGES_WITH_WORDING (vendors first), this surfaces that page's
          editable text/images (its content blocks) right here in the page's own
          editor — the same safe draft → preview → publish machinery as Site
          Content, just scoped to this page. Additive only: the blocks also
          remain in Site Content until a later mini-slice removes them there.
        */}
        {PAGES_WITH_WORDING.has(slug) ? (
          <PageWordingCard slug={slug} previewPath={config.previewPath} />
        ) : null}

        {/*
          About page: the "Our Values" cards get their own owner editor (add /
          edit / delete / reorder, keeping their exact look). Uses migration
          0149 (about_core_values) with a byte-identical pre-migration fallback,
          so the section is unchanged until the owner edits + publishes.
        */}
        {isAbout && aboutValuesDoc ? (
          <AboutCoreValuesCard
            publishedValues={aboutValuesDoc.published}
            draftValues={aboutValuesDoc.draft}
            dirty={aboutValuesDoc.dirty}
            isFallback={aboutValuesDoc.isFallback}
            previewPath={config.previewPath}
            saveAction={saveCoreValuesDraftAction}
            publishAction={publishCoreValuesAction}
          />
        ) : null}

        {isHome && tab === "carousel" ? (
          <CarouselTab mediaChoices={mediaChoices} />
        ) : isHome && tab === "typecards" ? (
          <TypeCardsTab mediaChoices={mediaChoices} />
        ) : isFaq && tab === "qanda" ? (
          <QandaTab />
        ) : (
          <SectionsTab
            slug={slug}
            cap={sectionCapFor(slug)}
            mediaChoices={mediaChoices}
            hasSeeds={seedsForPage(slug).length > 0}
            homeTab={isHome && tab !== "qanda" ? (tab as HomeTab | "sections") : undefined}
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
  // R47: published posts / newsletters for the Banner Studio link picker.
  const posts = await listPublishedPostLinks().catch(() => []);
  // R46-S1: upcoming scheduled changes per slide (one query).
  const sched = await openSchedulesByTarget("carousel_slide");
  const nowIso = new Date().toISOString();
  const atCap = slides.length >= MAX_CAROUSEL_SLIDES;
  // R54: calendar of the PUBLISHED schedule (what visitors get).
  const calendarBanners = slides
    .filter((s) => s.enabled && s.status === "published")
    .map((s) => {
      const adv = normalizeHomeSlideAdvanced(s.advanced ?? null);
      return {
        id: s.id,
        label: s.title || s.eyebrow || s.slide_key,
        schedule: adv ? homeSlideSchedule(adv) : { start: null, end: null, days: [], from: null, to: null },
        fallback: adv?.fallback === true,
      };
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--admin-text-muted)]">
          {slides.length} of {MAX_CAROUSEL_SLIDES} slides
        </p>
        <div className="flex items-center gap-2">
          {slides.length === 0 ? (
            <form action={seedCarouselAction}>
              <Button type="submit" variant="neutral">Load starter slides</Button>
            </form>
          ) : null}
          <form action={addCarouselSlideAction}>
            <Button type="submit" variant="primary" disabled={atCap}>+ Add slide</Button>
          </form>
        </div>
      </div>

      {slides.length > 0 ? <BannerScheduleCalendar banners={calendarBanners} anchorPrefix="slide-" nowMs={Date.parse(nowIso)} /> : null}

      {slides.length === 0 ? (
        <EmptyState
          icon="🖼️"
          title="No slides yet"
          description="Load the starter slides or add one to begin building your homepage carousel."
        />
      ) : (
        <div className="space-y-5">
          {slides.map((slide, index) => (
            <div key={slide.id}>
              <CarouselSlideCard
                slide={slide}
                index={index}
                total={slides.length}
                mediaChoices={mediaChoices}
                saveAction={saveCarouselSlideAction}
                publishAction={publishCarouselSlideAction}
                deleteAction={deleteCarouselSlideAction}
                moveAction={moveCarouselSlideAction}
                posts={posts}
              />
              <SchedulePanel
                kind="carousel_slide"
                targetKey={slide.id}
                returnTo={`/admin/pages/home?tab=carousel#slide-${slide.id}`}
                open={sched.byKey[slide.id] ?? []}
                ready={sched.ready}
                nowIso={nowIso}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type Cards tab (home only) — per-lane "Shop by Category" tile images
// ---------------------------------------------------------------------------

async function TypeCardsTab({ mediaChoices }: { mediaChoices: MediaChoice[] }) {
  const categoryRow = await getHomeSectionByKey("home.category");
  // R41 S3: full card list (custom, or the six defaults with legacy images).
  const cards = readTypeCards(categoryRow?.settings);
  const isCustom = hasCustomTypeCards(categoryRow?.settings);
  const posts = await listPublishedPostLinks().catch(() => []);

  return (
    <TypeCardImagesEditor
      cards={cards}
      isCustom={isCustom}
      posts={posts}
      mediaChoices={mediaChoices}
      saveAction={saveTypeCardImagesAction}
    />
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
  homeTab,
}: {
  slug: string;
  cap: number;
  mediaChoices: MediaChoice[];
  hasSeeds: boolean;
  /** R61 S2: which Home tab is showing (undefined on other pages). */
  homeTab?: HomeTab | "sections";
}) {
  const allSections = await listSections(slug);
  const isHome = slug === "home";
  // R46-S1: upcoming scheduled changes per section (one query).
  const sched = await openSchedulesByTarget("page_section");
  const nowIso = new Date().toISOString();
  // R41 S2: published posts / newsletters for the button link picker.
  const posts = await listPublishedPostLinks().catch(() => []);

  // SLICE 112: the locked home.settings config row holds homepage DISPLAY
  // settings (e.g. the daily-deal card count). It's not a visible banner, so we
  // pull it out of the normal card list and surface it as a dedicated "Home
  // page display" card at the top.
  const homeSettingsRow = isHome
    ? allSections.find((s) => s.section_key === "home.settings")
    : undefined;
  const nonConfig = allSections.filter(
    (s) => s.section_key !== "home.settings",
  );
  // R61 S2: Types / Brands tabs show just their banner; "More" shows the extra
  // banners (not the two fixed ones); legacy ?tab=sections shows all of them.
  const fixedKey = homeTab ? HOME_TAB_KEY[homeTab as HomeTab] : undefined;
  const sections = fixedKey
    ? nonConfig.filter((s) => s.section_key === fixedKey)
    : homeTab === "more"
      ? nonConfig.filter((s) => !Object.values(HOME_TAB_KEY).includes(s.section_key))
      : nonConfig;
  const singleBanner = !!fixedKey;
  const returnTab = isHome ? (homeTab ?? "sections") : undefined;
  const dailyDealsCount = readHomeCardCount(
    homeSettingsRow?.settings,
    DAILY_DEALS_COUNT_KEY,
  );
  // The cap the owner sees excludes the invisible config row.
  const visibleCap = isHome ? cap - 1 : cap;
  const atCap = allSections.length >= cap;

  return (
    <div className="space-y-5">
      {isHome && !singleBanner ? (
        <HomeDisplaySettingsCard
          dailyDealsCount={dailyDealsCount}
          saveAction={saveHomeSettingsAction}
        />
      ) : null}

      {BOTTOM_STRIP_PAGES.has(slug) ? (
        <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
          <strong className="text-[var(--admin-text)]">Where these show:</strong> banners you publish
          here appear near the bottom of the page, just above the footer. The page&apos;s own title
          area at the top stays exactly as it is (edit its words in &ldquo;Page wording&rdquo; above).
          With no banners published, the page looks the same as today.
        </p>
      ) : null}

      {singleBanner ? null : (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--admin-text-muted)]">
          {isHome ? nonConfig.length : sections.length} of {visibleCap} sections
        </p>
        <div className="flex items-center gap-2">
          {sections.length === 0 && hasSeeds ? (
            <form action={seedSectionsAction}>
              <input type="hidden" name="page_slug" value={slug} />
              {returnTab ? <input type="hidden" name="return_tab" value={returnTab} /> : null}
              <Button type="submit" variant="neutral">Load starter sections</Button>
            </form>
          ) : null}
          <form action={addSectionAction}>
            <input type="hidden" name="page_slug" value={slug} />
            {returnTab ? <input type="hidden" name="return_tab" value={returnTab} /> : null}
            <Button
              type="submit"
              variant="primary"
              disabled={atCap}
              title={atCap ? `You can have up to ${cap} sections.` : "Add a new section"}
            >
              + Add section
            </Button>
          </form>
        </div>
      </div>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon="📄"
          title={singleBanner ? "This banner isn’t set up yet" : "No editable sections yet"}
          description={
            singleBanner
              ? "Open the “More banners & settings” tab and click “Load starter sections” to bring in the homepage banners, then come back here."
              : hasSeeds
              ? "Click “Load starter sections” to bring in this page's current banners, or “+ Add section” to create one."
              : "Click “+ Add section” to create one."
          }
        />
      ) : (
        <div className="space-y-5">
          {sections.map((section, index) => (
            <div key={section.id}>
              <SectionCard
                section={section}
                pageSlug={slug}
                index={index}
                total={sections.length}
                mediaChoices={mediaChoices}
                saveAction={saveSectionAction}
                publishAction={publishSectionAction}
                deleteAction={deleteSectionAction}
                moveAction={moveSectionAction}
                posts={posts}
                returnTab={returnTab}
              />
              <SchedulePanel
                kind="page_section"
                targetKey={section.id}
                returnTo={`/admin/pages/${slug}?tab=${returnTab ?? "sections"}#section-${section.id}`}
                open={sched.byKey[section.id] ?? []}
                ready={sched.ready}
                nowIso={nowIso}
                locked={section.locked}
              />
            </div>
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
  // R46-S1: upcoming scheduled changes per question (one query).
  const sched = await openSchedulesByTarget("faq_item");
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--admin-text-muted)]">
          {items.length} question{items.length === 1 ? "" : "s"}. Edit a draft,
          then publish to update the public FAQ page.
        </p>
        <div className="flex items-center gap-2">
          {items.length === 0 ? (
            <form action={seedFaqAction}>
              <Button type="submit" variant="neutral">Load starter Q&amp;A</Button>
            </form>
          ) : null}
          <form action={addFaqAction}>
            <Button type="submit" variant="primary">+ Add question</Button>
          </form>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="❓"
          title="No questions yet"
          description="Click “Load starter Q&A” to import your current FAQ, or “+ Add question” to write a new one."
        />
      ) : (
        <div className="space-y-5">
          {items.map((item, index) => (
            <div key={item.id}>
              <FaqItemCard
                item={item}
                index={index}
                total={items.length}
                saveAction={saveFaqAction}
                publishAction={publishFaqAction}
                deleteAction={deleteFaqAction}
                moveAction={moveFaqAction}
              />
              <SchedulePanel
                kind="faq_item"
                targetKey={item.id}
                returnTo={`/admin/pages/faq?tab=qanda#faq-${item.id}`}
                open={sched.byKey[item.id] ?? []}
                ready={sched.ready}
                nowIso={nowIso}
                locked={item.locked}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
