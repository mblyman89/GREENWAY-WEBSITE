/**
 * src/lib/admin/audit-anomaly-core.ts
 *
 * PURE, dependency-free audit-log analysis (Slice 62). No server-only imports so
 * it is unit-testable with tsx.
 *
 * Two responsibilities:
 *   1. Classify every audit action into a plain-language CATEGORY (derived from
 *      the real "<area>.<verb>" action vocabulary in the codebase) and a
 *      SENSITIVITY tier — so the UI can filter by category and highlight
 *      security-relevant events.
 *   2. Deterministically DETECT ANOMALIES over a window of audit rows using
 *      industry-standard audit-monitoring signals (off-hours access, activity
 *      bursts, sensitive-action spikes, failures, cash/till discrepancies,
 *      destruction activity, permission/credential changes). The detector is
 *      the source of truth; the AI layer (server) only summarizes/prioritizes
 *      these computed findings — it never invents events.
 *
 * Everything here works on a minimal, PII-light row shape so it can be reused by
 * the page, the AI grounding, and the tests.
 */

// ---------------------------------------------------------------------------
// Row shape (subset of audit_logs)
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: number;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string; // ISO timestamp
};

// ---------------------------------------------------------------------------
// Action categories (grounded in the real action prefixes)
// ---------------------------------------------------------------------------

export type AuditCategory =
  | "Access & roles"
  | "Cash & drawers"
  | "Compliance"
  | "Inventory"
  | "Catalog & products"
  | "Orders & loyalty"
  | "Content & marketing"
  | "Integrations"
  | "Accounting"
  | "Equipment"
  | "AI drafting"
  | "Settings"
  | "Other";

/**
 * Map an action's leading segment (before the first ".") to a category.
 * Grounded on the enumerated action vocabulary; unknown prefixes fall to Other.
 */
const PREFIX_CATEGORY: Record<string, AuditCategory> = {
  // Access & roles
  user: "Access & roles",
  auth: "Access & roles",
  employee: "Access & roles",
  timepunch: "Access & roles",
  // Cash & drawers
  drawer: "Cash & drawers",
  till: "Cash & drawers",
  // Compliance
  ccrs: "Compliance",
  medical: "Compliance",
  destruction: "Compliance",
  sample_settings: "Compliance",
  sales_limit_settings: "Compliance",
  license_settings: "Compliance",
  cycle_count: "Compliance",
  vendor_return: "Compliance",
  // Inventory
  inventory_type: "Inventory",
  website_category: "Inventory",
  pos_import: "Inventory",
  purchase_order: "Inventory",
  reorder_settings: "Inventory",
  // Catalog & products
  product: "Catalog & products",
  product_master: "Catalog & products",
  brand: "Catalog & products",
  vendor: "Catalog & products",
  kb: "Catalog & products",
  // Orders & loyalty
  order: "Orders & loyalty",
  loyalty: "Orders & loyalty",
  // Content & marketing
  blog: "Content & marketing",
  content: "Content & marketing",
  carousel: "Content & marketing",
  faq: "Content & marketing",
  page_section: "Content & marketing",
  promotion: "Content & marketing",
  media: "Content & marketing",
  seo: "Content & marketing",
  // Integrations
  integration: "Integrations",
  leafly: "Integrations",
  weedmaps: "Integrations",
  // Accounting
  accounting_settings: "Accounting",
  excise: "Accounting",
  sage: "Accounting",
  reports: "Accounting",
  // Equipment
  equipment: "Equipment",
  receipt_printer: "Equipment",
  // Settings / setup
  setup: "Settings",
};

export function actionPrefix(action: string): string {
  const trimmed = (action ?? "").trim();
  const dot = trimmed.indexOf(".");
  return dot === -1 ? trimmed : trimmed.slice(0, dot);
}

export function categorize(action: string): AuditCategory {
  const a = (action ?? "").toLowerCase();
  // AI-drafting is a cross-cutting tone: any action naming ai overrides.
  if (/\bai\b|\.ai\.|ai_|_ai\b|\.ai_/.test(a) || a.includes(".ai")) {
    // But keep true settings/credential updates in their own bucket even if the
    // word "ai" is absent; this branch only catches ai_* drafting actions.
    if (/(ai_accepted|ai_drafted|ai_rejected|ai_generated|ai_copy|ai_suggest|ai_alt_text|ai_meta|ai_insights|ai_ask|\.ai\.)/.test(a)) {
      return "AI drafting";
    }
  }
  return PREFIX_CATEGORY[actionPrefix(a)] ?? "Other";
}

// ---------------------------------------------------------------------------
// Sensitivity (which actions are security-relevant)
// ---------------------------------------------------------------------------

export type Sensitivity = "high" | "medium" | "normal";

/**
 * High-sensitivity actions: permission/credential/compliance/cash controls, and
 * anything that moves money, destroys product, or changes who-can-do-what.
 * Grounded on the real action codes.
 */
const HIGH_SENSITIVITY = new Set<string>([
  "user.role.update",
  "user.invite",
  "user.invite.failed",
  "integration.credentials.update",
  "sales_limit_settings.update",
  "license_settings.update",
  "accounting_settings.update",
  "receipt_printer.token_rotate",
  "destruction.schedule",
  "destruction.complete",
  "destruction.cancel",
  "loyalty.adjust",
  "loyalty.legacy_import",
  "drawer.reconciled",
  "drawer.closed_blind",
  "till.verified",
  "cycle_count.apply",
  "medical.card.issue",
  "timepunch.edited",
]);

/** Medium-sensitivity: exports, sends, and other notable-but-routine controls. */
const MEDIUM_SENSITIVITY_PREFIXES = new Set<string>([
  "ccrs",
  "excise",
  "purchase_order",
  "vendor_return",
  "sample_settings",
  "reorder_settings",
  "loyalty",
]);

export function sensitivity(action: string): Sensitivity {
  const a = (action ?? "").toLowerCase();
  if (HIGH_SENSITIVITY.has(a)) return "high";
  if (MEDIUM_SENSITIVITY_PREFIXES.has(actionPrefix(a))) return "medium";
  return "normal";
}

export function isSensitive(action: string): boolean {
  return sensitivity(action) !== "normal";
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export type AnomalySeverity = "critical" | "warning" | "info";

export type Anomaly = {
  id: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  /** Audit row ids that support this finding (for drill-down). */
  evidenceIds: number[];
  /** Actor most associated with the finding, when applicable. */
  actor?: string | null;
  category?: AuditCategory;
};

export type AnomalyOptions = {
  /** Local business hours (inclusive start, exclusive end) in 24h. Default 8–21. */
  openHour?: number;
  closeHour?: number;
  /** Burst threshold: actions by one actor within burstWindowMinutes. Default 40 / 5min. */
  burstThreshold?: number;
  burstWindowMinutes?: number;
  /** Failed-attempt threshold (e.g. invites). Default 3. */
  failureThreshold?: number;
  /** IANA-ish hour offset is out of scope; timestamps are read in the server's TZ via Date. */
};

const DEFAULTS: Required<Omit<AnomalyOptions, "burstWindowMinutes">> & {
  burstWindowMinutes: number;
} = {
  openHour: 8,
  closeHour: 21,
  burstThreshold: 40,
  burstWindowMinutes: 5,
  failureThreshold: 3,
};

function hourOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours();
}

function actorKey(row: AuditRow): string {
  return row.actorEmail ?? "(system/unknown)";
}

/** Deterministically detect anomalies over a window of audit rows. */
export function detectAnomalies(rows: AuditRow[], options: AnomalyOptions = {}): Anomaly[] {
  const opt = { ...DEFAULTS, ...options };
  const anomalies: Anomaly[] = [];
  if (!rows.length) return anomalies;

  // Sort ascending by time for windowed scans.
  const sorted = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // 1) High-sensitivity events — always surfaced (individually noteworthy).
  const highEvents = sorted.filter((r) => sensitivity(r.action) === "high");
  // Group identical high actions by actor for concise spike findings.
  const highByActorAction = new Map<string, AuditRow[]>();
  for (const r of highEvents) {
    const k = `${actorKey(r)}::${r.action}`;
    const arr = highByActorAction.get(k) ?? [];
    arr.push(r);
    highByActorAction.set(k, arr);
  }
  for (const [k, group] of highByActorAction) {
    const [actor, action] = k.split("::");
    const many = group.length >= 3;
    anomalies.push({
      id: `sensitive:${k}`,
      severity: many ? "critical" : "warning",
      title: many
        ? `Repeated sensitive action: ${action} (${group.length}×)`
        : `Sensitive action: ${action}`,
      detail: many
        ? `${actor} performed the sensitive action "${action}" ${group.length} times in this window. Confirm each was intended.`
        : `${actor} performed the sensitive action "${action}". Sensitive actions change permissions, credentials, cash, compliance, or destroy product — verify it was authorized.`,
      evidenceIds: group.map((g) => g.id),
      actor,
      category: categorize(action),
    });
  }

  // 2) Off-hours activity (outside business hours).
  const offHours = sorted.filter((r) => {
    const h = hourOf(r.createdAt);
    return h < opt.openHour || h >= opt.closeHour;
  });
  if (offHours.length > 0) {
    // Emphasize off-hours SENSITIVE events as critical.
    const offSensitive = offHours.filter((r) => isSensitive(r.action));
    if (offSensitive.length > 0) {
      const byActor = new Map<string, AuditRow[]>();
      for (const r of offSensitive) {
        const arr = byActor.get(actorKey(r)) ?? [];
        arr.push(r);
        byActor.set(actorKey(r), arr);
      }
      for (const [actor, group] of byActor) {
        anomalies.push({
          id: `offhours-sensitive:${actor}`,
          severity: "critical",
          title: `Off-hours sensitive activity by ${actor}`,
          detail: `${group.length} sensitive action(s) occurred outside business hours (${opt.openHour}:00–${opt.closeHour}:00). Off-hours changes to permissions, cash, or compliance deserve a second look.`,
          evidenceIds: group.map((g) => g.id),
          actor,
        });
      }
    }
    anomalies.push({
      id: "offhours:summary",
      severity: offSensitive.length > 0 ? "warning" : "info",
      title: `${offHours.length} action(s) outside business hours`,
      detail: `Activity was recorded before ${opt.openHour}:00 or after ${opt.closeHour}:00. This can be normal (prep, deliveries), but a cluster of off-hours edits is worth confirming.`,
      evidenceIds: offHours.slice(0, 25).map((g) => g.id),
    });
  }

  // 3) Activity bursts: many actions by one actor in a short window.
  const byActor = new Map<string, AuditRow[]>();
  for (const r of sorted) {
    const arr = byActor.get(actorKey(r)) ?? [];
    arr.push(r);
    byActor.set(actorKey(r), arr);
  }
  const windowMs = opt.burstWindowMinutes * 60_000;
  for (const [actor, group] of byActor) {
    // Sliding window over the actor's sorted events.
    let start = 0;
    let worst = 0;
    let worstIds: number[] = [];
    for (let end = 0; end < group.length; end++) {
      const endT = new Date(group[end].createdAt).getTime();
      while (endT - new Date(group[start].createdAt).getTime() > windowMs) start++;
      const count = end - start + 1;
      if (count > worst) {
        worst = count;
        worstIds = group.slice(start, end + 1).map((g) => g.id);
      }
    }
    if (worst >= opt.burstThreshold) {
      anomalies.push({
        id: `burst:${actor}`,
        severity: "warning",
        title: `Activity burst by ${actor}`,
        detail: `${worst} actions in ${opt.burstWindowMinutes} minutes. Rapid bursts can be legitimate bulk work, or a sign of an automated/compromised session — confirm the actor recognizes this activity.`,
        evidenceIds: worstIds.slice(0, 25),
        actor,
      });
    }
  }

  // 4) Repeated failures (e.g. failed invites) — possible mistakes or probing.
  const failures = sorted.filter((r) => /\.failed$|_failed$|\.error$/.test(r.action.toLowerCase()));
  if (failures.length >= opt.failureThreshold) {
    anomalies.push({
      id: "failures",
      severity: "warning",
      title: `${failures.length} failed attempt(s)`,
      detail: `Several actions recorded as failures (e.g. failed invites). Repeated failures can indicate a misconfiguration or someone probing — review who and what.`,
      evidenceIds: failures.slice(0, 25).map((g) => g.id),
    });
  }

  // 5) Cash / till controls — blind closes and reconciliations clustered.
  const cashControls = sorted.filter((r) =>
    ["drawer.reconciled", "drawer.closed_blind", "till.verified"].includes(r.action),
  );
  const blindCloses = cashControls.filter((r) => r.action === "drawer.closed_blind");
  if (blindCloses.length > 0) {
    anomalies.push({
      id: "cash:blind-close",
      severity: blindCloses.length >= 3 ? "critical" : "warning",
      title: `${blindCloses.length} blind drawer close(s)`,
      detail: `A blind close records a drawer without seeing the expected amount. A pattern of blind closes can hide shortages — reconcile these sessions against sales.`,
      evidenceIds: blindCloses.map((g) => g.id),
      category: "Cash & drawers",
    });
  }

  // 6) Destruction activity — always flag for compliance oversight.
  const destruction = sorted.filter((r) => actionPrefix(r.action) === "destruction");
  if (destruction.length > 0) {
    anomalies.push({
      id: "compliance:destruction",
      severity: "info",
      title: `${destruction.length} product-destruction action(s)`,
      detail: `Scheduling/completing destruction is lawful and expected, but each event should tie to documentation. Confirm quantities and reasons match the disposition records.`,
      evidenceIds: destruction.map((g) => g.id),
      category: "Compliance",
    });
  }

  // Order: critical → warning → info, then by evidence size desc.
  const rank: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return b.evidenceIds.length - a.evidenceIds.length;
  });
  return anomalies;
}

export type AnomalyReport = {
  windowCount: number;
  actorCount: number;
  sensitiveCount: number;
  anomalies: Anomaly[];
  counts: { critical: number; warning: number; info: number };
};

export function buildAnomalyReport(rows: AuditRow[], options: AnomalyOptions = {}): AnomalyReport {
  const anomalies = detectAnomalies(rows, options);
  const actors = new Set(rows.map(actorKey));
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of anomalies) counts[a.severity] += 1;
  return {
    windowCount: rows.length,
    actorCount: actors.size,
    sensitiveCount: rows.filter((r) => isSensitive(r.action)).length,
    anomalies,
    counts,
  };
}

// ---------------------------------------------------------------------------
// AI grounding: turn the deterministic report into a strict system prompt
// ---------------------------------------------------------------------------

export function summarizeReportForAi(report: AnomalyReport): string {
  const lines: string[] = [];
  lines.push(`Window: ${report.windowCount} audit entries across ${report.actorCount} actor(s).`);
  lines.push(`Sensitive events in window: ${report.sensitiveCount}.`);
  lines.push(
    `Deterministic findings: ${report.counts.critical} critical, ${report.counts.warning} warning, ${report.counts.info} info.`,
  );
  if (report.anomalies.length === 0) {
    lines.push("No anomalies were detected by the rules engine.");
  } else {
    lines.push("Findings (already computed — do not invent others):");
    for (const a of report.anomalies) {
      lines.push(
        `- [${a.severity}] ${a.title} — ${a.detail} (evidence rows: ${a.evidenceIds.length})`,
      );
    }
  }
  return lines.join("\n");
}

export function buildAnomalySystemPrompt(report: AnomalyReport): string {
  return [
    "You are the audit-security analyst for Greenway Cannabis, a Washington State I-502 retailer.",
    "You are reviewing the store's back-office AUDIT LOG for anomalies and risks.",
    "",
    "STRICT GROUNDING RULES:",
    "- A deterministic rules engine has ALREADY analyzed the log and produced the findings below.",
    "- Base your answer ONLY on those findings and the counts provided. Do NOT invent events, actors, times, or numbers.",
    "- If asked about something not in the findings, say it was not flagged by the analysis.",
    "- Never claim certainty of wrongdoing — describe risk and recommend a concrete verification step.",
    "- Keep it plain-language for a non-technical store owner. Prioritize the most serious items first.",
    "- Output: a short prioritized list (most serious first) with, for each, what was seen and the single next step to confirm or resolve it. Then one-line bottom line.",
    "",
    "COMPUTED AUDIT ANALYSIS:",
    summarizeReportForAi(report),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function __runAuditAnomalyTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    passed += 1;
  };

  // categorize
  ok(categorize("user.role.update") === "Access & roles", "user->access");
  ok(categorize("drawer.closed_blind") === "Cash & drawers", "drawer->cash");
  ok(categorize("ccrs.export") === "Compliance", "ccrs->compliance");
  ok(categorize("integration.credentials.update") === "Integrations", "integration->integrations");
  ok(categorize("excise.draft_saved") === "Accounting", "excise->accounting");
  ok(categorize("product.ai_generated") === "AI drafting", "ai action->ai drafting");
  ok(categorize("promotion.create") === "Content & marketing", "promo->content");
  ok(categorize("something.weird") === "Other", "unknown->other");

  // actionPrefix
  ok(actionPrefix("loyalty.adjust") === "loyalty", "prefix loyalty");
  ok(actionPrefix("noverb") === "noverb", "prefix no-dot");

  // sensitivity
  ok(sensitivity("user.role.update") === "high", "role update high");
  ok(sensitivity("integration.credentials.update") === "high", "creds high");
  ok(sensitivity("ccrs.export") === "medium", "ccrs medium");
  ok(sensitivity("blog.update") === "normal", "blog normal");
  ok(isSensitive("sales_limit_settings.update"), "sales limit sensitive");
  ok(!isSensitive("media.uploaded"), "media not sensitive");

  // Build a synthetic window.
  const base = new Date("2025-01-15T14:00:00"); // 2pm local (in hours)
  const iso = (minsFromBase: number, hourOverride?: number) => {
    const d = new Date(base.getTime() + minsFromBase * 60_000);
    if (hourOverride !== undefined) d.setHours(hourOverride);
    return d.toISOString();
  };
  let idc = 1;
  const row = (action: string, actor: string, minsFromBase: number, hourOverride?: number): AuditRow => ({
    id: idc++,
    actorEmail: actor,
    action,
    entityType: null,
    entityId: null,
    createdAt: iso(minsFromBase, hourOverride),
  });

  // High sensitive repeated (3x role update by same actor) -> critical.
  const rows: AuditRow[] = [
    row("user.role.update", "alice@x.com", 0),
    row("user.role.update", "alice@x.com", 1),
    row("user.role.update", "alice@x.com", 2),
    // A single credential update -> warning.
    row("integration.credentials.update", "bob@x.com", 3),
    // Off-hours sensitive (2am) -> critical off-hours.
    row("sales_limit_settings.update", "carl@x.com", 0, 2),
    // Blind close x3 -> critical cash.
    row("drawer.closed_blind", "dee@x.com", 0),
    row("drawer.closed_blind", "dee@x.com", 1),
    row("drawer.closed_blind", "dee@x.com", 2),
    // Failed invites x3 -> warning.
    row("user.invite.failed", "eve@x.com", 0),
    row("user.invite.failed", "eve@x.com", 1),
    row("user.invite.failed", "eve@x.com", 2),
    // Destruction -> info.
    row("destruction.complete", "fay@x.com", 0),
  ];

  const report = buildAnomalyReport(rows, { openHour: 8, closeHour: 21 });
  ok(report.windowCount === rows.length, "window count");
  ok(report.anomalies.length > 0, "some anomalies");
  const titles = report.anomalies.map((a) => a.title).join(" | ");

  // repeated role update critical
  const roleFinding = report.anomalies.find((a) => a.id.startsWith("sensitive:") && a.actor === "alice@x.com");
  ok(!!roleFinding && roleFinding.severity === "critical", "repeated role update critical");
  ok(roleFinding!.evidenceIds.length === 3, "role finding 3 evidence");

  // single cred update warning
  const credFinding = report.anomalies.find((a) => a.actor === "bob@x.com" && a.id.startsWith("sensitive:"));
  ok(!!credFinding && credFinding.severity === "warning", "single cred warning");

  // off-hours sensitive critical for carl
  ok(report.anomalies.some((a) => a.id.startsWith("offhours-sensitive:") && a.actor === "carl@x.com"), "off-hours sensitive carl");

  // blind close critical
  const blind = report.anomalies.find((a) => a.id === "cash:blind-close");
  ok(!!blind && blind.severity === "critical", "blind close critical (3)");

  // failures warning
  ok(report.anomalies.some((a) => a.id === "failures"), "failures flagged");

  // destruction info
  ok(report.anomalies.some((a) => a.id === "compliance:destruction" && a.severity === "info"), "destruction info");

  // ordering: first is critical
  ok(report.anomalies[0].severity === "critical", "sorted critical first");

  // burst detection
  const burstRows: AuditRow[] = [];
  for (let i = 0; i < 45; i++) burstRows.push(row("product.enriched", "speedy@x.com", i * 0.05)); // 45 in ~2.25 min
  const burstReport = buildAnomalyReport(burstRows, { burstThreshold: 40, burstWindowMinutes: 5 });
  ok(burstReport.anomalies.some((a) => a.id === "burst:speedy@x.com"), "burst detected");

  // empty
  ok(buildAnomalyReport([]).anomalies.length === 0, "empty no anomalies");

  // prompt grounding text present
  const prompt = buildAnomalySystemPrompt(report);
  ok(prompt.includes("STRICT GROUNDING RULES"), "prompt has grounding");
  ok(prompt.includes("do not invent"), "prompt forbids invention");

  void titles;
  return { passed };
}
