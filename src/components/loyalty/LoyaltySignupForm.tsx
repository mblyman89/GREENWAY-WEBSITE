"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { greenwayBusiness } from "@/content/business";

const consentText =
  "By signing up, I consent to enroll in the member list, understanding that I will receive marketing communications, including, but not limited to, advertisements, through text messages, calls either through an automatic telephone dialing system or artificial or prerecorded voice call, emails, or other outreach channels. By doing so, I understand that I am allowing Uncle Ike's, and it's technology provider AIQ, Inc. to retain my personal contact details and engagement history for use in personalized marketing communications. I understand that I may opt-out of text messages at any time by replying \"STOP\". Standard messaging and calling rates may apply. I affirm that I am of legal age to receive communications related to the services and products being advertised. Consent is not a condition of purchase.";

const defaultValues = {
  firstName: "",
  lastName: "",
  birthday: "",
  mobilePhone: "",
  email: "",
  consent: false,
  signature: "",
  company: "",
};

type FormValues = typeof defaultValues;
type FormErrors = Partial<Record<keyof FormValues | "form", string>>;

type SignupResponse = {
  ok: boolean;
  signupId?: string;
  notificationStatus?: string;
  message?: string;
  errors?: FormErrors;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-xs font-bold text-red-300">{message}</p>;
}

export function LoyaltySignupForm() {
  const [values, setValues] = useState<FormValues>(defaultValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<SignupResponse | null>(null);
  const [fallbackSuccess, setFallbackSuccess] = useState<SignupResponse | null>(null);

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "success") return;

    queueMicrotask(() => {
      setFallbackSuccess({
        ok: true,
        signupId: params.get("id") ?? undefined,
        notificationStatus: "saved",
        message: "Signup captured for Greenway staff review and manual POS entry.",
      });
    });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSuccess(null);
    setErrors({});

    try {
      const response = await fetch("/api/loyalty-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await response.json()) as SignupResponse;

      if (!response.ok || !data.ok) {
        setErrors(data.errors ?? { form: "Please review the form and try again." });
        return;
      }

      setSuccess(data);
      setValues(defaultValues);
    } catch {
      setErrors({ form: "Signup could not be submitted. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_8%,rgba(126,217,87,0.12),transparent_18rem),radial-gradient(circle_at_84%_10%,rgba(255,127,0,0.12),transparent_21rem),radial-gradient(circle_at_50%_88%,rgba(255,215,0,0.08),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-[88rem] px-4 pt-5 md:px-8 md:pt-8">
        {/* MOBILE banner (own art, ~3:1) */}
        <div className="relative aspect-[3/1] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:hidden">
          <Image
            src={greenwayBusiness.assets.loyaltyHeroMobile}
            alt="Greenway Loyalty Points promotional banner"
            fill
            priority
            sizes="calc(100vw - 2rem)"
            className="object-cover object-center"
          />
        </div>
        {/* DESKTOP banner (own art, wide) */}
        <div className="relative hidden aspect-[3200/563] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:block">
          <Image
            src={greenwayBusiness.assets.loyaltyHero}
            alt="Greenway Loyalty Points promotional banner"
            fill
            priority
            sizes="(min-width: 1408px) 1408px, calc(100vw - 4rem)"
            className="object-cover object-center"
          />
        </div>
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-7 md:px-8 md:py-10 lg:py-12">
        <div className="rounded-[1.35rem] border border-white/10 bg-zinc-950/92 p-5 text-center shadow-2xl shadow-black/40 md:rounded-[2rem] md:p-7 lg:p-9">
          <div className="mx-auto flex justify-center">
            <Image
              src={greenwayBusiness.assets.blackGoldLogoTransparent}
              alt="Greenway Marijuana black and gold logo"
              width={360}
              height={360}
              className="h-auto w-40 object-contain sm:w-48 md:w-56"
            />
          </div>

          <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight text-white md:mt-4 md:text-5xl">
            Signup to get offers and discounts from Greenway Marijuana
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-xs font-semibold leading-5 text-zinc-400 md:text-sm">
            Get updates on our promotions tailored to you.
          </p>

          {success || fallbackSuccess ? (
            <div className="mx-auto mt-7 max-w-2xl rounded-2xl border border-[var(--greenway)]/35 bg-[var(--greenway-dark)]/55 p-4 text-sm leading-6 text-zinc-100">
              <p className="font-black text-[var(--greenway)]">Thank you — your signup was submitted.</p>
              <p className="mt-2">Reference ID: {(success ?? fallbackSuccess)?.signupId}</p>
              <p className="mt-1 text-zinc-300">Notification status: {(success ?? fallbackSuccess)?.notificationStatus}.</p>
            </div>
          ) : null}

          <form action="/api/loyalty-signup" method="post" onSubmit={onSubmit} className="mx-auto mt-8 grid max-w-2xl gap-4 text-left" noValidate>
            <div className="hidden">
              <label htmlFor="company">Company</label>
              <input id="company" name="company" tabIndex={-1} autoComplete="off" value={values.company} onChange={(event) => updateValue("company", event.target.value)} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-black text-white">First Name <span className="text-red-300">*</span></span>
                <input className="mt-2 w-full rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" name="firstName" autoComplete="given-name" value={values.firstName} onChange={(event) => updateValue("firstName", event.target.value)} />
                <FieldError message={errors.firstName} />
              </label>

              <label className="block">
                <span className="text-sm font-black text-white">Last Name <span className="text-red-300">*</span></span>
                <input className="mt-2 w-full rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" name="lastName" autoComplete="family-name" value={values.lastName} onChange={(event) => updateValue("lastName", event.target.value)} />
                <FieldError message={errors.lastName} />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-black text-white">Birthday <span className="text-red-300">*</span></span>
              <input type="date" name="birthday" className="mt-2 block w-full min-w-0 max-w-full appearance-none rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" autoComplete="bday" value={values.birthday} onChange={(event) => updateValue("birthday", event.target.value)} />
              <p className="mt-2 text-xs font-semibold leading-5 text-zinc-400">Get special discounts and offers on your birthday!</p>
              <FieldError message={errors.birthday} />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-black text-white">Mobile Phone <span className="text-red-300">*</span></span>
                <input type="tel" name="mobilePhone" className="mt-2 w-full rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" autoComplete="tel" placeholder="(555) 555-5555" value={values.mobilePhone} onChange={(event) => updateValue("mobilePhone", event.target.value)} />
                <FieldError message={errors.mobilePhone} />
              </label>

              <label className="block">
                <span className="text-sm font-black text-white">Email <span className="text-red-300">*</span></span>
                <input type="email" name="email" className="mt-2 w-full rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" autoComplete="email" placeholder="you@example.com" value={values.email} onChange={(event) => updateValue("email", event.target.value)} />
                <FieldError message={errors.email} />
              </label>
            </div>

            <label className="flex gap-3 rounded-2xl border border-white/10 bg-black/45 p-4 text-sm leading-6 text-zinc-300">
              <input type="checkbox" name="consent" value="true" className="mt-1 h-5 w-5 shrink-0 accent-[var(--orange)]" checked={values.consent} onChange={(event) => updateValue("consent", event.target.checked)} />
              <span>
                {consentText}
                <FieldError message={errors.consent} />
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-black text-white">Signature Required <span className="text-red-300">*</span></span>
              <input className="mt-2 w-full rounded-xl border border-white/12 bg-white px-4 py-3 text-base font-semibold text-black outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/35" name="signature" placeholder="Type your full name" value={values.signature} onChange={(event) => updateValue("signature", event.target.value)} />
              <FieldError message={errors.signature} />
            </label>

            <FieldError message={errors.form ?? errors.company} />

            <button type="submit" disabled={isSubmitting} className="mt-2 rounded-full bg-[var(--orange)] px-6 py-4 text-sm font-black uppercase tracking-[0.18em] text-black shadow-xl shadow-black/35 transition hover:bg-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? "Submitting..." : "Sign Up"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
