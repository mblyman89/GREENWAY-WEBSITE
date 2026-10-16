/**
 * R58-S4 — generate src/lib/cms/banner-objects-data.ts: the Studio's
 * "Objects" library (cannabis leaf, pipes, joints/cigars, smoke, bubbles,
 * ribbons, badges, food, party…) from Material Design Icons
 * (@iconify-json/mdi, Apache-2.0) PLUS a few hand-drawn decorative elements
 * (smoke puffs, sparkle clusters, dividers, frame corners).
 *
 * MDI artwork is 24×24 — every path is re-scaled to the banner icon viewBox
 * (0 0 256 256) by a small SVG path tokenizer, so objects drop into the
 * existing icon element model unchanged (validated path data only).
 *
 *   npm pack @iconify-json/mdi && tar xzf iconify-json-mdi-*.tgz   (dev-time only, not a dependency)
 *   npx tsx scripts/gen-banner-objects.ts package/icons.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = process.argv[2] ?? path.resolve(__dirname, "../node_modules/@iconify-json/mdi/icons.json");

// [mdi name, our id, label, category, extra search words]
const MDI: [string, string, string, string, string][] = [
  // Cannabis & smoke
  ["cannabis", "o-cannabis", "Cannabis leaf", "Cannabis & smoke", "weed pot marijuana leaf bud"],
  ["smoking-pipe", "o-pipe", "Smoking pipe", "Cannabis & smoke", "bowl pipe"],
  ["cigar", "o-blunt", "Blunt / cigar", "Cannabis & smoke", "blunt cigar"],
  ["smoking", "o-joint", "Joint (lit)", "Cannabis & smoke", "joint preroll smoke cigarette"],
  ["smoke", "o-smoke", "Smoke", "Cannabis & smoke", "smoke puff"],
  ["weather-fog", "o-fog", "Fog bank", "Cannabis & smoke", "fog haze smoke"],
  ["weather-windy", "o-wind", "Wind swirl", "Cannabis & smoke", "smoke blow wind"],
  ["weather-windy-variant", "o-wind-2", "Wind swirl 2", "Cannabis & smoke", "smoke blow"],
  ["clouds", "o-clouds", "Clouds", "Cannabis & smoke", "smoke cloud"],
  ["fire", "o-fire", "Fire", "Cannabis & smoke", "lit flame hot"],
  ["fire-circle", "o-fire-circle", "Fire badge", "Cannabis & smoke", "lit hot"],
  ["campfire", "o-campfire", "Campfire", "Cannabis & smoke", "lit"],
  ["mushroom", "o-mushroom", "Mushroom", "Cannabis & smoke", "shroom trippy"],
  ["sprout", "o-sprout", "Sprout", "Cannabis & smoke", "seedling grow"],
  ["seed", "o-seed", "Seed", "Cannabis & smoke", "grow"],
  ["grass", "o-grass", "Grass", "Cannabis & smoke", "ground"],
  ["barley", "o-barley", "Barley / hemp", "Cannabis & smoke", "hemp grain"],
  ["leaf-maple", "o-maple", "Maple leaf", "Cannabis & smoke", "fall"],
  ["flower-tulip", "o-tulip", "Tulip", "Cannabis & smoke", ""],
  ["flower-poppy", "o-poppy", "Poppy", "Cannabis & smoke", ""],
  ["pine-tree", "o-pine", "Pine tree", "Cannabis & smoke", "pnw forest"],
  ["palm-tree", "o-palm", "Palm tree", "Cannabis & smoke", "tropical"],
  ["cactus", "o-cactus", "Cactus", "Cannabis & smoke", ""],
  // Bubbles, ribbons & badges
  ["thought-bubble", "o-thought", "Thought bubble", "Bubbles & badges", "speech think"],
  ["comment-quote", "o-quote-bubble", "Quote bubble", "Bubbles & badges", "speech review"],
  ["format-quote-open", "o-quote-open", "Quote mark “", "Bubbles & badges", "review testimonial"],
  ["format-quote-close", "o-quote-close", "Quote mark ”", "Bubbles & badges", "review testimonial"],
  ["ribbon", "o-ribbon", "Awareness ribbon", "Bubbles & badges", "ribbon"],
  ["decagram", "o-decagram", "Seal badge", "Bubbles & badges", "burst seal sale badge"],
  ["octagram", "o-octagram", "8-point badge", "Bubbles & badges", "burst seal"],
  ["hexagram", "o-hexagram", "6-point star", "Bubbles & badges", "star"],
  ["seal", "o-seal", "Award seal", "Bubbles & badges", "certified ribbon"],
  ["seal-variant", "o-seal-2", "Award seal 2", "Bubbles & badges", "certified ribbon"],
  ["trophy-award", "o-trophy", "Trophy", "Bubbles & badges", "winner award"],
  ["medal", "o-medal", "Medal", "Bubbles & badges", "award"],
  ["crown", "o-crown", "Crown", "Bubbles & badges", "king top"],
  ["tag-heart", "o-tag-heart", "Love tag", "Bubbles & badges", "sale favourite"],
  ["sale", "o-sale", "Sale tag", "Bubbles & badges", "percent off"],
  ["label", "o-label", "Label", "Bubbles & badges", "tag"],
  ["label-variant", "o-label-2", "Label 2", "Bubbles & badges", "tag"],
  ["bookmark", "o-bookmark", "Bookmark ribbon", "Bubbles & badges", "ribbon"],
  ["flag-variant", "o-flag", "Pennant flag", "Bubbles & badges", "flag"],
  ["image-frame", "o-frame", "Picture frame", "Bubbles & badges", "border frame"],
  // Sparkle & party
  ["shimmer", "o-shimmer", "Shimmer", "Sparkle & party", "sparkle shine new"],
  ["creation", "o-creation", "Sparkles", "Sparkle & party", "sparkle new magic"],
  ["auto-fix", "o-magic", "Magic wand", "Sparkle & party", "sparkle"],
  ["star-shooting", "o-shooting-star", "Shooting star", "Sparkle & party", ""],
  ["star-four-points", "o-star-4", "4-point star", "Sparkle & party", "sparkle twinkle"],
  ["firework", "o-firework", "Firework", "Sparkle & party", "celebrate 4th july new year"],
  ["party-popper", "o-party", "Party popper", "Sparkle & party", "celebrate confetti"],
  ["balloon", "o-balloon", "Balloon", "Sparkle & party", "birthday"],
  ["gift", "o-gift", "Gift", "Sparkle & party", "present"],
  ["heart-multiple", "o-hearts", "Hearts", "Sparkle & party", "love valentine"],
  ["heart-flash", "o-heart-flash", "Heart flash", "Sparkle & party", "love"],
  ["cards-heart", "o-card-heart", "Heart suit", "Sparkle & party", "love"],
  ["lightning-bolt", "o-bolt", "Lightning bolt", "Sparkle & party", "flash fast"],
  ["emoticon-cool", "o-cool", "Cool face", "Sparkle & party", "sunglasses chill"],
  ["emoticon-devil", "o-devil", "Devil face", "Sparkle & party", "halloween"],
  ["alien", "o-alien", "Alien", "Sparkle & party", "space"],
  ["ufo", "o-ufo", "UFO", "Sparkle & party", "space"],
  ["ghost", "o-ghost", "Ghost", "Sparkle & party", "halloween"],
  ["skull-crossbones", "o-skull", "Skull & bones", "Sparkle & party", "halloween"],
  ["pumpkin", "o-pumpkin", "Pumpkin", "Sparkle & party", "halloween fall"],
  ["spider-web", "o-web", "Spider web", "Sparkle & party", "halloween"],
  ["rocket-launch", "o-rocket", "Rocket", "Sparkle & party", "launch high"],
  ["peace", "o-peace", "Peace", "Sparkle & party", "420 hippie"],
  ["yin-yang", "o-yin-yang", "Yin yang", "Sparkle & party", "balance"],
  ["atom", "o-atom", "Atom", "Sparkle & party", "science"],
  ["radioactive", "o-radioactive", "Radioactive", "Sparkle & party", "potent strong"],
  ["biohazard", "o-biohazard", "Biohazard", "Sparkle & party", "potent"],
  ["eye", "o-eye", "Eye", "Sparkle & party", "trippy"],
  ["music", "o-music", "Music notes", "Sparkle & party", "song"],
  ["music-clef-treble", "o-clef", "Treble clef", "Sparkle & party", "music"],
  ["headphones", "o-headphones", "Headphones", "Sparkle & party", "music"],
  ["album", "o-album", "Record", "Sparkle & party", "vinyl music"],
  ["palette", "o-palette", "Palette", "Sparkle & party", "art"],
  ["brush", "o-brush", "Brush", "Sparkle & party", "art"],
  // Food, drink & lab
  ["cupcake", "o-cupcake", "Cupcake", "Edibles & lab", "edible birthday"],
  ["candy", "o-candy", "Candy", "Edibles & lab", "edible gummy"],
  ["candycane", "o-candycane", "Candy cane", "Edibles & lab", "christmas edible"],
  ["cookie", "o-cookie", "Cookie", "Edibles & lab", "edible"],
  ["glass-cocktail", "o-cocktail", "Cocktail", "Edibles & lab", "drink"],
  ["beer", "o-beer", "Beer", "Edibles & lab", "drink"],
  ["bottle-wine", "o-wine", "Wine bottle", "Edibles & lab", "drink"],
  ["bottle-tonic-plus", "o-tonic", "Tincture bottle", "Edibles & lab", "tincture medical oil"],
  ["spray", "o-spray", "Spray", "Edibles & lab", "topical"],
  ["flask-round-bottom", "o-flask", "Flask", "Edibles & lab", "lab tested concentrate"],
  ["beaker", "o-beaker", "Beaker", "Edibles & lab", "lab tested"],
  ["water", "o-drop", "Drop", "Edibles & lab", "oil tincture"],
  ["food-apple", "o-apple", "Apple", "Edibles & lab", "fruit flavor"],
  ["fruit-cherries", "o-cherries", "Cherries", "Edibles & lab", "fruit flavor"],
  ["fruit-citrus", "o-citrus", "Citrus", "Edibles & lab", "fruit flavor terpene lemon"],
  ["fruit-grapes", "o-grapes", "Grapes", "Edibles & lab", "fruit flavor purple"],
  ["fruit-pineapple", "o-pineapple", "Pineapple", "Edibles & lab", "fruit flavor tropical"],
  ["fruit-watermelon", "o-watermelon", "Watermelon", "Edibles & lab", "fruit flavor summer"],
  ["fruit-pear", "o-pear", "Pear", "Edibles & lab", "fruit flavor"],
  ["chili-hot", "o-chili", "Hot chili", "Edibles & lab", "spicy"],
  // Weather & sky
  ["weather-sunny", "o-sun", "Sun", "Sky & season", "summer"],
  ["white-balance-sunny", "o-sun-2", "Sun rays", "Sky & season", "summer"],
  ["moon-waning-crescent", "o-moon", "Crescent moon", "Sky & season", "night"],
  ["star-crescent", "o-star-moon", "Moon & star", "Sky & season", "night"],
  ["snowflake", "o-snowflake", "Snowflake", "Sky & season", "winter"],
  ["cloud", "o-cloud", "Cloud", "Sky & season", "smoke"],
  ["flash", "o-flash", "Flash", "Sky & season", "lightning"],
];

// Hand-drawn decorative elements (viewBox 0 0 256 256, fill only).
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const star4 = (cx: number, cy: number, r: number) => {
  const k = r * 0.22;
  return `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
function rays(n: number, inner: number, outer: number, width: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const w = (width * Math.PI) / 180;
    const p = (r: number, aa: number) => `${r1(128 + r * Math.cos(aa))} ${r1(128 + r * Math.sin(aa))}`;
    d += `M${p(inner, a - w / 4)}L${p(outer, a - w)}L${p(outer, a + w)}L${p(inner, a + w / 4)}Z`;
  }
  return d;
}
function waveBand(): string {
  // a filled wavy ribbon across the full width
  let top = "M0 120";
  let bot = "";
  for (let i = 0; i < 4; i++) {
    const x = i * 64;
    top += `C${x + 21} ${i % 2 ? 140 : 100} ${x + 43} ${i % 2 ? 140 : 100} ${x + 64} 120`;
  }
  bot = "L256 144";
  for (let i = 3; i >= 0; i--) {
    const x = i * 64;
    bot += `C${x + 43} ${i % 2 ? 164 : 124} ${x + 21} ${i % 2 ? 164 : 124} ${x} 144`;
  }
  return `${top}${bot}Z`;
}
function zigzag(): string {
  let d = "M0 116";
  for (let i = 1; i <= 8; i++) d += `L${i * 32} ${i % 2 ? 140 : 116}`;
  d += "L256 156";
  for (let i = 7; i >= 0; i--) d += `L${i * 32} ${i % 2 ? 156 : 132}`;
  return `${d}Z`;
}
const CUSTOM: [string, string, string, string, string][] = [
  ["o-puff", "Smoke puff", "Cannabis & smoke", "smoke cloud puff exhale", [circle(92, 150, 46), circle(140, 120, 58), circle(190, 152, 42), circle(128, 168, 40), circle(60, 176, 26)].join("")],
  ["o-puff-trail", "Smoke rings trail", "Cannabis & smoke", "smoke puff trail exhale", [circle(40, 200, 14), circle(78, 170, 22), circle(126, 134, 32), circle(190, 88, 46)].join("")],
  ["o-smoke-ring", "Smoke ring", "Cannabis & smoke", "smoke ring o", `${circle(128, 128, 96)}M128 68a60 60 0 1 1 0 120a60 60 0 1 1 0 -120Z`],
  ["o-sparkles", "Sparkle cluster", "Sparkle & party", "sparkle shine new twinkle", [star4(100, 132, 76), star4(188, 64, 38), star4(196, 190, 28)].join("")],
  ["o-twinkle", "Twinkle", "Sparkle & party", "sparkle star shine", star4(128, 128, 116)],
  ["o-sunburst", "Sunburst rays", "Bubbles & badges", "rays burst sun retro", rays(16, 46, 124, 7)],
  ["o-dots", "Dot row", "Dividers & frames", "divider dots", [24, 76, 128, 180, 232].map((x) => circle(x, 128, 14)).join("")],
  ["o-wave", "Wavy divider", "Dividers & frames", "divider wave line", waveBand()],
  ["o-zigzag", "Zigzag divider", "Dividers & frames", "divider zigzag line", zigzag()],
  ["o-corners", "Frame corners", "Dividers & frames", "frame border corners", "M8 8H88V28H28V88H8ZM248 8V88H228V28H168V8ZM8 248V168H28V228H88V248ZM248 248H168V228H228V168H248Z"],
  ["o-brackets", "Bracket frame", "Dividers & frames", "frame border brackets", "M8 24H64V44H28V212H64V232H8ZM248 24V232H192V212H228V44H192V24Z"],
  ["o-underline", "Swoosh underline", "Dividers & frames", "underline swoosh brush", "M8 168C72 128 168 120 248 140L246 160C170 144 80 150 14 188Z"],
  ["o-circle-ring", "Ring frame", "Dividers & frames", "circle ring frame border", `${circle(128, 128, 120)}M128 24a104 104 0 1 1 0 208a104 104 0 1 1 0 -208Z`],
];

// ── SVG path scaler (handles every command incl. arc flags) ──
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function scalePath(d: string, k: number): string {
  const out: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  const toks: string[] = [];
  let m: RegExpExecArray | null;
  // arc flags may be written without separators ("a1 1 0 011 1") — tokenise arcs carefully
  let i = 0;
  let cmd = "";
  let argIdx = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) { i++; continue; }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) { toks.push(ch); cmd = ch.toLowerCase(); argIdx = 0; i++; continue; }
    if (cmd === "a" && (argIdx % 7 === 3 || argIdx % 7 === 4) && (ch === "0" || ch === "1")) { toks.push(ch); argIdx++; i++; continue; }
    re.lastIndex = i;
    m = re.exec(d);
    if (!m || m.index !== i || !m[2]) throw new Error(`bad path at ${i}: ${d.slice(i, i + 20)}`);
    toks.push(m[2]);
    argIdx++;
    i += m[2].length;
  }
  let c = "";
  let n = 0;
  for (const t of toks) {
    if (/^[A-Za-z]$/.test(t)) { c = t.toLowerCase(); n = 0; out.push(t); continue; }
    const v = Number(t);
    const pos = c === "a" ? n % 7 : -1;
    const keep = pos === 2 || pos === 3 || pos === 4; // rotation + flags
    out.push(keep ? String(v) : String(Math.round(v * k * 100) / 100));
    n++;
    if (ARITY[c] === undefined) throw new Error(`cmd ${c}`);
  }
  return out.join(" ").replace(/ ([A-Za-z]) /g, "$1").replace(/ ([A-Za-z])$/, "$1").replace(/^([A-Za-z]) /, "$1");
}

function main() {
  const icons = (JSON.parse(readFileSync(SRC, "utf8")) as { icons: Record<string, { body: string }> }).icons;
  const list: { id: string; label: string; cat: string; k?: string }[] = [];
  const data: Record<string, string> = {};
  for (const [name, id, label, cat, k] of MDI) {
    const body = icons[name]?.body;
    if (!body) throw new Error(`missing mdi:${name}`);
    const ds = [...body.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((x) => x[1]);
    if (!ds.length || /<(?!path|\/path|g|\/g)/.test(body.replace(/<path[^>]*\/?>/g, ""))) throw new Error(`mdi:${name} has non-path markup`);
    const d = scalePath(ds.join(" "), 256 / 24);
    if (d.length > 4000) { console.warn("skip (too detailed):", name); continue; }
    data[id] = d;
    list.push(k ? { id, label, cat, k } : { id, label, cat });
  }
  for (const [id, label, cat, k, d] of CUSTOM) {
    data[id] = d;
    list.push({ id, label, cat, k });
  }
  const header = `/**
 * GENERATED by scripts/gen-banner-objects.ts — do not edit by hand.
 * Object artwork: Material Design Icons (https://pictogrammers.com), Apache
 * License 2.0 — re-scaled to viewBox 0 0 256 256 — plus Greenway's own
 * decorative elements (o-puff, o-sparkles, dividers, frames…). Admin-only:
 * the Studio copies the chosen path INTO the banner design.
 */
`;
  const body = `export const BANNER_OBJECT_LIST: { id: string; label: string; cat: string; k?: string }[] = ${JSON.stringify(list)};
export const BANNER_OBJECT_CATS: string[] = ${JSON.stringify([...new Set(list.map((e) => e.cat))])};
/** id → SVG path "d" (viewBox 0 0 256 256, fill only). */
export const BANNER_OBJECT_DATA: Record<string, string> = ${JSON.stringify(data)};
`;
  const out = path.resolve(__dirname, "../src/lib/cms/banner-objects-data.ts");
  writeFileSync(out, header + body);
  console.log("wrote", out, list.length, "objects", (header + body).length, "bytes");
}
main();
