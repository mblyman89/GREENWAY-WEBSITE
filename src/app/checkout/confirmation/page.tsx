import type { Metadata } from "next";
import { CheckoutConfirmationPreview } from "@/components/checkout/CheckoutConfirmationPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Confirmation Preview | Greenway Marijuana",
  description: "Non-live Greenway Marijuana checkout confirmation preview for Leafly order-readiness planning.",
};

export default function CheckoutConfirmationPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout", href: "/checkout" }, { label: "Confirmation" }]} />
      <CheckoutConfirmationPreview />
      <Footer />
    </main>
  );
}
