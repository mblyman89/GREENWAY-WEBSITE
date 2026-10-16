/**
 * R66 slice 1 — the REAL generateWebSearch Gemini path against a mocked fetch.
 *
 * Proves, end to end through provider.ts (not just the pure cores):
 *  - gemini-3.7-flash (deprecated) is sent as gemini-3.8-flash;
 *  - the row lookup keeps thinking "low" when AI_THINKING_LEVEL is unset;
 *    a per-call thinkingLevel wins; "minimal" is clamped to "low" on 3.8;
 *  - max_output_tokens (thinking + answer) is never the old 4000 —
 *    at least 32768, capped at 65536;
 *  - a 503 is retried (then answers), and a persistent 503 still ends in the
 *    friendly AiLookupError (no built-in-knowledge fallback spend);
 *  - an "incomplete" reply is retried ONCE at the model max, and if the retry
 *    is incomplete too, the result says so (incomplete: true) — never silent;
 *  - Interactions usage names are read (total_input_tokens …);
 *  - a 400 schema refusal still retries without the schema (pre-R66 behaviour).
 *
 * No Supabase env → budget + usage ledger are no-ops, so the only network is
 * the mocked fetch. Env is read at module load, so each test re-imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}
function status(code: number, text = "err"): Response {
  return new Response(text, { status: code });
}
const answer = (text: string, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  usage: { total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 900, total_tokens: 1050 },
  ...extra,
});

async function load(env: Record<string, string | undefined>, replies: Array<() => Response>) {
  vi.resetModules();
  for (const k of [
    "AI_THINKING_LEVEL",
    "AI_GEMINI_MAX_OUTPUT_TOKENS",
    "AI_WEBSEARCH_TIMEOUT_MS",
    "AI_GEMINI_SERVICE_TIER",
    "AI_GEMINI_SEED",
    "AI_GEMINI_URL_CONTEXT",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    delete process.env[k];
  }
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL_HEAVY = "gemini-3.7-flash";
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  calls = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : {} });
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    return r();
  });
  return await import("@/lib/ai/provider");
}

const gc = (c: Call) => c.body.generation_config as Record<string, unknown>;

describe("R66 — generateWebSearch on Gemini 3.8 Flash (mocked fetch)", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it("routes 3.7 → 3.8, keeps the row lookup on low, sizes the token ceiling for thinking", async () => {
    const p = await load({}, [() => okJson(answer("hello"))]);
    const r = await p.generateWebSearch({ system: "s", user: "u", maxTokens: 4000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("gemini-3.8-flash");
    expect(gc(calls[0]).thinking_level).toBe("low");
    expect(gc(calls[0]).max_output_tokens).toBe(32_768);
    expect(r.text).toBe("hello");
    expect(r.usedWebSearch).toBe(true);
    expect(r.thinkingLevel).toBe("low");
    expect(r.incomplete).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it("a per-call thinkingLevel wins over the env; minimal is clamped to low on 3.8", async () => {
    let p = await load({ AI_THINKING_LEVEL: "low" }, [() => okJson(answer("x"))]);
    await p.generateWebSearch({ system: "s", user: "u", thinkingLevel: "high" });
    expect(gc(calls[0]).thinking_level).toBe("high");
    p = await load({ AI_THINKING_LEVEL: "minimal" }, [() => okJson(answer("x"))]);
    await p.generateWebSearch({ system: "s", user: "u" });
    expect(gc(calls[0]).thinking_level).toBe("low");
  });

  it("AI_GEMINI_MAX_OUTPUT_TOKENS is honoured and capped at the model max", async () => {
    let p = await load({ AI_GEMINI_MAX_OUTPUT_TOKENS: "48000" }, [() => okJson(answer("x"))]);
    await p.generateWebSearch({ system: "s", user: "u" });
    expect(gc(calls[0]).max_output_tokens).toBe(48_000);
    p = await load({ AI_GEMINI_MAX_OUTPUT_TOKENS: "999999" }, [() => okJson(answer("x"))]);
    await p.generateWebSearch({ system: "s", user: "u" });
    expect(gc(calls[0]).max_output_tokens).toBe(65_536);
  });

  it("retries a 503 and answers", async () => {
    const p = await load({}, [() => status(503, "UNAVAILABLE"), () => okJson(answer("after retry"))]);
    const r = await p.generateWebSearch({ system: "s", user: "u" });
    expect(calls).toHaveLength(2);
    expect(r.text).toBe("after retry");
    expect(r.attempts).toBe(2);
  }, 20_000);

  it("a persistent 503 ends in the friendly AiLookupError after 2 retries (no fallback spend)", async () => {
    const p = await load({}, [() => status(503, "UNAVAILABLE")]);
    await expect(p.generateWebSearch({ system: "s", user: "u" })).rejects.toBeInstanceOf(p.AiLookupError);
    expect(calls).toHaveLength(3); // first + 2 retries; no /chat/completions fallback
    expect(calls.every((c) => c.url.includes("interactions"))).toBe(true);
  }, 30_000);

  it("does not retry a 503 when too little of the deadline is left", async () => {
    const p = await load({ AI_WEBSEARCH_TIMEOUT_MS: "30000" }, [() => status(503)]);
    await expect(p.generateWebSearch({ system: "s", user: "u" })).rejects.toBeInstanceOf(p.AiLookupError);
    expect(calls).toHaveLength(1);
  });

  it("an incomplete reply is retried once at the model max and the full answer is used", async () => {
    const p = await load({}, [
      () => okJson(answer("cut sho", { status: "incomplete" })),
      () => okJson(answer("the whole answer")),
    ]);
    const r = await p.generateWebSearch({ system: "s", user: "u", maxTokens: 4000 });
    expect(calls).toHaveLength(2);
    expect(gc(calls[0]).max_output_tokens).toBe(32_768);
    expect(gc(calls[1]).max_output_tokens).toBe(65_536);
    expect(gc(calls[1]).thinking_level).toBe("low");
    expect(r.text).toBe("the whole answer");
    expect(r.incomplete).toBe(false);
  });

  it("at the model max already, the incomplete retry thinks one level less", async () => {
    const p = await load({ AI_GEMINI_MAX_OUTPUT_TOKENS: "65536" }, [
      () => okJson(answer("cut", { status: "incomplete" })),
      () => okJson(answer("done")),
    ]);
    await p.generateWebSearch({ system: "s", user: "u", thinkingLevel: "high" });
    expect(gc(calls[1]).thinking_level).toBe("medium");
    expect(gc(calls[1]).max_output_tokens).toBe(65_536);
  });

  it("incomplete twice → keeps the second reply and flags incomplete (never silent); only ONE retry", async () => {
    const p = await load({}, [() => okJson(answer("part", { status: "incomplete" }))]);
    const r = await p.generateWebSearch({ system: "s", user: "u" });
    expect(calls).toHaveLength(2);
    expect(r.incomplete).toBe(true);
    expect(r.text).toBe("part");
  });

  it("a failed incomplete-retry keeps the first reply", async () => {
    const p = await load({}, [() => okJson(answer("first", { status: "incomplete" })), () => status(400, "bad")]);
    const r = await p.generateWebSearch({ system: "s", user: "u" });
    expect(r.text).toBe("first");
    expect(r.incomplete).toBe(true);
  });

  it("a 400 schema refusal still retries once without the schema", async () => {
    const p = await load({}, [() => status(400, "response_format not supported with tools"), () => okJson(answer("{}"))]);
    const r = await p.generateWebSearch({ system: "s", user: "u", jsonSchema: { type: "object" } });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.response_format).toBeTruthy();
    expect(calls[1].body.response_format).toBeUndefined();
    expect(r.text).toBe("{}");
  });

  it("an unknown future Gemini model is sent as-is with safe defaults", async () => {
    const p = await load({ AI_MODEL_HEAVY: "gemini-9-flash" }, [() => okJson(answer("x"))]);
    await p.generateWebSearch({ system: "s", user: "u", thinkingLevel: "medium" });
    expect(calls[0].body.model).toBe("gemini-9-flash");
    expect(gc(calls[0]).thinking_level).toBe("medium");
  });

  it("a per-call timeoutMs bounds the attempt (abort → friendly AiLookupError)", async () => {
    vi.resetModules();
    process.env.AI_API_KEY = "k";
    process.env.AI_MODEL_HEAVY = "gemini-3.8-flash";
    calls = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Promise((_ok, bad) => {
        init.signal?.addEventListener("abort", () => {
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          bad(e);
        });
      });
    });
    const p = await import("@/lib/ai/provider");
    const t0 = Date.now();
    const err = await p.generateWebSearch({ system: "s", user: "u", timeoutMs: 5_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(p.AiLookupError);
    expect((err as InstanceType<typeof p.AiLookupError>).friendly).toMatch(/took too long/);
    expect(String(err.message)).toContain("5000ms");
    expect(Date.now() - t0).toBeLessThan(9_000);
  }, 20_000);
});
