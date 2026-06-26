import type { Metadata } from "next";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Secure Checkout | Greenway Marijuana",
  description: "Review your order and place a pickup order at Greenway Marijuana in Port Orchard, WA.",
};

export default function CheckoutPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout" }]} />
      <CheckoutFlow />
      <Footer />
    </main>
  );
}
