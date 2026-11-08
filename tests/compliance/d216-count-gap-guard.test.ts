/**
 * D216: the iPad count names an empty box (the nickels case).
 * Owner: "it did not tell her that there were no nickels entered into the box.
 * Will you please protect the register from this in the future and help them
 * out when they make a mistake like this."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCountGapTests,
  countGapHelp,
  countGapAudit,
  SALES_FLOAT_MIX,
  COUNT_BLANK_BOX_AUDIT,
} from "../../src/lib/registers/count-gap-core";
import { EMPTY_DENOMS, type DenomCounts } from "../../src/lib/registers/cash";
import { validateTillRequest } from "../../src/lib/pos/till-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const std = { ...SALES_FLOAT_MIX } as DenomCounts;

describe("D216 count-gap core", () => {
  it("self-tests pass, exact count", () => {
    const r = __runCountGapTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(24);
  });
  it("the owner's morning: no nickels is named, with 40 and $2.00", () => {
    const h = countGapHelp({ ...std, nickels: 0 }, "open", 16750);
    expect(h.blanks).toEqual(["nickels"]);
    expect(h.lines[0]).toMatch(/nickels.*empty.*40 nickels.*\$2\.00/);
    expect(h.explainsShort).toMatch(/\$2\.00 short: exactly the 40 nickels/);
  });
  it("what production saved (0 nickels, 52 x $1) is still flagged and the mix named", () => {
    const h = countGapHelp({ ...std, nickels: 0, ones: 52 }, "open", 16750);
    expect(h.needsConfirm).toBe(true);
    expect(h.mixNote).toMatch(/normally 40/);
  });
  it("close stays blind", () => {
    const h = countGapHelp({ ...EMPTY_DENOMS, twenties: 30, ones: 20, quarters: 5, dimes: 5, pennies: 5 }, "close");
    expect(h.blanks).toEqual(["nickels"]);
    expect(h.lines.join(" ")).not.toMatch(/\$\d/);
  });
  it("audit row holds box names only", () => {
    expect(countGapAudit({ ...std, nickels: 0 }, "open", 16750, true)).toEqual({ mode: "open", blankBoxes: ["nickels"], recountConfirmed: true });
    expect(COUNT_BLANK_BOX_AUDIT).toBe("drawer.count_blank_box");
  });
});

describe("D216 wiring", () => {
  it("count-in request carries recountConfirmed", () => {
    const v = validateTillRequest({ action: "open", pin: "1234", denoms: { ones: 50 }, recountConfirmed: true });
    expect(v.ok && v.req.action === "open" && v.req.recountConfirmed === true).toBe(true);
    const w = validateTillRequest({ action: "open", pin: "1234", denoms: { ones: 50 } });
    expect(w.ok && w.req.action === "open" && w.req.recountConfirmed).toBeFalsy();
  });
  it("iPad screen shows the empty box at count-in and close, and needs the tick", () => {
    const s = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(s).toContain("countGapHelp(denoms, mode, standardFloatMinor)");
    expect(s).toContain('data-testid="open-count-gaps"');
    expect(s).toContain("data-testid={`count-blank-${g.k}`}");
    expect(s).toContain("I counted again and the empty box is really empty");
    expect(s).toMatch(/\(!needsRecount \|\| recountConfirmed\)/);
    expect(s).toContain("openNeedsRecount && recountConfirmed ? { recountConfirmed: true }");
  });
  it("server and offline replay audit the empty boxes (never block)", () => {
    const r = read("src/app/api/pos/till/route.ts");
    expect(r.match(/countGapAudit\(/g)?.length).toBe(2);
    const o = read("src/lib/pos/offline-till-store.ts");
    expect(o.match(/countGapAudit\(/g)?.length).toBe(2);
    expect(read("src/lib/pos/offline-till-core.ts")).toContain('p.action === "open" && p.recountConfirmed');
  });
});
