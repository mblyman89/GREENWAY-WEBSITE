"use server";

/**
 * R39 S7 — the vendor's own e-sign page (public, link-only).
 *
 * There is no login: the 43-character link token IS the credential, and it is
 * looked up by its keyed hash only. Three things then have to line up before
 * bank numbers are accepted:
 *   1. a 6-digit code emailed to the address Greenway sent the link to
 *      (E-SIGN 7001(c)(1)(C)(ii): shows the vendor can open electronic mail);
 *   2. the disclosure the screen showed (its SHA-256 travels with the form)
 *      and an "I agree" tick;
 *   3. this browser: a fresh httpOnly cookie bound at consent, so a forwarded
 *      or scanned link cannot continue someone else's signing.
 *
 * Nothing here trusts a hidden field for identity: the invite comes from the
 * token, the vendor from the invite. Every refusal is the store's plain
 * message. Audit rows carry the invite id, the state and last-4 only.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/auth/audit";
import { resolveSiteBase } from "@/lib/auth/set-password-core";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { clientIp } from "@/lib/payments/ach-esign-core";
import { isTokenShape } from "@/lib/payments/vendor-esign-core";
import { browserCookieOptions, isCookieShape } from "@/lib/payments/vendor-esign-app-core";
import { resendVendorMailer } from "@/lib/payments/vendor-esign-mail";
import {
  getVendorInviteByToken,
  sendSignedNotices,
  sendVendorCode,
  signVendorInvite,
  verifyVendorCode,
  type VendorSignResult,
} from "@/lib/payments/vendor-esign-store";
import { VENDOR_COOKIE, vendorPath } from "./paths";

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

function tokenFrom(fd: FormData): string {
  const t = str(fd, "token");
  if (!isTokenShape(t)) redirect("/vendor-ach/invalid");
  return t;
}

function back(token: string, param: "ok" | "error", message: string): never {
  redirect(`${vendorPath(token)}?${param}=${encodeURIComponent(message.slice(0, 400))}`);
}

async function readCookie(): Promise<string | null> {
  const v = (await cookies()).get(VENDOR_COOKIE)?.value ?? null;
  return isCookieShape(v) ? v : null;
}

async function siteBase(): Promise<string> {
  const h = await headers();
  return resolveSiteBase({
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedProto: h.get("x-forwarded-proto"),
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
  });
}

/** Step 1: "Email me a code" (also "send a new code"). POST only, so link scanners never trigger it. */
export async function sendVendorCodeAction(fd: FormData): Promise<void> {
  const token = tokenFrom(fd);
  const inv = await getVendorInviteByToken(token);
  if (!inv) redirect("/vendor-ach/invalid");
  const res = await sendVendorCode({ invite: inv, nowMs: Date.now(), mail: resendVendorMailer() });
  if (!res.ok) back(token, "error", res.error);
  await recordAudit({ actorId: null, actorEmail: null, action: "vendor_esign.code_sent", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: inv.state }, after: { state: "code_sent", to: res.masked, sends: inv.otp_sends + 1 } });
  back(token, "ok", `We emailed a 6-digit code to ${res.masked}. It can take a minute to arrive; check spam too.`);
}

/** Step 2: the code + "I agree". Success binds this browser with an httpOnly cookie. */
export async function verifyVendorCodeAction(fd: FormData): Promise<void> {
  const token = tokenFrom(fd);
  const inv = await getVendorInviteByToken(token);
  if (!inv) redirect("/vendor-ach/invalid");
  const res = await verifyVendorCode({
    invite: inv,
    typedCode: str(fd, "code").replace(/\D/g, ""),
    agreed: str(fd, "agree") === "on",
    disclosureSha256Shown: str(fd, "disclosure_sha256"),
    nowMs: Date.now(),
  });
  if (!res.ok) {
    await recordAudit({ actorId: null, actorEmail: null, action: "vendor_esign.code_refused", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: inv.state, attempts: inv.otp_attempts }, after: null });
    back(token, "error", res.error);
  }
  const base = await siteBase();
  const opts = browserCookieOptions(!/^http:\/\/localhost(:\d+)?$/.test(base));
  (await cookies()).set(opts.name, res.cookie, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: opts.maxAge });
  await recordAudit({ actorId: null, actorEmail: null, action: "vendor_esign.consented", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: inv.state }, after: { state: "consented", disclosure: "GW-VESIGN-1" } });
  back(token, "ok", "Email confirmed. Fill in the form below and sign. It takes about 5 minutes.");
}

export type VendorSignActionResult = Extract<VendorSignResult, { ok: false }> | { ok: true; accountLast4: string; vendorMailed: boolean };

/**
 * Step 3: the form, the bank proof, the typed signature. Returns a result
 * (no redirect) so the browser keeps every typed value when a box needs
 * fixing; the page refreshes itself on success.
 */
export async function signVendorAction(fd: FormData): Promise<VendorSignActionResult> {
  const token = str(fd, "token");
  if (!isTokenShape(token)) return { ok: false, error: "This link is not valid. Use the link in Greenway's email." };
  const inv = await getVendorInviteByToken(token);
  if (!inv) return { ok: false, error: "This link is not valid. Use the link in Greenway's email." };
  const file = fd.get("proof");
  let proofFile: { bytes: Uint8Array; mime: string | null; filename: string | null } | null = null;
  if (file && typeof file !== "string" && file.size > 0) {
    proofFile = { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || null, filename: file.name || null };
  }
  const h = await headers();
  const nowMs = Date.now();
  const res = await signVendorInvite({
    invite: inv,
    cookie: await readCookie(),
    get: (k) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : null;
    },
    proofFile,
    signerName: str(fd, "signer_name"),
    signerTitle: str(fd, "signer_title"),
    intentChecked: str(fd, "intent") === "on",
    ip: clientIp((k) => h.get(k)),
    userAgent: h.get("user-agent"),
    nowMs,
  });
  if (!res.ok) return res;

  // Owner Q9: Stephen, Michael and the store get the to-do; the vendor gets a
  // receipt at the invited address AND the address on file.
  const book = resolveNotifyContacts(process.env).contacts;
  const base = await siteBase();
  const notices = await sendSignedNotices({
    inviteId: inv.id,
    result: res,
    ownersTo: [book.stephen.email, book.michael.email, book.store.email],
    vendorPageUrl: base ? `${base}/admin/vendors/${inv.vendor_id}` : "/admin/vendors",
    nowMs,
    mail: resendVendorMailer(),
  });
  await recordAudit({
    actorId: null,
    actorEmail: null,
    action: "vendor_esign.signed",
    entityType: "vendor_esign_invite",
    entityId: inv.id,
    before: { state: inv.state },
    after: { state: "signed", authorization_id: res.authorizationId, account_last4: res.accountLast4, request_type: res.requestType, review_flags: res.reviewFlags.length, vendor_mailed: notices.vendorMailed, owners_mailed: notices.ownersMailed },
  });
  return { ok: true, accountLast4: res.accountLast4, vendorMailed: notices.vendorMailed };
}
