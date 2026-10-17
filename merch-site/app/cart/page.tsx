import type { Metadata } from "next";
import { CartView } from "@/components/CartView";
import { Breadcrumbs } from "@/components/ui";

export const metadata: Metadata = { title: "Cart", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <main>
      <Breadcrumbs items={[{ label: "Cart" }]} />
      <section className="mx-auto max-w-[var(--shop-max)] px-3 py-5 sm:px-4 md:px-8 md:py-8">
        <h1 className="mb-5 text-2xl font-black text-white md:text-3xl">Your cart</h1>
        <CartView canceled={sp.canceled === "1"} />
      </section>
    </main>
  );
}
