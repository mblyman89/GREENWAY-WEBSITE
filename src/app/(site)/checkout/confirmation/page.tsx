import { Suspense } from "react";
import { OrderConfirmation } from "@/components/checkout/OrderConfirmation";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";

export const metadata = pageMetadata({
  title: "Order Confirmed",
  description: "Your Greenway Marijuana pickup order is confirmed.",
  path: "/checkout/confirmation",
  noindex: true,
});

// Discount transparency — the owner's ONLINE discount-detail settings
// (receipt builder) decide what the savings breakdown shows. Read on the
// server, refreshed at most every 60 s (and on save via revalidatePath);
// only the display switches reach the browser.
export const revalidate = 60;

export default async function CheckoutConfirmationPage() {
  const discountDisplay = (await getPosReceiptConfig()).onlineDiscount;
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout", href: "/checkout" }, { label: "Confirmation" }]} />
      <Suspense fallback={null}>
        <OrderConfirmation discountDisplay={discountDisplay} />
      </Suspense>
      <Footer />
    </main>
  );
}
