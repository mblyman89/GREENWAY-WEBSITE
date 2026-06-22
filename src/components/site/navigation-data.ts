export type NavigationChild = {
  label: string;
  href: string;
  helper: string;
};

export type NavigationItem = {
  label: string;
  href: string;
  helper: string;
  children?: NavigationChild[];
};

export const primaryNavigationItems: NavigationItem[] = [
  {
    label: "Home",
    href: "/#top",
    helper: "Return to the Greenway homepage and 21+ preview entry point.",
  },
  {
    label: "Shop",
    href: "/menu",
    helper: "Browse the POS menu experience built for future Leafly category and filter accuracy.",
    children: [
      { label: "Full menu", href: "/menu", helper: "View the full preview menu with categories, filters, sorting, and product cards." },
      { label: "Flower", href: "/menu?category=flower", helper: "Browse flower product card patterns from the POS menu data." },
      { label: "Pre-rolls", href: "/menu?category=preroll", helper: "Review pre-roll product cards and future Leafly category behavior." },
      { label: "Edibles", href: "/menu?category=edible-solid", helper: "Preview edible package and potency display patterns." },
      { label: "Cartridges", href: "/menu?category=cartridge", helper: "Browse cartridge-style preview cards." },
      { label: "Concentrates", href: "/menu?category=concentrate", helper: "Preview concentrate category cards and product metadata." },
      { label: "Topicals", href: "/menu?category=topical", helper: "Review topical and wellness-style menu presentation." },
      { label: "Accessories", href: "/menu?category=paraphernalia", helper: "Browse accessory preview cards from the POS category set." },
    ],
  },
  {
    label: "Specials",
    href: "/specials",
    helper: "Preview promotional layouts before verified rules are published.",
    children: [
      { label: "Current specials", href: "/specials", helper: "See placeholder promotion cards and compliance notes." },
      { label: "Price Match", href: "/price-match", helper: "Review the future local competitor price match policy preview." },
    ],
  },
  {
    label: "About",
    href: "/about",
    helper: "Review Greenway’s source-aligned build philosophy and preview positioning.",
  },
  {
    label: "Location",
    href: "/locations",
    helper: "See Greenway’s Port Orchard address, hours, phone, map, and visit details.",
  },
  {
    label: "Loyalty",
    href: "/loyalty",
    helper: "Join the future Greenway loyalty list and submit signup details for staff review.",
  },
  {
    label: "Blog",
    href: "/blog",
    helper: "Preview the future Greenway education hub.",
  },
  {
    label: "FAQ",
    href: "/faq",
    helper: "Read ordering, compliance, and visit-planning answers.",
  },
];
