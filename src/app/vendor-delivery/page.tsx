import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { VendorDirectory } from "@/components/vendors/VendorDirectory";

export const metadata: Metadata = {
  title: "Vendors & Partners | Greenway Marijuana",
  description:
    "Meet the licensed Washington cannabis producers and processors stocking Greenway Marijuana shelves in Port Orchard — and learn how to become a vendor partner.",
};

export default function VendorDeliveryPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Vendors & Partners" }]} />
      <VendorDirectory />
      <Footer />
    </main>
  );
}
