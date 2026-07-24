/**
 * src/lib/staffing/handbook-content.ts  (Task S-b; expanded in SLICE 36)
 *
 * The Greenway Marijuana employee handbook — professional, full-scope policies
 * for a small (≤10 person) WA I-502 cannabis retailer, grounded in the
 * verified rules in docs/EMPLOYEE_COMPLIANCE.md and docs/COMPLIANCE_BIBLE.md.
 * Rendered print-friendly at /admin/staffing/handbook; every employee must
 * READ it and ACKNOWLEDGE it (digital checkbox, recorded per person and per
 * version) BEFORE they are given access to the back office or the register —
 * see src/lib/staffing/handbook-ack-core.ts for the gate.
 *
 * This is store policy text, not legal advice — the owner should have counsel
 * review before adopting. Statute/rule citations are included so every policy
 * can be traced to its source.
 */

export type HandbookSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export const HANDBOOK_VERSION = "2.0";

export const HANDBOOK_SECTIONS: HandbookSection[] = [
  {
    id: "welcome",
    title: "Welcome",
    paragraphs: [
      "Welcome to Greenway Marijuana. We are a licensed Washington cannabis retailer (WSLCB license 413541, Port Orchard). This handbook explains how we work, what we expect from you, and what you can expect from us. Because we sell a highly regulated product, several of these policies are legal requirements — following them protects your job and the store's license.",
      "This handbook is not an employment contract. Employment at Greenway is at-will: either you or the store may end the employment relationship at any time, with or without cause or notice, subject to applicable law. No one other than the owner can modify the at-will relationship, and only in writing.",
      "You must read this entire handbook and record your acknowledgment before you are given access to the back office or the register. When the handbook changes, the version number changes and you will be asked to read and acknowledge it again.",
    ],
  },
  {
    id: "eeo",
    title: "Equal opportunity & respectful workplace",
    paragraphs: [
      "We hire, promote, schedule, discipline, and pay based on merit and business needs — never on race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, veteran or marital status, or any other characteristic protected by federal or Washington law (RCW 49.60).",
      "Harassment, discrimination, and retaliation are prohibited. This includes unwelcome sexual advances, offensive jokes or slurs, intimidation, and any conduct that creates a hostile working environment — whether from a coworker, a manager, a vendor, or a customer. If you experience or witness any of it, report it to the owner immediately. Reports are handled promptly and as confidentially as possible, and retaliation for a good-faith report is itself a policy violation.",
    ],
  },
  {
    id: "eligibility",
    title: "Who can work here (legal requirements)",
    paragraphs: [
      "Washington law sets non-negotiable conditions of employment at a licensed cannabis retailer:",
    ],
    bullets: [
      "You must be at least 21 years old (RCW 69.50.357). We verify this from your ID before your first shift.",
      "You must complete Form I-9 Section 1 by your first day; we complete Section 2 within 3 business days.",
      "Fair hiring: we follow the Washington Fair Chance Act (RCW 49.94.010) — we never ask about criminal history or run a background check until AFTER a conditional offer of employment, and a record alone is not an automatic disqualifier.",
      "You must be trained on our store rules and on identifying customers under 21 before serving anyone (RCW 69.50.357). Training is logged and kept for 5 years (WAC 314-55-087).",
      "You must wear your store-issued photo ID badge at all times on the premises (WAC 314-55-083). Lost badges must be reported the same day.",
      "You must read this handbook and record your acknowledgment before receiving register or back-office access.",
    ],
  },
  {
    id: "id-checks",
    title: "Checking ID — our most important job",
    paragraphs: [
      "Selling to anyone under 21 can cost the store its license and expose you personally to criminal liability. There are no exceptions and no warnings for skipping this rule.",
    ],
    bullets: [
      "Check acceptable ID (valid driver's license, state ID, passport, military ID) for EVERY customer who reasonably appears under 30 — when in doubt, card.",
      "If the ID is expired, altered, or doesn't match the person, refuse the sale and tell a manager.",
      "Never sell to anyone who is visibly intoxicated or who you believe is buying for a minor.",
      "The doorway is a restricted area: no one under 21 may enter the sales floor, ever.",
      "Every refusal is a success, not a problem. Log refusals in the register so the store can show its diligence.",
    ],
  },
  {
    id: "sales-rules",
    title: "Selling legally — limits, hours & pricing",
    paragraphs: [
      "The register enforces these rules automatically, but you are the last line of defense and are expected to understand them:",
    ],
    bullets: [
      "Single-transaction limits (WAC 314-55-095 / RCW 69.50.360): the register blocks over-limit carts. Never split a sale into multiple transactions to dodge the limit — that is diversion and grounds for immediate termination.",
      "Sales hours: cannabis may only be sold between 8:00 AM and midnight (WAC 314-55-147), and only within the store's configured hours. Never ring a sale outside the window, even for a friend at the door.",
      "No free cannabis and no below-cost sales, ever (RCW 69.50.357; WAC 314-55-079(7)). All discounts flow through the register's promotion engine, which enforces the legal floors — never invent a discount by hand.",
      "Advertised price must equal charged price (WAC 314-55-155 family). If a shelf tag disagrees with the register, stop and tell a manager.",
      "Internet sales and delivery to customers are prohibited (WAC 314-55-079(5)). Online orders are pickup-only, verified in person.",
      "No medical or curative claims about products. Describe effects only in terms allowed on the label; medical questions go to our certified medical cannabis consultant.",
    ],
  },
  {
    id: "conduct",
    title: "Code of conduct & compliance rules",
    paragraphs: [
      "These rules come straight from the LCB rulebook and from common sense. Violating the starred (*) items is grounds for immediate termination:",
    ],
    bullets: [
      "* No consuming cannabis or alcohol on the premises or working while impaired (RCW 69.50.357).",
      "* No sales outside legal hours, no sales over the legal possession limits, and no free cannabis — every product must be sold at or above what the register allows.",
      "* No diverting product: every gram is tracked. Employee samples are only received through the manager sample program and logged.",
      "* No sharing register PINs, door codes, or back-office passwords. Your PIN identifies YOU on the time clock and register.",
      "* No theft of product, cash, or store property of any value — including 'borrowing', unauthorized discounts, and sweethearting (undercharging friends or family).",
      "Be honest with customers: no medical or curative claims about products — describe effects only in the terms allowed on the label.",
      "Treat coworkers, customers, and inspectors with courtesy. LCB officers may enter at any time; greet them, get a manager, and cooperate.",
      "Personal phones stay off the sales floor except on breaks; cameras record the register and sales floor at all times.",
    ],
  },
  {
    id: "customer-service",
    title: "Customer service standards",
    paragraphs: [
      "We are a neighborhood store and our reputation is built one interaction at a time. Professional retail standards apply here just like anywhere else:",
    ],
    bullets: [
      "Greet every customer who walks in. Nobody waits at the counter while staff chat.",
      "Know the menu. If you don't know an answer, say so and find someone who does — never guess about potency, dosage, or effects.",
      "Handle complaints calmly: listen, apologize for the experience, and get a manager for anything involving a refund, an exchange, or a dispute. Never argue with a customer on the floor.",
      "Returns follow the posted policy and the LCB rules (WAC 314-55-079(12)): opened product only in original packaging with legible lot/batch ID, always through the register's return flow.",
      "De-escalate, don't confront. If a customer becomes abusive or threatening, step back, get a manager, and let them handle it. Your safety outranks any sale.",
    ],
  },
  {
    id: "dress-code",
    title: "Dress code, hygiene & badges",
    paragraphs: [
      "Dress like a professional who handles a regulated product all day:",
    ],
    bullets: [
      "Clean, presentable clothing; closed-toe shoes on the floor and in the back room.",
      "Your store-issued photo ID badge is visible at ALL times on the premises (WAC 314-55-083) — no badge, no floor.",
      "No clothing that promotes other cannabis brands, or that displays offensive images or language.",
      "Basic hygiene matters: you handle products customers take home. Wash hands after eating and before handling product.",
    ],
  },
  {
    id: "attendance",
    title: "Schedules, attendance & the time clock",
    paragraphs: [
      "Schedules are built in the back office and published a week at a time; check yours before leaving each week. If you can't make a shift, tell the manager as early as possible so we can cover it — no-call/no-show is a serious violation.",
      "Clock in and out with your personal PIN at the station or from your phone. Never punch for another employee. If you forget a punch, tell a manager the same day — punches can only be corrected with a reason, and every correction is logged.",
    ],
  },
  {
    id: "pay",
    title: "Pay, overtime & breaks",
    paragraphs: [
      "You are paid at least Washington minimum wage on the regular payroll schedule. Non-exempt employees earn overtime at 1.5× the regular rate for hours over 40 in a workweek (RCW 49.46.130).",
    ],
    bullets: [
      "Meal period: an unpaid 30-minute meal when you work more than 5 hours, starting between your 2nd and 5th hour (WAC 296-126-092).",
      "Rest breaks: a paid 10-minute break for every 4 hours worked, as close to the middle of the period as practical.",
      "Tips (if offered at the register) are pooled and paid out per the posted tip policy — tips belong to staff, never to the store (RCW 49.46.020(3)).",
      "Your final paycheck after separation is paid at the end of the established pay period (RCW 49.48.010).",
    ],
  },
  {
    id: "sick-leave",
    title: "Paid sick leave (WA law)",
    paragraphs: [
      "You accrue at least 1 hour of paid sick leave for every 40 hours worked, starting on your first day (RCW 49.46.210). You can begin using it on your 90th calendar day of employment. Your balance appears with your payroll information at least monthly.",
    ],
    bullets: [
      "Use it for your own or a family member's illness, medical appointments, closures ordered by a public official, and reasons covered by WA's domestic-violence leave law.",
      "Up to 40 hours of unused leave carries over to the next year.",
      "You will never be disciplined for lawfully using sick leave. We may ask for verification only for absences longer than 3 scheduled days.",
      "If you leave and are rehired within 12 months, your unused balance is reinstated.",
    ],
  },
  {
    id: "cash-handling",
    title: "Cash handling & register accountability",
    paragraphs: [
      "We are a cash-heavy business. Every dollar is counted, every drawer belongs to one person, and every discrepancy is documented:",
    ],
    bullets: [
      "One drawer, one person: only the assigned employee opens their drawer. Drawer swaps go through the register's safe-count flow with both people present.",
      "Drawers are counted at open and close; discrepancies are documented the same day, with the manager, no exceptions.",
      "Large bills are checked with the counterfeit pen; drops to the safe happen per the posted schedule so drawers never hold more than the float policy allows.",
      "Refunds, voids, and price overrides require a manager's approval and are all logged with names attached.",
      "Never count cash on the sales floor, never leave a drawer open and unattended, and never take the deposit route or schedule details outside the store.",
    ],
  },
  {
    id: "loss-prevention",
    title: "Loss prevention & product diversion",
    paragraphs: [
      "Every gram in this store is tracked from delivery to sale (WAC 314-55-083/-087). Diversion — product leaving without a compliant sale — is the fastest way to lose a cannabis license, and Washington treats it as a crime, not a policy issue:",
    ],
    bullets: [
      "All product lives behind the counter or in locked storage; customers never have direct access (WAC 314-55-079(8)).",
      "Deliveries are received against the manifest, counted, and put away immediately — never left on the floor or unattended.",
      "Inventory discrepancies found during counts are reported to the manager the same day; the store reports required discrepancies to the LCB.",
      "Employee purchases happen like any customer's: off the clock, rung by ANOTHER employee, ID checked, receipt kept. Never ring your own sale.",
      "Damaged, returned, or expired product is quarantined and destroyed per the LCB waste rules (WAC 314-55-097) — never taken home.",
      "If you suspect a coworker of theft or diversion, report it to the owner directly and confidentially. Protecting the license protects every job here.",
    ],
  },
  {
    id: "safety",
    title: "Safety, security & emergencies",
    paragraphs: [
      "Security rules protect people first and money second:",
    ],
    bullets: [
      "In a robbery: comply, don't resist, don't chase. People over property, always. Call 911 and the owner when safe.",
      "Keep the back door locked; deliveries are received per the manifest procedure and never left unattended.",
      "Cameras record the register, sales floor, and entrances at all times; recordings are retained per LCB rules and are not optional.",
      "Only on-duty staff and escorted, logged visitors are allowed behind the counter or in the back room. Friends and family wait on the customer side.",
      "Weapons are not permitted on the premises except as the law requires us to allow.",
      "Workplace violence, threats, and intimidation — by anyone, against anyone — are reported immediately and may be grounds for immediate termination and a police report.",
      "Report unsafe conditions, injuries, and near-misses to the manager immediately — L&I workplace-safety rules apply to us like any employer.",
    ],
  },
  {
    id: "drug-alcohol",
    title: "Drug & alcohol policy",
    paragraphs: [
      "We sell cannabis; we do not consume it at work. This is a legal requirement, not a preference (RCW 69.50.357):",
    ],
    bullets: [
      "No consuming cannabis or alcohol on the licensed premises, ever — including the parking lot, the back room, and breaks.",
      "Never work impaired. If a manager reasonably believes you are impaired on shift, you will be sent home and the incident documented; repeat incidents end employment.",
      "What you do off the clock and off the premises is your business, so long as you arrive fit for duty.",
      "Employee samples exist ONLY through the logged manager sample program (vendor samples per WAC 314-55-096) — nothing leaves the building any other way.",
    ],
  },
  {
    id: "phones-social",
    title: "Phones, social media & store information",
    paragraphs: [
      "Cannabis advertising is heavily restricted (WAC 314-55-155; RCW 69.50.369), so what you post about the store is a compliance issue, not just an image issue:",
    ],
    bullets: [
      "Personal phones stay off the sales floor except on breaks. No photos or video anywhere product, customers, cameras, safes, or registers are visible.",
      "Never photograph or identify a customer, ever. Customer privacy is absolute.",
      "Only the owner (or someone the owner designates) posts on the store's behalf. Don't reply to reviews, post prices or promos, or speak for the store on any platform.",
      "If you mention working here on your own accounts, keep product claims out of it — no health claims, no 'deals', nothing aimed at anyone under 21.",
    ],
  },
  {
    id: "confidentiality",
    title: "Confidentiality & customer privacy",
    paragraphs: [
      "Customer information (identity, purchases, medical status), sales data, security procedures, and vendor terms are confidential. Never photograph customers, discuss a customer's purchases, or share store data outside work. Medical cardholder information is protected health-adjacent data — treat it with extra care and never discuss it on the floor.",
      "This obligation continues after your employment ends.",
    ],
  },
  {
    id: "inspections",
    title: "Inspections & law enforcement",
    paragraphs: [
      "LCB enforcement officers may enter and inspect the licensed premises at any time. This is normal and expected:",
    ],
    bullets: [
      "Greet the officer, ask for identification, and get a manager or the owner immediately.",
      "Be polite and cooperative. Answer honestly what you know; say 'I don't know, let me get the manager' for what you don't. Never guess and never obstruct.",
      "For any other law enforcement or government visitor, the same rule applies: manager first, cooperation always, records requests handled by the owner.",
    ],
  },
  {
    id: "conflicts",
    title: "Conflicts of interest & outside work",
    paragraphs: [
      "Working a second job is fine. Working against the store is not:",
    ],
    bullets: [
      "Tell the owner if you work for (or have a financial stake in) another cannabis licensee, a vendor, or a supplier — most of the time it's fine, but the LCB's true-party-of-interest rules mean the owner must know.",
      "Never accept personal gifts, kickbacks, or free product from vendors. Vendor samples flow only through the logged sample program.",
      "Don't use store data (sales numbers, pricing, customer lists) for anything outside your job here.",
    ],
  },
  {
    id: "discipline",
    title: "Discipline — how problems are handled",
    paragraphs: [
      "For most issues we use progressive steps, applied consistently to everyone. Every step is documented in your file with the date, the facts, and the expected correction:",
    ],
    bullets: [
      "Step 1 — Verbal coaching: a documented conversation about what needs to change (e.g. a first tardy, a dress-code miss).",
      "Step 2 — Written warning: repeated or more serious issues (e.g. a no-call/no-show, repeated tardiness, careless till discrepancy).",
      "Step 3 — Final warning: continued issues after a written warning, or a single serious lapse that falls short of immediate termination.",
      "Step 4 — Termination: continued issues after a final warning.",
      "IMMEDIATE termination (no progressive steps) for the compliance rules marked * in the code of conduct, plus: theft or diversion of any amount, selling to a minor or skipping ID verification, harassment or violence, working impaired, sharing credentials, and falsifying records (time punches, counts, logs).",
      "Being honest when something goes wrong ALWAYS counts in your favor. Hiding a mistake is treated more seriously than the mistake itself.",
      "If you disagree with a decision, bring it to the owner directly. We are a small team; problems get solved fastest face-to-face.",
    ],
  },
  {
    id: "separation",
    title: "Leaving the store",
    paragraphs: [
      "We ask for (but do not require) two weeks' notice when you resign. On your last day you'll return your ID badge and any store property; your time-clock PIN and any back-office access end that day. Your final paycheck arrives at the end of the established pay period (RCW 49.48.010), and your employment records are retained for five years as the LCB requires (WAC 314-55-087).",
    ],
  },
  {
    id: "acknowledgment",
    title: "Acknowledgment",
    paragraphs: [
      `I acknowledge that I received and read the Greenway Marijuana Employee Handbook (version ${HANDBOOK_VERSION}). I understand its policies, including the compliance rules that Washington law requires of cannabis-retail employees, and I understand that my employment is at-will. I agree to follow these policies and standards and to ask the owner or a manager when anything is unclear. I understand that I must record this acknowledgment before I am given access to the back office or the register, and again whenever the handbook version changes.`,
      "Record your acknowledgment digitally (the checkbox below the handbook), or on paper: Employee name: ______________________  Signature: ______________________  Date: ____________",
    ],
  },
];
