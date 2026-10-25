/**
 * S-18a: the CCRS email panel on the hub. Server component (no hooks).
 *
 * Shows what the monitor read from the submitting mailbox and lets the owner
 * apply it with one click. Every word about a message comes from the stored
 * analysis (ccrs-mail-core); the server re-checks everything on Apply.
 */
import type { MailAnalysis, MailHeartbeat } from "@/lib/compliance/ccrs-mail-core";
import { AUTH_TEXT, heartbeatStale } from "@/lib/compliance/ccrs-mail-core";
import type { CcrsFileRecord } from "@/lib/compliance/ccrs-ledger-store";
import { Button } from "@/components/admin/ui";
import type { CcrsStrategy } from "@/lib/compliance/ccrs-strategy-core";
import { CcrsStrategyReport } from "./CcrsStrategyReport";

export type CcrsMailPanelRow = {
  id: string;
  gmail_id: string;
  received_at: string | null;
  subject: string;
  kind: "success" | "error" | "unknown" | "not-ccrs";
  env: "preprod" | "prod" | null;
  env_verified: boolean;
  auth: MailAnalysis["auth"];
  in_spam: boolean;
  analysis: Omit<Partial<MailAnalysis>, "errors"> & { errors?: { filename: string; fileType: string | null; typeProblem: string | null; dataLines: number; messages: string[] }[] };
  state: "new" | "applied" | "dismissed";
  handled_note: string | null;
  /** R74 S47: our file names in a "has not been processed" email (whole file refused, no CSV). */
  notProcessed?: string[];
  /** S-18b: built by the page from the stored CSVs (error mail only). */
  strategy?: CcrsStrategy | null;
};

export type CcrsMailSetup =
  | { configured: true; mode: string; mailbox: string }
  | { configured: false; mailbox: string; missing: string[]; problem: string | null };

const KIND_LABEL: Record<CcrsMailPanelRow["kind"], string> = {
  success: "Confirmation",
  error: "Error file",
  unknown: "Needs reading",
  "not-ccrs": "Not from CCRS",
};

function pacific(iso: string | null): string {
  if (!iso) return "time unknown";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
}

export function CcrsMailPanel({
  available,
  loadError,
  setup,
  heartbeat,
  rows,
  uploadedFiles,
  canEdit,
  weekKey,
  nowISO,
  actions,
}: {
  available: boolean;
  loadError: string | null;
  setup: CcrsMailSetup;
  heartbeat: MailHeartbeat | null;
  rows: readonly CcrsMailPanelRow[];
  /** Uploaded (waiting) files of the env on screen: the choices when an error file fits more than one. */
  uploadedFiles: readonly Pick<CcrsFileRecord, "id" | "fileName" | "fileType" | "env">[];
  canEdit: boolean;
  weekKey: string;
  nowISO: string;
  actions: {
    poll: (fd: FormData) => Promise<void>;
    applySuccess: (fd: FormData) => Promise<void>;
    applyError: (fd: FormData) => Promise<void>;
    applyNotProcessed?: (fd: FormData) => Promise<void>;
    dismiss: (fd: FormData) => Promise<void>;
  };
}) {
  const stale = heartbeatStale(heartbeat, Date.parse(nowISO));
  const open = rows.filter((r) => r.state === "new");
  const done = rows.filter((r) => r.state !== "new");
  return (
    <div className="space-y-3 text-xs text-white/70" data-testid="ccrs-mail-panel" id="ccrs-mail">
      {!setup.configured ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-amber-100" data-testid="ccrs-mail-not-setup">
          <p className="font-bold">The mailbox monitor is not set up yet.</p>
          <p className="mt-1">
            {setup.problem ?? `Missing: ${setup.missing.join(", ")}.`} It will read {setup.mailbox} once the Google settings are added in Vercel
            (the keyless setup walkthrough is in Part 09 R6-5). Until then, paste CCRS emails into the boxes below as before.
          </p>
        </div>
      ) : stale || (heartbeat && !heartbeat.ok) ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-100" data-testid="ccrs-mail-unhealthy">
          <p className="font-bold">The mailbox monitor is not working.</p>
          <p className="mt-1">
            {heartbeat?.error ?? "No check has run in the last 45 minutes."} Last good check: {pacific(heartbeat?.lastOkAt ?? null)}. Check Gmail by hand until this is fixed.
            {heartbeat?.failingSince ? ` Failing since ${pacific(heartbeat.failingSince)}; the owner is alerted once after 15 minutes.` : ""}
          </p>
        </div>
      ) : (
        <p className="text-white/50" data-testid="ccrs-mail-healthy">
          Watching {setup.mailbox} for email from info@lcb.wa.gov every 5 minutes (Spam included). Last check: {pacific(heartbeat?.lastRunAt ?? null)}.
        </p>
      )}

      {!available ? (
        <p className="text-amber-200">Apply database update 0282 (ccrs_mail_messages) to store CCRS emails.</p>
      ) : loadError ? (
        <p className="text-red-200">{loadError}</p>
      ) : null}

      {canEdit && setup.configured ? (
        <form action={actions.poll}>
          <input type="hidden" name="week_key" value={weekKey} />
          <Button type="submit" size="sm" variant="neutral">
            Check the mailbox now
          </Button>
        </form>
      ) : null}

      {available && open.length === 0 ? <p className="text-white/40">No CCRS email waiting to be applied.</p> : null}

      {open.map((r) => {
        const a = r.analysis ?? {};
        const needs = a.needsHuman ?? [];
        return (
          <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3" data-testid="ccrs-mail-item" data-kind={r.kind}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase">{KIND_LABEL[r.kind]}</span>
              <span className="font-semibold text-white/90">{r.subject || "(no subject)"}</span>
              <span className="text-white/40">{pacific(r.received_at)}</span>
              {r.env ? (
                <span className="text-white/50">
                  {r.env === "preprod" ? "PREprod" : "production"}
                  {r.env_verified ? "" : " (not yet verified)"}
                </span>
              ) : null}
            </div>
            <p className={r.auth === "dmarc-fail" ? "mt-1 text-red-200" : "mt-1 text-white/40"} data-testid="ccrs-mail-auth">
              {AUTH_TEXT[r.auth]}
            </p>
            {r.kind === "success" ? (
              <ul className="mt-1 list-disc pl-5">
                {(a.successes ?? []).map((s) => (
                  <li key={s.fileName}>
                    {s.fileName} {s.submittedAt ? `(CCRS Date Submitted ${pacific(s.submittedAt)})` : "(no Date Submitted)"}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.kind === "error"
              ? (a.errors ?? []).map((e) => (
                  <div key={e.filename} className="mt-1">
                    <p className="font-semibold">
                      {e.filename}: {e.fileType ?? "type unknown"}, {e.dataLines} row(s) refused or flagged
                    </p>
                    <ul className="list-disc pl-5">
                      {e.messages.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ))
              : null}
            {r.kind === "error" && r.strategy ? <CcrsStrategyReport strategy={r.strategy} /> : null}
            {needs.length ? (
              <ul className="mt-2 list-disc pl-5 text-amber-100" data-testid="ccrs-mail-needs-human">
                {needs.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}

            {canEdit ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                {r.kind === "success" ? (
                  <form action={actions.applySuccess} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="week_key" value={weekKey} />
                    <input type="hidden" name="mail_id" value={r.id} />
                    {!r.env ? (
                      <select name="env" className="rounded bg-white/10 px-2 py-1" defaultValue="">
                        <option value="">PREprod or production?</option>
                        <option value="preprod">PREprod</option>
                        <option value="prod">Production</option>
                      </select>
                    ) : null}
                    {!r.env || !r.env_verified ? (
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="confirm_checked" /> I checked this file in the CCRS portal
                      </label>
                    ) : null}
                    <Button type="submit" size="sm" variant="save">
                      Apply confirmation
                    </Button>
                  </form>
                ) : null}
                {r.kind === "error" ? (
                  <form action={actions.applyError} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="week_key" value={weekKey} />
                    <input type="hidden" name="mail_id" value={r.id} />
                    {(a.errors ?? []).map((e, i) => {
                      const fits = uploadedFiles.filter((f) => f.fileType === e.fileType);
                      return fits.length > 1 ? (
                        <select key={e.filename} name={`file_${i}`} className="rounded bg-white/10 px-2 py-1" defaultValue="">
                          <option value="">{e.filename}: let the rows decide</option>
                          {fits.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.fileName}
                            </option>
                          ))}
                        </select>
                      ) : null;
                    })}
                    <Button type="submit" size="sm" variant="save">
                      Apply error file
                    </Button>
                  </form>
                ) : null}
                {r.notProcessed?.length && actions.applyNotProcessed ? (
                  <form action={actions.applyNotProcessed} className="flex flex-wrap items-end gap-2" data-testid="ccrs-mail-not-processed">
                    <input type="hidden" name="week_key" value={weekKey} />
                    <input type="hidden" name="mail_id" value={r.id} />
                    <Button type="submit" size="sm" variant="save">
                      Record as not processed ({r.notProcessed.join(", ")})
                    </Button>
                  </form>
                ) : null}
                <form action={actions.dismiss} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="week_key" value={weekKey} />
                  <input type="hidden" name="mail_id" value={r.id} />
                  <input name="reason" placeholder="Why set aside (e.g. recorded by paste)" className="w-56 rounded bg-white/10 px-2 py-1" />
                  <Button type="submit" size="sm" variant="neutral">
                    Set aside
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        );
      })}

      {done.length ? (
        <details className="text-white/40">
          <summary>Handled ({done.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {done.map((r) => (
              <li key={r.id}>
                {pacific(r.received_at)} {r.subject}: {r.state}
                {r.handled_note ? ` (${r.handled_note})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
