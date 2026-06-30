"use client";

import { useState, useTransition } from "react";
import { saveLicenseSettingsAction } from "@/app/admin/reports/compliance/actions";

export function LicenseSettingsForm({
  licenseNumber,
  submittedBy,
  tradeName,
  canEdit,
}: {
  licenseNumber: string;
  submittedBy: string;
  tradeName: string;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveLicenseSettingsAction(formData);
      if (res.ok) setMsg({ ok: true, text: "Saved." });
      else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-white/50">
            CCRS license number
          </span>
          <input
            name="license_number"
            defaultValue={licenseNumber}
            disabled={!canEdit}
            placeholder="e.g. 412345"
            inputMode="numeric"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-white/50">
            Submitted by (name)
          </span>
          <input
            name="submitted_by"
            defaultValue={submittedBy}
            disabled={!canEdit}
            maxLength={35}
            placeholder="Your name"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-white/50">
            Trade name (optional)
          </span>
          <input
            name="trade_name"
            defaultValue={tradeName}
            disabled={!canEdit}
            placeholder="Greenway Marijuana"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50"
          />
        </label>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save license settings"}
          </button>
          {msg ? (
            <span className={`text-xs font-bold ${msg.ok ? "text-[var(--admin-accent)]" : "text-orange-400"}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-white/40">You don’t have permission to edit license settings.</p>
      )}
    </form>
  );
}
