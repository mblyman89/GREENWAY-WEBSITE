import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { MedicalProgramContent } from "@/components/medical/MedicalProgramContent";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Medical Cannabis Program — Cards, Tax Savings & Limits",
  description:
    "Greenway Marijuana in Port Orchard is a medically endorsed cannabis retailer. Learn how to get your DOH recognition card in store, which taxes are waived on compliant products, and the elevated medical purchase limits.",
  path: "/medical",
});

export default function MedicalPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Medical" }]} />
      <MedicalProgramContent />
      <Footer />
    </main>
  );
}
