import type { Metadata } from "next";
import { PageShell } from "@/components/ui";
import { PolicyContact } from "@/components/PolicyContact";

export const metadata: Metadata = { title: "Shipping Policy", alternates: { canonical: "/shipping" } };

export default function ShippingPage() {
  return (
    <PageShell eyebrow="Policies" title="Shipping">
      <p>Every item is printed or embroidered to order after you pay, then shipped by our production partner (Printful). That is why we can offer every size and colour without waste.</p>
      <h2>Where we ship</h2>
      <p>We currently ship to addresses in <strong>Washington State</strong> only. If an order is placed with a shipping address outside Washington, it is cancelled automatically before your card is charged (the temporary authorization hold is released) and we email you to let you know.</p>
      <h2>Cost and timing</h2>
      <p>The shipping price and the estimated delivery window are shown on the secure checkout page before you pay. Production time is added to the carrier&rsquo;s transit time, so please allow a little extra time for made-to-order items.</p>
      <h2>Tracking</h2>
      <p>As soon as your order ships we email you the carrier and a tracking link. Orders with several items can ship in more than one package.</p>
      <h2>Wrong address or lost packages</h2>
      <p>Please check your shipping address carefully at checkout - we ship to the address you enter. If a package is returned to us because of an incorrect address, we will contact you about reshipping (a new shipping charge may apply). If tracking shows no movement for an unusually long time, contact us and we will open a claim with the carrier.</p>
      <h2>Contact</h2>
      <PolicyContact />
    </PageShell>
  );
}
