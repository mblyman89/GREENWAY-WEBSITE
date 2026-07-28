/**
 * SLICE 80 — Payee banking vault (/admin/settings/payees).
 *
 * THE one place where who-we-pay banking lives. Two tabs:
 *   - Vendors: the vendor_bank_details vault (migration 0143) — encrypted at
 *     rest, admin-only at the database level, with on-hold + out-of-band
 *     verification controls per WA State Auditor fraud guidance.
 *   - Employees: direct-deposit banking on the employees table (already
 *     encrypted, migration 0057) — edited HERE and nowhere else; payroll runs
 *     read it and can no longer change it.
 *
 * Gate: settings.manage = owner + admin ONLY. Managers who can run payments
 * can NOT edit banking (segregation of duties), and no employee can ever
 * enter their own payroll banking.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import { listVendorBankDetails } from "@/lib/payments/payee-banking-store";
import { listEmployeeBanking, listEmployees } from "@/lib/staffing/store";
import { listVendors } from "@/lib/vendors/store";
import {
  clearEmployeeBankingAction,
  deleteVendorBankingAction,
  markVendorBankVerifiedAction,
  saveEmployeeBankingAction,
  saveVendorBankingAction,
  setVendorBankHoldAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary =
  "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost =
  "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";

export default async function PayeeBankingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string; edit?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab: "vendors" | "employees" = sp.tab === "employees" ? "employees" : "vendors";

  const [vault, vendors, employees, employeeBanking] = await Promise.all([
    listVendorBankDetails(),
    listVendors(),
    listEmployees({ includeInactive: true }),
    listEmployeeBanking(),
  ]);

  const bankingByEmployee = new Map(employeeBanking.map((b) => [b.employee_id, b]));
  const vaultByVendor = new Map(vault.records.map((r) => [r.vendor_id, r]));
  const vendorsWithoutBanking = vendors.filter((v) => !vaultByVendor.has(v.id));
  const editRecord = sp.edit ? vaultByVendor.get(sp.edit) ?? null : null;

  return (
    <div>
      <AdminPageHeader
        title="Payee banking"
        subtitle="The vault: bank details for everyone we pay — vendors and employees. Owner/admin eyes only; payments pull from here and can't be changed at pay time."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Payee banking" }]} />
        }
        help={
          <HelpPanel
            id="payee-banking"
            title="How the vault protects you"
            steps={[
              "Only the owner and admins can see or edit this page — the database itself refuses everyone else, even with a direct connection.",
              "Vendor ACH payments and payroll runs pull banking FROM the vault. The pay screens have no bank-number fields to tamper with.",
              "When a vendor emails you 'new bank details', save them here, then put the record ON HOLD and call the vendor at a number you ALREADY have (not one from the email). Record the verification, release the hold, then pay. That one phone call defeats nearly all vendor-impersonation fraud.",
              "Every add, change, hold, release, and delete is written to the audit log with masked numbers — a permanent who-changed-what trail.",
              "Any attempt to slip different bank numbers into a payment is blocked AND logged as a tamper attempt.",
            ]}
          >
            <p>
              This design follows Washington State Auditor guidance on vendor payment fraud:
              nearly every ACH fraud case starts with a bank-detail change request. Segregating
              who edits banking from who runs payments, verifying changes out-of-band, and
              auditing every change are the three controls that stop it.
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

        {/* Tabs */}
        <div className="mb-6 flex gap-2">
          <Link
            href="/admin/settings/payees?tab=vendors"
            className={`rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
              tab === "vendors" ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
            }`}
          >
            Vendors ({vault.records.length})
          </Link>
          <Link
            href="/admin/settings/payees?tab=employees"
            className={`rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
              tab === "employees" ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
            }`}
          >
            Employees ({employeeBanking.filter((b) => b.bank_routing || b.bank_account_number).length})
          </Link>
        </div>

        {tab === "vendors" ? (
          <div className="space-y-6">
            {!vault.tableReady ? (
              <div className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
                <span className="font-semibold">One migration to run:</span> the vendor banking
                vault table doesn&apos;t exist yet. Run{" "}
                <code className="rounded bg-black/30 px-1">supabase/migrations/0143_payee_banking_vault.sql</code>{" "}
                in the Supabase SQL editor, then refresh. Until then, the vendor payments page
                keeps its old manual bank-entry fields.
              </div>
            ) : (
              <>
                {/* Existing vault records */}
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
                    Banking on file
                  </h2>
                  {vault.records.length === 0 ? (
                    <p className="text-sm text-white/50">
                      No vendor banking saved yet. Add the first record below — after that,
                      vendor ACH payments will pull straight from the vault.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-white/10">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/50">
                          <tr>
                            <th className="px-4 py-3">Vendor</th>
                            <th className="px-4 py-3">Bank</th>
                            <th className="px-4 py-3">Routing</th>
                            <th className="px-4 py-3">Account</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Verified</th>
                            <th className="px-4 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {vault.records.map((r) => (
                            <tr key={r.id} className="align-top">
                              <td className="px-4 py-3 font-semibold text-white">{r.vendor_name}</td>
                              <td className="px-4 py-3 text-white/70">{r.bank_name || "—"}</td>
                              <td className="px-4 py-3 font-mono text-white/70">{maskAccountTail(r.routing)}</td>
                              <td className="px-4 py-3 font-mono text-white/70">{maskAccountTail(r.account_number)}</td>
                              <td className="px-4 py-3 text-white/70">{r.account_type}</td>
                              <td className="px-4 py-3">
                                {r.status === "on_hold" ? (
                                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                                    ON HOLD
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                                    active
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-white/50">
                                {r.verified_at ? (
                                  <span title={r.verified_note ?? undefined}>
                                    ✅ {new Date(r.verified_at).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span className="text-amber-300/80">not yet</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Link href={`/admin/settings/payees?tab=vendors&edit=${r.vendor_id}`} className={btnGhost}>
                                    Edit
                                  </Link>
                                  <form action={setVendorBankHoldAction}>
                                    <input type="hidden" name="vendor_id" value={r.vendor_id} />
                                    <input type="hidden" name="status" value={r.status === "on_hold" ? "active" : "on_hold"} />
                                    <button type="submit" className={btnGhost}>
                                      {r.status === "on_hold" ? "Release hold" : "Put on hold"}
                                    </button>
                                  </form>
                                  <form action={deleteVendorBankingAction}>
                                    <input type="hidden" name="vendor_id" value={r.vendor_id} />
                                    <button type="submit" className="rounded-[var(--admin-radius)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-danger)] hover:underline">
                                      Remove
                                    </button>
                                  </form>
                                </div>
                                {!r.verified_at ? (
                                  <form action={markVendorBankVerifiedAction} className="mt-2 flex gap-2">
                                    <input type="hidden" name="vendor_id" value={r.vendor_id} />
                                    <input
                                      name="note"
                                      placeholder="Verified with… (name + phone)"
                                      className="w-52 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white placeholder:text-white/30"
                                    />
                                    <button type="submit" className={btnGhost}>
                                      Mark verified
                                    </button>
                                  </form>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Add / edit form */}
                <section className="max-w-xl rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5">
                  <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-white/50">
                    {editRecord ? `Update ${editRecord.vendor_name}'s banking` : "Add vendor banking"}
                  </h2>
                  <p className="mb-4 text-xs text-white/40">
                    Take the numbers from a voided check, a bank letter on the vendor&apos;s
                    letterhead, or a verified phone call — never from an unverified email.
                  </p>
                  <form action={saveVendorBankingAction} className="space-y-4">
                    {editRecord ? (
                      <input type="hidden" name="vendor_id" value={editRecord.vendor_id} />
                    ) : (
                      <div>
                        <label className={labelCls} htmlFor="vendor_id">Vendor</label>
                        <select id="vendor_id" name="vendor_id" className={inputCls} defaultValue="" required>
                          <option value="" disabled>Pick a vendor…</option>
                          {vendorsWithoutBanking.map((v) => (
                            <option key={v.id} value={v.id}>{v.display_name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className={labelCls} htmlFor="bank_name">Bank name</label>
                      <input
                        id="bank_name"
                        name="bank_name"
                        className={inputCls}
                        defaultValue={editRecord?.bank_name ?? ""}
                        placeholder="e.g. Umpqua Bank"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls} htmlFor="routing">Routing number</label>
                        <input
                          id="routing"
                          name="routing"
                          className={inputCls}
                          inputMode="numeric"
                          placeholder={editRecord ? maskAccountTail(editRecord.routing) : "9 digits"}
                          required
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="account_number">Account number</label>
                        <input
                          id="account_number"
                          name="account_number"
                          className={inputCls}
                          inputMode="numeric"
                          placeholder={editRecord ? maskAccountTail(editRecord.account_number) : "4–17 digits"}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="account_type">Account type</label>
                      <select id="account_type" name="account_type" className={inputCls} defaultValue={editRecord?.account_type ?? "checking"}>
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="notes">Notes (optional)</label>
                      <input
                        id="notes"
                        name="notes"
                        className={inputCls}
                        defaultValue={editRecord?.notes ?? ""}
                        placeholder="Where these numbers came from"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="submit" className={btnPrimary}>
                        {editRecord ? "Save changes" : "Add to vault"}
                      </button>
                      {editRecord ? (
                        <Link href="/admin/settings/payees?tab=vendors" className={btnGhost}>Cancel</Link>
                      ) : null}
                    </div>
                  </form>
                </section>
              </>
            )}
          </div>
        ) : (
          /* -------------------------------------------------- Employees tab */
          <div className="space-y-6">
            <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/60">
              Direct-deposit banking for payroll. This page is the ONLY place it can be
              entered or changed — the payroll run screen shows it read-only, so nobody can
              redirect a paycheck at pay time.
            </div>
            <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Routing</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {employees.map((e) => {
                    const b = bankingByEmployee.get(e.id);
                    const has = !!(b && (b.bank_routing || b.bank_account_number));
                    return (
                      <tr key={e.id} className="align-top">
                        <td className="px-4 py-3">
                          <span className="font-semibold text-white">{e.full_name}</span>
                          {!e.active ? <span className="ml-2 text-xs text-white/40">(inactive)</span> : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-white/70">
                          {has && b?.bank_routing ? maskAccountTail(b.bank_routing) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-white/70">
                          {has && b?.bank_account_number ? maskAccountTail(b.bank_account_number) : "—"}
                        </td>
                        <td className="px-4 py-3 text-white/70">{has ? b?.bank_account_type ?? "—" : "—"}</td>
                        <td className="px-4 py-3">
                          <form action={saveEmployeeBankingAction} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="employee_id" value={e.id} />
                            <input
                              name="routing"
                              inputMode="numeric"
                              placeholder="Routing"
                              className="w-28 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white placeholder:text-white/30"
                            />
                            <input
                              name="account_number"
                              inputMode="numeric"
                              placeholder="Account"
                              className="w-32 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white placeholder:text-white/30"
                            />
                            <select
                              name="account_type"
                              defaultValue={b?.bank_account_type ?? "checking"}
                              className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white"
                            >
                              <option value="checking">Checking</option>
                              <option value="savings">Savings</option>
                            </select>
                            <button type="submit" className={btnGhost}>
                              {has ? "Replace" : "Add"}
                            </button>
                          </form>
                          {has ? (
                            <form action={clearEmployeeBankingAction} className="mt-1">
                              <input type="hidden" name="employee_id" value={e.id} />
                              <button type="submit" className="text-xs font-semibold text-[var(--admin-danger)] hover:underline">
                                Clear banking
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
