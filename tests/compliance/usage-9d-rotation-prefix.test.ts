import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __runRotationListsPackTests } from "@/lib/menu/rotation-lists-pack-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-9d: rotation lists ship with a shared prefix", () => {
  it("self-test passes", () => {
    expect(__runRotationListsPackTests().failed).toBe(0);
  });
  it("layout packs, provider unpacks", () => {
    expect(read("src/app/(site)/layout.tsx")).toContain("packed={packRotationLists(rotationLists)}");
    expect(read("src/components/menu/fallback-rotation/MenuCardRotationProvider.tsx")).toContain("unpackRotationLists(packed)");
  });
});
