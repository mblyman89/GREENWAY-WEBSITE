"use client";

import { useState } from "react";

const faqItems = [
  {
    "question": "What is Greenway Marijuana's Store Hours?",
    "answer": "Greenway Marijuana is open from 8am – 11:00pm every day of the week, excluding Christmas Day."
  },
  {
    "question": "Who Can Legally Buy Cannabis?",
    "answer": "Adults 21 and older can purchase and possess cannabis."
  },
  {
    "question": "What Forms of Payment Does Greenway Marijuana Accept?",
    "answer": "Greenway Marijuana accepts cash only. We have an ATM in store and the fee is $2.50. Credit and debit cards are not currently accepted for cannabis purchases."
  },
  {
    "question": "What Are the Acceptable Forms of Identification at Greenway Marijuana?",
    "answer": "• Driver’s License, Instruction Permit, or I.D. Card issued by any U.S. State, U.S. Territory, or District of Columbia.\n• Driver’s License, Instruction Permit, or I.D. Card issued by any Canadian Province.\n• Valid Washington State Temporary Driver’s License.\n• U.S. Armed Forces I.D. Card (Encrypted signature acceptable).\n• Merchant Marine I.D. Card issued by the U.S. Coast Guard.\n• Official Passport, Passport Card, Global Entry Card, Permanent Resident Card (commonly known as a “green card”), or NEXUS Card.\n• Washington State Tribal Enrollment Card (No expiration date required)."
  },
  {
    "question": "Do I Have to Be a Washington State Resident to Purchase Cannabis?",
    "answer": "You do not have to be a resident of Washington to purchase cannabis in Washington."
  },
  {
    "question": "Can I see the marijuana before I purchase it?",
    "answer": "Yes! In all of its packaged glory."
  },
  {
    "question": "Can I try the marijuana before purchasing it?",
    "answer": "No. There is no sampling allowed on property and it is federally illegal to give away marijuana for free."
  },
  {
    "question": "Can I purchase cannabis products to resell?",
    "answer": "Only if you want to go to jail! Reselling marijuana products is not allowed in the state of Washington."
  },
  {
    "question": "How Much Cannabis May I Purchase?",
    "answer": "In the State of Washington, you can purchase up to:\n• One Ounce (28 Grams) – of usable cannabis a.k.a. Flower\n• 16 Ounces of Cannabis-infused products in Solid Form (Solid Edibles)\n• 72 Ounces of Cannabis-infused products in Liquid Form (Drinks)\n• 7 Grams of Cannabis Concentrate (Dabs/Vapes/infused pre-rolls)"
  },
  {
    "question": "May I consume cannabis products on Greenway Marijuana premises?",
    "answer": "No, you may not open, smoke, or consume any cannabis product on Greenway Marijuana’s premises. Consumption of cannabis product is not allowed in public."
  },
  {
    "question": "Can cannabis purchased legally in Washington be transported to other states?",
    "answer": "No. Cannabis and cannabis products are only to be consumed in Washington State."
  },
  {
    "question": "Can I return or exchange products purchased at Greenway Marijuana?",
    "answer": "WAC 314-55-079 – (12) A marijuana retailer may accept returns of open marijuana products. Products must be returned in their original packaging with the lot, batch, or inventory ID number fully legible.\nReturns MUST be made within 15 days of purchase. The defective item MUST be accompanied by original packaging and receipt — this includes flower, joints, edibles, cartridges, syringes and disposable vapes."
  },
  {
    "question": "Where can I smoke or consume marijuana products?",
    "answer": "On private property only."
  },
  {
    "question": "Will I get arrested for smoking in public?",
    "answer": "Smoking marijuana in public is treated the same as public drunkenness, so there is typically a $350 fine that may be increased to $3,500 with possible jail time."
  },
  {
    "question": "Does Greenway Marijuana Offer a Price Match?",
    "answer": "Yes, Uncle Ike’s will price match regularly-priced menu items with Seattle i502 Pot Shops. The products must be the same brand and the same size we carry at Uncle Ike’s."
  },
  {
    "question": "What possible pesticides do your growers use on their plants?",
    "answer": "Washington law allows cannabis producers to use only WSDA-registered pesticides that are specifically allowed for cannabis and applied according to label directions. This includes some pest, mold, fungus, oil, soap, sulfur, biological, minimum-risk, and limited weed-control products; unauthorized pesticides, certain plant-growth regulators, and DDVP/dichlorvos are prohibited. Washington requires certified lab testing for pesticides on applicable cannabis products, and products that exceed state action levels or contain disallowed pesticide residues can fail testing, be destroyed, or be recalled. Customers may ask for available quality-control test results for a product lot or batch.\n• WSDA Pesticide & Fertilizer Use on Cannabis: https://agr.wa.gov/departments/cannabis/pesticide-use\n• WAC 314-55-084, Cannabis plant production: https://app.leg.wa.gov/wac/default.aspx?cite=314-55-084\n• WAC 314-55-102, Quality assurance and quality control: https://app.leg.wa.gov/wac/default.aspx?cite=314-55-102\n• WAC 314-55-108, Pesticide action levels: https://app.leg.wa.gov/wac/default.aspx?cite=314-55-108\n• RCW 69.50.342, LCB rulemaking authority: https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.342\n• RCW 69.50.345, LCB rules/procedures/criteria: https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.345\n• RCW 69.50.348, representative samples and product testing: https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.348\n• Chapter 15.58 RCW, Washington Pesticide Control Act: https://app.leg.wa.gov/RCW/default.aspx?cite=15.58\n• WSDA Criteria for Pesticides Used for the Production of Marijuana in Washington: https://cms.agr.wa.gov/WSDAKentico/Documents/Pubs/398-WSDACriteriaForPesticideUseOnMarijuana.pdf\n• WSDA/LCB Bulletin No. 26-01 and allowed pesticide list: https://cms.agr.wa.gov/WSDAKentico/Documents/PM/Registration/Pesticides-Allowed-for-Use-on-Cannabis-in-the-Production-of-High-THC-Cannabis_-20260225_FINAL-combined-with-bulletin.pdf"
  }
] as const;

export function FaqPreview() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.13),transparent_18rem),radial-gradient(circle_at_86%_12%,rgba(255,127,0,0.1),transparent_20rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16 lg:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl md:whitespace-nowrap md:text-5xl lg:text-6xl">
            Frequently Asked Questions
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-semibold leading-6 text-zinc-400 md:text-base md:leading-7">
            Everything you need to know about shopping with us.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-4xl space-y-3 md:mt-12 md:space-y-4">
          {faqItems.map((item, index) => {
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
