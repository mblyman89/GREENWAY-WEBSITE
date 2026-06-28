/**
 * Help content — plain-language FAQ for the back office, grouped by section.
 * Single source of truth for both the /admin/help page and the global "?"
 * launcher. Written for non-technical staff: short, friendly, action-oriented.
 */
export type HelpItem = {
  q: string;
  a: string;
  /** Where to go to do this, if applicable. */
  href?: string;
};

export type HelpSection = {
  id: string;
  title: string;
  icon: string;
  intro: string;
  items: HelpItem[];
};

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "🚀",
    intro: "The big picture of what this back office does and the order to do things in.",
    items: [
      {
        q: "What can I do here?",
        a: "This is the control panel for your website. You can upload your menu from your POS, manage products and brands, write blog posts, run promotions, take online orders, and see reports — without touching any code.",
      },
      {
        q: "Where should I start?",
        a: "The dashboard shows a Getting Started checklist with the single next step to take. Generally: upload your POS menu, publish it, then enrich products and set up promotions.",
        href: "/admin",
      },
      {
        q: "Will my changes go live immediately?",
        a: "No — anything that affects your public site is saved as a draft first. You review it, then click Publish when you're ready. Nothing surprises your customers.",
      },
      {
        q: "Does the AI post things automatically?",
        a: "Never. AI only writes drafts to save you typing. You always review, edit, and approve before anything is published.",
      },
    ],
  },
  {
    id: "menu-imports",
    title: "Menu uploads",
    icon: "⬆️",
    intro: "Bringing your live inventory in from your point-of-sale system.",
    items: [
      {
        q: "How do I upload my menu?",
        a: "Export the PRODUCTS and INVENTORIES files from your POS as spreadsheets, then upload both here. We stage them so you can review before anything changes on the site.",
        href: "/admin/menu-imports",
      },
      {
        q: "The upload said something didn't load — what do I do?",
        a: "Make sure you're uploading the original .xlsx or .csv files straight from your POS (don't rename a .csv to .xlsx). If a file is empty or the wrong export, re-export and try again. The page will tell you what it found.",
        href: "/admin/menu-imports",
      },
      {
        q: "How do I make a menu actually show on the site?",
        a: "After uploading, open the staged version, review the changes, and click Publish. Products and prices then appear on your public menu.",
        href: "/admin/menu-imports",
      },
    ],
  },
  {
    id: "products",
    title: "Products",
    icon: "📦",
    intro: "Adding photos, descriptions, and details that make products shine online.",
    items: [
      {
        q: "Why are some products missing photos or descriptions?",
        a: "Your POS only gives us names and prices. You (or the AI helper) add photos, descriptions, and tags here so each product looks great on the site.",
        href: "/admin/products",
      },
      {
        q: "Can AI write product descriptions for me?",
        a: "Yes. Click the AI helper on a product to draft a description, tags, or alt-text. Review and edit it, then save. It's always a draft until you approve it.",
        href: "/admin/products",
      },
    ],
  },
  {
    id: "promotions",
    title: "Promotions",
    icon: "%",
    intro: "Daily deals, brand days, and clearance — scheduled and previewed.",
    items: [
      {
        q: "How do I create a sale?",
        a: "Go to Promotions and create a new one. Pick the products or brands, set the discount and dates, preview how the sale badge will look, then publish.",
        href: "/admin/promotions",
      },
      {
        q: "Will promotions conflict with each other?",
        a: "If two promotions overlap on the same products, you'll get a friendly warning so you can decide which one wins before publishing.",
        href: "/admin/promotions",
      },
    ],
  },
  {
    id: "blog",
    title: "Blog & content",
    icon: "✎",
    intro: "Writing posts and editing the words on your public pages.",
    items: [
      {
        q: "How do I write a blog post?",
        a: "Open Blog, start a new post, and write — or ask the AI helper to draft it. You'll see a live preview of how it looks. Publish when it's ready.",
        href: "/admin/blog",
      },
      {
        q: "How do I change text on my homepage or other pages?",
        a: "Use Site Content. You can edit specific blocks (like the hero headline or business hours) and preview the change before it goes live.",
        href: "/admin/content",
      },
    ],
  },
  {
    id: "orders",
    title: "Orders",
    icon: "🧾",
    intro: "Handling online orders placed through your site.",
    items: [
      {
        q: "Where do online orders show up?",
        a: "In Orders. Each order shows its status and a printable ticket. Update the status as you prepare and complete it.",
        href: "/admin/orders",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    icon: "📊",
    intro: "Seeing how things are going with simple charts.",
    items: [
      {
        q: "What can I see in reports?",
        a: "Inventory health, import diagnostics, and sales-style summaries shown as easy-to-read charts. You can also export the data as CSV.",
        href: "/admin/reports",
      },
    ],
  },
  {
    id: "users",
    title: "Team & access",
    icon: "👥",
    intro: "Inviting staff and controlling who can do what.",
    items: [
      {
        q: "How do I invite a teammate?",
        a: "Go to Users and send an invite. You choose their role, which controls what they can see and change.",
        href: "/admin/users",
      },
      {
        q: "What do the roles mean?",
        a: "Higher roles can do more. Read-only staff can view reports and exports; managers and admins can edit content, publish, and manage users. The Users page explains each role.",
        href: "/admin/users",
      },
      {
        q: "Can I see who changed what?",
        a: "Yes — the Audit Log records important actions with who did them and when.",
        href: "/admin/audit",
      },
    ],
  },
];

/** Flattened, searchable list of every Q&A with its section context. */
export type FlatHelp = HelpItem & {
  sectionId: string;
  sectionTitle: string;
  sectionIcon: string;
};

export function flattenHelp(): FlatHelp[] {
  return HELP_SECTIONS.flatMap((s) =>
    s.items.map((item) => ({
      ...item,
      sectionId: s.id,
      sectionTitle: s.title,
      sectionIcon: s.icon,
    })),
  );
}
