import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { greenwayBusiness } from "@/content/business";

export type LoyaltySignupInput = {
  firstName: string;
  lastName: string;
  birthday: string;
  mobilePhone: string;
  email: string;
  consent: boolean;
  signature: string;
  company?: string;
};

export type LoyaltySignupRecord = Omit<LoyaltySignupInput, "company"> & {
  id: string;
  submittedAt: string;
  source: "greenway-website";
  notificationStatus: "email-not-configured" | "email-sent" | "email-failed";
};

export type LoyaltySignupResult =
  | { ok: true; record: LoyaltySignupRecord }
  | { ok: false; errors: Record<string, string> };

function normalizeText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidBirthday(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const birthday = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birthday.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthday.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthday.getUTCDate())) age -= 1;
  return age >= 21 && age <= 120;
}

export function parseLoyaltySignup(payload: unknown): LoyaltySignupResult {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const input: LoyaltySignupInput = {
    firstName: normalizeText(raw.firstName),
    lastName: normalizeText(raw.lastName),
    birthday: normalizeText(raw.birthday),
    mobilePhone: normalizePhone(normalizeText(raw.mobilePhone)),
    email: normalizeText(raw.email).toLowerCase(),
    consent: raw.consent === true || raw.consent === "true" || raw.consent === "on" || raw.consent === "1",
    signature: normalizeText(raw.signature),
    company: normalizeText(raw.company),
  };

  const errors: Record<string, string> = {};

  if (input.company) errors.company = "Signup could not be accepted.";
  if (input.firstName.length < 2) errors.firstName = "First name is required.";
  if (input.lastName.length < 2) errors.lastName = "Last name is required.";
  if (!isValidBirthday(input.birthday)) errors.birthday = "Enter a valid birthday confirming you are 21+.";
  if (input.mobilePhone.length < 10) errors.mobilePhone = "Mobile phone is required.";
  if (!isValidEmail(input.email)) errors.email = "Enter a valid email address.";
  if (!input.consent) errors.consent = "Consent is required.";
  if (input.signature.length < 2) errors.signature = "Type your name as your signature.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    record: {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      source: "greenway-website",
      notificationStatus: "email-not-configured",
      firstName: input.firstName,
      lastName: input.lastName,
      birthday: input.birthday,
      mobilePhone: input.mobilePhone,
      email: input.email,
      consent: input.consent,
      signature: input.signature,
    },
  };
}

function buildNotificationText(record: LoyaltySignupRecord) {
  return [
    "New Greenway Marijuana loyalty signup submitted.",
    "",
    `Signup ID: ${record.id}`,
    `Submitted: ${record.submittedAt}`,
    `Name: ${record.firstName} ${record.lastName}`,
    `Birthday: ${record.birthday}`,
    `Mobile Phone: ${record.mobilePhone}`,
    `Email: ${record.email}`,
    `Signature: ${record.signature}`,
    `Consent Accepted: ${record.consent ? "Yes" : "No"}`,
  ].join("\n");
}

async function sendSignupEmail(record: LoyaltySignupRecord): Promise<LoyaltySignupRecord["notificationStatus"]> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.LOYALTY_SIGNUP_FROM_EMAIL ?? "Greenway Website <onboarding@resend.dev>";
  const recipient = process.env.LOYALTY_SIGNUP_TO_EMAIL ?? greenwayBusiness.email;

  if (!resendApiKey) return "email-not-configured";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [recipient],
        reply_to: record.email,
        subject: `New Greenway loyalty signup: ${record.firstName} ${record.lastName}`,
        text: buildNotificationText(record),
      }),
    });

    return response.ok ? "email-sent" : "email-failed";
  } catch {
    return "email-failed";
  }
}

export async function storeLoyaltySignup(record: LoyaltySignupRecord) {
  const notificationStatus = await sendSignupEmail(record);
  const storedRecord: LoyaltySignupRecord = { ...record, notificationStatus };

  // Slice 8: persist to the database loyalty queue when Supabase is configured.
  // The JSONL append remains as a durable local fallback so a DB hiccup never
  // loses a signup and rollout is non-breaking.
  try {
    const { createLoyaltySignup } = await import("./signups-store");
    await createLoyaltySignup({
      legacyId: storedRecord.id,
      firstName: storedRecord.firstName,
      lastName: storedRecord.lastName,
      birthday: storedRecord.birthday,
      mobilePhone: storedRecord.mobilePhone,
      email: storedRecord.email,
      consent: storedRecord.consent,
      signature: storedRecord.signature,
      source: storedRecord.source,
      notificationStatus: storedRecord.notificationStatus,
      submittedAt: storedRecord.submittedAt,
    });
  } catch {
    // DB unavailable / not configured — the JSONL fallback below still captures it.
  }

  const storageDir = path.join(process.cwd(), "storage");
  const storagePath = path.join(storageDir, "loyalty-signups.jsonl");

  try {
    await mkdir(storageDir, { recursive: true });
    await appendFile(storagePath, `${JSON.stringify(storedRecord)}\n`, "utf8");
  } catch {
    // On read-only/serverless filesystems the DB row above is the source of truth.
  }

  return storedRecord;
}
