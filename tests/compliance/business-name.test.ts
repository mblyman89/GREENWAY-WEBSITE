/**
 * The business is "Greenway Marijuana" (trade name; legal name Lymans
 * Marijuana LLC). The owner, Michael Lyman, asked in round 8 that the
 * work use "greenway marijuana", never the wrong name (paraphrased: his
 * exact words contain the forbidden name, so they cannot sit in a file
 * this test scans).
 *
 * This walks every tracked text file in the repo and refuses the wrong
 * name in any spelling: "Greenway" followed (with or without a space, dash,
 * dot or underscore) by the word for the plant, in any case, including the
 * 16-character batch cut. Generic product words ("cannabis retailer",
 * "Non-cannabis") are fine, and so is the data type GreenwayCannabinoid.
 *
 * The forbidden word is built from pieces so this file does not trip its
 * own check.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// "(?!noid)": the code type GreenwayCannabinoid (a THC/CBD value record in
// src/lib/leafly/types.ts) is a data-shape name, not the business name.
const WRONG = new RegExp("green" + "way[\\s_.-]*canna" + "bi(?!noid)", "i");
const TEXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|sql|md|mdx|txt|json|ya?ml|html|css|sh|toml|env\.example|csv|log)$/i;

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((f) => f && TEXT.test(f));
}

describe("business name: Greenway Marijuana, never the wrong name", () => {
  it("the pattern catches every spelling it is meant to (test the test)", () => {
    const bad = ["Gr" + "eenway Cannabis", "gr" + "eenwaycannabis", "GR" + "EENWAY CANNABI", "gr" + "eenway-cannabis", "Gr" + "eenway_Cannabis Co"];
    for (const b of bad) expect(WRONG.test(b), b).toBe(true);
    const fine = ["Greenway Marijuana", "GREENWAY MARIJUA", "a licensed cannabis retailer", "Non-cannabis items", "Greenway sells cannabis", "Green" + "wayCannabinoid[]"];
    for (const f of fine) expect(WRONG.test(f), f).toBe(false);
  });

  it("no tracked text file uses the wrong business name", () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(1000);
    const hits: string[] = [];
    for (const f of files) {
      let s: string;
      try {
        s = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (!WRONG.test(s)) continue;
      s.split("\n").forEach((line, i) => {
        if (WRONG.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the store's default name is Greenway Marijuana", () => {
    const src = readFileSync("src/lib/admin/store-profile-core.ts", "utf8");
    expect(src).toContain('storeName: "Greenway Marijuana",');
  });
});
