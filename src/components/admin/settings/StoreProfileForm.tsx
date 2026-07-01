"use client";

/**
 * StoreProfileForm (Slice 63) — edits the store profile stored in site_settings.
 * Uses the shared admin UI kit + toast. Submits to saveStoreProfileAction.
 */
import { useState, useTransition } from "react";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { saveStoreProfileAction } from "@/app/admin/settings/actions";
import {
  WEEKDAYS,
  WEEKDAY_LABEL,
  type StoreProfile,
} from "@/lib/admin/store-profile-core";

const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
];

export function StoreProfileForm({ profile }: { profile: StoreProfile }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors([]);
    startTransition(async () => {
      const res = await saveStoreProfileAction(fd);
      if (res.ok) {
        toast({ tone: "success", message: "Store profile saved." });
      } else if (res.errors?.length) {
        setErrors(res.errors);
        toast({ tone: "error", message: "Please fix the highlighted issues." });
      } else {
        toast({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {errors.length > 0 && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader title="Store identity" subtitle="Shown across the back office and used on documents." />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
          <Field label="Store name" required>
            <Input name="storeName" defaultValue={profile.storeName} required />
          </Field>
          <Field label="Legal entity / trade name" help="Optional — the registered business name.">
            <Input name="legalEntity" defaultValue={profile.legalEntity} />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={profile.phone} placeholder="(360) 555-0123" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={profile.email} placeholder="hello@store.com" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Address" subtitle="The store's physical location." />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
          <Field label="Address line 1" className="sm:col-span-2">
            <Input name="addressLine1" defaultValue={profile.addressLine1} />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <Input name="addressLine2" defaultValue={profile.addressLine2} placeholder="Suite, unit, etc." />
          </Field>
          <Field label="City">
            <Input name="city" defaultValue={profile.city} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <Input name="state" defaultValue={profile.state} maxLength={2} placeholder="WA" />
            </Field>
            <Field label="ZIP">
              <Input name="zip" defaultValue={profile.zip} placeholder="98366" />
            </Field>
          </div>
          <Field label="Time zone">
            <Select name="timezone" defaultValue={profile.timezone}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Store hours" subtitle="When the store is open to customers." />
        <div className="space-y-2 p-5 pt-0">
          {WEEKDAYS.map((d) => {
            const h = profile.hours[d];
            return (
              <div
                key={d}
                className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
              >
                <span className="w-24 text-sm font-semibold text-[var(--admin-text)]">
                  {WEEKDAY_LABEL[d]}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
                  <input
                    type="checkbox"
                    name={`hours.${d}.closed`}
                    defaultChecked={h.closed}
                    className="accent-[var(--admin-accent)]"
                  />
                  Closed
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name={`hours.${d}.open`}
                    defaultValue={h.open}
                    className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] px-2 py-1 text-sm text-[var(--admin-text)]"
                  />
                  <span className="text-xs text-[var(--admin-text-faint)]">to</span>
                  <input
                    type="time"
                    name={`hours.${d}.close`}
                    defaultValue={h.close}
                    className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] px-2 py-1 text-sm text-[var(--admin-text)]"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save store profile"}
        </Button>
      </div>
    </form>
  );
}
