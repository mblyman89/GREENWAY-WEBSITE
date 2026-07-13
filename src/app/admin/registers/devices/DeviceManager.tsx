"use client";

/**
 * DeviceManager (POS Slice B5) — provision, rotate, revoke, and bind the
 * register iPads. The freshly-minted device key is shown ONCE (it is never
 * stored in plaintext); the manager types it into the iPad's setup screen.
 */
import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/components/admin/ui";
import {
  provisionDeviceAction,
  rotateDeviceKeyAction,
  type ProvisionActionResult,
} from "./actions";

export function ProvisionForm({ registers }: { registers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<ProvisionActionResult | null, FormData>(
    provisionDeviceAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Device name" help='e.g. "Register 1 iPad"'>
        <Input name="name" required minLength={3} placeholder="Register 1 iPad" />
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

export function RotateKeyForm({ deviceId }: { deviceId: string }) {
  const [state, formAction, pending] = useActionState<ProvisionActionResult | null, FormData>(
    rotateDeviceKeyAction,
    null,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="device_id" value={deviceId} />
      <Button type="submit" variant="neutral" size="sm" disabled={pending}>
        {pending ? "Rotating…" : "Rotate key"}
      </Button>
      {state && !state.ok ? <p className="text-xs text-red-300">{state.error}</p> : null}
      {state && state.ok ? <OneTimeKey deviceId={state.deviceId} deviceKey={state.deviceKey} /> : null}
    </form>
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
        On the iPad open <span className="font-mono">/pos</span> and paste both values into the
        setup screen. If the key is lost, rotate it here — the old key stops working immediately.
      </p>
    </div>
  );
}
