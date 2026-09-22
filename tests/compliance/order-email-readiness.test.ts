/**
 * tests/compliance/order-email-readiness.test.ts
 *
 * SLICE L-19 — "the customer never got a confirmation email."
 *
 * The pure core proves its own policy. This file proves the WIRING: that the
 * policy is actually applied at every skip site, that the contractual silence
 * for Leafly orders survived the change, and that the two places which answer
 * "is email configured?" cannot give different answers.
 *
 * Every assertion is designed to FAIL if the fix is reverted. A test that
 * cannot fail is worse than no test (rule 13c), so
 * `mutate-leafly-l19-confirmation-email.py` breaks each of these deliberately
 * and requires the suite to notice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assessEmailReadiness,
  describeSkipsForTimeline,
  explainSkip,
  isSkipAFault,
  logLineForSkips,
  parseStaffEmails,
  skipRemedy,
  skipSeverity,
  FAULT_SKIP_REASONS,
  SKIP_REASONS,
  __runEmailReadinessTests,
} from "../../src/lib/orders/email-readiness-core";
import { summarizeNotifyOutcomes } from "../../src/lib/orders/notify-outcome-core";
import { notifyOrderPlaced, parseStaffEmailList } from "../../src/lib/orders/notify";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Strip comments before asserting on code.
 *
 * These files deliberately QUOTE the old behaviour in their headers so a
 * future reader can see what was wrong and why. A naive `toContain` would
 * match that prose and pass even if the real code were reverted.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const NOTIFY = "src/lib/orders/notify.ts";
const OUTCOME = "src/lib/orders/notify-outcome-core.ts";
const SETUP_STATUS = "src/lib/admin/setup-status.ts";
const BANNER = "src/components/admin/orders/EmailReadinessBanner.tsx";
const ORDERS_PAGE = "src/app/admin/orders/page.tsx";

describe("L-19 the pure core", () => {
  it("passes its own self-tests, cross-checked against the real notify.ts parser", () => {
    const r = __runEmailReadinessTests({ notifyStaffParse: parseStaffEmailList });
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(75);
  });

  it("the duplicated staff parser has not drifted from the original", () => {
    // email-readiness-core is pure and cannot import notify.ts, so the three
    // lines are duplicated. This is the proof they still agree — on the inputs
    // that actually differ between naive implementations.
    const corpus = ["", " ", ",", ",,", "a@b.com", " a@b.com ", "a@b.com,,c@d.com", "\ta@b.com\n,"];
    for (const raw of corpus) {
      expect(parseStaffEmails(raw)).toEqual(parseStaffEmailList(raw));
    }
  });
});

/*
 * ───────────────────────────────────────────────────────────────────────────
 * THE CENTRAL DISTINCTION.
 *
 * This slice exists because one word — "skipped" — covered both a genuine
 * fault and a contractual requirement. Everything else is downstream of
 * keeping those two apart.
 * ───────────────────────────────────────────────────────────────────────────
 */
describe("L-19 a fault and a contractual requirement are not the same thing", () => {
  it("an unconfigured provider is a fault and says so", () => {
    expect(isSkipAFault("provider_unconfigured")).toBe(true);
    const note = describeSkipsForTimeline(["provider_unconfigured"]) ?? "";
    expect(note).toContain("No email was sent");
    expect(note).toContain("RESEND_API_KEY");
    expect(note).toContain("ORDER_EMAIL_FROM");
  });

  it("THE TRAP: a Leafly order stays completely silent", () => {
    // Leafly's Order API spec: "Leafly will be the sole originator of
    // automated consumer facing communications". Not emailing is CORRECT.
    // A warning here would appear on every single marketplace order, staff
    // would learn within a week that it means nothing, and the real warning
    // would then be invisible. This is the assertion that protects that.
    expect(isSkipAFault("marketplace_origin")).toBe(false);
    expect(skipSeverity("marketplace_origin")).toBe("expected");
    expect(describeSkipsForTimeline(["marketplace_origin"])).toBeNull();
    expect(logLineForSkips("GW-1", ["marketplace_origin"])).toBeNull();
  });

  it("a fault alongside a Leafly skip still surfaces, without blaming Leafly", () => {
    const note = describeSkipsForTimeline(["marketplace_origin", "provider_unconfigured"]) ?? "";
    expect(note).toContain("No email was sent");
    expect(note).not.toContain("contractually");
  });

  it("every reason is classified, and the classification is exhaustive", () => {
    // A reason with no severity would be a new silent way for email to vanish.
    for (const r of SKIP_REASONS) {
      expect(["fault", "expected", "normal"]).toContain(skipSeverity(r));
      expect(explainSkip(r).length).toBeGreaterThan(20);
    }
    expect([...FAULT_SKIP_REASONS]).toEqual(["provider_unconfigured", "no_staff_addresses"]);
  });

  it("every fault is actionable and nothing correct nags", () => {
    for (const r of SKIP_REASONS) {
      if (isSkipAFault(r)) expect((skipRemedy(r) ?? "").length).toBeGreaterThan(10);
      if (skipSeverity(r) === "expected") expect(skipRemedy(r)).toBeNull();
    }
  });
});

describe("L-19 the summariser acts on the reason", () => {
  it("THE REPORTED BUG: an unconfigured provider is no longer a quiet success", () => {
    const s = summarizeNotifyOutcomes("GW-1", [
      { audience: "customer", status: "skipped", skipReason: "provider_unconfigured" },
      { audience: "staff", status: "skipped", skipReason: "provider_unconfigured" },
    ]);
    // Before this slice every one of these was the opposite.
    expect(s.ok).toBe(false);
    expect(s.orderEventNote).not.toBeNull();
    expect(s.orderEventNote).toContain("RESEND_API_KEY");
    expect(s.logLine).toContain("NO EMAIL SENT");
  });

  it("...but nothing was ATTEMPTED, so nothing is reported as a failure", () => {
    const s = summarizeNotifyOutcomes("GW-1", [
      { audience: "customer", status: "skipped", skipReason: "provider_unconfigured" },
      { audience: "staff", status: "skipped", skipReason: "provider_unconfigured" },
    ]);
    // The distinction is not pedantry: "we tried and Resend rejected it" and
    // "we never tried" have different fixes.
    expect(s.failures).toEqual([]);
  });

  it("a Leafly order remains a quiet success", () => {
    const s = summarizeNotifyOutcomes("GW-2", [
      { audience: "customer", status: "skipped", skipReason: "marketplace_origin" },
      { audience: "staff", status: "sent" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.orderEventNote).toBeNull();
  });

  it("no customer address is normal and stays quiet", () => {
    const s = summarizeNotifyOutcomes("GW-3", [
      { audience: "customer", status: "skipped", skipReason: "no_customer_address" },
      { audience: "staff", status: "sent" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.orderEventNote).toBeNull();
  });

  it("no staff addresses is a fault, and does not blame the working provider", () => {
    const s = summarizeNotifyOutcomes("GW-4", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "skipped", skipReason: "no_staff_addresses" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.orderEventNote).toContain("ORDER_STAFF_EMAILS");
    expect(s.orderEventNote).not.toContain("RESEND_API_KEY");
  });

  it("an unlabelled skip stays quiet, so old call sites cannot start crying wolf", () => {
    const s = summarizeNotifyOutcomes("GW-5", [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "skipped" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.orderEventNote).toBeNull();
  });

  it("a real failure still outranks a fault-skip", () => {
    const s = summarizeNotifyOutcomes("GW-6", [
      { audience: "customer", status: "skipped", skipReason: "no_staff_addresses" },
      { audience: "staff", status: "failed", detail: "HTTP 401" },
    ]);
    expect(s.failures.length).toBe(1);
    expect(s.orderEventNote).toContain("FAILED");
  });

  it("the two fault lists agree, so the summariser cannot drift from the core", () => {
    // notify-outcome-core duplicates the fault list rather than importing it,
    // to avoid coupling two pure modules. This is the proof they match.
    const src = codeOnly(read(OUTCOME));
    const m = src.match(/const FAULT_SKIP_REASONS = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const declared = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(declared.sort()).toEqual([...FAULT_SKIP_REASONS].sort());
  });

  it("the skip-reason union matches the core's list exactly", () => {
    const src = read(OUTCOME);
    const block = src.slice(src.indexOf("skipReason?:"), src.indexOf("skipReason?:") + 400);
    for (const r of SKIP_REASONS) expect(block).toContain(`"${r}"`);
  });
});

describe("L-19 every skip site names itself", () => {
  it("there are no anonymous skips left in notify.ts", () => {
    const code = codeOnly(read(NOTIFY));
    const skips = [...code.matchAll(/status:\s*"skipped"/g)];
    expect(skips.length).toBeGreaterThanOrEqual(5);
    // Every `status: "skipped"` must be accompanied by a skipReason. An
    // anonymous skip is exactly the bug this slice fixes.
    const reasons = [...code.matchAll(/skipReason:/g)];
    expect(reasons.length).toBeGreaterThanOrEqual(skips.length);
  });

  it("the unconfigured branch is labelled as the fault it is", () => {
    const code = codeOnly(read(NOTIFY));
    const branch = code.slice(code.indexOf("if (!apiKey || !from)"));
    const body = branch.slice(0, branch.indexOf("\n  }"));
    expect(body).toContain("provider_unconfigured");
    expect(body).not.toContain("marketplace_origin");
  });

  it("the marketplace branch is still the marketplace branch", () => {
    const code = codeOnly(read(NOTIFY));
    expect(code).toContain("marketplace_origin");
    // And the suppression itself must survive — this is the contractual half.
    expect(code).toContain("customerAllowed");
  });

  it("the staff branch tells 'not permitted' apart from 'nobody configured'", () => {
    const code = codeOnly(read(NOTIFY));
    expect(code).toContain("not_permitted");
    expect(code).toContain("no_staff_addresses");
    // They are decided by the same ternary, on staffAllowed — the thing that
    // actually distinguishes them.
    expect(code).toMatch(/!staffAllowed\s*\?\s*"not_permitted"\s*:\s*"no_staff_addresses"/);
  });
});

/*
 * ───────────────────────────────────────────────────────────────────────────
 * F11 — THE CHECKLIST THAT LIED.
 *
 * Found during recon for this slice, and very likely what the owner was
 * looking at: setup-status.ts ticked "Set up email sending — done" on
 * RESEND_API_KEY alone, while notify.ts requires that AND ORDER_EMAIL_FROM.
 * ───────────────────────────────────────────────────────────────────────────
 */
describe("L-19 the setup checklist cannot disagree with the notifier", () => {
  it("the half-configured deployment is NOT 'done'", () => {
    const half = assessEmailReadiness({ RESEND_API_KEY: "re_123" });
    expect(half.canSend).toBe(false);
    expect([...half.missing]).toEqual(["ORDER_EMAIL_FROM"]);
  });

  it("the checklist asks the shared predicate, not process.env directly", () => {
    const code = codeOnly(read(SETUP_STATUS));
    expect(code).toContain("assessEmailReadiness");
    // The old one-variable check must be gone.
    expect(code).not.toMatch(/smtpConfigured\s*=\s*Boolean\(process\.env\.RESEND_API_KEY\)/);
  });

  it("both readers are driven by the same function", () => {
    for (const f of [SETUP_STATUS, ORDERS_PAGE]) {
      expect(codeOnly(read(f))).toContain("assessEmailReadiness");
    }
  });

  it("agrees with notify.ts's own gate on every combination", () => {
    // notify.ts sends nothing unless BOTH are present. The readiness check
    // must say exactly the same thing, for all four combinations.
    const cases: [string | undefined, string | undefined, boolean][] = [
      [undefined, undefined, false],
      ["re_123", undefined, false],
      [undefined, "a@b.com", false],
      ["re_123", "a@b.com", true],
      ["", "", false],
      ["  ", "  ", false],
    ];
    for (const [key, from, expected] of cases) {
      const r = assessEmailReadiness({ RESEND_API_KEY: key, ORDER_EMAIL_FROM: from });
      // This mirrors `if (!apiKey || !from)` in notify.ts, inverted.
      const notifyWouldSend = Boolean((key ?? "").trim()) && Boolean((from ?? "").trim());
      expect(r.canSend).toBe(expected);
      expect(r.canSend).toBe(notifyWouldSend);
    }
  });
});

describe("L-19 the owner is told on the screen he is already looking at", () => {
  it("the banner renders nothing when email is healthy", () => {
    const healthy = assessEmailReadiness({
      RESEND_API_KEY: "re_123",
      ORDER_EMAIL_FROM: "orders@greenwaymarijuana.com",
      ORDER_STAFF_EMAILS: "a@b.com",
    });
    // No problem means no banner. Asserted on the data the banner switches on,
    // because a banner that is always there is furniture.
    expect(healthy.problem).toBeNull();
    expect(codeOnly(read(BANNER))).toContain("if (!readiness.problem) return null");
  });

  it("the banner is on the orders dashboard, not buried in settings", () => {
    const page = codeOnly(read(ORDERS_PAGE));
    expect(page).toContain("<EmailReadinessBanner");
    expect(page).toContain("readiness={emailReadiness}");
  });

  it("it distinguishes 'nothing is sending' from 'staff are not being told'", () => {
    const code = codeOnly(read(BANNER));
    expect(code).toContain("const severe = !readiness.canSend");
    expect(code).toContain("--admin-danger");
  });

  it("it uses a colour token that actually exists", () => {
    // There is no `--admin-warning` in this codebase (globals.css); gold is the
    // house attention colour. A missing token resolves to nothing and renders
    // an invisible border — the exact class of bug the legacy aliases at
    // globals.css:92-97 were added to clean up.
    const code = read(BANNER);
    const css = read("src/app/globals.css");
    const tokens = [...code.matchAll(/var\((--admin-[a-z-]+)/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of new Set(tokens)) {
      expect(css).toContain(`${t}:`);
    }
  });

  it("it tells the owner that orders themselves are still safe", () => {
    // The worst outcome of this banner would be an owner who thinks orders are
    // being lost and stops trusting the system.
    const code = read(BANNER);
    expect(code).toContain("Orders themselves are unaffected");
  });
});

describe("L-19 the core is registered and floored", () => {
  it("runs in the pure self-test harness with a floor that bites", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runEmailReadinessTests");
    expect(runner).toContain('"email-readiness-core"');

    const call = runner.slice(runner.indexOf('assertRan("email-readiness-core"'));
    const line = call.slice(0, call.indexOf(");") + 1);
    const floor = Number((line.match(/,\s*(\d+)\s*\)/) ?? [])[1]);
    expect(Number.isInteger(floor)).toBe(true);
    expect(floor).toBeGreaterThanOrEqual(75);

    const measured = __runEmailReadinessTests().passed;
    expect(floor).toBeLessThanOrEqual(measured);
    expect(floor).toBeGreaterThanOrEqual(Math.floor(measured * 0.8));
  });

  it("the core stays pure — no runtime imports", () => {
    const core = read("src/lib/orders/email-readiness-core.ts");
    const importLines = core.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(importLines).toEqual([]);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * L-19 — THE NOTIFIER, ACTUALLY RUN.
 *
 * Added after the mutation probe found a survivor: relabelling the
 * "customer has no address on file" skip as `provider_unconfigured` left
 * every grepped token in place, so every text-matching test above still
 * passed — while the running system would have raised a ⚠️ fault warning on
 * ordinary walk-up orders that simply had no email address. That is the
 * alert-fatigue failure this slice exists to prevent, arriving through the
 * back door.
 *
 * The lesson is the same one Slice 2 learned (rule 13c): asserting that a
 * string appears in a file proves the string appears in the file. It does
 * not prove the branch that uses it is the branch that should. So these
 * tests execute `notifyOrderPlaced` for real, with `fetch` doubled, and
 * assert on the SUMMARY the caller acts on — `ok`, and whether the owner
 * gets a warning on the order timeline.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-19 the notifier, actually run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Configure the provider and double `fetch` so a "send" succeeds. */
  function configured(opts: { staff?: string } = {}) {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("ORDER_EMAIL_FROM", "orders@greenwaymarijuana.com");
    vi.stubEnv("ORDER_STAFF_EMAILS", opts.staff ?? "team@greenwaymarijuana.com");
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: unknown) => {
        calls.push(init);
        return { ok: true, status: 200, text: async () => "" } as unknown as Response;
      }),
    );
    // The suppression path logs deliberately; keep the test output readable.
    vi.spyOn(console, "log").mockImplementation(() => {});
    return calls;
  }

  const order = {
    orderNumber: "GW-1001",
    customerFirstName: "Sam",
    customerEmail: "sam@example.com" as string | null,
    itemCount: 2,
    totalMinorUnits: 4250,
  };

  it("THE SURVIVOR: an order with no email on file is NOT a fault", async () => {
    // A walk-up/phone order with no address is entirely normal. It must not
    // put a warning on the timeline, or staff learn to ignore warnings.
    configured();
    const summary = await notifyOrderPlaced({ ...order, customerEmail: null });
    expect(summary.ok).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.orderEventNote).toBeNull();
  });

  it("THE TRAP: a Leafly order stays silent AND stays calm", async () => {
    // Contractually required silence. Leafly is the sole originator of
    // consumer comms, so no customer email — and no warning about it.
    configured();
    const summary = await notifyOrderPlaced({ ...order, origin: "leafly" });
    expect(summary.ok).toBe(true);
    expect(summary.orderEventNote).toBeNull();
  });

  it("the reported bug: an unconfigured provider is now LOUD", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ORDER_EMAIL_FROM", "");
    const summary = await notifyOrderPlaced({ ...order });
    expect(summary.ok).toBe(false);
    expect(summary.logLine).toContain("NO EMAIL SENT");
    expect(summary.orderEventNote).not.toBeNull();
    expect(summary.orderEventNote).toContain("RESEND_API_KEY");
    // And it must still not have thrown, or checkout would break.
  });

  it("half-configured is just as loud as unconfigured (F11)", async () => {
    // The exact deployment shape that showed a green checklist tick while
    // sending nothing at all.
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("ORDER_EMAIL_FROM", "");
    const summary = await notifyOrderPlaced({ ...order });
    expect(summary.ok).toBe(false);
    expect(summary.orderEventNote).toContain("ORDER_EMAIL_FROM");
  });

  it("nobody configured to receive staff alerts is a fault", async () => {
    configured({ staff: "" });
    const summary = await notifyOrderPlaced({ ...order });
    expect(summary.ok).toBe(false);
    expect(summary.orderEventNote).toContain("ORDER_STAFF_EMAILS");
  });

  it("a lone comma is not a recipient", async () => {
    // Proves the parser is load-bearing here, not decorative.
    configured({ staff: " , " });
    const summary = await notifyOrderPlaced({ ...order });
    expect(summary.ok).toBe(false);
    expect(summary.orderEventNote).toContain("ORDER_STAFF_EMAILS");
  });

  it("the happy path sends two emails and says nothing", async () => {
    const calls = configured();
    const summary = await notifyOrderPlaced({ ...order });
    expect(calls.length).toBe(2);
    expect(summary.ok).toBe(true);
    expect(summary.orderEventNote).toBeNull();
  });

  it("a rejected send is a failure, not a skip, and never throws", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("ORDER_EMAIL_FROM", "orders@greenwaymarijuana.com");
    vi.stubEnv("ORDER_STAFF_EMAILS", "team@greenwaymarijuana.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 422, text: async () => "unverified from" }) as unknown as Response),
    );
    const summary = await notifyOrderPlaced({ ...order });
    expect(summary.ok).toBe(false);
    expect(summary.failures.length).toBeGreaterThan(0);
    expect(summary.orderEventNote).not.toBeNull();
  });
});
