/**
 * studio-help-core — D234 slice C-6 (SOP-11b G-106 / G-107; F-11-31 /
 * F-11-30; Q-11-15 "I agree with your recommendation."). Pure.
 *
 * The words and rules behind the Banner Design Studio's help:
 *   - every key in one list (the "?" sheet replaces the long one-line guide);
 *   - one short line of help per tab and per main control (the tooltips);
 *   - the "Make a banner" step strip (picture → text → phone → check →
 *     publish) and when each step counts as done;
 *   - the dismissible "New here? 60-second tour" (re-opened from "?");
 *   - the Save-to-brand name dialog's rules (the server keeps 80 characters,
 *     `brand-actions.ts` saveBrandBannerAction).
 */
import { resolveBoxText, type BannerDesign } from "./banner-design-core";

export type Shortcut = { keys: string; what: string };

/** Every key the studio understands (StudioCanvas, ArrangeBar, BannerStudio). */
export const STUDIO_SHORTCUTS: readonly Shortcut[] = [
  { keys: "?", what: "Open this list of keys (and the 60-second tour)" },
  { keys: "Drag", what: "Move text, buttons and shapes" },
  { keys: "Double-click text", what: "Type on it (Enter = new line, Esc or click away to finish)" },
  { keys: "Green handle", what: "Drag to change how wide the text wraps" },
  { keys: "Gold knob", what: "Drag to rotate (hold Shift for 15° steps)" },
  { keys: "Arrow keys", what: "Nudge the selected item 0.5% (Shift = 5%)" },
  { keys: "Shift-click", what: "Select several, then drag them together or use Arrange" },
  { keys: "Alt (while dragging)", what: "Stop snapping" },
  { keys: "Ctrl/⌘ + C / V / D", what: "Copy, paste (into any banner), duplicate" },
  { keys: "Ctrl/⌘ + Z", what: "Undo (the last 60 steps)" },
  { keys: "Ctrl + Shift + Z or Ctrl + Y", what: "Redo" },
  { keys: "Delete", what: "Remove the selected item (asks first)" },
  { keys: "Esc", what: "Deselect, or close this list" },
  { keys: "🔒", what: "Locked items stay put" },
];

export type StudioTab = "text" | "buttons" | "shapes" | "anims" | "animate" | "smoke" | "layers" | "picture" | "checks";

/** One line per tab (the tab tooltips). */
export const TAB_HELP: Record<StudioTab, string> = {
  text: "Add and style the words: headline, subhead, body, badge, small print.",
  buttons: "Add up to a few buttons and pick where each one goes.",
  shapes: "Add shapes, lines and icons, for example a soft box behind text.",
  anims: "Add a Lottie or Rive animation from a file or link.",
  animate: "Make items slide or fade in, and set the banner's intro.",
  smoke: "Add drifting smoke or fog over the picture.",
  layers: "See everything on the banner, front to back; lock, hide or reorder.",
  picture: "Focus point, zoom, shade, banner height, and the picture shape that fits.",
  checks: "Problems the site would show: hard-to-read text, overlaps, text cut off at some width.",
};

/** One line for the main controls (tooltips). */
export const CONTROL_HELP = {
  desktop: "Lay out the computer version (1408 px wide). Use Banner width to see other widths.",
  mobile: "Lay out the phone version. Moves here change phones only.",
  ai: "AI looks at the picture and suggests the focus, where the text fits, the shade and the text colour. Nothing is saved until you press Save.",
  keys: "Every key, and the 60-second tour (or press ?).",
} as const;

export type StepId = "picture" | "text" | "phone" | "check" | "publish";
export type StepState = "done" | "todo";
export type MakeStep = { id: StepId; label: string; tip: string; state: StepState; detail?: string };

/** The tab each step opens (phone switches the layout; publish happens in the editor). */
export const STEP_TAB: Record<StepId, StudioTab | null> = { picture: "picture", text: "text", phone: null, check: "checks", publish: null };

/** True when any item has its own phone place or size (the owner worked on the phone layout). */
export function hasPhoneWork(design: BannerDesign): boolean {
  const moved = (x: { mx?: number | null; my?: number | null; mw?: number | null }) => x.mx != null || x.my != null || x.mw != null;
  return design.boxes.some((b) => moved(b) || b.hideOnMobile) || design.buttons.some(moved) || (design.elements ?? []).some((e) => moved(e) || e.hideOnMobile);
}

/**
 * "Make a banner": picture → text → phone → check → publish.
 * Publish is never "done" inside the studio: it happens in the editor after Save draft.
 */
export function makeBannerSteps(input: { design: BannerDesign; legacy?: { eyebrow?: string; title?: string; subtitle?: string }; imageSrc: string; seenPhone: boolean; warnCount: number }): MakeStep[] {
  const { design, legacy = {}, imageSrc, seenPhone, warnCount } = input;
  const hasText = design.boxes.some((b) => !b.hidden && resolveBoxText(b, legacy).trim().length > 0) || design.buttons.length > 0;
  const phone = seenPhone || hasPhoneWork(design);
  return [
    { id: "picture", label: "Picture", tip: "Pick the picture, set its focus point, and check Picture shape.", state: imageSrc ? "done" : "todo" },
    { id: "text", label: "Text", tip: "Add the headline and a button; drag them where they look good.", state: hasText ? "done" : "todo" },
    { id: "phone", label: "Phone", tip: "Switch to Phone and place each item for phones.", state: phone ? "done" : "todo" },
    {
      id: "check",
      label: "Check",
      tip: "Open Checks and fix what it lists; try the width stops.",
      state: hasText && warnCount === 0 ? "done" : "todo",
      detail: warnCount ? `${warnCount} to look at` : undefined,
    },
    { id: "publish", label: "Publish", tip: "Save draft, then Publish (or schedule) in this editor, below the studio.", state: "todo" },
  ];
}

/** The step to do next (the first one not done). */
export function nextStep(steps: MakeStep[]): StepId {
  return (steps.find((s) => s.state === "todo") ?? steps[steps.length - 1]).id;
}

export type TourStep = { title: string; text: string; go?: StepId };

/** The "60-second tour": six short cards, about ten seconds each. */
export const TOUR_STEPS: readonly TourStep[] = [
  { title: "1 · The canvas is the website", text: "The banner here is drawn with the website's own rules and fonts. What you place is where visitors see it." },
  { title: "2 · Picture first", text: "On Picture & shade, click the most important spot of the picture. Keep the subject inside the clear box; Picture shape tells you the best size.", go: "picture" },
  { title: "3 · Words and buttons", text: "On Text, add a headline (one per banner) and a button. Drag them; double-click to type. Ctrl/⌘+Z undoes anything.", go: "text" },
  { title: "4 · Phones are separate", text: "Press 📱 Phone and place each item again for phones. Moves there change phones only.", go: "phone" },
  { title: "5 · Checks at every width", text: "Checks lists text that is hard to read, overlaps or is cut off at some width. Try the Banner width stops to see them.", go: "check" },
  { title: "6 · Save, then publish", text: "Save draft keeps your work. Publish (or schedule) in the editor puts it live. Press ? any time for every key and this tour." },
];

/** localStorage key: the tour strip stays hidden once dismissed (re-open it from "?"). */
export const TOUR_DISMISSED_KEY = "gw-studio-tour-dismissed";
export function tourStripVisible(stored: string | null | undefined): boolean {
  return stored !== "1";
}

/** "?" opens the key sheet, unless the owner is typing or holding Ctrl/⌘/Alt. */
export function isHelpKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean): boolean {
  return e.key === "?" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** Same limit the server keeps (`brand-actions.ts`: trim, 80 characters). */
export const BRAND_NAME_MAX = 80;

/** A starting name for Save to brand: the headline's first line, else "Saved banner". */
export function suggestBrandName(design: BannerDesign, legacy: { eyebrow?: string; title?: string; subtitle?: string } = {}): string {
  const head = design.boxes.find((b) => b.role === "headline" && !b.hidden);
  const t = head ? resolveBoxText(head, legacy).split("\n")[0].trim() : "";
  return (t || "Saved banner").slice(0, BRAND_NAME_MAX);
}

/** null = fine; otherwise the message the dialog shows. */
export function brandNameError(name: string): string | null {
  const t = name.trim();
  if (!t) return "Type a name, so you can find it later (for example \"Friday 20% off - Nov\").";
  if (t.length > BRAND_NAME_MAX) return `Keep it to ${BRAND_NAME_MAX} characters or fewer.`;
  return null;
}

/** A gentle note when the name is already used (saving adds another, it does not replace). */
export function brandNameNote(name: string, existing: readonly { name: string }[] | null | undefined): string | null {
  const t = name.trim().toLowerCase();
  if (!t || !existing) return null;
  return existing.some((b) => b.name.trim().toLowerCase() === t) ? "A saved banner already has this name. Saving adds another one; it does not replace it." : null;
}

export function __runStudioHelpCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL studio-help-core: ${m}`);
    }
  };
  const box = (p: Partial<BannerDesign["boxes"][number]>) => ({ id: "h", role: "headline" as const, bind: null, text: "Friday deals\nsecond line", x: 4, y: 10, w: 50, mx: null, my: null, mw: null, align: "left" as const, font: "inter", size: 40, sizeMobile: 24, weight: 700, italic: false, underline: false, strike: false, transform: "none" as const, color: "#fff", opacity: 100, letterSpacing: 0, lineHeight: 1.2, shadow: "none" as const, outline: false, backdrop: "none" as const, backdropColor: "#000", backdropOpacity: 0, wrap: "normal" as const, hidden: false, hideOnMobile: false, ...p });
  const base = {
    v: 1,
    enabled: true,
    frame: { height: 260, heightMobile: 200, radius: 16 },
    image: { focusX: 50, focusY: 50, focusXMobile: null, focusYMobile: null, zoom: 100, brightness: 100, saturation: 100, blur: 0, flip: false },
    overlay: { kind: "none", color: "#000000", opacity: 0, direction: "left" },
    boxes: [],
    buttons: [],
  } as unknown as BannerDesign;
  const withText = { ...base, boxes: [box({})] } as BannerDesign;
  // shortcuts + tabs
  ok(STUDIO_SHORTCUTS.length >= 12 && STUDIO_SHORTCUTS[0].keys === "?", "shortcut list starts with ?");
  for (const k of ["Ctrl/⌘ + Z", "Arrow keys", "Delete", "Esc", "Alt (while dragging)"]) ok(STUDIO_SHORTCUTS.some((s) => s.keys === k), `shortcut ${k}`);
  ok(Object.keys(TAB_HELP).length === 9 && Object.values(TAB_HELP).every((t) => t.length > 10 && t.length < 120), "a short line for each of the nine tabs");
  // steps
  const s0 = makeBannerSteps({ design: base, imageSrc: "", seenPhone: false, warnCount: 0 });
  ok(s0.map((s) => s.id).join(">") === "picture>text>phone>check>publish", "five steps in order");
  ok(s0.every((s) => s.state === "todo") && nextStep(s0) === "picture", "empty banner: start with the picture");
  const s1 = makeBannerSteps({ design: withText, imageSrc: "/a.jpg", seenPhone: false, warnCount: 2 });
  ok(s1[0].state === "done" && s1[1].state === "done" && s1[2].state === "todo" && s1[3].state === "todo" && s1[3].detail === "2 to look at", "picture + text done; checks counted");
  ok(nextStep(s1) === "phone", "next = phone");
  const moved = { ...withText, boxes: [box({ my: 40 })] } as BannerDesign;
  ok(hasPhoneWork(moved) && !hasPhoneWork(withText) && makeBannerSteps({ design: moved, imageSrc: "/a.jpg", seenPhone: false, warnCount: 0 })[2].state === "done", "phone done by phone moves");
  const all = makeBannerSteps({ design: withText, imageSrc: "/a.jpg", seenPhone: true, warnCount: 0 });
  ok(all.slice(0, 4).every((s) => s.state === "done") && all[4].state === "todo" && nextStep(all) === "publish", "publish is the last step, never done in the studio");
  ok(makeBannerSteps({ design: base, imageSrc: "/a.jpg", seenPhone: true, warnCount: 0 })[3].state === "todo", "no text = nothing checked yet");
  ok(STEP_TAB.picture === "picture" && STEP_TAB.check === "checks" && STEP_TAB.phone === null, "steps open tabs");
  // tour
  ok(TOUR_STEPS.length === 6 && TOUR_STEPS.every((t) => t.text.split(/\s+/).length <= 40), "six short tour cards (about 60 seconds)");
  ok(tourStripVisible(null) && tourStripVisible(undefined) && !tourStripVisible("1"), "tour strip until dismissed");
  // ? key
  ok(isHelpKey({ key: "?" }, false) && !isHelpKey({ key: "?" }, true) && !isHelpKey({ key: "?", ctrlKey: true }, false) && !isHelpKey({ key: "/" }, false), "? key rules");
  // name dialog
  ok(suggestBrandName(withText) === "Friday deals" && suggestBrandName(base) === "Saved banner", "suggested name = headline's first line");
  ok(suggestBrandName({ ...withText, boxes: [box({ text: "x".repeat(120) })] } as BannerDesign).length === BRAND_NAME_MAX, "suggestion kept to 80");
  ok(brandNameError("  ") !== null && brandNameError("Friday 20% off - Nov") === null && brandNameError("y".repeat(81)) !== null, "name rules");
  ok(brandNameNote("friday DEALS", [{ name: "Friday deals" }])!.includes("adds another") && brandNameNote("New", [{ name: "Old" }]) === null && brandNameNote("x", null) === null, "duplicate-name note");
  return { passed, failed };
}
