/**
 * src/lib/ai/sprint-status-core.ts   (R74 S21, owner round 10)
 *
 * "will you add a Gemini ai sprint status indicator on the onboard page
 *  letting me know I have it set correctly."
 *
 * PURE: no I/O, no environment reads, no clock. The server wrapper
 * (sprint-status.ts) hands in the raw Vercel values; every decision is here.
 *
 * NEVER GUESS. Each check resolves a variable EXACTLY the way the code that
 * uses it does, so the panel can never say "fine" while the app does
 * something else:
 *   - key:      provider.ts  `AI_API_KEY ?? OPENAI_API_KEY ?? ""` (truthy = on);
 *               Gemini key   `AI_GEMINI_API_KEY ?? <that key>`.
 *   - mode:     router.ts    `(AI_MODE ?? "maintenance").toLowerCase() === "sprint"`
 *               (no trim: "sprint " with a space is maintenance, and we say so).
 *   - model:    provider.ts  `AI_MODEL_HEAVY ?? OPENAI_MODEL_HEAVY ?? "gpt-4o"`,
 *               Google Search grounding when `/^gemini/i` matches (no trim).
 *               Capability row from gemini-models-core (3.7 -> 3.8 routing).
 *   - row lookup thinking:   provider.ts `AI_THINKING_LEVEL ?? "low"` ->
 *               gemini-request-core thinkingLevelFor (junk = model default),
 *               clamped to what the model accepts.
 *   - batch thinking:        lookup-job-core batchThinkingLevel (junk = high),
 *               clamped the same way.
 *   - batch lookups:         lookup-job-core manifestBatchLookupEnabled.
 *   - parallel manifests:    lookup-job-core lookupParallelJobs.
 *
 * What "sprint" really changes (said plainly on the page): AI_MODE=sprint
 * sends every HEAVY AI task to AI_MODEL_HEAVY instead of the light model. The
 * product lookup (row and batch) ALWAYS uses AI_MODEL_HEAVY, so for Gemini
 * product data the model + key are what matter most.
 *
 * Self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */

import { clampThinkingLevel, parseThinkingWanted, resolveGeminiModel, modelNotice, type ThinkingLevel } from "./gemini-models-core";
import {
  AI_BATCH_THINKING_LEVEL_ENV,
  LOOKUP_PARALLEL_JOBS_ENV,
  MANIFEST_BATCH_LOOKUP_ENV,
  batchThinkingLevel,
  lookupParallelJobs,
  manifestBatchLookupEnabled,
} from "@/lib/catalog/lookup-job-core";

/** The raw Vercel values (undefined = not set). Names are the code's own. */
export type SprintEnv = {
  AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_GEMINI_API_KEY?: string;
  AI_MODE?: string;
  AI_MODEL_HEAVY?: string;
  OPENAI_MODEL_HEAVY?: string;
  AI_THINKING_LEVEL?: string;
  AI_BATCH_THINKING_LEVEL?: string;
  MANIFEST_BATCH_LOOKUP?: string;
  LOOKUP_PARALLEL_JOBS?: string;
};

/** The variable names the panel reads (the server wrapper reads exactly these). */
export const SPRINT_ENV_NAMES = [
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "AI_GEMINI_API_KEY",
  "AI_MODE",
  "AI_MODEL_HEAVY",
  "OPENAI_MODEL_HEAVY",
  "AI_THINKING_LEVEL",
  AI_BATCH_THINKING_LEVEL_ENV,
  MANIFEST_BATCH_LOOKUP_ENV,
  LOOKUP_PARALLEL_JOBS_ENV,
] as const satisfies readonly (keyof SprintEnv)[];

export type SprintTone = "good" | "warn" | "bad";

export type SprintCheck = {
  id: "key" | "mode" | "model" | "gemini_key" | "row_thinking" | "batch_thinking" | "batch_lookup" | "parallel";
  tone: SprintTone;
  label: string;
  /** What the app is doing right now with this setting. */
  detail: string;
  /** The exact Vercel change to make, or null when nothing needs changing. */
  fix: string | null;
};

export type SprintStatus = {
  tone: SprintTone;
  headline: string;
  checks: SprintCheck[];
  /** The resolved values, for tests and the panel's one-line summary. */
  sprint: boolean;
  model: string;
  grounded: boolean;
};

const TONE_RANK: Record<SprintTone, number> = { good: 0, warn: 1, bad: 2 };

function worst(a: SprintTone, b: SprintTone): SprintTone {
  return TONE_RANK[b] > TONE_RANK[a] ? b : a;
}

/** Show a value the owner typed without ever showing a secret. */
function shown(v: string): string {
  return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v);
}

/** The level the Gemini call will really send (gemini-request-core thinkingLevelFor). */
function sentLevel(model: string, wanted: ThinkingLevel | null): { level: ThinkingLevel; clamped: boolean } {
  const profile = resolveGeminiModel(model);
  const w = wanted ?? profile.defaultThinking;
  const level = clampThinkingLevel(profile, w);
  return { level, clamped: level !== w };
}

export function sprintStatus(env: SprintEnv): SprintStatus {
  const checks: SprintCheck[] = [];

  // 1. The AI key (provider.ts).
  const key = env.AI_API_KEY ?? env.OPENAI_API_KEY ?? "";
  if (key) {
    checks.push({ id: "key", tone: "good", label: "AI key", detail: env.AI_API_KEY !== undefined ? "AI_API_KEY is set." : "OPENAI_API_KEY is set (AI_API_KEY is not, so this one is used).", fix: null });
  } else {
    const emptyPrimary = env.AI_API_KEY !== undefined;
    checks.push({
      id: "key",
      tone: "bad",
      label: "AI key",
      detail: emptyPrimary ? "AI_API_KEY is set but empty, so no AI call can run (an empty AI_API_KEY also hides OPENAI_API_KEY)." : "No AI key is set, so no AI call can run.",
      fix: emptyPrimary ? "Put your key in AI_API_KEY (or delete the empty AI_API_KEY), then redeploy." : "Set AI_API_KEY to your key, then redeploy.",
    });
  }

  // 2. Sprint mode (router.ts, exactly: no trim).
  const rawMode = env.AI_MODE;
  const sprint = (rawMode ?? "maintenance").toLowerCase() === "sprint";
  if (sprint) {
    checks.push({ id: "mode", tone: "good", label: "Sprint mode", detail: "AI_MODE=sprint: heavy AI tasks use AI_MODEL_HEAVY.", fix: null });
  } else if (rawMode !== undefined && rawMode.trim().toLowerCase() === "sprint") {
    checks.push({ id: "mode", tone: "warn", label: "Sprint mode", detail: `AI_MODE is ${shown(rawMode)}: the space around it makes the app read it as maintenance.`, fix: "Set AI_MODE to exactly sprint (no spaces), then redeploy." });
  } else {
    checks.push({
      id: "mode",
      tone: "warn",
      label: "Sprint mode",
      detail: rawMode === undefined ? "AI_MODE is not set, so the app is in maintenance mode (heavy tasks use the light model)." : `AI_MODE is ${shown(rawMode)}, so the app is in maintenance mode (heavy tasks use the light model).`,
      fix: "Set AI_MODE=sprint, then redeploy. (Set it back to maintenance when the big push is done.)",
    });
  }

  // 3. The lookup model (provider.ts: always AI_MODEL_HEAVY; Gemini = Google Search).
  const model = env.AI_MODEL_HEAVY ?? env.OPENAI_MODEL_HEAVY ?? "gpt-4o";
  const grounded = /^gemini/i.test(model);
  const source = env.AI_MODEL_HEAVY !== undefined ? "AI_MODEL_HEAVY" : env.OPENAI_MODEL_HEAVY !== undefined ? "OPENAI_MODEL_HEAVY" : "the default";
  if (!grounded) {
    const spaced = /^\s+gemini/i.test(model);
    checks.push({
      id: "model",
      tone: "bad",
      label: "Gemini model",
      detail: spaced
        ? `${source} is ${shown(model)}: the space before "gemini" means Google Search is OFF and lookups go to the OpenAI path.`
        : `Product lookups use ${shown(model)} (${source}), which is not a Gemini model, so Google Search grounding is OFF.`,
      fix: spaced ? "Remove the space at the start of AI_MODEL_HEAVY, then redeploy." : "Set AI_MODEL_HEAVY to your Gemini model (for example gemini-3.8-flash), then redeploy.",
    });
  } else {
    const profile = resolveGeminiModel(model);
    const notice = modelNotice(profile);
    if (profile.routedFrom) {
      checks.push({ id: "model", tone: "warn", label: "Gemini model", detail: notice ?? `${model} is routed to ${profile.id}.`, fix: `Set AI_MODEL_HEAVY=${profile.id}, then redeploy.` });
    } else {
      checks.push({
        id: "model",
        tone: "good",
        label: "Gemini model",
        detail: `Product lookups use ${profile.id} with Google Search${profile.known ? "" : ` (${notice ?? "safe settings"})`}.`,
        fix: null,
      });
    }
  }

  // 4. The Gemini key (provider.ts: AI_GEMINI_API_KEY ?? the AI key).
  if (grounded) {
    const gKey = env.AI_GEMINI_API_KEY ?? key;
    if (!gKey) {
      checks.push({
        id: "gemini_key",
        tone: "bad",
        label: "Gemini key",
        detail: env.AI_GEMINI_API_KEY !== undefined ? "AI_GEMINI_API_KEY is set but empty, so Gemini lookups cannot run." : "No key for Gemini (AI_GEMINI_API_KEY is not set and there is no AI key to fall back to).",
        fix: "Set AI_GEMINI_API_KEY to your Google AI Studio key, then redeploy.",
      });
    } else if (env.AI_GEMINI_API_KEY === undefined && /^sk-/.test(key)) {
      checks.push({
        id: "gemini_key",
        tone: "warn",
        label: "Gemini key",
        detail: "AI_GEMINI_API_KEY is not set, so Gemini uses your AI key, and that key looks like an OpenAI key (it starts with sk-). Google will refuse it.",
        fix: "Set AI_GEMINI_API_KEY to your Google AI Studio key, then redeploy.",
      });
    } else {
      checks.push({ id: "gemini_key", tone: "good", label: "Gemini key", detail: env.AI_GEMINI_API_KEY !== undefined ? "AI_GEMINI_API_KEY is set." : "AI_GEMINI_API_KEY is not set, so Gemini uses your AI key (fine when that is your Google key).", fix: null });
    }
  }

  // 5. Row lookup thinking (provider.ts `?? "low"` -> thinkingLevelFor).
  if (grounded) {
    const raw = env.AI_THINKING_LEVEL;
    const wanted = parseThinkingWanted(raw ?? "low");
    const { level, clamped } = sentLevel(model, wanted);
    if (raw !== undefined && wanted === null) {
      const sprintMixup = raw.trim().toLowerCase() === "sprint";
      checks.push({
        id: "row_thinking",
        tone: "warn",
        label: "Row lookup thinking",
        detail: `AI_THINKING_LEVEL is ${shown(raw)}, which is not a thinking level, so the model's own default (${level}) is used.${sprintMixup ? ' "sprint" belongs in AI_MODE, not here.' : ""}`,
        fix: "Set AI_THINKING_LEVEL to low, medium or high (low is the safe choice for the per-row button), then redeploy.",
      });
    } else {
      checks.push({
        id: "row_thinking",
        tone: "good",
        label: "Row lookup thinking",
        detail: `The per-row AI Lookup thinks at ${level}${raw === undefined ? " (AI_THINKING_LEVEL not set)" : ""}${clamped ? ` (this model has no ${wanted}, so the nearest level is sent)` : ""}.`,
        fix: null,
      });
    }
  }

  // 6. Batch thinking (lookup-job-core batchThinkingLevel, clamped by the provider).
  if (grounded) {
    const raw = env.AI_BATCH_THINKING_LEVEL;
    const chosen = batchThinkingLevel(raw);
    const { level, clamped } = sentLevel(model, chosen);
    const junk = raw !== undefined && raw.trim() !== "" && chosen !== raw.trim().toLowerCase();
    if (junk) {
      checks.push({
        id: "batch_thinking",
        tone: "warn",
        label: "Batch lookup thinking",
        detail: `AI_BATCH_THINKING_LEVEL is ${shown(raw)}, which is not a thinking level, so the batch uses ${level}.`,
        fix: "Delete AI_BATCH_THINKING_LEVEL (the default high is best for data quality) or set low, medium or high, then redeploy.",
      });
    } else {
      checks.push({
        id: "batch_thinking",
        tone: "good",
        label: "Batch lookup thinking",
        detail: `"Look up all" thinks at ${level}${raw === undefined ? " (the default)" : ""}${clamped ? ` (this model has no ${chosen}, so the nearest level is sent)` : ""}.`,
        fix: null,
      });
    }
  }

  // 7. The batch lookup switch.
  const batchOn = manifestBatchLookupEnabled(env.MANIFEST_BATCH_LOOKUP);
  checks.push(
    batchOn
      ? { id: "batch_lookup", tone: "good", label: "Look up all (background)", detail: "On: the every-minute worker does manifest and vendor lookups with no tab open.", fix: null }
      : { id: "batch_lookup", tone: "warn", label: "Look up all (background)", detail: `MANIFEST_BATCH_LOOKUP is ${shown(env.MANIFEST_BATCH_LOOKUP ?? "")}, so the Look up all and vendor Gemini buttons are hidden.`, fix: "Delete MANIFEST_BATCH_LOOKUP (or set it to on), then redeploy." },
  );

  // 8. Parallel manifests (information; never a problem).
  const parallel = lookupParallelJobs(env.LOOKUP_PARALLEL_JOBS);
  checks.push({ id: "parallel", tone: "good", label: "Manifests at once", detail: `${parallel} manifest${parallel === 1 ? "" : "s"} looked up at the same time${env.LOOKUP_PARALLEL_JOBS === undefined ? " (LOOKUP_PARALLEL_JOBS not set, the default)" : ""}.`, fix: null });

  const tone = checks.reduce<SprintTone>((t, c) => worst(t, c.tone), "good");
  const toFix = checks.filter((c) => c.fix).length;
  const headline =
    tone === "good"
      ? `Gemini sprint is set correctly: sprint mode on, ${model} with Google Search.`
      : tone === "bad"
        ? `Gemini lookups will not work as set: ${toFix} setting${toFix === 1 ? "" : "s"} to fix in Vercel.`
        : `Gemini works, but ${toFix} setting${toFix === 1 ? " is" : "s are"} not what a sprint needs.`;
  return { tone, headline, checks, sprint, model, grounded };
}

export function __runSprintStatusCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL - ${name}`);
    }
  };
  const byId = (s: SprintStatus, id: SprintCheck["id"]) => s.checks.find((c) => c.id === id);
  const good: SprintEnv = { AI_API_KEY: "AIzaTEST", AI_MODE: "sprint", AI_MODEL_HEAVY: "gemini-3.8-flash", AI_THINKING_LEVEL: "low" };

  // The owner's real setup: all green.
  const g = sprintStatus(good);
  ok(g.tone === "good", "owner setup is good");
  ok(g.sprint && g.grounded && g.model === "gemini-3.8-flash", "resolved values");
  ok(g.headline.startsWith("Gemini sprint is set correctly"), "good headline");
  ok(g.checks.every((c) => c.fix === null), "nothing to fix");
  ok(g.checks.length === 8, "all eight checks for Gemini");
  ok(byId(g, "row_thinking")!.detail.includes("at low"), "row thinks low");
  ok(byId(g, "batch_thinking")!.detail.includes("at high"), "batch default high");
  ok(byId(g, "parallel")!.detail.startsWith("4 manifests"), "parallel default 4");

  // Mode, exactly as router.ts.
  ok(sprintStatus({ ...good, AI_MODE: "SPRINT" }).sprint, "case-insensitive like router.ts");
  const spaced = sprintStatus({ ...good, AI_MODE: "sprint " });
  ok(!spaced.sprint && byId(spaced, "mode")!.tone === "warn" && /space/.test(byId(spaced, "mode")!.detail), "trailing space = maintenance, said");
  const maint = sprintStatus({ ...good, AI_MODE: undefined });
  ok(maint.tone === "warn" && byId(maint, "mode")!.fix!.includes("AI_MODE=sprint"), "unset mode = warn with fix");
  ok(maint.headline.startsWith("Gemini works, but 1 setting is"), "warn headline counts");
  ok(byId(sprintStatus({ ...good, AI_MODE: "maintenance" }), "mode")!.detail.includes('"maintenance"'), "names the value");

  // Key, exactly as provider.ts (?? not ||).
  ok(byId(sprintStatus({ ...good, AI_API_KEY: undefined }), "key")!.tone === "bad", "no key = bad");
  ok(byId(sprintStatus({ ...good, AI_API_KEY: undefined, OPENAI_API_KEY: "AIzaX" }), "key")!.tone === "good", "OPENAI_API_KEY fallback");
  const emptyKey = sprintStatus({ ...good, AI_API_KEY: "", OPENAI_API_KEY: "AIzaX" });
  ok(emptyKey.tone === "bad" && /hides OPENAI_API_KEY/.test(byId(emptyKey, "key")!.detail), "empty AI_API_KEY hides the fallback (??)");
  ok(emptyKey.headline.startsWith("Gemini lookups will not work"), "bad headline");

  // Model, exactly as provider.ts.
  const gpt = sprintStatus({ ...good, AI_MODEL_HEAVY: undefined });
  ok(!gpt.grounded && gpt.model === "gpt-4o" && byId(gpt, "model")!.tone === "bad", "unset model = gpt-4o, bad");
  ok(gpt.checks.length === 5, "no Gemini-only checks without Gemini");
  ok(sprintStatus({ ...good, AI_MODEL_HEAVY: undefined, OPENAI_MODEL_HEAVY: "gemini-3.8-flash" }).grounded, "OPENAI_MODEL_HEAVY fallback");
  const lead = sprintStatus({ ...good, AI_MODEL_HEAVY: " gemini-3.8-flash" });
  ok(!lead.grounded && /space before/.test(byId(lead, "model")!.detail), "leading space = no grounding, said");
  ok(sprintStatus({ ...good, AI_MODEL_HEAVY: "Gemini-3.8-Flash" }).grounded, "case-insensitive like provider.ts");
  const routed = sprintStatus({ ...good, AI_MODEL_HEAVY: "gemini-3.7-flash" });
  ok(byId(routed, "model")!.tone === "warn" && byId(routed, "model")!.fix === "Set AI_MODEL_HEAVY=gemini-3.8-flash, then redeploy.", "retired model = warn + exact fix");
  const future = sprintStatus({ ...good, AI_MODEL_HEAVY: "gemini-9-flash" });
  ok(byId(future, "model")!.tone === "good" && /newer than/.test(byId(future, "model")!.detail), "unknown future model = good with note");

  // Gemini key.
  ok(byId(sprintStatus({ ...good, AI_GEMINI_API_KEY: "AIzaG" }), "gemini_key")!.detail === "AI_GEMINI_API_KEY is set.", "own Gemini key");
  const openaiKey = sprintStatus({ ...good, AI_API_KEY: "sk-abc" });
  ok(byId(openaiKey, "gemini_key")!.tone === "warn", "OpenAI-looking key without a Gemini key = warn");
  ok(byId(sprintStatus({ ...good, AI_API_KEY: "sk-abc", AI_GEMINI_API_KEY: "AIzaG" }), "gemini_key")!.tone === "good", "Gemini key set = fine with an OpenAI AI key");
  ok(byId(sprintStatus({ ...good, AI_GEMINI_API_KEY: "" }), "gemini_key")!.tone === "bad", "empty Gemini key = bad (?? keeps the empty one)");
  ok(!JSON.stringify(sprintStatus({ ...good, AI_API_KEY: "AIzaSECRET123" })).includes("SECRET123"), "never shows a key");

  // Row thinking, exactly as provider.ts + thinkingLevelFor.
  const sprintThink = sprintStatus({ ...good, AI_THINKING_LEVEL: "sprint" });
  ok(byId(sprintThink, "row_thinking")!.tone === "warn" && /belongs in AI_MODE/.test(byId(sprintThink, "row_thinking")!.detail), "the sprint mix-up is named");
  ok(byId(sprintThink, "row_thinking")!.detail.includes("(medium)"), "junk = model default (3.8 flash: medium)");
  ok(byId(sprintStatus({ ...good, AI_THINKING_LEVEL: undefined }), "row_thinking")!.detail.includes("at low (AI_THINKING_LEVEL not set)"), "unset = low");
  const minimal = byId(sprintStatus({ ...good, AI_THINKING_LEVEL: "minimal" }), "row_thinking")!;
  ok(minimal.tone === "good" && minimal.detail.includes("at low") && /no minimal/.test(minimal.detail), "minimal clamped to low on 3.8 flash");
  ok(byId(sprintStatus({ ...good, AI_THINKING_LEVEL: " High " }), "row_thinking")!.detail.includes("at high"), "trimmed like parseThinkingWanted");

  // Batch thinking.
  const bj = byId(sprintStatus({ ...good, AI_BATCH_THINKING_LEVEL: "max" }), "batch_thinking")!;
  ok(bj.tone === "warn" && bj.detail.includes("uses high"), "junk batch level = warn, high used");
  ok(byId(sprintStatus({ ...good, AI_BATCH_THINKING_LEVEL: "Medium" }), "batch_thinking")!.tone === "good", "valid batch level");
  ok(byId(sprintStatus({ ...good, AI_BATCH_THINKING_LEVEL: "" }), "batch_thinking")!.tone === "good", "empty batch level = default, fine");

  // Batch switch + parallel.
  const off = byId(sprintStatus({ ...good, MANIFEST_BATCH_LOOKUP: "off" }), "batch_lookup")!;
  ok(off.tone === "warn" && off.fix !== null, "batch lookup off = warn");
  ok(byId(sprintStatus({ ...good, LOOKUP_PARALLEL_JOBS: "1" }), "parallel")!.detail.startsWith("1 manifest looked"), "parallel 1, singular");
  ok(byId(sprintStatus({ ...good, LOOKUP_PARALLEL_JOBS: "99" }), "parallel")!.detail.startsWith("8 manifests"), "parallel clamped 8");

  // Worst tone wins; bad beats warn.
  const mixed = sprintStatus({ AI_MODE: "maintenance" });
  ok(mixed.tone === "bad", "bad beats warn");
  ok(SPRINT_ENV_NAMES.length === 10 && new Set(SPRINT_ENV_NAMES).size === 10, "ten distinct names");

  return { passed, failed };
}
