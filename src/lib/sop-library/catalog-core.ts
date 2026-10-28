/**
 * src/lib/sop-library/catalog-core.ts — SOP Library catalog (pure)
 *
 * The owner asked for "a new page in the employee drop down menu, that has all
 * of the current sop you have written, organized professionally ... it should
 * be easy to find the sop I need to read."
 *
 * The SOP text itself is NOT copied here. The documents in `docs/sop/*.md`
 * stay the single source of truth (they are living documents, owner decision
 * D41) and are read at request time by `load.server.ts`. This file only adds
 * the library metadata: which shelf (category) an SOP sits on, who it is for,
 * a one-line summary and search keywords.
 *
 * A new `docs/sop/SOP-*.md` that is not listed below still appears in the
 * library automatically, on the "Other" shelf, using its own title.
 */

export type SopCategoryId = "cash" | "inventory" | "compliance" | "people" | "other";

export type SopCategory = {
  id: SopCategoryId;
  label: string;
  description: string;
  icon: string;
};

/** Shelves, in the order the library shows them (the SOP program's priority order). */
export const SOP_CATEGORIES: readonly SopCategory[] = [
  {
    id: "cash",
    label: "Register & Cash",
    description: "Selling at the register, the master till and safe, and the end-of-day close and deposit.",
    icon: "\u{1F4B5}",
  },
  {
    id: "inventory",
    label: "Receiving & Inventory",
    description: "From the vendor manifest to a sellable lot, daily inventory care, the menu and counts.",
    icon: "\u{1F4E6}",
  },
  {
    id: "compliance",
    label: "Returns, Destruction & Compliance",
    description: "Product leaving the store any way other than a sale: vendor returns, recalls and destruction.",
    icon: "\u{1F6E1}\u{FE0F}",
  },
  {
    id: "people",
    label: "People & Access",
    description: "Hiring, onboarding, back-office access, PINs, the handbook and offboarding.",
    icon: "\u{1F9D1}\u{200D}\u{1F91D}\u{200D}\u{1F9D1}",
  },
  {
    id: "other",
    label: "Other",
    description: "Newly added SOPs that have not been placed on a shelf yet.",
    icon: "\u{1F4C4}",
  },
] as const;

export type SopMeta = {
  /** File name in docs/sop (without folder). */
  file: string;
  category: SopCategoryId;
  /** Short title for cards and the reader sidebar. */
  shortTitle: string;
  /** Who reads it, in plain words. */
  audience: string[];
  /** One or two sentences: when to open this SOP. */
  summary: string;
  /** Extra words people might search for that are not in the headings. */
  keywords: string[];
};

export const SOP_CATALOG: readonly SopMeta[] = [
  {
    file: "SOP-01-register-operations.md",
    category: "cash",
    shortTitle: "Register Operations",
    audience: ["Budtenders", "Leads", "Managers"],
    summary:
      "A whole register shift: unlocking, the ID check, building a sale, discounts and loyalty, taking cash, holds, voids, returns, cash drops and the blind close.",
    keywords: ["pos", "sale", "checkout", "cart", "id check", "discount", "loyalty", "void", "refund", "drawer", "till", "pin", "limit"],
  },
  {
    file: "SOP-02-master-till-safe.md",
    category: "cash",
    shortTitle: "Master Till & Store Safe",
    audience: ["Openers & closers", "Managers", "Owner"],
    summary:
      "The twice-daily master till count, change swaps between registers and the safe, and the little safe.",
    keywords: ["safe", "master till", "change", "swap", "count sheet", "variance", "petty cash"],
  },
  {
    file: "SOP-03-eod-close-deposit.md",
    category: "cash",
    shortTitle: "End-of-Day Close & Deposit",
    audience: ["Night closer", "Morning opener", "Managers", "Owner"],
    summary:
      "The night end-of-day sheet, the morning recount, sealing the deposit bag, the safe and the bank run.",
    keywords: ["eod", "close", "deposit", "bag", "bank", "night", "morning", "z report", "seal"],
  },
  {
    file: "SOP-04-receiving-intake.md",
    category: "inventory",
    shortTitle: "Receiving Intake",
    audience: ["Managers", "Receiving helpers", "Admin"],
    summary:
      "Truck day from the vendor manifest to sellable lots: counting, refusing, one Finalize, onboarding new products, plus the monthly CCRS public records request.",
    keywords: ["manifest", "delivery", "truck", "vendor", "intake", "finalize", "reject", "ccrs", "prr", "onboarding products", "coa"],
  },
  {
    file: "SOP-05a-inventory-core.md",
    category: "inventory",
    shortTitle: "Inventory Core",
    audience: ["Managers", "Admin", "Owner", "Budtenders (labels & holds)"],
    summary:
      "Daily care of cannabis lots: the Issues check, quantity corrections, holds and recalls, expiry dates, tags, labs and lot labels.",
    keywords: ["lot", "quarantine", "hold", "recall", "expiry", "expiration", "label", "lab", "coa", "adjustment", "issues"],
  },
  {
    file: "SOP-05b-noncannabis-menu-classification.md",
    category: "inventory",
    shortTitle: "Non-Cannabis, Menu & Pricing",
    audience: ["Managers", "Admin", "Owner"],
    summary:
      "Non-cannabis goods and merch, publishing the menu, website categories, sales-limit classification and setting the sell price.",
    keywords: ["glass", "papers", "accessories", "merch", "apparel", "publish", "menu", "category", "price", "classification", "sales limit"],
  },
  {
    file: "SOP-06-cycle-counts-audits-daily-checklists.md",
    category: "inventory",
    shortTitle: "Counts, Audits & Daily Checklists",
    audience: ["Everyone (counts & checklists)", "Owner (audits)"],
    summary:
      "The owner's inventory audits, the blind cycle counts every employee does, and the paper daily checklists.",
    keywords: ["cycle count", "audit", "blind count", "shrink", "variance", "checklist", "daily", "opening", "closing"],
  },
  {
    file: "SOP-15-returns-vendor-destruction.md",
    category: "compliance",
    shortTitle: "Returns, Recalls & Destruction",
    audience: ["Managers", "Admin", "Owner", "Budtenders (customer returns)"],
    summary:
      "Customer-return disposition, returning product to a vendor (including recalls) with the CCRS manifest, and witnessed, on-camera destruction.",
    keywords: ["return", "rma", "vendor return", "recall", "destroy", "destruction", "waste", "witness", "camera", "manifest", "samples"],
  },
  {
    file: "SOP-08-onboarding-system-access-offboarding.md",
    category: "people",
    shortTitle: "Onboarding, Access & Offboarding",
    audience: ["Owner", "Admin", "Managers"],
    summary:
      "Hiring and onboarding a new employee, back-office sign-ins and roles, clock PINs, the handbook gate, badges and visitors, offboarding and rehiring.",
    keywords: ["hire", "new hire", "onboarding", "i-9", "w-4", "handbook", "training", "badge", "visitor", "pin", "user", "role", "terminate", "offboarding", "rehire", "access"],
  },
] as const;

/** URL segment for a file: "SOP-05a-inventory-core.md" -> "sop-05a". */
export function sopSlugFromFile(file: string): string | null {
  const m = /^SOP-(\d{2}[a-z]?)-.*\.md$/i.exec(file);
  return m ? `sop-${m[1].toLowerCase()}` : null;
}

/** "sop-05a" -> "SOP-05a" (display code). */
export function sopCodeFromSlug(slug: string): string {
  return slug.replace(/^sop-/i, "SOP-");
}

export const SOP_LIBRARY_PATH = "/admin/staffing/sop-library";

export function sopLibraryHref(slug?: string, anchor?: string): string {
  const base = slug ? `${SOP_LIBRARY_PATH}/${slug}` : SOP_LIBRARY_PATH;
  return anchor ? `${base}#${anchor}` : base;
}

/**
 * Resolve a link written inside an SOP to a library URL.
 *   "#42-where"                                -> same-page anchor (unchanged)
 *   "SOP-01-register-operations.md#45-x"       -> /admin/staffing/sop-library/sop-01#45-x
 *   "../sop/SOP-02-master-till-safe.md"        -> /admin/staffing/sop-library/sop-02
 *   "https://…"                                -> unchanged (external)
 *   anything else (repo paths)                 -> null (rendered as plain text)
 */
export function resolveSopLink(href: string): { kind: "anchor" | "internal" | "external"; href: string } | null {
  if (!href) return null;
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) return { kind: "external", href };
  const [path, anchor] = href.split("#");
  const file = path.split("/").pop() ?? "";
  const slug = sopSlugFromFile(file);
  if (slug) return { kind: "internal", href: sopLibraryHref(slug, anchor) };
  return null;
}

export function metaForFile(file: string): SopMeta | undefined {
  return SOP_CATALOG.find((m) => m.file === file);
}
