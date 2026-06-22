import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { VendorDeliveryPreview } from "@/components/vendors/VendorDeliveryPreview";

export const metadata: Metadata = {
  title: "Vendor Delivery Preview | Greenway Marijuana",
  description:
    "Greenway Marijuana vendor delivery information preview for future licensed vendor coordination and staff review.",
};

export default function VendorDeliveryPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Vendor Delivery" }]} />
      <VendorDeliveryPreview />
      <Footer />
    </main>
  );
}
