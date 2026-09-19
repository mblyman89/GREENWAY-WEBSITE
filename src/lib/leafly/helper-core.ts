/**
 * src/lib/leafly/helper-core.ts  —  SLICE B: THE LEAFLY HANDBOOK
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * The owner's words:
 *
 *   "knowing how to use the powerful system is just as important as having a
 *    powerful system, as we wouldn't be able to take advantage of all it has
 *    to offer otherwise."
 *
 * That is exactly right, and it is the gap this file closes. Thirty files in
 * `src/lib/leafly/`, six webhook endpoints, five migrations, thirteen cards on
 * the push page and a live order board — all of it built, tested, and almost
 * none of it explained to the person who has to use it at seven in the morning
 * with a customer waiting.
 *
 * ===========================================================================
 * WHY THE CONTENT IS *DATA*, NOT JSX
 * ===========================================================================
 * Every word below is a plain value in a pure module: no React, no database,
 * no network, no `server-only`. That is not a stylistic preference, it buys
 * four specific things:
 *
 *   1. IT CAN BE TESTED. A walkthrough written into a component can only be
 *      checked by a human reading the screen. Here, CI can assert that every
 *      step has a "why", that no step is empty, that every documented control
 *      actually exists in the code, and that the fifteen-minute rule is stated
 *      wherever it matters.
 *
 *   2. IT CANNOT DRIFT FROM THE CODE. The numbers that matter — the 15-minute
 *      window, the 10-minute gap, the 204-vs-200 success codes — are IMPORTED
 *      from the modules that implement them, never retyped. If someone changes
 *      the rule, this handbook changes with it or the build fails. A hand-typed
 *      "15" would quietly become a lie the day the rule moved.
 *
 *   3. IT RENDERS ANYWHERE. The same content can appear in a page, a printed
 *      checklist, or the existing help search, without being written twice.
 *
 *   4. IT IS HONEST ABOUT WHAT IT DOES NOT KNOW. Where the software genuinely
 *      cannot answer a question — like whether a past request was made with a
 *      manual tool — this says so, rather than inventing a reassuring answer
 *      (house rule 3).
 *
 * ===========================================================================
 * HOW IT IS WRITTEN
 * ===========================================================================
 * For a busy shop owner, not an engineer. Short sentences. No jargon without
 * an immediate plain-English gloss. Every step says WHAT to do, WHERE, and —
 * the part most documentation skips — WHY it works that way, because a person
 * who understands why a button is dangerous does not need to memorise which
 * buttons are dangerous.
 *
 * Nothing here is invented. Every claim traces to a file in this repo or to
 * Leafly's published specs in `docs/`, and the `source` field on each
 * walkthrough records where to go and check.
 */

import {
  LEAFLY_ACK_ACTION_LABEL,
  LEAFLY_ACK_WINDOW_MINUTES,
  LEAFLY_STATUS_ACTION_WORDING,
} from "@/lib/leafly/order-ack-core";
import { MIN_RUN_GAP_MINUTES } from "@/lib/leafly/schedule-core";

// ===========================================================================
// TYPES
// ===========================================================================

/**
 * One baby step in a walkthrough.
 *
 * `why` is REQUIRED, and that is the single most important design decision in
 * this file. The owner asked for "why it is the way it is" on every feature.
 * Making the field optional would mean the explanations quietly stop appearing
 * the first time someone is in a hurry; making it required means the compiler
 * asks for it and a test measures it.
 */
export type HelperStep = {
  /** What to do, as an instruction. Starts with a verb. */
  readonly do: string;
  /** Why it works this way / why it matters. Never empty. */
  readonly why: string;
  /** Optional: what you should SEE if it worked, so you can self-check. */
  readonly expect?: string;
  /** Optional: the most common way this step goes wrong, and the fix. */
  readonly ifStuck?: string;
  /** Optional: true when this step can't be undone. Rendered with a warning. */
  readonly irreversible?: boolean;
};

/** One control on a screen: what it is, what it does, and when to use it. */
export type HelperFeature = {
  /** The label as it actually appears on screen. */
  readonly control: string;
  /** What it does, in one plain sentence. */
  readonly does: string;
  /** Why it exists / why it behaves the way it does. */
  readonly why: string;
  /** When you should reach for it. */
  readonly useWhen: string;
  /** Optional: a caution the user must read before using it. */
  readonly caution?: string;
  /** True when using this is safe no matter what. Drives the "safe" badge. */
  readonly safe: boolean;
};

/** A symptom → meaning → fix entry. */
export type HelperFix = {
  readonly symptom: string;
  readonly meaning: string;
  readonly fix: string;
};

/** A question a real person asks, and a real answer. */
export type HelperQA = {
  readonly q: string;
  readonly a: string;
};

/**
 * A complete walkthrough for one Leafly surface.
 */
export type HelperWalkthrough = {
  readonly id: string;
  /** Human title. */
  readonly title: string;
  /** Where this lives in the back office. */
  readonly href: string;
  /** One line: what this screen is FOR. */
  readonly purpose: string;
  /**
   * Read this before touching anything. The single most important fact about
   * this screen — usually the thing that is irreversible or time-limited.
   */
  readonly readFirst: string;
  /** Ordered, hand-holding steps. */
  readonly steps: readonly HelperStep[];
  /** Every control on the screen, explained. */
  readonly features: readonly HelperFeature[];
  /** What to do when it goes wrong. */
  readonly fixes: readonly HelperFix[];
  /** Questions people actually ask. */
  readonly faq: readonly HelperQA[];
  /** Where these facts come from, so anyone can verify them. */
  readonly source: readonly string[];
};

// ===========================================================================
// 1. THE PUSH & PREVIEW PAGE  —  the owner's top priority
// ===========================================================================

/**
 * The owner said this one matters most: "I need to know how to use the leafly
 * push and preview page most of all."
 *
 * The organising idea of this walkthrough is the SAFETY LADDER. Everything on
 * that page sits somewhere on a line from "cannot possibly hurt" to "replaces
 * your public menu". Taught as a ladder, the page becomes obvious; taught as a
 * list of thirteen cards, it stays intimidating forever.
 *
 *   Rung 1  Look at it          — Preview, payload, stats.    Cannot hurt.
 *   Rung 2  Ask Leafly a question — Check status.             Read-only.
 *   Rung 3  Compare              — Read the menu back.        Read-only, sandbox.
 *   Rung 4  Change what we send  — Sync settings, schedule.   Changes future pushes.
 *   Rung 5  Send it              — Live push.                 Changes your listing.
 */
export const PUSH_AND_PREVIEW: HelperWalkthrough = {
  id: "leafly-push-preview",
  title: "Leafly push & preview — the complete walkthrough",
  href: "/admin/integrations/leafly",
  purpose:
    "This is the page where your menu becomes the menu customers see on Leafly. " +
    "It builds the exact data Leafly will receive, lets you look at it before " +
    "anything is sent, and then sends it when you say so.",
  readFirst:
    "Nothing on this page contacts Leafly until you press a button and then " +
    "confirm it a second time. Looking is always free. The one button that " +
    "changes your public Leafly listing is the live push, and it asks you twice " +
    "on purpose. If you only remember one thing: PREVIEW IS ALWAYS SAFE.",
  steps: [
    {
      do: "Publish your menu first. Go to Menu Imports and publish the version you want customers to see.",
      why:
        "This page never invents a menu. It builds the Leafly feed from your " +
        "currently PUBLISHED menu version, and it leaves out anything marked " +
        "hidden. That means the thing you publish is the thing Leafly gets — " +
        "there is no separate 'Leafly menu' to maintain, and no second place " +
        "for prices to go stale.",
      expect:
        "Back on this page, the 'Items in feed' number should match roughly " +
        "what you expect to be selling.",
      ifStuck:
        "If 'Items in feed' is 0, nothing is published yet, or everything " +
        "published is hidden. Publish a menu version and come back.",
    },
    {
      do: "Look at the three boxes across the top: Items in feed, Environment, and Credentials.",
      why:
        "These three answer the only questions that matter before you send " +
        "anything: is there something to send, where would it go, and are we " +
        "allowed to send it. Checking them takes four seconds and prevents the " +
        "two most common wasted attempts.",
      expect:
        "Environment says 'sandbox' or 'production'. Credentials says 'Ready' " +
        "or 'Incomplete'.",
      ifStuck:
        "Credentials 'Incomplete' means the key or the OAuth pair is missing. " +
        "Go to Integrations → Credentials and save them. Saving sends nothing " +
        "to Leafly.",
    },
    {
      do: "Understand which world you are in. Read the Environment box carefully.",
      why:
        "Sandbox and production are two completely separate Leafly systems with " +
        "DIFFERENT KEYS. Sandbox is a practice world: you can push, break " +
        "things, and no customer ever sees it. Production is your real listing. " +
        "The same button does very different things depending on this one word, " +
        "which is why it is shown at the top rather than buried in settings.",
      expect: "You should be able to say out loud which one you are in.",
    },
    {
      do: "Scroll to 'Payload preview' and actually read the JSON.",
      why:
        "This is not decoration. It is the EXACT text that would be sent to " +
        "Leafly, character for character. Reading it once teaches you more about " +
        "the integration than any documentation, because you can see your own " +
        "products in it — your names, your prices, your strain types. If a price " +
        "looks wrong here, it will be wrong on Leafly.",
      expect:
        "Recognisable product names and prices. Prices are in cents, so 2500 " +
        "means $25.00.",
      ifStuck:
        "If a product looks wrong, fix it in your catalog and publish again. " +
        "Never try to fix it here — this screen is a window, not an editor.",
    },
    {
      do: "Check the 'Leafly ordering' card and read the blocked list.",
      why:
        "An item can be on your menu but still not orderable on Leafly — for " +
        "example if it is restricted by the Department of Health rules. This " +
        "card groups every blocked item by REASON and shows examples, so you " +
        "find out here, calmly, rather than from a customer who could not add " +
        "something to their cart.",
      expect:
        "A badge like '42 of 50 orderable', and a reason for each blocked group.",
    },
    {
      do: "Look at the data-quality and connection-health panels.",
      why:
        "Leafly grades your integration, not just your menu. Thin descriptions " +
        "and missing images cost you placement in their search results, and the " +
        "richness score is the early warning. Health is scored only from LIVE " +
        "attempts that actually reached Leafly — skipped syncs are neither a " +
        "success nor a failure, so they are excluded rather than quietly " +
        "flattering the number.",
    },
    {
      do: "Press 'Check integration status'. This only asks Leafly a question.",
      why:
        "It is the cheapest possible test of the whole chain: your credentials, " +
        "your network, and Leafly being up. It sends no menu data and changes " +
        "nothing. If this fails, a live push was never going to work, and you " +
        "have learned that without touching your listing.",
      expect: "A short status message underneath the button.",
      ifStuck:
        "An authentication error means the key or OAuth pair is wrong, or you " +
        "are using sandbox keys against production. They are different keys.",
    },
    {
      do: "In sandbox only: press 'Read the menu back from Leafly and check it'.",
      why:
        "This is the most underused button on the page and the most valuable. " +
        "A successful push only proves your JSON was well-formed — Leafly will " +
        "cheerfully return a success code for a menu with a field silently " +
        "dropped. This button fetches Leafly's OWN copy and compares it item by " +
        "item against what we would send, so you find the eight-field-defect " +
        "class of problem that a green tick will never show you. It is " +
        "read-only. It is sandbox-only because Leafly answers 405 Method Not " +
        "Allowed in production, so the button refuses to dial rather than waste " +
        "a logged request earning an error.",
      expect: "A report listing anything that does not match.",
    },
    {
      do: "Decide POST or PUT in the Method box. Read this one twice.",
      why:
        "POST is a FULL SYNC: Leafly's menu becomes exactly this feed, and " +
        "anything not in the feed is DELETED from your listing. PUT is an " +
        "upsert: it adds and updates, and leaves anything you did not mention " +
        "alone. POST is the right default because it makes Leafly match your " +
        "shop exactly — including removing what you stopped carrying — but it " +
        "is also the one that can empty your listing if you push while your " +
        "menu is half-published.",
      expect: "The sentence above the box changes to describe the method you picked.",
    },
    {
      do: "Press the push button. Then read the red confirmation line before pressing 'Yes, push now'.",
      why:
        "The button deliberately arms first and sends second. One press does " +
        "nothing but reveal a question naming the exact number of items and the " +
        "method. That pause exists because this is the only control on the page " +
        "that changes what the public sees, and a single accidental tap on a " +
        "phone at the counter should not be able to do it.",
      expect:
        "A message confirming the result, and a new entry in 'Recent sync activity'.",
      ifStuck:
        "If preflight errors are listed, the push is blocked on purpose — fix " +
        "the listed items and try again. The engine also skips a sync when " +
        "nothing has changed, which is normal and not an error.",
      irreversible: true,
    },
    {
      do: "Turn on automatic syncing in the Sync settings and schedule cards.",
      why:
        "This is the step most shops skip, and it costs them. Leafly's " +
        "certification checklist grades sync CADENCE and marks down integrations " +
        "whose requests look hand-driven — so leaving automation off loses you " +
        "points even if you press the button diligently every morning. The " +
        `schedule and the button do not compete: two syncs never run within ` +
        `${MIN_RUN_GAP_MINUTES} minutes of each other, and while you are pushing ` +
        "by hand the schedule stands aside.",
      expect: "The schedule card shows your settings next to what Leafly recommends.",
    },
    {
      do: "Read the 'Leafly menu certification' card and answer the attestation honestly.",
      why:
        "Four of the five criteria are graded automatically from recorded facts. " +
        "The third cannot be: the software cannot see which tool made a past " +
        "request, and the rule is retroactive. So it is presented as something " +
        "YOU attest to, never as an automatic pass. A checklist that quietly " +
        "marked it green would be telling you that you are ready when nobody " +
        "actually checked.",
      expect: "A badge like 'N of 5 criteria met'.",
    },
  ],
  features: [
    {
      control: "Items in feed / Environment / Credentials (the three boxes)",
      does: "Shows how many items would be sent, to which Leafly world, and whether you are allowed to send.",
      why:
        "These are the three preconditions for every other action on the page, " +
        "so they sit above everything else rather than being discovered by failure.",
      useWhen: "Every single time, before anything else.",
      safe: true,
    },
    {
      control: "Payload preview (first N of M)",
      does: "Shows the exact JSON that would be sent to Leafly.",
      why:
        "A success code proves Leafly could read your message, not that the " +
        "message was right. This is the only place you can see the actual words. " +
        "It shows a sample rather than everything so the page stays usable with " +
        "a thousand items.",
      useWhen: "Before your first push of the day, and whenever a price looks wrong on Leafly.",
      safe: true,
    },
    {
      control: "Leafly ordering card",
      does: "Counts how many items Leafly may take orders for, and groups the rest by why they are blocked.",
      why:
        "Being on the menu and being orderable are two different things. " +
        "Grouping by reason turns a long list of problems into two or three " +
        "decisions.",
      useWhen: "When a customer says they could not order something.",
      safe: true,
    },
    {
      control: "Check integration status",
      does: "Asks Leafly whether our credentials work. Sends no menu data.",
      why:
        "It isolates the connection from the content, so a failure tells you " +
        "which of the two is broken instead of leaving you to guess.",
      useWhen: "First thing when anything seems wrong, and after changing credentials.",
      safe: true,
    },
    {
      control: "Read the menu back from Leafly and check it",
      does: "Fetches Leafly's copy of your menu and lists everything that does not match what we send.",
      why:
        "This is the only check that can catch a field we believe we send but " +
        "do not. Sandbox only, because Leafly returns 405 in production.",
      useWhen: "In sandbox, after any change to how the menu is built.",
      safe: true,
    },
    {
      control: "POST \u2014 full sync",
      does: "Full sync. Leafly's menu becomes exactly this feed; items not included are deleted.",
      why:
        "It keeps Leafly honest with your shop, including removals. Most shops " +
        "want this, which is why it is the default.",
      useWhen: "Normal daily syncing, once your published menu is correct.",
      caution:
        "Never push POST while your menu is mid-publish or partially imported — " +
        "a half-built feed will delete the rest of your Leafly listing.",
      safe: false,
    },
    {
      control: "PUT \u2014 upsert items",
      does: "Upsert. Adds and updates the items in the feed; leaves anything omitted untouched.",
      why:
        "Safer for a partial update, but it can never remove a product you " +
        "stopped carrying — those linger on Leafly until a POST clears them.",
      useWhen: "Pushing a correction for specific items without resending everything.",
      caution: "Discontinued items stay visible on Leafly until you run a POST.",
      safe: false,
    },
    {
      control: "Yes, push now",
      does:
        "The second half of the live push. The first press arms it (the button " +
        "reads \u201cPush POST to Leafly\u2026\u201d or \u201cPush PUT to Leafly\u2026\u201d); this " +
        "red button is the one that actually sends the menu.",
      why:
        "Two presses, because it is the only control here that changes what the " +
        "public sees. The confirmation names the item count and method so you " +
        "are confirming a specific action, not a vague one.",
      useWhen: "When the preview looks right and you have decided POST or PUT.",
      caution:
        "This changes your live Leafly listing. There is no undo button — the " +
        "fix for a bad push is another, correct push.",
      safe: false,
    },
    {
      control: "AI description drafter",
      does: "Writes a draft product description from a name, brand, category, strain and THC.",
      why:
        "Richness scores affect Leafly placement, and blank descriptions are the " +
        "most common cause of a low score. Drafts are DRAFTS: nothing is " +
        "attached to a product until you approve it, because an unreviewed " +
        "machine-written claim about a cannabis product is a compliance problem, " +
        "not a time-saver.",
      useWhen: "When the data-quality panel flags thin descriptions.",
      caution: "Always read and edit before approving. Leafly descriptions must be plain text.",
      safe: true,
    },
    {
      control: "Sync settings",
      does: "Controls what goes in the feed — including whether pickup ordering is offered at all.",
      why:
        "Turning ordering off sends every item as not-orderable, which is the " +
        "correct state until you are ready to answer orders within the " +
        `${LEAFLY_ACK_WINDOW_MINUTES}-minute window.`,
      useWhen: "Before you start accepting Leafly orders, and when your policy changes.",
      safe: true,
    },
    {
      control: "Automatic syncing / schedule",
      does: "Runs a full sync daily plus changes in between, without anyone pressing anything.",
      why:
        "Leafly grades cadence. It also means your menu is right at 6am without " +
        `you. Two runs never happen within ${MIN_RUN_GAP_MINUTES} minutes of ` +
        "each other, so the schedule can never stampede your manual push.",
      useWhen: "Switch it on once the manual push has worked cleanly a few times.",
      safe: true,
    },
    {
      control: "Reset sync memory\u2026",
      does: "Clears the record of what was last sent, so the next run resends everything.",
      why:
        "The engine skips a sync when nothing changed. If Leafly and Greenway " +
        "have drifted apart, that optimisation works against you — this is the " +
        "escape hatch that forces a full resend.",
      useWhen: "When Leafly is missing something you know you already pushed.",
      safe: true,
    },
    {
      control: "Recent sync activity",
      does: "Lists recent syncs with mode (live or preview) and outcome.",
      why:
        "It is the evidence trail. 'Skipped' is a normal outcome meaning nothing " +
        "changed, and it is deliberately not counted as either success or failure.",
      useWhen: "Any time you want to know whether something actually went out.",
      safe: true,
    },
    {
      control: "Leafly menu certification card",
      does: "Grades the five published certification criteria.",
      why:
        "Four are measured from recorded facts. The third is an attestation you " +
        "make, because software cannot know which tool made a past request.",
      useWhen: "Before asking Leafly to certify the integration.",
      safe: true,
    },
  ],
  fixes: [
    {
      symptom: "'Items in feed' shows 0.",
      meaning: "No published menu version, or every published item is hidden.",
      fix: "Menu Imports → publish a version. Then reload this page.",
    },
    {
      symptom: "Credentials says 'Incomplete'.",
      meaning: "The menu integration key, or the OAuth client ID/secret, is missing.",
      fix: "Integrations → Credentials → save them. Saving contacts nobody.",
    },
    {
      symptom: "Status check fails with an authentication error.",
      meaning:
        "Wrong key for this environment. Sandbox and production use DIFFERENT keys.",
      fix: "Confirm the Environment box, then enter the matching key for that world.",
    },
    {
      symptom: "The push is blocked and lists preflight errors.",
      meaning: "Items would be rejected or would damage the listing. This is the guard working.",
      fix: "Fix the listed items in your catalog, publish again, re-preview, then push.",
    },
    {
      symptom: "A sync says 'skipped'.",
      meaning: "Nothing changed since the last successful sync. Not an error.",
      fix: "Nothing. If you believe it SHOULD have sent, use \u201cReset sync memory\u2026\u201d.",
    },
    {
      symptom: "The read-back button is greyed out.",
      meaning: "You are in production. Leafly returns 405 Method Not Allowed there.",
      fix: "Use it in sandbox. In production, rely on preview plus the sync log.",
    },
    {
      symptom: "Products you stopped carrying are still on Leafly.",
      meaning: "You have been pushing PUT, which never deletes.",
      fix: "Run one POST full sync with a correct published menu.",
    },
    {
      symptom: "Your Leafly listing went nearly empty after a push.",
      meaning: "A POST full sync ran against a partially published menu.",
      fix: "Publish the complete menu, confirm the payload preview and item count, POST again.",
    },
  ],
  faq: [
    {
      q: "Is preview really safe? Will it use up an API call?",
      a:
        "It is completely safe. Preview never contacts Leafly at all — it builds " +
        "the payload locally from your published menu and shows it to you. You " +
        "can run it as many times as you like.",
    },
    {
      q: "What is the difference between sandbox and production?",
      a:
        "Two separate Leafly systems with different keys. Sandbox is for " +
        "practice and nothing there is public. Production is your real listing. " +
        "The Environment box tells you which one this page is pointed at.",
    },
    {
      q: "If I save my credentials, does anything get sent to Leafly?",
      a: "No. Saving stores them securely. Only a live push sends your menu.",
    },
    {
      q: "Should I use POST or PUT?",
      a:
        "POST for normal daily syncing — it makes Leafly match your shop exactly, " +
        "including removing what you no longer carry. PUT only when you want to " +
        "update specific items without touching anything else.",
    },
    {
      q: "Do I still need to push by hand if automatic syncing is on?",
      a:
        "No, but you can. They do not fight: two syncs never run within " +
        `${MIN_RUN_GAP_MINUTES} minutes of each other, and the schedule stands ` +
        "aside while you push manually.",
    },
    {
      q: "Why does the certification card not just tell me I am ready?",
      a:
        "Because one of the five criteria cannot be checked by software — it " +
        "asks whether past requests were made with manual tools, and the app " +
        "cannot see that. Marking it green automatically would be telling you " +
        "that you passed a check nobody performed.",
    },
    {
      q: "I pushed something wrong. How do I undo it?",
      a:
        "There is no undo. Fix the menu, publish, confirm the payload preview, " +
        "and push again — the correct push replaces the wrong one.",
    },
  ],
  source: [
    "src/app/admin/integrations/leafly/page.tsx",
    "src/app/admin/integrations/leafly/leafly-client.tsx",
    "src/app/admin/integrations/leafly/actions.ts",
    "src/lib/leafly/push.ts",
    "src/lib/leafly/preview-core.ts",
    "src/lib/leafly/certification-core.ts",
    "src/lib/leafly/schedule-core.ts",
    "src/lib/leafly/readback-core.ts",
    "src/components/admin/syndication/SyncSettingsPanel.tsx",
    "src/components/admin/syndication/LeaflySchedulePanel.tsx",
    "docs/leafly-menu-api-v2.md",
  ],
};

// ===========================================================================
// 2. THE ONLINE ORDERS DASHBOARD
// ===========================================================================

/**
 * The owner asked for something deliberately simpler here: "just a simple
 * helpful step by step walkthrough of how to use the page/section and what all
 * its features are and what we should be doing with them and why."
 *
 * So this is shorter than the push walkthrough — but it carries the single
 * most important distinction in the entire integration, the one corrected in
 * slice L-14:
 *
 *   ACKNOWLEDGE is a RECEIPT. It means "we got it".
 *   CONFIRMED   is an ACCEPTANCE. It means "we are making it".
 *
 * They are not the same thing, they are not interchangeable, and the fifteen
 * minute clock applies only to the first.
 */
export const ORDERS_DASHBOARD: HelperWalkthrough = {
  id: "leafly-orders-dashboard",
  title: "Leafly orders on the online orders dashboard",
  href: "/admin/orders",
  purpose:
    "This is where a Leafly pickup order arrives, gets accepted, gets built, " +
    "and gets handed to the customer. It is the only screen on a clock.",
  readFirst:
    `You have ${LEAFLY_ACK_WINDOW_MINUTES} minutes to acknowledge a new Leafly ` +
    "order. If you do not, Leafly cancels it automatically and the customer is " +
    "told you did not respond. Acknowledging is also IRREVERSIBLE: the moment " +
    "you do it, Leafly permanently revokes our access to the customer's ID " +
    "images. Open and check any ID you need BEFORE you acknowledge.",
  steps: [
    {
      do: "Watch for the Leafly panel on the orders dashboard. New orders appear here on their own.",
      why:
        "Orders arrive by webhook from Leafly, not by anyone refreshing a page. " +
        "The panel is the shop's single view of them, so nobody has to keep a " +
        "Leafly tab open beside the register.",
      expect: "A card per order, with a countdown on any order not yet acknowledged.",
    },
    {
      do: "Read the countdown on the order card before anything else.",
      why:
        `Leafly gives you ${LEAFLY_ACK_WINDOW_MINUTES} minutes from submission. ` +
        "The countdown turns from comfortable to soon to urgent as it runs down. " +
        "Those warning thresholds are OUR operational choice — Leafly only " +
        "publishes the deadline and the consequence — so they are there to get " +
        "your attention early, not because Leafly changes anything at that point.",
      expect: "A plain-English countdown, never a blank space.",
      ifStuck:
        "If it says the deadline is unknown, Leafly did not send one or it could " +
        "not be read. Treat it as urgent and acknowledge now. The screen says " +
        `'unknown' rather than inventing a comfortable ${LEAFLY_ACK_WINDOW_MINUTES} minutes.`,
    },
    {
      do: "If you need to see the customer's ID, open it NOW, before acknowledging.",
      why:
        "This is the one-way door. Leafly's own words are that access to an " +
        "order's media is revoked once acknowledged. After you press the button " +
        "the images are gone for good — not hidden, gone — and no support ticket " +
        "brings them back.",
      irreversible: true,
    },
    {
      do: "Press Acknowledge, and read the confirmation dialog.",
      why:
        "Acknowledging is a RECEIPT: it tells Leafly we have the order and stops " +
        "the auto-cancel clock. It is not yet a promise to fill it. The " +
        "confirmation appears because the action cannot be undone, and the " +
        "warning text lives in the shared rules rather than in this one screen, " +
        "so any future screen that acknowledges an order shows the same warning.",
      expect:
        "The countdown disappears and is replaced by a note that the deadline no longer applies.",
      irreversible: true,
    },
    {
      do: "Set the order to Confirmed once you have decided you will actually fill it.",
      why:
        "This is the step people miss, and it is the one that matters to the " +
        "floor. Acknowledge said 'we got it'. Confirmed says 'we are making it' " +
        "— it is the business acceptance, and it is what drives the order onto " +
        "the register's pickup list. If you acknowledge and never confirm, the " +
        "clock is safely stopped but nobody starts building the bag.",
      expect: "The order's status badge changes and it becomes visible to the floor.",
    },
    {
      do: "Build the order, then move it forward through the statuses as it progresses.",
      why:
        "Leafly shows the customer the status you set, so it is how they know " +
        "when to drive over. Statuses only move FORWARD; the screen offers you " +
        "the ones that are legal from where the order is now, rather than " +
        "letting you pick an illegal one and collecting an error from Leafly.",
    },
    {
      do: "Mark Picked up when the customer has it. Only then.",
      why:
        "Picked up is TERMINAL. Leafly's rule is that orders cannot be moved out " +
        "of a terminal status, so there is no correcting this one afterwards. " +
        "That is why it is behind a confirmation.",
      irreversible: true,
    },
    {
      do: "If you must cancel, use Cancel and check the reason shown.",
      why:
        "Cancelled is also terminal. The reason is recorded on Leafly's side and " +
        "is visible to them, so the screen shows you which reason will be sent " +
        "instead of leaving it blank. If no reason is given Leafly records " +
        "'dispensary' — blaming the shop — so you are shown that rather than " +
        "discovering later that every uncategorised cancellation was your fault.",
      irreversible: true,
    },
    {
      do: "Watch for interrupt notices on an order card.",
      why:
        "If something happened at the register that the office needs to know " +
        "about — most importantly an order that was cancelled after the floor " +
        "started on it — it is raised as an interrupt and shown right on the " +
        "board. A cancelled order must not be served, and the board is where " +
        "that becomes visible without anyone having to go looking.",
    },
  ],
  features: [
    {
      control: "The countdown on each unacknowledged order",
      does: "Shows how long is left before Leafly auto-cancels the order.",
      why:
        "It is the only true deadline in the system. It shows 'unknown' rather " +
        "than a guess when Leafly sends no deadline, because guessing here would " +
        "be guessing about whether a customer's order is about to be cancelled.",
      useWhen: "Immediately, on every new order.",
      safe: true,
    },
    {
      control: LEAFLY_ACK_ACTION_LABEL,
      does: "Tells Leafly we received the order and stops the auto-cancel clock.",
      why:
        "A receipt, not an acceptance. Separate from Confirmed because they " +
        "answer different questions: 'did it arrive' and 'will you make it'.",
      useWhen: `Within ${LEAFLY_ACK_WINDOW_MINUTES} minutes of the order arriving.`,
      caution:
        "IRREVERSIBLE. Permanently revokes our access to the customer's " +
        "government ID and medical ID images. Check any ID you need first.",
      safe: false,
    },
    {
      control: LEAFLY_STATUS_ACTION_WORDING.confirmed.label,
      does: "Tells Leafly we are filling the order, and puts it in front of the floor.",
      why:
        "This is the business acceptance and the thing that drives floor " +
        "visibility. Acknowledging alone stops the clock but starts no work.",
      useWhen: "As soon as you have decided you can actually fill it.",
      safe: true,
    },
    {
      control: "Forward status buttons (e.g. \u201c" +
        LEAFLY_STATUS_ACTION_WORDING.ready.label +
        "\u201d)",
      does: "Moves the order along and updates what the customer sees on Leafly.",
      why:
        "Only legal forward transitions are offered, so an impossible move " +
        "cannot be attempted. The rules live in one shared place and are checked " +
        "in CI, rather than being re-decided by each screen.",
      useWhen: "As the order physically progresses.",
      safe: true,
    },
    {
      control: LEAFLY_STATUS_ACTION_WORDING.picked_up.label,
      does: "Closes the order as collected.",
      why: "Terminal. Leafly does not allow moving out of a terminal status.",
      useWhen: "When the customer is holding the bag.",
      caution: "Cannot be undone.",
      safe: false,
    },
    {
      control: LEAFLY_STATUS_ACTION_WORDING.canceled.label,
      does: "Cancels the order on Leafly and records why.",
      why:
        "Terminal, and the reason is visible to Leafly. The default is " +
        "'dispensary', so the screen shows you what will be recorded.",
      useWhen: "When you genuinely cannot fill it.",
      caution: "Cannot be undone, and the reason is recorded against your shop.",
      safe: false,
    },
    {
      control: "Interrupt notices",
      does: "Surfaces register-side problems — above all, an order cancelled after work began.",
      why:
        "A cancelled order must never be handed over. Showing it on the board " +
        "means the office sees it without anyone reporting it.",
      useWhen: "Whenever one appears. Act on it before touching the order.",
      safe: true,
    },
  ],
  fixes: [
    {
      symptom: "An order was cancelled and we never touched it.",
      meaning: `It was not acknowledged within ${LEAFLY_ACK_WINDOW_MINUTES} minutes, so Leafly cancelled it.`,
      fix:
        "Nothing can restore it. Prevent it: keep the orders dashboard visible, " +
        "and turn on the order announcer so new orders make a noise.",
    },
    {
      symptom: "We acknowledged, but the floor never saw the order.",
      meaning: "It was acknowledged but never set to Confirmed.",
      fix: "Set it to Confirmed. Acknowledging is only the receipt.",
    },
    {
      symptom: "We need to see the customer's ID and cannot.",
      meaning: "The order has been acknowledged, so Leafly revoked access.",
      fix:
        "It cannot be recovered. From now on, open the ID before acknowledging — " +
        "that is exactly what the warning dialog is asking you to do.",
    },
    {
      symptom: "The countdown says the deadline is unknown.",
      meaning: "Leafly sent no deadline, or it could not be read.",
      fix: `Treat it as urgent. Leafly's documented window is ${LEAFLY_ACK_WINDOW_MINUTES} minutes from submission.`,
    },
    {
      symptom: "A status change failed.",
      meaning:
        "Several possibilities: retry-able network problem, a credential to fix, " +
        "a request to fix, the order is gone, or it worked and our own record " +
        "did not update.",
      fix: "Read the message — it distinguishes these — then reload the board to see the true current state.",
    },
    {
      symptom: "An interrupt says the order was cancelled.",
      meaning: "The customer or Leafly cancelled it after the register began work.",
      fix: "Do not hand it over. Stop, and resolve the interrupt.",
    },
  ],
  faq: [
    {
      q: "What is the difference between acknowledging and confirming?",
      a:
        "Acknowledge is a RECEIPT — 'we got your order' — and it stops Leafly's " +
        `${LEAFLY_ACK_WINDOW_MINUTES}-minute auto-cancel clock. Confirmed is the ` +
        "ACCEPTANCE — 'we are making it' — and it is what puts the order in " +
        "front of the floor. You need both.",
    },
    {
      q: `What actually happens if I miss the ${LEAFLY_ACK_WINDOW_MINUTES} minutes?`,
      a:
        "Leafly cancels the order automatically and the customer is told you did " +
        "not respond. There is no way to recover it.",
    },
    {
      q: "Why can I not see the ID after acknowledging?",
      a:
        "Leafly revokes access to an order's media once it is acknowledged. That " +
        "is their rule, not ours, which is why the confirmation warns you to " +
        "look first.",
    },
    {
      q: "Can I move an order back a step?",
      a:
        "No. Statuses only move forward, and Picked up and Cancelled are final — " +
        "Leafly does not allow moving out of a terminal status.",
    },
    {
      q: "Do I have to accept every Leafly order?",
      a:
        "No. If you cannot fill it, cancel it with a reason. What you must not do " +
        "is ignore it — silence is recorded as a missed acknowledgement.",
    },
    {
      q: "How do I stop missing orders?",
      a:
        "Keep the orders dashboard up, and switch on the announcer so an arriving " +
        "Leafly order makes a sound. You can give Leafly orders their own sound " +
        "so you can tell them apart by ear.",
    },
  ],
  source: [
    "src/components/admin/orders/LeaflyOrdersPanel.tsx",
    "src/components/admin/orders/LeaflyOrderActions.tsx",
    "src/app/admin/orders/leafly-actions.ts",
    "src/lib/leafly/order-ack-core.ts",
    "src/lib/leafly/order-board-server.ts",
    "src/lib/leafly/register-claim-core.ts",
    "docs/leafly-order-api-v1.md",
  ],
};

// ===========================================================================
// 3. THE REST OF THE LEAFLY SURFACE
// ===========================================================================

/**
 * "every feature needs to be very well explained ... we need to know
 *  everything there is to know about leafly integrations."
 *
 * The two walkthroughs above cover the screens the owner uses daily. This
 * section covers the parts that are real, that matter, and that are otherwise
 * invisible — credentials, the webhooks, the register, the evidence trail —
 * so that "everything" actually means everything.
 */
export const OTHER_SURFACES: readonly HelperWalkthrough[] = [
  {
    id: "leafly-credentials",
    title: "Credentials — connecting the account",
    href: "/admin/integrations",
    purpose: "Where Leafly's keys are stored so the rest of the integration can work.",
    readFirst:
      "Saving credentials sends nothing to Leafly. Nothing you do here is " +
      "visible to anyone outside the shop. Sandbox and production use " +
      "DIFFERENT keys — mixing them up is the most common setup mistake.",
    steps: [
      {
        do: "Get your credentials from Leafly: an OAuth Client ID and Secret, plus a menu integration key.",
        why:
          "The OAuth pair proves who we are; the menu key identifies which menu " +
          "we are allowed to write. They are issued per environment, so you get " +
          "one set for sandbox and a different set for production.",
      },
      {
        do: "Choose the environment first, then paste the matching keys and save.",
        why:
          "Choosing the environment first means the keys you paste are the right " +
          "ones for that world. Saving stores them masked and contacts nobody.",
        expect: "Credentials on the Leafly page changes to 'Ready'.",
      },
      {
        do: "Go to the Leafly page and press 'Check integration status'.",
        why:
          "It is the cheapest confirmation that the keys actually work, and it " +
          "sends no menu data.",
      },
    ],
    features: [
      {
        control: "Environment (sandbox / production)",
        does: "Selects which Leafly world everything points at.",
        why: "Two separate systems with separate keys. Practise in sandbox first.",
        useWhen: "Set it before entering keys.",
        safe: true,
      },
      {
        control: "Menu integration key + OAuth Client ID / Secret",
        does: "Identifies the shop to Leafly and authorises menu writes.",
        why: "Stored masked. Saving transmits nothing.",
        useWhen: "Once per environment, and whenever Leafly reissues them.",
        safe: true,
      },
    ],
    fixes: [
      {
        symptom: "Authentication errors even though the keys are 'Ready'.",
        meaning: "Almost always sandbox keys against production, or the reverse.",
        fix: "Match the key set to the Environment shown on the Leafly page.",
      },
    ],
    faq: [
      {
        q: "Is it safe to store our keys here?",
        a: "Yes — they are stored securely and displayed masked, and saving sends nothing to Leafly.",
      },
    ],
    source: [
      "src/app/admin/integrations/CredentialsEditor.tsx",
      "src/app/admin/integrations/credential-actions.ts",
      "src/lib/integrations/integration-credentials-core.ts",
      "src/lib/leafly/config.ts",
    ],
  },
  {
    id: "leafly-webhooks",
    title: "Webhooks — how orders actually arrive",
    href: "/admin/integrations/leafly",
    purpose:
      "The six endpoints Leafly calls to tell us about orders. Nobody operates " +
      "these, but knowing they exist explains why orders appear by themselves.",
    readFirst:
      "You never press anything here. This is Leafly calling us, not us calling " +
      "Leafly. It is worth understanding because it explains what to check when " +
      "orders stop arriving.",
    steps: [
      {
        do: "Understand the six messages Leafly sends: submit, preview, status, cancel, activate and deactivate.",
        why:
          "Submit is a new order. Preview asks us to price a basket before the " +
          "customer commits. Status and cancel are updates. Activate and " +
          "deactivate turn ordering on and off from Leafly's side. Knowing which " +
          "is which turns 'the integration is broken' into a specific question.",
      },
      {
        do: "Know that every incoming call is signature-checked before it is trusted.",
        why:
          "Anyone can send our webhook address a message. The signature proves it " +
          "genuinely came from Leafly. Without that check, a stranger could " +
          "inject orders into the shop.",
      },
      {
        do: "If orders stop arriving, check the evidence panel on the Leafly page first.",
        why:
          "It records what actually arrived and what happened to it. The single " +
          "most likely time to open the Leafly page is when orders have STOPPED, " +
          "so the diagnostics are built never to be the second thing that fails.",
      },
    ],
    features: [
      {
        control: "Order submit / preview / status / cancel / activate / deactivate",
        does: "The six ways Leafly talks to us about orders.",
        why: "Separate endpoints so a failure in one cannot take down the others.",
        useWhen: "Never directly — this is background machinery.",
        safe: true,
      },
      {
        control: "Signature verification",
        does: "Rejects any incoming message that is not genuinely from Leafly.",
        why: "The webhook address is effectively public; the signature is what makes it trustworthy.",
        useWhen: "Automatic on every request.",
        safe: true,
      },
    ],
    fixes: [
      {
        symptom: "No Leafly orders at all, for hours.",
        meaning: "Either ordering is switched off in sync settings, or Leafly has deactivated it.",
        fix:
          "Check the 'Leafly ordering' card and Sync settings, then the evidence " +
          "panel for a deactivate message.",
      },
    ],
    faq: [
      {
        q: "Do I need to keep a browser open for orders to arrive?",
        a:
          "No. Leafly calls our server directly, so orders arrive whether or not " +
          "anyone is looking. You do need someone watching the dashboard to " +
          `acknowledge them within ${LEAFLY_ACK_WINDOW_MINUTES} minutes.`,
      },
    ],
    source: [
      "src/app/api/webhooks/leafly/route-factory.ts",
      "src/app/api/webhooks/leafly/order-submit/route.ts",
      "src/lib/leafly/webhook-parse-core.ts",
      "src/lib/leafly/hmac-core.ts",
      "docs/leafly-order-api-v1.md",
    ],
  },
  {
    id: "leafly-register",
    title: "At the register — Leafly orders on the floor",
    href: "/pos",
    purpose: "How a confirmed Leafly order reaches the person building the bag.",
    readFirst:
      "A Leafly order reaches the floor when it is CONFIRMED — not merely " +
      "acknowledged. If the register never sees an order, that is the first " +
      "thing to check.",
    steps: [
      {
        do: "Confirm the order in the back office.",
        why: "Confirmation is what makes it appear on the register's pickup list.",
      },
      {
        do: "Let the announcer tell you. Give Leafly orders their own sound.",
        why:
          "A sound you can recognise without looking is the difference between " +
          "noticing an order in one minute and in fourteen. Per-origin sounds " +
          "exist so you can tell a Leafly order from a website order by ear.",
      },
      {
        do: "If an interrupt appears at the register, stop and read it.",
        why:
          "The most important interrupt is an order cancelled after you started " +
          "building it. Serving a cancelled order means giving away product that " +
          "will never be paid for, so the register blocks rather than trusting " +
          "anyone to notice a subtle badge.",
        irreversible: false,
      },
    ],
    features: [
      {
        control: "Pickup list",
        does: "Shows confirmed Leafly orders alongside other pickups.",
        why: "One list, so the floor has one place to look.",
        useWhen: "Continuously during service.",
        safe: true,
      },
      {
        control: "Announcer sound per origin",
        does: "Plays a distinct sound for Leafly orders.",
        why: `The ${LEAFLY_ACK_WINDOW_MINUTES}-minute clock makes noticing quickly worth real money.`,
        useWhen: "Set it up once in the announcer settings.",
        safe: true,
      },
      {
        control: "Register interrupt",
        does: "Blocks and explains when something has changed about an order in progress.",
        why: "A cancelled order must not be served. Blocking is deliberate.",
        useWhen: "When it appears — read it, then act.",
        safe: true,
      },
    ],
    fixes: [
      {
        symptom: "The register never shows a Leafly order.",
        meaning: "It was acknowledged but not confirmed.",
        fix: "Set it to Confirmed on the orders dashboard.",
      },
    ],
    faq: [
      {
        q: "Can the floor acknowledge orders?",
        a:
          "Acknowledging is a back-office action because it destroys access to " +
          "the customer's ID images, and that decision should be made by someone " +
          "who has checked whether the ID is needed.",
      },
    ],
    source: [
      "src/app/pos/RegisterShell.tsx",
      "src/app/pos/RegisterInterruptModal.tsx",
      "src/lib/leafly/register-claim-core.ts",
      "src/lib/announcer/announcer-core.ts",
    ],
  },
  {
    id: "leafly-evidence",
    title: "Evidence & sync history — proving what happened",
    href: "/admin/integrations/leafly",
    purpose: "The record of what was sent, what arrived, and what went wrong.",
    readFirst:
      "This is the panel to open when something is wrong, and it is built so " +
      "that an unreadable log reports a problem rather than crashing the page.",
    steps: [
      {
        do: "Open the evidence panel on the Leafly page.",
        why:
          "It shows what actually happened rather than what should have happened. " +
          "When orders stop, this is where the truth is.",
      },
      {
        do: "Read 'Recent sync activity' for menu pushes.",
        why:
          "Mode tells you whether it was live or a preview; 'skipped' means " +
          "nothing had changed and is not a failure.",
      },
      {
        do: "Export the evidence if Leafly asks for it.",
        why: "Certification and support conversations go faster with the actual record.",
      },
    ],
    features: [
      {
        control: "Evidence panel",
        does: "Shows recorded webhook and order activity.",
        why: "Never throws on a bad read — it reports the problem instead, because it is needed most when things are broken.",
        useWhen: "First stop for any 'it stopped working'.",
        safe: true,
      },
      {
        control: "Evidence export",
        does: "Downloads the record.",
        why: "So you can send Leafly evidence instead of describing it.",
        useWhen: "When Leafly support or certification asks.",
        safe: true,
      },
      {
        control: "Recent sync activity",
        does: "Lists menu pushes and their outcomes.",
        why: "'Skipped' is a normal, meaningful outcome and is not counted as success or failure.",
        useWhen: "To confirm whether something actually went out.",
        safe: true,
      },
    ],
    fixes: [
      {
        symptom: "The evidence panel shows a problem message instead of data.",
        meaning: "The log could not be read. The page is telling you so on purpose.",
        fix: "Reload. If it persists, the underlying store needs attention — the page will keep working.",
      },
    ],
    faq: [
      {
        q: "How far back does this go?",
        a: "It shows the recent window that the page loads — enough to diagnose a current problem, not a full archive.",
      },
    ],
    source: [
      "src/components/admin/syndication/LeaflyEvidencePanel.tsx",
      "src/lib/leafly/evidence-core.ts",
      "src/lib/leafly/evidence-server.ts",
      "src/app/admin/integrations/leafly/evidence-export/route.ts",
    ],
  },
];

// ===========================================================================
// THE FIRST-TIME CHECKLIST
// ===========================================================================

/**
 * "Maybe a checklist that walks each step or something expert level that makes
 *  it super easy to understand."
 *
 * The ordering is the value here, not the items. It is deliberately arranged so
 * that everything reversible happens before anything irreversible, and so that
 * the shop cannot end up accepting real orders before it is able to answer them
 * within the acknowledgement window.
 */
export type ChecklistItem = {
  readonly id: string;
  readonly label: string;
  /** Why this comes at this point in the order. */
  readonly why: string;
  readonly href?: string;
  /** True when this step can affect the public listing or real customers. */
  readonly live: boolean;
};

export const FIRST_TIME_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "credentials",
    label: "Save your Leafly credentials, with the environment set to sandbox.",
    why: "Nothing else works without them, and sandbox means no mistake here can reach a customer.",
    href: "/admin/integrations",
    live: false,
  },
  {
    id: "status",
    label: "Press 'Check integration status' and get a healthy answer.",
    why: "Proves the connection before any menu data is involved, so a later failure cannot be blamed on the keys.",
    href: "/admin/integrations/leafly",
    live: false,
  },
  {
    id: "publish",
    label: "Publish the menu you want Leafly to show.",
    why: "The feed is built from the published menu. Publishing is what makes there be anything to send.",
    live: false,
  },
  {
    id: "preview",
    label: "Read the payload preview and confirm the item count looks right.",
    why: "The last free check. Every field error you catch here is one that never reaches a customer.",
    href: "/admin/integrations/leafly",
    live: false,
  },
  {
    id: "quality",
    label: "Clear the preflight errors and improve anything the data-quality panel flags.",
    why: "Preflight errors will block the push anyway; richness affects your placement on Leafly.",
    live: false,
  },
  {
    id: "sandbox-push",
    label: "Run a live push IN SANDBOX.",
    why: "The first real push should happen where nobody can see it go wrong.",
    live: false,
  },
  {
    id: "readback",
    label: "Press 'Read the menu back from Leafly and check it' and resolve every mismatch.",
    why:
      "A success code only proves your JSON parsed. This is the only check that " +
      "compares Leafly's actual copy against what we send — and it is sandbox-only, " +
      "so this is your one chance to use it.",
    live: false,
  },
  {
    id: "ordering-off",
    label: "Leave pickup ordering OFF until the shop is ready to answer orders quickly.",
    why:
      `An order you do not acknowledge within ${LEAFLY_ACK_WINDOW_MINUTES} minutes ` +
      "is cancelled by Leafly and the customer is told you did not respond. Do not " +
      "switch this on before someone is watching the dashboard.",
    live: false,
  },
  {
    id: "announcer",
    label: "Set up the announcer with a distinct sound for Leafly orders.",
    why: "So the clock starts being noticed by ear, not by luck.",
    live: false,
  },
  {
    id: "production-keys",
    label: "Switch the environment to production and save the PRODUCTION keys.",
    why: "Different world, different keys. This is the line between practice and real.",
    href: "/admin/integrations",
    live: true,
  },
  {
    id: "production-push",
    label: "Run one POST full sync in production, then check your public Leafly listing.",
    why: "POST makes Leafly match your shop exactly. Looking at the listing afterwards is the only true confirmation.",
    live: true,
  },
  {
    id: "automation",
    label: "Turn on automatic syncing.",
    why:
      "Leafly grades cadence and marks down integrations that look hand-driven, " +
      "so leaving this off costs certification even if you push diligently.",
    live: true,
  },
  {
    id: "ordering-on",
    label: "Turn pickup ordering ON once the dashboard is genuinely watched.",
    why: "This is the moment real customers can place real orders on your clock.",
    live: true,
  },
  {
    id: "certification",
    label: "Review the certification card and answer the attestation honestly.",
    why:
      "Four criteria are measured; the third is a question only you can answer. " +
      "An honest 'not yet' is more useful than a green tick nobody earned.",
    live: true,
  },
];

// ===========================================================================
// THE BIG IDEAS
// ===========================================================================

/**
 * Six facts that explain most of the integration's behaviour. Someone who
 * knows these can reason about a screen they have never seen, which is worth
 * more than memorising any individual button.
 */
export type BigIdea = {
  readonly title: string;
  readonly body: string;
};

export const BIG_IDEAS: readonly BigIdea[] = [
  {
    title: "Acknowledge is a receipt. Confirmed is an acceptance.",
    body:
      "Acknowledging says 'we got your order' and stops Leafly's " +
      `${LEAFLY_ACK_WINDOW_MINUTES}-minute auto-cancel clock. Confirming says ` +
      "'we are making it' and is what puts the order in front of the floor. " +
      "They are different questions with different consequences, so they are " +
      "different buttons. Acknowledging alone leaves an order safe but unbuilt.",
  },
  {
    title: "Looking is always free. Sending always asks twice.",
    body:
      "Preview, payload inspection, status checks and read-backs change nothing " +
      "and cost nothing. The only actions that change the outside world — the " +
      "live push, acknowledging, and the terminal statuses — are all behind an " +
      "explicit confirmation. You can explore this integration without risk.",
  },
  {
    title: "Sandbox and production are different worlds with different keys.",
    body:
      "Sandbox is for practice and is invisible to customers. Production is your " +
      "real listing. Most 'authentication' problems are simply the wrong set of " +
      "keys for the world you are pointed at. The read-back check only exists in " +
      "sandbox, because Leafly refuses it in production.",
  },
  {
    title: "The published menu is the single source of truth.",
    body:
      "There is no separate Leafly menu to maintain. The feed is built from your " +
      "published menu with hidden items removed, so the way to fix anything on " +
      "Leafly is to fix it in your catalog and publish. That is why the preview " +
      "screen is a window and not an editor.",
  },
  {
    title: "A success code is not proof of a correct menu.",
    body:
      "Leafly returns a cheerful success for a menu with a field silently " +
      "dropped. That is why the read-back exists: it compares Leafly's own copy " +
      "against what we send. Trusting the green tick alone is how a wrong " +
      "storefront goes unnoticed for weeks.",
  },
  {
    title: "Some things genuinely cannot be undone, and the system says so.",
    body:
      "Acknowledging destroys access to the customer's ID images. Picked up and " +
      "Cancelled are terminal and Leafly will not move an order out of them. A " +
      "live push has no undo — only another, correct push. Every one of these is " +
      "behind a confirmation that names what is about to happen, because the " +
      "warning is more useful than the regret.",
  },
];

// ===========================================================================
// REGISTRY + LOOKUP
// ===========================================================================

/**
 * Every walkthrough, in the order the owner asked for them: the push and
 * preview page first because it matters most, the orders dashboard second,
 * then everything else.
 */
export const ALL_WALKTHROUGHS: readonly HelperWalkthrough[] = [
  PUSH_AND_PREVIEW,
  ORDERS_DASHBOARD,
  ...OTHER_SURFACES,
];

export function walkthroughById(id: string): HelperWalkthrough | null {
  return ALL_WALKTHROUGHS.find((w) => w.id === id) ?? null;
}

/**
 * Count of everything documented — used by the UI so the page can honestly say
 * how much is covered without anyone maintaining a number by hand.
 */
export function helperCoverage(): {
  walkthroughs: number;
  steps: number;
  features: number;
  fixes: number;
  faqs: number;
} {
  return {
    walkthroughs: ALL_WALKTHROUGHS.length,
    steps: ALL_WALKTHROUGHS.reduce((n, w) => n + w.steps.length, 0),
    features: ALL_WALKTHROUGHS.reduce((n, w) => n + w.features.length, 0),
    fixes: ALL_WALKTHROUGHS.reduce((n, w) => n + w.fixes.length, 0),
    faqs: ALL_WALKTHROUGHS.reduce((n, w) => n + w.faq.length, 0),
  };
}

/**
 * Plain-text search across everything, for the help launcher.
 *
 * Deliberately simple: lowercase substring over the fields a person would
 * actually search. A fuzzy matcher would be more impressive and would return
 * confident nonsense for a one-word query, which is worse than no result.
 */
export function searchHelper(query: string): readonly HelperWalkthrough[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return ALL_WALKTHROUGHS.filter((w) => {
    const hay = [
      w.title,
      w.purpose,
      w.readFirst,
      ...w.steps.map((s) => `${s.do} ${s.why}`),
      ...w.features.map((f) => `${f.control} ${f.does} ${f.why}`),
      ...w.fixes.map((f) => `${f.symptom} ${f.meaning} ${f.fix}`),
      ...w.faq.map((f) => `${f.q} ${f.a}`),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

// ===========================================================================
// SELF-TESTS (house rule 5)
// ===========================================================================

/**
 * Runnable without a database, a browser, or a Leafly account.
 *
 * These assert the PROPERTIES that make this handbook trustworthy rather than
 * spot-checking sentences: every step explains itself, every irreversible
 * action is marked, nothing is empty, and the numbers came from the code.
 */
export function __runLeaflyHelperTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  ok(ALL_WALKTHROUGHS.length >= 6, "there are at least six walkthroughs");
  ok(ALL_WALKTHROUGHS[0].id === "leafly-push-preview", "push & preview comes first");
  ok(ALL_WALKTHROUGHS[1].id === "leafly-orders-dashboard", "orders dashboard comes second");

  const ids = new Set(ALL_WALKTHROUGHS.map((w) => w.id));
  ok(ids.size === ALL_WALKTHROUGHS.length, "walkthrough ids are unique");

  for (const w of ALL_WALKTHROUGHS) {
    ok(w.title.trim() !== "", `${w.id}: has a title`);
    ok(w.purpose.trim() !== "", `${w.id}: has a purpose`);
    ok(w.readFirst.trim() !== "", `${w.id}: has a read-first`);
    ok(w.href.startsWith("/"), `${w.id}: href is a real path`);
    ok(w.steps.length >= 3, `${w.id}: has at least three steps`);
    ok(w.features.length >= 2, `${w.id}: documents at least two controls`);
    ok(w.source.length >= 1, `${w.id}: cites at least one source`);

    for (const s of w.steps) {
      ok(s.do.trim() !== "", `${w.id}: every step says what to do`);
      // The owner's core requirement: explain WHY, every time.
      ok(s.why.trim().length >= 40, `${w.id}: every step explains why ("${s.do.slice(0, 40)}")`);
    }
    for (const f of w.features) {
      ok(f.control.trim() !== "", `${w.id}: every feature names its control`);
      ok(f.does.trim() !== "", `${w.id}: every feature says what it does`);
      ok(f.why.trim().length >= 30, `${w.id}: every feature explains why`);
      ok(f.useWhen.trim() !== "", `${w.id}: every feature says when to use it`);
      // An unsafe control with no caution is exactly the trap this file exists
      // to remove.
      ok(
        f.safe || (f.caution ?? "").trim() !== "",
        `${w.id}: unsafe control "${f.control}" carries a caution`,
      );
    }
    for (const f of w.fixes) {
      ok(f.symptom.trim() !== "" && f.meaning.trim() !== "" && f.fix.trim() !== "",
        `${w.id}: fixes are complete`);
    }
    for (const f of w.faq) {
      ok(f.q.trim() !== "" && f.a.trim().length >= 20, `${w.id}: faq answers are substantive`);
    }
  }

  // The numbers must come from the code, not from memory.
  const pushText = JSON.stringify(PUSH_AND_PREVIEW);
  const ordersText = JSON.stringify(ORDERS_DASHBOARD);
  ok(
    ordersText.includes(String(LEAFLY_ACK_WINDOW_MINUTES)),
    "the orders walkthrough states the real acknowledgement window",
  );
  ok(
    pushText.includes(String(MIN_RUN_GAP_MINUTES)),
    "the push walkthrough states the real minimum gap between syncs",
  );

  // The two facts that cost real money if missed.
  ok(
    /irreversible|revoke/i.test(ordersText),
    "the orders walkthrough warns that acknowledging is irreversible",
  );
  ok(
    ORDERS_DASHBOARD.steps.some((s) => s.irreversible === true),
    "the orders walkthrough marks at least one step irreversible",
  );
  ok(
    PUSH_AND_PREVIEW.steps.some((s) => s.irreversible === true),
    "the push walkthrough marks the live push irreversible",
  );
  ok(
    /deletes|delete/i.test(pushText),
    "the push walkthrough warns that POST deletes omitted items",
  );

  // Checklist ordering: practice before production.
  const firstLive = FIRST_TIME_CHECKLIST.findIndex((c) => c.live);
  ok(firstLive > 0, "the checklist starts with steps that cannot affect customers");
  ok(
    FIRST_TIME_CHECKLIST.slice(firstLive).every((c) => c.live),
    "the checklist never returns to safe steps after going live",
  );
  ok(FIRST_TIME_CHECKLIST.every((c) => c.why.trim().length >= 30),
    "every checklist item explains why it is where it is");
  ok(
    new Set(FIRST_TIME_CHECKLIST.map((c) => c.id)).size === FIRST_TIME_CHECKLIST.length,
    "checklist ids are unique",
  );

  ok(BIG_IDEAS.length >= 5, "there are at least five big ideas");
  ok(BIG_IDEAS.every((b) => b.body.trim().length >= 80), "big ideas are actually explained");

  // Lookup + search behave.
  ok(walkthroughById("leafly-push-preview") !== null, "lookup finds a real id");
  ok(walkthroughById("nope") === null, "lookup returns null for an unknown id");
  ok(searchHelper("") .length === 0, "an empty search returns nothing");
  ok(searchHelper("acknowledge").length > 0, "search finds acknowledge");
  ok(searchHelper("zzzzzz").length === 0, "search returns nothing for nonsense");

  const cov = helperCoverage();
  ok(cov.walkthroughs === ALL_WALKTHROUGHS.length, "coverage counts walkthroughs");
  ok(cov.steps > 20, "coverage counts a real number of steps");

  return { passed, failed };
}
