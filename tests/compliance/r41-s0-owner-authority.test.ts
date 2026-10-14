/**
 * tests/compliance/r41-s0-owner-authority.test.ts  (R41 S0)
 *
 * Owner decisions, round 6 (verbatim in the PR):
 *   D-4  managers no longer build vendor ACH files.
 *   D-5  only the owner and admin drop ACH documents.
 *   D-6  option B: Michael (owner) acts alone with a receipt; Stephen's (admin)
 *        stop actions take effect at once, alert Michael and go on his review
 *        list; every other live admin action is a request Michael approves.
 *   D-7  requests never expire; a daily reminder; stale requests are refused.
 *   D-8  "Was this you?" receipts go to the owner.
 *
 * Part 1 drives the REAL achGate with its server dependencies mocked, so each
 * route (run + receipt, request, stop + review, refuse, replay) is shown to do
 * exactly what it should and nothing else. Part 2 reads source and migrations
 * so a later edit cannot quietly route an ACH action around the gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mocks (hoisted) ─────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    role: "owner" as string,
    id: "11111111-1111-4111-8111-111111111111",
    mails: [] as { to: string[]; subject: string; html: string }[],
    inserted: [] as Record<string, unknown>[],
    reviews: [] as Record<string, unknown>[],
    superseded: [] as Record<string, unknown>[],
    versionCalls: 0,
    encrypt: (s: string) => `encv1:${Buffer.from(s).toString("base64")}`,
    reviewOk: true,
    mailOk: true,
  };
  return state;
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({
    userId: h.id,
    email: `${h.role}@greenwaymarijuana.com`,
    profile: { id: h.id, role: h.role, full_name: h.role === "owner" ? "Michael" : "Stephen", active: true },
  }),
}));
vi.mock("@/lib/security/at-rest-crypto", () => ({ encryptSecret: (s: string) => h.encrypt(s) }));
vi.mock("@/lib/payments/ach-requests-store", () => ({
  readTargetVersion: async () => {
    h.versionCalls += 1;
    return { ok: true, version: "v1" };
  },
  labelForTarget: async (_k: string, id: string | null) => `Target ${id ?? "-"}`,
  insertChangeRequest: async (r: Record<string, unknown>) => {
    h.inserted.push(r);
    return { ok: true, id: "r1" };
  },
  insertOwnerReview: async (r: Record<string, unknown>) => {
    h.reviews.push(r);
    return h.reviewOk ? { ok: true } : { ok: false, error: "x" };
  },
  supersedePendingFor: async (r: Record<string, unknown>) => {
    h.superseded.push(r);
    return { superseded: 0, failed: 0 };
  },
}));
vi.mock("@/lib/payments/ach-ops-store", () => ({
  resendOpsMailer: () => async (to: string[], m: { subject: string; html: string }) => {
    h.mails.push({ to, ...m });
    return { ok: h.mailOk };
  },
}));

import { achGate, NO_KEY_REFUSAL, REPLAY_MISMATCH, runAsApprovalReplay } from "@/lib/payments/ach-gate";
import { ACH_ACTION_KINDS, classifyAchAction, REFUSE_NO_ACH_ROLE, REQUEST_SENT_MESSAGE, STOP_DONE_SUFFIX } from "@/lib/auth/ach-authority-core";
import { KIND_SPECS, redirectUrlFromDigest } from "@/lib/payments/ach-gate-core";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const as = (role: string, id: string) => {
  h.role = role;
  h.id = id;
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
type Reply = { ok: boolean; message: string };
const reply = (r: Reply) => r;
/** Run the gate and return what reached the person: a reply value, or the redirect URL. */
async function gate(kind: Parameters<typeof achGate>[0], fd: FormData, body: () => Promise<Reply>) {
  let ran = 0;
  try {
    const v = await achGate<Reply>(kind, fd, { reply }, async () => {
      ran += 1;
      return body();
    });
    return { ran, value: v as Reply, url: null as string | null };
  } catch (e) {
    const url = redirectUrlFromDigest((e as { digest?: unknown }).digest);
    if (url === null) throw e;
    return { ran, value: null, url };
  }
}
const back = (qs: string) => async (): Promise<Reply> => {
  const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
  e.digest = `NEXT_REDIRECT;replace;/admin/settings/banking?${qs};307;`;
  throw e;
};

beforeEach(() => {
  h.mails = [];
  h.inserted = [];
  h.reviews = [];
  h.superseded = [];
  h.versionCalls = 0;
  h.reviewOk = true;
  h.mailOk = true;
  h.encrypt = (s: string) => `encv1:${Buffer.from(s).toString("base64")}`;
});

// =============================================================================
describe("achGate: the owner acts alone and gets a receipt (D-6, D-8)", () => {
  it("runs the body once, keeps the body's redirect, supersedes pending requests for the record, emails Michael a receipt", async () => {
    as("owner", OWNER);
    const r = await gate("vendor_bank.release", form({ vendor_id: VENDOR }), back("msg=Released"));
    expect(r.ran).toBe(1);
    expect(r.url).toBe("/admin/settings/banking?msg=Released");
    expect(h.inserted).toHaveLength(0);
    expect(h.reviews).toHaveLength(0);
    expect(h.superseded).toEqual([{ ownerKind: "vendor_bank.release", targetType: "vendor", targetId: VENDOR, actorId: OWNER }]);
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toEqual(["michael@greenwaymarijuana.com"]);
  });
  it("a refused body (error=) sends no receipt and supersedes nothing", async () => {
    as("owner", OWNER);
    const r = await gate("vendor_bank.release", form({ vendor_id: VENDOR }), back("error=Call+first"));
    expect(r.url).toContain("error=Call+first");
    expect(h.mails).toHaveLength(0);
    expect(h.superseded).toHaveLength(0);
  });
  it("a real error is not swallowed and sends nothing", async () => {
    as("owner", OWNER);
    await expect(
      achGate("vendor_bank.release", form({ vendor_id: VENDOR }), { reply }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(h.mails).toHaveLength(0);
  });
});

describe("achGate: Stephen's live action becomes a request; nothing runs (D-6, D-7)", () => {
  it("stores an encrypted payload with the live version, emails Michael, tells Stephen, never runs the body", async () => {
    as("admin", ADMIN);
    const r = await gate("vendor_bank.release", form({ vendor_id: VENDOR, note: "Maria read back 4821", request_note: "please" }), back("msg=should-not-run"));
    expect(r.ran).toBe(0);
    expect(r.value).toEqual({ ok: true, message: REQUEST_SENT_MESSAGE });
    expect(h.versionCalls).toBe(1);
    expect(h.inserted).toHaveLength(1);
    const ins = h.inserted[0];
    expect(ins).toMatchObject({ kind: "vendor_bank.release", targetId: VENDOR, baseVersion: "v1", requestedBy: ADMIN, reason: "please" });
    expect(String(ins.payloadEnc).startsWith("encv1:")).toBe(true);
    expect(JSON.stringify(ins.summary)).not.toContain("encv1:");
    expect(h.mails).toHaveLength(1);
    expect(h.superseded).toHaveLength(0);
  });
  it("without the encryption key nothing is stored and Stephen is told why", async () => {
    as("admin", ADMIN);
    h.encrypt = (s) => s; // what encryptSecret returns when DATA_ENCRYPTION_KEY is unset
    const r = await gate("vendor_bank.release", form({ vendor_id: VENDOR }), back("msg=x"));
    expect(r.ran).toBe(0);
    expect(r.value).toEqual({ ok: false, message: NO_KEY_REFUSAL });
    expect(h.inserted).toHaveLength(0);
  });
  it("if the email fails the request still stands and Stephen is told to tell Michael", async () => {
    as("admin", ADMIN);
    h.mailOk = false;
    const r = await gate("employee_hold.release", form({ auth_id: VENDOR }), back("msg=x"));
    expect(h.inserted).toHaveLength(1);
    expect(r.value?.message).toContain("did not go");
  });
  it("every live kind is a request for the admin (none runs)", async () => {
    as("admin", ADMIN);
    for (const k of ACH_ACTION_KINDS.filter((x) => classifyAchAction(x) === "live")) {
      h.inserted = [];
      const r = await gate(k, form({ vendor_id: VENDOR, auth_id: VENDOR, notice_id: VENDOR, account_id: VENDOR, document_id: VENDOR, invite_id: VENDOR }), back("msg=x"));
      expect(r.ran, k).toBe(0);
      expect(h.inserted.length, k).toBe(1);
    }
  });
});

describe("achGate: Stephen's stop action takes effect at once, alerts Michael, goes on his review list (D-6)", () => {
  it("runs, records a review item, emails Michael, and adds the suffix to Stephen's message", async () => {
    as("admin", ADMIN);
    const r = await gate("vendor_bank.hold", form({ vendor_id: VENDOR, hold_reason: "Odd email" }), back("msg=On+hold."));
    expect(r.ran).toBe(1);
    expect(h.reviews).toHaveLength(1);
    expect(h.reviews[0]).toMatchObject({ kind: "vendor_bank.hold", doneBy: ADMIN });
    expect(h.mails).toHaveLength(1);
    expect(new URLSearchParams(r.url!.split("?")[1]).get("msg")).toBe(`On hold. ${STOP_DONE_SUFFIX}`);
    expect(h.inserted).toHaveLength(0);
  });
  it("if the review item cannot be saved Stephen is told to tell Michael himself", async () => {
    as("admin", ADMIN);
    h.reviewOk = false;
    const r = await gate("vendor_bank.hold", form({ vendor_id: VENDOR }), back("msg=On+hold."));
    expect(new URLSearchParams(r.url!.split("?")[1]).get("msg")).toContain("could NOT be saved");
  });
  it("exactly two stop kinds exist: logging a notice and putting vendor banking on hold", () => {
    expect(ACH_ACTION_KINDS.filter((k) => classifyAchAction(k) === "stop").sort()).toEqual(["ach_notice.log", "vendor_bank.hold"]);
  });
});

describe("achGate: everyone else is refused (D-4, D-9)", () => {
  for (const role of ["manager", "budtender", "content_editor", ""]) {
    it(`${role || "(no role)"}: refused, nothing runs, nothing stored, nobody emailed`, async () => {
      as(role, ADMIN);
      const r = await gate("vendor_ach.build", form({}), back("msg=x"));
      expect(r.ran).toBe(0);
      expect(r.value).toEqual({ ok: false, message: REFUSE_NO_ACH_ROLE });
      expect(h.inserted.length + h.reviews.length + h.mails.length).toBe(0);
    });
  }
});

describe("achGate: approval replay", () => {
  it("runs for the owner when kind and record match, with no new request or receipt (the approval sends its own)", async () => {
    as("owner", OWNER);
    const r = await runAsApprovalReplay({ kind: "vendor_bank.release", targetId: VENDOR, ownerId: OWNER }, () =>
      gate("vendor_bank.release", form({ vendor_id: VENDOR }), back("msg=Released")),
    );
    expect(r.ran).toBe(1);
    expect(h.mails.length + h.inserted.length + h.superseded.length).toBe(0);
  });
  it.each([
    ["another kind", { kind: "vendor_bank.archive", targetId: VENDOR, ownerId: OWNER }, "owner", OWNER],
    ["another record", { kind: "vendor_bank.release", targetId: ADMIN, ownerId: OWNER }, "owner", OWNER],
    ["another owner id", { kind: "vendor_bank.release", targetId: VENDOR, ownerId: ADMIN }, "owner", OWNER],
    ["an admin session", { kind: "vendor_bank.release", targetId: VENDOR, ownerId: ADMIN }, "admin", ADMIN],
  ] as const)("is refused for %s", async (_n, ctx, role, id) => {
    as(role, id);
    const r = await runAsApprovalReplay(ctx as never, () => gate("vendor_bank.release", form({ vendor_id: VENDOR }), back("msg=x")));
    expect(r.ran).toBe(0);
    expect(r.value).toEqual({ ok: false, message: REPLAY_MISMATCH });
  });
});

// =============================================================================
// Part 2: source invariants
// =============================================================================
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GATED_FILES: Record<string, string[]> = {
  "src/app/admin/settings/banking/vault-actions.ts": [
    "vendor_bank.save", "vendor_bank.hold", "vendor_bank.release", "vendor_bank.verify", "vendor_bank.archive",
    "vendor_contact.add", "vendor_contact.retire", "employee_bank.save", "employee_bank.clear",
  ],
  "src/app/admin/settings/banking/ops-actions.ts": [
    "ach_notice.log", "ach_notice.resolve", "employee_hold.release", "ach_check.start", "ach_check.mark_sent", "ach_check.finish", "legal_hold.set", "annual_review.done",
  ],
  "src/app/admin/settings/banking/document-actions.ts": ["ach_document.reject"],
  "src/app/admin/vendors/vendor-esign-actions.ts": ["vendor_esign.countersign", "vendor_esign.reject"],
  "src/app/admin/vendor-payments/actions.ts": ["vendor_ach.build"],
};

describe("every ACH kind is gated exactly once, and the approval replay covers every kind", () => {
  it("each kind appears in exactly one achGate(...) call across the app", () => {
    const files = [...Object.keys(GATED_FILES)];
    const walk = (d: string): string[] =>
      readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
    const all = walk("src/app").filter((f) => strip(read(f)).includes("achGate("));
    for (const f of all) if (!files.includes(f)) files.push(f);
    const seen = new Map<string, string[]>();
    for (const f of files) {
      for (const m of strip(read(f)).matchAll(/achGate(?:<[^>]*>)?\(\s*"([a-z_.]+)"/g)) seen.set(m[1], [...(seen.get(m[1]) ?? []), f]);
    }
    for (const k of ACH_ACTION_KINDS) expect(seen.get(k)?.length ?? 0, k).toBe(1);
    expect([...seen.keys()].filter((k) => !ACH_ACTION_KINDS.includes(k as never))).toEqual([]);
    for (const [f, kinds] of Object.entries(GATED_FILES)) for (const k of kinds) expect(seen.get(k), k).toEqual([f]);
  });
  it("the approvals REPLAY map names every kind once and nothing else", () => {
    const src = read("src/app/admin/settings/banking/approvals/actions.ts");
    const block = src.slice(src.indexOf("const REPLAY"), src.indexOf("\n};", src.indexOf("const REPLAY")));
    const keys = [...block.matchAll(/^\s+"([a-z_.]+)":/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...ACH_ACTION_KINDS].sort());
  });
  it("the approvals file exports only async server actions (no helper becomes a public endpoint)", () => {
    const src = read("src/app/admin/settings/banking/approvals/actions.ts");
    expect(src.trimStart().startsWith('"use server";')).toBe(true);
    const exps = [...src.matchAll(/^export (?!type )(\S+ \S+)/gm)].map((m) => m[1]);
    expect(exps.every((e) => e === "async function")).toBe(true);
  });
  it("approving needs the owner (ach.act) before anything is read", () => {
    const src = read("src/app/admin/settings/banking/approvals/actions.ts");
    const i = src.indexOf("export async function approveAchRequestAction(");
    const body = src.slice(i, src.indexOf("\nexport ", i + 10));
    expect(body).toContain('requirePermission("ach.act")');
    expect(body.indexOf('requirePermission("ach.act")')).toBeLessThan(body.indexOf("getChangeRequest("));
  });
});

describe("KIND_SPECS name real columns (stale check reads what exists)", () => {
  const sql = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => read(`supabase/migrations/${f}`)).join("\n");
  for (const k of ACH_ACTION_KINDS) {
    const v = KIND_SPECS[k].version;
    if (!v) continue;
    it(`${k}: ${v.table}(${[v.key, ...v.cols].join(", ")})`, () => {
      expect(sql, v.table).toMatch(new RegExp(`create table (if not exists )?public\\.${v.table}\\b`));
      for (const c of [v.key, ...v.cols]) expect(sql, `${v.table}.${c}`).toMatch(new RegExp(`\\b${c}\\b`));
    });
  }
});

describe("D-4: vendor ACH file build is gated; managers see a note, not the form", () => {
  it("the build action goes through achGate with the vendor-build outcome", () => {
    const src = read("src/app/admin/vendor-payments/actions.ts");
    expect(src).toMatch(/return achGate\("vendor_ach\.build", formData, \{ reply: buildReply, outcomeOf: vendorBuildOutcome \}/);
    expect(src).not.toMatch(/export async function buildVendorAchBody/);
  });
  it("the page reads achAuthority and hides the form for 'none'", () => {
    const page = read("src/app/admin/vendor-payments/page.tsx");
    expect(page).toContain("achAuthority(session.profile.role)");
    expect(page).toMatch(/achSide === "none"/);
  });
});

describe("D-7: the daily reminder cron is wired once, once a day", () => {
  it("vercel.json schedules it daily; the route fails closed", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const c = v.crons.filter((x) => x.path === "/api/cron/ach-approvals-reminder");
    expect(c).toEqual([{ path: "/api/cron/ach-approvals-reminder", schedule: "0 15 * * *" }]);
    const route = read("src/app/api/cron/ach-approvals-reminder/route.ts");
    expect(route).toContain("claimDailyReminder(");
    expect(route).toMatch(/CRON_SECRET/);
  });
});

describe("old wording is gone from the live ACH paths", () => {
  const FILES = [
    "src/app/admin/settings/banking/ops-actions.ts",
    "src/app/admin/settings/banking/vault-actions.ts",
    "src/app/admin/settings/banking/operations/page.tsx",
    "src/lib/payments/ach-authorization-core.ts",
    "src/lib/payments/ach-ops-core.ts",
    "src/lib/payments/vault-release-core.ts",
    "src/lib/payments/vendor-esign-core.ts",
  ];
  for (const f of FILES) {
    it(f, () => {
      const s = strip(read(f));
      expect(s).not.toMatch(/MIN_SOLO_REASON_CHARS|actorCanManage|notifyOther/);
      expect(s).not.toMatch(/Michael or Stephen can|the other owner/i);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3. The three statements of "who may act" must agree: the role map
// (roles.ts), the routing core (ach-authority-core.ts) and the database
// (0271 ach_actor_is_owner). roles.ts says "a vitest pins both"; this is it.
// The gate tests above mock requirePermission, so they cannot see the map.
// ═══════════════════════════════════════════════════════════════════════════
describe("D-6: role map, routing core and database agree on who acts", () => {
  it("ach.act is exactly the owner; ach.request is exactly owner + admin", async () => {
    const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
    expect(roles.rolesForPermission("ach.act")).toEqual(["owner"]);
    expect([...roles.rolesForPermission("ach.request")].sort()).toEqual(["admin", "owner"]);
  });

  it("for every role, can(ach.act) ⇔ achAuthority = act and can(ach.request) ⇔ authority ≠ none", async () => {
    const roles = await vi.importActual<typeof import("@/lib/auth/roles")>("@/lib/auth/roles");
    const { achAuthority } = await vi.importActual<typeof import("@/lib/auth/ach-authority-core")>(
      "@/lib/auth/ach-authority-core",
    );
    expect(roles.ALL_ROLES.length).toBeGreaterThan(3);
    for (const r of roles.ALL_ROLES) {
      expect(roles.can(r, "ach.act"), r).toBe(achAuthority(r) === "act");
      expect(roles.can(r, "ach.request"), r).toBe(achAuthority(r) !== "none");
    }
  });

  it("the database rule is the same: active owner only", () => {
    const sql = read("supabase/migrations/0271_ach_owner_authority.sql").replace(/\s+/g, " ");
    expect(sql).toContain(
      "select p_actor is not null and exists ( select 1 from public.staff_profiles where id = p_actor and active = true and role = 'owner' );",
    );
  });
});
