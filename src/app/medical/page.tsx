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

// SLICE 107: the page reads a CMS visibility flag at request time, so it must
// not be statically cached — otherwise hiding the page wouldn't take effect
// until a redeploy.
export const dynamic = "force-dynamic";

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
