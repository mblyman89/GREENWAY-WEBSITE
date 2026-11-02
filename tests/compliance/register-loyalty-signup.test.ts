/**
 * tests/compliance/register-loyalty-signup.test.ts
 *
 * Owner, verbatim: "I need your help adding a new feature to the iPad
 * register. I need a way to sign up new loyalty customers from the iPad
 * register. ... Make sure to include anything and everything to make the
 * process simple and powerful."
 *
 * Drives the REAL /api/pos/loyalty-signup handlers (fake Supabase), the pure
 * register-loyalty-signup-core, and pins the register wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  __runRegisterLoyaltySignupCoreTests,
  REGISTER_SIGNUP_AUDIT_ACTION,
  REGISTER_SIGNUP_SOURCE,
  interpretSignupResponse,
} from "@/lib/pos/register-loyalty-signup-core";
import { DEFAULT_CONSENT_TEXT } from "@/lib/loyalty/loyalty-consent-core";

// ---------------------------------------------------------------------------
// Fake Supabase: records every call, answers from in-memory tables.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown; columns?: string };
let tables: Record<string, Row[]> = {};
let calls: Call[] = [];
let failNext: { table: string; op: string; error: { code: string; message: string } } | null = null;
let idSeq = 0;

function matches(row: Row, filters: Call["filters"]): boolean {
  return filters.every(([kind, col, val]) => {
    if (kind === "eq") return row[col] === val;
    if (kind === "or") {
      return String(val)
        .split(",")
        .some((part) => {
          const [c, op, ...rest] = part.split(".");
          const v = rest.join(".");
          if (op === "eq") return String(row[c] ?? "") === v;
          if (op === "ilike") return String(row[c] ?? "").toLowerCase() === v.toLowerCase();
          return false;
        });
    }
    return true;
  });
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      const run = (): { data: unknown; error: unknown } => {
        if (failNext && failNext.table === table && failNext.op === call.op) {
          const error = failNext.error;
          failNext = null;
          return { data: null, error };
        }
        const t = (tables[table] ??= []);
        if (call.op === "insert") {
          const row: Row = { id: `${table}-${++idSeq}`, ...(call.payload as Row) };
          if (table === "loyalty_signups" && t.some((r) => r.legacy_id === row.legacy_id)) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          t.push(row);
          return { data: [row], error: null };
        }
        if (call.op === "update") {
          const hit = t.filter((r) => matches(r, call.filters));
          for (const r of hit) Object.assign(r, call.payload as Row);
          return { data: hit, error: null };
        }
        return { data: t.filter((r) => matches(r, call.filters)), error: null };
      };
      b.select = (cols?: string) => {
        call.columns = cols;
        return b;
      };
      b.insert = (p: unknown) => {
        call.op = "insert";
        call.payload = p;
        return b;
      };
      b.update = (p: unknown) => {
        call.op = "update";
        call.payload = p;
        return b;
      };
      b.eq = (c: string, v: unknown) => {
        call.filters.push(["eq", c, v]);
        return b;
      };
      b.or = (v: string) => {
        call.filters.push(["or", "", v]);
        return b;
      };
      b.limit = () => b;
      b.maybeSingle = async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      b.single = async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      b.then = (resolve: (v: unknown) => unknown) => resolve(run());
      return b;
    },
  }),
}));

let authOk = true;
vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () =>
    authOk
      ? { ok: true, device: { id: "11111111-1111-4111-8111-111111111111", name: "Register 1", register_id: "reg-1" } }
      : { ok: false, status: 401, error: "Device key rejected." },
}));

const audits: Row[] = [];
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Row) => void audits.push(e) }));

const enrolled: string[] = [];
vi.mock("@/lib/loyalty/loyalty-store", () => ({
  getConfig: async () => ({ pointsPerDollar: 1, signupBonusPoints: 200, codeExpiryDays: 30 }),
  listTiers: async () => [],
  enrollCustomer: async (customerId: string) => {
    if (!enrolled.includes(customerId)) enrolled.push(customerId);
    return { ok: true, account: { id: `acct-${customerId}` } };
  },
  getAccountByCustomer: async (customerId: string) =>
    enrolled.includes(customerId) ? { id: `acct-${customerId}`, balance_points: 200, lifetime_points: 200 } : null,
}));

vi.mock("@/lib/reports/timezone", async (orig) => ({ ...(await orig<object>()), pacificToday: () => "2026-11-01" }));

const { GET, POST } = await import("@/app/api/pos/loyalty-signup/route");

const SHA = createHash("sha256").update(DEFAULT_CONSENT_TEXT, "utf8").digest("hex");
const RID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function post(body: Row) {
  return POST(
    new Request("https://x.test/api/pos/loyalty-signup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-id": "d", "x-pos-device-key": "k" },
      body: JSON.stringify(body),
    }) as never,
  );
}
const base: Row = {
  clientRequestId: RID,
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1990-04-12",
  dobSource: "scan",
  phone: "(360) 555-0101",
  email: "",
  marketingConsent: false,
  employeeName: "Sam B.",
};

beforeEach(() => {
  tables = { customers: [], loyalty_signups: [], content_blocks: [] };
  calls = [];
  failNext = null;
  audits.length = 0;
  enrolled.length = 0;
  authOk = true;
});

describe("register-loyalty-signup-core", () => {
  it("pure self-tests all pass", () => {
    const r = __runRegisterLoyaltySignupCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(120);
  });
});

describe("GET /api/pos/loyalty-signup", () => {
  it("returns the published consent wording, its hash and the live terms", async () => {
    const res = await GET(new Request("https://x.test/api/pos/loyalty-signup", { headers: { "x-pos-device-id": "d", "x-pos-device-key": "k" } }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(body.consentTextSha256).toBe(SHA);
    expect(body.signupBonusPoints).toBe(200);
    expect(body.terms.signupBonusLine).toContain("200");
  });
  it("uses the PUBLISHED block when there is one", async () => {
    tables.content_blocks = [{ block_key: "loyalty.form.consent_text", published_value: "Custom wording.", status: "published" }];
    const res = await GET(new Request("https://x.test/x", { headers: {} }) as never);
    const body = await res.json();
    expect(body.consentText).toBe("Custom wording.");
  });
  it("refuses an unauthenticated device", async () => {
    authOk = false;
    const res = await GET(new Request("https://x.test/x") as never);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/pos/loyalty-signup", () => {
  it("creates signup + customer, enrolls, audits without PII, returns the member", async () => {
    const res = await post(base);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.outcome).toBe("created");
    expect(body.member.points).toBe(200);
    expect(body.message).toContain("Welcome, Jane");
    const s = tables.loyalty_signups[0];
    expect(s.source).toBe(REGISTER_SIGNUP_SOURCE);
    expect(s.status).toBe("entered");
    expect(s.legacy_id).toBe(`register:${RID}`);
    expect(s.consent).toBe(false);
    expect(s.birthday).toBe("1990-04-12");
    const c = tables.customers[0];
    expect(c.loyalty_signup_id).toBe(s.id);
    expect(c.import_source).toBe("register-signup");
    expect(c.marketing_consent).toBe(false);
    expect(c.phone_normalized).toBe("3605550101");
    expect(enrolled).toEqual([c.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe(REGISTER_SIGNUP_AUDIT_ACTION);
    const auditText = JSON.stringify(audits[0].after);
    expect(auditText).not.toContain("555");
    expect(auditText).not.toContain("1990");
  });

  it("a retry with the same request id replays (no second account)", async () => {
    await post(base);
    const res = await post(base);
    const body = await res.json();
    expect(body.outcome).toBe("replayed");
    expect(tables.customers).toHaveLength(1);
    expect(tables.loyalty_signups).toHaveLength(1);
  });

  it("finds an existing account by phone and lets the budtender choose", async () => {
    tables.customers = [
      { id: "cust-old", first_name: "Janet", last_name: "Doe", phone: "(360) 555-0101", phone_normalized: "3605550101", email: null, email_normalized: null, birthdate: null, marketing_consent: false, do_not_contact: false, loyalty_signup_id: null },
    ];
    const res = await post(base);
    const body = await res.json();
    expect(body.status).toBe("duplicates");
    expect(body.matches[0].customerId).toBe("cust-old");
    expect(tables.loyalty_signups).toHaveLength(0); // nothing written yet

    const use = await (await post({ ...base, useExistingCustomerId: "cust-old" })).json();
    // not a uuid -> ignored by parse -> duplicates again (ids are uuids in prod)
    expect(use.status).toBe("duplicates");
  });

  it("use this account links the existing customer (fills gaps, enrolls)", async () => {
    const id = "99999999-2222-4333-8444-555555555555";
    tables.customers = [
      { id, first_name: "Jane", last_name: "Doe", phone: null, phone_normalized: null, email: null, email_normalized: null, birthdate: "1990-04-12", marketing_consent: false, do_not_contact: false, loyalty_signup_id: null },
    ];
    const first = await (await post(base)).json();
    expect(first.status).toBe("duplicates");
    expect(first.matches[0].bases).toContain("name_dob");
    const res = await post({ ...base, useExistingCustomerId: id });
    const body = await res.json();
    expect(body.outcome).toBe("linked");
    expect(tables.customers).toHaveLength(1);
    expect(tables.customers[0].phone_normalized).toBe("3605550101");
    expect(tables.customers[0].loyalty_signup_id).toBe(tables.loyalty_signups[0].id);
    expect(enrolled).toEqual([id]);
  });

  it("create anyway makes a new account despite a match", async () => {
    tables.customers = [
      { id: "cust-old", first_name: "Janet", last_name: "Roe", phone: "(360) 555-0101", phone_normalized: "3605550101", email: null, email_normalized: null, birthdate: null, marketing_consent: false, do_not_contact: false, loyalty_signup_id: null },
    ];
    const body = await (await post({ ...base, createAnyway: true })).json();
    expect(body.outcome).toBe("created");
    expect(tables.customers).toHaveLength(2);
  });

  it("consent: stores the signed wording when the hash matches", async () => {
    const body = await (await post({ ...base, marketingConsent: true, signature: "Jane Doe", consentTextSha256: SHA })).json();
    expect(body.outcome).toBe("created");
    const s = tables.loyalty_signups[0];
    expect(s.consent).toBe(true);
    expect(s.signature).toBe("Jane Doe");
    expect(s.consent_text).toBe(DEFAULT_CONSENT_TEXT);
    expect(s.consent_text_sha256).toBe(SHA);
    expect(tables.customers[0].marketing_consent).toBe(true);
  });

  it("consent: refuses (409) when the wording changed, and sends the new wording", async () => {
    const res = await post({ ...base, marketingConsent: true, signature: "Jane Doe", consentTextSha256: "0".repeat(64) });
    expect(res.status).toBe(409);
    const r = interpretSignupResponse(res.status, await res.json());
    expect(r.kind).toBe("consent_changed");
    expect(tables.loyalty_signups).toHaveLength(0);
  });

  it("refuses under 21 and a missing contact (400 with field errors)", async () => {
    const young = await post({ ...base, dateOfBirth: "2005-11-02" });
    expect(young.status).toBe(400);
    expect((await young.json()).fields.dateOfBirth).toBeTruthy();
    const none = await post({ ...base, phone: "", email: "" });
    expect((await none.json()).fields.contact).toBeTruthy();
    expect(tables.loyalty_signups).toHaveLength(0);
  });

  it("classifies a permission error instead of failing silently", async () => {
    failNext = { table: "loyalty_signups", op: "insert", error: { code: "42501", message: "permission denied for table loyalty_signups" } };
    const res = await post(base);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("0330");
    expect(tables.customers).toHaveLength(0);
  });

  it("reads customers with explicit columns only", async () => {
    await post(base);
    const reads = calls.filter((c) => c.table === "customers" && c.op === "select" && c.columns);
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.columns).not.toContain("*");
  });
});

describe("register wiring", () => {
  const shell = readFileSync("src/app/(site)/pos/RegisterShell.tsx", "utf8");
  const flow = readFileSync("src/app/(site)/pos/SaleFlow.tsx", "utf8");
  const sheet = readFileSync("src/app/(site)/pos/RegisterLoyaltySignup.tsx", "utf8");
  it("the shell calls the route with device headers and is online-only", () => {
    expect(shell).toContain('posFetch("/api/pos/loyalty-signup"');
    expect(shell).toContain("onLoyaltySignup={{");
    expect(shell).toMatch(/onLoyaltySignup=\{\{[\s\S]*?navigator\.onLine[\s\S]*?x-pos-device-key/);
  });
  it("SaleFlow threads it to the customer band and keeps the scanned name", () => {
    expect(flow).toContain("setScannedName(scannedName)");
    expect(flow).toContain("<RegisterLoyaltySignup");
    expect(flow).toContain("Sign up for loyalty");
    expect(flow).toContain("onStartSignup={startSignup}");
  });
  it("the sheet locks the birthday to the ID verdict and re-sends one request id", () => {
    expect(sheet).toContain("dateOfBirth: verdict.dateOfBirth");
    expect(sheet).toContain("crypto.randomUUID()");
    expect(sheet).toContain("useState(false)"); // consent starts unchecked
    expect(sheet).toContain("Use this account");
    expect(sheet).toContain("create a new account anyway");
  });
});
