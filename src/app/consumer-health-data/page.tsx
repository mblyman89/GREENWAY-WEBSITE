import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { consumerHealthDataParagraphs } from "@/content/consumer-health-data";
import { renderPolicyParagraph } from "@/lib/policies/renderPolicyParagraph";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Washington Consumer Health Data Privacy Policy",
  description: "Read the Greenway Marijuana Washington Consumer Health Data Privacy Policy as required under the My Health My Data Act.",
  path: "/consumer-health-data",
});

function isPolicyHeading(text: string) {
  return /^(?:[IVX]+\.|\d+\.|[a-z]\.)\s/.test(text) || text === "IX. Contact Us";
}

export default function ConsumerHealthDataPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Consumer Health Data" }]} />
      <section className="relative overflow-hidden bg-black text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem),radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.09),transparent_22rem),radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.07),transparent_24rem)]" />
        <div className="noise-overlay" />

        <div className="relative mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-16 lg:py-20">
          <h1 className="text-center text-[1.85rem] font-black uppercase leading-[0.98] tracking-tight text-[var(--orange)] sm:text-[2.5rem] md:text-5xl lg:text-[3.4rem] xl:text-[3.9rem]">
            <span className="block whitespace-nowrap">Washington Consumer Health Data</span>
            <span className="block">Privacy Policy</span>
          </h1>

          <article className="mx-auto mt-8 max-w-5xl rounded-[1.35rem] border border-white/10 bg-zinc-950/92 p-5 shadow-2xl shadow-black/35 md:mt-12 md:rounded-[2rem] md:p-8 lg:p-10">
            <div className="space-y-5 text-sm font-medium leading-7 text-white md:text-base md:leading-8">
              {consumerHealthDataParagraphs.map((paragraph) =>
                isPolicyHeading(paragraph) ? (
                  <h2 key={paragraph} className="pt-2 text-xl font-black leading-tight text-white md:text-2xl">
                    {paragraph}
                  </h2>
                ) : (
                  <p key={paragraph}>{renderPolicyParagraph(paragraph, "consumer-health-data", paragraph)}</p>
                ),
              )}
            </div>
          </article>
        </div>
      </section>
      <Footer />
    </main>
  );
}
