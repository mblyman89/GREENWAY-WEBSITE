import Image from "next/image";
import Link from "next/link";
import { greenwayBusiness } from "@/content/business";
import { DesktopMenu } from "@/components/site/DesktopMenu";
import { HeaderCartButton } from "@/components/site/HeaderCartButton";
import { MobileNavigation } from "@/components/site/MobileNavigation";
import { SearchModal } from "@/components/site/SearchModal";
import { SecondaryBar } from "@/components/site/SecondaryBar";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/88 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 md:max-w-none md:px-5 md:py-1 lg:px-6 xl:px-8">
        <Link href="/#top" className="group flex min-w-0 items-center md:w-[18rem] md:flex-none lg:w-[20rem] xl:w-[22rem] 2xl:w-[27rem]" aria-label="Greenway Marijuana home">
          <Image
            src={greenwayBusiness.assets.wordmark}
            alt="Greenway Marijuana"
            width={5891}
            height={1170}
            priority
            className="h-auto w-[10.25rem] object-contain transition duration-200 group-hover:opacity-85 sm:w-[11.75rem] md:w-[19rem] lg:w-[22rem] xl:w-[25rem]"
            sizes="(min-width: 1280px) 400px, (min-width: 1024px) 352px, (min-width: 768px) 304px, (min-width: 640px) 188px, 164px"
          />
        </Link>

        <DesktopMenu />

        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3 md:w-[18rem] lg:w-[20rem] xl:w-[22rem] 2xl:w-[27rem]">
          <SearchModal />
          <HeaderCartButton />
          <MobileNavigation />
        </div>
      </div>

      <SecondaryBar />

    </header>
  );
}
