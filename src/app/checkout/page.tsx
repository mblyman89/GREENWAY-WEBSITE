import type { Metadata } from "next";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Checkout Preview | Greenway Marijuana",
  description: "Non-live checkout preview for Greenway Marijuana mock cart and Leafly order-readiness planning.",
};

export default function CheckoutPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout" }]} />
      <CheckoutPreview />
      <Footer />
    </main>
  );
}
