/**
 * D239 N-10 (SOP-22 G-120): the "Sunday checklist" strip. Forms 8.1 (Monday
 * content brief) and 8.2 (pre-publish compliance checklist) from
 * docs/sop/SOP-22-newsletter-blog-culture-marketing.md §8, shown in the app on
 * Blog & Newsletter and the Send Center. Pure: no I/O. The wording follows the
 * SOP word for word; each line also says where in the app it is done.
 */

export type ChecklistKind = "post" | "newsletter";

export type ChecklistItem = {
  /** Stable id (form number + row). */
  id: string;
  /** The SOP wording, word for word. */
  text: string;
  /** Where in the app this is done or checked (a real admin route). */
  href?: string;
  /** Plain words for the link. */
  where?: string;
  /** Only for newsletters (Form 8.2 rows 5 and 12). */
  newsletterOnly?: boolean;
};

/** Form 8.1: Weekly content brief (Monday). SOP-22 §8.1. */
export const MONDAY_BRIEF: readonly ChecklistItem[] = [
  { id: "8.1-1", text: "Week of (Mon\u2013Sun)" },
  { id: "8.1-2", text: "New vendors added (name, city, first products)", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "8.1-3", text: "Lots received last week, \"fresh drops\" (product, vendor, type)", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "8.1-4", text: "Promotions this week and next (name, dates, what is included, below-cost checked)", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "8.1-5", text: "Vendor days (vendor, date, time; no giveaways)", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "8.1-6", text: "Holidays or events in the next 14 days", href: "/admin/blog#this-week", where: "Local events" },
  { id: "8.1-7", text: "Reviews picked (reviewer first name, link, permission yes/no)", href: "/admin/blog/reviews", where: "Curated reviews" },
  { id: "8.1-8", text: "Culture items (headline, source link, health topic yes/no)", href: "/admin/blog/new#culture", where: "New post from\u2026 > Culture" },
  { id: "8.1-9", text: "Posts to write (type, owner, due day)", href: "/admin/blog/new", where: "New post" },
  { id: "8.1-10", text: "Newsletter send time (Sunday, time)", href: "/admin/newsletter", where: "Send Center" },
];

/** Form 8.2: Pre-publish compliance checklist (every post and every newsletter). SOP-22 §8.2. */
export const PRE_PUBLISH_CHECKS: readonly ChecklistItem[] = [
  { id: "8.2-1", text: "Every fact checked against the back office or the cited source", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "8.2-2", text: "No health, cure, relief or therapeutic wording, and no effects sold as benefits" },
  { id: "8.2-3", text: "No over-consumption, alcohol, tobacco, driving, or youth-appeal words or pictures" },
  { id: "8.2-4", text: "\"21+\" visible" },
  { id: "8.2-5", text: "Newsletter: all four warnings at \u226510% of the largest type size", newsletterOnly: true },
  { id: "8.2-6", text: "Sales: dates stated; no price below acquisition cost; no free cannabis" },
  { id: "8.2-7", text: "Vendor day: no branded giveaways" },
  { id: "8.2-8", text: "Reviews: word for word, attributed, linked, no health or effect mentions", href: "/admin/blog/reviews", where: "Curated reviews" },
  { id: "8.2-9", text: "News: source named and linked" },
  { id: "8.2-10", text: "Nothing aimed at people outside Washington" },
  { id: "8.2-11", text: "Hero picture has alt text and no minors appeal", href: "/admin/media", where: "Digital Assets" },
  { id: "8.2-12", text: "Test email read on a phone (newsletter)", href: "/admin/newsletter", where: "Send Center > Send test", newsletterOnly: true },
];

/** The Sunday order of work (SOP-22 weekly rhythm, as built in N-1 \u2026 N-9). */
export const SUNDAY_STEPS: readonly ChecklistItem[] = [
  { id: "s-1", text: "Monday: fill the brief (below) from This week at Greenway.", href: "/admin/blog#this-week", where: "This week at Greenway" },
  { id: "s-2", text: "During the week: write the posts (New post from\u2026) and build the newsletter on the canvas.", href: "/admin/blog/new", where: "New post" },
  { id: "s-3", text: "Run the 12 pre-publish checks on every post and the newsletter.", href: "/admin/blog", where: "Blog & Newsletter" },
  { id: "s-4", text: "Send a test to yourself and read it on a phone.", href: "/admin/newsletter", where: "Send Center" },
  { id: "s-5", text: "Press Ready for approval. The owner or an admin presses Approve and schedule.", href: "/admin/newsletter", where: "Send Center" },
  { id: "s-6", text: "Sunday: it publishes and sends by itself at the set time. Watch the progress bar; Retry failed if needed.", href: "/admin/newsletter", where: "Send Center" },
];

/** The pre-publish checks that apply to a post or to a newsletter. */
export function checksFor(kind: ChecklistKind): ChecklistItem[] {
  return PRE_PUBLISH_CHECKS.filter((c) => kind === "newsletter" || !c.newsletterOnly);
}

/** Plain-text copy of a form (for printing or pasting into an email). */
export function checklistText(title: string, items: readonly ChecklistItem[]): string {
  const lines = items.map((it, i) => `[ ] ${i + 1}. ${it.text}${it.where ? ` (${it.where})` : ""}`);
  return [title, ...lines].join("\n");
}

export function __runSundayChecklistCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL sunday-checklist-core: ${name}`);
    }
  };
  const all = [...MONDAY_BRIEF, ...PRE_PUBLISH_CHECKS, ...SUNDAY_STEPS];

  ok("form 8.1 has 10 rows", MONDAY_BRIEF.length === 10);
  ok("form 8.2 has 12 checks", PRE_PUBLISH_CHECKS.length === 12);
  ok("six Sunday steps", SUNDAY_STEPS.length === 6);
  ok("ids unique", new Set(all.map((i) => i.id)).size === all.length);
  ok("every href is an admin route", all.every((i) => !i.href || i.href.startsWith("/admin/")));
  ok("every href has words", all.every((i) => !i.href || !!i.where));
  ok("no empty text", all.every((i) => i.text.trim().length > 5));
  ok("8.1 ids in order", MONDAY_BRIEF.every((it, i) => it.id === `8.1-${i + 1}`));
  ok("8.2 ids in order", PRE_PUBLISH_CHECKS.every((it, i) => it.id === `8.2-${i + 1}`));
  ok("health rule present", PRE_PUBLISH_CHECKS.some((c) => /therapeutic/.test(c.text)));
  ok("21+ present", PRE_PUBLISH_CHECKS.some((c) => c.text.includes("21+")));
  ok("four warnings present", PRE_PUBLISH_CHECKS.some((c) => /four warnings/.test(c.text)));
  ok("below cost present", PRE_PUBLISH_CHECKS.some((c) => /below acquisition cost/.test(c.text)));
  ok("no free cannabis present", PRE_PUBLISH_CHECKS.some((c) => /no free cannabis/.test(c.text)));
  ok("Washington present", PRE_PUBLISH_CHECKS.some((c) => /outside Washington/.test(c.text)));
  ok("reviews row links curated reviews", PRE_PUBLISH_CHECKS[7].href === "/admin/blog/reviews");
  ok("brief reviews row links curated reviews", MONDAY_BRIEF[6].href === "/admin/blog/reviews");
  ok("brief send time row links send center", MONDAY_BRIEF[9].href === "/admin/newsletter");
  ok("two newsletter-only checks", PRE_PUBLISH_CHECKS.filter((c) => c.newsletterOnly).length === 2);
  ok("post gets 10 checks", checksFor("post").length === 10);
  ok("newsletter gets 12 checks", checksFor("newsletter").length === 12);
  ok("post skips warnings row", !checksFor("post").some((c) => c.id === "8.2-5"));
  ok("post skips phone row", !checksFor("post").some((c) => c.id === "8.2-12"));
  ok("checksFor keeps order", checksFor("newsletter").every((c, i) => c.id === `8.2-${i + 1}`));
  const txt = checklistText("Pre-publish", PRE_PUBLISH_CHECKS);
  ok("text has title", txt.startsWith("Pre-publish\n"));
  ok("text has 13 lines", txt.split("\n").length === 13);
  ok("text numbers rows", txt.includes("[ ] 12. Test email read on a phone"));
  ok("text names where", txt.includes("(Curated reviews)"));
  ok("text without where has no parens", txt.includes("[ ] 4. \"21+\" visible\n"));
  ok("empty list text is just title", checklistText("T", []) === "T");
  ok("steps mention approval", SUNDAY_STEPS.some((s) => /Approve and schedule/.test(s.text)));
  ok("steps mention test", SUNDAY_STEPS.some((s) => /test/.test(s.text)));
  ok("steps mention retry", SUNDAY_STEPS.some((s) => /Retry failed/.test(s.text)));
  return { passed, failed };
}
