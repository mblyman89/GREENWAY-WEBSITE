import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_LOADING_FILES, hasUseClientDirective, __runClientLoadingTests } from "@/lib/site/client-loading-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-8a: loading skeletons are client references, not RSC trees", () => {
  it("self-test passes", () => {
    expect(__runClientLoadingTests().failed).toBe(0);
  });
  it.each(CLIENT_LOADING_FILES)("%s is a client component with no data access", (file) => {
    const src = read(file);
    expect(hasUseClientDirective(src)).toBe(true);
    expect(src).not.toContain("await ");
    expect(src).not.toContain("async function");
  });
  it("the shared skeleton it imports is client-safe", () => {
    const src = read("src/components/menu/MenuSkeleton.tsx") + read("src/lib/menu/menu-skeleton-core.ts");
    expect(src).not.toContain("server-only");
    expect(src).not.toContain("next/headers");
  });
});
