import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_PAGE_TTL_SECONDS,
  CONTENT_PAGE_WRITERS,
  routeRevalidateSeconds,
  __runContentPageTtlTests,
} from "@/lib/site/content-page-ttl-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-8e: content-only pages use a 3600 s floor, cleared on publish", () => {
  it("self-test passes", () => {
    expect(__runContentPageTtlTests().failed).toBe(0);
  });
  for (const [route, writers] of Object.entries(CONTENT_PAGE_WRITERS)) {
    const path = route.includes("loyalty") ? '"/loyalty"' : '"/medical"';
    it(`${route} has the 3600 s floor and every writer clears it`, () => {
      expect(routeRevalidateSeconds(read(route))).toBe(CONTENT_PAGE_TTL_SECONDS);
      for (const w of writers) expect(read(w)).toContain(`revalidatePath(${path})`);
    });
  }
});
