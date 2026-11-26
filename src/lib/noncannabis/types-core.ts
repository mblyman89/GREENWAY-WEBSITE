/**
 * OI-ACC S3 - the Other Inventory type registry (pure). Rows live in
 * public.noncannabis_types (0371); both the Other Inventory page and the
 * Website -> Accessory Cards editor read and write them, so a type made on one
 * page shows up on the other. Remove = archive (owner: "archive it please").
 * When the table cannot be read (migration not applied yet) the built-in
 * list from naming/noncannabis-core is the fallback, flagged so staff see it.
 */
import { NONCANNABIS_TYPES } from "@/lib/naming/noncannabis-core";

export type NcMenuGroup = "accessories" | "merch";

export interface NcTypeRow {
  value: string;
  label: string;
  sku_prefix: string;
  menu_group: NcMenuGroup | string;
  sort: number;
  archived_at: string | null;
  draft_label: string;
  draft_text: string;
  draft_image: string;
  card_label: string;
  card_text: string;
  card_image: string;
  card_published_at: string | null;
}

export const NC_TYPE_COLUMNS =
  "value, label, sku_prefix, menu_group, sort, archived_at, draft_label, draft_text, draft_image, card_label, card_text, card_image, card_published_at";

export const NC_TYPE_LIMITS = { label: 40, cardLabel: 40, cardText: 400, image: 500 } as const;

/** Built-in fallback rows (same values + prefixes as before 0371). */
export function builtinTypeRows(): NcTypeRow[] {
  return NONCANNABIS_TYPES.map((t, i) => ({
    value: t.value,
    label: t.label,
    sku_prefix: t.prefix,
    menu_group: t.value === "apparel" ? "merch" : "accessories",
    sort: (i + 1) * 10,
    archived_at: null,
    draft_label: t.label,
    draft_text: "",
    draft_image: "",
    card_label: t.label,
    card_text: "",
    card_image: "",
    card_published_at: null,
  }));
}

// eslint-disable-next-line no-control-regex -- refusing control characters
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** A clean display label: any printable character, collapsed spaces, <= 40. */
export function cleanTypeLabel(raw: unknown): string {
  return String(raw ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, NC_TYPE_LIMITS.label);
}

/** Stable slug for a new type ("Bowl / Slide" -> "bowl_slide"). */
export function typeValueFromLabel(label: string): string {
  const s = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return s || "type";
}

/** Unique 2-5 char SKU prefix from the label, not already taken. */
export function uniqueSkuPrefix(label: string, taken: ReadonlySet<string>): string {
  const letters = label.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = (letters || "TYPE").slice(0, 4).padEnd(2, "X");
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const cand = (base.slice(0, Math.max(2, 5 - suffix.length)) + suffix).slice(0, 5);
    if (!taken.has(cand)) return cand;
  }
  return "MISC";
}

export type NewTypePlan = { ok: true; row: Pick<NcTypeRow, "value" | "label" | "sku_prefix" | "menu_group" | "sort"> } | { ok: false; error: string };

/** Plan a new type from a label against the existing rows (archived included). */
export function planNewType(rawLabel: unknown, existing: readonly NcTypeRow[]): NewTypePlan {
  const label = cleanTypeLabel(rawLabel);
  if (!label) return { ok: false, error: "Type name is required." };
  const same = existing.find((r) => r.label.toLowerCase() === label.toLowerCase());
  if (same) {
    return same.archived_at
      ? { ok: false, error: `"${same.label}" exists but is archived - press Restore on it instead.` }
      : { ok: false, error: `"${same.label}" already exists.` };
  }
  const values = new Set(existing.map((r) => r.value));
  let value = typeValueFromLabel(label);
  if (values.has(value)) {
    let n = 2;
    while (values.has(`${value.slice(0, 36)}_${n}`)) n++;
    value = `${value.slice(0, 36)}_${n}`;
  }
  const sku_prefix = uniqueSkuPrefix(label, new Set(existing.map((r) => r.sku_prefix)));
  const sort = Math.max(0, ...existing.filter((r) => r.menu_group !== "merch" && r.value !== "other").map((r) => r.sort)) + 10;
  return { ok: true, row: { value, label, sku_prefix, menu_group: "accessories", sort } };
}

/** Live (not archived) rows in display order. */
export function liveTypes(rows: readonly NcTypeRow[]): NcTypeRow[] {
  return rows.filter((r) => !r.archived_at).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

/** Picker options; keeps a product's current (maybe archived) type visible. */
export function typeOptions(rows: readonly NcTypeRow[], keep?: string | null): { value: string; label: string }[] {
  const live = liveTypes(rows).map((r) => ({ value: r.value, label: r.label }));
  if (keep && !live.some((o) => o.value === keep)) {
    const r = rows.find((x) => x.value === keep);
    live.push({ value: keep, label: r ? `${r.label} (archived)` : keep });
  }
  return live;
}

export function typeRowByValue(rows: readonly NcTypeRow[], value: string | null | undefined): NcTypeRow | undefined {
  const v = (value ?? "").trim().toLowerCase();
  return rows.find((r) => r.value === v);
}

/** Tax / menu side of a type: the registry decides, apparel stays merch. */
export function menuGroupOf(rows: readonly NcTypeRow[], value: string | null | undefined): NcMenuGroup {
  const r = typeRowByValue(rows, value);
  if (r) return r.menu_group === "merch" ? "merch" : "accessories";
  return (value ?? "").trim().toLowerCase() === "apparel" ? "merch" : "accessories";
}

/** Normalize the editor's card fields. */
export function cleanCardFields(raw: { label?: unknown; text?: unknown; image?: unknown }): { label: string; text: string; image: string } {
  const text = String(raw.text ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, NC_TYPE_LIMITS.cardText);
  const image = String(raw.image ?? "").trim().slice(0, NC_TYPE_LIMITS.image);
  const safeImage = /^(https:\/\/|\/(?!\/))[^\s"'<>]*$/.test(image) ? image : "";
  return { label: cleanTypeLabel(raw.label).slice(0, NC_TYPE_LIMITS.cardLabel), text, image: safeImage };
}

export function __runNcTypesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`FAIL nc-types-core: ${m}`);
    }
  };
  const rows = builtinTypeRows();
  ok(rows.length === NONCANNABIS_TYPES.length, "fallback = built-ins");
  ok(menuGroupOf(rows, "apparel") === "merch" && menuGroupOf(rows, "bong") === "accessories", "groups");
  ok(menuGroupOf([], "apparel") === "merch", "apparel merch without registry");
  ok(typeValueFromLabel("Bowl / Slide") === "bowl_slide", "slug");
  ok(typeValueFromLabel("Café Jars!") === "cafe_jars", "slug accents");
  const p = planNewType("Hemp Wick", rows);
  ok(p.ok && p.row.value === "hemp_wick" && /^[A-Z0-9]{2,5}$/.test(p.row.sku_prefix), "new type");
  ok(!planNewType("bong", rows).ok, "duplicate label refused");
  ok(!planNewType("  ", rows).ok, "empty refused");
  const archived = rows.map((r) => (r.value === "torch" ? { ...r, archived_at: "2026-01-01" } : r));
  const a = planNewType("Torch", archived);
  ok(!a.ok && a.error.includes("Restore"), "archived -> restore hint");
  ok(!typeOptions(archived).some((o) => o.value === "torch"), "archived hidden from picker");
  ok(typeOptions(archived, "torch").some((o) => o.value === "torch"), "current archived kept");
  const taken = new Set(rows.map((r) => r.sku_prefix));
  ok(!taken.has(uniqueSkuPrefix("Bong", taken)), "prefix unique");
  ok(cleanCardFields({ image: "javascript:alert(1)" }).image === "", "unsafe image dropped");
  ok(cleanCardFields({ image: "/accessories/bongs.webp" }).image === "/accessories/bongs.webp", "local image kept");
  ok(cleanTypeLabel("A/B & C #1") === "A/B & C #1", "any printable char in label");
  return { passed, failed };
}
