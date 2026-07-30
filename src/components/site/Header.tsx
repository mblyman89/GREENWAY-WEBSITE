import Image from "next/image";
import Link from "next/link";
import { greenwayBusiness } from "@/content/business";
import { DesktopMenu } from "@/components/site/DesktopMenu";
import { HeaderCartButton } from "@/components/site/HeaderCartButton";
import { MobileNavigation } from "@/components/site/MobileNavigation";
import { SearchModal } from "@/components/site/SearchModal";
import { SecondaryBar } from "@/components/site/SecondaryBar";
import { getContentForRender } from "@/lib/cms/render-content";
import {
  MEDICAL_HIDE_BLOCK,
  isMedicalPageHidden,
} from "@/lib/medical/medical-content-core";

export async function Header() {
  // SLICE 107: read the page-level Medical visibility switch once and pass the
  // result down so the Medical link disappears from BOTH nav menus when the
  // page is hidden. Draft-aware + byte-safe: unseeded/blank/"no" keeps it shown.
  const medicalHidden = isMedicalPageHidden(
    await getContentForRender(MEDICAL_HIDE_BLOCK),
  );

  return (
    <header className="sticky top-0 z-50 w-full max-w-[100vw] overflow-x-clip border-b border-white/10 bg-black/88 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-2.5 py-2 sm:gap-3 sm:px-4 md:max-w-none md:px-5 md:py-1 lg:px-6 xl:px-8">
        <Link href="/#top" className="group flex min-w-0 flex-1 items-center md:w-[18rem] md:flex-none lg:w-[20rem] xl:w-[22rem] 2xl:w-[27rem]" aria-label="Greenway Marijuana home">
          <Image
            src={greenwayBusiness.assets.wordmark}
            alt="Greenway Marijuana"
            width={5891}
            height={1170}
            priority
            className="h-auto w-[clamp(8.4rem,44vw,10.25rem)] object-contain transition duration-200 group-hover:opacity-85 sm:w-[11.75rem] md:w-[19rem] lg:w-[22rem] xl:w-[25rem]"
            sizes="(min-width: 1280px) 400px, (min-width: 1024px) 352px, (min-width: 768px) 304px, (min-width: 640px) 188px, 44vw"
          />
        </Link>

        <DesktopMenu hideMedical={medicalHidden} />

        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-3 md:w-[18rem] lg:w-[20rem] xl:w-[22rem] 2xl:w-[27rem]">
          <SearchModal />
          <HeaderCartButton />
          <MobileNavigation hideMedical={medicalHidden} />
        </div>
      </div>

      <SecondaryBar />

    </header>
  );
}
