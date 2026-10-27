/**
 * S-17c (CCRS Bible Part 11 §F/§G, Part 17 §F): CCRS signs in with WA.gov
 * since 2026-10-12. Every CCRS sign-in instruction says WA.gov, tells the
 * owner the live and Pre-Production accounts are separate, and links the
 * right "create account" page. SAW stays only where it is still true: the
 * DOH Medical Cannabis Registry at the register (not CCRS).
 *
 * The evidence files cited here are committed in the repo
 * (docs/ccrs-bible/evidence/2026-10-19-owner-request/lcb-2026-10-19/), so
 * these reads also run in CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CCRS_LOGIN_LABEL,
  CCRS_SIGNIN_SERVICE_DESK,
  CCRS_WAGOV_SINCE,
  WAGOV_CREATE_ACCOUNT_URLS,
  WAGOV_HELP_URL,
  __runCcrsSigninTests,
  ccrsLoginPhrase,
  ccrsLoginWordingIssues,
  ccrsSigninSteps,
  envOfPortalUrl,
} from "@/lib/compliance/ccrs-signin-core";
import { CCRS_PORTAL_URLS } from "@/lib/compliance/ccrs-lifecycle-core";
import { outboxReadmeLines, planOutboxFiles } from "@/lib/compliance/ccrs-outbox-core";
import { SAW_LOGIN_URL } from "@/lib/pos/saw-prefill-core";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const EV = "docs/ccrs-bible/evidence/2026-10-19-owner-request/lcb-2026-10-19";
const SIGNIN = read(`${EV}/signin.txt`).split("\n");
const LINKS = read(`${EV}/signin-links.txt`);
const FAQ19 = read(`${EV}/faq.txt`).split("\n");
const BUL = read(`${EV}/bulletin-42e03cc.txt`).split("\n");
/** 1-based line, like the bible pins. */
const L = (lines: string[], n: number) => lines[n - 1];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe("S-17c grounding: the LCB text the wording rests on", () => {
  it("BUL1006 L0010: CCRS left SAW for WA.gov on Monday Oct. 12", () => {
    expect(L(BUL, 10)).toContain("on Monday, Oct. 12, the Cannabis Central Reporting System (CCRS) will transition from using SecureAccess Washington (SAW) to the new WA.gov interface for login");
    expect(CCRS_WAGOV_SINCE).toBe("2026-10-12");
    expect(new Date(`${CCRS_WAGOV_SINCE}T12:00:00Z`).getUTCDay()).toBe(1); // a Monday, as the bulletin says
  });
  it("BUL1006 L0013: other LCB applications (e.g. the LCB Portal) move next year, so SAW there is not wrong", () => {
    expect(L(BUL, 13)).toContain("Other LCB applications will move to using WA.gov next year.");
  });
  it("SIGNIN L0035-L0036: live and Pre-Production need separate WA.gov accounts", () => {
    expect(`${L(SIGNIN, 35)} ${L(SIGNIN, 36)}`).toContain("You will need separate WA.gov accounts for the Pre-Production environment and the live environment.");
  });
  it("SIGNIN L0037-L0038 + PDF link annotations: the two create-account targets", () => {
    expect(L(SIGNIN, 37)).toContain("Create a WA.gov account here");
    expect(L(SIGNIN, 38)).toContain("Create a Pre-Production WA.gov account here");
    expect(LINKS).toContain("PDF md5 0a0ad5a5ba868ff227708fcc4079603d");
    expect(LINKS).toMatch(/'Create a WA\.gov account here' \(signin\.txt L0037\) -> https:\/\/manage\.login\.wa\.gov\/create\n/);
    expect(LINKS).toMatch(/'Create a Pre-Production WA\.gov account here' \(signin\.txt L0038\) -> https:\/\/test-manage\.login\.wa\.gov\/create\n/);
    expect(WAGOV_CREATE_ACCOUNT_URLS).toEqual({
      prod: "https://manage.login.wa.gov/create",
      preprod: "https://test-manage.login.wa.gov/create",
    });
  });
  it("SIGNIN L0061-L0062 and L0069: registration email rule and the service desk", () => {
    expect(L(SIGNIN, 61)).toContain("Enter the email address you use for CCRS reporting.");
    expect(L(SIGNIN, 62)).toContain("This email address must already have been set up with LCB Licensing.");
    expect(L(SIGNIN, 69)).toContain(`Contact the LCB ITS Service Desk (${CCRS_SIGNIN_SERVICE_DESK})`);
  });
  it("FAQ19 L0170-L0173 and L0191: SAW did not carry over; WaTech helps with WA.gov; nothing else changed", () => {
    expect(L(FAQ19, 170)).toBe("SAW accounts did not automatically transition.");
    expect(L(FAQ19, 172)).toBe("Submit a WA.gov accounts help request");
    expect(L(FAQ19, 173)).toBe("with the WaTech Support Center.");
    expect(L(FAQ19, 191)).toContain("The only change in scope is the transition from SAW to WA.gov authentication.");
    expect(WAGOV_HELP_URL).toBe("https://wa.gov/get-help");
  });
  it("FAQ19 L0369: PREprod and live do not share administration (an integrator is assigned in each)", () => {
    expect(L(FAQ19, 369)).toBe("Yes. These environments are autonomous and do not share administration or reporting data.");
  });
});

describe("S-17c core", () => {
  it("embedded self-tests pass", () => {
    const r = __runCcrsSigninTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(14);
  });
  it("phrases and steps per environment", () => {
    expect(CCRS_LOGIN_LABEL).toBe("WA.gov");
    expect(ccrsLoginPhrase()).toBe("WA.gov login");
    expect(ccrsLoginPhrase("preprod")).toBe("WA.gov login - your PRE-PRODUCTION WA.gov account, separate from the live one");
    expect(envOfPortalUrl(CCRS_PORTAL_URLS.preprod)).toBe("preprod");
    expect(envOfPortalUrl(CCRS_PORTAL_URLS.prod)).toBe("prod");
    expect(envOfPortalUrl("https://PRECANNABISREPORTING.lcb.wa.gov")).toBe("preprod");
    const pre = ccrsSigninSteps("preprod");
    const prod = ccrsSigninSteps("prod");
    expect(pre).toHaveLength(4);
    expect(pre[0]).toMatch(/^Open precannabisreporting\.lcb\.wa\.gov /);
    expect(prod[0]).toMatch(/^Open cannabisreporting\.lcb\.wa\.gov /);
    expect(pre[1]).toContain("your Pre-Production WA.gov account");
    expect(pre[1]).toContain("https://test-manage.login.wa.gov/create");
    expect(prod[1]).toContain("https://manage.login.wa.gov/create");
    expect(prod.join(" ")).not.toContain("test-manage");
    expect(prod[2]).toContain("already be on file with LCB Licensing");
    expect(prod[3]).toContain("https://wa.gov/get-help");
    expect(prod[3]).toContain("servicedesk@lcb.wa.gov");
    expect(prod.join(" ")).not.toMatch(/\bSAW\b/);
  });
});

describe("S-17c guardrail (test the test): it catches every old string and spares DOH/MCR and history", () => {
  const OLD = [
    "`Upload these files at ${portalUrl} (SAW login)${pre ? \" - PREPROD TEST SITE, not production\" : \"\"}, ONE AT A TIME, in this order:`,",
    "`Upload portal: <a href=\"https://cannabisreporting.lcb.wa.gov\">cannabisreporting.lcb.wa.gov</a> (SAW login).",
    "/** CCRS portal (SAW login) — \"Make a Payment\" ACH path. */",
    "\"CCRS has no live API — reporting is a CSV a human uploads to the state's SAW/CCRS portal.\",",
    "the original file and re-uploaded with a matching NumberRecords. Tech/SAW problems go to{\" \"}",
    "and sign in with your SecureAccess Washington (SAW) account. (The LCB is moving CCRS to\n          WA.gov login around Oct 2026.)",
  ];
  it.each(OLD.map((t, i) => [i + 1, t]))("old string %i is flagged", (_i, t) => {
    expect(ccrsLoginWordingIssues(t as string).length).toBeGreaterThan(0);
  });
  it("wrapped markdown: SAW on one line, CCRS on the next, is flagged", () => {
    const md = "- [ ] **C-010 Log into CCRS today** at https://cannabisreporting.lcb.wa.gov/ with\n  your SAW (SecureAccess Washington) account, just to prove the login works.";
    expect(ccrsLoginWordingIssues(md).map((x) => x.line)).toEqual([2]);
  });
  it("spares the DOH MCR login, history, and lines far from CCRS", () => {
    expect(ccrsLoginWordingIssues("Log in via SecureAccess Washington (SAW) → open the MCR (works best in Chrome).")).toEqual([]);
    expect(ccrsLoginWordingIssues("CCRS left SAW on 2026-10-12")).toEqual([]);
    expect(ccrsLoginWordingIssues("- SAW → WA.gov single sign-on. CCRS moved to WA.gov on 2026-10-12")).toEqual([]);
    expect(ccrsLoginWordingIssues("CCRS\n\n\nYour SAW login:")).toEqual([]);
  });
  it("the DOH register helper still points at SecureAccess Washington (out of scope, unchanged)", () => {
    expect(SAW_LOGIN_URL).toBe("https://secureaccess.wa.gov/");
  });
});

describe("S-17c: no CCRS text in src or docs says SAW is the CCRS login", () => {
  const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "docs"))]
    .map((p) => path.relative(ROOT, p).split(path.sep).join("/"))
    // The bible quotes LCB's own SAW-era guides verbatim (Part 02 §4/§6) and records history.
    .filter((r) => !r.startsWith("docs/ccrs-bible/"))
    // The guardrail names the idioms it looks for.
    .filter((r) => r !== "src/lib/compliance/ccrs-signin-core.ts");
  it("scans a real tree (guards against an empty walk)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/app/(site)/pos/SaleFlow.tsx");
    expect(files).toContain("docs/audit/CUTOVER-CHECKLIST.md");
  });
  it("zero findings", () => {
    const found = files.flatMap((f) => ccrsLoginWordingIssues(read(f)).map((x) => `${f}:${x.line}: ${x.text}`));
    expect(found).toEqual([]);
  });
});

describe("S-17c: the upload README, reminder, walkthrough, triage and docs say WA.gov", () => {
  const files = planOutboxFiles(
    [{ type: "Strain", csv: "SubmittedBy,G\r\nSubmittedDate,10/07/2026\r\nNumberRecords,1\r\nLicenseNumber,Strain,StrainType,CreatedBy,CreatedDate\r\n413541,Blue Dream,Hybrid,G,10/07/2026\r\n" }],
    { licenseNumber: "413541", now: new Date("2026-10-07T19:00:00Z"), lastStamp: null },
  );
  const names = files.map((f) => f.fileName);
  it("production README header", () => {
    expect(outboxReadmeLines(files, names)[0]).toBe(
      "Upload these files at https://cannabisreporting.lcb.wa.gov/ (WA.gov login), ONE AT A TIME, in this order:",
    );
  });
  it("PREprod README header names the separate PREprod account and the test site", () => {
    expect(outboxReadmeLines(files, names, CCRS_PORTAL_URLS.preprod)[0]).toBe(
      "Upload these files at https://precannabisreporting.lcb.wa.gov/ (WA.gov login - your PRE-PRODUCTION WA.gov account, separate from the live one) - PREPROD TEST SITE, not production, ONE AT A TIME, in this order:",
    );
  });
  it("reminder email footer renders the label", () => {
    const src = read("src/lib/notifications/compliance-reminders.ts");
    expect(src).toContain("cannabisreporting.lcb.wa.gov</a> (${CCRS_LOGIN_LABEL} login).");
    expect(src).toContain('import { CCRS_LOGIN_LABEL } from "@/lib/compliance/ccrs-signin-core";');
  });
  it("walkthrough sign-in step is per environment and links the right create page", () => {
    const src = read("src/components/admin/compliance/UploadWalkthrough.tsx");
    expect(src).toContain("const signinEnv = envOfPortalUrl(PORTAL_URL);");
    expect(src).toContain("href={WAGOV_CREATE_ACCOUNT_URLS[signinEnv]}");
    expect(src).toContain('{signinEnv === "preprod" ? "your Pre-Production WA.gov account" : "your WA.gov account"}');
    expect(src).toContain("already on file with LCB Licensing");
    expect(src).not.toMatch(/SecureAccess|\bSAW\b/);
  });
  it("error triage footer and concierge fact", () => {
    expect(read("src/components/admin/compliance/ErrorTriagePanel.tsx")).toContain('CCRS technical problems go to{" "}');
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("a CSV a human uploads to the state's CCRS portal (WA.gov login).");
  });
  it("self-reporting guide and cutover checklist give both create links", () => {
    for (const f of ["docs/CCRS_SELF_REPORTING_GUIDE.md", "docs/audit/CUTOVER-CHECKLIST.md"]) {
      const t = read(f);
      expect(t, f).toContain("https://manage.login.wa.gov/create");
      expect(t, f).toContain("https://test-manage.login.wa.gov/create");
    }
    expect(read("docs/excise-payment-methods.md")).toContain("In CCRS (WA.gov login at https://cannabisreporting.lcb.wa.gov/, the live account");
  });
});
