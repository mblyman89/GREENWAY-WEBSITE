/**
 * R39 S7 — wiring invariants for vendor-side e-sign (public page, actions,
 * copy route, admin card, banking participation panel, privacy plumbing).
 * These read source, so a careless edit that drops a permission, a cookie
 * check, a header, a form field or the analytics suppression trips a test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseVendorForm } from "@/lib/payments/vendor-esign-core";
import { isNoTrackPath } from "@/lib/analytics/no-track-paths";
import { isAgeGateExemptPath } from "@/lib/age-gate/age-gate-core";

const read = (p: string) => readFileSync(p, "utf8");
const PUB = "src/app/(site)/vendor-ach/[token]";
const ACTIONS = read(`${PUB}/actions.ts`);
const PAGE = read(`${PUB}/page.tsx`);
const FORM = read(`${PUB}/VendorSignForm.tsx`);
const ROUTE = read(`${PUB}/copy/route.ts`);
const PATHS = read(`${PUB}/paths.ts`);
const ADMIN = read("src/app/admin/vendors/vendor-esign-actions.ts");
const CARD = read("src/app/admin/vendors/[id]/VendorEsignCard.tsx");
const VPAGE = read("src/app/admin/vendors/[id]/page.tsx");
const BANK = read("src/app/admin/settings/banking/page.tsx");
const PANEL = read("src/app/admin/settings/banking/VendorParticipationPanel.tsx");
const LAYOUT = read("src/app/(site)/layout.tsx");
const ROBOTS = read("src/app/robots.ts");
const GATE = read("src/components/analytics/NoTrackGate.tsx");

function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} exists`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}
const firstLine = (body: string) => body.slice(body.indexOf("{") + 1).trim().split("\n")[0];
/** R41 S0: an exported action's body, or the private *Body it hands to achGate. */
function impl(src: string, name: string): string {
  const exported = fn(src, name);
  if (!firstLine(exported).startsWith("return achGate(")) return exported;
  const b = name.replace(/Action$/, "Body");
  const i = src.indexOf(`async function ${b}(`);
  expect(i, `${b} exists`).toBeGreaterThan(-1);
  expect(src.slice(Math.max(0, i - 7), i), `${b} is not exported`).not.toBe("export ");
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("admin vendor e-sign actions: gather on settings.manage, live through achGate (R41 S0, D-6)", () => {
  const NAMES = ["sendVendorEsignLinkAction", "cancelVendorEsignAction", "countersignVendorEsignAction", "rejectVendorEsignAction", "bulkInviteVendorsAction"];
  it("R41 S0: gather steps (send, cancel, bulk invite) need settings.manage first; live steps (countersign, reject) go through achGate first", () => {
    expect(ADMIN.trimStart().startsWith('"use server";') || ADMIN.includes('\n"use server";')).toBe(true);
    // Plan v4 S0 table: "Send an e-sign link ... cancel a link | gather"; "Countersign or reject a vendor e-sign | live".
    for (const n of ["sendVendorEsignLinkAction", "cancelVendorEsignAction", "bulkInviteVendorsAction"]) {
      expect(firstLine(fn(ADMIN, n)), n).toBe('const session = await requirePermission("settings.manage");');
    }
    expect(firstLine(fn(ADMIN, "countersignVendorEsignAction"))).toBe(
      'return achGate("vendor_esign.countersign", fd, { reply: replyFor(fd) }, (session) => countersignVendorEsignBody(session, fd));',
    );
    expect(firstLine(fn(ADMIN, "rejectVendorEsignAction"))).toBe(
      'return achGate("vendor_esign.reject", fd, { reply: replyFor(fd) }, (session) => rejectVendorEsignBody(session, fd));',
    );
    expect([...ADMIN.matchAll(/export async function /g)].length).toBe(NAMES.length);
  });
  it("invite ownership: the invite must belong to the vendor in the form", () => {
    expect(ADMIN).toMatch(/if \(!inv \|\| inv\.vendor_id !== vendorId\) back\(/);
    for (const n of NAMES.slice(1, 4)) expect(impl(ADMIN, n), n).toContain("await inviteFor(fd, vendorId)");
  });
  it("countersign needs the callback checkbox BEFORE the store is called", () => {
    const b = impl(ADMIN, "countersignVendorEsignAction");
    expect(b.indexOf('str(fd, "callback_done") !== "on"')).toBeGreaterThan(-1);
    expect(b.indexOf('str(fd, "callback_done") !== "on"')).toBeLessThan(b.indexOf("countersignVendorInvite("));
  });
  it("bulk invite needs the confirm checkbox and refuses when 0262 is missing", () => {
    const b = fn(ADMIN, "bulkInviteVendorsAction");
    expect(b.indexOf('str(fd, "confirm") !== "on"')).toBeLessThan(b.indexOf("participationRows("));
    expect(b).toContain("if (!part.ready) redirect(");
    expect(b).toContain("VENDOR_BULK_PAUSE_MS");
  });
  it("every admin action is audited with the signed-in profile", () => {
    for (const n of NAMES.slice(0, 4)) expect(impl(ADMIN, n), n).toMatch(/recordAudit\(\{\s*actorId: session\.profile\.id/);
  });
  it("redirects never echo raw form values", () => {
    for (const m of ADMIN.matchAll(/redirect\(([^;]*)\);/g)) expect(m[1]).not.toMatch(/fd\.get|str\(fd/);
  });
});

describe("public vendor actions: token + cookie, no staff session", () => {
  it("never asks for a staff permission (vendors have no login)", () => {
    expect(ACTIONS).not.toContain("requirePermission");
    expect(ACTIONS.trimStart().startsWith('"use server";') || ACTIONS.includes('\n"use server";')).toBe(true);
  });
  it("every action resolves the invite from the token hash and bounces unknown links", () => {
    for (const n of ["sendVendorCodeAction", "verifyVendorCodeAction"]) {
      const b = fn(ACTIONS, n);
      expect(b, n).toContain("const token = tokenFrom(fd);");
      expect(b, n).toContain("await getVendorInviteByToken(token)");
      expect(b, n).toContain('if (!inv) redirect("/vendor-ach/invalid");');
    }
    const s = fn(ACTIONS, "signVendorAction");
    expect(s).toContain("if (!isTokenShape(token)) return");
    expect(s).toContain("await getVendorInviteByToken(token)");
  });
  it("the consent cookie is httpOnly, from browserCookieOptions, secure off only on localhost", () => {
    const b = fn(ACTIONS, "verifyVendorCodeAction");
    expect(b).toContain("browserCookieOptions(!/^http:\\/\\/localhost(:\\d+)?$/.test(base))");
    expect(b).toContain("httpOnly: opts.httpOnly");
    expect(b.indexOf("if (!res.ok)")).toBeLessThan(b.indexOf("(await cookies()).set("));
  });
  it("signing reads the cookie (shape-checked) and passes it to the store", () => {
    expect(ACTIONS).toMatch(/return isCookieShape\(v\) \? v : null;/);
    expect(fn(ACTIONS, "signVendorAction")).toContain("cookie: await readCookie(),");
  });
  it("owners are notified (owner Q9) and the signing is audited with no staff actor", () => {
    const s = fn(ACTIONS, "signVendorAction");
    expect(s).toContain("ownersTo: [book.stephen.email, book.michael.email, book.store.email]");
    expect(s).toMatch(/action: "vendor_esign\.signed"/);
    expect(ACTIONS).not.toMatch(/actorId: (?!null)/);
  });
  it("the cookie name comes from the core constant (one source)", () => {
    expect(PATHS).toMatch(/VENDOR_COOKIE = BROWSER_COOKIE/);
  });
});

describe("copy route: the forwarded link alone never gets the PDF", () => {
  it("404s without a cookie before touching the store", () => {
    expect(ROUTE.indexOf("if (!cookie) return new Response(\"Not found.\", NOT_FOUND);")).toBeGreaterThan(-1);
    expect(ROUTE.indexOf("if (!cookie)")).toBeLessThan(ROUTE.indexOf("vendorSignedCopy("));
    expect(ROUTE).toContain("if (!copy.ok) return new Response(\"Not found.\", NOT_FOUND);");
  });
  it("sends no-store, nosniff, no-referrer and noindex on both answers", () => {
    for (const h of ['"Cache-Control"', '"X-Content-Type-Options": "nosniff"', '"Referrer-Policy": "no-referrer"', '"X-Robots-Tag": "noindex, nofollow"']) {
      expect(ROUTE.split(h).length - 1, h).toBeGreaterThanOrEqual(2);
    }
    expect(ROUTE).toContain('"Cache-Control": "no-store, private"');
    expect(ROUTE).toContain("export const dynamic = \"force-dynamic\"");
  });
  it("only GET is exported", () => {
    expect([...ROUTE.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(["GET"]);
  });
});

describe("public page privacy", () => {
  it("is dynamic, noindex, and sends no referrer (the token is in the URL)", () => {
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
    expect(PAGE).toMatch(/robots: \{ index: false, follow: false, nocache: true/);
    expect(PAGE).toContain('referrer: "no-referrer"');
  });
  it("the download link shows only for the browser that signed", () => {
    expect(PAGE).toContain("browserMatches(");
  });
  it("analytics are suppressed on the link pages (GA4 page_location would carry the token)", () => {
    expect(isNoTrackPath("/vendor-ach/abc")).toBe(true);
    expect(isNoTrackPath("/vendors")).toBe(false);
    expect(LAYOUT).toMatch(/<NoTrackGate>\s*<Analytics \/>\s*<SpeedInsights \/>\s*<\/NoTrackGate>/);
    expect(LAYOUT.match(/<Analytics \/>/g)).toHaveLength(1);
    expect(LAYOUT.match(/<SpeedInsights \/>/g)).toHaveLength(1);
    expect(GATE).toContain("isNoTrackPath(");
    expect(GATE).toContain('"use client"');
  });
  it("robots disallow the link pages and the age gate lets vendors through", () => {
    expect(ROBOTS).toContain('"/vendor-ach"');
    expect(isAgeGateExemptPath("/vendor-ach/tok")).toBe(true);
  });
});

describe("the client form posts every field the parser reads", () => {
  it("each key parseVendorForm asks for has an input in the form", () => {
    const asked = new Set<string>();
    parseVendorForm((k) => {
      asked.add(k);
      return null;
    }, "2026-10-05");
    // entity_other is only read when entity_type is "other".
    parseVendorForm((k) => {
      asked.add(k);
      return k === "entity_type" ? "other" : null;
    }, "2026-10-05");
    expect(asked.size).toBeGreaterThan(25);
    for (const k of asked) {
      const present = FORM.includes(`T("${k}"`) || FORM.includes(`S("${k}"`) || FORM.includes(`name="${k}"`);
      expect(present, `form field ${k}`).toBe(true);
    }
    for (const k of ["token", "proof", "intent", "signer_name", "signer_title"]) {
      expect(FORM.includes(`name="${k}"`) || FORM.includes(`T("${k}"`), k).toBe(true);
    }
  });
  it("the confirm-account box blocks paste; the file input takes photos and PDFs", () => {
    expect(FORM).toMatch(/T\("account2"[^\n]*onPaste: \(e\) => e\.preventDefault\(\)/);
    expect(FORM).toContain('accept="image/*,application/pdf"');
  });
  it("select options come from the core enums (no drift)", () => {
    expect(PAGE).toContain("ENTITY_TYPES.map(");
    expect(PAGE).toContain("VENDOR_KINDS.map(");
    expect(PAGE).toContain("PROOF_KINDS.map(");
  });
  it("photos are shrunk under the Vercel body limit before upload", () => {
    expect(FORM).toContain("planShrink(");
    expect(FORM).toContain("PROOF_UPLOAD_TARGET_BYTES");
  });
});

describe("admin surfaces", () => {
  it("the card only loads for settings.manage (vault access)", () => {
    expect(VPAGE).toContain("const esignCard = canSeeVault ? await vendorEsignCard(id) : null;");
    expect(VPAGE).toMatch(/const canSeeVault = can\(session\.profile\.role, "settings\.manage"\);/);
  });
  it("the card's forms post the field names the actions read", () => {
    for (const f of ['name="vendor_id"', 'name="invite_id"', 'name="callback_done"', 'name="title"', 'name="reason"', 'name="recipient_name"', 'name="email"']) expect(CARD, f).toContain(f);
    for (const a of ["countersignVendorEsignAction", "rejectVendorEsignAction", "sendVendorEsignLinkAction", "cancelVendorEsignAction"]) expect(CARD, a).toContain(`action={${a}}`);
  });
  it("banking page (settings.manage) loads participation on the vendors tab only", () => {
    expect(BANK).toContain('const session = await requirePermission("settings.manage");');
    expect(BANK).toContain('const participation = tab === "vendors" ? await participationRows() : null;');
    expect(PANEL).toContain("action={bulkInviteVendorsAction}");
    expect(PANEL).toContain('name="confirm"');
  });
});
