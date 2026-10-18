"use client";

/**
 * DeviceManager (POS Slice B5) — provision, rotate, revoke, and bind the
 * register iPads. The freshly-minted device key is shown ONCE (it is never
 * stored in plaintext); the manager types it into the iPad's setup screen.
 */
import { useActionState, useState } from "react";
import { Button, Field, Input, Select } from "@/components/admin/ui";
import {
  provisionDeviceAction,
  rotateDeviceKeyAction,
  revokeDeviceAction,
  renameDeviceAction,
  reactivateDeviceAction,
  type ProvisionActionResult,
  type SimpleActionResult,
} from "./actions";
import { DEVICE_NAME_MAX, DEVICE_NAME_MIN, REVOKE_CONFIRM_WORD } from "@/lib/pos/device-pairing-core";

export function ProvisionForm({ registers }: { registers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<ProvisionActionResult | null, FormData>(
    provisionDeviceAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Device name" help='e.g. "Register 1 iPad"'>
        <Input name="name" required minLength={DEVICE_NAME_MIN} maxLength={DEVICE_NAME_MAX} placeholder="Register 1 iPad" />
      </Field>
      <Field label="Bind to register" help="Which till this iPad rings sales for.">
        <Select name="register_id" defaultValue="">
          <option value="">— not bound yet —</option>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes (optional)">
        <Input name="notes" placeholder="Serial, case color, anything helpful" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Provisioning…" : "Provision device"}
      </Button>
      {state && !state.ok ? (
        <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{state.error}</p>
      ) : null}
      {state && state.ok ? <OneTimeKey deviceId={state.deviceId} deviceKey={state.deviceKey} /> : null}
    </form>
  );
}

/**
 * Revoke with a typed confirmation (register rotation slice). The first click
 * only reveals the confirm box; the server re-checks the typed word, so a
 * stray click can never take a live till out of service.
 */
export function RevokeDeviceForm({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SimpleActionResult | null, FormData>(
    revokeDeviceAction,
    null,
  );
  if (!open) {
    return (
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        Revoke…
      </Button>
    );
  }
  return (
    <form action={formAction} className="w-full space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
      <input type="hidden" name="device_id" value={deviceId} />
      <p className="text-xs text-red-200">
        Revoking <span className="font-semibold">{deviceName}</span> stops it ringing sales immediately. The iPad
        will show a re-pair screen. Any sales still waiting on it can only sync if you later choose
        &ldquo;Reactivate with new key&rdquo; on this same row. Type <span className="font-mono">{REVOKE_CONFIRM_WORD}</span> to confirm.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="confirm" autoComplete="off" placeholder={REVOKE_CONFIRM_WORD} className="max-w-[10rem]" />
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Revoking…" : "Revoke device"}
        </Button>
        <Button type="button" variant="neutral" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state && !state.ok ? <p className="text-xs text-red-300">{state.error}</p> : null}
      {state && state.ok ? <p className="text-xs text-emerald-300">{state.message}</p> : null}
    </form>
  );
}

/** Rename a device (active or revoked). */
export function RenameDeviceForm({ deviceId, currentName }: { deviceId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SimpleActionResult | null, FormData>(
    renameDeviceAction,
    null,
  );
  if (!open) {
    return (
      <Button type="button" variant="neutral" size="sm" onClick={() => setOpen(true)}>
        Rename
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="device_id" value={deviceId} />
      <Input
        name="name"
        defaultValue={currentName}
        required
        minLength={DEVICE_NAME_MIN}
        maxLength={DEVICE_NAME_MAX}
        className="max-w-[14rem]"
      />
      <Button type="submit" variant="neutral" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
      <Button type="button" variant="neutral" size="sm" onClick={() => setOpen(false)}>
        Close
      </Button>
      {state && !state.ok ? <p className="w-full text-xs text-red-300">{state.error}</p> : null}
      {state && state.ok ? <p className="w-full text-xs text-emerald-300">{state.message}</p> : null}
    </form>
  );
}

/**
 * The device's KEY control — "Rotate key" on an active row, "Reactivate with
 * new key" on a revoked row (register rotation slice).
 *
 * ONE component for both on purpose: reactivating flips the row to active,
 * and the page re-renders. If these were two components swapped by status,
 * the reactivate form would unmount in that re-render and the one-time key
 * would vanish before the manager could copy it. Kept mounted at the same
 * spot in the row, its result (and the key) survives the status change.
 */
export function DeviceKeyForm({ deviceId, status }: { deviceId: string; status: string }) {
  const [rotateState, rotateAction, rotating] = useActionState<ProvisionActionResult | null, FormData>(
    rotateDeviceKeyAction,
    null,
  );
  const [reactState, reactAction, reactivating] = useActionState<ProvisionActionResult | null, FormData>(
    reactivateDeviceAction,
    null,
  );
  const shown = reactState?.ok ? reactState : rotateState?.ok ? rotateState : null;
  const error = (reactState && !reactState.ok ? reactState.error : null) ?? (rotateState && !rotateState.ok ? rotateState.error : null);
  return (
    <div className="space-y-2">
      {status === "active" ? (
        <form action={rotateAction}>
          <input type="hidden" name="device_id" value={deviceId} />
          <Button type="submit" variant="neutral" size="sm" disabled={rotating}>
            {rotating ? "Rotating…" : "Rotate key"}
          </Button>
        </form>
      ) : status === "revoked" ? (
        <form action={reactAction}>
          <input type="hidden" name="device_id" value={deviceId} />
          <Button type="submit" variant="confirm" size="sm" disabled={reactivating}>
            {reactivating ? "Reactivating…" : "Reactivate with new key"}
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {shown && shown.ok ? <OneTimeKey deviceId={shown.deviceId} deviceKey={shown.deviceKey} /> : null}
    </div>
  );
}

function OneTimeKey({ deviceId, deviceKey }: { deviceId: string; deviceKey: string }) {
  return (
    <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/40 p-4 text-sm">
      <p className="font-semibold text-emerald-300">
        Enter these on the iPad now — the key is shown ONCE and cannot be retrieved later.
      </p>
      <dl className="mt-3 space-y-2 font-mono text-xs">
        <div>
          <dt className="text-emerald-400/80">Device id</dt>
          <dd className="select-all break-all text-emerald-100">{deviceId}</dd>
        </div>
        <div>
          <dt className="text-emerald-400/80">Device key</dt>
          <dd className="select-all break-all text-emerald-100">{deviceKey}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-emerald-400/80">
        On the iPad, a manager taps <span className="font-semibold">Re-pair this register</span> (or the
        first-time setup screen appears) and pastes both values. If the key is lost, rotate it here — the
        old key stops working immediately.
      </p>
    </div>
  );
}
