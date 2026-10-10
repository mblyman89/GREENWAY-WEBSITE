/**
 * R39 S5: the AcroForm path end to end, on REAL pdf.js output.
 * Fixtures are unpdf getFieldObjects() dumps of our own fillable PDFs
 * (Greenway-*-FILLABLE.pdf) filled with pypdf using TEST numbers only
 * (021000021 / 011000015 are public Fed/JPMorgan routing test values;
 * account numbers are made up). No real bank data is in this repo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acroFormKind, draftFromAcroForm, draftIsUsable, fieldsFromFieldObjects, rekeyVerdict } from "@/lib/payments/ach-document-intake-core";

const load = (n: string) => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/ach", n), "utf8")) as unknown;
const EMP = load("employee-filled.fieldobjects.json");
const VEN = load("vendor-filled.fieldobjects.json");
const BLANK = load("employee-blank.fieldobjects.json");

describe("AcroForm fixtures (real pdf.js output)", () => {
  it("recognises which of our forms it is", () => {
    expect(acroFormKind(EMP)).toBe("employee");
    expect(acroFormKind(BLANK)).toBe("employee");
    expect(acroFormKind(VEN)).toBe("vendor");
    expect(acroFormKind({})).toBeNull();
    expect(acroFormKind({ ...(EMP as object), ...(VEN as object) })).toBeNull();
  });
  it("filled employee form -> clean usable two-account draft", () => {
    const { fields, conflicts } = fieldsFromFieldObjects(EMP);
    expect(conflicts).toEqual([]);
    expect(Object.keys(fields).some((k) => k.endsWith("_sig"))).toBe(false);
    const d = draftFromAcroForm("employee", fields);
    expect(d.warnings).toEqual([]);
    expect(d.payeeName).toBe("Test Person");
    expect(d.accounts.map((a) => [a.routing, a.account, a.accountType, a.rule])).toEqual([
      ["021000021", "12345678", "checking", { kind: "fixed", cents: 20000 }],
      ["011000015", "99990000", "savings", { kind: "remainder" }],
    ]);
    expect(draftIsUsable(d)).toBe(true);
    const v = rekeyVerdict(d, [{ byId: "s", accounts: d.accounts.map(({ routing, account, accountType, rule }) => ({ routing, account, accountType: accountType!, rule: rule! })) }]);
    expect(v).toMatchObject({ ok: true, basis: "matches_form" });
  });
  it("filled vendor form -> one whole-payment account", () => {
    const d = draftFromAcroForm("vendor", fieldsFromFieldObjects(VEN).fields);
    expect(d.warnings).toEqual([]);
    expect(d.payeeName).toBe("Test Vendor LLC");
    expect(d.accounts).toHaveLength(1);
    expect(d.accounts[0]).toMatchObject({ routing: "021000021", account: "12345678", accountType: "checking", rule: { kind: "remainder" } });
  });
  it("blank form -> no accounts, not usable", () => {
    const d = draftFromAcroForm("employee", fieldsFromFieldObjects(BLANK).fields);
    expect(d.accounts).toEqual([]);
    expect(draftIsUsable(d)).toBe(false);
  });
  it("widgets that disagree are reported, not guessed", () => {
    const r = fieldsFromFieldObjects({ e_a1_acct: [{ type: "text", value: "111" }, { type: "text", value: "222" }], e_a1_rtn: [{ type: "text", value: "" }, { type: "text", value: "021000021" }] });
    expect(r.conflicts).toEqual(["e_a1_acct"]);
    expect(r.fields).toEqual({ e_a1_rtn: "021000021" });
  });
  it("ignores signature widgets, odd names and junk", () => {
    const r = fieldsFromFieldObjects({ e_e_sig: [{ type: "signature", value: "x" }], "bad name": [{ type: "text", value: "x" }], e_rq_new: [{ type: "checkbox", value: true }], x: "nope" });
    expect(r.fields).toEqual({ e_rq_new: true });
    expect(fieldsFromFieldObjects(null)).toEqual({ fields: {}, conflicts: [] });
  });
});
