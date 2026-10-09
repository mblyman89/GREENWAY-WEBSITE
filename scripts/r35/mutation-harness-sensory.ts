/**
 * R35 #6 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the effects / aroma path. That covers storage form, the CHECK mirror, the
 * pre-0254 error match, the writer key rule, survivorship, the server gate,
 * planner carry-forward and rollup, the insert retry, the product page
 * (own-first, re-gate, fail-closed, merch), the fill-only backfill, the S08
 * read-only pin, the menu-loader drop list and the Products button. Its kill
 * command must then FAIL. A survivor is a hole in the tests. A CONTROL pass
 * first proves every kill command is green on clean code. Every anchor must
 * be found exactly once, and every file is restored in `finally`.
 *
 *   npx tsx scripts/r35/mutation-harness-sensory.ts
 *   R35_ONLY=<substring> npx tsx scripts/r35/mutation-harness-sensory.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const VT = "npx vitest run tests/compliance/r35-menu-effects-aroma.test.ts";
const SELF = (mod: string, fn: string) =>
  `npx tsx -e 'import {${fn} as t} from "./${mod}"; const r=t(); if (r.failed) process.exit(1);'`;
const CORE_T = SELF("src/lib/pos/menu-sensory-core", "__runMenuSensoryCoreTests");
const GOLD_T = "npx vitest run tests/compliance/s12-golden-record.test.ts tests/compliance/r35-menu-effects-aroma.test.ts";
const INJ_T = "npx vitest run tests/compliance/draft-injection-core.test.ts";
const MAST_T = "npx vitest run tests/compliance/intake-mastering-core.test.ts tests/compliance/s32-merge-review.test.ts";
const STAGE_T = "npx vitest run tests/compliance/intake-menu-staging-core.test.ts tests/compliance/s19-vendor-identity.test.ts";
const S08_T = "npx vitest run tests/compliance/attached-facts-schema.test.ts";
const COLS_T = "npx vitest run tests/compliance/menu-columns-core.test.ts";

const CORE = "src/lib/pos/menu-sensory-core.ts";
const GOLD_CORE = "src/lib/catalog/golden-record-core.ts";
const GOLD_SRV = "src/lib/catalog/golden-record-server.ts";
const INJ_CORE = "src/lib/pos/draft-injection-core.ts";
const INJ = "src/lib/pos/draft-injection.ts";
const MAST = "src/lib/pos/intake-mastering-core.ts";
const STAGE_CORE = "src/lib/pos/intake-menu-staging-core.ts";
const STAGE = "src/lib/pos/intake-menu-staging.ts";
const LINK = "src/lib/catalog/menu-kb-link-server.ts";
const PSS = "src/lib/menu/product-sensory-server.ts";
const PAGE = "src/app/menu/products/[id]/page.tsx";
const BF = "src/lib/pos/menu-sensory-backfill-server.ts";
const COLS = "src/lib/pos/menu-columns-core.ts";
const ACT = "src/app/admin/products/actions.ts";
const PPAGE = "src/app/admin/products/page.tsx";

const MUTANTS: Mutant[] = [
  // --- core: storage form ---
  { name: "core: cap 8 -> 9", file: CORE, old: "export const MENU_SENSORY_MAX = 8;", neu: "export const MENU_SENSORY_MAX = 9;", cmd: VT },
  { name: "core: no per-term length cap", file: CORE, old: "if (!t || t.length > MENU_SENSORY_TERM_MAX_CHARS) continue;", neu: "if (!t) continue;", cmd: CORE_T },
  { name: "core: dedupe case-sensitive", file: CORE, old: "    const k = t.toLowerCase();\n    if (seen.has(k)) continue;", neu: "    const k = t;\n    if (seen.has(k)) continue;", cmd: CORE_T },
  { name: "core: empty list stored as []", file: CORE, old: "  return out.length > 0 ? out : null;\n}", neu: "  return out;\n}", cmd: VT },
  { name: "core: whitespace not collapsed", file: CORE, old: 'const t = x.replace(/\\s+/g, " ").trim();', neu: "const t = x.trim();", cmd: CORE_T },
  // --- core: CHECK mirror ---
  { name: "core: CHECK mirror allows []", file: CORE, old: "if (v.length < 1 || v.length > MENU_SENSORY_MAX) return false;", neu: "if (v.length > MENU_SENSORY_MAX) return false;", cmd: VT },
  // --- core: pre-0254 error match ---
  { name: "core: missing-column match not word-bounded", file: CORE, old: "return new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_]|$)`).test(lowerMessage);", neu: "return lowerMessage.includes(column);", cmd: VT },
  { name: "core: any 42703 treated as ours", file: CORE, old: "  return MENU_SENSORY_COLUMNS.some((c) => mentionsColumn(msg, c));\n}", neu: "  return true;\n}", cmd: VT },
  { name: "core: PGRST204 not recognised", file: CORE, old: 'const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);', neu: 'const MISSING_COLUMN_CODES = new Set(["42703"]);', cmd: VT },
  // --- core: writer keys / planner / page preference ---
  { name: "core: writer always sends the keys (null)", file: CORE, old: "  if (e) out.effects = e;\n  if (a) out.aroma_notes = a;", neu: "  out.effects = e;\n  out.aroma_notes = a;", cmd: VT },
  { name: "core: planner overwrites filled lists", file: CORE, old: "    const needE = !card.effects || card.effects.length === 0;", neu: "    const needE = true;", cmd: VT },
  { name: "core: planner ignores lot keys", file: CORE, old: "  if (own) keys.push(own);", neu: "  if (own) return [own];", cmd: CORE_T },
  { name: "core: page prefers KB over own", file: CORE, old: '    if (o && o.length > 0) return { list: [...o], origin: "product" as const };\n    if (k && k.length > 0) return { list: [...k], origin: "knowledge" as const };', neu: '    if (k && k.length > 0) return { list: [...k], origin: "knowledge" as const };\n    if (o && o.length > 0) return { list: [...o], origin: "product" as const };', cmd: VT },
  // --- golden record: survivorship + gate ---
  { name: "golden: 'remembered' counts", file: GOLD_CORE, old: '  return null; // "remembered": pre-fill only, never decides.', neu: '  return { value: e.value, source: e.source, confidence: c }; // "remembered"', cmd: GOLD_T },
  { name: "golden: AI threshold dropped", file: GOLD_CORE, old: "    if (Math.round(c * 10000) / 100 < ATTACH_AUTO_MIN_CONFIDENCE) return null;", neu: "    if (false) return null;", cmd: GOLD_T },
  { name: "golden: effects not run through checkEffects", file: GOLD_SRV, old: "const v = sensoryForStorage(checkEffects(effects.values, banned).allowed);", neu: "const v = sensoryForStorage(effects.values);", cmd: VT },
  { name: "golden: aroma not linted", file: GOLD_SRV, old: "const v = sensoryForStorage(lintTerms(aroma.values, banned).safe);", neu: "const v = sensoryForStorage(aroma.values);", cmd: VT },
  { name: "golden: sensory not passed to injection", file: GOLD_SRV, old: "out.set(p.id, { goldenDescription, attachedStrainType: p.strain, goldenEffects, goldenAroma });", neu: "out.set(p.id, { goldenDescription, attachedStrainType: p.strain });", cmd: VT },
  // --- draft injection ---
  { name: "inject core: effects not on the item", file: INJ_CORE, old: "      effects: goldenEffects,\n", neu: "      effects: null,\n", cmd: INJ_T },
  { name: "inject core: storage form not re-applied", file: INJ_CORE, old: "const goldenAroma = sensoryForStorage(enrich.goldenAroma?.values ?? null);", neu: "const goldenAroma = enrich.goldenAroma?.values ?? null;", cmd: INJ_T },
  { name: "inject writer: lists not written", file: INJ, old: "        ...sensoryRowFields(it.effects, it.aroma_notes),\n", neu: "", cmd: VT },
  // --- mastering + staging carry ---
  { name: "mastering: rollup ignores lots after the first", file: MAST, old: "effects: sortedItems.map((gi) => gi.effects).find((l) => Array.isArray(l) && l.length > 0) ?? null,", neu: "effects: sortedItems[0]?.effects ?? null,", cmd: MAST_T },
  { name: "mastering: aroma borrowed from effects lot", file: MAST, old: "aroma_notes: sortedItems.map((gi) => gi.aroma_notes).find((l) => Array.isArray(l) && l.length > 0) ?? null,", neu: "aroma_notes: null,", cmd: MAST_T },
  { name: "staging core: effects dropped (first carry)", file: STAGE_CORE, old: "    effects: it.effects ?? null,\n", neu: "    effects: null,\n", cmd: STAGE_T },
  { name: "staging writer: carry-forward drops effects", file: STAGE, old: "      effects: Array.isArray(it.effects) ? it.effects : null,", neu: "      effects: null,", cmd: VT },
  { name: "staging writer: lists not written", file: STAGE, old: "      ...sensoryRowFields(it.effects, it.aroma_notes),\n", neu: "", cmd: VT },
  // --- insert retry ---
  { name: "retry: no sensory retry (pre-0254 menu build fails)", file: LINK, old: "    } else if (!retriedWithoutSensory && anySensory && isMissingSensoryColumnError(res.error)) {", neu: "    } else if (false) {", cmd: VT },
  // (The once-guard alone is an EQUIVALENT mutant: after the strip no row has
  // a sensory key, so anySensory is false and a 2nd sensory retry cannot
  // happen. The strip itself is what matters.)
  { name: "retry: retries WITHOUT stripping the columns", file: LINK, old: "      payload = payload.map((r) => withoutSensoryColumns(r));", neu: "      payload = payload.map((r) => r);", cmd: VT },
  { name: "retry: strips on ANY error (unrelated errors masked)", file: LINK, old: "    } else if (!retriedWithoutSensory && anySensory && isMissingSensoryColumnError(res.error)) {", neu: "    } else if (!retriedWithoutSensory && anySensory) {", cmd: VT },
  { name: "retry: only one attempt (0234+0254 both missing fails)", file: LINK, old: "for (let attempt = 0; attempt < 2 && res.error; attempt += 1) {", neu: "for (let attempt = 0; attempt < 1 && res.error; attempt += 1) {", cmd: VT },
  // --- product page ---
  { name: "page: own lists not re-gated at render", file: PSS, old: "    return preferOwnSensory(gateOwnSensory(own, banned), kb);", neu: "    return preferOwnSensory(own, kb);", cmd: VT },
  { name: "page: banned-list failure shows ungated own", file: PSS, old: "      return preferOwnSensory(null, kb);\n    }\n    return preferOwnSensory(gateOwnSensory", neu: "      return preferOwnSensory(own, kb);\n    }\n    return preferOwnSensory(gateOwnSensory", cmd: VT },
  { name: "page: reads draft cards (no published filter)", file: PSS, old: '      .from("menu_versions")\n      .select("id")\n      .eq("status", "published")', neu: '      .from("menu_versions")\n      .select("id")', cmd: VT },
  { name: "page: effects gate removed", file: PSS, old: "effects: own.effects ? sensoryForStorage(checkEffects(own.effects, banned).allowed) : null,", neu: "effects: own.effects,", cmd: VT },
  { name: "page: KB lists bypass own", file: PAGE, old: "  const kbEffects = pageSensory.effects;", neu: "  const kbEffects = knowledge?.effects ?? [];", cmd: VT },
  { name: "page: merch reads sensory", file: PAGE, old: "  const pageSensory = isMerchItem(item)\n    ? { effects: [] as string[], aroma: [] as string[] }\n    :", neu: "  const pageSensory = false\n    ? { effects: [] as string[], aroma: [] as string[] }\n    :", cmd: VT },
  // --- backfill ---
  { name: "backfill: not fill-only (overwrites)", file: BF, old: "          .is(u.column, null)\n", neu: "", cmd: VT },
  { name: "backfill: partial menu read accepted", file: BF, old: "    if (!menu.verdict.complete) {", neu: "    if (false) {", cmd: VT },
  { name: "backfill: banned failure proceeds ungated", file: BF, old: '      return { ok: false, error: "Could not load your banned phrases, so nothing could be cleared. Nothing was changed; try again." };', neu: "      banned = [] as unknown as typeof banned;", cmd: VT },
  { name: "backfill: oldest draft wins", file: BF, old: 'if (!prev || String(d.updated_at ?? "") > String(prev.updated_at ?? "")) newest.set(k, d);', neu: 'if (!prev || String(d.updated_at ?? "") < String(prev.updated_at ?? "")) newest.set(k, d);', cmd: VT },
  { name: "backfill: unapproved drafts read", file: BF, old: '          .eq("status", "approved")\n', neu: "", cmd: S08_T },
  { name: "backfill: update errors not reported", file: BF, old: "        if (error) for (const id of chunk) failedIds.add(id);", neu: "        if (error) void 0;", cmd: VT },
  // --- loaders, button, audit ---
  { name: "menu loaders: effects no longer dropped", file: COLS, old: '  "effects",\n  "aroma_notes",\n', neu: "", cmd: COLS_T },
  { name: "action: backfill not audited", file: ACT, old: "    action: MENU_SENSORY_BACKFILL_AUDIT_ACTION,", neu: '    action: "products.other",', cmd: VT },
  { name: "action: wrong permission", file: ACT, old: 'export async function fillMenuSensoryAction(): Promise<void> {\n  const session = await requirePermission("products.enrich");', neu: 'export async function fillMenuSensoryAction(): Promise<void> {\n  const session = await requirePermission("products.view");', cmd: VT },
  { name: "Products page: button removed", file: PPAGE, old: 'data-testid="fill-menu-sensory"', neu: 'data-testid="x-menu-sensory"', cmd: VT },
];

function run(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 300_000 });
    return true;
  } catch {
    return false;
  }
}

const only = process.env.R35_ONLY;
const list = only ? MUTANTS.filter((m) => m.name.includes(only)) : MUTANTS;

for (const m of list) {
  const src = readFileSync(m.file, "utf8");
  const n = src.split(m.old).length - 1;
  if (n !== 1) {
    console.error(`ANCHOR ${n}x (need 1): ${m.name}`);
    process.exit(2);
  }
}
for (const cmd of [...new Set(list.map((m) => m.cmd))]) {
  if (!run(cmd)) {
    console.error(`CONTROL FAILED (clean code is red): ${cmd}`);
    process.exit(2);
  }
}
console.log(`CONTROL ok on ${new Set(list.map((m) => m.cmd)).size} kill commands`);

let killed = 0;
const survivors: string[] = [];
for (const m of list) {
  const orig = readFileSync(m.file, "utf8");
  try {
    writeFileSync(m.file, orig.replace(m.old, m.neu));
    if (run(m.cmd)) {
      survivors.push(m.name);
      console.log(`SURVIVED  ${m.name}`);
    } else {
      killed += 1;
      console.log(`killed    ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, orig);
  }
}
console.log(`\nR35 #6 mutants: ${killed}/${list.length} killed`);
if (survivors.length) {
  console.log("SURVIVORS:\n  " + survivors.join("\n  "));
  process.exit(1);
}
