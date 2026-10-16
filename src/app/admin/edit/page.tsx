/**
 * /admin/edit — R43 "green ✎ Edit" resolver route.
 *
 * Every green ✎ Edit button in the Website Hub preview (and on the live site
 * in Preview mode) links here with exactly one of:
 *
 *   ?block=<content block key>      e.g. ?block=specials.hero.title
 *   ?owner=<banner owner id>        e.g. ?owner=section:<uuid> | loyalty:hero
 *   ?area=<named area>              e.g. ?area=home-carousel
 *
 * plus optional ?from=hub|site&path=/the/public/page (for the "← Back to
 * preview" pill on the destination editor).
 *
 * It resolves the destination with the PURE edit-target-core (the one source
 * of truth for "where is X edited?") — plus ONE read to learn which page a
 * `section:<uuid>` banner belongs to — then redirects. Staff-only. Unknown
 * input never errors: it lands on the Website Hub preview instead.
 *
 * You can also type these links yourself (bookmarks / notes), e.g.
 *   /admin/edit?block=footer.compliance.warning
 */
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getSection, listSections } from "@/lib/cms/page-sections-store";
import { parseDesignOwner } from "@/lib/cms/design-move-core";
import {
  EDIT_FALLBACK,
  editTargetForArea,
  editTargetForBlock,
  editTargetForOwner,
  isSafeAdminHref,
  isValidBlockKey,
  withReturn,
  type EditTarget,
} from "@/lib/cms/edit-target-core";

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** home.category.* / home.brand.* -> that Sections banner card, when it exists. */
async function homeSectionTarget(blockKey: string): Promise<EditTarget | null> {
  const m = /^home\.(category|brand)\./.exec(blockKey);
  if (!m) return null;
  const rows = await listSections("home").catch(() => []);
  const row = rows.find((r) => r.section_key === `home.${m[1]}`);
  return row?.id ? homeTab(editTargetForOwner({ kind: "section", id: row.id }, "home"), row.section_key) : null;
}

/** R61 S2: land on the Home editor's own tab for that banner (Types / Brands / More). */
function homeTab(t: EditTarget, sectionKey: string | null | undefined): EditTarget {
  const tab = sectionKey === "home.category" ? "types" : sectionKey === "home.brand" ? "brands" : "more";
  return { ...t, href: t.href.replace("/admin/pages/home?tab=sections", `/admin/pages/home?tab=${tab}`) };
}

export default async function AdminEditResolver({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const sp = await searchParams;
  const block = first(sp.block);
  const owner = first(sp.owner);
  const area = first(sp.area);

  let target: EditTarget = EDIT_FALLBACK;
  if (block && isValidBlockKey(block)) {
    target = (await homeSectionTarget(block)) ?? editTargetForBlock(block);
  } else if (owner) {
    const parsed = parseDesignOwner(owner);
    if (parsed) {
      let pageSlug: string | null = null;
      let sectionKey: string | null = null;
      if (parsed.kind === "section") {
        const row = await getSection(parsed.id).catch(() => null);
        pageSlug = row?.page_slug ?? null;
        sectionKey = row?.section_key ?? null;
      }
      target = editTargetForOwner(parsed, pageSlug);
      if (pageSlug === "home") target = homeTab(target, sectionKey);
    }
  } else if (area) {
    target = editTargetForArea(area);
  }

  const final = withReturn(target, first(sp.from), first(sp.path));
  redirect(isSafeAdminHref(final.href) ? final.href : EDIT_FALLBACK.href);
}
