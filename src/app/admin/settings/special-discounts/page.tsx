import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { formatBps } from "@/lib/discounts/special-discount-core";
import { getSpecialDiscountSettings } from "@/lib/discounts/special-discount-store";
import { saveSpecialDiscountAction } from "./actions";

export const dynamic = "force-dynamic";

const PROGRAM_COPY: Record<
  string,
  { title: string; icon: string; blurb: string; rules: string[] }
> = {
  employee: {
    title: "Employee discount",
    icon: "🧑‍🤝‍🧑",
    blurb: "Staff purchases at your set rate. Every use is tracked per employee.",
    rules: [
      "A SECOND employee must approve the sale with their own PIN — the buyer can never approve their own discount.",
      "The purchase cannot be completed on the register the buying employee is logged into — they must ring it on another register.",
      "Each use records who bought, who approved, which register, and the cents saved.",
    ],
  },
  industry: {
    title: "Industry discount",
    icon: "🤝",
    blurb: "For licensed-industry visitors — vendors, and budtenders from other stores.",
    rules: [
      "The visitor's company name is required at the register, so you can see who uses it, from which company, and how often.",
      "Starts turned OFF at 0% — set your rate and flip it on when you're ready.",
    ],
  },
  veteran: {
    title: "Veterans discount",
    icon: "🎖",
    blurb: "For military veterans, with an ID check confirmed at the register.",
    rules: [
      "The cashier must tick the \u201cmilitary ID checked\u201d box before the discount applies — the confirmation is stored with every use.",
    ],
  },
};

/**
 * Settings → Special discounts (SLICE 27). Person-based courtesy discounts —
 * deliberately SEPARATE from the promotions page and admin-only
 * (settings.manage = owner/admin) per the owner's instruction.
 */
export default async function SpecialDiscountsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const [settings, sp] = await Promise.all([getSpecialDiscountSettings(), searchParams]);

  return (
    <div>
      <AdminPageHeader
        title="Special discounts"
        subtitle="Employee, industry, and veterans discounts — admin-only, tracked on every use, and kept separate from promotions."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Settings", href: "/admin/settings" }, { label: "Special discounts" }]}
          />
        }
        help={
          <HelpPanel
            id="special-discounts-settings"
            title="How the three programs work"
            steps={[
              "Set each program's percent (like 35 or 12.5) and tick Enabled to make it available at the registers.",
              "Employee purchases always need a second employee's PIN, on a register the buyer is not logged into.",
              "Industry visitors must give their company name; veterans need a military ID check ticked by the cashier.",
              "Every single use is recorded — who gave it, who received it, and the exact cents saved — for reporting.",
            ]}
          >
            <p>
              These are courtesy discounts for people, not price promotions — that&apos;s why they live
              here (owner/admin only) and not on the Promotions page. A discount can never make
              cannabis free: at least 1¢ always remains (RCW 69.50.357).
            </p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
            {sp.msg}
          </div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {sp.error}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-3">
          {settings.map((s) => {
            const copy = PROGRAM_COPY[s.kind];
            return (
              <div
                key={s.kind}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[var(--admin-text)]">
                    <span aria-hidden className="mr-2">
                      {copy.icon}
                    </span>
                    {copy.title}
                  </h2>
                  <span
                    className={
                      s.enabled
                        ? "rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-2.5 py-0.5 text-xs font-semibold text-emerald-300"
                        : "rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2.5 py-0.5 text-xs font-semibold text-[var(--admin-text-muted)]"
                    }
                  >
                    {s.enabled ? `On · ${formatBps(s.percentBps)}` : "Off"}
                  </span>
                </div>
                <p className="mb-3 text-sm text-[var(--admin-text-muted)]">{copy.blurb}</p>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-[var(--admin-text-muted)]">
                  {copy.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <form action={saveSpecialDiscountAction} className="grid gap-3">
                  <input type="hidden" name="kind" value={s.kind} />
                  <Field label="Discount percent" help="0 to 100 — decimals like 12.5 are fine.">
                    <Input
                      name="percent"
                      defaultValue={String(s.percentBps / 100)}
                      inputMode="decimal"
                      placeholder="35"
                      required
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={s.enabled}
                      className="h-4 w-4 accent-[var(--admin-gold)]"
                    />
                    Enabled at the registers
                  </label>
                  <div>
                    <Button type="submit">Save {copy.title.toLowerCase()}</Button>
                  </div>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
