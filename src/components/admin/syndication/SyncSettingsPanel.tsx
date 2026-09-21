"use client";

/**
 * src/components/admin/syndication/SyncSettingsPanel.tsx  (Task X)
 *
 * Owner tuning panel for the Leafly / Weedmaps transmission parameters.
 * Renders the shared knobs (pacing, retries, field toggles, force resend)
 * plus per-channel extras (Leafly sync mode, Weedmaps unpublish behavior),
 * and the sync-state reset recovery tool. The channel pages pass in their
 * audited server actions; every value is clamped server-side by the pure
 * sync-settings-core resolvers, so nothing entered here can break a sync.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/admin/ui";
import type {
  LeaflySyncSettings,
  WeedmapsSyncSettings,
} from "@/lib/syndication/sync-settings-core";
import {
  MAX_RETRIES_MAX,
  PACING_MS_MAX,
} from "@/lib/syndication/sync-settings-core";
import {
  MENU_VISIBILITY_MAX_THRESHOLD,
  MENU_VISIBILITY_RECOMMENDED_THRESHOLD,
  describeMenuVisibilityMode,
  withholdEffectiveness,
} from "@/lib/leafly/menu-visibility-core";

type AnySettings = LeaflySyncSettings | WeedmapsSyncSettings;

type SaveResult =
  | { ok: true; settings: AnySettings }
  | { ok: false; error: string };

type ResetResult = { ok: true } | { ok: false; error: string };

function Toggle({
  name,
  label,
  help,
  defaultChecked,
}: {
  name: string;
  label: string;
  help: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-[var(--admin-text)]">
      {/* Hidden false ensures unchecked boxes still submit an explicit value. */}
      <input type="hidden" name={`${name}__present`} value="1" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--admin-accent)]"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-[11px] text-[var(--admin-text-muted)]">{help}</span>
      </span>
    </label>
  );
}

export function SyncSettingsPanel({
  channel,
  settings,
  saveAction,
  resetStateAction,
}: {
  channel: "leafly" | "weedmaps";
  settings: AnySettings;
  saveAction: (formData: FormData) => Promise<SaveResult>;
  resetStateAction: () => Promise<ResetResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState<boolean | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  const isLeafly = channel === "leafly";
  const wm = settings as WeedmapsSyncSettings;
  const lf = settings as LeaflySyncSettings;

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    // Checkboxes: submit explicit false when the box is present but unchecked.
    for (const key of [
      "sendDescriptions",
      "sendCannabinoids",
      "sendImages",
      "sendStrains",
      "forceResend",
      "unpublishWhenOutOfStock",
      // SLICE L-3. Must be listed here or an owner UNCHECKING "offer ordering" would
      // submit nothing for the key, the resolver would fall back to the stored value,
      // and turning ordering OFF would silently fail — the worst direction to fail in.
      "sendPickupAvailability",
    ]) {
      if (fd.get(`${key}__present`) === "1" && fd.get(key) === null) {
        fd.set(key, "false");
      }
      fd.delete(`${key}__present`);
    }
    setMsg(null);
    setMsgOk(null);
    startTransition(async () => {
      const res = await saveAction(fd);
      if (res.ok) {
        setMsgOk(true);
        setMsg("Saved. These parameters apply to the next sync.");
      } else {
        setMsgOk(false);
        setMsg(res.error);
      }
    });
  }

  function doReset() {
    setMsg(null);
    setMsgOk(null);
    startTransition(async () => {
      const res = await resetStateAction();
      setResetArmed(false);
      if (res.ok) {
        setMsgOk(true);
        setMsg("Sync memory cleared — the next live sync will resend every item.");
      } else {
        setMsgOk(false);
        setMsg(res.error);
      }
    });
  }

  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Transmission parameters</h2>
        <Badge tone="gold">Owner tuning</Badge>
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Full control over what gets transmitted and how fast. Every value is clamped to a safe
        range on the server, so nothing here can break a sync. Changes apply to the NEXT sync —
        nothing is pushed by saving.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Pacing between writes (ms)"
            htmlFor={`${channel}-pacing`}
            help={
              isLeafly
                ? "Leafly syncs in one request — pacing only spaces retries. 0 is fine."
                : `Delay between per-item writes. Default 150ms ≈ 66 requests/10s, far under Weedmaps' enforced 420/10s. Max ${PACING_MS_MAX}.`
            }
          >
            <Input
              id={`${channel}-pacing`}
              name="pacingMs"
              type="number"
              min={0}
              max={PACING_MS_MAX}
              defaultValue={settings.pacingMs}
            />
          </Field>
          <Field
            label="Max retries on 429/5xx"
            htmlFor={`${channel}-retries`}
            help={`Exponential backoff (250ms, 500ms, 1s, …). 0 disables retries; max ${MAX_RETRIES_MAX}.`}
          >
            <Input
              id={`${channel}-retries`}
              name="maxRetries"
              type="number"
              min={0}
              max={MAX_RETRIES_MAX}
              defaultValue={settings.maxRetries}
            />
          </Field>
        </div>

        {isLeafly ? (
          <Field
            label="Default sync mode"
            htmlFor="leafly-syncmode"
            help="POST = full sync (Leafly removes items missing from the payload — its recommended daily operation). PUT = upsert only; the engine then removes departed items with an explicit delete. The dropdown on the push card overrides this per-push."
          >
            <Select id="leafly-syncmode" name="syncMode" defaultValue={lf.syncMode}>
              <option value="post">POST — full sync (recommended)</option>
              <option value="put">PUT — upsert + explicit deletes</option>
            </Select>
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Toggle
            name="sendDescriptions"
            label="Send descriptions"
            help="Plain-text product descriptions."
            defaultChecked={settings.sendDescriptions}
          />
          <Toggle
            name="sendCannabinoids"
            label="Send THC / CBD"
            help={isLeafly ? "Compounds + totals. Absent values are sent as null, never 'NA' or 0." : "Cannabinoid percentage measurements."}
            defaultChecked={settings.sendCannabinoids}
          />
          <Toggle
            name="sendStrains"
            label="Send strain info"
            help={isLeafly ? "Strain name (absent = null, never 'NA')." : "Strain name + genetics (indica/sativa/hybrid)."}
            defaultChecked={settings.sendStrains}
          />
          {/*
            SLICE L-3 (finding L-10). This used to be a paragraph claiming "the Leafly
            Menu API v2 items payload has no image field (verified)", which is why Leafly
            had no image toggle at all. The claim was wrong — `imageUrl` is a documented
            property of the v2 item schema — so the owner was told he could not send
            photos to the one channel where photos most affect certification. Leafly now
            gets the same real toggle Weedmaps has.
          */}
          <Toggle
            name="sendImages"
            label="Send exact product photos"
            help="Only the product's own approved photo (https JPG/PNG) — never a representative substitute."
            defaultChecked={settings.sendImages}
          />
          {isLeafly ? (
            <Toggle
              name="sendPickupAvailability"
              label="Offer these items for ordering on Leafly"
              help={
                "Lets Leafly shoppers place real pickup orders. You have 15 minutes to " +
                "acknowledge each order before Leafly cancels it automatically, so only " +
                "turn this on when staff are ready. Only in-stock items are offered, and " +
                "DOH High-THC products are never offered (they are card-only by law)."
              }
              defaultChecked={lf.sendPickupAvailability}
            />
          ) : null}
          {!isLeafly ? (
            <Toggle
              name="unpublishWhenOutOfStock"
              label="Hide out-of-stock items"
              help="Unpublish (never delete) out-of-stock items so Weedmaps-side curation survives restocks. Off = keep them visible."
              defaultChecked={wm.unpublishWhenOutOfStock}
            />
          ) : null}
          <Toggle
            name="forceResend"
            label="Resend everything next sync"
            help="One-shot: skips the 'no changes' optimization for the next sync, then clears itself automatically."
            defaultChecked={settings.forceResend}
          />
        </div>

        {/*
          TASK H (finding L-22) — the owner's low-stock rule.

          Deliberately its own block rather than another toggle in the grid
          above. Every control in that grid changes what DETAIL is sent about a
          product; this one can decide that a product the shop is genuinely
          selling does not appear at all. That is a different kind of decision
          and it should not be one checkbox among eight.

          It is Leafly-only because it is implemented by changing what we send
          to Leafly. Weedmaps has its own `unpublishWhenOutOfStock` behaviour.
        */}
        {isLeafly ? (
          <div className="rounded-lg border border-[var(--admin-border)] p-3">
            <p className="text-sm font-medium">Low-stock protection</p>
            <p className="mt-1 text-xs text-[var(--admin-muted)]">
              Stops your Leafly menu promising the last one or two of something. A shopper
              who drives over for a specific product and finds it gone is the problem this
              solves. Leafly has this feature too, but only inside their own settings
              screen — their API cannot be told about it, so we do it here instead, where
              it can also work size-by-size rather than hiding the whole product.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="What to do when stock is low"
                htmlFor="leafly-visibility-mode"
                help={describeMenuVisibilityMode(lf.visibility.mode)}
              >
                <Select
                  id="leafly-visibility-mode"
                  name="visibilityMode"
                  defaultValue={lf.visibility.mode}
                >
                  <option value="off">Off — list anything with at least 1 in stock</option>
                  <option value="not_orderable">
                    Show it, but don&apos;t let them reserve it (recommended)
                  </option>
                  <option value="withhold">Hold it back off the menu completely</option>
                </Select>
              </Field>

              <Field
                label="Keep back anything with fewer than…"
                htmlFor="leafly-visibility-min"
                help={
                  `Counted per size, not per product. ${MENU_VISIBILITY_RECOMMENDED_THRESHOLD} is a ` +
                  `sensible starting point. 0 or 1 means the rule does nothing, because ` +
                  `sold-out items are already left off. Leafly stops counting above ` +
                  `${MENU_VISIBILITY_MAX_THRESHOLD}, so that is the highest this can go.`
                }
              >
                <Input
                  id="leafly-visibility-min"
                  name="visibilityMinimumStock"
                  type="number"
                  min={0}
                  max={MENU_VISIBILITY_MAX_THRESHOLD}
                  step={1}
                  defaultValue={lf.visibility.minimumStock}
                />
              </Field>
            </div>

            {/*
              The PUT trap, rendered from the same function the tests pin. A
              safety feature that quietly does nothing is worse than none: it
              manufactures exactly the false confidence the owner is buying.
            */}
            {!withholdEffectiveness(lf.visibility, lf.syncMode).effective ? (
              <p className="mt-3 rounded border border-[var(--admin-danger)] p-2 text-xs text-[var(--admin-danger)]">
                {withholdEffectiveness(lf.visibility, lf.syncMode).warning}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="save" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save parameters"}
          </Button>

          {!resetArmed ? (
            <Button type="button" variant="neutral" size="sm" onClick={() => setResetArmed(true)} disabled={pending}>
              Reset sync memory…
            </Button>
          ) : (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-[var(--admin-danger)]">
                Forget what was already synced? The next sync resends every item.
              </span>
              <Button type="button" variant="danger" size="sm" onClick={doReset} disabled={pending}>
                Yes, reset
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => setResetArmed(false)} disabled={pending}>
                Cancel
              </Button>
            </span>
          )}
        </div>
      </form>

      {msg ? (
        <p className={`mt-3 text-xs ${msgOk ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>
          {msg}
        </p>
      ) : null}
    </Card>
  );
}
