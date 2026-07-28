/**
 * SLICE 78 — client-side category label registry.
 *
 * The customer menu (InteractiveMenuBrowser) is a client component whose
 * module-level helpers (section labels, search haystacks, filter options)
 * historically called the HARDCODED formatWebsiteCategory — so renaming a
 * category at /admin/settings/types never reached the public site.
 *
 * The menu page now loads the DB-backed value→label map server-side
 * (loadCategoryLabelMap) and hands it to the browser, which registers it here
 * once per render. Every label lookup then prefers the owner's DB label and
 * falls back to the hardcoded taxonomy / title-case exactly as before — a
 * missing or empty map means ZERO behavior change.
 */
import { formatWebsiteCategory, websiteCategories } from "@/lib/pos/category-taxonomy";

let OVERRIDES: Record<string, string> = {};

/** Register the DB-backed labels (server → client, serializable map). */
export function setCategoryLabelOverrides(map: Record<string, string> | null | undefined): void {
  OVERRIDES = map ?? {};
}

/** Display label: owner's DB label first, hardcoded taxonomy/title-case after. */
export function categoryLabel(value: string): string {
  return OVERRIDES[value] ?? formatWebsiteCategory(value);
}

/**
 * Every category the menu should render a section for: the hardcoded taxonomy
 * in its curated order, followed by any owner-created DB categories (already
 * sort-ordered by the server query) that are not in the hardcoded list.
 */
export function allKnownCategories(): string[] {
  const base = websiteCategories as readonly string[];
  const extras = Object.keys(OVERRIDES).filter((value) => !base.includes(value));
  return [...base, ...extras];
}

/**
 * Is this a category the menu should accept from URL params / filters?
 * True for the hardcoded taxonomy AND any owner-created DB category.
 */
export function isKnownCategory(value: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(OVERRIDES, value) ||
    (websiteCategories as readonly string[]).includes(value)
  );
}
