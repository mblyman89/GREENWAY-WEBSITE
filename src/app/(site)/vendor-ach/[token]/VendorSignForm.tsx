"use client";

/**
 * R39 S7 — the one vendor form (GW-ACH-V Parts 1, 2 and 6).
 *
 * Built for a phone: big boxes, the right keyboards (inputMode numeric for
 * routing/account/ZIP, tel, email), autocomplete hints, everything prefilled
 * that Greenway already knows. The bank proof can be a photo straight from
 * the camera; photos are shrunk HERE before upload (long side 2000 px, JPEG)
 * because Vercel refuses request bodies over 4.5 MB and a modern phone photo
 * is often 3-8 MB. PDFs and anything the browser cannot draw (HEIC outside
 * Safari) go up unchanged and the server's 4 MB check explains the limit.
 *
 * The action returns field errors instead of redirecting, so nothing typed
 * is lost when one box needs fixing. Bank numbers are never prefilled.
 */
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signVendorAction, type VendorSignActionResult } from "./actions";
import { planShrink, PROOF_UPLOAD_TARGET_BYTES } from "@/lib/payments/vendor-proof-shrink-core";

type Option = { value: string; label: string };

export type VendorSignFormProps = {
  token: string;
  prefill: Record<string, string>;
  entityOptions: Option[];
  kindOptions: Option[];
  proofOptions: Option[];
  intentStatement: string;
  certification: string;
  terms: ReactNode;
};

const box =
  "mt-1 block w-full rounded-lg border border-white/20 bg-black/40 px-3 py-3 text-base text-white placeholder:text-white/40 focus:border-[#7ed957] focus:outline-none";

function Err({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm text-red-300">{msg}</p>;
}

async function shrinkPhoto(file: File): Promise<File> {
  const plan0 = planShrink({ mime: file.type, bytes: file.size, width: 0, height: 0 });
  if (plan0.kind === "keep") return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file; // the browser cannot draw it (for example HEIC outside Safari): let the server judge it
  }
  const plan = planShrink({ mime: file.type, bytes: file.size, width: bmp.width, height: bmp.height });
  if (plan.kind === "keep") {
    bmp.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    return file;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.drawImage(bmp, 0, 0, plan.width, plan.height);
  bmp.close();
  for (const q of plan.qualities) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= PROOF_UPLOAD_TARGET_BYTES) {
      const base = (file.name || "bank-proof").replace(/\.[A-Za-z0-9]+$/, "").slice(0, 60) || "bank-proof";
      return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
    }
  }
  return file;
}

export function VendorSignForm(p: VendorSignFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VendorSignActionResult | null>(null);
  const [entity, setEntity] = useState(p.prefill.entity_type ?? "");
  const [note, setNote] = useState<string | null>(null);
  const errors = result && !result.ok ? result.errors ?? {} : {};
  const v = (k: string) => p.prefill[k] ?? "";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;
    start(async () => {
      const fd = new FormData(form);
      const f = fd.get("proof");
      if (f && typeof f !== "string" && f.size > 0) {
        setNote("Preparing your photo...");
        const small = await shrinkPhoto(f);
        fd.set("proof", small, small.name);
      }
      setNote("Signing...");
      let r: VendorSignActionResult;
      try {
        r = await signVendorAction(fd);
      } catch {
        r = { ok: false, error: "The form could not be sent (the connection dropped, or the file is too large). Check your signal and press Sign again. Nothing was signed." };
      }
      setNote(null);
      setResult(r);
      if (r.ok) router.refresh();
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const T = (name: string, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, hint?: string) => (
    <label className="block">
      <span className="text-sm font-medium text-white/90">{label}</span>
      {hint ? <span className="block text-xs text-white/60">{hint}</span> : null}
      <input name={name} defaultValue={v(name)} className={box} aria-invalid={Boolean(errors[name as keyof typeof errors])} {...extra} />
      <Err msg={errors[name as keyof typeof errors]} />
    </label>
  );

  const S = (name: string, label: string, options: Option[], onChange?: (x: string) => void) => (
    <label className="block">
      <span className="text-sm font-medium text-white/90">{label}</span>
      <select name={name} defaultValue={v(name)} className={box} onChange={onChange ? (e) => onChange(e.target.value) : undefined} required>
        <option value="">Choose...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Err msg={errors[name as keyof typeof errors]} />
    </label>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-8" noValidate>
      <input type="hidden" name="token" value={p.token} />
      {result && !result.ok ? (
        <div role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-200">
          {result.error}
        </div>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">1. Your business</legend>
        {T("legal_name", "Legal business name", { autoComplete: "organization", required: true })}
        {T("dba", "Doing business as (if different)")}
        <div className="grid gap-4 sm:grid-cols-2">
          {S("entity_type", "Entity type", p.entityOptions, setEntity)}
          {S("vendor_kind", "Vendor type", p.kindOptions)}
        </div>
        {entity === "other" ? T("entity_other", "Describe the entity type") : null}
        <div className="grid gap-4 sm:grid-cols-3">
          {T("license_no", "WSLCB license #", { inputMode: "numeric", maxLength: 6 }, "6 digits (cannabis vendors)")}
          {T("ubi", "UBI #", { inputMode: "numeric", maxLength: 11 }, "9 digits")}
          {T("tin_last4", "Tax ID: LAST 4 only", { inputMode: "numeric", maxLength: 4, autoComplete: "off", required: true }, "Never the full EIN/SSN")}
        </div>
        {T("street", "Mailing address", { autoComplete: "street-address", required: true })}
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-6 sm:col-span-3">{T("city", "City", { autoComplete: "address-level2", required: true })}</div>
          <div className="col-span-2 sm:col-span-1">{T("state", "State", { autoComplete: "address-level1", maxLength: 2, required: true })}</div>
          <div className="col-span-4 sm:col-span-2">{T("zip", "ZIP", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 10, required: true })}</div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">2. Who Greenway calls</legend>
        <p className="text-sm text-white/70">Before the first payment Greenway phones the second contact to confirm. Two different people work best.</p>
        {T("ar_contact", "Accounts-receivable contact (name and title)", { autoComplete: "name", required: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          {T("ar_phone", "Phone", { type: "tel", inputMode: "tel", autoComplete: "tel", required: true }, "Any format")}
          {T("ar_email", "Email", { type: "email", inputMode: "email", autoComplete: "email", required: true })}
        </div>
        {T("second_contact", "Second authorized contact (name and title)", { required: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          {T("second_phone", "Phone", { type: "tel", inputMode: "tel", required: true }, "Any format")}
          {T("second_email", "Email", { type: "email", inputMode: "email", required: true })}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">3. Where Greenway sends your money</legend>
        <div className="flex flex-wrap gap-4 text-white">
          <label className="flex items-center gap-2">
            <input type="radio" name="request_type" value="new" defaultChecked={v("request_type") !== "change"} className="h-5 w-5" /> New enrollment
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="request_type" value="change" defaultChecked={v("request_type") === "change"} className="h-5 w-5" /> Change my bank details
          </label>
        </div>
        <Err msg={errors.request_type} />
        <div className="grid gap-4 sm:grid-cols-2">
          {T("bank_name", "Bank name", { required: true })}
          {T("bank_city_state", "Bank city and state")}
        </div>
        {T("routing", "Routing number", { inputMode: "numeric", maxLength: 11, autoComplete: "off", required: true, defaultValue: undefined }, "9 digits, bottom left of a check")}
        <div className="grid gap-4 sm:grid-cols-2">
          {T("account", "Account number", { inputMode: "numeric", maxLength: 20, autoComplete: "off", required: true, defaultValue: undefined })}
          {T("account2", "Account number again", { inputMode: "numeric", maxLength: 20, autoComplete: "off", required: true, defaultValue: undefined, onPaste: (e) => e.preventDefault() }, "Type it again (paste is off)")}
        </div>
        <div className="flex flex-wrap gap-4 text-white">
          <label className="flex items-center gap-2">
            <input type="radio" name="account_type" value="checking" defaultChecked className="h-5 w-5" /> Checking
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="account_type" value="savings" className="h-5 w-5" /> Savings
          </label>
        </div>
        <Err msg={errors.account_type} />
        {T("name_on_account", "Name exactly as on the bank account", { required: true }, "A business account in your legal or trade name")}
        {T("remittance_email", "Send payment details to (optional)", { type: "email", inputMode: "email" }, "Where each payment's invoice list goes")}
        {T("start_date", "Start date (optional)", { type: "date" }, "Blank = as soon as Greenway verifies")}
        <label className="block">
          <span className="text-sm font-medium text-white/90">Notes (optional)</span>
          <textarea name="notes" defaultValue={v("notes")} rows={2} maxLength={500} className={box} />
          <Err msg={errors.notes} />
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">4. Proof of the account</legend>
        <p className="text-sm text-white/70">A photo is fine. Take it flat, in good light, with the numbers readable. Black out any balance.</p>
        {S("proof_kind", "What is it?", p.proofOptions)}
        <label className="block">
          <span className="text-sm font-medium text-white/90">Photo or PDF</span>
          <input name="proof" type="file" accept="image/*,application/pdf" className="mt-2 block w-full text-base text-white file:mr-3 file:rounded-lg file:border-0 file:bg-[#7ed957] file:px-4 file:py-3 file:font-semibold file:text-black" />
          <Err msg={errors.proof} />
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">5. The agreement</legend>
        {p.terms}
        <p className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">{p.certification}</p>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold text-white">6. Sign</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {T("signer_name", "Your full name", { autoComplete: "name", required: true })}
          {T("signer_title", "Your title", { autoComplete: "organization-title", required: true }, "For example Owner, CFO, Office Manager")}
        </div>
        <label className="flex items-start gap-3 text-white">
          <input type="checkbox" name="intent" className="mt-1 h-6 w-6 shrink-0" />
          <span className="text-sm">{p.intentStatement}</span>
        </label>
        <Err msg={errors.intent} />
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[#7ed957] px-6 py-4 text-lg font-bold text-black disabled:opacity-60">
          {pending ? note ?? "Signing..." : "Sign"}
        </button>
        <p className="text-center text-xs text-white/60">Rather use paper? Call the store at 360-443-6988. Greenway keeps paying by check either way.</p>
      </fieldset>
    </form>
  );
}
