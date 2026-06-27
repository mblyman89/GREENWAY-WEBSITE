import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getVendorById, listBrandsForVendor, publicMediaUrl } from "@/lib/vendors/store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Brand } from "@/lib/vendors/types";
import { updateVendor, setVendorStatus, updateBrand } from "../actions";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const label = "text-xs font-medium text-white/60";

async function logoUrlForMediaId(mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("storage_key").eq("id", mediaId).maybeSingle();
  return publicMediaUrl((data as { storage_key: string } | null)?.storage_key ?? null);
}

export default async function VendorEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { id } = await params;
  const sp = await searchParams;

  const vendor = await getVendorById(id);
  if (!vendor) notFound();
  const [brands, vendorLogo] = await Promise.all([
    listBrandsForVendor(id),
    logoUrlForMediaId(vendor.logo_media_id),
  ]);

  const brandLogos = new Map<string, string | null>();
  for (const b of brands) brandLogos.set(b.id, await logoUrlForMediaId(b.logo_media_id));

  return (
    <div>
      <AdminPageHeader
        title={vendor.display_name}
        subtitle={`${vendor.brand_count} brands · ${vendor.product_count} products · ${vendor.status}`}
        action={
          <Link href="/admin/vendors" className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[#7ed957] hover:text-white">
            ← All vendors
          </Link>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">Saved.</div>
        )}

        {/* Publish toggle */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Status: <span className={vendor.status === "published" ? "text-[#7ed957]" : "text-[#ff7f00]"}>{vendor.status}</span></h2>
            <p className="text-xs text-white/40">Published vendors appear on the public vendors page.</p>
          </div>
          <form action={setVendorStatus}>
            <input type="hidden" name="id" value={vendor.id} />
            <input type="hidden" name="status" value={vendor.status === "published" ? "draft" : "published"} />
            <button type="submit" className={`rounded-full px-5 py-2 text-sm font-bold transition hover:brightness-110 ${vendor.status === "published" ? "border border-white/20 text-white" : "bg-[#7ed957] text-black"}`}>
              {vendor.status === "published" ? "Unpublish" : "Publish vendor"}
            </button>
          </form>
        </section>

        {/* Profile form */}
        <form action={updateVendor} className="space-y-5 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <input type="hidden" name="id" value={vendor.id} />
          <h2 className="text-sm font-semibold text-white">Vendor profile</h2>

          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
              {vendorLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vendorLogo} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xl font-bold text-white/30">{vendor.display_name.charAt(0)}</span>
              )}
            </div>
            <label className="flex flex-col gap-1">
              <span className={label}>Logo (PNG/JPG/WEBP/SVG, max 5MB)</span>
              <input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[#7ed957] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className={label}>Display name</span><input name="display_name" defaultValue={vendor.display_name} className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Legal name</span><input name="legal_name" defaultValue={vendor.legal_name ?? ""} className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Website</span><input name="website" defaultValue={vendor.website ?? ""} placeholder="https://" className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Email</span><input name="email" defaultValue={vendor.email ?? ""} className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Phone</span><input name="phone" defaultValue={vendor.phone ?? ""} className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Instagram</span><input name="instagram" defaultValue={vendor.social_json?.instagram ?? ""} placeholder="@handle or URL" className={field} /></label>
            <label className="flex flex-col gap-1"><span className={label}>Facebook</span><input name="facebook" defaultValue={vendor.social_json?.facebook ?? ""} className={field} /></label>
          </div>

          <label className="flex flex-col gap-1"><span className={label}>Mission statement</span><textarea name="mission_statement" defaultValue={vendor.mission_statement ?? ""} rows={2} className={field} /></label>
          <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={vendor.about ?? ""} rows={4} className={field} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Vendor-day notes (internal)</span><input name="vendor_day_notes" defaultValue={vendor.vendor_day_notes ?? ""} className={field} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Internal notes (never public)</span><textarea name="internal_notes" defaultValue={vendor.internal_notes ?? ""} rows={2} className={field} /></label>

          <button type="submit" className="rounded-full bg-[#ff7f00] px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">Save profile</button>
        </form>

        {/* Brands */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Brands ({brands.length})</h2>
          {brands.map((b: Brand) => (
            <form key={b.id} id={`brand-${b.id}`} action={updateBrand} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="vendorId" value={vendor.id} />
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                  {brandLogos.get(b.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={brandLogos.get(b.id)!} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-sm font-bold text-white/30">{b.display_name.charAt(0)}</span>
                  )}
                </div>
                <div className="flex-1">
                  <input name="display_name" defaultValue={b.display_name} className={`${field} w-full font-semibold`} />
                </div>
                <select name="status" defaultValue={b.status} className={field}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className={label}>Website</span><input name="website" defaultValue={b.website ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Brand logo</span><input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[#7ed957] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} /></label>
              </div>
              <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={b.about ?? ""} rows={2} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Product philosophy</span><textarea name="product_philosophy" defaultValue={b.product_philosophy ?? ""} rows={2} className={field} /></label>
              <button type="submit" className="rounded-full border border-white/20 px-5 py-2 text-sm font-bold text-white transition hover:border-[#7ed957]">Save brand</button>
            </form>
          ))}
          {brands.length === 0 && <p className="text-sm text-white/50">No brands linked to this vendor.</p>}
        </section>
      </div>
    </div>
  );
}
