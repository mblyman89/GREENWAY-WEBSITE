import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isLlamaParseConfigured } from "@/lib/inbound-email/llamaparse-provider";
import { documentEvents, getAchDocument } from "@/lib/payments/ach-document-store";
import {
  DOC_KIND_LABELS,
  INTAKE_EVENTS,
  INTAKE_LABELS,
  MAX_DOC_BYTES,
  canAcceptKind,
  pendingFromEvents,
} from "@/lib/payments/ach-document-intake-core";
import {
  extractAchDocumentAction,
  openAchDocumentAction,
  rejectAchDocumentAction,
  rekeyAchDocumentAction,
} from "../../document-actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-md border border-[var(--admin-border)] bg-black/30 px-2 py-1 text-sm text-white";
const label = "text-xs text-white/60";
const btn = "rounded-md bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black";
const btnGhost = "rounded-md border border-[var(--admin-border)] px-3 py-1.5 text-xs font-semibold text-white/80";

/**
 * R39 S5 — review one dropped ACH document (owner/admin).
 * BLIND RE-KEY: the entry form is never pre-filled with the machine-read
 * numbers; the page shows only the draft's warnings and account count. The
 * person types what they see on the document; the server compares.
 */
export default async function AchDocumentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const doc = await getAchDocument(id);
  if (!doc) notFound();

  const events = await documentEvents(doc);
  const admin = createSupabaseAdminClient();
  const payeeId = (doc.employee_id ?? doc.vendor_id) as string;
  const payee =
    doc.payee_type === "employee"
      ? ((await admin.from("employees").select("full_name").eq("id", payeeId).maybeSingle()).data as { full_name?: string } | null)?.full_name
      : ((await admin.from("vendors").select("display_name").eq("id", payeeId).maybeSingle()).data as { display_name?: string } | null)?.display_name;
  const extracted = [...events].reverse().find((e) => e.event_kind === INTAKE_EVENTS.extracted);
  const xd = (extracted?.detail ?? null) as {
    source?: string;
    accounts?: number;
    usable?: boolean;
    warnings?: string[];
    signed_on?: string | null;
    form_kind?: string | null;
    routing_fingerprints?: string[];
  } | null;
  const pending = pendingFromEvents(events, doc.id);
  const open = !doc.archived_at && (doc.intake_status === "received" || doc.intake_status === "extracted");
  const rows = doc.payee_type === "vendor" ? [1] : [1, 2, 3];
  const payeePath = doc.payee_type === "employee" ? `/admin/staffing/employees/${payeeId}` : `/admin/vendors/${payeeId}`;

  return (
    <div>
      <AdminPageHeader
        title={`${DOC_KIND_LABELS[doc.kind]}: ${payee ?? "Unknown payee"}`}
        subtitle={`${doc.payee_type === "employee" ? "Employee" : "Vendor"} · dropped ${doc.uploaded_at.slice(0, 10)} · ${doc.original_filename} · ${(doc.byte_size / 1024).toFixed(0)} KB of ${(MAX_DOC_BYTES / 1048576).toFixed(0)} MB max`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Settings", href: "/admin/settings" },
              { label: "Banking", href: "/admin/settings/banking" },
              { label: "Documents", href: "/admin/settings/banking/documents" },
              { label: "Review" },
            ]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.ok ? <p className="rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-3 py-2 text-sm text-[var(--admin-accent)]">{sp.ok}</p> : null}
        {sp.error ? <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{sp.error}</p> : null}

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={doc.intake_status === "accepted" ? "green" : doc.intake_status === "rejected" ? "danger" : "gold"}>
              {doc.archived_at ? "Archived" : INTAKE_LABELS[doc.intake_status]}
            </Badge>
            <form action={openAchDocumentAction}>
              <input type="hidden" name="document_id" value={doc.id} />
              <button type="submit" className={btnGhost}>Open the file (2-minute link)</button>
            </form>
            <Link href={payeePath} className="text-xs font-semibold text-white/60 hover:underline">Go to the {doc.payee_type} →</Link>
          </div>
          {doc.intake_note ? <p className="mt-2 text-xs text-white/60">{doc.intake_note}</p> : null}
          <p className="mt-2 text-xs text-white/40">SHA-256 {doc.sha256}: re-checked every time the file is read.</p>
        </section>

        {open && canAcceptKind(doc.kind) ? (
          <>
            <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h2 className="text-sm font-semibold text-white">1. Machine read (optional)</h2>
              <p className="mt-1 text-xs text-white/50">
                Our own fillable form is read on this server; nothing leaves it. A scan or photo can be sent to LlamaParse (kept by them
                up to 48 hours, not used for training); it only suggests a routing number.
              </p>
              {xd ? (
                <div className="mt-2 text-xs text-white/70">
                  <p>
                    Last read: {xd.source === "acroform" ? "form fields" : xd.source === "llamaparse" ? "LlamaParse scan" : "nothing readable"} ·{" "}
                    {xd.accounts ?? 0} account(s) · {xd.usable ? "complete, no warnings" : "needs two blind entries"}
                    {xd.signed_on ? ` · form says signed ${xd.signed_on}` : ""}
                  </p>
                  {xd.warnings?.length ? (
                    <ul className="mt-1 list-disc pl-5 text-[var(--admin-orange)]">
                      {xd.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <form action={extractAchDocumentAction} className="mt-3 flex flex-wrap items-center gap-3">
                <input type="hidden" name="document_id" value={doc.id} />
                {doc.mime_type !== "application/pdf" || xd?.source === "none" ? (
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <input type="checkbox" name="llamaparse" disabled={!isLlamaParseConfigured()} /> Send this scan to LlamaParse
                    {!isLlamaParseConfigured() ? " (LLAMA_CLOUD_API_KEY not set)" : ""}
                  </label>
                ) : null}
                <button type="submit" className={btnGhost}>Read the document</button>
              </form>
            </section>

            <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h2 className="text-sm font-semibold text-white">2. Enter what you see (blind)</h2>
              <p className="mt-1 text-xs text-white/50">
                Type the details from the document yourself. Nothing is filled in for you. If your entry matches the form&apos;s own fields,
                it is accepted. Otherwise a second entry (by you or someone else) must match the first.
                {pending ? " A first entry is waiting: this is the second entry." : ""}
              </p>
              <form action={rekeyAchDocumentAction} autoComplete="off" className="mt-3 space-y-4">
                <input type="hidden" name="document_id" value={doc.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={label}>
                    Name on the form
                    <input name="payee_name" className={input} defaultValue={payee ?? ""} />
                  </label>
                  <label className={label}>
                    Date signed
                    <input name="signed_on" type="date" required className={input} />
                  </label>
                  {doc.payee_type === "employee" ? (
                    <label className="flex items-end gap-2 text-xs text-white/70">
                      <input type="checkbox" name="replace_open" /> Replace the current authorization (archives it)
                    </label>
                  ) : null}
                </div>
                {rows.map((i) => (
                  <fieldset key={i} className="rounded-md border border-white/10 p-3">
                    <legend className="px-1 text-xs text-white/50">
                      {doc.payee_type === "vendor" ? "Bank account (receives the whole payment)" : `Account ${i}${i > 1 ? " (leave blank if none)" : ""}`}
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <label className={`${label} sm:col-span-2`}>
                        Bank name
                        <input name={`a${i}_bank`} className={input} autoComplete="off" />
                      </label>
                      <label className={label}>
                        Routing (9 digits)
                        <input name={`a${i}_rtn`} inputMode="numeric" className={`${input} font-mono`} autoComplete="off" />
                      </label>
                      <label className={label}>
                        Account number
                        <input name={`a${i}_acct`} inputMode="numeric" className={`${input} font-mono`} autoComplete="off" />
                      </label>
                      <label className={label}>
                        Type
                        <select name={`a${i}_type`} defaultValue="" className={input}>
                          <option value="">Pick</option>
                          <option value="checking">Checking</option>
                          <option value="savings">Savings</option>
                        </select>
                      </label>
                      {doc.payee_type === "employee" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <label className={label}>
                            Gets
                            <select name={`a${i}_how`} defaultValue="" className={input}>
                              <option value="">Pick</option>
                              <option value="remainder">Remainder</option>
                              <option value="fixed">Fixed $</option>
                              <option value="percent">Percent</option>
                            </select>
                          </label>
                          <label className={label}>
                            Amount
                            <input name={`a${i}_amt`} className={input} placeholder="200.00 or 25" autoComplete="off" />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </fieldset>
                ))}
                <button type="submit" className={btn}>Check and accept</button>
              </form>
            </section>
          </>
        ) : open ? (
          <p className="text-sm text-white/60">
            This is supporting evidence ({DOC_KIND_LABELS[doc.kind]}). It cannot set up banking on its own; a signed authorization form is needed.
          </p>
        ) : null}

        {open ? (
          <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="text-sm font-semibold text-white">Reject</h2>
            <p className="mt-1 text-xs text-white/50">The document is kept as evidence (retention). Say why, so the payee can be asked for a new one.</p>
            <form action={rejectAchDocumentAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="document_id" value={doc.id} />
              <label className={`${label} min-w-[18rem] flex-1`}>
                Reason (at least 10 characters)
                <input name="reason" required minLength={10} className={input} />
              </label>
              <button type="submit" className={btnGhost}>Reject document</button>
            </form>
          </section>
        ) : null}

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-sm font-semibold text-white">History</h2>
          <ul className="mt-2 space-y-1 text-xs text-white/60">
            {events.map((e, i) => (
              <li key={i}>
                {e.occurred_at.slice(0, 16).replace("T", " ")} · {e.event_kind.replace(/_/g, " ")}
                {(e.detail as { differences?: string[] })?.differences?.length
                  ? ` · different: ${((e.detail as { differences: string[] }).differences).join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
