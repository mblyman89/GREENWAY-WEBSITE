/**
 * company-identity-core.test.ts
 *
 * Guards the engine that decides whether Greenway's stored company information
 * is good enough to produce a federal or state filing.
 *
 * WHY THIS FILE IS LONG. Michael's directive was that everything downstream
 * flows from the company information page. The failure mode of such a design is
 * not a crash - it is a form that renders, looks filed, and is wrong, because a
 * builder found nothing and substituted a blank. Every test below exists to
 * make that specific outcome impossible.
 *
 * Standing rules exercised: 1 (never guess), 39 (guard vacuous reads),
 * 40 (load-bearing rules get tested), 48 (a check that cannot classify its
 * input must FAIL, not skip), 62 (build for the slice after next).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMPANY_FIELDS,
  COMPANY_FORMS,
  FORM_TITLES,
  STORABLE_ENTITY_TYPES,
  allFormReadiness,
  assertEveryFieldAuthorityExists,
  assertEveryFormHasFields,
  assertEverySignerRuleExists,
  assertNoFieldWithoutConsumers,
  fieldsForForm,
  formReadiness,
  formatEin,
  normaliseEinInput,
  requireField,
  signerRuleFor,
  type CompanyForm,
  type CompanyProfileValues,
} from "@/lib/accounting/company-identity-core";

/**
 * Greenway's real identity, as Michael supplied it.
 *
 * Deliberately the REAL values rather than "Test Co" placeholders. A fixture of
 * invented data proves the engine accepts invented data. This proves the engine
 * accepts Greenway, which is the only question that matters here.
 */
const GREENWAY: CompanyProfileValues = {
  ein: "464217016",
  legal_name: "LYMAN'S MARIJUANA L.L.C.",
  trade_name: "Greenway Marijuana",
  entity_type: "llc_s_corp",
  federal_return_form: "941",
  deposit_schedule: "monthly",
  address_line1: "4851 GEIGER RD SE",
  city: "PORT ORCHARD",
  state_code: "WA",
  zip_code: "983679350",
  contact_name: "Michael Lyman",
  contact_phone: "3605551234",
  contact_email: "michael@greenwaymarijuana.com",
  signer_name: "Michael Lyman",
  // "President", not "Owner". The mentor lesson for this field says outright
  // that "Owner" describes an LLC interest rather than a corporate office, and
  // the Part 5 rule for an LLC treated as a corporation wants a principal
  // officer. A fixture that used the value our own guidance calls wrong would
  // be teaching one thing and testing another.
  signer_title: "President",
  esd_account_number: "000-073905-00-0",
  wa_ubi: "603353555",
  lni_account_number: "521,756-00",
  lni_risk_class: "6403",
  suta_state_code: "WA",
};

describe("the field registry is consumer-driven", () => {
  it("declares the fields the screen was built to collect", () => {
    expect(COMPANY_FIELDS.length).toBe(20);
    expect(COMPANY_FORMS.length).toBe(10);
  });

  it("is not empty, because an empty registry makes every readiness check vacuous", () => {
    // Rule 39. With no fields, every form would report ready:true forever.
    expect(COMPANY_FIELDS.length).toBeGreaterThan(0);
  });

  it("has no duplicate field names", () => {
    const names = COMPANY_FIELDS.map((f) => f.field);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("gives every field at least one consumer", () => {
    // The whole design rests on this: a field nothing consumes appears in no
    // readiness check, so nothing would ever tell Michael it was blank, while
    // its presence on the screen makes it look covered.
    expect(() => assertNoFieldWithoutConsumers()).not.toThrow();
    expect(COMPANY_FIELDS.filter((f) => f.consumers.length === 0)).toEqual([]);
  });

  it("gives every form at least one field", () => {
    expect(() => assertEveryFormHasFields()).not.toThrow();
  });

  it("names only declared forms as consumers", () => {
    const known = new Set<string>(COMPANY_FORMS);
    const bad: string[] = [];
    for (const f of COMPANY_FIELDS) {
      for (const c of f.consumers) if (!known.has(c.form)) bad.push(`${f.field} -> ${c.form}`);
    }
    expect(bad).toEqual([]);
  });

  it("gives every form a title", () => {
    const untitled = COMPANY_FORMS.filter((f) => !FORM_TITLES[f] || FORM_TITLES[f].trim() === "");
    expect(untitled).toEqual([]);
  });

  it("resolves every authority a field cites", () => {
    expect(() => assertEveryFieldAuthorityExists()).not.toThrow();
  });

  it("pairs every pattern with an explanation a human can act on", () => {
    // A rejected value with no explanation is a dead end. If the engine is
    // going to refuse "46-4217016" it has to say what shape it wanted.
    const silent = COMPANY_FIELDS.filter((f) => f.pattern && (!f.patternHelp || f.patternHelp.length < 20));
    expect(silent.map((f) => f.field)).toEqual([]);
  });

  it("records the honest debt where no authority has been mirrored yet", () => {
    // The two L&I fields carry empty authorityIds because Washington's L&I
    // quarterly-report instructions are not mirrored. Standing rule 24 forbids
    // inventing a citation to fill the gap, so the gap is visible instead. This
    // test exists so that mirroring them later is a deliberate act.
    const undocumented = COMPANY_FIELDS.filter((f) => f.authorityIds.length === 0).map((f) => f.field);
    expect(undocumented).toEqual(["lni_account_number", "lni_risk_class"]);
  });
});

describe("formatEin refuses rather than inventing a taxpayer", () => {
  it("formats Greenway's EIN the way the IRS prints it", () => {
    expect(formatEin("464217016")).toBe("46-4217016");
  });

  it.each([
    ["46421701", "eight digits"],
    ["4642170166", "ten digits"],
    ["46-4217016", "already punctuated"],
    ["", "empty"],
    ["46421701X", "contains a letter"],
    ["   464217016", "padded with spaces"],
  ])("throws on %s (%s) instead of padding it", (bad) => {
    // Padding an eight-digit number to nine invents an identification number
    // that belongs to somebody else, or to nobody. Refusing is the only safe
    // behaviour, and the message names the offending value.
    expect(() => formatEin(bad)).toThrow(/refusing to format/i);
    expect(() => formatEin(bad)).toThrow(/nine digits/i);
  });
});

describe("normaliseEinInput accepts what a human pastes and nothing more", () => {
  it("strips the hyphen from a number copied off a CP 575 letter", () => {
    expect(normaliseEinInput("46-4217016")).toBe("464217016");
  });

  it("strips surrounding spaces", () => {
    expect(normaliseEinInput(" 46 4217016 ")).toBe("464217016");
  });

  it("returns null rather than salvaging digits out of a label", () => {
    // "EIN 46-4217016" must NOT become 464217016 by discarding letters. That
    // path leads to accepting "SSN 464217016" as an EIN.
    expect(normaliseEinInput("EIN 46-4217016")).toBeNull();
  });

  it.each([["12345"], [""], ["4642170166"], ["abcdefghi"]])("returns null for %s", (bad) => {
    expect(normaliseEinInput(bad)).toBeNull();
  });
});

describe("signerRuleFor answers for every classification the database can store", () => {
  /**
   * THE BUG THIS SECTION CAUGHT. The first draft handled the four corporate
   * cases and the disregarded LLC, returning null for the other four values
   * `company_profile.entity_type` accepts - and cited standing rule 48 as the
   * justification. That was rule 48 used as an excuse for unfinished work. Null
   * is for input the AUTHORITY does not address, not for cases the author did
   * not get to. The Instructions for Form 941 Part 5 cover all nine.
   */
  it("returns a rule and a resolvable authority for all nine storable types", () => {
    expect(STORABLE_ENTITY_TYPES.length).toBe(9);
    for (const t of STORABLE_ENTITY_TYPES) {
      const rule = signerRuleFor(t);
      expect(rule, `${t} must have a signer rule`).not.toBeNull();
      expect(rule?.rule.length ?? 0).toBeGreaterThan(20);
      expect(rule?.authorityId).toMatch(/^i941-2026-signer-/);
    }
  });

  it("puts Greenway under the corporation rule because of the S election", () => {
    // Michael's LLC elected S treatment, so it is "an LLC treated as a
    // corporation" and signs as a principal officer - not under the
    // disregarded-entity rule a single-member LLC would otherwise use.
    expect(signerRuleFor("llc_s_corp")?.authorityId).toBe("i941-2026-signer-corporation");
  });

  it("keeps the disregarded-entity rule distinct from the corporation rule", () => {
    expect(signerRuleFor("llc_disregarded")?.authorityId).toBe("i941-2026-signer-single-member-llc");
  });

  it("groups partnerships and LLCs treated as partnerships under one rule", () => {
    expect(signerRuleFor("partnership")?.authorityId).toBe("i941-2026-signer-partnership");
    expect(signerRuleFor("llc_partnership")?.authorityId).toBe("i941-2026-signer-partnership");
  });

  it("carries the knowledge-of-affairs requirement into the plain-English rule", () => {
    expect(signerRuleFor("partnership")?.rule).toMatch(/knowledge/i);
  });

  it("returns null only for input no authority addresses", () => {
    // Rule 48 properly applied: silence for genuinely unknown input.
    expect(signerRuleFor("cooperative")).toBeNull();
    expect(signerRuleFor("")).toBeNull();
    expect(signerRuleFor("LLC_S_CORP")).toBeNull();
  });

  it("keeps the storable list and the signer rules in step", () => {
    // Rule 42: a gate that cannot be forgotten. Widening the check constraint
    // in a later migration without widening the function fails here.
    expect(() => assertEverySignerRuleExists()).not.toThrow();
  });

  it("matches the check constraint in the migration exactly", () => {
    /**
     * THE GATE THAT MAKES THE ONE ABOVE MEAN SOMETHING. `assertEverySignerRule`
     * proves the code answers for every type in STORABLE_ENTITY_TYPES; this
     * proves STORABLE_ENTITY_TYPES is the same set the DATABASE will accept.
     * Without it, both lists could shrink together and stay consistently wrong.
     *
     * The migration is parsed off disk rather than restated here, because a
     * transcription is the very thing being checked. This test lives in the
     * test file, not the module, because the module has to stay importable by
     * the browser and cannot read the filesystem.
     */
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0196_company_profile.sql"),
      "utf8",
    );
    const m = /entity_type[\s\S]{0,120}?check \(entity_type in \(([\s\S]*?)\)\)/.exec(sql);
    expect(m, "could not find the entity_type check constraint in 0196").not.toBeNull();

    const fromSql = [...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    // Rule 39: a regex that matched nothing would make this pass vacuously.
    expect(fromSql.length).toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...STORABLE_ENTITY_TYPES].sort());
  });
});

describe("readiness answers can I file this yet", () => {
  it("reports every form ready on Greenway's real information", () => {
    const all = allFormReadiness(GREENWAY);
    const notReady = all.filter((r) => !r.ready);
    expect(notReady.map((r) => `${r.form}: ${r.blockers.map((b) => b.field).join(",")}`)).toEqual([]);
    expect(all.length).toBe(COMPANY_FORMS.length);
  });

  it("blocks every single form when nothing has been entered", () => {
    // Rule 39 from the other direction: an engine that reported ten green
    // lights against an empty profile would be worse than no engine.
    const all = allFormReadiness({});
    expect(all.filter((r) => r.ready)).toEqual([]);
    for (const r of all) expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("treats a MALFORMED required field as a blocker and not a warning", () => {
    // The most important assertion in this file. Five digits where nine belong
    // will be accepted by a lenient system and rejected by the IRS, and the
    // rejection arrives after the deadline.
    const r = formReadiness("form-941", { ...GREENWAY, ein: "12345" });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => `${b.field}/${b.problem}`)).toContain("ein/malformed");
    expect(r.warnings.map((w) => w.field)).not.toContain("ein");
  });

  it("treats a MISSING required field as a blocker", () => {
    const r = formReadiness("form-941", { ...GREENWAY, legal_name: "" });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => `${b.field}/${b.problem}`)).toContain("legal_name/missing");
  });

  it("treats whitespace as missing rather than as a value", () => {
    // "   " is how a required field gets satisfied by accident.
    const r = formReadiness("form-941", { ...GREENWAY, legal_name: "   " });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.field)).toContain("legal_name");
  });

  it("treats null and undefined as missing rather than crashing", () => {
    const r = formReadiness("form-941", { ...GREENWAY, legal_name: null, signer_name: undefined });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.field)).toContain("legal_name");
    expect(r.blockers.map((b) => b.field)).toContain("signer_name");
  });

  it("warns without blocking when a conditional field is blank", () => {
    // The instructions say to leave the trade-name line blank when it matches
    // the legal name, so blank is a legitimate answer that still deserves a
    // second look.
    const r = formReadiness("form-941", { ...GREENWAY, trade_name: "" });
    expect(r.ready).toBe(true);
    expect(r.warnings.map((w) => `${w.field}/${w.problem}`)).toContain("trade_name/missing");
  });

  it("does not complain about a missing optional field", () => {
    // Absence is a legitimate answer for an optional field; noise here would
    // train Michael to ignore the panel.
    const optionalFields = COMPANY_FIELDS.filter((f) =>
      f.consumers.every((c) => c.necessity === "optional"),
    ).map((f) => f.field);
    const stripped: Record<string, string> = { ...(GREENWAY as Record<string, string>) };
    for (const f of optionalFields) stripped[f] = "";
    for (const r of allFormReadiness(stripped)) {
      const noisy = r.warnings.filter((w) => optionalFields.includes(w.field) && w.problem === "missing");
      expect(noisy.map((w) => w.field)).toEqual([]);
    }
  });

  it("derives each form's field list from the consumer declarations", () => {
    // Rule 62: there is no second hand-written list of "what Form 941 needs",
    // because a second list is a second thing to forget.
    for (const form of COMPANY_FORMS) {
      const derived = fieldsForForm(form).map((f) => f.field).sort();
      const manual = COMPANY_FIELDS.filter((f) => f.consumers.some((c) => c.form === form))
        .map((f) => f.field)
        .sort();
      expect(derived).toEqual(manual);
      expect(derived.length).toBeGreaterThan(0);
    }
  });

  it("puts the EIN on every federal form and the NACHA file", () => {
    // A spot check with real consequences: the EIN identifies the taxpayer on
    // the 941, the 940, the W-2, the W-3 and the ACH company record.
    const einForms: CompanyForm[] = ["form-941", "form-940", "form-w-2", "form-w-3", "nacha-payroll"];
    for (const f of einForms) {
      expect(fieldsForForm(f).map((s) => s.field)).toContain("ein");
    }
  });

  it("names the form in the blocker message so the panel can be read out of context", () => {
    const r = formReadiness("form-940", { ...GREENWAY, ein: "" });
    const b = r.blockers.find((x) => x.field === "ein");
    expect(b?.help).toContain(FORM_TITLES["form-940"]);
  });
});

describe("requireField refuses to substitute a default", () => {
  it("returns the stored value when it is present and well formed", () => {
    expect(requireField(GREENWAY, "ein", "form-941")).toBe("464217016");
  });

  it("trims the returned value", () => {
    expect(requireField({ ...GREENWAY, legal_name: "  LYMAN'S  " }, "legal_name", "form-941")).toBe("LYMAN'S");
  });

  it("throws naming BOTH the field and the form when the value is blank", () => {
    // Standing rule 62d made mechanical. This is the only sanctioned way for a
    // form builder to read a required identity field, and the message has to
    // tell Michael what to fix and where.
    expect(() => requireField({ ...GREENWAY, ein: "" }, "ein", "form-941")).toThrow(
      /MISSING COMPANY INFORMATION/,
    );
    expect(() => requireField({ ...GREENWAY, ein: "" }, "ein", "form-941")).toThrow(/company_profile\.ein/);
    expect(() => requireField({ ...GREENWAY, ein: "" }, "ein", "form-941")).toThrow(/Form 941/);
  });

  it("throws when the value is present but malformed", () => {
    expect(() => requireField({ ...GREENWAY, ein: "12345" }, "ein", "form-941")).toThrow(
      /MALFORMED COMPANY INFORMATION/,
    );
  });

  it("throws when asked for a field nobody declared", () => {
    // Guards the quiet version of this bug: a builder reading an undeclared
    // column appears in no readiness check, so the screen would never warn
    // that it was empty.
    expect(() => requireField(GREENWAY, "favourite_colour", "form-941")).toThrow(
      /not a declared company-profile field/,
    );
  });

  it("never returns an empty string", () => {
    // The property that makes this function worth having: for every declared
    // field on a complete profile it either returns something usable or throws.
    for (const spec of COMPANY_FIELDS) {
      const consumer = spec.consumers[0];
      let value: string;
      try {
        value = requireField(GREENWAY, spec.field, consumer.form);
      } catch {
        continue;
      }
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
