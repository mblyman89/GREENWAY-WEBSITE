/**
 * tests/compliance/d184-partner-ai.test.ts   (D184, round slice S7)
 *
 * Owner (2026-11-05): "Set ai to be level 2 to start."
 *
 * Pins: Level 2 is the default and 3 is not open; the AI module never writes
 * (no insert/update/delete/upsert/rpc in partner-store outside the level
 * setting); fixes run only through the four approved tools; applying a fix
 * re-derives it from fresh data by id; money, counts and CCRS wait for the
 * owner; the level switch is owner only; no new cron.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runPartnerTests, DEFAULT_PARTNER_LEVEL, gateFor, mayApply, parsePartnerLevel, PARTNER_TOOLS } from "@/lib/ai/partner-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("D184 S7: Greenway Partner AI at Level 2", () => {
  it("the pure self-test passes", () => {
    const r = __runPartnerTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(38);
  });

  it("Level 2 is the default; Level 3 is not open", () => {
    expect(DEFAULT_PARTNER_LEVEL).toBe(2);
    expect(parsePartnerLevel(undefined)).toBe(2);
    expect(parsePartnerLevel({ level: 3 })).toBe(2);
  });

  it("anything touching money, counts or CCRS waits for the owner", () => {
    for (const t of Object.values(PARTNER_TOOLS)) {
      const g = gateFor(t.id, 2);
      if (t.touches !== "nothing") {
        expect(g).toBe("owner_approves");
        expect(mayApply(g, false)).toBe(false);
      }
    }
    expect(gateFor("retry_sale", 2)).toBe("auto");
  });

  it("the partner store only writes the level setting itself; every other change goes through an approved tool", () => {
    const s = read("src/lib/ai/partner-store.ts");
    const writes = s.match(/\.(insert|update|delete|upsert|rpc)\(/g) ?? [];
    expect(writes).toEqual([".upsert("]);
    expect(s).toMatch(/key: PARTNER_LEVEL_KEY/);
    // the four tools and nothing else
    expect(s).toMatch(/retryPosException\(p\.payload\.exceptionId, \{ mode: "retry"/);
    expect(s).toMatch(/retryPosException\(p\.payload\.exceptionId, \{ mode: "record_as_rung", actor: "owner"/);
    expect(s).toMatch(/moveSaleLine\(p\.payload\.repair/);
    expect(s).toMatch(/correctCount\(p\.payload\.repair/);
    expect(s).not.toMatch(/\.sql\(|execute_sql|raw sql/i);
  });

  it("applying re-derives the proposal from fresh data by id, refuses on a read error, and audits", () => {
    const s = read("src/lib/ai/partner-store.ts");
    const apply = s.slice(s.indexOf("export async function applyProposal"));
    expect(apply).toMatch(/await partnerNow\(\)/);
    expect(apply).toMatch(/findProposal\(proposals, id\)/);
    expect(apply).toMatch(/facts\.readErrors\.length/);
    expect(apply).toMatch(/mayApply\(p\.gate, actor\.isOwner\)/);
    expect(apply).toMatch(/partner\.fix_applied/);
    expect(apply).toMatch(/partner\.fix_refused/);
  });

  it("the AI answer cannot carry a write: the ask path calls generate only", () => {
    const s = read("src/lib/ai/partner-store.ts");
    const ask = s.slice(s.indexOf("export async function askPartner"), s.indexOf("export async function applyProposal"));
    expect(ask).toMatch(/generate\(/);
    expect(ask).not.toMatch(/applyProposal|moveSaleLine|correctCount|retryPosException/);
  });

  it("the level switch is owner only; the page and fix action are manager types", () => {
    const a = read("src/app/admin/partner/actions.ts");
    const save = a.slice(a.indexOf("export async function savePartnerLevelAction"));
    expect(save).toMatch(/await requireBooksAccess\(\)/);
    expect(a).toMatch(/applyProposalAction[\s\S]*requirePermission\("staffing\.manage"\)/);
    const p = read("src/app/admin/partner/page.tsx");
    expect(p).toMatch(/requirePermission\("staffing\.manage"\)/);
    expect(p).toMatch(/isOwner \? \(\s*<Card>\s*<form action=\{savePartnerLevelAction\}/);
    const item = adminNav.find((i) => i.href === "/admin/partner");
    expect(item?.permission).toBe("staffing.manage");
  });

  it("the chat client imports no server module", () => {
    const c = read("src/components/admin/partner/PartnerChat.tsx");
    expect(c).not.toMatch(/partner-store/);
    expect(c.startsWith('"use client"')).toBe(true);
  });

  it("no new cron", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.some((c) => /partner/.test(c.path))).toBe(false);
  });

  it("registered in the pure self-test harness", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("partner-core", __runPartnerTests\(\), 47\)/);
  });
});
