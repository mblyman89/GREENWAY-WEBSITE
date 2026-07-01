/**
 * src/app/admin/reports/excise/page.tsx  (Slice 55)
 *
 * The "Excise Tax (LIQ-1295)" tab, now a full editable return + guided payment
 * workflow:
 *   1. Every editable LIQ-1295 field is a real form (header, Yes/No flags, and
 *      manual box overrides 1/2/6/8/9), saved to excise_return_drafts.
 *   2. A guided PAYMENT panel: pre-filled PayStation deep-link, the CCRS ACH
 *      "Make a Payment" checklist, the cannabistaxes@lcb.wa.gov email reminder,
 *      and a payment-reconciliation record (method / confirmation / amount / date).
 *   3. Clickable "review before filing" issues that jump to the relevant field.
 *
 * Grounded in docs/excise-payment-methods.md (verified WSLCB payment methods) and
 * the LIQ-1295 R 7.24 box mapping.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { resolveExciseReturn } from "@/lib/compliance/excise-draft";
import { listExciseReturnBatches } from "@/lib/compliance/excise-return";
import {
  buildPayStationLink,
  buildCcrsAchChecklist,
  paymentMethodLabel,
  PAYMENT_METHODS,
  EXCISE_REPORT_EMAIL,
  EXCISE_MAIL_ADDRESS,
} from "@/lib/compliance/excise-payment-core";
import { saveExciseDraftAction } from "./actions";

export const dynamic = "force-dynamic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Minor units → plain dollar string for form defaults ("" when null). */
function minorToInput(minor: number | null | undefined): string {
  if (minor == null) return "";
  return (Math.abs(minor) / 100).toFixed(2);
}

/** Map a review-issue message to the section anchor it should jump to. */
function anchorFor(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("license")) return "#field-header";
  if (m.includes("e-mail") || m.includes("email")) return "#field-header";
  if (m.includes("box 1")) return "#field-box1";
  if (m.includes("box 2") || m.includes("medical")) return "#field-box2";
  if (m.includes("no cannabis sales") || m.includes("no-sales")) return "#field-flags";
  return "#form-liq1295";
}

const labelCls = "flex flex-col gap-1 text-xs text-white/60";
const inputCls =
  "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--admin-accent)] focus:outline-none";

export default async function ExcisePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; ok?: string; error?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;

  // Default to the previous month (the one you'd be filing for).
  const now = new Date();
  const defMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(); // prev month (1-12)
  const defYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : defMonth;
  const year = Number(sp.year) >= 2014 ? Number(sp.year) : defYear;

  const resolved = isSupabaseServiceConfigured ? await resolveExciseReturn(month, year) : null;
  const data = resolved?.data ?? null;
  const draft = resolved?.draft ?? null;
  const batches = await listExciseReturnBatches(12);

  const years = [defYear + 1, defYear, defYear - 1, defYear - 2];
  const qs = `month=${month}&year=${year}`;

  // Pre-fill the payment helpers from the resolved return.
  const amountDue = data?.boxes.box10_amountToPay ?? 0;
  const payStationLink = data
    ? buildPayStationLink({
        licenseNumber: data.identity.licenseNumber,
        amountDueDollars: amountDue,
        dueDateISO: data.dueDate,
      })
    : "";
  const ccrsChecklist = data
    ? buildCcrsAchChecklist({
        licenseNumber: data.identity.licenseNumber,
        amountDueDollars: amountDue,
        contactPhone: data.identity.phone,
        contactEmail: data.identity.email,
      })
    : null;

  const exportHref = `/admin/reports/compliance/excise-export?${qs}`;

  return (
    <div className="space-y-5">
      {sp.ok ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-5 py-3 text-xs font-bold text-emerald-200">
          Draft saved. The figures below and the downloaded LIQ-1295 now reflect your edits.
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-5 py-3 text-xs font-bold text-red-200">
          {sp.error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-xs leading-relaxed text-white/50">
        The <span className="font-bold text-white/80">LIQ-1295</span> is WSLCB&apos;s monthly Cannabis Retailer Sales &amp;
        Excise Tax return. It&apos;s required every month (even with no sales) and is due by the{" "}
        <span className="font-bold text-white/80">20th</span> of the following month. This tool fills the official Excel
        form from your completed sales &mdash; 37% excise on taxable cannabis, less qualifying medical-exempt sales. Review
        every figure, save your draft, download the form, then email it to{" "}
        <code className="text-white/70">{EXCISE_REPORT_EMAIL}</code> and pay it below.
      </div>

      {/* Period picker */}
      <Section title="Reporting period">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>
            Month
            <select name="month" defaultValue={month} className={inputCls}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Year
            <select name="year" defaultValue={year} className={inputCls}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/[0.08]"
          >
            Load period
          </button>
        </form>
        {data ? (
          <p className="mt-3 text-xs text-white/40">
            Due date for {MONTHS[month - 1]} {year}: <span className="font-bold text-white/70">{data.dueDate}</span> &middot;{" "}
            {data.orderCount} completed orders &middot; {data.exemptRecordCount} exempt medical sales aggregated
            {draft?.updated_at ? ` · draft last saved ${new Date(draft.updated_at).toLocaleString()}` : ""}.
          </p>
        ) : null}
      </Section>

      {/* Box preview */}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Box 1 · Cannabis sales" value={fmt(data.boxes.box1_cannabisSales)} accent="green" />
            <StatCard label="Box 2 · Less medical" value={fmt(data.boxes.box2_lessMedical)} accent="gold" />
            <StatCard label="Box 3 · Taxable" value={fmt(data.boxes.box3_taxable)} accent="muted" />
            <StatCard label="Box 5 · Excise (37%)" value={fmt(data.boxes.box5_calculatedExcise)} accent="orange" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Box 6 · Additional excise" value={fmt(data.boxes.box6_additionalExcise)} accent="muted" />
            <StatCard label="Box 7 · Subtotal excise" value={fmt(data.boxes.box7_subtotalExcise)} accent="muted" />
            <StatCard label="Box 9 · Approved credits" value={fmt(data.boxes.box9_approvedCredits)} accent="muted" />
            <StatCard label="Box 10 · Amount to pay" value={fmt(data.boxes.box10_amountToPay)} accent="green" />
          </div>

          {data.warnings.length > 0 ? (
            <div className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-4">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-orange-300">Review before filing</p>
              <ul className="space-y-1 text-xs text-orange-100/80">
                {data.warnings.map((w, i) => (
                  <li key={i}>
                    <a
                      href={anchorFor(w)}
                      className="inline-flex items-center gap-1 rounded underline decoration-orange-300/40 underline-offset-2 hover:text-orange-100"
                    >
                      <span aria-hidden>&#9656;</span> {w}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-orange-100/50">Click an issue to jump to the field that fixes it.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-5 py-3 text-xs font-bold text-emerald-200">
              No issues detected — this return looks ready to file.
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-white/50">
          Connect Supabase to compute the return from live sales.
        </div>
      )}

      {/* Editable LIQ-1295 form */}
      {data ? (
        <form id="form-liq1295" action={saveExciseDraftAction} className="space-y-5">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="year" value={year} />

          <Section
            id="field-header"
            title="Return details (header)"
            subtitle="Blank fields fall back to your saved license settings. Fill these only to override for this return."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelCls}>
                License number
                <input name="license_number" defaultValue={draft?.license_number ?? ""} placeholder={data.identity.licenseNumber || "e.g. 412345"} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Trade name
                <input name="trade_name" defaultValue={draft?.trade_name ?? ""} placeholder={data.identity.tradeName || "Greenway Marijuana"} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Location address
                <input name="location_address" defaultValue={draft?.location_address ?? ""} placeholder={data.identity.locationAddress || "Street address"} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                City
                <input name="city" defaultValue={draft?.city ?? ""} placeholder={data.identity.city || "Port Orchard"} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Contact phone (signature block)
                <input name="contact_phone" defaultValue={draft?.contact_phone ?? ""} placeholder={data.identity.phone || "360-555-0100"} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Contact e-mail (signature block)
                <input name="contact_email" type="email" defaultValue={draft?.contact_email ?? ""} placeholder={data.identity.email || "owner@example.com"} className={inputCls} disabled={!canEdit} />
              </label>
            </div>
          </Section>

          <Section id="field-flags" title="Return type" subtitle="Check any that apply to this filing.">
            <div className="flex flex-wrap gap-5 text-sm text-white/70">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_revised" defaultChecked={draft?.is_revised ?? false} disabled={!canEdit} />
                Revised return
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_no_sales" defaultChecked={draft?.is_no_sales ?? false} disabled={!canEdit} />
                No-sales month
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_final" defaultChecked={draft?.is_final ?? false} disabled={!canEdit} />
                Final return (closing)
              </label>
            </div>
          </Section>

          <Section
            title="Manual box overrides"
            subtitle="Boxes 1 & 2 default to your live sales; override them only to match a corrected POS report. Boxes 6/8/9 are always entered by hand. All amounts in dollars."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label id="field-box1" className={`${labelCls} scroll-mt-24`}>
                Box 1 · Cannabis sales (override)
                <input name="box1" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.box1_cannabis_sales_minor)} placeholder={fmt(data.boxes.box1_cannabisSales).replace("$", "")} className={inputCls} disabled={!canEdit} />
              </label>
              <label id="field-box2" className={`${labelCls} scroll-mt-24`}>
                Box 2 · Less medical (override, positive)
                <input name="box2" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.box2_less_medical_minor)} placeholder={Math.abs(data.boxes.box2_lessMedical).toFixed(2)} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Box 6 · Additional excise collected
                <input name="box6" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.box6_additional_excise_minor)} placeholder="0.00" className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Box 8 · Assessed penalty / balance due
                <input name="box8" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.box8_assessed_penalty_minor)} placeholder="0.00" className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Box 9 · Approved credits (positive)
                <input name="box9" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.box9_approved_credits_minor)} placeholder="0.00" className={inputCls} disabled={!canEdit} />
              </label>
              <label className={`${labelCls} sm:col-span-2 lg:col-span-3`}>
                Notes (internal — not sent to the LCB)
                <textarea name="notes" defaultValue={draft?.notes ?? ""} rows={2} className={inputCls} disabled={!canEdit} />
              </label>
            </div>
          </Section>

          {/* Payment reconciliation lives in the same form so it saves together. */}
          <Section
            id="field-payment"
            title="Payment reconciliation"
            subtitle="Record how and when this return was paid so each month is tracked filed → paid."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelCls}>
                Payment method
                <select name="payment_method" defaultValue={draft?.payment_method ?? ""} className={inputCls} disabled={!canEdit}>
                  <option value="">— not chosen —</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Status
                <select name="payment_status" defaultValue={draft?.payment_status ?? "unpaid"} className={inputCls} disabled={!canEdit}>
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label className={labelCls}>
                Confirmation / reference #
                <input name="payment_confirmation" defaultValue={draft?.payment_confirmation ?? ""} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Amount paid ($)
                <input name="amount_paid" type="number" step="0.01" min="0" defaultValue={minorToInput(draft?.amount_paid_minor)} placeholder={amountDue.toFixed(2)} className={inputCls} disabled={!canEdit} />
              </label>
              <label className={labelCls}>
                Paid on
                <input name="paid_at" type="date" defaultValue={draft?.paid_at ? draft.paid_at.slice(0, 10) : ""} className={inputCls} disabled={!canEdit} />
              </label>
            </div>
            <div className="mt-3 text-xs text-white/40">
              Current record: <span className="font-bold text-white/70">{paymentMethodLabel(draft?.payment_method)}</span>{" "}
              &middot; {draft?.payment_status === "paid" ? "paid" : "unpaid"}
              {draft?.paid_at ? ` on ${new Date(draft.paid_at).toLocaleDateString()}` : ""}
              {draft?.amount_paid_minor != null ? ` · ${fmt(draft.amount_paid_minor / 100)}` : ""}.
            </div>
          </Section>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-[var(--admin-accent)] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90"
              >
                Save draft
              </button>
              <span className="text-xs text-white/40">Saving updates the boxes above and the downloaded form.</span>
            </div>
          ) : (
            <p className="text-xs text-white/40">Editing the LIQ-1295 requires the &ldquo;Change settings&rdquo; permission.</p>
          )}
        </form>
      ) : null}

      {/* Generate the file */}
      {data ? (
        <Section title="Download the LIQ-1295" subtitle="Downloads the official Excel form, pre-filled from your saved draft and ready to email to the LCB.">
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={exportHref}
                prefetch={false}
                className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
              >
                &#11015; Download filled LIQ-1295 (.xlsx)
              </Link>
              <span className="text-xs text-white/40">Save your draft first so the download includes your edits.</span>
            </div>
          ) : (
            <p className="text-xs text-white/40">Generating the regulatory file requires the &ldquo;Change settings&rdquo; permission.</p>
          )}
        </Section>
      ) : null}

      {/* Guided payment workflow */}
      {data ? (
        <Section
          title="Pay the excise tax"
          subtitle={`Amount to pay: ${fmt(amountDue)} · due ${data.dueDate}. There is no payment API — use one of the LCB's portals below, then record it above.`}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* PayStation deep-link */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm font-black text-white/80">Option A · Retail Lockbox (PayStation)</p>
              <p className="mt-1 text-xs text-white/40">
                Opens the LCB&apos;s PayStation portal pre-filled with your license, the amount due, and the due date.
                Review, then pay by card or ACH.
              </p>
              {amountDue > 0 ? (
                <a
                  href={payStationLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
                >
                  Open PayStation (pre-filled) &#8599;
                </a>
              ) : (
                <p className="mt-3 text-xs text-white/40">Nothing to pay for this period.</p>
              )}
            </div>

            {/* CCRS ACH checklist */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm font-black text-white/80">Option B · CCRS ACH (Make a Payment)</p>
              {ccrsChecklist ? (
                <>
                  <p className="mt-1 text-xs text-white/40">
                    Log into CCRS and use <span className="font-semibold text-white/60">Make a Payment</span>. It auto-fills{" "}
                    {ccrsChecklist.autoFilled.join(" and ")}. You enter:
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-white/60">
                    {ccrsChecklist.youEnter.map((e) => (
                      <li key={e.label} className="flex justify-between gap-3">
                        <span>{e.label}</span>
                        <span className="font-mono text-white/80">{e.value ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={ccrsChecklist.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/[0.08]"
                  >
                    Open CCRS &#8599;
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-white/50">
            <p>
              <span className="font-bold text-white/70">Always email the completed form</span> to{" "}
              <code className="text-white/70">{EXCISE_REPORT_EMAIL}</code> — ideally the same day you pay.
            </p>
            <p className="mt-1">
              Paying by check / money order? Mail to: <span className="text-white/70">{EXCISE_MAIL_ADDRESS}</span> (write
              your license number on the check).
            </p>
            <p className="mt-1">
              After paying, record the method and confirmation number in{" "}
              <a href="#field-payment" className="underline decoration-white/30 underline-offset-2 hover:text-white/80">
                Payment reconciliation
              </a>{" "}
              above.
            </p>
          </div>
        </Section>
      ) : null}

      {/* Recent returns */}
      {batches.length > 0 ? (
        <Section title="Recent excise returns">
          <ul className="divide-y divide-white/5 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-xs text-white/70">{b.file_name}</span>
                <span className="text-xs text-white/40">
                  {MONTHS[b.report_month - 1]} {b.report_year} &middot; pay {fmt(Number(b.amount_to_pay))}
                  {b.no_sales ? " · no sales" : ""} &middot; {new Date(b.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
