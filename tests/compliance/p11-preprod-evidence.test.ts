/**
 * P-11 run P20261007A (PREprod, 2026-10-07): the owner's verbatim success
 * emails. Pins U-36 CLOSED: two Inventory files named one second apart were
 * both accepted, and the Update naming both lots was accepted, so both were
 * stored. Also pins how our parser reads these exact emails.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { successEmailFileNames } from "@/lib/compliance/ccrs-outcome-core";
import { buildP11 } from "../../scripts/compliance/generate-p11-chunk-naming-probe";

const ROOT = path.resolve(__dirname, "../..");
const EV = path.join(ROOT, "docs/ccrs-bible/evidence/P20261007A");
const emails = readFileSync(path.join(EV, "success-emails-2026-10-07.txt"), "utf8");

describe("P-11 evidence (P20261007A)", () => {
  it("seven success emails, every one 'has been processed'", () => {
    expect(emails.match(/you submitted has been processed\./g)?.length).toBe(7);
    expect(emails).not.toMatch(/error/i);
  });
  it("the names CCRS echoed are the files the generator made for this run (stamp 2026-10-06 22:28:47 PT)", () => {
    // 2026-10-07T05:28:47Z = 2026-10-06 22:28:47 PDT, the generation time in the names.
    const made = buildP11("P20261007A", "413541", new Date("2026-10-07T05:28:47.000Z")).map((f) => f.fileName);
    for (const name of made) expect(emails).toContain(name.replace(/\.csv$/, "_"));
  });
  it("our parser reads the six un-suffixed names in upload order (production never suffixes)", () => {
    expect(successEmailFileNames(emails)).toEqual([
      "Strain_413541_20261006222847.csv",
      "Area_413541_20261006222848.csv",
      "Product_413541_20261006222849.csv",
      "Inventory_413541_20261006222850.csv",
      "Inventory_413541_20261006222851.csv",
      "Inventory_413541_20261006222853.csv",
    ]);
  });
  it("the chunk pair differs by exactly one second and both were processed", () => {
    expect(emails).toContain("Inventory_413541_20261006222850_");
    expect(emails).toContain("Inventory_413541_20261006222851_");
  });
  it("the 10-minute prerequisite wait was respected (Product 10:38:06 -> first Inventory 10:57:33)", () => {
    const t = (s: string) => {
      const m = emails.match(new RegExp(`${s}_[^ ]+ you submitted has been processed\\.  Date Submitted: 10/7/2026 (\\d+):(\\d+):(\\d+) AM`))!;
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    };
    expect(t("Inventory_413541_20261006222850") - t("Product_413541_20261006222849")).toBeGreaterThanOrEqual(600);
  });
  it("U-36 is recorded CLOSED in the register", () => {
    const reg = readFileSync(path.join(ROOT, "docs/ccrs-bible/12-unverified-register.md"), "utf8");
    const row = reg.split("\n").find((l) => l.startsWith("| U-36 |"))!;
    expect(row).toMatch(/CLOSED 2026-10-07/);
  });
});
