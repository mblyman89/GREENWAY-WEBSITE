/**
 * src/lib/payments/vendor-esign-app-core.ts  (R39 S7, PURE)
 *
 * The app-level decisions around the vendor e-sign link, kept out of the I/O
 * store so they can be tested without a database:
 *   - prefill:    what the vendor sees already typed (Greenway's vendor record,
 *                 then the last form this vendor signed, never bank numbers),
 *                 so the form is mostly "check and press Sign".
 *   - bulk plan:  which vendors the "invite everyone" button emails, and why
 *                 each other vendor is skipped (opted out, no email, already
 *                 on ACH, link already out). Voluntary (WAC 314-55-115(3)(a)):
 *                 an opted-out vendor is never emailed by the bulk button.
 *   - cookie:     the browser-binding cookie's attributes.
 *   - emailOnFile: was the link sent to the address already on the vendor
 *                 record? (printed on the certificate; a typed address is a
 *                 weaker attribution, RCW 1.80.080).
 */
import { checkEmail } from "@/lib/payments/ach-esign-core";
import { normalizeUsPhone } from "@/lib/payments/ach-authorization-core";
import { BROWSER_COOKIE, CONSENT_FRESH_MS, ENTITY_TYPES, PROOF_KINDS, VENDOR_KINDS, type VendorEsignState, type VendorForm } from "@/lib/payments/vendor-esign-core";

/** Bulk invites per press: Resend allows 10 requests/second per team; a server action should finish well inside its time limit. */
export const VENDOR_BULK_MAX = 25;
/** Pause between bulk sends (ms): about 4 per second, under Resend's 10/s team limit with room for other mail. */
export const VENDOR_BULK_PAUSE_MS = 250;

export type VendorRowForPrefill = {
  display_name?: string | null;
  legal_name?: string | null;
  dba?: string | null;
  license_number?: string | null;
  email?: string | null;
  phone?: string | null;
  billing_address1?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  shipping_address1?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_zip?: string | null;
};

/** Field name -> starting value for the vendor form. Only keys parseVendorForm reads; never routing/account. */
export type VendorPrefill = Partial<Record<Exclude<keyof VendorForm, "review_flags">, string>>;

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * Starting values: the last form this vendor signed wins (it is what the
 * vendor themselves typed), then Greenway's vendor record fills the gaps.
 * request_type is "change" when Greenway already holds banking for them.
 * Nothing that came from a person is trusted here: parseVendorForm checks
 * every field again on submit.
 */
export function vendorPrefill(vendor: VendorRowForPrefill | null, prior: Partial<VendorForm> | null, hasBankingOnFile: boolean): VendorPrefill {
  const v = vendor ?? {};
  const p = prior ?? {};
  const out: VendorPrefill = {};
  const put = (k: keyof VendorPrefill, ...vals: unknown[]) => {
    for (const x of vals) {
      const t = s(x, 254);
      if (t) {
        out[k] = t;
        return;
      }
    }
  };
  put("legal_name", p.legal_name, v.legal_name, v.display_name);
  put("dba", p.dba, v.dba);
  if (p.entity_type && (ENTITY_TYPES as readonly string[]).includes(p.entity_type)) out.entity_type = p.entity_type;
  put("entity_other", p.entity_type === "other" ? p.entity_other : "");
  if (p.vendor_kind && (VENDOR_KINDS as readonly string[]).includes(p.vendor_kind)) out.vendor_kind = p.vendor_kind;
  const lic = s(p.license_no, 20) || s(v.license_number, 20).replace(/\s/g, "");
  if (/^\d{6}$/.test(lic)) out.license_no = lic;
  const ubi = s(p.ubi, 20).replace(/[\s.-]/g, "");
  if (/^\d{9}$/.test(ubi)) out.ubi = ubi;
  // tin_last4 is retyped every time: it is the callback's identity check.
  const useBilling = Boolean(s(v.billing_address1, 160));
  put("street", p.street, useBilling ? v.billing_address1 : v.shipping_address1);
  put("city", p.city, useBilling ? v.billing_city : v.shipping_city);
  const st = (s(p.state, 3) || s(useBilling ? v.billing_state : v.shipping_state, 3)).toUpperCase();
  if (/^[A-Z]{2}$/.test(st)) out.state = st;
  const zip = s(p.zip, 10) || s(useBilling ? v.billing_zip : v.shipping_zip, 10);
  if (/^\d{5}(-\d{4})?$/.test(zip)) out.zip = zip;
  put("ar_contact", p.ar_contact);
  const arPhone = normalizeUsPhone(s(p.ar_phone, 30)) ?? normalizeUsPhone(s(v.phone, 30));
  if (arPhone) out.ar_phone = arPhone;
  const arEmail = checkEmail(s(p.ar_email, 254) || s(v.email, 254));
  if (arEmail.ok) out.ar_email = arEmail.email;
  put("second_contact", p.second_contact);
  const p2 = normalizeUsPhone(s(p.second_phone, 30));
  if (p2) out.second_phone = p2;
  const e2 = checkEmail(s(p.second_email, 254));
  if (e2.ok) out.second_email = e2.email;
  out.request_type = hasBankingOnFile || prior ? "change" : "new";
  // Bank name / name on account are re-typed when the bank changes; offer the last ones.
  put("bank_name", p.bank_name);
  put("bank_city_state", p.bank_city_state);
  put("name_on_account", p.name_on_account, p.legal_name, v.legal_name, v.display_name);
  const rem = checkEmail(s(p.remittance_email, 254));
  if (rem.ok) out.remittance_email = rem.email;
  out.proof_kind = p.proof_kind && (PROOF_KINDS as readonly string[]).includes(p.proof_kind) ? p.proof_kind : "voided_check";
  return out;
}

/** Was the link sent to the email already on Greenway's vendor record? */
export function emailOnFile(typed: string, vendorEmail: string | null | undefined): boolean {
  const a = checkEmail(typed);
  const b = checkEmail(String(vendorEmail ?? ""));
  return a.ok && b.ok && a.email === b.email;
}

export type BulkCandidate = {
  vendorId: string;
  name: string;
  email: string | null;
  active: boolean;
  optedOut: boolean;
  achReady: boolean;
  openInvite: VendorEsignState | null;
  openInviteExpired: boolean;
};

export type BulkSkip = "opted_out" | "no_email" | "already_ach" | "link_out" | "inactive";

export const BULK_SKIP_LABELS: Readonly<Record<BulkSkip, string>> = {
  opted_out: "opted out (chose checks)",
  no_email: "no email on the vendor record",
  already_ach: "already paid by ACH",
  link_out: "a link is already out or a signed form is waiting",
  inactive: "vendor marked inactive",
};

/**
 * Who the bulk button emails. An expired open link does not block: the
 * store cancels it (with a reason) before sending the new one. A signed form
 * waiting for Greenway always blocks (that is Greenway's move, not theirs).
 */
export function planBulkInvites(rows: readonly BulkCandidate[], max: number = VENDOR_BULK_MAX): {
  send: { vendorId: string; name: string; email: string; cancelExpired: boolean }[];
  skipped: Record<BulkSkip, number>;
  overflow: number;
} {
  const skipped: Record<BulkSkip, number> = { opted_out: 0, no_email: 0, already_ach: 0, link_out: 0, inactive: 0 };
  const eligible: { vendorId: string; name: string; email: string; cancelExpired: boolean }[] = [];
  for (const r of rows) {
    if (!r.active) { skipped.inactive++; continue; }
    if (r.optedOut) { skipped.opted_out++; continue; }
    if (r.achReady) { skipped.already_ach++; continue; }
    if (r.openInvite === "signed" || (r.openInvite && !r.openInviteExpired)) { skipped.link_out++; continue; }
    const e = checkEmail(String(r.email ?? ""));
    if (!e.ok) { skipped.no_email++; continue; }
    eligible.push({ vendorId: r.vendorId, name: r.name, email: e.email, cancelExpired: Boolean(r.openInvite) });
  }
  eligible.sort((a, b) => a.name.localeCompare(b.name));
  return { send: eligible.slice(0, Math.max(0, max)), skipped, overflow: Math.max(0, eligible.length - Math.max(0, max)) };
}

/**
 * The browser-binding cookie. httpOnly (no script can read it), Secure
 * outside localhost, SameSite=Lax (sent on the top-level GET from the email
 * link, not on cross-site POSTs), scoped to /vendor-ach, and it lives only as
 * long as a consent does (24 h).
 */
export function browserCookieOptions(secure: boolean): { name: string; httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number } {
  return { name: BROWSER_COOKIE, httpOnly: true, secure, sameSite: "lax", path: "/vendor-ach", maxAge: Math.floor(CONSENT_FRESH_MS / 1000) };
}

/** base64url of 32 random bytes; same shape as the link token. */
export function isCookieShape(v: string | null | undefined): boolean {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** Only https (or localhost for development) site bases may go in an emailed link. */
export function inviteLink(siteBase: string, token: string): string | null {
  const base = String(siteBase ?? "").trim().replace(/\/+$/, "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base) || /^http:\/\/localhost(:\d+)?$/.test(base)) return `${base}/vendor-ach/${token}`;
  return null;
}

/**
 * Can Greenway countersign this signed invite yet? Mirrors 0262
 * vendor_esign_countersign exactly (the database is the gate; this only
 * explains the next step in plain words before anyone presses a button):
 * the vault row must be active, released AFTER the vendor signed (so the
 * callback and dual control happened on these numbers), and still hold the
 * very ciphertext the vendor signed.
 */
export type CountersignVault = { status: string; released_at: string | null; bank_routing: string | null; bank_account_number: string | null; bank_account_type: string | null } | null;
export type CountersignInvite = { state: VendorEsignState; signed_at: string | null; bank_routing_enc: string | null; bank_account_enc: string | null; bank_account_type: string | null };
export type CountersignReadiness =
  | { ready: true }
  | { ready: false; step: "not_signed" | "no_vault" | "vault_changed" | "release_needed"; message: string };

export function countersignReadiness(inv: CountersignInvite, vault: CountersignVault): CountersignReadiness {
  if (inv.state !== "signed" || !inv.signed_at) return { ready: false, step: "not_signed", message: "Only a signed form waiting for Greenway can be countersigned." };
  if (!vault) return { ready: false, step: "no_vault", message: "The bank details are not in the vault. Reload; if it persists, reject and send a new link." };
  if (vault.bank_routing !== inv.bank_routing_enc || vault.bank_account_number !== inv.bank_account_enc || vault.bank_account_type !== inv.bank_account_type) {
    return { ready: false, step: "vault_changed", message: "The vault no longer holds the numbers this vendor signed (someone edited it). Reject this form and send a new link." };
  }
  const signedMs = Date.parse(inv.signed_at);
  const relMs = vault.released_at ? Date.parse(vault.released_at) : NaN;
  if (vault.status !== "active" || !Number.isFinite(relMs) || !(relMs > signedMs)) {
    return { ready: false, step: "release_needed", message: "Next: phone the second contact at a number already on file, then release the hold in Admin > Banking (dual control). Then countersign here." };
  }
  return { ready: true };
}

export function __runVendorEsignAppCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`[vendor-esign-app-core] FAIL: ${label}`);
    }
  };
  const v: VendorRowForPrefill = { display_name: "Acme Farms", legal_name: "Acme Farms LLC", license_number: "412345", email: "AR@Acme.com", phone: "(360) 555-0100", billing_address1: "1 Main St", billing_city: "Olympia", billing_state: "wa", billing_zip: "98501" };
  const a = vendorPrefill(v, null, false);
  ok(a.legal_name === "Acme Farms LLC" && a.license_no === "412345" && a.ar_email === "ar@acme.com" && a.ar_phone === "360-555-0100", "vendor record prefill");
  ok(a.state === "WA" && a.zip === "98501" && a.street === "1 Main St" && a.request_type === "new" && a.proof_kind === "voided_check", "address, new, proof default");
  ok(!("tin_last4" in a) && !("routing" in (a as Record<string, unknown>)) && !("account" in (a as Record<string, unknown>)), "never tin/bank numbers");
  ok(vendorPrefill(v, null, true).request_type === "change", "banking on file -> change");
  const b = vendorPrefill(v, { legal_name: "Acme Farms Inc", ubi: "604-123-456", entity_type: "corporation", vendor_kind: "producer" } as Partial<VendorForm>, false);
  ok(b.legal_name === "Acme Farms Inc" && b.ubi === "604123456" && b.entity_type === "corporation" && b.request_type === "change", "prior form wins");
  ok(vendorPrefill({ license_number: "12" }, null, false).license_no === undefined, "bad license not prefilled");
  ok(vendorPrefill({ shipping_address1: "9 Ship Rd", shipping_city: "Tacoma", shipping_state: "WA", shipping_zip: "98402" }, null, false).city === "Tacoma", "shipping fallback");
  ok(emailOnFile("ar@acme.com", "AR@Acme.com ") && !emailOnFile("x@acme.com", "ar@acme.com") && !emailOnFile("bad", null), "email on file");
  const base = { name: "", email: "a@b.co", active: true, optedOut: false, achReady: false, openInvite: null, openInviteExpired: false } as const;
  const plan = planBulkInvites([
    { ...base, vendorId: "1", name: "Zed" },
    { ...base, vendorId: "2", name: "Opt", optedOut: true },
    { ...base, vendorId: "3", name: "NoMail", email: null },
    { ...base, vendorId: "4", name: "Ach", achReady: true },
    { ...base, vendorId: "5", name: "Out", openInvite: "sent" },
    { ...base, vendorId: "6", name: "Old", openInvite: "code_sent", openInviteExpired: true },
    { ...base, vendorId: "7", name: "Signed", openInvite: "signed", openInviteExpired: true },
    { ...base, vendorId: "8", name: "Gone", active: false },
  ]);
  ok(plan.send.map((x) => x.vendorId).join() === "6,1", "bulk: eligible sorted by name");
  ok(plan.send[0].cancelExpired && !plan.send[1].cancelExpired, "bulk: expired link cancelled first");
  ok(plan.skipped.opted_out === 1 && plan.skipped.no_email === 1 && plan.skipped.already_ach === 1 && plan.skipped.link_out === 2 && plan.skipped.inactive === 1, "bulk: skips counted");
  const many = planBulkInvites(Array.from({ length: 30 }, (_, i) => ({ ...base, vendorId: String(i), name: `V${String(i).padStart(2, "0")}` })));
  ok(many.send.length === VENDOR_BULK_MAX && many.overflow === 5, "bulk: capped with overflow");
  const c = browserCookieOptions(true);
  ok(c.httpOnly && c.secure && c.sameSite === "lax" && c.path === "/vendor-ach" && c.maxAge === 86400 && c.name === BROWSER_COOKIE, "cookie attrs");
  ok(isCookieShape("A".repeat(43)) && !isCookieShape("A".repeat(42)) && !isCookieShape(null), "cookie shape");
  const t = "a".repeat(43);
  ok(inviteLink("https://www.greenwaymarijuana.com/", t) === `https://www.greenwaymarijuana.com/vendor-ach/${t}`, "link https");
  ok(inviteLink("http://localhost:3000", t) !== null && inviteLink("http://evil.com", t) === null && inviteLink("", t) === null, "link http only localhost");
  ok(inviteLink("https://x.com", "short") === null && inviteLink("https://x.com/path", t) === null, "link token/base shape");
  // countersignReadiness (mirrors 0262)
  const si: CountersignInvite = { state: "signed", signed_at: "2026-07-01T17:00:00.000Z", bank_routing_enc: "encv1:r", bank_account_enc: "encv1:a", bank_account_type: "checking" };
  const vOk: CountersignVault = { status: "active", released_at: "2026-07-02T17:00:00.000Z", bank_routing: "encv1:r", bank_account_number: "encv1:a", bank_account_type: "checking" };
  ok(countersignReadiness(si, vOk).ready, "cs: released after signing, same ciphertext -> ready");
  const st = (x: CountersignReadiness) => (x.ready ? "ready" : x.step);
  ok(st(countersignReadiness({ ...si, state: "consented" }, vOk)) === "not_signed" && st(countersignReadiness({ ...si, signed_at: null }, vOk)) === "not_signed", "cs: not signed");
  ok(st(countersignReadiness(si, null)) === "no_vault", "cs: no vault");
  ok(st(countersignReadiness(si, { ...vOk, bank_account_number: "encv1:other" })) === "vault_changed" && st(countersignReadiness(si, { ...vOk, bank_account_type: "savings" })) === "vault_changed" && st(countersignReadiness(si, { ...vOk, bank_routing: "encv1:x" })) === "vault_changed", "cs: vault edited");
  ok(st(countersignReadiness(si, { ...vOk, status: "on_hold" })) === "release_needed", "cs: on hold");
  ok(st(countersignReadiness(si, { ...vOk, released_at: null })) === "release_needed", "cs: never released");
  ok(st(countersignReadiness(si, { ...vOk, released_at: si.signed_at })) === "release_needed", "cs: released AT signing is not after (boundary)");
  ok(countersignReadiness(si, { ...vOk, released_at: "2026-07-01T17:00:00.001Z" }).ready, "cs: 1 ms after -> ready (boundary)");
  ok(st(countersignReadiness(si, { ...vOk, released_at: "2026-06-30T00:00:00.000Z" })) === "release_needed", "cs: an OLD release (before signing) does not count");
  return { passed, failed };
}
