/**
 * src/lib/staffing/handbook-content.ts  (Task S-b)
 *
 * The Greenway Marijuana employee handbook — professional policies sized for
 * a small (≤10 person) WA I-502 cannabis retailer, grounded in the verified
 * rules in docs/EMPLOYEE_COMPLIANCE.md. Rendered print-friendly at
 * /admin/staffing/handbook; each employee reads it and signs the
 * acknowledgment, which is tracked in the document tracker ("handbook").
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

export const HANDBOOK_VERSION = "1.0";

export const HANDBOOK_SECTIONS: HandbookSection[] = [
  {
    id: "welcome",
    title: "Welcome",
    paragraphs: [
      "Welcome to Greenway Marijuana. We are a licensed Washington cannabis retailer (WSLCB license 413541, Port Orchard). This handbook explains how we work, what we expect from you, and what you can expect from us. Because we sell a highly regulated product, several of these policies are legal requirements — following them protects your job and the store's license.",
      "This handbook is not an employment contract. Employment at Greenway is at-will: either you or the store may end the employment relationship at any time, with or without cause or notice, subject to applicable law. No one other than the owner can modify the at-will relationship, and only in writing.",
    ],
  },
  {
    id: "eeo",
    title: "Equal opportunity & respectful workplace",
    paragraphs: [
      "We hire, promote, schedule, discipline, and pay based on merit and business needs — never on race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, veteran or marital status, or any other characteristic protected by federal or Washington law (RCW 49.60).",
      "Harassment, discrimination, and retaliation are prohibited. If you experience or witness any of it, report it to the owner immediately. Reports are handled promptly and as confidentially as possible, and retaliation for a good-faith report is itself a policy violation.",
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
      "You must be trained on our store rules and on identifying customers under 21 before serving anyone (RCW 69.50.357). Training is logged and kept for 5 years (WAC 314-55-087).",
      "You must wear your store-issued photo ID badge at all times on the premises (WAC 314-55-083). Lost badges must be reported the same day.",
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
      "Be honest with customers: no medical or curative claims about products — describe effects only in the terms allowed on the label.",
      "Treat coworkers, customers, and inspectors with courtesy. LCB officers may enter at any time; greet them, get a manager, and cooperate.",
      "Personal phones stay off the sales floor except on breaks; cameras record the register and sales floor at all times.",
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
    id: "safety",
    title: "Safety, security & cash handling",
    paragraphs: [
      "We are a cash-heavy business, so security rules protect people first and money second:",
    ],
    bullets: [
      "In a robbery: comply, don't resist, don't chase. People over property, always. Call 911 and the owner when safe.",
      "Only assigned employees open their drawer; drawers are counted at open and close, and discrepancies are documented the same day.",
      "Keep the back door locked; deliveries are received per the manifest procedure and never left unattended.",
      "Report unsafe conditions, injuries, and near-misses to the manager immediately — L&I workplace-safety rules apply to us like any employer.",
    ],
  },
  {
    id: "confidentiality",
    title: "Confidentiality & customer privacy",
    paragraphs: [
      "Customer information (identity, purchases, medical status), sales data, security procedures, and vendor terms are confidential. Never photograph customers, discuss a customer's purchases, or share store data outside work. Medical cardholder information is protected health-adjacent data — treat it with extra care and never discuss it on the floor.",
    ],
  },
  {
    id: "discipline",
    title: "Discipline & how problems are handled",
    paragraphs: [
      "For most issues we use progressive steps: a verbal coaching, then a written warning, then final warning or termination — but the store may skip steps for serious violations (compliance rules marked * above, theft, harassment, violence, working impaired). Every disciplinary step is documented in your file.",
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
    title: "Acknowledgment (sign and return)",
    paragraphs: [
      `I acknowledge that I received and read the Greenway Marijuana Employee Handbook (version ${HANDBOOK_VERSION}). I understand its policies, including the compliance rules that Washington law requires of cannabis-retail employees, and I understand that my employment is at-will. I agree to follow these policies and to ask the owner or a manager when anything is unclear.`,
      "Employee name: ______________________________    Signature: ______________________________    Date: ______________",
    ],
  },
];
