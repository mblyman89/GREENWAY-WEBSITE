/**
 * src/lib/marketing/midjourney-core.ts
 *
 * PURE Midjourney prompt-assembly logic (no server-only imports → tsx-testable).
 *
 * We do NOT call Midjourney. This module turns a structured creative brief into
 * a syntactically-correct Midjourney prompt string the marketing team can paste
 * into Midjourney, plus validated parameter values.
 *
 * Source: docs.midjourney.com Parameter List (V7 / V8.1 era) + MJ prompt-
 * structure guidance.
 *
 * Prompt structure that works:
 *   [subject + description] , [environment] , [composition/shot] , [lighting] ,
 *   [style/medium] , [color/mood] [--parameters]
 *
 * Hard syntax rules:
 *   • Parameters go at the END.
 *   • Exactly ONE space before each `--`.
 *   • NO punctuation inside parameter values.
 *   • Never place prompt text after parameters.
 */

export type AspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "4:5" | "9:16";

export const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1 Square (social)" },
  { value: "4:5", label: "4:5 Portrait (Instagram)" },
  { value: "9:16", label: "9:16 Vertical (story/reel)" },
  { value: "2:3", label: "2:3 Portrait (poster)" },
  { value: "3:2", label: "3:2 Landscape" },
  { value: "16:9", label: "16:9 Widescreen (web hero)" },
];

export type CreativeBrief = {
  /** The main subject, lead with this. */
  subject: string;
  /** Environment / context / setting. */
  environment?: string;
  /** Composition / shot (e.g. "close-up product hero shot"). */
  composition?: string;
  /** Lighting (e.g. "soft studio lighting"). */
  lighting?: string;
  /** Style / medium (e.g. "premium editorial photography"). */
  style?: string;
  /** Color / mood (e.g. "warm earthy palette, calm premium mood"). */
  colorMood?: string;
  /** Things to exclude (→ --no). */
  exclude?: string;
  /** Parameters. */
  aspectRatio?: AspectRatio;
  /** Model version number (e.g. 7 → --v 7). */
  version?: number;
  /** Use --niji instead of --v. */
  niji?: boolean;
  /** Raw mode. */
  raw?: boolean;
  /** Stylize 0..1000. */
  stylize?: number;
  /** Chaos 0..100. */
  chaos?: number;
  /** Weird 0..3000. */
  weird?: number;
  /** Optional style-reference image URL (→ --sref). */
  srefUrl?: string;
  /** Style weight for --sref (0..1000). */
  styleWeight?: number;
  /** Optional Omni-Reference image URL (→ --oref, person/object likeness). */
  orefUrl?: string;
  /** Seamless tile. */
  tile?: boolean;
  /** Reproducibility seed. */
  seed?: number;
};

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

/** Strip commas/double-dashes from a free-text concept group (keeps it a single group). */
function cleanGroup(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/--/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parameter values may contain NO punctuation. Collapse whitespace and strip
 * commas / double-dashes / trailing punctuation.
 */
function cleanParamText(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/--/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Clean a URL for use in --sref/--oref (no spaces; drop anything sketchy). */
function cleanUrl(s: string | undefined | null): string {
  const u = (s ?? "").trim();
  if (!u) return "";
  if (!/^https?:\/\/\S+$/i.test(u)) return "";
  return u;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type AssembledPrompt = {
  prompt: string;
  /** The concept text (before parameters). */
  conceptText: string;
  /** The parameter string (after the concept). */
  paramText: string;
  warnings: string[];
};

/** Build the final Midjourney prompt string from a brief. */
export function assemblePrompt(brief: CreativeBrief): AssembledPrompt {
  const warnings: string[] = [];

  // 1) Concept groups, comma-separated, in the recommended order.
  const groups = [
    cleanGroup(brief.subject),
    cleanGroup(brief.environment),
    cleanGroup(brief.composition),
    cleanGroup(brief.lighting),
    cleanGroup(brief.style),
    cleanGroup(brief.colorMood),
  ].filter((g) => g.length > 0);

  if (groups.length === 0) warnings.push("Add at least a subject.");
  const conceptText = groups.join(", ");

  // 2) Parameters — always at the very end, one space before each --.
  const params: string[] = [];

  if (brief.aspectRatio) params.push(`--ar ${brief.aspectRatio}`);

  if (brief.niji) {
    params.push("--niji");
  } else if (brief.version && brief.version > 0) {
    params.push(`--v ${brief.version}`);
  }

  if (brief.raw) params.push("--style raw");

  if (brief.stylize !== undefined && brief.stylize !== null) {
    const s = clamp(brief.stylize, 0, 1000);
    params.push(`--stylize ${s}`);
  }
  if (brief.chaos !== undefined && brief.chaos !== null && brief.chaos > 0) {
    params.push(`--chaos ${clamp(brief.chaos, 0, 100)}`);
  }
  if (brief.weird !== undefined && brief.weird !== null && brief.weird > 0) {
    params.push(`--weird ${clamp(brief.weird, 0, 3000)}`);
  }

  const exclude = cleanParamText(brief.exclude);
  if (exclude) params.push(`--no ${exclude}`);

  const sref = cleanUrl(brief.srefUrl);
  if (sref) {
    params.push(`--sref ${sref}`);
    if (brief.styleWeight !== undefined && brief.styleWeight !== null) {
      params.push(`--sw ${clamp(brief.styleWeight, 0, 1000)}`);
    }
  } else if (brief.srefUrl) {
    warnings.push("Style-reference URL is not a valid http(s) URL; it was skipped.");
  }

  const oref = cleanUrl(brief.orefUrl);
  if (oref) params.push(`--oref ${oref}`);
  else if (brief.orefUrl) warnings.push("Omni-reference URL is not a valid http(s) URL; it was skipped.");

  if (brief.tile) params.push("--tile");
  if (brief.seed !== undefined && brief.seed !== null && Number.isFinite(brief.seed)) {
    params.push(`--seed ${clamp(brief.seed, 0, 4294967295)}`);
  }

  const paramText = params.join(" ");
  const prompt = paramText ? `${conceptText} ${paramText}` : conceptText;

  return { prompt, conceptText, paramText, warnings };
}

// ---------------------------------------------------------------------------
// Curated presets for cannabis-retail marketing
// ---------------------------------------------------------------------------

export type Preset = {
  id: string;
  label: string;
  description: string;
  brief: Partial<CreativeBrief>;
};

export const PRESETS: Preset[] = [
  {
    id: "product-hero",
    label: "Product hero",
    description: "Clean studio shot of a single product for the menu or a feature banner.",
    brief: {
      composition: "centered close-up product hero shot, shallow depth of field",
      lighting: "soft diffused studio lighting, subtle rim light",
      style: "premium editorial product photography, ultra sharp, high detail",
      colorMood: "clean neutral background, warm premium mood",
      aspectRatio: "1:1",
      version: 7,
      stylize: 150,
    },
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    description: "Aspirational lifestyle scene (adults 21+) for social and web.",
    brief: {
      environment: "relaxed modern living space, natural setting",
      composition: "candid lifestyle shot, natural framing",
      lighting: "golden hour natural light, soft shadows",
      style: "authentic lifestyle photography, film grain",
      colorMood: "warm earthy palette, calm inviting mood",
      aspectRatio: "4:5",
      version: 7,
      stylize: 250,
    },
  },
  {
    id: "menu-banner",
    label: "Menu banner",
    description: "Wide banner for the online menu header or website hero.",
    brief: {
      composition: "wide banner composition with clear negative space for text overlay",
      lighting: "bright even lighting",
      style: "modern clean commercial photography",
      colorMood: "brand green accents, fresh premium mood",
      aspectRatio: "16:9",
      version: 7,
      stylize: 120,
    },
  },
  {
    id: "social-square",
    label: "Social square",
    description: "Eye-catching square post for Instagram / social feeds.",
    brief: {
      composition: "bold centered composition, strong focal point",
      lighting: "punchy studio lighting",
      style: "vibrant modern graphic art, high contrast",
      colorMood: "saturated brand palette, energetic mood",
      aspectRatio: "1:1",
      version: 7,
      stylize: 400,
    },
  },
  {
    id: "in-store-signage",
    label: "In-store signage",
    description: "Poster-style artwork for printed in-store signage.",
    brief: {
      composition: "poster layout with clear space for headline text",
      lighting: "clean gallery lighting",
      style: "premium print poster design, crisp vector-like clarity",
      colorMood: "confident brand palette, professional mood",
      aspectRatio: "2:3",
      version: 7,
      stylize: 200,
    },
  },
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Cannabis-marketing compliance reminder shown next to every generated prompt. */
export const COMPLIANCE_NOTE =
  "Marketing must target adults 21+, avoid appeal to minors, and make no health/medical claims. Do not depict consumption by anyone appearing under 21. (WA cannabis advertising rules.)";

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

export function __runMidjourneyCoreTests(): string {
  // basic assembly: subject-first, comma groups, params at end
  const a = assemblePrompt({
    subject: "a jar of premium cannabis flower",
    environment: "on a wooden table",
    composition: "close-up hero shot",
    lighting: "soft studio lighting",
    style: "editorial product photography",
    colorMood: "warm premium mood",
    aspectRatio: "1:1",
    version: 7,
    stylize: 150,
  });
  assert(a.prompt.startsWith("a jar of premium cannabis flower, on a wooden table"), "subject leads, comma groups");
  assert(a.prompt.includes(" --ar 1:1"), "one space before --ar");
  assert(a.prompt.endsWith("--stylize 150"), "params at the end");
  assert(a.paramText.indexOf("--v 7") < a.paramText.indexOf("--stylize 150"), "version before stylize");

  // punctuation stripped from --no
  const b = assemblePrompt({ subject: "logo", exclude: "text, watermark. blur!" });
  assert(b.prompt.includes("--no text watermark blur"), "no-param punctuation stripped");
  assert(!/--no [^]*[.,;:!?]/.test(b.prompt), "no punctuation inside params");

  // clamping
  const c = assemblePrompt({ subject: "x", stylize: 5000, chaos: 999, weird: 99999 });
  assert(c.prompt.includes("--stylize 1000"), "stylize clamped to 1000");
  assert(c.prompt.includes("--chaos 100"), "chaos clamped to 100");
  assert(c.prompt.includes("--weird 3000"), "weird clamped to 3000");

  // niji excludes --v
  const d = assemblePrompt({ subject: "x", niji: true, version: 7 });
  assert(d.prompt.includes("--niji") && !d.prompt.includes("--v 7"), "niji replaces version");

  // sref valid + weight; invalid oref warns
  const e = assemblePrompt({ subject: "x", srefUrl: "https://ex.com/a.jpg", styleWeight: 200, orefUrl: "not a url" });
  assert(e.prompt.includes("--sref https://ex.com/a.jpg") && e.prompt.includes("--sw 200"), "sref + sw");
  assert(e.warnings.some((w) => w.includes("Omni-reference")), "invalid oref warns");

  // raw mode
  const f = assemblePrompt({ subject: "x", raw: true });
  assert(f.prompt.includes("--style raw"), "raw mode");

  // empty subject warns
  const g = assemblePrompt({ subject: "" });
  assert(g.warnings.some((w) => w.includes("subject")), "empty subject warns");

  // presets
  assert(PRESETS.length >= 5, "5+ presets");
  assert(presetById("product-hero")?.brief.aspectRatio === "1:1", "preset lookup");

  return "OK: midjourney-core tests passed";
}
