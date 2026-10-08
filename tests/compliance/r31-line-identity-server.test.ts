/**
 * tests/compliance/r31-line-identity-server.test.ts — R31: the per-line
 * identity chip loader is read-only, never throws, and degrades to "no chips"
 * instead of a wrong match. The manifest review page awaits it directly, so a
 * throw here would break the whole page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const st = vi.hoisted(() => ({ mode: "throw" as "throw" | "error" | "empty" | "unconfigured", writes: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return st.mode !== "unconfigured";
  },
}));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (st.mode === "throw") throw new Error("network down");
    const q = {
      select: () => q,
      eq: async () => (st.mode === "error" ? { data: null, error: { message: "db" } } : { data: [], error: null }),
      insert: () => {
        st.writes += 1;
        return q;
      },
      update: () => {
        st.writes += 1;
        return q;
      },
      upsert: () => {
        st.writes += 1;
        return q;
      },
    };
    return { from: () => q };
  },
}));

beforeEach(() => {
  st.writes = 0;
});

describe("loadLineIdentityChips never breaks the page", () => {
  for (const mode of ["throw", "error", "empty", "unconfigured"] as const) {
    it(`${mode}: resolves to an empty map (no chips, never a wrong one)`, async () => {
      st.mode = mode;
      const { loadLineIdentityChips } = await import("@/lib/inventory/line-identity-server");
      const out = await loadLineIdentityChips("m-1", new Map());
      expect(out).toBeInstanceOf(Map);
      expect(out.size).toBe(0);
      expect(st.writes).toBe(0);
    });
  }
  it("source: server-only, read-only, catch-all", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src/lib/inventory/line-identity-server.ts"), "utf8");
    expect(src).toContain('import "server-only";');
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).toMatch(/\} catch \(err\) \{\s*console\.error\("\[line-identity\] chip load failed \(no chips shown\):", err\);\s*return new Map\(\);/);
  });
});
