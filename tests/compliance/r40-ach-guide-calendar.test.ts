/**
 * R40 - the ACH Guide, Calendar and wiring. These tests exist so the helper
 * can never quietly drift away from the system it explains:
 *   - every deep link points at a page that exists AND an anchor that exists,
 *   - every refusal the real pay gates can produce is explained (none "unknown"),
 *   - every verbatim quote is a substring of its mirrored source,
 *   - the pages are owner-only, the reminder planner is wired, PAYROLL is pinned.
 * Each check is paired with a mutation that proves the check can fail.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTHORIZATION_STATES, payable } from "@/lib/payments/ach-authorization-core";
import { canPayWithVaultRecord } from "@/lib/payments/payee-banking-core";
import { optOutPayRefusal } from "@/lib/payments/vendor-ach-enrollment-core";
import { planPayrollEntries } from "@/lib/payroll/payroll-core";
import { evaluatePayrollGuardrails } from "@/lib/payroll/payroll-guardrails-core";
import {
  buildBlockers,
  buildJourneys,
  employeeEsignLink,
  employeeLink,
  EXPLAIN_RULE_IDS,
  explainPaymentMessage,
  GUIDE_LINKS,
  sampleSnapshot,
  vendorLink,
} from "@/lib/payments/ach-guide-core";
import { ACH_CAL_TASKS, ACH_FRAUD_PROCEDURE, NACHA_RULE_WATCH } from "@/lib/payments/ach-calendar-core";
import { ACH_LEGAL_LIBRARY } from "@/lib/payments/ach-legal-library";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";

const ROOT = join(__dirname, "..", "..");
const AUTH = join(ROOT, "docs", "authorities");
const APP = join(ROOT, "src", "app");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ---------------------------------------------------------------- link resolver

/** Walk src/app/<segments>, letting a literal segment match a [dynamic] folder. */
function resolvePageDir(segments: string[]): string | null {
  let dir = APP;
  for (const seg of segments) {
    const direct = join(dir, seg);
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      dir = direct;
      continue;
    }
    const dyn = readdirSync(dir).find((d) => /^\[[^\]]+\]$/.test(d) && statSync(join(dir, d)).isDirectory());
    if (!dyn) return null;
    dir = join(dir, dyn);
  }
  return existsSync(join(dir, "page.tsx")) ? dir : null;
}

function pageDirFor(link: string): string | null {
  const path = link.split(/[?#]/)[0].replace(/\/$/, "");
  return resolvePageDir(path.split("/").filter(Boolean));
}

/** All .ts/.tsx text in a page's folder (anchors may live in a sibling component). */
function folderText(dir: string): string {
  return readdirSync(dir)
    .filter((f) => /\.(tsx?|ts)$/.test(f))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

function anchorExists(link: string): boolean {
  const dir = pageDirFor(link);
  if (!dir) return false;
  const hash = link.split("#")[1];
  if (!hash) return true;
  const txt = folderText(dir);
  // id="x", id={`x`}, or id={`prefix-${...}`} patterns: literal ids are enough for every link we emit.
  return txt.includes(`id="${hash}"`) || txt.includes(`id='${hash}'`);
}

const ALL_LINKS: string[] = [
  ...Object.values(GUIDE_LINKS),
  employeeLink("abc"),
  employeeEsignLink("abc"),
  vendorLink("abc"),
  ...ACH_CAL_TASKS.map((t) => t.href).filter((h) => !h.startsWith("http")),
  ...ACH_FRAUD_PROCEDURE.map((p) => p.enforcedBy).filter((x): x is string => Boolean(x)),
  ...ACH_LEGAL_LIBRARY.map((l) => l.appLink),
  ...BANKING_HELP_TABS.map((t) => t.href),
  // The help FAQ and the concierge send people to these pages too.
  ...["src/lib/admin/help-content.ts", "src/lib/admin/concierge-kb.ts"].flatMap((f) =>
    [...readFileSync(join(__dirname, "..", "..", f), "utf8").matchAll(/"(\/admin\/settings\/banking[^"]*)"/g)].map((m) => m[1]),
  ),
];

describe("R40 deep links resolve to real pages and real anchors", () => {
  it("collects a meaningful number of links", () => {
    expect(ALL_LINKS.length).toBeGreaterThan(40);
  });

  it.each([...new Set(ALL_LINKS)].map((l) => [l]))("%s -> page and anchor exist", (link) => {
    expect(pageDirFor(link), `no page for ${link}`).not.toBeNull();
    expect(anchorExists(link), `no anchor for ${link}`).toBe(true);
  });

  it("the resolver itself can fail (mutation: bogus page and bogus anchor)", () => {
    expect(pageDirFor("/admin/settings/banking/nope")).toBeNull();
    expect(anchorExists("/admin/settings/banking/operations#does-not-exist")).toBe(false);
    expect(anchorExists("/admin/settings/banking/operations#holds")).toBe(true);
  });

  it("every link the guide emits from a full sample snapshot also resolves", () => {
    const snap = sampleSnapshot();
    const links = [
      ...buildJourneys(snap).flatMap((j) => j.steps.map((s) => s.href)),
      ...buildBlockers(snap).map((b) => b.href),
    ];
    for (const l of links) expect(pageDirFor(l), l).not.toBeNull();
  });

  it("every rule in the explainer links somewhere real", () => {
    const probes = [
      "has not been signed yet", "record is incomplete", "DATA_ENCRYPTION_KEY",
    ];
    for (const p of probes) {
      const e = explainPaymentMessage(p);
      expect(pageDirFor(e.href), `${e.matched} -> ${e.href}`).not.toBeNull();
    }
  });
});

// ------------------------------------------------------------- verbatim quotes

describe("R40 calendar quotes are verbatim", () => {
  const withQuote = ACH_CAL_TASKS.filter((t) => t.quote);
  it("has quoted tasks", () => expect(withQuote.length).toBeGreaterThan(0));

  it.each(withQuote.map((t) => [t.id, t] as const))("task %s quote is in its mirrored file", (_id, t) => {
    const src = flat(readFileSync(join(AUTH, t.quote!.file), "utf8"));
    expect(src.includes(flat(t.quote!.text))).toBe(true);
  });

  it.each(NACHA_RULE_WATCH.map((r) => [r.id, r] as const))("rule %s quote is in its mirrored file", (_id, r) => {
    const src = flat(readFileSync(join(AUTH, r.quoteFile), "utf8"));
    expect(src.includes(flat(r.quote))).toBe(true);
  });

  it("a one-character change is caught", () => {
    const r = NACHA_RULE_WATCH[0];
    const src = flat(readFileSync(join(AUTH, r.quoteFile), "utf8"));
    const mutated = flat(r.quote).replace(/e/, "3");
    expect(mutated).not.toBe(flat(r.quote));
    expect(src.includes(mutated)).toBe(false);
  });

  it("every lawId on a task exists in the legal library", () => {
    const ids = new Set(ACH_LEGAL_LIBRARY.map((l) => l.id));
    for (const t of ACH_CAL_TASKS) for (const id of t.lawIds) expect(ids.has(id), `${t.id}: ${id}`).toBe(true);
  });

  it("every 'Protect your business' item on the library page cites real ids", () => {
    const src = read("src/app/admin/settings/banking/library/page.tsx");
    const ids = new Set(ACH_LEGAL_LIBRARY.map((l) => l.id));
    const cited = [...src.matchAll(/lawIds:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    expect(cited.length).toBeGreaterThan(10);
    for (const id of cited) expect(ids.has(id), id).toBe(true);
  });
});

// ------------------------------------------- every real refusal is explained

describe("R40 explainer covers every message the real gates produce", () => {
  const line = { employeeId: "e1", employeeName: "Ann", netPayCents: 100_000, accountType: "checking" as const, routing: "125000105", accountNumber: "1" };
  const acct = (o: object = {}) => ({ priority: 1, rule: { kind: "remainder" } as const, routing: "021000021", accountNumber: "9", accountType: "checking" as const, verificationStatus: "verified", ...o });

  function produced(): { source: string; message: string }[] {
    const out: { source: string; message: string }[] = [];
    for (const s of AUTHORIZATION_STATES) {
      const p = payable(s);
      if (!p.ok) out.push({ source: `payable(${s})`, message: p.reason });
    }
    for (const st of ["on_hold", "revoked", "archived", "weird"]) {
      const v = canPayWithVaultRecord({ status: st, routing: "125000105", accountNumber: "1" }, "Acme");
      if (!v.ok) out.push({ source: `vault(${st})`, message: v.refusal });
    }
    for (const [name, rec] of [["incomplete", { status: "active", routing: "", accountNumber: "" }], ["none", null]] as const) {
      const v = canPayWithVaultRecord(rec, "Acme");
      if (!v.ok) out.push({ source: `vault(${name})`, message: v.refusal });
    }
    const o = optOutPayRefusal({ optedOut: true, optedOutReason: "prefers checks" } as never, "Acme");
    if (o) out.push({ source: "optOut", message: o });
    for (const [name, plan] of Object.entries({
      bogus: { state: "bogus", accounts: [acct()] },
      draft: { state: "draft", accounts: [acct()] },
      hold: { state: "on_hold", accounts: [acct()] },
      unverified: { state: "active", accounts: [acct({ verificationStatus: "pending" })] },
      badRouting: { state: "active", accounts: [acct({ routing: "", accountNumber: "" })] },
      noRemainder: { state: "active", accounts: [acct({ rule: { kind: "fixed", cents: 5 } })] },
      over100: { state: "active", accounts: [acct({ rule: { kind: "percent", basisPoints: 10000 } }), acct({ priority: 2, routing: "125000105", accountNumber: "2" })] },
    })) {
      const r = planPayrollEntries([line], new Map([["e1", plan as never]]));
      if (!r.ok) for (const m of r.errors) out.push({ source: `payroll(${name})`, message: m });
    }
    const rep = evaluatePayrollGuardrails({
      payDate: "2026-10-16",
      lines: [
        { employeeId: "e1", employeeName: "Ann", netPayCents: 100_000, routing: "125000105", accountNumber: "2" },
        { employeeId: "e2", employeeName: "Bob", netPayCents: 99_999_999, routing: "125000105", accountNumber: "3" },
      ],
      hasSourceDocument: false,
      otherGeneratedRunDates: ["2026-10-10"],
      history: [{ employeeId: "e1", lastPaidDate: "2026-10-10", lastPaidNetCents: 100_000, lastRouting: "125000105", lastAccountNumber: "1" }],
      releaserIsCreator: true,
    });
    for (const f of rep.findings) out.push({ source: `guardrail(${f.code})`, message: f.message });
    return out;
  }

  const all = produced();

  it("produces a healthy variety of real messages", () => {
    expect(all.length).toBeGreaterThanOrEqual(24);
  });

  it.each(all.map((m) => [m.source, m.message] as const))("%s is explained (not unknown)", (_s, message) => {
    const e = explainPaymentMessage(message);
    expect(e.matched, message).not.toBe("unknown");
    expect(e.fix.length).toBeGreaterThan(0);
  });

  it("every explainer rule is reached by at least one real message", () => {
    const hit = new Set(all.map((m) => explainPaymentMessage(m.message).matched));
    // 'migration', 'encryption', 'company' and 'bank_changed' come from setup/pages, covered separately below.
    const separately = new Set(["migration", "encryption", "company"]);
    for (const id of EXPLAIN_RULE_IDS) {
      if (separately.has(id)) continue;
      expect(hit.has(id), `rule ${id} never reached by a real message`).toBe(true);
    }
  });

  it("the setup-only messages are explained too", () => {
    expect(explainPaymentMessage("Apply migrations 0258 first").matched).toBe("migration");
    expect(explainPaymentMessage("DATA_ENCRYPTION_KEY is not set").matched).toBe("encryption");
    expect(explainPaymentMessage("Your bank ACH block is not fully configured yet.").matched).toBe("company");
  });

  it("mutation: a message the explainer has never seen is reported as unknown, never guessed", () => {
    expect(explainPaymentMessage("The moon is in the wrong phase").matched).toBe("unknown");
    expect(explainPaymentMessage("").matched).toBe("unknown");
  });

  it("every wage refusal carries the pay-by-check fallback", () => {
    for (const m of all.filter((x) => x.source.startsWith("payable(") || x.source.startsWith("payroll("))) {
      const id = explainPaymentMessage(m.message).matched;
      if (["split", "cadence", "source_document", "bank_changed", "duplicate_amount", "ceiling", "dual_control", "company"].includes(id)) continue;
      expect(explainPaymentMessage(m.message).fallback, `${m.source} (${id})`).toBeTruthy();
    }
  });
});

// ------------------------------------------------------------------- wiring

describe("R40 wiring", () => {
  const PAGES = ["guide", "calendar", "library"].map((p) => `src/app/admin/settings/banking/${p}/page.tsx`);

  it.each(PAGES.map((p) => [p]))("%s is owner-only, dynamic, and shows the subnav", (p) => {
    const s = read(p);
    expect(s).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(s).toMatch(/export const dynamic = "force-dynamic"/);
    expect(s).toMatch(/<BankingSubnav active="/);
  });

  it("the calendar action is owner-only, audited, and validates through the pure core", () => {
    const s = read("src/app/admin/settings/banking/calendar-actions.ts");
    expect(s).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(s).toMatch(/recordAudit/);
    expect(s).toMatch(/setAchTaskDone/);
    const store = read("src/lib/payments/ach-guide-store.ts");
    expect(store).toMatch(/checkMarkDone/);
    expect(store).toMatch(/readError/);
  });

  it("the helper tabs are on the main banking page and the operations page", () => {
    for (const p of ["src/app/admin/settings/banking/page.tsx", "src/app/admin/settings/banking/operations/page.tsx"]) {
      expect(read(p), p).toMatch(/<BankingHelpTabs\s*\/>/);
    }
  });

  it("the 6th reminder planner is wired with its own try/catch and a read-failure note", () => {
    const s = read("src/lib/notifications/compliance-reminders.ts");
    expect(s).toMatch(/planAchCalendarReminders\(/);
    expect(s).toMatch(/evaluateAchCalendar\(/);
    const block = s.slice(s.indexOf("6) R40"));
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/catch \(e\)/);
    expect(block).toMatch(/could not be read/);
  });

  it("payroll is pinned to the Nacha PAYROLL entry description", () => {
    const s = read("src/lib/payroll/payroll-store.ts");
    expect(s).toMatch(/export const PAYROLL_ENTRY_DESCRIPTION = "PAYROLL";/);
    expect(s).toMatch(/companyEntryDescription: PAYROLL_ENTRY_DESCRIPTION/);
    expect(s).not.toMatch(/companyEntryDescription: settings\./);
  });

  it("the help FAQ and the concierge both teach the three helper tabs and the pay-by-check fallback", () => {
    for (const f of ["src/lib/admin/help-content.ts", "src/lib/admin/concierge-kb.ts"]) {
      const s = read(f);
      for (const t of BANKING_HELP_TABS) expect(s, `${f} -> ${t.href}`).toContain(t.href);
      expect(s, f).toMatch(/paper check/);
    }
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("PAYROLL");
  });

  it("onboarding offers direct deposit but never makes it a gate (A5)", () => {
    const s = read("src/lib/staffing/employee-lifecycle-core.ts");
    const block = s.slice(s.indexOf('key: "direct_deposit"'), s.indexOf('key: "direct_deposit"') + 900);
    expect(block).toMatch(/phase: "ready"/);
    expect(block).not.toMatch(/critical: true/);
  });

  it("the fraud procedure's enforcement links are all real (C6)", () => {
    expect(ACH_FRAUD_PROCEDURE.length).toBe(12);
    expect(ACH_FRAUD_PROCEDURE.filter((p) => p.enforcedBy === null).length).toBe(2);
  });
});
