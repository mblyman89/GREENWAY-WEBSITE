/**
 * /api/pos/loyalty-signup  (register-loyalty-signup)
 *
 * The owner, verbatim: "I need a way to sign up new loyalty customers from the
 * iPad register. ... Make sure to include anything and everything to make the
 * process simple and powerful."
 *
 * GET  -> what the signup form shows: the PUBLISHED message-consent wording
 *         (content_blocks loyalty.form.consent_text, same as the website form),
 *         its SHA-256, and the live program terms (earn rate, signup bonus).
 * POST -> sign the customer up from the sale in progress:
 *           1. replay check (loyalty_signups.legacy_id = "register:<clientRequestId>")
 *           2. consent: the wording hash the customer saw must equal the
 *              published wording (47 CFR 64.1200(f)(9) prior express written consent)
 *           3. duplicate check on customers (phone / email / name + birthday)
 *              -> the budtender picks the existing account or "create new anyway"
 *           4. loyalty_signups row (source greenway-register, status entered)
 *           5. customers row created or linked (shared signup -> customer mapping)
 *           6. loyalty account opened (signup bonus, idempotent)
 *           7. audit row register.loyalty_signup (ids only, no PII)
 *         and returns the member so the register attaches it to the sale.
 *
 * Device-authenticated (same headers as /api/pos/member) and online-only.
 * Every database {error} is read and classified; nothing fails silently.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { escapeIlikeOrTerm } from "@/lib/supabase/postgrest-escape";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { pacificToday } from "@/lib/reports/timezone";
import { enrollCustomer, getConfig, listTiers, getAccountByCustomer } from "@/lib/loyalty/loyalty-store";
import { tierForPoints } from "@/lib/loyalty/engine";
import { loyaltyTermsSummary } from "@/lib/loyalty/program-terms-core";
import { LOYALTY_CONSENT_BLOCK, isMissingConsentColumnError, publishedConsentFromRow } from "@/lib/loyalty/loyalty-consent-core";
import { consentTextSha256 } from "@/lib/loyalty/signup";
import { memberLabel } from "@/lib/customers/customer-search-core";
import type { PosMemberHit } from "@/app/api/pos/member/route";
import {
  DUPLICATE_BASIS_LABEL,
  DUPLICATE_CANDIDATE_COLUMNS,
  REGISTER_SIGNUP_AUDIT_ACTION,
  buildRegisterLinkPatch,
  buildRegisterSignupCustomer,
  buildRegisterSignupRow,
  classifySignupDbError,
  consentVerdict,
  duplicateBases,
  isUniqueViolation,
  legacyIdFor,
  parseRegisterSignupRequest,
  planRegisterSignup,
  signupAuditAfter,
  welcomeMessage,
  type DuplicateBasis,
  type DuplicateCandidate,
  type RegisterSignupRequest,
  type SignupOutcome,
} from "@/lib/pos/register-loyalty-signup-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbErr = { code?: string | null; message?: string | null } | null;

function fail(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * The published consent wording, read strictly: a failed read is an error
 * (never a silent fallback), because the hash the customer signed must match
 * exactly what the website and the register both show.
 */
async function readPublishedConsent(admin: Admin): Promise<{ ok: true; text: string; sha256: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("content_blocks")
    .select("published_value, status")
    .eq("block_key", LOYALTY_CONSENT_BLOCK)
    .maybeSingle<{ published_value: string | null; status: string | null }>();
  if (error) return { ok: false, error: classifySignupDbError(error, "read the message consent wording") };
  const text = publishedConsentFromRow(data);
  return { ok: true, text, sha256: consentTextSha256(text) };
}

async function authed(req: NextRequest) {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  return authenticateDevice(deviceId, deviceKey);
}

// ---------------------------------------------------------------------------
// GET: form content
// ---------------------------------------------------------------------------

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authed(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!isSupabaseServiceConfigured) return fail("Database not configured.", 503);

  const admin = createSupabaseAdminClient();
  const consent = await readPublishedConsent(admin);
  if (!consent.ok) return fail(consent.error, 503);
  const cfg = await getConfig();
  const terms = loyaltyTermsSummary(cfg);
  return NextResponse.json({
    consentText: consent.text,
    consentTextSha256: consent.sha256,
    signupBonusPoints: cfg.signupBonusPoints,
    terms,
  });
}

// ---------------------------------------------------------------------------
// POST: sign up
// ---------------------------------------------------------------------------

/** Customers that could already be this person (explicit columns, bounded). */
async function readCandidates(admin: Admin, r: RegisterSignupRequest): Promise<{ ok: true; rows: DuplicateCandidate[] } | { ok: false; error: string }> {
  const found = new Map<string, DuplicateCandidate>();
  const ors: string[] = [];
  if (r.phoneNormalized) ors.push(`phone_normalized.eq.${r.phoneNormalized}`);
  if (r.email) {
    ors.push(`email_normalized.eq.${r.email}`);
    const like = escapeIlikeOrTerm(r.email);
    if (like) ors.push(`email.ilike.${like}`);
  }
  if (ors.length > 0) {
    const { data, error } = await admin.from("customers").select(DUPLICATE_CANDIDATE_COLUMNS).or(ors.join(",")).limit(25);
    if (error) return { ok: false, error: classifySignupDbError(error, "check for an existing account") };
    for (const c of (data as unknown as DuplicateCandidate[] | null) ?? []) found.set(c.id, c);
  }
  // Same birthday: names are compared in the core (normalized), so read by DOB.
  const { data: byDob, error: dobErr } = await admin
    .from("customers")
    .select(DUPLICATE_CANDIDATE_COLUMNS)
    .eq("birthdate", r.dateOfBirth)
    .limit(200);
  if (dobErr) return { ok: false, error: classifySignupDbError(dobErr, "check for an existing account") };
  for (const c of (byDob as unknown as DuplicateCandidate[] | null) ?? []) found.set(c.id, c);
  return { ok: true, rows: [...found.values()] };
}

async function memberFor(customerId: string, first: string, last: string | null): Promise<PosMemberHit> {
  const [account, tiers] = await Promise.all([getAccountByCustomer(customerId), listTiers()]);
  return {
    customerId,
    label: memberLabel(first, last),
    points: account?.balance_points ?? 0,
    tierName: tierForPoints(account?.lifetime_points ?? 0, tiers)?.name ?? null,
    fullName: `${first} ${last ?? ""}`.trim(),
  };
}

async function tryEnroll(customerId: string): Promise<boolean> {
  try {
    // actorId is a staff_profiles id; a register device is not one, so null.
    return (await enrollCustomer(customerId, null)).ok;
  } catch {
    return false;
  }
}

/** Insert the signup row; a missing 0264 consent column retries without it. */
async function insertSignup(
  admin: Admin,
  row: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { ok: false; unique: boolean; error: DbErr }> {
  let { data, error } = await admin.from("loyalty_signups").insert(row).select("id").single<{ id: string }>();
  if (error && isMissingConsentColumnError(error)) {
    const rest = { ...row };
    delete rest.consent_text;
    delete rest.consent_text_sha256;
    ({ data, error } = await admin.from("loyalty_signups").insert(rest).select("id").single<{ id: string }>());
  }
  if (error || !data) return { ok: false, unique: isUniqueViolation(error), error };
  return { ok: true, id: data.id };
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await authed(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!isSupabaseServiceConfigured) return fail("Database not configured.", 503);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return fail("Body must be JSON.", 400);
  }
  const parsed = parseRegisterSignupRequest(body, pacificToday());
  if (!parsed.ok) return fail(parsed.error, 400, { fields: parsed.fields });
  const r = parsed.request;
  const admin = createSupabaseAdminClient();
  const legacyId = legacyIdFor(r.clientRequestId);

  // 1) Replay: this exact form was already sent (a retry after a dropped reply).
  const readExisting = async () =>
    admin.from("loyalty_signups").select("id").eq("legacy_id", legacyId).maybeSingle<{ id: string }>();
  let { data: prior, error: priorErr } = await readExisting();
  if (priorErr) return fail(classifySignupDbError(priorErr, "check this signup"), 503);
  if (prior) {
    const { data: linked, error: linkErr } = await admin
      .from("customers")
      .select("id, first_name, last_name")
      .eq("loyalty_signup_id", prior.id)
      .limit(1)
      .maybeSingle<{ id: string; first_name: string; last_name: string | null }>();
    if (linkErr) return fail(classifySignupDbError(linkErr, "check this signup"), 503);
    if (linked) {
      await tryEnroll(linked.id);
      const member = await memberFor(linked.id, linked.first_name, linked.last_name);
      return NextResponse.json({
        status: "ok",
        outcome: "replayed" satisfies SignupOutcome,
        member,
        message: welcomeMessage({ firstName: linked.first_name, outcome: "replayed", points: member.points, bonusPoints: 0, attachedToSale: true }),
      });
    }
    // The signup row exists but the customer step did not finish: carry on.
  }

  // 2) Consent: what the customer saw must be what is published now.
  let consentText: string | null = null;
  let consentSha: string | null = null;
  if (r.marketingConsent) {
    const consent = await readPublishedConsent(admin);
    if (!consent.ok) return fail(consent.error, 503);
    const verdict = consentVerdict(r, consent.sha256);
    if (!verdict.ok) {
      return fail(verdict.error, 409, {
        code: "consent_changed",
        consentText: consent.text,
        consentTextSha256: consent.sha256,
      });
    }
    consentText = consent.text;
    consentSha = consent.sha256;
  }

  // 3) Duplicate check.
  const cand = await readCandidates(admin, r);
  if (!cand.ok) return fail(cand.error, 503);
  const plan = planRegisterSignup(r, cand.rows);
  if (plan.kind === "refuse") return fail(plan.error, 409, { code: "stale_choice" });
  if (plan.kind === "duplicates") {
    return NextResponse.json({
      status: "duplicates",
      matches: plan.matches.map((m) => ({ ...m, reasons: m.bases.map((b) => DUPLICATE_BASIS_LABEL[b]) })),
      message:
        plan.matches.length === 1
          ? "This customer may already have an account. Use it, or create a new one anyway."
          : `${plan.matches.length} accounts may belong to this customer. Pick one, or create a new one anyway.`,
    });
  }
  const existing = plan.kind === "attach_existing" ? plan.customer : null;
  const bases: DuplicateBasis[] = existing ? duplicateBases(r, existing) : [];

  // 4) The signup row (skipped when the replay found one).
  let signupId = prior?.id ?? null;
  if (!signupId) {
    const row = buildRegisterSignupRow(r, {
      nowIso: new Date().toISOString(),
      registerName: auth.device.name ?? "",
      consentText,
      consentSha256: consentSha,
      dedupeOf: existing?.loyalty_signup_id ?? null,
    });
    const ins = await insertSignup(admin, row);
    if (!ins.ok) {
      if (!ins.unique) return fail(classifySignupDbError(ins.error, "save the signup"), 503);
      // 23505 on legacy_id: a concurrent retry already saved it -> use that row.
      ({ data: prior, error: priorErr } = await readExisting());
      if (priorErr || !prior) return fail(classifySignupDbError(priorErr, "save the signup"), 503);
      signupId = prior.id;
    } else {
      signupId = ins.id;
    }
  }

  // 5) The customer: link the chosen account or create a new one.
  let customerId: string;
  let firstName: string;
  let lastName: string | null;
  let outcome: SignupOutcome;
  if (existing) {
    const patch = buildRegisterLinkPatch(signupId, r, existing);
    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("customers").update(patch).eq("id", existing.id);
      if (error) return fail(classifySignupDbError(error, "update the existing account"), 503);
    }
    customerId = existing.id;
    firstName = existing.first_name;
    lastName = existing.last_name;
    outcome = "linked";
  } else {
    const fields = buildRegisterSignupCustomer(signupId, r);
    const { data: created, error } = await admin
      .from("customers")
      .insert({ ...fields, created_by: null, updated_by: null })
      .select("id, first_name, last_name")
      .single<{ id: string; first_name: string; last_name: string | null }>();
    if (error || !created) return fail(classifySignupDbError(error, "create the customer account"), 503);
    customerId = created.id;
    firstName = created.first_name;
    lastName = created.last_name;
    outcome = "created";
  }

  // 6) Loyalty account (idempotent; signup bonus once).
  const enrolled = await tryEnroll(customerId);
  const cfg = await getConfig();
  const member = await memberFor(customerId, firstName, lastName);

  // 7) Audit (ids only).
  await recordAudit({
    actorId: auth.device.id,
    actorEmail: r.employeeName || `device:${auth.device.id}`,
    action: REGISTER_SIGNUP_AUDIT_ACTION,
    entityType: "customer",
    entityId: customerId,
    before: null,
    after: signupAuditAfter({
      req: r,
      outcome,
      signupId,
      customerId,
      enrolled,
      deviceId: auth.device.id,
      registerId: auth.device.register_id ?? null,
      duplicateBases: bases,
    }),
  });

  return NextResponse.json({
    status: "ok",
    outcome,
    enrolled,
    member,
    message: enrolled
      ? welcomeMessage({ firstName, outcome, points: member.points, bonusPoints: cfg.signupBonusPoints, attachedToSale: true })
      : `${firstName}'s account is saved, but the loyalty account did not open. It is attached to this sale; ask a manager to enroll it in Loyalty.`,
  });
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handlePost(req));
}
