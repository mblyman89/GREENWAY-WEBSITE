/**
 * D278 - "My garments": named garment setups the owner saves and loads on the
 * Merch Studio Garments tab (PURE, no I/O).
 *
 * Owner (verbatim): "I am not sure I have a way to save and load garments,
 * please build this in."
 *
 * A saved garment = a studio blank + the colour being previewed + the colours
 * ticked for the product. A Printful catalog item that is NOT a studio blank
 * yet can be saved too (printfulId only) - it is a shortlist entry that can't
 * be designed until it is added as a blank, and the UI says so.
 *
 * Stored on the server in site_settings `merch_saved_garments` (no migration),
 * so every computer signed in to the admin sees the same list.
 */
export const SAVED_GARMENTS_KEY = "merch_saved_garments";
export const MAX_SAVED_GARMENTS = 60;

export interface SavedGarment {
  id: string;
  name: string;
  /** Studio blank id (garment-catalog-core BLANKS); null = Printful shortlist only. */
  blankId: string | null;
  printfulId: number;
  colorHex: string;
  /** Colour names ticked for the product. */
  picked: string[];
  /** Printful catalog title/photo for shortlist entries (display only). */
  title?: string;
  image?: string;
  savedAt: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");
const HEX = /^#[0-9a-f]{6}$/;
const ID = /^[a-z0-9-]{1,40}$/;

/** One entry, cleaned; null when unusable. `known(blankId)` = is that a studio blank. */
export function cleanSavedGarment(v: unknown, known: (blankId: string) => boolean): SavedGarment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 40);
  const name = str(o.name, 80);
  const printfulId = typeof o.printfulId === "number" && Number.isInteger(o.printfulId) && o.printfulId > 0 ? o.printfulId : 0;
  const rawBlank = str(o.blankId, 40);
  const blankId = rawBlank && known(rawBlank) ? rawBlank : null;
  if (!ID.test(id) || !name || !printfulId) return null;
  if (rawBlank && !blankId) return null; // a blank that was removed from the studio
  const hex = str(o.colorHex, 7).toLowerCase();
  const picked = Array.isArray(o.picked) ? [...new Set(o.picked.map((p) => str(p, 40)).filter(Boolean))].slice(0, 120) : [];
  const image = str(o.image, 400);
  const savedAt = str(o.savedAt, 40);
  return {
    id, name, blankId, printfulId, colorHex: HEX.test(hex) ? hex : "", picked,
    ...(blankId ? {} : { title: str(o.title, 120) || name, ...(/^https:\/\//.test(image) ? { image } : {}) }),
    savedAt: Number.isFinite(Date.parse(savedAt)) ? savedAt : "",
  };
}

/** Accepts the stored `{ items: [...] }` or a bare array. Newest first, unique ids, capped. */
export function normalizeSavedGarments(raw: unknown, known: (blankId: string) => boolean): SavedGarment[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const seen = new Set<string>();
  const out: SavedGarment[] = [];
  for (const v of list) {
    const g = cleanSavedGarment(v, known);
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out.slice(0, MAX_SAVED_GARMENTS);
}

/** Add or replace (same id, or same name = overwrite), newest first. */
export function upsertSavedGarment(list: readonly SavedGarment[], g: SavedGarment): SavedGarment[] {
  const key = g.name.toLowerCase();
  return [g, ...list.filter((x) => x.id !== g.id && x.name.toLowerCase() !== key)].slice(0, MAX_SAVED_GARMENTS);
}

export function removeSavedGarment(list: readonly SavedGarment[], id: string): SavedGarment[] {
  return list.filter((x) => x.id !== id);
}

/** Default name for the save box. */
export function defaultGarmentName(brand: string, model: string, colorName: string): string {
  return `${brand} ${model}${colorName ? ` - ${colorName}` : ""}`.slice(0, 80);
}

export function __runSavedGarmentsTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL saved-garments-core:", m); } };
  const known = (id: string) => id === "cc-1717" || id === "yp-6089m";
  const a = { id: "g-1", name: "Hero tee black", blankId: "cc-1717", printfulId: 586, colorHex: "#1B1B1C", picked: ["Black", "Black", "White"], savedAt: "2026-11-25T00:00:00.000Z" };
  const c = cleanSavedGarment(a, known)!;
  ok(!!c && c.colorHex === "#1b1b1c" && c.picked.join() === "Black,White" && c.blankId === "cc-1717", "clean: hex lowercased, picks de-duplicated");
  ok(cleanSavedGarment({ ...a, blankId: "gone" }, known) === null, "removed blank dropped");
  ok(cleanSavedGarment({ ...a, name: "  " }, known) === null && cleanSavedGarment({ ...a, id: "BAD ID" }, known) === null && cleanSavedGarment({ ...a, printfulId: 0 }, known) === null, "needs id, name, printful id");
  const s = cleanSavedGarment({ id: "g-2", name: "Columbia idea", blankId: "", printfulId: 9999, title: "Some <b>jacket</b>", image: "javascript:x", savedAt: "x" }, known)!;
  ok(s.blankId === null && s.title === "Some bjacket/b" && !s.image && s.savedAt === "", "shortlist entry: markup + unsafe image stripped");
  ok(cleanSavedGarment({ ...a, name: "x".repeat(200) }, known)!.name.length === 80, "name capped");
  const n = normalizeSavedGarments({ items: [a, a, { junk: 1 }, s] }, known);
  ok(n.length === 2 && n[0].id === "g-1", "normalize: dupes + junk dropped, order kept");
  ok(normalizeSavedGarments([a], known).length === 1 && normalizeSavedGarments(null, known).length === 0, "bare array + null");
  const up = upsertSavedGarment(n, { ...c, id: "g-3", name: "HERO TEE BLACK" });
  ok(up.length === 2 && up[0].id === "g-3" && !up.some((x) => x.id === "g-1"), "same name overwrites, newest first");
  ok(removeSavedGarment(up, "g-3").length === 1, "remove");
  const many = Array.from({ length: 70 }, (_, i) => ({ ...a, id: `g-${i}`, name: `n${i}` }));
  ok(normalizeSavedGarments(many, known).length === MAX_SAVED_GARMENTS, "capped at 60");
  ok(defaultGarmentName("Comfort Colors", "1717", "Black") === "Comfort Colors 1717 - Black", "default name");
  return { passed, failed };
}
