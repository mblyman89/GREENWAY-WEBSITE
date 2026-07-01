import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listCredentialsForUser } from "@/lib/auth/webauthn-store";
import { PasskeyManager } from "@/components/admin/security/PasskeyManager";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  // Any signed-in staffer can manage THEIR OWN passkeys (not gated by a
  // specific permission — it's personal account security).
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");

  const passkeys = await listCredentialsForUser(session.userId);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Settings", href: "/admin/settings" },
          { label: "Security & passkeys" },
        ]}
      />
      <AdminPageHeader
        title="Security & passkeys"
        subtitle="Add Face ID, Touch ID, or Windows Hello so you can sign in without typing your password."
      />

      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
        <h2 className="mb-1 text-sm font-semibold text-white">Biometric sign-in</h2>
        <p className="mb-4 text-sm text-white/50">
          A passkey is tied to this device&apos;s biometrics. Registering one lets you tap{" "}
          <span className="text-[#7ed957]">Sign in with Face ID / Touch ID</span> on the login
          screen. Your email &amp; password keep working as a backup, and passkeys never leave the
          device (only a public key is stored on the server).
        </p>
        <PasskeyManager passkeys={passkeys} />
      </div>
    </div>
  );
}
