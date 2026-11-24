import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("USAGE-10d — PDP sensory pills render from a client component", () => {
  it("ChipGroup is a client component with the same pill markup", () => {
    const chips = read("src/components/menu/SensoryChipGroup.tsx");
    expect(chips.startsWith('"use client"')).toBe(true);
    expect(chips).toContain("inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold capitalize text-zinc-200");
    expect(chips).toContain("borderColor: accent");
  });
  it("the PDP imports it and no longer defines the pills inline", () => {
    const pdp = read("src/app/(site)/menu/products/[id]/page.tsx");
    expect(pdp).toContain('from "@/components/menu/SensoryChipGroup"');
    expect(pdp).not.toContain("function ChipGroup(");
    expect((pdp.match(/<ChipGroup /g) ?? []).length).toBe(4);
  });
});
