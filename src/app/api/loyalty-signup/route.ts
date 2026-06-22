import { NextResponse } from "next/server";
import { parseLoyaltySignup, storeLoyaltySignup } from "@/lib/loyalty/signup";

type SignupPayloadResult = {
  payload: unknown;
  isBrowserFormSubmission: boolean;
};

function formParamsToPayload(formData: URLSearchParams | FormData) {
  return {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    birthday: formData.get("birthday"),
    mobilePhone: formData.get("mobilePhone"),
    email: formData.get("email"),
    consent: formData.get("consent"),
    signature: formData.get("signature"),
    company: formData.get("company"),
  };
}

async function readSignupPayload(request: Request): Promise<SignupPayloadResult> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return { payload: await request.json(), isBrowserFormSubmission: false };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return {
      payload: formParamsToPayload(new URLSearchParams(await request.text())),
      isBrowserFormSubmission: true,
    };
  }

  return {
    payload: formParamsToPayload(await request.formData()),
    isBrowserFormSubmission: true,
  };
}

function redirectToLoyalty(request: Request, status: string, signupId?: string) {
  const url = new URL("/loyalty", request.url);
  url.searchParams.set("signup", status);
  if (signupId) url.searchParams.set("id", signupId);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  let payload: unknown;
  let isBrowserFormSubmission = false;

  try {
    const result = await readSignupPayload(request);
    payload = result.payload;
    isBrowserFormSubmission = result.isBrowserFormSubmission;
  } catch {
    if (isBrowserFormSubmission) return redirectToLoyalty(request, "invalid");
    return NextResponse.json({ ok: false, errors: { form: "Invalid signup payload." } }, { status: 400 });
  }

  const parsed = parseLoyaltySignup(payload);

  if (!parsed.ok) {
    if (isBrowserFormSubmission) return redirectToLoyalty(request, "validation-error");
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  try {
    const storedRecord = await storeLoyaltySignup(parsed.record);

    if (isBrowserFormSubmission) return redirectToLoyalty(request, "success", storedRecord.id);

    return NextResponse.json({
      ok: true,
      signupId: storedRecord.id,
      submittedAt: storedRecord.submittedAt,
      notificationStatus: storedRecord.notificationStatus,
      message: "Signup captured for Greenway staff review and manual POS entry.",
    });
  } catch {
    if (isBrowserFormSubmission) return redirectToLoyalty(request, "storage-error");
    return NextResponse.json(
      { ok: false, errors: { form: "Signup could not be stored. Please try again or contact Greenway staff." } },
      { status: 500 },
    );
  }
}
