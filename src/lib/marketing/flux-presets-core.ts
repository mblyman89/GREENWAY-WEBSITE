/**
 * src/lib/marketing/flux-presets-core.ts
 *
 * PURE, general-purpose prompt helpers for the FLUX studio (R62). Nothing here
 * is cannabis-specific and nothing is ever injected silently: every helper is
 * a visible snippet the user inserts into their own prompt.
 *
 * Every tip is taken from BFL's own prompting guides (docs.bfl.ml, FLUX.2
 * [pro]/[max] + FLUX 3 Image guides):
 *   - Structure: Subject + Action + Style + Context; most important first.
 *   - 30–80 words is usually ideal; 80+ for complex scenes.
 *   - No negative prompts: describe what you WANT ("Avoid: x" pulls x in).
 *   - Photorealism: name the camera, lens and film stock.
 *   - Style table: Modern Digital / 2000s Digicam / 80s Vintage / Analog Film.
 *   - Text: put the exact words in quotes, say where, the style, size, colour.
 *   - Colour: tie hex codes to specific objects ("the sofa in color #1B6B6F").
 *   - References: call them "image 1", "image 2", say what each supplies,
 *     put the base image first (FLUX 3 "auto" ratio follows image 1).
 *   - JSON prompts are understood as well as natural language.
 */

export type PromptSnippet = { id: string; label: string; text: string; hint?: string };
export type SnippetGroup = { id: string; label: string; snippets: PromptSnippet[] };

/** Starter structures (replace the [brackets]). */
export const IMAGE_TEMPLATES: PromptSnippet[] = [
  {
    id: "structure",
    label: "Subject + Action + Style + Context",
    text: "[Main subject], [what it is doing], [style or medium], [setting, lighting, time of day, mood].",
    hint: "BFL's recommended order — the model pays most attention to what comes first.",
  },
  {
    id: "product",
    label: "Product photo",
    text: "[Product] standing on [surface], [angle, e.g. three-quarter view], soft diffused studio light with a gentle rim light, clean [colour] backdrop, shot on Hasselblad X2D, 80mm lens, f/5.6, crisp commercial product photography.",
  },
  {
    id: "lifestyle",
    label: "Lifestyle scene",
    text: "[Person or group] [doing what] in [place], candid moment, warm golden-hour light, shallow depth of field, shot on Canon 5D Mark IV, 35mm, natural colours.",
  },
  {
    id: "poster",
    label: "Poster / ad with text",
    text: "A [style] poster. Large headline text \"[HEADLINE]\" in bold sans-serif at the top, smaller line \"[SUBLINE]\" below it, [main visual] in the centre, background in color #[HEX], generous margins, clean modern layout.",
    hint: "Put exact words in quotes and say where they go.",
  },
  {
    id: "edit",
    label: "Edit a reference",
    text: "Keep everything in image 1 the same, but [the one change you want].",
    hint: "Iterate one change at a time, feeding each result back as image 1.",
  },
  {
    id: "combine",
    label: "Combine references",
    text: "Place the [object] from image 2 into the scene from image 1, matching the lighting, perspective and colour of image 1. [Anything else].",
    hint: "Name each image's role. The base/scene image goes first.",
  },
  {
    id: "style-transfer",
    label: "Style from a reference",
    text: "[Your subject and scene], in the visual style of image 1: same colour palette, lighting and texture.",
  },
  {
    id: "json",
    label: "JSON (structured)",
    text: '{\n  "scene": "[overall scene]",\n  "subjects": [{ "description": "[subject]", "position": "[where in frame]" }],\n  "style": "[style]",\n  "lighting": "[lighting]",\n  "camera": { "angle": "[angle]", "lens": "[lens]" }\n}',
    hint: "FLUX understands JSON as well as plain sentences — handy for complex scenes.",
  },
];

/** Insertable phrases, grouped. */
export const IMAGE_SNIPPETS: SnippetGroup[] = [
  {
    id: "look",
    label: "Photo look",
    snippets: [
      { id: "digital", label: "Modern digital", text: "shot on Sony A7IV, clean sharp, high dynamic range" },
      { id: "film", label: "Analog film", text: "shot on Kodak Portra 400, natural grain, organic colors" },
      { id: "digicam", label: "2000s digicam", text: "early digital camera, slight noise, flash photography, candid, 2000s digicam style" },
      { id: "vintage", label: "80s vintage", text: "film grain, warm color cast, soft focus, 80s vintage photo" },
    ],
  },
  {
    id: "camera",
    label: "Camera & lens",
    snippets: [
      { id: "portrait", label: "Portrait 85mm", text: "85mm lens, f/1.8, shallow depth of field, creamy background blur" },
      { id: "wide", label: "Wide 24mm", text: "24mm wide-angle lens, deep focus, expansive view" },
      { id: "macro", label: "Macro", text: "100mm macro lens, extreme close-up, fine surface detail" },
      { id: "medium", label: "Medium format", text: "shot on Hasselblad X2D, 80mm lens, f/2.8, natural lighting" },
      { id: "aerial", label: "Aerial", text: "aerial drone photograph, top-down view" },
    ],
  },
  {
    id: "light",
    label: "Lighting",
    snippets: [
      { id: "golden", label: "Golden hour", text: "warm golden-hour sunlight, long soft shadows" },
      { id: "studio", label: "Soft studio", text: "soft diffused studio lighting with a subtle rim light" },
      { id: "overcast", label: "Overcast", text: "even overcast daylight, soft shadows" },
      { id: "neon", label: "Neon night", text: "night scene lit by colorful neon signs, reflections on wet pavement" },
      { id: "dramatic", label: "Dramatic", text: "dramatic low-key lighting, strong contrast, deep shadows" },
    ],
  },
  {
    id: "style",
    label: "Style / medium",
    snippets: [
      { id: "editorial", label: "Editorial", text: "high-end editorial photography" },
      { id: "3d", label: "3D render", text: "polished 3D render, soft global illumination" },
      { id: "flat", label: "Flat illustration", text: "flat vector illustration, clean shapes, limited palette" },
      { id: "watercolor", label: "Watercolor", text: "loose watercolor painting on textured paper" },
      { id: "isometric", label: "Isometric", text: "isometric illustration, clean geometry" },
    ],
  },
  {
    id: "text",
    label: "Text & colour",
    snippets: [
      { id: "headline", label: "Headline text", text: 'large headline text "YOUR TEXT" in bold sans-serif at the top' },
      { id: "sign", label: "Sign text", text: 'a sign that reads "YOUR TEXT" in elegant serif lettering' },
      { id: "hex", label: "Hex colour", text: "the [object] in color #RRGGBB" },
      { id: "notext", label: "No text", text: "a clean image with no text or lettering" },
    ],
  },
];

/** Append a snippet to a prompt with sensible punctuation. */
export function insertSnippet(prompt: string, snippet: string): string {
  const p = prompt.replace(/\s+$/, "");
  if (!p) return snippet;
  if (/[\n{]$/.test(p) || snippet.startsWith("{")) return `${p}\n${snippet}`;
  return /[.,;:!?]$/.test(p) ? `${p} ${snippet}` : `${p}, ${snippet}`;
}

/** Word count + BFL's length guidance. */
export function promptLengthHint(prompt: string): { words: number; note: string } {
  const words = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;
  let note = "";
  if (words === 0) note = "";
  else if (words < 10) note = "Very short — add style and setting for more control.";
  else if (words <= 30) note = "Short — great for quick exploration.";
  else if (words <= 80) note = "30–80 words — BFL's sweet spot for most images.";
  else note = "Long — fine for complex scenes; keep the key subject first.";
  return { words, note };
}

/** Light lint: flags things BFL says hurt results (never blocks). */
export function promptWarnings(prompt: string, refCount: number): string[] {
  const out: string[] = [];
  if (/\b(avoid|no|without|don'?t|never)\s*:/i.test(prompt) || /negative prompt/i.test(prompt)) {
    out.push("FLUX has no negative prompts — naming what to avoid can pull it IN. Describe what you want instead.");
  }
  if (/--[a-z]+/i.test(prompt)) out.push("\"--\" flags are Midjourney syntax; FLUX ignores them. Use the settings instead.");
  const mentioned = Array.from(prompt.matchAll(/\bimage\s*(\d{1,2})\b/gi)).map((m) => Number(m[1]));
  const over = mentioned.filter((n) => n > refCount);
  if (over.length) out.push(`The prompt mentions image ${Math.max(...over)}, but only ${refCount} reference image(s) are attached.`);
  if (refCount > 1 && mentioned.length === 0) out.push("With several references, say what each one is for — \"image 1\", \"image 2\" … (BFL tip).");
  return out;
}

export function __runFluxPresetsTests(): string {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL flux-presets-core: " + m);
    n++;
  };
  ok(insertSnippet("", "a") === "a", "insert into empty");
  ok(insertSnippet("a red car", "golden hour") === "a red car, golden hour", "comma join");
  ok(insertSnippet("A red car.", "golden hour") === "A red car. golden hour", "after period");
  ok(insertSnippet("x", '{"a":1}') === 'x\n{"a":1}', "json on new line");
  ok(promptLengthHint("").words === 0 && promptLengthHint("one two three").words === 3, "word count");
  ok(promptLengthHint(Array(50).fill("w").join(" ")).note.includes("sweet spot"), "sweet spot");
  ok(promptWarnings("cat. Avoid: dogs", 0).length === 1, "negative prompt warned");
  ok(promptWarnings("cat --ar 16:9", 0).some((w) => w.includes("Midjourney")), "mj flags warned");
  ok(promptWarnings("put image 3 here", 2).some((w) => w.includes("image 3")), "missing ref warned");
  ok(promptWarnings("combine them", 2).some((w) => w.includes("image 1")), "unnamed refs tip");
  ok(promptWarnings("image 1 on image 2", 2).length === 0, "clean prompt");
  const all = [...IMAGE_TEMPLATES, ...IMAGE_SNIPPETS.flatMap((g) => g.snippets)];
  ok(new Set(all.map((s) => s.id)).size === all.length, "unique ids");
  ok(!all.some((s) => /cannabis|marijuana|weed|bud\b/i.test(s.text)), "general purpose (no cannabis bias)");
  return `OK flux-presets-core: ${n} assertions passed`;
}
