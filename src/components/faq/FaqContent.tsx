"use client";

import { useState } from "react";

import { faqItems } from "@/content/faq";

type FaqHeroContent = {
  title?: string;
  subtitle?: string;
  editable?: boolean;
};

type FaqDisplayItem = { question: string; answer: string };

export function FaqContent({
  content,
  items,
}: {
  content?: FaqHeroContent;
  /** DB-backed Q&A; falls back to the committed static list when omitted/empty. */
  items?: FaqDisplayItem[];
} = {}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs: readonly FaqDisplayItem[] =
    items && items.length > 0 ? items : faqItems;

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.13),transparent_18rem),radial-gradient(circle_at_86%_12%,rgba(255,127,0,0.1),transparent_20rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16 lg:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1
            className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl md:whitespace-nowrap md:text-5xl lg:text-6xl"
            {...(content?.editable
              ? { "data-gw-block": "faq.hero.title", "data-gw-editable": "true" }
              : {})}
          >
            {content?.title || "Frequently Asked Questions"}
          </h1>
          <p
            className="mx-auto mt-4 max-w-2xl whitespace-nowrap text-[0.74rem] font-semibold leading-6 text-zinc-400 sm:text-sm md:text-base md:leading-7"
            {...(content?.editable
              ? { "data-gw-block": "faq.hero.subtitle", "data-gw-editable": "true" }
              : {})}
          >
            {content?.subtitle || "Everything you need to know about shopping with us."}
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-4xl space-y-3 md:mt-12 md:space-y-4">
          {faqs.map((item, index) => {
            const isOpen = openIndex === index;

            return (
              <article
                key={item.question}
                className="rounded-[1.15rem] border border-white/10 bg-zinc-950/88 shadow-xl shadow-black/25 md:rounded-[1.45rem]"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left md:px-6 md:py-5"
                >
                  <span className="text-lg font-black leading-tight text-[var(--orange)] md:text-2xl">
                    {item.question}
                  </span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 text-2xl font-black leading-none text-white" aria-hidden="true">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                {isOpen ? (
                  <div id={`faq-answer-${index}`} className="border-t border-white/10 px-4 pb-5 pt-4 md:px-6 md:pb-6">
                    <p className="whitespace-pre-line text-sm font-medium leading-7 text-white md:text-base md:leading-8">
                      {item.answer}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
