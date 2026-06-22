export type BlogPreviewPost = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  dateLabel: string;
  status: string;
  accent: "green" | "orange" | "gold";
};

export const blogPreviewPosts: BlogPreviewPost[] = [
  {
    slug: "port-orchard-menu-readiness",
    title: "How Greenway is preparing the menu experience.",
    excerpt:
      "A draft editorial space for explaining menu accuracy, Leafly/POS readiness, and why live ordering should wait until certified production workflows are ready.",
    category: "Menu readiness",
    readTime: "4 min preview",
    dateLabel: "Draft post",
    status: "Placeholder",
    accent: "green",
  },
  {
    slug: "adult-use-visit-planning",
    title: "Planning a 21+ recreational cannabis visit.",
    excerpt:
      "A future customer education article can outline verified ID expectations, store-hour reminders, purchase-limit guidance, and pickup basics once Greenway approves final copy.",
    category: "Visit planning",
    readTime: "3 min preview",
    dateLabel: "Draft post",
    status: "Needs review",
    accent: "orange",
  },
  {
    slug: "specials-and-discount-accuracy",
    title: "Why specials need verified rules before launch.",
    excerpt:
      "This placeholder shows how Greenway can explain promotions, eligibility, inventory availability, and final checkout expectations without publishing unverified discount claims.",
    category: "Specials",
    readTime: "5 min preview",
    dateLabel: "Draft post",
    status: "Placeholder",
    accent: "gold",
  },
  {
    slug: "port-orchard-cannabis-resource-hub",
    title: "Building a Port Orchard cannabis resource hub.",
    excerpt:
      "A source-aligned blog foundation for future local updates, educational explainers, compliance reminders, and Greenway announcements after details are verified.",
    category: "Local updates",
    readTime: "4 min preview",
    dateLabel: "Draft post",
    status: "Future content",
    accent: "green",
  },
];

export const blogCategories = ["Menu readiness", "Visit planning", "Specials", "Local updates", "Compliance notes"];

export const blogReplacementNotes = [
  "Replace draft posts with approved Greenway articles, publish dates, authors, and images.",
  "Keep cannabis guidance factual and reviewed before production publishing.",
  "Avoid claiming live inventory, discounts, pickup rules, or store policies until verified through official systems.",
  "Connect individual article routes only after final post content and SEO metadata are ready.",
];
