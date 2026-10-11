/**
 * src/lib/cms/design-move-core.ts — R41 S7 (hub preview "Move mode").
 *
 * PURE helpers behind the one server action that saves a drag made in the
 * Website Sync preview window. Kept out of the "use server" file (which may
 * only export async functions) so they are unit-testable:
 *
 *   • parseDesignOwner()   — "section:<uuid>" | "shop-slide:<uuid>" |
 *                            "specials:hero" | "specials:todays" | "loyalty:hero"
 *   • editorFor()          — where the owner presses Publish (link + label)
 *   • moveInSettings()     — page_sections settings JSON (settings.design)
 *   • moveInSpecialsJson() — specials presentation (heroDesign/todaysDealsDesign)
 *   • moveInLoyaltyJson()  — loyalty hero presentation (design)
 *   • moveInShopPresentation() — a Shop carousel slide presentation (design)
 *
 * Every mover starts from the DRAFT the caller passes in, applies the pure
 * `applyMove` from banner-design-core, and returns a typed result. Nothing
 * here touches the database; the server action does the IO + permission check.
 * A move NEVER publishes: the owner still presses Publish in the editor.
 */
import { applyMove, normalizeDesign, readDesign, writeDesign, type BannerDesign, type DesignMove } from "./banner-design-core";
import {
  normalizeSpecialsPresentation,
  parseSpecialsPresentation,
  serializeSpecialsPresentation,
} from "@/lib/specials/specials-presentation-core";
import {
  normalizeLoyaltyHeroPresentation,
  parseLoyaltyHeroPresentation,
  serializeLoyaltyHeroPresentation,
} from "@/lib/loyalty/loyalty-hero-core";
import { normalizeShopHeroPresentation, type ShopHeroPresentation } from "./shop-carousel-core";

export type DesignOwner =
  | { kind: "section"; id: string }
  | { kind: "shop-slide"; id: string }
  | { kind: "specials"; which: "hero" | "todays" }
  | { kind: "loyalty" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse an owner id. Unknown / malformed → null (the action refuses it). */
export function parseDesignOwner(owner: unknown): DesignOwner | null {
  if (typeof owner !== "string") return null;
  if (owner === "specials:hero") return { kind: "specials", which: "hero" };
  if (owner === "specials:todays") return { kind: "specials", which: "todays" };
  if (owner === "loyalty:hero") return { kind: "loyalty" };
  const m = /^(section|shop-slide):(.+)$/.exec(owner);
  if (m && UUID.test(m[2])) return { kind: m[1] as "section" | "shop-slide", id: m[2].toLowerCase() };
  return null;
}

/** Where the owner goes to Publish this banner. `pageSlug` only for sections. */
export function editorFor(owner: DesignOwner, pageSlug?: string | null): { href: string; label: string } {
  switch (owner.kind) {
    case "section":
      return pageSlug
        ? { href: `/admin/pages/${encodeURIComponent(pageSlug)}`, label: "the page editor" }
        : { href: "/admin/website-sync", label: "the page editor" };
    case "shop-slide":
      return { href: "/admin/content/shop-banner", label: "the Shop banner editor" };
    case "specials":
      return { href: "/admin/specials", label: "the Specials editor" };
    case "loyalty":
      return { href: "/admin/loyalty-page", label: "the Loyalty page editor" };
  }
}

export type MoveResult<T> = { ok: true; value: T } | { ok: false; message: string };

const OFF = "Custom design is turned off for this banner, so there is nothing to move. Turn it on in the editor first.";
const GONE = "That text box or button isn't in this banner's draft any more. Refresh the preview and try again.";

/** Apply a move to a design, refusing when design is off or the item is gone. */
export function moveDesign(design: BannerDesign | null, move: DesignMove): MoveResult<BannerDesign> {
  if (!design || !design.enabled) return { ok: false, message: OFF };
  const list = move.target === "box" ? design.boxes : design.buttons;
  if (!list.some((i) => i.id === move.id)) return { ok: false, message: GONE };
  return { ok: true, value: applyMove(design, move) };
}

/** page_sections: move inside settings.design (pass draft_settings ?? settings). */
export function moveInSettings(settings: unknown, move: DesignMove): MoveResult<Record<string, unknown>> {
  const r = moveDesign(readDesign(settings), move);
  if (!r.ok) return r;
  return { ok: true, value: writeDesign(settings, r.value) };
}

/** Specials presentation JSON (pass draft_value ?? published_value). */
export function moveInSpecialsJson(json: string | null | undefined, which: "hero" | "todays", move: DesignMove): MoveResult<string> {
  const pres = parseSpecialsPresentation(json) ?? normalizeSpecialsPresentation({});
  const key = which === "hero" ? "heroDesign" : "todaysDealsDesign";
  const r = moveDesign(pres[key], move);
  if (!r.ok) return r;
  return { ok: true, value: serializeSpecialsPresentation({ ...pres, [key]: r.value }) };
}

/** Loyalty hero presentation JSON (pass draft_value ?? published_value). */
export function moveInLoyaltyJson(json: string | null | undefined, move: DesignMove): MoveResult<string> {
  const pres = parseLoyaltyHeroPresentation(json) ?? normalizeLoyaltyHeroPresentation({});
  const r = moveDesign(pres.design ?? null, move);
  if (!r.ok) return r;
  return { ok: true, value: serializeLoyaltyHeroPresentation({ ...pres, design: r.value }) };
}

/** Shop slide presentation (pass draft_presentation ?? presentation). */
export function moveInShopPresentation(pres: unknown, move: DesignMove): MoveResult<ShopHeroPresentation> {
  const p = normalizeShopHeroPresentation(pres);
  const r = moveDesign(p.design ?? null, move);
  if (!r.ok) return r;
  return { ok: true, value: { ...p, design: r.value } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// ─────────────────────────────────────────────────────────────────────────────
export function __runDesignMoveCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`design-move-core: ${m}`);
    passed += 1;
  };
  const U = "123e4567-e89b-12d3-a456-426614174000";
  // owners
  ok(parseDesignOwner(`section:${U}`)?.kind === "section", "section owner");
  ok(parseDesignOwner(`shop-slide:${U}`)?.kind === "shop-slide", "shop owner");
  ok(parseDesignOwner(`section:${U.toUpperCase()}`)?.kind === "section", "uppercase uuid ok");
  ok((parseDesignOwner(`section:${U.toUpperCase()}`) as { id: string }).id === U, "uuid lower-cased");
  ok(JSON.stringify(parseDesignOwner("specials:hero")) === JSON.stringify({ kind: "specials", which: "hero" }), "specials hero");
  ok(JSON.stringify(parseDesignOwner("specials:todays")) === JSON.stringify({ kind: "specials", which: "todays" }), "specials todays");
  ok(parseDesignOwner("loyalty:hero")?.kind === "loyalty", "loyalty");
  ok(parseDesignOwner("section:abc") === null, "bad uuid");
  ok(parseDesignOwner("evil:hero") === null, "unknown owner");
  ok(parseDesignOwner(42) === null, "non-string");
  ok(parseDesignOwner(`section:${U}x`) === null, "trailing junk");
  // editors
  ok(editorFor({ kind: "section", id: U }, "vendors").href === "/admin/pages/vendors", "section editor link");
  ok(editorFor({ kind: "section", id: U }, null).href === "/admin/website-sync", "section fallback link");
  ok(editorFor({ kind: "shop-slide", id: U }).href === "/admin/content/shop-banner", "shop editor link");
  ok(editorFor({ kind: "specials", which: "hero" }).href === "/admin/specials", "specials editor link");
  ok(editorFor({ kind: "loyalty" }).href === "/admin/loyalty-page", "loyalty editor link");

  // a real enabled design with a headline box + a button
  const design = normalizeDesign({
    enabled: true,
    boxes: [{ id: "headline", role: "headline", x: 4, y: 30, w: 50, text: "Hi" }],
    buttons: [{ id: "go", label: "Go", href: "/menu", x: 4, y: 70 }],
  })!;
  ok(!!design && design.boxes.length === 1 && design.buttons.length === 1, "fixture design ok");
  const mv: DesignMove = { target: "box", id: "headline", x: 20, y: 40, device: "desktop" };

  const off = moveDesign({ ...design, enabled: false }, mv);
  ok(!off.ok && off.message.includes("turned off"), "design off refused");
  ok(!moveDesign(null, mv).ok, "no design refused");
  const gone = moveDesign(design, { ...mv, id: "nope" });
  ok(!gone.ok && gone.message.includes("isn't in this banner"), "unknown id refused");
  const goneBtn = moveDesign(design, { ...mv, target: "button", id: "headline" });
  ok(!goneBtn.ok, "box id as button refused");
  const moved = moveDesign(design, mv);
  ok(moved.ok && moved.value.boxes[0].x === 20 && moved.value.boxes[0].y === 40, "desktop move applied");
  const movedM = moveDesign(design, { ...mv, device: "mobile" });
  ok(movedM.ok && movedM.value.boxes[0].mx === 20 && movedM.value.boxes[0].x === 4, "phone move writes mx only");
  const movedB = moveDesign(design, { target: "button", id: "go", x: 60, y: 75, device: "desktop" });
  ok(movedB.ok && movedB.value.buttons[0].x === 60, "button move applied");

  // settings
  const st = moveInSettings({ lanes: "category", design }, mv);
  ok(st.ok && (st.value as { lanes: string }).lanes === "category", "settings keeps other keys");
  ok(st.ok && readDesign(st.value)!.boxes[0].x === 20, "settings design moved");
  ok(!moveInSettings({ lanes: "x" }, mv).ok, "settings without design refused");
  ok(!moveInSettings(null, mv).ok, "null settings refused");

  // specials
  const spJson = serializeSpecialsPresentation({ ...normalizeSpecialsPresentation({}), heroDesign: design });
  const sp = moveInSpecialsJson(spJson, "hero", mv);
  ok(sp.ok && parseSpecialsPresentation(sp.value)!.heroDesign!.boxes[0].x === 20, "specials hero moved");
  ok(sp.ok && parseSpecialsPresentation(sp.value)!.todaysDealsDesign === null, "specials todays untouched");
  ok(!moveInSpecialsJson(spJson, "todays", mv).ok, "specials todays without design refused");
  ok(!moveInSpecialsJson(null, "hero", mv).ok, "empty specials refused");

  // loyalty
  const lyJson = serializeLoyaltyHeroPresentation({ ...normalizeLoyaltyHeroPresentation({}), design });
  const ly = moveInLoyaltyJson(lyJson, mv);
  ok(ly.ok && parseLoyaltyHeroPresentation(ly.value)!.design!.boxes[0].x === 20, "loyalty moved");
  ok(ly.ok && parseLoyaltyHeroPresentation(ly.value)!.title.text === normalizeLoyaltyHeroPresentation({}).title.text, "loyalty words untouched");
  ok(!moveInLoyaltyJson(serializeLoyaltyHeroPresentation(normalizeLoyaltyHeroPresentation({})), mv).ok, "loyalty without design refused");

  // shop
  const sh = moveInShopPresentation({ design, title: { text: "Sale" } }, mv);
  ok(sh.ok && sh.value.design!.boxes[0].x === 20, "shop slide moved");
  ok(sh.ok && sh.value.title.text === "Sale", "shop words untouched");
  ok(!moveInShopPresentation({}, mv).ok, "shop without design refused");

  return { passed, failed: 0 };
}
