/**
 * Vitest mirror of the postgrest-escape pure self-tests (GW-021).
 * Locks the shared search-term escaping so a user typing `%`, `_`, commas,
 * or parentheses into any list search box gets a literal match instead of
 * broken or over-broad `.or()` filter grammar.
 */
import { describe, expect, it } from "vitest";

import {
  escapeLikeWildcards,
  escapeIlikeOrTerm,
  ilikeContains,
  __runPostgrestEscapeTests,
} from "@/lib/supabase/postgrest-escape";

describe("postgrest-escape", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runPostgrestEscapeTests()).not.toThrow();
  });

  it("escapes LIKE wildcards and the escape char", () => {
    expect(escapeLikeWildcards("50% off_deal\\x")).toBe("50\\% off\\_deal\\\\x");
    expect(escapeLikeWildcards("plain")).toBe("plain");
  });

  it("neutralizes .or() grammar characters", () => {
    expect(escapeIlikeOrTerm("50%,off")).toBe("50\\% off");
    expect(escapeIlikeOrTerm("a(b)c")).toBe("a b c");
    expect(escapeIlikeOrTerm("O'Neil")).toBe("O'Neil");
  });

  it("builds a contains pattern or null when nothing searchable remains", () => {
    expect(ilikeContains("sarah")).toBe("%sarah%");
    expect(ilikeContains("50%,off")).toBe("%50\\% off%");
    expect(ilikeContains("   ")).toBeNull();
    expect(ilikeContains("(),,")).toBeNull();
  });
});
