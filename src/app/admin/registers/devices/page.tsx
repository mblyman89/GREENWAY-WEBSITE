/**
 * /admin/registers/devices — POS device provisioning (Slice B5).
 *
 * Managers provision the counter iPads here: mint a device credential (key
 * shown once, scrypt hash stored), bind it to a register, rotate or revoke.
 * The register app (/pos) authenticates every request with this credential;
 * humans then identify per-action by clock PIN on the device.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Badge, Button, Card, Select } from "@/components/admin/ui";
import { listPosDevices } from "@/lib/pos/device-store";
import { listRegisters } from "@/lib/registers/store";
import { ProvisionForm, RotateKeyForm } from "./DeviceManager";
import { bindDeviceAction, revokeDeviceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PosDevicesPage() {
  await requirePermission("staffing.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="POS devices" subtitle="Provision the register iPads." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the service role key to manage POS devices."
        />
      </div>
    );
  }

  const [devicesResult, registers] = await Promise.all([listPosDevices(), listRegisters()]);
  const registerName = new Map(registers.map((r) => [r.id, r.name]));

  return (
    <div>
      <AdminPageHeader
        title="POS devices"
        subtitle="Provision, bind, rotate, and revoke the register iPads."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Register Activity", href: "/admin/registers" }, { label: "POS devices" }]}
          />
        }
        action={
          <Button href="/admin/registers" variant="neutral" size="sm">
            Back to Register Activity
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-devices"
          title="How device provisioning works"
          steps={[
            "Provisioning mints a device id + key. The key is shown ONCE and only its hash is stored — like employee PINs.",
            "On the iPad, open /pos and enter both values in the setup screen. The device then syncs sales, punches, and audits.",
            "PINs identify people; the device key identifies the iPad. Both are required for every register action.",
            "Revoking (or rotating) a key cuts the device off on its very next request.",
          ]}
        />

        {!devicesResult.ok ? (
          <Card>
            <p className="text-sm text-amber-300">{devicesResult.error}</p>
            {devicesResult.migrationMissing ? (
              <p className="mt-2 text-sm text-[var(--admin-text-dim)]">
                Apply migration <span className="font-mono">0120_pos_foundation.sql</span> in the
                Supabase SQL editor, then reload this page.
              </p>
            ) : null}
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-base font-semibold text-white">Provision a new device</h2>
              <ProvisionForm registers={registers.map((r) => ({ id: r.id, name: r.name }))} />
            </Card>
            <Card>
              <h2 className="mb-4 text-base font-semibold text-white">
                Provisioned devices ({devicesResult.devices.length})
              </h2>
              {devicesResult.devices.length === 0 ? (
                <p className="text-sm text-[var(--admin-text-dim)]">No devices yet.</p>
              ) : (
                <ul className="space-y-4">
                  {devicesResult.devices.map((d) => (
                    <li key={d.id} className="rounded-xl border border-white/10 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{d.name}</p>
                          <p className="text-xs text-[var(--admin-text-dim)]">
                            {d.register_id
                              ? `Bound to ${registerName.get(d.register_id) ?? "unknown register"}`
                              : "Not bound to a register"}
                            {d.last_synced_at
                              ? ` · last sync ${new Date(d.last_synced_at).toLocaleString("en-US")}`
                              : " · never synced"}
                          </p>
                          <p className="mt-1 select-all font-mono text-[11px] text-[var(--admin-text-dim)]">{d.id}</p>
                        </div>
                        <Badge tone={d.status === "active" ? "green" : "danger"}>{d.status}</Badge>
                      </div>
                      {d.status === "active" ? (
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <form action={bindDeviceAction} className="flex items-end gap-2">
                            <input type="hidden" name="device_id" value={d.id} />
                            <Select name="register_id" defaultValue={d.register_id ?? ""}>
                              <option value="">— unbound —</option>
                              {registers.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </Select>
                            <Button type="submit" variant="neutral" size="sm">
                              Bind
                            </Button>
                          </form>
                          <RotateKeyForm deviceId={d.id} />
                          <form action={revokeDeviceAction}>
                            <input type="hidden" name="device_id" value={d.id} />
                            <Button type="submit" variant="danger" size="sm">
                              Revoke
                            </Button>
                          </form>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
