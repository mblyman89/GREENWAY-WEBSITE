/**
 * tests/compliance/form-facsimile-core.test.ts   (books-61)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FORM AS IT PRINTS, PROVED AGAINST THE AGENCY'S OWN RECTANGLES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael: "i am hoping that for all the various forms, i can see the form as
 * it would look if i were holding it in my hand ... this form would get filled
 * with real data automatically as it should". And, raising the bar: "It's meant
 * to be a part of the process for bookkeeping and taxes, not just informative."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE MODE THIS FILE EXISTS FOR
 * ─────────────────────────────────────────────────────────────────────────
 * A facsimile fails SILENTLY and BEAUTIFULLY. A W-2 with an empty box b reads
 * as a blank form, not a broken one; a 941 with no EIN looks like a form you
 * have not started yet. Both were REAL defects in this slice - measured, not
 * imagined: 18 of page 1's 70 rectangles and 32 of page 2's 35 were going
 * unplaced, and nobody had noticed, because the specimen screenshots looked
 * complete.
 *
 * So the gates here are about COVERAGE and ATTRIBUTION, not appearance. Every
 * rectangle the agency put on the page must be either filled, or recorded as
 * deliberately blank with a reason. There is no third category, because the
 * third category is the bug.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE ORACLE IS HIS OWN FILED RETURN
 * ─────────────────────────────────────────────────────────────────────────
 * Standing rule 115: a filed return outranks my reasoning. The EIN split, the
 * legal-name/trade-name distinction and the two-up W-2 pitch are all asserted
 * against 2ND_QTR_FORM_941.pdf and 2025_FORM_W-2_EMPLOYEE.pdf, which are
 * documents the agencies accepted.
 */
import { describe, expect, it } from "vitest";

import {
  facsimileBoxes,
  nine41IdentityText,
  copiesOnSheet,
  paginateRun,
  byPaperOrder,
  type W2Employer,
} from "@/lib/payroll/form-facsimile-core";
import { form941Boxes } from "@/lib/payroll/form-box-adapters";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import geometry from "@/lib/payroll/form-geometry.generated.json";
import boxMap from "@/lib/payroll/form-box-map.generated.json";

type Geo = Readonly<
  Record<
    string,
    {
      readonly width: number;
      readonly height: number;
      readonly fields: readonly {
        readonly name: string;
        readonly comb: boolean;
        readonly maxLen: number | null;
      }[];
    }
  >
>;
type Map_ = Readonly<
  Record<
    string,
    {
      readonly copies: readonly Readonly<Record<string, readonly string[]>>[];
      readonly unclaimed?: readonly string[];
      readonly unclaimedReasons?: Readonly<Record<string, string>>;
    }
  >
>;

const GEO = geometry as unknown as Geo;
const MAP = boxMap as unknown as Map_;

/** The three pages this slice renders. */
const PAGES = ["941-p1", "941-p2", "w2-copyb"] as const;

/**
 * His registered details, read off his filed Q2 941 with `pdftotext -layout`.
 * NOT invented, and deliberately including the apostrophe in the legal name,
 * which is the character most likely to be mangled by a naive pipeline.
 */
const GREENWAY: W2Employer = {
  ein: "464217016",
  legalName: "LYMAN'S MARIJUANA",
  street: "4851 GEIGER RD SE",
  city: "PORT ORCHARD",
  state: "WA",
  zip: "98366",
};
const GREENWAY_TRADE = "GREENWAY MARIJUANA";

describe("form geometry: measured from the agency PDFs, not typed in", () => {
  it("has every page this slice renders", () => {
    for (const key of PAGES) {
      expect(GEO[key], `geometry is missing ${key}`).toBeDefined();
      expect(GEO[key].fields.length).toBeGreaterThan(0);
    }
  });

  /*
   * The rect counts are pinned because a REGENERATION that silently drops
   * fields is the exact accident this whole slice was recovering from. If the
   * IRS reissues the form these numbers change - and they should change
   * DELIBERATELY, in a commit that says so.
   */
  it("pins the rectangle count of each page as measured", () => {
    expect(GEO["941-p1"].fields.length).toBe(70);
    expect(GEO["941-p2"].fields.length).toBe(35);
    expect(GEO["w2-copyb"].fields.length).toBe(94);
  });

  it("pins the page sizes measured with pdfinfo", () => {
    // f941.pdf reports 611.976 x 791.968pt; fw2.pdf reports exactly 612 x 792.
    expect(GEO["941-p1"].width).toBeCloseTo(611.976, 2);
    expect(GEO["941-p1"].height).toBeCloseTo(791.968, 2);
    expect(GEO["w2-copyb"].width).toBeCloseTo(612, 2);
  });

  /*
   * ═══ COMB FIELDS ═══
   *
   * /Ff bit 25 divides a box into /MaxLen equal cells, one character each. It
   * is why his filed 941 prints the EIN as "4 6 - 4 2 1 7 0 1 6" rather than as
   * a word. A comb field with no /MaxLen has no cell count and the deriver
   * refuses it rather than guessing one.
   */
  it("finds exactly the comb fields measured, each with a cell count", () => {
    const combs = PAGES.flatMap((k) =>
      GEO[k].fields.filter((f) => f.comb).map((f) => `${k}:${f.name}`),
    );
    // 4 on 941 page 1 (EIN prefix, EIN body, routing, account), 2 on page 2.
    expect(combs.length).toBe(6);
    // The W-2 has none: measured, and asserted so a future regeneration that
    // invents some is noticed.
    expect(GEO["w2-copyb"].fields.some((f) => f.comb)).toBe(false);

    for (const key of PAGES) {
      for (const f of GEO[key].fields) {
        if (f.comb) expect(f.maxLen, `${key}:${f.name} is comb with no maxLen`).not.toBeNull();
      }
    }
  });
});

describe("box map: every rectangle is accounted for", () => {
  /*
   * THE CENTRAL GATE (standing rule 123). Filled, or blank-with-a-reason.
   * Nothing may be merely absent, because merely-absent is what an unfilled
   * EIN box looked like.
   */
  it("leaves no rectangle unexplained on any page", () => {
    for (const key of PAGES) {
      const placed = new Set(
        MAP[key].copies.flatMap((c) => Object.values(c).flatMap((n) => [...n])),
      );
      const unclaimed = new Set(MAP[key].unclaimed ?? []);
      const orphans = GEO[key].fields
        .map((f) => f.name)
        .filter((n) => !placed.has(n) && !unclaimed.has(n));
      expect(orphans, `${key} has rectangles that are neither placed nor recorded blank`).toEqual(
        [],
      );
    }
  });

  it("gives every deliberately-blank rectangle a written reason", () => {
    for (const key of PAGES) {
      const reasons = MAP[key].unclaimedReasons ?? {};
      for (const name of MAP[key].unclaimed ?? []) {
        const why = reasons[name];
        expect(why, `${key}:${name} is blank with no reason`).toBeTruthy();
        // A reason has to be a sentence, not a shrug.
        expect(why.length, `${key}:${name} reason is too short to be one`).toBeGreaterThan(30);
      }
    }
  });

  /*
   * The W-2 prints TWO forms on one sheet at a measured 396.0pt pitch. Getting
   * this wrong prints one employee's wages on another employee's copy, which is
   * a disclosure incident rather than a layout bug.
   */
  it("keeps the W-2 two-up and the 941 one-up, as the paper is", () => {
    expect(copiesOnSheet("w2-copyb")).toBe(2);
    expect(copiesOnSheet("941-p1")).toBe(1);
    expect(copiesOnSheet("941-p2")).toBe(1);
  });
});

describe("nine41IdentityText: the top of the return", () => {
  const id = nine41IdentityText(GREENWAY, GREENWAY_TRADE);

  it("splits the EIN across the two comb boxes, without the hyphen", () => {
    // His filed return prints "4 6 - 4 2 1 7 0 1 6": the hyphen is PRINTED
    // ARTWORK between two separate boxes, not a character in either of them.
    expect(id["ein"]).toEqual(["46", "4217016"]);
  });

  it("keeps the legal name and the trade name in different boxes", () => {
    /*
     * The single most consequential assertion in this file. The IRS matches a
     * return to an account on the EIN plus the NAME CONTROL - the first four
     * characters of the name the EIN was issued to. Greenway trades as
     * "GREENWAY MARIJUANA" but the EIN belongs to "LYMAN'S MARIJUANA", so
     * printing the trading name in the name box is a mismatch, and a mismatched
     * return does not post.
     */
    expect(id["name"]).toEqual(["LYMAN'S MARIJUANA"]);
    expect(id["tradeName"]).toEqual([GREENWAY_TRADE]);
  });

  it("fills city, state and ZIP positionally so a gap cannot shift them", () => {
    expect(id["cityStateZip"]).toEqual(["PORT ORCHARD", "WA", "98366"]);

    // With no city, the ZIP must STAY in the ZIP box rather than sliding left.
    const noCity = nine41IdentityText({ ...GREENWAY, city: null }, GREENWAY_TRADE);
    expect(noCity["cityStateZip"]).toEqual(["", "WA", "98366"]);
  });

  it("omits what it does not know rather than inventing it", () => {
    const empty = nine41IdentityText(
      { ein: null, legalName: null, street: null, city: null, state: null, zip: null },
      null,
    );
    expect(Object.keys(empty)).toEqual([]);
  });
});

describe("the 941 actually carries his identity onto both sheets", () => {
  /*
   * Built from the lines the ENGINE emits, listed here as the oracle. If the
   * engine gains or loses a line this list is what says so out loud.
   */
  const ENGINE_LINES = ["1", "2", "3", "5a", "5c", "5e", "6", "7", "10", "12", "13", "14", "15a"];

  const ret = {
    ok: true as const,
    subjectCount: 2,
    oasdiTaxableWagesCents: 100_000,
    medicareTaxableWagesCents: 100_000,
    lines: ENGINE_LINES.map((line) => ({
      line,
      caption: `line ${line}`,
      amountCents: line === "1" ? 2 : 100_000,
      isCount: line === "1",
      derivation: "measured in the test",
    })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boxes = form941Boxes(ret as any);
  const identity = nine41IdentityText(GREENWAY, GREENWAY_TRADE);
  const columnOne = { "5a": 100_000, "5c": 100_000 };

  it("emits the five entity boxes BEFORE the numbered lines", () => {
    expect(boxes.slice(0, 5).map((b) => b.box)).toEqual([
      "ein",
      "name",
      "tradeName",
      "address",
      "cityStateZip",
    ]);
    expect(boxes.length).toBe(5 + ENGINE_LINES.length);
  });

  /** What actually landed in each rectangle, as text. */
  const textOf = (pageKey: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const b of facsimileBoxes(pageKey, boxes, FORM_941_LESSONS, columnOne, 0, identity)) {
      for (const s of b.slots) if (s.text) out.set(s.rect.name, s.text);
    }
    return out;
  };

  it("prints the EIN, name, trade name and address on page 1", () => {
    const t = textOf("941-p1");
    const find = (suffix: string): string | undefined =>
      [...t.entries()].find(([n]) => n.endsWith(suffix))?.[1];

    expect(find("EntityArea[0].f1_1[0]")).toBe("46");
    expect(find("EntityArea[0].f1_2[0]")).toBe("4217016");
    expect(find("EntityArea[0].f1_3[0]")).toBe("LYMAN'S MARIJUANA");
    expect(find("EntityArea[0].f1_4[0]")).toBe(GREENWAY_TRADE);
    expect(find("EntityArea[0].f1_5[0]")).toBe("4851 GEIGER RD SE");
    expect(find("EntityArea[0].f1_6[0]")).toBe("PORT ORCHARD");
    expect(find("EntityArea[0].f1_7[0]")).toBe("WA");
    expect(find("EntityArea[0].f1_8[0]")).toBe("98366");
  });

  it("repeats the name and EIN in the page 2 header", () => {
    /*
     * Page 2 is not optional decoration. The IRS's own instruction is that the
     * pages can be separated in handling, which is why the form repeats the
     * identifiers - so a page 2 with an anonymous header is the same defect as
     * page 1 had, just harder to notice.
     */
    const t = textOf("941-p2");
    const find = (suffix: string): string | undefined =>
      [...t.entries()].find(([n]) => n.endsWith(suffix))?.[1];

    expect(find("EIN_Number[0].f1_1[0]")).toBe("46");
    expect(find("EIN_Number[0].f1_2[0]")).toBe("4217016");
    expect(find("Name_ReadOrder[0].f1_3[0]")).toBe("LYMAN'S MARIJUANA");
  });

  it("prints nothing at all where the profile is empty", () => {
    /*
     * The alternative to a blank box is a plausible one. A placeholder EIN on a
     * form that can be printed and filed is far worse than an obvious gap.
     */
    const none = facsimileBoxes("941-p1", boxes, FORM_941_LESSONS, columnOne, 0, {});
    const entity = none.filter((b) =>
      ["ein", "name", "tradeName", "address", "cityStateZip"].includes(String(b.box.box)),
    );
    expect(entity.length).toBe(5);
    for (const b of entity) {
      for (const s of b.slots) expect(s.text, `${b.box.box} invented a value`).toBeFalsy();
    }
  });
});

describe("paginateRun: his filed W-2 run, reproduced", () => {
  /*
   * Sage printed Greenway's ten 2025 W-2s in this order across five sheets.
   * Read off 2025_FORM_W-2_EMPLOYEE.pdf. Two employees are called Michael, so
   * the surname tie-break is load-bearing rather than tidy.
   */
  const SAGE: readonly (readonly (readonly [string, string])[])[] = [
    [["TERI L BECKER", "BECKER"], ["STEPHEN BENOIT", "BENOIT"]],
    [["ANGELA BRITTON", "BRITTON"], ["LARRY E DEE", "DEE"]],
    [["BAILEY GIOVANNINI", "GIOVANNINI"], ["JERMAINE JOHNSON", "JOHNSON"]],
    [["MICHAEL B LYMAN", "LYMAN"], ["ISANA SOLIS", "SOLIS"]],
    [["RAELENE Q TAITAGUE", "TAITAGUE"], ["MICHAEL W ZENGER", "ZENGER"]],
  ];

  it("puts the same people on the same sheets, from shuffled input", () => {
    const subj = (p: readonly [string, string]) => ({ label: p[0], sortKey: p[1], value: p[0] });
    // Reversed on purpose: a comparator that does nothing fails loudly here.
    const run = paginateRun("w2-copyb", [...SAGE.flat()].reverse().map(subj), byPaperOrder);

    expect(run.sheets.length).toBe(SAGE.length);
    run.sheets.forEach((s, i) => {
      expect(s.subjects.map((x) => x.label)).toEqual(SAGE[i].map((p) => p[0]));
    });
  });

  it("leaves the last sheet short rather than padding it", () => {
    const subj = (p: readonly [string, string]) => ({ label: p[0], sortKey: p[1], value: p[0] });
    const odd = paginateRun("w2-copyb", SAGE.flat().slice(0, 9).map(subj), byPaperOrder);
    expect(odd.sheets.length).toBe(5);
    expect(odd.sheets[4].subjects.length).toBe(1);
  });

  it("still produces one sheet when nobody is on the payroll", () => {
    // Zero sheets would render as a page that failed to load.
    const none = paginateRun("w2-copyb", [], byPaperOrder);
    expect(none.sheets.length).toBe(1);
    expect(none.sheets[0].subjects.length).toBe(0);
  });
});
