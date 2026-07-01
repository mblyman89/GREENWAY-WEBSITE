import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StoreProfileForm } from "@/components/admin/settings/StoreProfileForm";
import { getStoreProfile } from "@/lib/admin/store-profile-store";

export const dynamic = "force-dynamic";

export default async function StoreProfileSettingsPage() {
  await requirePermission("settings.manage");
  const profile = await getStoreProfile();

  return (
    <div>
      <AdminPageHeader
        title="Store profile"
        subtitle="Your store's name, contact details, address, and open hours."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Store profile" }]} />
        }
        help={
          <HelpPanel
            id="store-profile"
            title="About the store profile"
            steps={[
              "This is your store's basic identity — name, contact, address, hours.",
              "Fill in what you know; optional fields can be left blank.",
              "Changes are saved together and recorded in the activity log.",
            ]}
          >
            <p>Only owners and admins can change these settings.</p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <StoreProfileForm profile={profile} />
      </div>
    </div>
  );
}
