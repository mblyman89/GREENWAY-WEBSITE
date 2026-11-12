/**
 * ad-check-core — D234 slice C-8 (SOP-11b G-104, G-105; F-11-28, F-11-29). Pure.
 *
 * G-105, owner Q-11-14 "warn with tick": the words in a banner (its text
 * boxes, buttons and classic fields) and in an AI prompt are checked against
 * the Washington advertising rules (WAC 314-55-155, the bans in
 * `campaign-rules-core.ts` UNIVERSAL_CONTENT_BANS). It only WARNS; it never
 * blocks. A picture cannot be read by a word list, so Publish and Schedule
 * wait for one short tick: "I checked the picture for minors appeal".
 *
 * The word lists are NOT copied: they are the site-wide scan in
 * `src/lib/ai/compliance-patterns.json` (the same file the AI copy scan and
 * the crawler use). Every "block" pattern is shown as "breaks a rule"; the
 * "borderline therapeutic" and "empty hype" warn patterns as "check this".
 * The "price/discount mention" pattern is left out on purpose: prices and
 * sales are allowed on banners (the Specials and Shop sale banners are made
 * for them), so it would warn on every sale banner.
 *
 * G-104: "Use in a banner" from the Creative Studio. `BANNER_TARGETS` is the
 * list of banner editors a picture can be sent to; the editor link carries
 * `?useImage=<url>` and the card the owner picks shows "Use the Creative
 * Studio picture". `studioSizeFor` turns the banner's real picture shape
 * (`picture-shape-core.ts`, C-5) into a FLUX size for "Make one for this
 * banner".
 */
import patternsJson from "@/lib/ai/compliance-patterns.json";
import { UNIVERSAL_CONTENT_BANS } from "@/lib/marketing/campaign-rules-core";
import { resolveBoxText, type BannerDesign } from "@/lib/cms/banner-design-core";

// ── G-105: the advertising-rule word check ────────────────────────────────

type RawPattern = { pattern: string; flags?: string; label: string; severity: "block" | "warn" };

/** Left out of the banner check: prices and sales are allowed on banners. */
export const AD_CHECK_SKIPPED_LABELS: readonly string[] = ["price/discount mention"];

export type AdRule = { label: string; kind: "rule" | "review"; re: RegExp };

export const AD_RULES: readonly AdRule[] = (patternsJson as { patterns: RawPattern[] }).patterns
  .filter((p) => !AD_CHECK_SKIPPED_LABELS.includes(p.label))
  .map((p) => ({
    label: p.label,
    kind: p.severity === "block" ? ("rule" as const) : ("review" as const),
    re: new RegExp(p.pattern, `${(p.flags ?? "").replace(/g/g, "")}g`),
  }));

export type AdFinding = {
  /** "rule" = can break WAC 314-55-155; "review" = worth a second look. */
  kind: "rule" | "review";
  label: string;
  /** The words found, as typed (lower-cased, de-duplicated). */
  found: string;
};

/** Every rule hit in the given texts (one finding per label + word). */
export function checkAdText(texts: readonly (string | null | undefined)[]): AdFinding[] {
  const out: AdFinding[] = [];
  const seen = new Set<string>();
  const all = texts.map((t) => String(t ?? "")).filter((t) => t.trim() !== "");
  for (const rule of AD_RULES) {
    for (const t of all) {
      for (const m of t.matchAll(rule.re)) {
        const found = m[0].trim().toLowerCase();
        if (!found) continue;
        const k = `${rule.label}|${found}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ kind: rule.kind, label: rule.label, found });
      }
    }
  }
  // Rule breaks first, then the "check this" ones.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "rule" ? -1 : 1));
}

/** One line per finding, for a warning list. */
export function adFindingMessage(f: AdFinding): string {
  return f.kind === "rule"
    ? `"${f.found}": ${f.label}. Washington cannabis ads may not say this (WAC 314-55-155).`
    : `"${f.found}": ${f.label}. Check this is not a health claim or a misleading claim.`;
}

/** The words a banner shows: visible text boxes, visible buttons, plus extra fields. */
export function designTexts(
  design: BannerDesign | null | undefined,
  legacy: { eyebrow?: string; title?: string; subtitle?: string } = {},
): string[] {
  const out: string[] = [];
  if (design?.enabled) {
    for (const b of design.boxes) if (!b.hidden) out.push(resolveBoxText(b, legacy));
    for (const b of design.buttons) out.push(b.label);
  } else {
    out.push(legacy.eyebrow ?? "", legacy.title ?? "", legacy.subtitle ?? "");
  }
  return out.filter((t) => t.trim() !== "");
}

/** Warnings for a FLUX prompt (added to the prompt box's ⚠ list). */
export function adPromptWarnings(prompt: string): string[] {
  return checkAdText([prompt]).map((f) =>
    f.kind === "rule"
      ? `Advertising check: "${f.found}" (${f.label}). A picture made from this may not be usable on the website or in ads (WAC 314-55-155).`
      : `Advertising check: "${f.found}" (${f.label}). Fine for a picture, but keep it out of the banner words.`,
  );
}

/** The tick before Publish or Schedule (owner Q-11-14). */
export const PICTURE_TICK_LABEL = "I checked the picture for minors appeal";
/** The ban it checks, word for word from campaign-rules-core.ts. */
export const PICTURE_TICK_RULE: string = UNIVERSAL_CONTENT_BANS.find((b) => b.startsWith("Anything appealing to minors")) ?? "";
export const PICTURE_TICK_HELP =
  "No cartoons, toys, movie characters, candy or kid comparisons, youthful slang, and nobody who looks under 21. The word check above cannot see the picture.";
/** The schedule forms send this field; the server checks it for "Go live". */
export const PICTURE_TICK_FIELD = "picture_checked";
/** The message when a banner is scheduled to go live without the tick. */
export const PICTURE_TICK_ERROR = `Tick "${PICTURE_TICK_LABEL}" first. A banner can only be scheduled to go live after you have looked at its picture.`;

/** Schedule targets that show a picture: banners (FAQ questions and page wording do not). */
export function needsPictureTick(kind: unknown, key: unknown): boolean {
  if (kind === "carousel_slide" || kind === "shop_slide" || kind === "page_section") return true;
  return kind === "content_block" && typeof key === "string" && key.endsWith(".presentation");
}

/** Server side: may this schedule go ahead? ("Come down" needs no picture check.) */
export function pictureTickOk(kind: unknown, key: unknown, action: unknown, value: unknown): boolean {
  return action !== "publish" || !needsPictureTick(kind, key) || value === "1";
}

// ── G-104: Use in a banner ────────────────────────────────────────────────

export type BannerTarget = {
  id: string;
  /** What the owner sees in the picker. */
  label: string;
  /** The editor (no query); `useImage` is added to it. */
  href: string;
  /** Extra query the editor needs to open the right tab. */
  query?: string;
};

/** Every banner editor with a "Use the Creative Studio picture" button. */
export const BANNER_TARGETS: readonly BannerTarget[] = [
  { id: "shop", label: "Shop banner (pick the slide)", href: "/admin/content/shop-banner" },
  { id: "home-main", label: "Home: main banner (pick the slide)", href: "/admin/pages/home", query: "tab=carousel" },
  { id: "home-types", label: "Home: Types banner", href: "/admin/pages/home", query: "tab=types" },
  { id: "home-brands", label: "Home: Brands banner", href: "/admin/pages/home", query: "tab=brands" },
  { id: "home-more", label: "Home: more banners", href: "/admin/pages/home", query: "tab=more" },
  { id: "loyalty", label: "Loyalty: top banner", href: "/admin/loyalty-page", query: "tab=banner" },
  { id: "specials-hero", label: "Specials: top hero", href: "/admin/specials", query: "tab=hero" },
  { id: "specials-banner", label: "Specials: Today's Deal banner", href: "/admin/specials", query: "tab=banner" },
  { id: "vendors-grow", label: "Vendors: top banner", href: "/admin/pages/vendors", query: "tab=grow" },
  { id: "vendors-brands", label: "Vendors: Brands banner", href: "/admin/pages/vendors", query: "tab=brands" },
  { id: "vendors-more", label: "Vendors: more banners", href: "/admin/pages/vendors", query: "tab=more" },
  { id: "about", label: "About: banners", href: "/admin/pages/about" },
  { id: "faq", label: "FAQ: banners", href: "/admin/pages/faq" },
  { id: "locations", label: "Locations: banners", href: "/admin/pages/locations" },
  { id: "price-match", label: "Price Match: banners", href: "/admin/pages/price-match" },
];

export function bannerTargetById(id: string | null | undefined): BannerTarget | null {
  return BANNER_TARGETS.find((t) => t.id === id) ?? null;
}

const SECTION_TARGET: Record<string, string> = {
  "home.category": "home-types",
  "home.brand": "home-brands",
  "vendors.grow": "vendors-grow",
  "vendors.brands": "vendors-brands",
};

/** The target id of a page-builder section (its page and tab). */
export function sectionTargetId(pageSlug: string, sectionKey: string): string {
  const fixed = SECTION_TARGET[sectionKey];
  if (fixed) return fixed;
  if (pageSlug === "home") return "home-more";
  if (pageSlug === "vendors") return "vendors-more";
  return bannerTargetById(pageSlug) ? pageSlug : "home-more";
}

/** The query key the editors read. */
export const USE_IMAGE_PARAM = "useImage";

/** A picture address that is safe to put in a banner (https or a site path), else null. */
export function cleanUseImage(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 1000) return null;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s"'<>]*$/.test(v)) return v;
  return null;
}

/** The editor link for a picture; `anchor` (e.g. "slide-<id>") scrolls to that card. */
export function bannerLinkFor(target: BannerTarget, imageUrl: string, anchor?: string | null): string | null {
  const url = cleanUseImage(imageUrl);
  if (!url) return null;
  const q = [target.query, `${USE_IMAGE_PARAM}=${encodeURIComponent(url)}`].filter(Boolean).join("&");
  const a = anchor && /^[a-z0-9-]{1,80}$/i.test(anchor) ? `#${anchor}` : "";
  return `${target.href}?${q}${a}`;
}

/** FLUX max is ~4 MP and 64 px per side; sizes in steps of 16 (BFL tip). */
const MAX_PX = 4_194_304;

/** A FLUX size for a banner's picture shape (keeps the shape; fits 4 MP). */
export function studioSizeFor(w: number, h: number): { w: number; h: number } | null {
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return null;
  const ratio = w / h;
  if (ratio > 8 || ratio < 1 / 8) return null;
  let W = w;
  let H = h;
  if (W * H > MAX_PX) {
    const k = Math.sqrt(MAX_PX / (W * H));
    W *= k;
    H *= k;
  }
  const r16 = (n: number) => Math.max(64, Math.floor(n / 16) * 16);
  return { w: r16(W), h: r16(H) };
}

/** The Creative Studio link "Make one for this banner" (size + where to send it back). */
export function makeForBannerHref(targetId: string, size: { w: number; h: number } | null, anchor?: string | null): string {
  const s = size ? studioSizeFor(size.w, size.h) : null;
  const parts = [`for=${encodeURIComponent(targetId)}`];
  if (s) parts.push(`w=${s.w}`, `h=${s.h}`);
  if (anchor && /^[a-z0-9-]{1,80}$/i.test(anchor)) parts.push(`slot=${encodeURIComponent(anchor)}`);
  return `/admin/marketing/midjourney?${parts.join("&")}`;
}

/** Reads the Creative Studio query back (size to start with, where to send it). */
export function readStudioQuery(get: (k: string) => string | null): { size: { w: number; h: number } | null; target: BannerTarget | null; slot: string | null } {
  const w = Number(get("w"));
  const h = Number(get("h"));
  const slot = get("slot");
  return {
    size: w && h ? studioSizeFor(w, h) : null,
    target: bannerTargetById(get("for")),
    slot: slot && /^[a-z0-9-]{1,80}$/i.test(slot) ? slot : null,
  };
}

// ── Self-test ─────────────────────────────────────────────────────────────

export function __runAdCheckCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ ad-check-core: ${name}`);
    }
  };
  const rawCount = (patternsJson as { patterns: RawPattern[] }).patterns.length;
  ok(AD_RULES.length === rawCount - 1, "every pattern except price/discount is used");
  ok(AD_RULES.every((r) => r.re.flags.includes("g") && r.re.flags.includes("i")), "rules are global + case-insensitive");
  const kid = checkAdText(["Candy-sweet gummies the kids will love"]);
  ok(kid.some((f) => f.kind === "rule" && f.label === "appeal-to-minors language" && f.found === "candy"), "candy -> minors rule");
  ok(kid.some((f) => f.found === "kids"), "kids found too");
  ok(checkAdText(["Cures your anxiety"]).some((f) => f.kind === "rule" && f.label.startsWith("medical claim")), "cure -> medical claim");
  ok(checkAdText(["Best flower in town"]).some((f) => f.kind === "review" && f.found === "best"), "best -> review");
  ok(checkAdText(["20% off sale, $5 deal"]).length === 0, "prices and sales are not flagged");
  ok(checkAdText(["Fresh Friday drops", "", null, undefined]).length === 0, "clean words, no findings");
  const twice = checkAdText(["kids", "KIDS"]);
  ok(twice.filter((f) => f.found === "kids").length === 1, "one finding per word");
  const order = checkAdText(["best", "cure"]);
  ok(order[0].kind === "rule" && order[order.length - 1].kind === "review", "rule breaks listed first");
  ok(adFindingMessage(kid[0]).includes("WAC 314-55-155"), "message cites the rule");
  ok(adPromptWarnings("a cartoon mascot holding a joint").length >= 1, "prompt: cartoon/mascot warned");
  ok(adPromptWarnings("moody product photo on oak, soft light").length === 0, "prompt: clean");
  ok(PICTURE_TICK_RULE.includes("depicting anyone under 21"), "tick rule is the minors ban, word for word");
  ok(pictureTickOk("shop_slide", "a", "unpublish", null) && pictureTickOk("shop_slide", "a", "publish", "1") && !pictureTickOk("shop_slide", "a", "publish", null), "tick needed only to go live");
  ok(pictureTickOk("faq_item", "a", "publish", null) && !pictureTickOk("content_block", "loyalty.hero.presentation", "publish", null) && pictureTickOk("content_block", "home.hero.title", "publish", null), "only banners need the tick");
  ok(designTexts(null, { title: "Hi", subtitle: "" }).join("|") === "Hi", "no design -> classic fields");
  const d = {
    enabled: true,
    boxes: [
      { bind: "title", text: "", hidden: false },
      { bind: null, text: "Own words", hidden: false },
      { bind: null, text: "Hidden kids", hidden: true },
    ],
    buttons: [{ label: "Shop now", hidden: false }],
  } as unknown as BannerDesign;
  ok(designTexts(d, { title: "Bound title" }).join("|") === "Bound title|Own words|Shop now", "design: visible boxes + buttons; hidden skipped");
  ok(cleanUseImage("https://x.supabase.co/a.jpg") === "https://x.supabase.co/a.jpg" && cleanUseImage("/home/a.webp") === "/home/a.webp", "https + site path ok");
  ok(cleanUseImage("javascript:alert(1)") === null && cleanUseImage("//evil.com/a") === null && cleanUseImage("http://a/b") === null, "unsafe addresses refused");
  const shop = bannerTargetById("shop")!;
  ok(bannerLinkFor(shop, "https://x/a b.jpg", "slide-1") === null, "spaces refused");
  ok(bannerLinkFor(shop, "https://x/a.jpg", "slide-1") === "/admin/content/shop-banner?useImage=https%3A%2F%2Fx%2Fa.jpg#slide-1", "shop link + anchor");
  ok(bannerLinkFor(bannerTargetById("specials-banner")!, "/a.jpg") === "/admin/specials?tab=banner&useImage=%2Fa.jpg", "tab kept");
  ok(new Set(BANNER_TARGETS.map((t) => t.id)).size === BANNER_TARGETS.length, "target ids unique");
  ok(sectionTargetId("home", "home.brand") === "home-brands" && sectionTargetId("home", "home.x") === "home-more" && sectionTargetId("faq", "faq.top") === "faq" && sectionTargetId("vendors", "vendors.z") === "vendors-more", "section -> its page and tab");
  const big = studioSizeFor(2400, 1234)!;
  ok(big.w === 2400 && big.h === 1232, "2400x1234 -> 2400x1232 (16 px steps)");
  const huge = studioSizeFor(4000, 2000)!;
  ok(huge.w * huge.h <= MAX_PX && Math.abs(huge.w / huge.h - 2) < 0.05, "scaled under 4 MP, shape kept");
  ok(studioSizeFor(100, 1) === null && studioSizeFor(0, 5) === null, "silly shapes refused");
  ok(makeForBannerHref("shop", { w: 2400, h: 1234 }, "slide-9") === "/admin/marketing/midjourney?for=shop&w=2400&h=1232&slot=slide-9", "make link");
  const q = new URLSearchParams("for=loyalty&w=2400&h=420&slot=bad%20slot");
  const r = readStudioQuery((k) => q.get(k));
  ok(r.target?.id === "loyalty" && r.size?.w === 2400 && r.size.h === 416 && r.slot === null, "query read back; bad slot dropped");
  return { passed, failed };
}
