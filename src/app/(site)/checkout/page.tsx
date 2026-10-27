import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";

export const metadata = pageMetadata({
  title: "Secure Checkout",
  description: "Review your order and place a pickup order at Greenway Marijuana in Port Orchard, WA.",
  path: "/checkout",
  noindex: true,
});

// Discount transparency — the owner's ONLINE discount-detail settings
// (receipt builder) decide what the savings breakdown shows. Read on the
// server, refreshed at most every 60 s (and on save via revalidatePath);
// only the display switches reach the browser.
export const revalidate = 60;

export default async function CheckoutPage() {
  const discountDisplay = (await getPosReceiptConfig()).onlineDiscount;
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Checkout" }]} />
      <CheckoutFlow discountDisplay={discountDisplay} />
      <Footer />
    </main>
  );
}
