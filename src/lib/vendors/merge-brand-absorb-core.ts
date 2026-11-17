/**
 * D247 (owner: "there are a couple of vendors with a brand or few brands, and the system is
 * treating the brands as standalone vendors. I need a way to manually select two or more
 * vendors to merge into one, with each brand absorbed getting added to the vendors profile.")
 *
 * PURE planning for "absorb as a brand": before a merge, every merged-in card that has NO brand
 * of its own is really a brand that was filed as a vendor. It gets a brand row named after it
 * (created on ITS OWN card, so the merge's generic repoint carries it onto the kept card - and if
 * the merge fails the brand is still correct where it is). Cards that already have brands keep
 * them (the merge moves them). Never overwrites, never deletes, never steals a brand that belongs
 * to a different vendor.
 */

export type AbsorbVendor = {
  id: string;
  display_name: string;
  status?: string | null;
  website?: string | null;
  about?: string | null;
  mission_statement?: string | null;
  product_philosophy?: string | null;
  logo_media_id?: string | null;
};

export type AbsorbBrand = { id: string; display_name: string; slug: string; vendor_id: string | null };

export type AbsorbStep =
  | { kind: "create"; vendorId: string; vendorName: string; slug: string; row: AbsorbBrandInsert }
  | { kind: "claim"; vendorId: string; vendorName: string; brandId: string; brandName: string }
  | { kind: "keep"; vendorId: string; vendorName: string; brandId: string; brandName: string; why: string }
  | { kind: "skip"; vendorId: string; vendorName: string; why: string };

export type AbsorbBrandInsert = {
  display_name: string;
  slug: string;
  vendor_id: string;
  status: "draft" | "published";
  website: string | null;
  about: string | null;
  mission_statement: string | null;
  product_philosophy: string | null;
  logo_media_id: string | null;
};

/** Same slug rule as vendor/brand import (slugifyName). */
export function absorbSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Name key for "is this the same brand": case, punctuation and a trailing business suffix ignored. */
export function brandNameKey(value: string | null | undefined): string {
  return absorbSlug(String(value ?? ""))
    .replace(/-(llc|inc|corp|co|company|ltd|farms?|gardens?|cannabis|wa)$/g, "")
    .replace(/-/g, "");
}

const clean = (s: string | null | undefined): string | null => {
  const t = String(s ?? "").trim();
  return t ? t : null;
};

/**
 * One step per merged-in card.
 *  - The card has its own brand(s) -> keep (the merge moves them).
 *  - The kept card already has a brand with the same name -> keep (nothing to add).
 *  - A brand with this slug exists and belongs to no vendor -> claim it for this card.
 *  - A brand with this slug belongs to ANOTHER vendor -> skip, named (never stolen).
 *  - Otherwise -> create it on this card.
 */
export function planBrandAbsorption(input: {
  survivorId: string;
  duplicates: AbsorbVendor[];
  /** Every brand of the survivor and the duplicates. */
  brandsOfCards: AbsorbBrand[];
  /** Any brand already using one of the planned slugs (any vendor). */
  brandsBySlug: AbsorbBrand[];
}): AbsorbStep[] {
  const steps: AbsorbStep[] = [];
  const survivorKeys = new Map<string, AbsorbBrand>();
  for (const b of input.brandsOfCards) if (b.vendor_id === input.survivorId) survivorKeys.set(brandNameKey(b.display_name), b);
  const bySlug = new Map(input.brandsBySlug.map((b) => [b.slug, b] as const));
  const plannedSlugs = new Set<string>();
  for (const d of input.duplicates) {
    const name = clean(d.display_name);
    if (!name) {
      steps.push({ kind: "skip", vendorId: d.id, vendorName: d.display_name, why: "the card has no name" });
      continue;
    }
    const own = input.brandsOfCards.filter((b) => b.vendor_id === d.id);
    if (own.length > 0) {
      steps.push({
        kind: "keep",
        vendorId: d.id,
        vendorName: name,
        brandId: own[0]!.id,
        brandName: own.map((b) => b.display_name).join(", "),
        why: own.length === 1 ? "it already has a brand, which moves over" : `it already has ${own.length} brands, which move over`,
      });
      continue;
    }
    const key = brandNameKey(name);
    const onSurvivor = key ? survivorKeys.get(key) : undefined;
    if (onSurvivor) {
      steps.push({ kind: "keep", vendorId: d.id, vendorName: name, brandId: onSurvivor.id, brandName: onSurvivor.display_name, why: "the kept card already has this brand" });
      continue;
    }
    const slug = absorbSlug(name);
    if (!slug) {
      steps.push({ kind: "skip", vendorId: d.id, vendorName: name, why: "the name has no letters or numbers" });
      continue;
    }
    const taken = bySlug.get(slug);
    if (taken) {
      if (taken.vendor_id === null) {
        steps.push({ kind: "claim", vendorId: d.id, vendorName: name, brandId: taken.id, brandName: taken.display_name });
      } else if (taken.vendor_id === input.survivorId) {
        steps.push({ kind: "keep", vendorId: d.id, vendorName: name, brandId: taken.id, brandName: taken.display_name, why: "the kept card already has this brand" });
      } else {
        steps.push({ kind: "skip", vendorId: d.id, vendorName: name, why: `a brand called "${taken.display_name}" already belongs to another vendor` });
      }
      continue;
    }
    if (plannedSlugs.has(slug)) {
      steps.push({ kind: "skip", vendorId: d.id, vendorName: name, why: "another merged-in card makes the same brand" });
      continue;
    }
    plannedSlugs.add(slug);
    steps.push({
      kind: "create",
      vendorId: d.id,
      vendorName: name,
      slug,
      row: {
        display_name: name,
        slug,
        vendor_id: d.id,
        status: d.status === "published" ? "published" : "draft",
        website: clean(d.website),
        about: clean(d.about),
        mission_statement: clean(d.mission_statement),
        product_philosophy: clean(d.product_philosophy),
        logo_media_id: clean(d.logo_media_id),
      },
    });
  }
  return steps;
}

/** The slugs the server must look up before planning. */
export function absorbSlugsToCheck(duplicates: AbsorbVendor[]): string[] {
  return [...new Set(duplicates.map((d) => absorbSlug(d.display_name ?? "")).filter(Boolean))];
}

/** One plain sentence for the result banner. */
export function absorbNote(steps: AbsorbStep[]): string {
  const made = steps.filter((s) => s.kind === "create" || s.kind === "claim").map((s) => `“${s.vendorName}”`);
  const skipped = steps.filter((s): s is Extract<AbsorbStep, { kind: "skip" }> => s.kind === "skip");
  const parts: string[] = [];
  if (made.length) parts.push(`Added as brand${made.length === 1 ? "" : "s"} on the kept card: ${made.join(", ")}.`);
  if (skipped.length) parts.push(`Not added as a brand: ${skipped.map((s) => `“${s.vendorName}” (${s.why})`).join("; ")}.`);
  return parts.join(" ");
}

/** Manual picker bounds (the merge itself takes 1 kept + up to 4 merged in). */
export const MANUAL_MERGE_MAX_CARDS = 5;
export const MANUAL_MERGE_SEARCH_LIMIT = 40;

/** Picked ids from the URL: UUIDs only, de-duplicated, capped. */
export function parsePickedIds(raw: string | string[] | undefined | null): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((s) => String(s).split(","));
  const out: string[] = [];
  for (const p of parts) {
    const id = p.trim().toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MANUAL_MERGE_MAX_CARDS) break;
  }
  return out;
}

/** Vendor search for the picker: every word must appear in the name, legal name, DBA, license or website. */
export function searchVendorsForMerge<T extends { id: string; display_name: string; legal_name?: string | null; dba?: string | null; license_number?: string | null; website?: string | null; status?: string | null }>(
  vendors: T[],
  q: string,
  exclude: string[] = [],
  limit = MANUAL_MERGE_SEARCH_LIMIT,
): T[] {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return [];
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const hits = vendors.filter((v) => {
    if (skip.has(v.id.toLowerCase()) || v.status === "archived") return false;
    const hay = [v.display_name, v.legal_name, v.dba, v.license_number, v.website].map((x) => String(x ?? "").toLowerCase()).join(" ");
    return words.every((w) => hay.includes(w));
  });
  const first = words[0]!;
  hits.sort((a, b) => {
    const as = a.display_name.toLowerCase().startsWith(first) ? 0 : 1;
    const bs = b.display_name.toLowerCase().startsWith(first) ? 0 : 1;
    return as - bs || a.display_name.localeCompare(b.display_name);
  });
  return hits.slice(0, limit);
}

export function __runMergeBrandAbsorbCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("merge-brand-absorb-core FAIL:", m);
    }
  };
  const S = "00000000-0000-4000-8000-000000000001";
  const D1 = "00000000-0000-4000-8000-000000000002";
  const D2 = "00000000-0000-4000-8000-000000000003";
  const D3 = "00000000-0000-4000-8000-000000000004";
  const O = "00000000-0000-4000-8000-000000000009";

  ok(absorbSlug("Phat Panda & Co.") === "phat-panda-and-co", "slug");
  ok(brandNameKey("Phat Panda LLC") === brandNameKey("phat panda"), "name key drops suffix");
  ok(brandNameKey("Grow-Op Farms") === "growop", "name key farms");

  // brand-less dup -> create on its own card
  let p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog", status: "published", website: " https://x " }], brandsOfCards: [], brandsBySlug: [] });
  ok(p.length === 1 && p[0]!.kind === "create", "create");
  const c = p[0] as Extract<AbsorbStep, { kind: "create" }>;
  ok(c.row.vendor_id === D1 && c.row.slug === "sticky-frog" && c.row.status === "published" && c.row.website === "https://x", "create row");
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog", status: "draft" }], brandsOfCards: [], brandsBySlug: [] });
  ok((p[0] as Extract<AbsorbStep, { kind: "create" }>).row.status === "draft", "draft stays draft");

  // dup with brands -> keep
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "X Co" }], brandsOfCards: [{ id: "b1", display_name: "A", slug: "a", vendor_id: D1 }, { id: "b2", display_name: "B", slug: "b", vendor_id: D1 }], brandsBySlug: [] });
  ok(p[0]!.kind === "keep" && (p[0] as { why: string }).why.includes("2 brands"), "keep own brands");

  // survivor already has the same-name brand
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog LLC" }], brandsOfCards: [{ id: "b9", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: S }], brandsBySlug: [] });
  ok(p[0]!.kind === "keep", "survivor has it");

  // slug owned by nobody -> claim; by survivor -> keep; by another vendor -> skip
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog" }], brandsOfCards: [], brandsBySlug: [{ id: "b5", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: null }] });
  ok(p[0]!.kind === "claim", "claim orphan");
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog" }], brandsOfCards: [], brandsBySlug: [{ id: "b5", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: S }] });
  ok(p[0]!.kind === "keep", "slug on survivor");
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Sticky Frog" }], brandsOfCards: [], brandsBySlug: [{ id: "b5", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: O }] });
  ok(p[0]!.kind === "skip" && (p[0] as { why: string }).why.includes("another vendor"), "never steal");

  // two dups same slug -> second skipped; empty name skipped
  p = planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "Frog" }, { id: D2, display_name: "frog" }, { id: D3, display_name: "  " }], brandsOfCards: [], brandsBySlug: [] });
  ok(p.map((s) => s.kind).join(",") === "create,skip,skip", "dedupe + empty");
  ok(absorbSlugsToCheck([{ id: D1, display_name: "Frog" }, { id: D2, display_name: "frog" }, { id: D3, display_name: "" }]).join() === "frog", "slugs to check");

  // note
  const note = absorbNote(planBrandAbsorption({ survivorId: S, duplicates: [{ id: D1, display_name: "A1" }, { id: D2, display_name: "B1" }], brandsOfCards: [], brandsBySlug: [{ id: "x", display_name: "B1", slug: "b1", vendor_id: O }] }));
  ok(note.includes("Added as brand on the kept card: “A1”") && note.includes("“B1” (a brand called"), "note");
  ok(absorbNote([]) === "", "empty note");

  // picker ids + search
  ok(parsePickedIds(`${S},${S.toUpperCase()}, nope ,${D1}`).join() === `${S},${D1}`, "parse ids dedupe/validate");
  ok(parsePickedIds([S, D1, D2, D3, O, "00000000-0000-4000-8000-000000000010"]).length === MANUAL_MERGE_MAX_CARDS, "cap");
  ok(parsePickedIds(undefined).length === 0, "none");
  const vs = [
    { id: S, display_name: "Phat Panda", license_number: "412345", status: "published" },
    { id: D1, display_name: "Grow Op Farms (Phat Panda)", status: "draft" },
    { id: D2, display_name: "Panda Old", status: "archived" },
    { id: D3, display_name: "Other", website: "phatpanda.com", status: "draft" },
  ];
  const r = searchVendorsForMerge(vs, "phat panda");
  ok(r.map((v) => v.id).join() === `${S},${D1},${D3}`, "search words (website too) + prefix first, archived out");
  ok(searchVendorsForMerge(vs, "412345").length === 1, "search license");
  ok(searchVendorsForMerge(vs, "phatpanda").map((v) => v.id).join() === D3, "search website");
  ok(searchVendorsForMerge(vs, "phat", [S]).every((v) => v.id !== S), "exclude picked");
  ok(searchVendorsForMerge(vs, "  ").length === 0, "blank search");
  return { passed, failed };
}
