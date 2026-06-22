export type PolicySection = {
  title: string;
  body: string;
};

export type PolicyPreviewRecord = {
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string;
  sections: PolicySection[];
  replacementNotes: string[];
};

export const policyPreviews: Record<string, PolicyPreviewRecord> = {
  privacy: {
    eyebrow: "Privacy policy draft",
    title: "Privacy content placeholder for legal review.",
    description:
      "This page reserves the source-listed privacy-policy route and explains the current preview state. Final privacy language should be supplied or reviewed by qualified counsel before production publishing.",
    statusLabel: "Draft placeholder",
    sections: [
      {
        title: "Current preview behavior",
        body: "The current Greenway preview uses a local browser age confirmation and mock commerce flows. It should not be treated as a final statement of production analytics, advertising, account, payment, identity, or order-data handling.",
      },
      {
        title: "Sensitive information guardrail",
        body: "Production pages should clearly explain if and how personal information is collected, used, stored, shared, retained, or deleted. Cannabis-related browsing and ordering information can be sensitive and should be handled with extra care.",
      },
      {
        title: "Before launch",
        body: "Replace this draft with verified privacy practices, vendor details, cookie/analytics disclosures, contact methods, Washington-specific requirements, and any required consumer rights language.",
      },
    ],
    replacementNotes: [
      "Confirm what data the production site actually collects before writing final policy language.",
      "Review analytics, forms, Leafly/POS integrations, age-gate behavior, and checkout workflows before launch.",
      "Add official contact details only after Greenway approves the production public contact method.",
    ],
  },
  terms: {
    eyebrow: "Terms of use draft",
    title: "Terms content placeholder for legal review.",
    description:
      "This page reserves the source-listed terms-of-use route. The copy is intentionally non-final because enforceable website terms should be tailored to Greenway’s actual services, policies, and legal requirements.",
    statusLabel: "Draft placeholder",
    sections: [
      {
        title: "Website preview status",
        body: "The current site is a preview build for adults 21 and older. Mock menu, cart, checkout, confirmation, product, and specials experiences do not create real orders, reserve inventory, process payments, or notify store staff.",
      },
      {
        title: "Cannabis compliance expectations",
        body: "Final production terms should explain age restrictions, ID requirements, product availability limits, purchase limits, pricing/tax confirmation, pickup rules, prohibited conduct, and any state-specific restrictions.",
      },
      {
        title: "Before launch",
        body: "Replace this draft with reviewed terms that match Greenway’s verified operations, website functionality, ordering process, promotions, accessibility commitments, disclaimers, and dispute-resolution approach.",
      },
    ],
    replacementNotes: [
      "Do not enable live ordering until terms match the actual order and pickup flow.",
      "Confirm final promotion, pricing, tax, cancellation, and inventory-availability language.",
      "Have final terms reviewed before using them as binding public website terms.",
    ],
  },
  consumerHealth: {
    eyebrow: "Consumer health data draft",
    title: "Consumer health data placeholder for review.",
    description:
      "This page reserves the source-listed consumer-health-data route and acknowledges that cannabis-related information can be sensitive. Final language should be reviewed before production launch.",
    statusLabel: "Draft placeholder",
    sections: [
      {
        title: "Why this page exists",
        body: "The project blueprint includes a consumer health data policy route. This preview creates the destination without claiming that a final policy has been approved or that production collection practices are already defined.",
      },
      {
        title: "Current preview limitation",
        body: "The preview checkout does not collect payment information, medical information, identity documents, or live order data. Product browsing and mock cart behavior remain non-production planning interfaces.",
      },
      {
        title: "Before launch",
        body: "Replace this placeholder with reviewed disclosures describing any consumer health data categories, purposes, sharing, retention, deletion rights, consent workflows, and official request channels that apply to Greenway’s production site.",
      },
    ],
    replacementNotes: [
      "Confirm whether production workflows collect information that may qualify as consumer health data.",
      "Coordinate final wording with privacy policy, terms, Leafly/POS workflows, and customer support procedures.",
      "Avoid collecting sensitive information until policies, consent, security, and operational handling are ready.",
    ],
  },
};
