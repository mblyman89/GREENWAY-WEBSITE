/**
 * /admin/registers/ipad-setup — iPad register setup, lockdown and health
 * (D142–D150).
 *
 * Owner, 2026-11-03 (verbatim excerpt): "Add it to the back office, a
 * checklist or todo list or some enterprise grade method for making this
 * simple, that we can use to make sure the settings are correct. Add to this
 * how I can pin the app so nothing else can open, so it can't be closed. ...
 * add settings and task lists to the back office register activity screen the
 * ability to set the correct settings and such to make the iPad behavior set
 * in stone and something only I can undo."
 *
 * Owner, 2026-11-03 (second message): "Can you add into this slices work a
 * way for me to see or validate in some way I am on the latest version for my
 * iPad registers?"
 *
 * Owner, 2026-11-04 (D161): "please now build for me something that allows
 * my employees to unlock the ipad registers in offline mode." The offline
 * unlock policy, the reset, and a per-iPad "Offline unlock" health line live
 * here too.
 *
 * Viewing: staffing.manage (same as POS devices). Saving: registers.lockdown
 * (owner only). Every write is audited. No migration: site_settings rows.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Button, Card } from "@/components/admin/ui";
import { IpadDeviceChecklist, LockdownPolicyEditor, type IpadSetupDevice } from "@/components/admin/registers/IpadSetupPanel";
import { listPosDevices } from "@/lib/pos/device-store";
import { listRegisters } from "@/lib/registers/store";
import { getIpadChecklistState, getIpadLockdownPolicy, listDeviceHealth } from "@/lib/pos/ipad-setup-store";
import { checklistProgress, deviceHealthVerdict } from "@/lib/pos/ipad-setup-core";
import { sanitizeFingerprint, shortFingerprint } from "@/lib/pos/register-fingerprint-core";
import { OfflineUnlockPolicyEditor } from "@/components/admin/registers/OfflineUnlockPolicyEditor";
import { getOfflinePolicy, offlineUnlockConfigured } from "@/lib/pos/offline-unlock-store";

export const dynamic = "force-dynamic";

const REBUILD_COMMAND = 'REGISTER_API_BASE="https://greenwaywebsite1.vercel.app" npm run register:build:ios';

function pacific(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function IpadSetupPage() {
  const session = await requirePermission("staffing.manage");
  const canEdit = can(session.profile.role, "registers.lockdown");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="iPad setup & lockdown" subtitle="Pin the register app, check every setting, prove each iPad is current." />
        <EmptyState title="Supabase not configured" description="Connect the database to use the iPad setup checklist." />
      </div>
    );
  }

  const [devicesRes, registers, health, policy, checklist, offlinePolicy] = await Promise.all([
    listPosDevices(),
    listRegisters({ includeInactive: true }),
    listDeviceHealth(),
    getIpadLockdownPolicy(),
    getIpadChecklistState(),
    getOfflinePolicy(),
  ]);
  const serverFingerprint = sanitizeFingerprint(process.env.REGISTER_FINGERPRINT);
  const registerName = new Map(registers.map((r) => [r.id, r.name]));
  // eslint-disable-next-line react-hooks/purity -- server component; one timestamp per request
  const nowMs = Date.now();

  const devices: IpadSetupDevice[] = devicesRes.ok
    ? devicesRes.devices
        .filter((d) => d.status === "active")
        .map((d) => {
          const report = health[d.id.toLowerCase()] ?? null;
          const verdict = deviceHealthVerdict({
            status: d.status,
            lastSeenAt: d.last_seen_at,
            report,
            serverFingerprint,
            policy,
            nowMs,
            offlinePolicy,
          });
          const marks = checklist[d.id.toLowerCase()] ?? {};
          return {
            id: d.id,
            name: d.name,
            registerName: d.register_id ? registerName.get(d.register_id) ?? null : null,
            status: d.status,
            lastSeenLabel: pacific(d.last_seen_at),
            verdict,
            marks,
            progress: checklistProgress(marks, verdict.verified),
            appFingerprintShort: report?.fingerprint ? shortFingerprint(report.fingerprint) : null,
            reportedLabel: report?.reportedAt ? pacific(report.reportedAt) : null,
          };
        })
    : [];
  const outdated = devices.filter((d) => d.verdict.version === "outdated" || d.verdict.verified.versionCurrent === false).length;
  const stale = devices.filter((d) => d.verdict.stale).length;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Registers", href: "/admin/registers" }, { label: "iPad setup" }]} />
      <AdminPageHeader
        title="iPad setup & lockdown"
        subtitle="Pin the register app so nothing else opens, check every iPad setting, and prove each iPad runs the newest version."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <Card>
          <div className="space-y-2" data-testid="ipad-version-summary">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Newest register version on the server</p>
            <p className="font-mono text-2xl font-bold tracking-wider text-[var(--admin-text)]">
              {serverFingerprint ? shortFingerprint(serverFingerprint) : "unavailable"}
            </p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Every iPad build carries a fingerprint of the register code it was built from. The iPad compares it to this
              one and shows a bold banner on its lock screen: <strong>green &ldquo;NEWEST VERSION — ALL GOOD&rdquo;</strong> or{" "}
              <strong>red &ldquo;NOT THE NEWEST VERSION — REBUILD THIS IPAD&rdquo;</strong>. No banner, or a grey &ldquo;cannot
              verify&rdquo; banner, means the iPad still runs a build from before this check existed: rebuild it.
            </p>
            <p className="text-sm">
              {outdated > 0 ? (
                <span className="font-bold text-[var(--admin-danger)]">{outdated} iPad(s) need a rebuild.</span>
              ) : devices.length > 0 && devices.every((d) => d.verdict.version === "current") ? (
                <span className="font-bold text-[var(--admin-accent)]">Every active iPad is on the newest version.</span>
              ) : (
                <span className="font-semibold text-[var(--admin-gold)]">Some iPads have not reported a version yet (older build). Rebuild them.</span>
              )}
              {stale > 0 ? <span className="ml-2 font-bold text-[var(--admin-danger)]">{stale} stale device(s): revoke on POS devices.</span> : null}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button href="/admin/registers/devices" variant="neutral" size="sm">
                POS devices
              </Button>
            </div>
          </div>
        </Card>

        <HelpPanel
          id="pos-ipad-rebuild"
          title="How to rebuild an iPad so it is really on the newest version"
          steps={[
            "On the Mac, get the newest code: in the repo folder run  git pull  (or download the repo again).",
            "In Terminal, in that folder:  npm ci",
            `Then:  ${REBUILD_COMMAND}  — it prints \"This build will be <fingerprint>\". That fingerprint must match the one at the top of this page.`,
            "Open ios/App/App.xcworkspace in Xcode, plug in the iPad, choose it as the run destination, press Run (▶).",
            "Repeat for the second iPad (Run again with the other iPad selected).",
            "On each iPad, the lock screen must show the GREEN banner \"NEWEST VERSION — ALL GOOD\". Red or grey = a step was missed; the most common miss is building in Xcode without running the npm command first.",
          ]}
        />

        <HelpPanel
          id="pos-ipad-guided-access"
          title="Pin the app so nothing else can open and it cannot be closed (Guided Access)"
          steps={[
            "Settings → Accessibility → Guided Access → ON. Turn ON Accessibility Shortcut.",
            "Passcode Settings → Set Guided Access Passcode: a code only you know, different from the iPad passcode and staff PINs. Face ID / Touch ID for ending: OFF.",
            "Display Auto-Lock (inside Guided Access settings) → Never.",
            "Open the register app, triple-click the top button, Options: Sleep/Wake OFF, Volume OFF, Touch ON, Keyboards ON, Time Limit OFF → Start.",
            "Now swiping home, Control Center, notifications and other apps are blocked. Only a triple-click plus YOUR passcode ends it.",
            "For stronger lockdown, Screen Time → Content & Privacy Restrictions (with a Screen Time passcode only you know) blocks deleting or installing apps.",
          ]}
        />

        <Card>
          <h2 className="mb-3 text-base font-semibold text-[var(--admin-text)]">Lockdown policy (owner only)</h2>
          <LockdownPolicyEditor initial={policy} canEdit={canEdit} />
        </Card>

        <HelpPanel
          id="pos-ipad-offline-unlock"
          title="Unlock the register when the internet is down (offline PIN unlock)"
          steps={[
            "While the internet works, every employee who uses an iPad unlocks it ONCE with their PIN. That sets them up for offline on that iPad. Repeat on the other iPad.",
            "The lock screen then shows \"Offline unlock ready: N people\". The iPad card below shows the same thing, plus how many managers can approve offline.",
            "If the internet drops (or the server is slow or down), type your PIN as usual. The iPad checks it itself and says \"Unlocked OFFLINE\". Sales save on the iPad and send when the internet returns.",
            "A wrong PIN is refused. Five wrong PINs pause the pad (30 seconds, then longer). 25 wrong PINs in a row erase the offline copies on that iPad.",
            "Fired employees and changed PINs drop off the iPad automatically at its next check-in. Every offline unlock, approval and clock punch is recorded and re-checked when it syncs; anything doubtful shows up as an exception.",
            "Counting a NEW drawer in still needs the internet (the cash count is verified by the server). Keep ringing on the drawer that is already open.",
          ]}
        />

        <Card>
          <h2 className="mb-3 text-base font-semibold text-[var(--admin-text)]">Offline PIN unlock (owner only)</h2>
          <OfflineUnlockPolicyEditor initial={offlinePolicy} canEdit={canEdit} configured={offlineUnlockConfigured()} />
        </Card>

        {!devicesRes.ok ? (
          <EmptyState title="Devices unavailable" description={devicesRes.error} />
        ) : devices.length === 0 ? (
          <EmptyState title="No active iPads" description="Pair an iPad on POS devices first." />
        ) : (
          devices.map((d) => (
            <Card key={d.id}>
              <IpadDeviceChecklist device={d} canEdit={canEdit} />
            </Card>
          ))
        )}

        <p className="text-xs text-[var(--admin-text-faint)]">
          Offline: unlocking, clocking in or out, ringing sales and manager approvals keep working on an iPad where each
          person has unlocked online once (D161). Counting a new drawer in, voids, returns, employee purchases and the day report still need
          the internet, because the server must check them at the moment they happen.
        </p>
      </div>
    </div>
  );
}
