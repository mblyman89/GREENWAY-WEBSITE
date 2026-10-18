import type { Metadata } from "next";
import { PageShell } from "@/components/ui";
import { PolicyContact } from "@/components/PolicyContact";

export const metadata: Metadata = { title: "Returns & Refunds", alternates: { canonical: "/returns" } };

export default function ReturnsPage() {
  return (
    <PageShell eyebrow="Policies" title="Returns & Refunds">
      <p>Because every item is made to order just for you, we can&rsquo;t accept returns or exchanges for a change of mind or a size that doesn&rsquo;t fit. Please check the size details on each product before ordering.</p>
      <h2>Damaged, defective or wrong item</h2>
      <p>If your order arrives damaged, misprinted, defective, or is not what you ordered, contact us within <strong>30 days of delivery</strong> with your order number and a photo of the problem. We will send a free replacement or give you a full refund for that item - your choice.</p>
      <h2>Lost in transit</h2>
      <p>If tracking shows your package as lost, contact us within 30 days of the estimated delivery date and we will make it right.</p>
      <h2>Canceling an order</h2>
      <p>Production usually starts quickly. If you need to cancel, contact us right away - if your order hasn&rsquo;t gone into production we will cancel it and refund you in full.</p>
      <h2>How refunds are paid</h2>
      <p>Approved refunds go back to the original payment method. Your bank may take 5-10 business days to show it.</p>
      <h2>Contact</h2>
      <PolicyContact />
    </PageShell>
  );
}
