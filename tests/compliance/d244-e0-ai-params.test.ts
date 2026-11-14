/**
 * D244 E-0 — the owner's "Generate failed: … max_tokens …" error.
 *
 * Every OpenAI-style request body in provider.ts must be built by
 * chat-payload-core's buildChatPayload (reasoning-class models get
 * max_completion_tokens, no temperature) and posted through postChat (a 400
 * naming a parameter is repaired and resent). The only bare `max_tokens:`
 * literal left is the Gemini OpenAI-compat fallback (Gemini accepts it).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runChatPayloadCoreTests,
  adjustPayloadFor400,
  buildChatPayload,
  isReasoningModel,
} from "@/lib/ai/chat-payload-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D244 E-0 — AI request parameters", () => {
  it("pure core self-tests pass", () => {
    const r = __runChatPayloadCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("reasoning models get max_completion_tokens and no temperature", () => {
    const p = buildChatPayload("gpt-5", { messages: [], maxTokens: 320, temperature: 0.4 });
    expect(p.max_tokens).toBeUndefined();
    expect(p.temperature).toBeUndefined();
    expect(p.max_completion_tokens).toBe(2000);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
  });

  it("the owner's exact 400 text is repaired", () => {
    const p = buildChatPayload("gpt-4o-mini", { messages: [], maxTokens: 400, temperature: 0.7 });
    const fixed = adjustPayloadFor400(
      p,
      `{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","type":"invalid_request_error","param":"max_tokens"}}`,
    );
    expect(fixed).not.toBeNull();
    expect(fixed!.max_tokens).toBeUndefined();
    expect(fixed!.max_completion_tokens).toBe(2000);
  });

  it("provider.ts has exactly one bare max_tokens body literal (the Gemini fallback)", () => {
    const src = read("src/lib/ai/provider.ts");
    const bare = src.split("\n").filter((l) => /^\s+max_tokens:\s/.test(l));
    expect(bare).toHaveLength(1);
    const gem = src.slice(src.indexOf("async function geminiChatFallback"));
    expect(gem).toMatch(/^\s+max_tokens:\s/m);
  });

  it("all five OpenAI-style paths post through postChat(buildChatPayload(...))", () => {
    const src = read("src/lib/ai/provider.ts");
    expect(src).toContain('from "./chat-payload-core"');
    expect(src).toContain("async function postChat(");
    expect((src.match(/await postChat\(\s*buildChatPayload\(/g) ?? []).length).toBe(5);
    expect(src).not.toMatch(/^function isReasoningModel/m);
    // generateStructured stops on a non-repairable 4xx instead of resending it.
    expect(src).toContain("if (/AI request failed \\(4\\d\\d\\)/.test(lastErr)) break;");
  });

  it("bulk AI surfaces the first failure reason and the drafting model", () => {
    const act = read("src/app/admin/products/bulk-ai/actions.ts");
    expect(act).toContain("firstError = friendlyAiError(err)");
    expect(act).toContain("&reason=${encodeURIComponent(firstError)}");
    const page = read("src/app/admin/products/bulk-ai/page.tsx");
    expect(page).toContain("First failure: {reason}");
    expect(page).toContain("export const maxDuration = 300;");
    const list = read("src/app/admin/products/page.tsx");
    expect(list).toContain('data-testid="ai-model-line"');
  });
});
