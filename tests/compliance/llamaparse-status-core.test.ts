/**
 * tests/compliance/llamaparse-status-core.test.ts  (PR-A observability)
 *
 * Pins the PURE parse-status logic that drives Michael's two visible signals:
 *   - the intake table "AI" badge ("llama" success / "FB" fallback-or-fail);
 *   - the detail page transport statement (HONEST reason when AI didn't run).
 * The never-lie contract: an empty ledger or an unpdf fallback must NEVER read
 * as "llama"; failures must classify to an honest, stable reason code.
 */
import { describe, it, expect } from "vitest";
import {
  deriveParseStatus,
  classifyParseReason,
  __runLlamaParseStatusCoreTests,
  type ParseLedgerRow,
} from "@/lib/inbound-email/llamaparse-status-core";

const row = (over: Partial<ParseLedgerRow>): ParseLedgerRow => ({
  created_at: "2026-01-01T00:00:00Z",
  ok: true,
  error_note: null,
  model: "llamaparse-max",
  engine: "llamaparse",
  ...over,
});

describe("llamaparse-status-core: badge (never false 'llama')", () => {
  it("empty ledger -> FB / none, not a false success", () => {
    const s = deriveParseStatus([]);
    expect(s.badge).toBe("FB");
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("none");
  });

  it("vision success -> llama", () => {
    const s = deriveParseStatus([row({})]);
    expect(s.badge).toBe("llama");
    expect(s.engine).toBe("llamaparse");
    expect(s.reason).toBe("ok");
  });

  it("unpdf fallback is loud FB, never llama", () => {
    const s = deriveParseStatus([row({ engine: "unpdf", model: "unpdf" })]);
    expect(s.badge).toBe("FB");
    expect(s.ok).toBe(false);
    expect(s.statement).toMatch(/did NOT run/i);
  });

  it("newest row wins (a later failure supersedes an earlier success)", () => {
    const s = deriveParseStatus([
      row({ created_at: "2026-01-01T00:00:00Z", ok: true }),
      row({ created_at: "2026-03-01T00:00:00Z", ok: false, error_note: "402 credits exhausted" }),
    ]);
    expect(s.badge).toBe("FB");
    expect(s.reason).toBe("credits");
  });
});

describe("llamaparse-status-core: honest reason classification", () => {
  it("maps the real provider notes to stable codes", () => {
    expect(classifyParseReason("LLAMA_CLOUD_API_KEY not set").reason).toBe("no_key");
    expect(classifyParseReason("402 credits exhausted").reason).toBe("credits");
    expect(classifyParseReason("LlamaParse job timed out").reason).toBe("timeout");
    expect(classifyParseReason("empty parse").reason).toBe("empty");
    expect(classifyParseReason("fetch failed 503").reason).toBe("network");
    expect(classifyParseReason(null).reason).toBe("unknown");
  });

  it("no-key failure gives an actionable statement + short label", () => {
    const s = deriveParseStatus([
      row({ ok: false, engine: "none", model: "none", error_note: "LLAMA_CLOUD_API_KEY not set" }),
    ]);
    expect(s.shortReason).toBe("API key missing");
    expect(s.statement).toMatch(/API key is not set/i);
  });
});

describe("llamaparse-status-core: bundled self-tests", () => {
  it("all pure self-tests pass", () => {
    const out = __runLlamaParseStatusCoreTests();
    expect(out).toMatch(/assertions passed/);
  });
});
