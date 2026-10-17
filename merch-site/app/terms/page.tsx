import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/ui";
import { PolicyContact } from "@/components/PolicyContact";

export const metadata: Metadata = { title: "Terms of Sale" };

export default function TermsPage() {
  return (
    <PageShell eyebrow="Policies" title="Terms of Sale">
      <p>greenwaymerch.com is operated by Greenway Merchandising LLC (dba Greenway Glass & Goods), a United States company. When you place an order you are buying from Greenway Merchandising LLC.</p>
      <h2>Products</h2>
      <p>This store sells apparel and accessories only. It does not sell cannabis or any cannabis product. Colours on screen may vary slightly from the finished item.</p>
      <h2>Prices and payment</h2>
      <p>Prices are in US dollars. Shipping and any applicable sales tax are shown on the checkout page before you pay. Payment is taken by Stripe when you place your order.</p>
      <h2>Orders</h2>
      <p>We may cancel and fully refund an order if an item becomes unavailable or a pricing error occurs. Shipping and returns are covered by our <Link href="/shipping">shipping policy</Link> and <Link href="/returns">returns policy</Link>.</p>
      <h2>Contact</h2>
      <PolicyContact />
    </PageShell>
  );
}
