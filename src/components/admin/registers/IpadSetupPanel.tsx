"use client";

/**
 * IpadSetupPanel (D146–D148): the owner's iPad lockdown policy editor plus the
 * per-iPad setup checklist with live verification from the device itself.
 *
 * Owner, 2026-11-03: "Add it to the back office, a checklist or todo list or
 * some enterprise grade method for making this simple, that we can use to
 * make sure the settings are correct ... something only I can undo."
 *
 * Only the owner (registers.lockdown) can save. Everyone else with access sees
 * the same page read-only. A tick can never hide a wrong setting: items the
 * iPad measures itself show the live answer, and a tick the device disproves
 * is shown in red and does not count as done.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  CHECKLIST_SECTION_LABELS,
  IPAD_SETUP_CHECKLIST,
  type CheckMark,
  type ChecklistSection,
  type DeviceHealthVerdict,
  type IpadLockdownPolicy,
} from "@/lib/pos/ipad-setup-core";
import { saveLockdownPolicyAction, toggleChecklistItemAction } from "@/app/admin/registers/ipad-setup/actions";

export type IpadSetupDevice = {
  id: string;
  name: string;
  registerName: string | null;
  status: "active" | "revoked";
  lastSeenLabel: string;
  verdict: DeviceHealthVerdict;
  marks: Record<string, CheckMark>;
  progress: { done: number; total: number; contradicted: string[] };
  appFingerprintShort: string | null;
  reportedLabel: string | null;
};

const STATE_CLASS: Record<string, string> = {
  ok: "text-[var(--admin-accent)]",
  warn: "text-[var(--admin-gold)]",
  bad: "text-[var(--admin-danger)]",
  unknown: "text-[var(--admin-text-faint)]",
};

const SECTIONS: ChecklistSection[] = ["lock", "settings", "app", "hardware", "drill"];

export function LockdownPolicyEditor({ initial, canEdit }: { initial: IpadLockdownPolicy; canEdit: boolean }) {
  const { toast } = useToast();
  const [keepAwake, setKeepAwake] = useState(initial.keepAwake);
  const [guidedAccess, setGuidedAccess] = useState<string>(initial.guidedAccess);
  const [staleDays, setStaleDays] = useState(String(initial.staleDeviceDays));
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveLockdownPolicyAction({ keepAwake, guidedAccess, staleDeviceDays: staleDays });
      if (res.ok) toast({ tone: "success", message: "Lockdown policy saved. Each iPad applies it on its next heartbeat (about a minute)." });
      else toast({ tone: "error", message: res.error });
    });
  }

  return (
    <div className="space-y-4" data-testid="ipad-lockdown-policy">
      {!canEdit ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3 text-xs text-[var(--admin-gold)]">
          Read-only. Only the owner can change the iPad lockdown policy.
        </p>
      ) : null}
      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <input
          type="checkbox"
          checked={keepAwake}
          disabled={!canEdit}
          onChange={(e) => setKeepAwake(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">Keep the screen awake</span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            The iPad app stops the screen from sleeping while the register is open. Set Auto-Lock to Never as well.
          </span>
        </span>
      </label>
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <label htmlFor="ga-rule" className="block text-sm font-semibold text-[var(--admin-text)]">
          When Guided Access is OFF on an iPad
        </label>
        <select
          id="ga-rule"
          value={guidedAccess}
          disabled={!canEdit}
          onChange={(e) => setGuidedAccess(e.target.value)}
          className="mt-2 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-sm text-[var(--admin-text)]"
        >
          <option value="off">Do nothing</option>
          <option value="warn">Warn: bold red notice on the lock screen (sales still work)</option>
          <option value="block">Block: refuse PIN unlock until Guided Access is back on</option>
        </select>
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
          Block is the strictest setting. Turn it on only after both iPads show Guided Access ON below, or staff cannot
          unlock the register.
        </p>
      </div>
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <label htmlFor="stale-days" className="block text-sm font-semibold text-[var(--admin-text)]">
          Flag an active device as stale after (days without contact)
        </label>
        <input
          id="stale-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          step={1}
          value={staleDays}
          disabled={!canEdit}
          onChange={(e) => setStaleDays(e.target.value)}
          className="mt-2 w-24 rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--admin-text)]"
        />
      </div>
      {canEdit ? (
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save lockdown policy"}
        </Button>
      ) : null}
    </div>
  );
}

function liveText(v: boolean | null | undefined): { text: string; cls: string } {
  if (v === true) return { text: "iPad confirms: YES", cls: STATE_CLASS.ok };
  if (v === false) return { text: "iPad reports: NO", cls: STATE_CLASS.bad };
  return { text: "iPad cannot check (older build or not reported)", cls: STATE_CLASS.unknown };
}

export function IpadDeviceChecklist({ device, canEdit }: { device: IpadSetupDevice; canEdit: boolean }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const v = device.verdict;
  const overallCls = STATE_CLASS[v.overall];

  function toggle(itemId: string, checked: boolean) {
    setBusyItem(itemId);
    startTransition(async () => {
      const res = await toggleChecklistItemAction({ deviceId: device.id, itemId, checked });
      setBusyItem(null);
      if (!res.ok) toast({ tone: "error", message: res.error });
    });
  }

  return (
    <div className="space-y-4" data-testid="ipad-device-checklist" data-device-overall={v.overall}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[var(--admin-text)]">
            {device.name}
            {device.registerName ? <span className="text-[var(--admin-text-faint)]"> · {device.registerName}</span> : null}
          </h3>
          <p className="text-xs text-[var(--admin-text-faint)]">
            Last contact {device.lastSeenLabel}
            {device.reportedLabel ? ` · health reported ${device.reportedLabel}` : ""}
            {device.appFingerprintShort ? ` · app build ${device.appFingerprintShort}` : ""}
          </p>
        </div>
        <span className={`text-sm font-bold uppercase ${overallCls}`}>
          {v.overall === "ok" ? "All good" : v.overall === "warn" ? "Needs attention" : "Action required"}
        </span>
      </div>

      {v.version === "outdated" ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-sm font-bold text-[var(--admin-danger)]">
          THIS IPAD IS NOT ON THE NEWEST VERSION. Rebuild it (step 3 below).
        </p>
      ) : v.version === "current" ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-3 text-sm font-bold text-[var(--admin-accent)]">
          NEWEST VERSION. This iPad runs the same code as the website.
        </p>
      ) : null}
      {v.stale ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-sm text-[var(--admin-danger)]">
          Stale device: no contact recently. If it is not at a counter, revoke it on POS devices so its key cannot be
          used.
        </p>
      ) : null}

      <ul className="grid gap-1 sm:grid-cols-2">
        {v.checks.map((c) => (
          <li key={c.label} className="text-xs">
            <span className={`font-semibold ${STATE_CLASS[c.state]}`}>{c.label}:</span>{" "}
            <span className="text-[var(--admin-text-muted)]">{c.text}</span>
          </li>
        ))}
      </ul>

      <p className="text-sm font-semibold text-[var(--admin-text)]">
        Checklist {device.progress.done}/{device.progress.total}
        {device.progress.contradicted.length > 0 ? (
          <span className="text-[var(--admin-danger)]"> · {device.progress.contradicted.length} ticked but the iPad says otherwise</span>
        ) : null}
      </p>

      {SECTIONS.map((section) => (
        <div key={section} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <p className="mb-2 text-sm font-semibold text-[var(--admin-text)]">{CHECKLIST_SECTION_LABELS[section]}</p>
          <ul className="space-y-3">
            {IPAD_SETUP_CHECKLIST.filter((i) => i.section === section).map((item) => {
              const mark = device.marks[item.id];
              const live = item.verify ? liveText(v.verified[item.verify]) : null;
              const contradicted = device.progress.contradicted.includes(item.id);
              return (
                <li key={item.id} className="flex items-start gap-3" data-item={item.id}>
                  <input
                    type="checkbox"
                    aria-label={item.title}
                    checked={!!mark}
                    disabled={!canEdit || (pending && busyItem === item.id)}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--admin-accent)]"
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${contradicted ? "text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}>
                      {item.title}
                    </span>
                    <span className="block text-xs text-[var(--admin-text-muted)]">{item.how}</span>
                    {live ? <span className={`block text-xs font-semibold ${live.cls}`}>{live.text}</span> : null}
                    {mark ? (
                      <span className="block text-[0.65rem] text-[var(--admin-text-faint)]">
                        Ticked by {mark.by || "owner"} on {new Date(mark.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
