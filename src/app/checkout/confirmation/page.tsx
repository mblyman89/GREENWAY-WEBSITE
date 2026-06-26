import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderConfirmation } from "@/components/checkout/OrderConfirmation";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Order Confirmed | Greenway Marijuana",
  description: "Your Greenway Marijuana pickup order is confirmed.",
};

export default function CheckoutConfirmationPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout", href: "/checkout" }, { label: "Confirmation" }]} />
      <Suspense fallback={null}>
        <OrderConfirmation />
      </Suspense>
      <Footer />
    </main>
  );
}
