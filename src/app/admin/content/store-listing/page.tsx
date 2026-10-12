import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { backHref } from "@/lib/admin/back-link-core";
import { getStoreHoursForEdit } from "@/lib/seo/store-hours-server";
import { StoreHoursEditor } from "@/components/admin/StoreHoursEditor";
import { saveStoreHoursAction } from "./actions";

export const dynamic = "force-dynamic";

/** R47 — Google store listing: the opening hours Google reads from the site. */
export default async function StoreListingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; back?: string }>;
}) {
  await requirePermission("content.edit");
  const { saved, error, back } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Google Store Listing" />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once setup is finished, you can edit store hours here.
        </div>
      </div>
    );
  }

  const hours = await getStoreHoursForEdit();

  return (
    <div>
      <AdminPageHeader
        title="Google Store Listing"
        subtitle="The opening hours (including holidays) that Google and other search engines read from your website."
        action={<Button href={backHref("/admin/content/seo", back)} variant="neutral">← SEO Editor</Button>}
        help={
          <HelpPanel
            id="store-listing"
            title="How store hours reach Google"
            steps={[
              "Set your regular hours for each day. Tick “Midnight” if you stay open until 12 AM.",
              "Add holiday or special hours (for example Thanksgiving closed, or Christmas Eve 8 AM – 6 PM).",
              "Save. Every page of the site updates its hidden store information for Google right away.",
              "Also update the same hours in your Google Business Profile — Google treats that as the main source for Maps.",
            ]}
          >
            <p className="mb-2">
              This page controls the hidden “structured data” Google reads from your website. It does not change the
              hours text people see in the footer or on the Locations page — that wording is edited in{" "}
              <a className="underline" href="/admin/header-footer">Header &amp; Footer</a> (the business hours text).
              Please keep them matching.
            </p>
            <p>
              To check: open Google&apos;s Rich Results Test, enter your Locations page address, and look for the
              “Local business” result with your hours.
            </p>
          </HelpPanel>
        }
      />
      <div className="space-y-4 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Store hours saved.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">
            Couldn&apos;t save the hours. Please try again.
          </div>
        )}
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-2 text-xs text-[var(--admin-gold)]">
          Reminder: the hours text customers see in the footer and on the Locations page is separate wording (Header
          &amp; Footer). Also update your Google Business Profile in Google.
        </div>
        <StoreHoursEditor initial={hours} saveAction={saveStoreHoursAction} />
      </div>
    </div>
  );
}
