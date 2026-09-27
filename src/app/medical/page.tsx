import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { MedicalProgramContent } from "@/components/medical/MedicalProgramContent";
import { getContentForRender } from "@/lib/cms/render-content";
import {
  MEDICAL_HIDE_BLOCK,
  isMedicalPageHidden,
} from "@/lib/medical/medical-content-core";
import { pageMetadata } from "@/lib/seo/seo";

// SLICE 107: the page reads a CMS visibility flag, so it must not be frozen at
// build time — otherwise hiding the page wouldn't take effect until a redeploy.
//
// USAGE-5: that requirement is met by `revalidate = 60`, not by `force-dynamic`.
// Measured on production 2026-09-27: every /medical hit was `x-vercel-cache:
// MISS`, re-reading content_blocks (this flag + header + footer blocks) for a
// page whose body is static copy. The hide flag is published through
// src/app/admin/medical-page/actions.ts, which calls revalidatePath("/medical")
// and revalidatePath("/", "layout"), so hiding still takes effect on the next
// non-preview load; 60 s is only the floor for anything that bypasses that
// path. Draft Mode bypasses the route cache, so staff preview is unaffected.
export const revalidate = 60;

export const metadata = pageMetadata({
  title: "Medical Cannabis Program — Cards, Tax Savings & Limits",
  description:
    "Greenway Marijuana in Port Orchard is a medically endorsed cannabis retailer. Learn how to get your DOH recognition card in store, which taxes are waived on compliant products, and the elevated medical purchase limits.",
  path: "/medical",
});

export default async function MedicalPage() {
  // SLICE 107: when staff hide the Medical page, the public route 404s (the
  // link is already filtered from the nav). Draft-aware + byte-safe: an
  // unseeded / blank / "no" flag keeps the page live.
  const hidden = isMedicalPageHidden(await getContentForRender(MEDICAL_HIDE_BLOCK));
  if (hidden) {
    notFound();
  }

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Medical" }]} />
      <MedicalProgramContent />
      <Footer />
    </main>
  );
}
