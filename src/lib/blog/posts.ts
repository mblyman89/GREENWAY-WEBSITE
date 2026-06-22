export type BlogCategory = "PRODUCTS" | "DEALS" | "CULTURE" | "NEWSLETTER";

export type BlogPost = {
  slug: string;
  title: string;
  category: BlogCategory;
  kind?: "article" | "newsletter";
  publishDate: string;
  dateLabel: string;
  author: string;
  excerpt: string;
  image: {
    src: string;
    alt: string;
  };
  content: string[];
  newsletter?: {
    pdfSrc: string;
    pages: string[];
  };
};

/*
  Employee update guide:
  1. Copy one object in blogPosts and paste it as a new entry.
  2. Change slug to a short URL-safe value, like "new-edible-arrivals" or "july-27-newsletter".
  3. Choose category as exactly one of: "PRODUCTS", "DEALS", "CULTURE", or "NEWSLETTER".
  4. Set publishDate and dateLabel manually. For newsletters, set these to the Sunday date you want displayed.
  5. For a normal article, replace title, excerpt, image, and content paragraphs.
  6. For a newsletter, set kind: "newsletter", use the first newsletter page as image.src, and add every page image to newsletter.pages.
  7. Add images/PDFs under public/blog/ or public/blog/newsletters/ so the src paths start with /blog/...
*/
export const blogPosts: BlogPost[] = [
  {
    slug: "fresh-flower-picks",
    title: "Fresh Flower Picks to Look For on Your Next Greenway Visit",
    category: "PRODUCTS",
    kind: "article",
    publishDate: "2026-06-20",
    dateLabel: "JUN 20, 2026",
    author: "Greenway Team",
    excerpt:
      "A quick preview of how Greenway can highlight flower favorites, terpene-forward strains, and staff-picked product education in future posts.",
    image: {
      src: "/blog/placeholders/products-flower.svg",
      alt: "Greenway placeholder artwork for featured flower products",
    },
    content: [
      "This placeholder article shows how Greenway Marijuana can publish product-focused stories that help adult-use customers understand what to look for before they visit the store. Future posts can feature approved product photos, verified strain details, terpene notes, and staff education while keeping inventory-specific claims tied to current menu systems.",
      "When the team is ready to publish a real product article, replace this copy with approved Greenway content, add the final image under the public blog folder, and update the category label to PRODUCTS. The card on the Blog page and the full article page will update from the same data entry.",
    ],
  },
  {
    slug: "edibles-made-simple",
    title: "Edibles Made Simple: Reading Labels, Potency, and Serving Size",
    category: "PRODUCTS",
    kind: "article",
    publishDate: "2026-06-18",
    dateLabel: "JUN 18, 2026",
    author: "Greenway Team",
    excerpt:
      "A practical placeholder guide for explaining edible labels, serving sizes, and responsible shopping expectations for adults 21 and older.",
    image: {
      src: "/blog/placeholders/products-edibles.svg",
      alt: "Greenway placeholder artwork for edible product education",
    },
    content: [
      "Edible education is a natural fit for the Greenway blog because customers often want clear, simple, and responsible information before they shop. A real version of this article can explain package labels, serving size, THC limits, onset timing, storage reminders, and why customers should ask budtenders when they need help comparing options.",
      "This starter content is intentionally general and should be replaced with final approved copy before launch. The structure is ready for employees to add a product image, write the article in plain paragraphs, and keep the PRODUCTS label visible in the small pill at the top of the card.",
    ],
  },
  {
    slug: "weekly-specials-preview",
    title: "How to Keep an Eye on Weekly Greenway Specials",
    category: "DEALS",
    kind: "article",
    publishDate: "2026-06-14",
    dateLabel: "JUN 14, 2026",
    author: "Greenway Team",
    excerpt:
      "A deals-focused placeholder for explaining how future Greenway promotions can be featured without overcomplicating the blog workflow.",
    image: {
      src: "/blog/placeholders/deals-weekly.svg",
      alt: "Greenway placeholder artwork for weekly deals",
    },
    content: [
      "This article is a placeholder for future Greenway deal announcements. The final version can explain active specials, timing, eligibility, and any important store rules after the details have been confirmed by the Greenway team.",
      "For employees, deal posts should use the DEALS category label and clear language that matches current store promotions. If a promotion expires, the post can be updated, unpublished later, or replaced with a new object in the blog post data file.",
    ],
  },
  {
    slug: "seasonal-sale-planning",
    title: "Planning Ahead for Seasonal Cannabis Sale Days",
    category: "DEALS",
    kind: "article",
    publishDate: "2026-06-10",
    dateLabel: "JUN 10, 2026",
    author: "Greenway Team",
    excerpt:
      "A promotional placeholder showing how Greenway can talk about seasonal sale moments while keeping details easy to update.",
    image: {
      src: "/blog/placeholders/deals-seasonal.svg",
      alt: "Greenway placeholder artwork for seasonal specials",
    },
    content: [
      "Seasonal sale days can bring extra customer interest, so the Greenway blog can become a useful place to explain what shoppers should know before they arrive. Future approved articles can include sale windows, shopping tips, product categories, and reminders that availability may vary.",
      "This template keeps the content simple: write a clear headline, select DEALS, add the final artwork, and place the approved body text in paragraphs. The system will automatically create both the card and the full article page.",
    ],
  },
  {
    slug: "port-orchard-cannabis-culture",
    title: "Greenway, Port Orchard, and Local Cannabis Culture",
    category: "CULTURE",
    kind: "article",
    publishDate: "2026-06-06",
    dateLabel: "JUN 6, 2026",
    author: "Greenway Team",
    excerpt:
      "A culture-focused placeholder for local stories, community tone, and Greenway’s Port Orchard point of view.",
    image: {
      src: "/blog/placeholders/culture-local.svg",
      alt: "Greenway placeholder artwork for Port Orchard culture",
    },
    content: [
      "Culture posts give Greenway a place to sound local, welcoming, and connected to Port Orchard. Future articles can highlight store personality, customer education themes, community context, and the Greenway brand voice without needing to be tied to a specific product or sale.",
      "Employees can use the CULTURE label for stories that are more editorial than promotional. The same data entry controls the small card label, article header label, and blog page organization.",
    ],
  },
  {
    slug: "cannabis-questions-to-ask",
    title: "Good Questions to Ask Your Budtender Before You Buy",
    category: "CULTURE",
    kind: "article",
    publishDate: "2026-06-02",
    dateLabel: "JUN 2, 2026",
    author: "Greenway Team",
    excerpt:
      "A customer education placeholder about useful questions adults 21+ can ask while shopping for cannabis products.",
    image: {
      src: "/blog/placeholders/culture-education.svg",
      alt: "Greenway placeholder artwork for cannabis education",
    },
    content: [
      "A strong education article can help customers feel comfortable asking questions in store. A final version might cover topics like product format, potency, desired experience, package size, serving guidance, and how to compare options responsibly.",
      "This placeholder should be reviewed and replaced before being treated as final advice. It is here to demonstrate the full article layout and the employee-friendly publishing workflow.",
    ],
  },
  {
    slug: "july-12-newsletter",
    title: "Greenway Newsletter: July 12",
    category: "NEWSLETTER",
    kind: "newsletter",
    publishDate: "2026-07-12",
    dateLabel: "JUL 12, 2026",
    author: "Greenway Team",
    excerpt: "Greenway weekly newsletter for Sunday, July 12, 2026.",
    image: {
      src: "/blog/newsletters/july-12/page-1.png",
      alt: "First page of the Greenway July 12 newsletter",
    },
    content: [],
    newsletter: {
      pdfSrc: "/blog/newsletters/july-12/newsletter.pdf",
      pages: [
        "/blog/newsletters/july-12/page-1.png",
        "/blog/newsletters/july-12/page-2.png",
        "/blog/newsletters/july-12/page-3.png",
      ],
    },
  },
  {
    slug: "july-20-newsletter",
    title: "Greenway Newsletter: July 20",
    category: "NEWSLETTER",
    kind: "newsletter",
    publishDate: "2026-07-20",
    dateLabel: "JUL 20, 2026",
    author: "Greenway Team",
    excerpt: "Greenway weekly newsletter for Sunday, July 20, 2026.",
    image: {
      src: "/blog/newsletters/july-20/page-1.png",
      alt: "First page of the Greenway July 20 newsletter",
    },
    content: [],
    newsletter: {
      pdfSrc: "/blog/newsletters/july-20/newsletter.pdf",
      pages: [
        "/blog/newsletters/july-20/page-1.png",
        "/blog/newsletters/july-20/page-2.png",
        "/blog/newsletters/july-20/page-3.png",
        "/blog/newsletters/july-20/page-4.png",
      ],
    },
  },
  {
    slug: "july-26-newsletter",
    title: "Greenway Newsletter: July 26",
    category: "NEWSLETTER",
    kind: "newsletter",
    publishDate: "2026-07-26",
    dateLabel: "JUL 26, 2026",
    author: "Greenway Team",
    excerpt: "Greenway weekly newsletter for Sunday, July 26, 2026.",
    image: {
      src: "/blog/newsletters/july-26/page-1.png",
      alt: "First page of the Greenway July 26 newsletter",
    },
    content: [],
    newsletter: {
      pdfSrc: "/blog/newsletters/july-26/newsletter.pdf",
      pages: [
        "/blog/newsletters/july-26/page-1.png",
        "/blog/newsletters/july-26/page-2.png",
        "/blog/newsletters/july-26/page-3.png",
        "/blog/newsletters/july-26/page-4.png",
        "/blog/newsletters/july-26/page-5.png",
      ],
    },
  },
];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}
