/**
 * src/lib/platform/platform-changes.ts  (slice G-71b, owner message 12)
 *
 * THE PLATFORM-CHANGES REGISTER (standing rule 16). Every vendor change that
 * could break Greenway (Supabase, Vercel, Next.js, GitHub Actions, Node.js),
 * read from the vendor's own announcement, with what it means for this code
 * and what we do about it. docs/PLATFORM-CHANGES.md is the readable copy; a
 * test keeps the two in step.
 *
 * Why: in R-RET Supabase's announced 2026-10-30 change ("Tables not exposed to
 * Data and GraphQL API automatically", changelog 45329, published 2026-04-28)
 * broke customer returns. It was public six months ahead. A register read
 * every month would have turned it into a planned slice.
 *
 * How it is used: the daily platform-health cron emails a monthly review
 * reminder (first run of each Pacific month) and a warning 30, 7 and 1 days
 * before any open item's deadline, plus once when it is overdue.
 *
 * Every "not affected" below was checked against the repo on REVIEWED_ON
 * (grep of src/, supabase/migrations/ and .github/workflows/), not assumed.
 */

export type PlatformVendor = "supabase" | "vercel" | "nextjs" | "github" | "nodejs";
/**
 *  action-needed  we must change something (it becomes a slice before the deadline)
 *  watch          probably fine; confirm by the deadline or on the next review
 *  not-affected   checked: the change does not touch this code
 *  done           we acted; kept for the record
 */
export type PlatformChangeStatus = "action-needed" | "watch" | "not-affected" | "done";

export type PlatformChange = {
  id: string;
  vendor: PlatformVendor;
  title: string;
  /** Vendor's effective date (YYYY-MM-DD), or null when there is none. */
  deadline: string | null;
  source: string;
  status: PlatformChangeStatus;
  /** What it means for Greenway, in plain words, with the evidence. */
  impact: string;
  /** What we do. Required unless not-affected. */
  action: string;
};

/** The last day someone read every source and updated this register (Pacific). */
export const REGISTER_REVIEWED_ON = "2026-10-31";

/** Where to look each month (standing rule 16). */
export const PLATFORM_SOURCES: readonly { vendor: PlatformVendor; label: string; url: string }[] = [
  { vendor: "supabase", label: "Supabase changelog, breaking changes", url: "https://supabase.com/changelog?types=breaking-change" },
  { vendor: "supabase", label: "Supabase changelog, deprecations", url: "https://supabase.com/changelog?types=deprecation" },
  { vendor: "vercel", label: "Vercel changelog", url: "https://vercel.com/changelog" },
  { vendor: "nextjs", label: "Next.js support dates", url: "https://endoflife.date/nextjs" },
  { vendor: "nextjs", label: "Next.js releases", url: "https://github.com/vercel/next.js/releases" },
  { vendor: "github", label: "GitHub changelog, Actions", url: "https://github.blog/changelog/label/actions/" },
  { vendor: "nodejs", label: "Node.js release schedule", url: "https://nodejs.org/en/about/previous-releases" },
];

export const PLATFORM_CHANGES: readonly PlatformChange[] = [
  {
    id: "supabase-no-auto-expose",
    vendor: "supabase",
    title: "New tables and functions no longer granted to the API roles automatically",
    deadline: "2026-10-30",
    source: "https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically",
    status: "done",
    impact: "Broke customer returns (R-RET, owner message 10): 0308 revoked record_customer_return and the server role lost it.",
    action: "0330 granted the server role everything it needs; 0331 and the daily Platform health check catch any new gap; standing rule 15 makes every migration write its own grants.",
  },
  {
    id: "supabase-tls12-cbc-ciphers",
    vendor: "supabase",
    title: "Four old TLS 1.2 CBC ciphers removed from project HTTP APIs",
    deadline: "2026-11-10",
    source: "https://supabase.com/changelog/cbc-tls-ciphers-deprecated",
    status: "watch",
    impact: "Only clients on end-of-life systems are affected. The server (Vercel, Node) and the store iPads negotiate modern ciphers. Supabase emails owners of projects that used the old ciphers.",
    action: "If Supabase emailed the owner about this project, or a device stops reaching the back office after Nov 10, update that device's OS.",
  },
  {
    id: "supabase-pg-15-19-minor",
    vendor: "supabase",
    title: "Postgres 15.19 / 17.11 minor upgrade (ltree, pgcrypto legacy ciphers, btree_gist on floats, custom operators)",
    deadline: null,
    source: "https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes",
    status: "not-affected",
    impact: "Checked: no ltree, no pgp_sym/pgp_pub encryption, no custom operators. The one btree_gist index (pay_periods_no_overlap_excl, 0197) covers text and daterange, not float.",
    action: "",
  },
  {
    id: "supabase-extension-version-ignored",
    vendor: "supabase",
    title: "CREATE/ALTER EXTENSION ... VERSION is ignored",
    deadline: "2026-08-05",
    source: "https://supabase.com/changelog/extension-version-pinning-ignored",
    status: "not-affected",
    impact: "Checked: no migration names an extension version.",
    action: "",
  },
  {
    id: "supabase-realtime-schema-locked",
    vendor: "supabase",
    title: "The realtime schema can no longer be changed",
    deadline: null,
    source: "https://supabase.com/changelog/realtime-schema-locked-down-against-modification",
    status: "not-affected",
    impact: "Checked: no migration creates or alters objects in the realtime schema.",
    action: "",
  },
  {
    id: "supabase-js-node20",
    vendor: "supabase",
    title: "supabase-js drops Node.js 20",
    deadline: "2026-06-30",
    source: "https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20",
    status: "action-needed",
    impact: "CI (.github/workflows, 3 jobs) still builds and tests on Node 20, which reached end of life on 2026-04-30. Production on Vercel is not on Node 20 (see vercel-node20). CI therefore tests on a different Node than production runs.",
    action: "Move CI to the Node major production uses (22 or 24) and pin it in package.json engines (item 5, version pinning).",
  },
  {
    id: "vercel-node20",
    vendor: "vercel",
    title: "Node.js 20 disabled for new Vercel builds and functions",
    deadline: "2026-10-01",
    source: "https://vercel.com/changelog/node-js-20-is-being-deprecated",
    status: "not-affected",
    impact: "Production deployments after 2026-10-01 succeeded (for example R-RET e1c8da0b on 2026-10-31), and Vercel says a project on 20 errors on every new deployment, so production is on 22 or 24. package.json has no engines field, so the version lives only in Project Settings.",
    action: "Pin engines.node in package.json so the version is in the repo, not the dashboard (item 5).",
  },
  {
    id: "github-actions-node20",
    vendor: "github",
    title: "GitHub Actions runners removed Node 20 for JavaScript actions",
    deadline: "2026-09-23",
    source: "https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners",
    status: "not-affected",
    impact: "CI uses actions/checkout@v4 and actions/setup-node@v4 and is green after the removal (G-71a run 41260189512), so the runner runs them on Node 24.",
    action: "When a major version of these actions is released, move to it in its own PR.",
  },
  {
    id: "nextjs-15-eol",
    vendor: "nextjs",
    title: "Next.js 15 security support ends",
    deadline: "2027-01-31",
    source: "https://endoflife.date/nextjs",
    status: "not-affected",
    impact: "Greenway runs Next.js 16 (16.2.9), which is the supported line.",
    action: "",
  },
  {
    id: "nextjs-16-patches",
    vendor: "nextjs",
    title: "Next.js 16 patch releases (security fixes ship as patches)",
    deadline: null,
    source: "https://github.com/vercel/next.js/releases",
    status: "watch",
    impact: "Installed 16.2.9; the latest 16.x was 16.4.3 on 2026-10-23. Patch releases carry security fixes.",
    action: "Each monthly review: read the 16.x release notes for security fixes; take them in a slice with the full CI gate (item 5).",
  },
];

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPEN: ReadonlySet<PlatformChangeStatus> = new Set(["action-needed", "watch"]);

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function validDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days from `today` to `deadline` (negative once it has passed). */
export function daysUntil(deadline: string, today: string): number {
  return dayNumber(deadline) - dayNumber(today);
}

/** Problems with the register itself; [] means it is well formed. */
export function validateRegister(entries: readonly PlatformChange[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!ID_RE.test(e.id)) out.push(`${e.id}: id must be lower-case words joined by dashes`);
    if (seen.has(e.id)) out.push(`${e.id}: duplicate id`);
    seen.add(e.id);
    if (e.deadline !== null && !validDay(e.deadline)) out.push(`${e.id}: deadline must be YYYY-MM-DD`);
    if (!/^https:\/\//.test(e.source)) out.push(`${e.id}: source must be an https link to the vendor's notice`);
    if (!e.title.trim() || !e.impact.trim()) out.push(`${e.id}: title and impact are required`);
    if (e.status !== "not-affected" && !e.action.trim()) out.push(`${e.id}: ${e.status} needs an action`);
  }
  return out;
}

export type DeadlineStage = "30d" | "7d" | "1d" | "overdue";

/**
 * Which warning an open item is due for today, or null. Stages are reached
 * in order; the daily claim key (deadlineAlertKey) makes each one send once,
 * so a missed cron day still sends the stage on the next run.
 */
export function deadlineStage(e: PlatformChange, today: string): DeadlineStage | null {
  if (!OPEN.has(e.status) || e.deadline === null) return null;
  const left = daysUntil(e.deadline, today);
  if (left < 0) return "overdue";
  if (left <= 1) return "1d";
  if (left <= 7) return "7d";
  if (left <= 30) return "30d";
  return null;
}

export function deadlineAlertKey(id: string, stage: DeadlineStage): string {
  return `platform-change:${id}:${stage}`;
}

/** One review reminder per Pacific month: "2026-11-05" -> "platform-review:2026-11". */
export function monthlyReviewKey(pacificDay: string): string {
  return `platform-review:${pacificDay.slice(0, 7)}`;
}

/** Days since the register was last reviewed; > 45 means a review was missed. */
export function registerAgeDays(today: string, reviewedOn: string = REGISTER_REVIEWED_ON): number {
  return dayNumber(today) - dayNumber(reviewedOn);
}

export const REGISTER_STALE_DAYS = 45;

export type ReviewDigest = {
  overdue: PlatformChange[];
  dueSoon: { entry: PlatformChange; daysLeft: number }[];
  open: PlatformChange[];
  stale: boolean;
  ageDays: number;
};

export function reviewDigest(entries: readonly PlatformChange[], today: string, reviewedOn: string = REGISTER_REVIEWED_ON): ReviewDigest {
  const open = entries.filter((e) => OPEN.has(e.status));
  const overdue = open.filter((e) => e.deadline !== null && daysUntil(e.deadline, today) < 0);
  const dueSoon = open
    .filter((e) => e.deadline !== null && daysUntil(e.deadline, today) >= 0 && daysUntil(e.deadline, today) <= 30)
    .map((entry) => ({ entry, daysLeft: daysUntil(entry.deadline as string, today) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const ageDays = registerAgeDays(today, reviewedOn);
  return { overdue, dueSoon, open, stale: ageDays > REGISTER_STALE_DAYS, ageDays };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function reviewSubject(today: string, d: ReviewDigest): string {
  const month = today.slice(0, 7);
  const flag = d.overdue.length > 0 ? ` (${d.overdue.length} overdue)` : d.dueSoon.length > 0 ? ` (${d.dueSoon.length} due within 30 days)` : "";
  return `Greenway monthly platform review ${month}${flag}`;
}

export function reviewText(d: ReviewDigest): string {
  const lines = [
    `Time for the monthly platform review (standing rule 16). Read each source, add anything new to the register, then update REGISTER_REVIEWED_ON.`,
    `Register last reviewed ${d.ageDays} day(s) ago${d.stale ? " - a review was missed" : ""}.`,
  ];
  for (const e of d.overdue) lines.push(`OVERDUE ${e.deadline}: ${e.title}. ${e.action}`);
  for (const { entry, daysLeft } of d.dueSoon) lines.push(`In ${daysLeft} day(s) (${entry.deadline}): ${entry.title}. ${entry.action}`);
  lines.push(`${d.open.length} open item(s) in total.`);
  return lines.join("\n");
}

export function reviewHtml(d: ReviewDigest, sources: typeof PLATFORM_SOURCES, pageUrl: string): string {
  const item = (tag: string, e: PlatformChange) =>
    `<li><strong>${esc(tag)}</strong> ${esc(e.title)}<br/><span>${esc(e.impact)}</span><br/><em>Do:</em> ${esc(e.action)} <a href="${esc(e.source)}">notice</a></li>`;
  const rows = [
    ...d.overdue.map((e) => item(`OVERDUE (${e.deadline})`, e)),
    ...d.dueSoon.map(({ entry, daysLeft }) => item(`In ${daysLeft} day(s) (${entry.deadline})`, entry)),
  ].join("");
  const src = sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.label)}</a></li>`).join("");
  return [
    `<p>Time for the <strong>monthly platform review</strong> (standing rule 16). Read each source below, add anything new to the register (<code>src/lib/platform/platform-changes.ts</code> and <code>docs/PLATFORM-CHANGES.md</code>), then update <code>REGISTER_REVIEWED_ON</code>.</p>`,
    `<p>Register last reviewed ${d.ageDays} day(s) ago${d.stale ? " &mdash; <strong>a review was missed</strong>" : ""}. ${d.open.length} open item(s).</p>`,
    rows ? `<ul>${rows}</ul>` : `<p>Nothing open is due within 30 days.</p>`,
    `<p>Sources:</p><ul>${src}</ul>`,
    `<p><a href="${esc(pageUrl)}">Open Platform health</a></p>`,
  ].join("");
}

export function deadlineSubject(e: PlatformChange, stage: DeadlineStage): string {
  const when = stage === "overdue" ? "is OVERDUE" : stage === "1d" ? "is due tomorrow" : stage === "7d" ? "is due within 7 days" : "is due within 30 days";
  return `Greenway platform change ${when}: ${e.title}`;
}

export function deadlineHtml(e: PlatformChange, today: string, pageUrl: string): string {
  const left = e.deadline ? daysUntil(e.deadline, today) : 0;
  const when = left < 0 ? `was due ${e.deadline} (${-left} day(s) ago)` : `is due ${e.deadline} (${left} day(s) left)`;
  return [
    `<p><strong>${esc(e.title)}</strong> ${esc(when)}.</p>`,
    `<p>${esc(e.impact)}</p>`,
    `<p><strong>Do:</strong> ${esc(e.action)}</p>`,
    `<p><a href="${esc(e.source)}">Vendor notice</a> &middot; <a href="${esc(pageUrl)}">Platform health</a></p>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlatformChangesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };
  const mk = (over: Partial<PlatformChange>): PlatformChange => ({
    id: "x-change",
    vendor: "supabase",
    title: "T",
    deadline: "2026-12-01",
    source: "https://example.com/n",
    status: "action-needed",
    impact: "I",
    action: "A",
    ...over,
  });

  ok(validateRegister(PLATFORM_CHANGES).length === 0, "the real register is well formed");
  ok(validDay(REGISTER_REVIEWED_ON), "REGISTER_REVIEWED_ON is a real day");
  ok(PLATFORM_CHANGES.some((e) => e.id === "supabase-no-auto-expose" && e.status === "done"), "the R-RET cause is on the register as done");
  ok(validateRegister([mk({}), mk({})]).some((p) => p.includes("duplicate")), "duplicate ids refused");
  ok(validateRegister([mk({ id: "Bad Id" })]).length > 0, "bad id refused");
  ok(validateRegister([mk({ deadline: "2026-02-30" })]).length > 0, "impossible date refused");
  ok(validateRegister([mk({ source: "http://x" })]).length > 0, "non-https source refused");
  ok(validateRegister([mk({ action: " " })]).length > 0, "open item without an action refused");
  ok(validateRegister([mk({ status: "not-affected", action: "" })]).length === 0, "not-affected needs no action");

  ok(daysUntil("2026-11-10", "2026-10-31") === 10, "days until across a month");
  ok(daysUntil("2027-01-01", "2026-12-31") === 1, "days until across a year");
  ok(daysUntil("2026-03-09", "2026-03-07") === 2, "days until across the DST change is whole days");

  const e = mk({ deadline: "2026-12-01" });
  ok(deadlineStage(e, "2026-10-01") === null, "61 days out: no warning");
  ok(deadlineStage(e, "2026-11-01") === "30d", "30 days out: 30d");
  ok(deadlineStage(e, "2026-11-24") === "7d", "7 days out: 7d");
  ok(deadlineStage(e, "2026-11-30") === "1d", "1 day out: 1d");
  ok(deadlineStage(e, "2026-12-01") === "1d", "deadline day: still 1d");
  ok(deadlineStage(e, "2026-12-02") === "overdue", "day after: overdue");
  ok(deadlineStage(mk({ status: "done" }), "2026-11-30") === null, "done items never warn");
  ok(deadlineStage(mk({ status: "not-affected", action: "" }), "2026-11-30") === null, "not-affected never warns");
  ok(deadlineStage(mk({ deadline: null }), "2026-11-30") === null, "no deadline, no warning");
  ok(deadlineStage(mk({ status: "watch" }), "2026-11-30") === "1d", "watch items warn too");

  ok(deadlineAlertKey("a-b", "7d") === "platform-change:a-b:7d", "deadline key");
  ok(monthlyReviewKey("2026-11-05") === "platform-review:2026-11", "monthly key is the Pacific month");
  ok(monthlyReviewKey("2026-11-30") === monthlyReviewKey("2026-11-01"), "one key for the whole month");

  const dg = reviewDigest(
    [mk({ id: "a", deadline: "2026-10-01" }), mk({ id: "b", deadline: "2026-11-20" }), mk({ id: "c", deadline: "2026-11-05" }), mk({ id: "d", status: "done" })],
    "2026-11-01",
    "2026-10-31",
  );
  ok(dg.overdue.length === 1 && dg.overdue[0].id === "a", "digest: overdue");
  ok(dg.dueSoon.map((x) => x.entry.id).join(",") === "c,b", "digest: due soon, soonest first");
  ok(dg.open.length === 3, "digest: done is not open");
  ok(!dg.stale && dg.ageDays === 1, "digest: fresh register");
  ok(reviewDigest([], "2026-12-20", "2026-10-31").stale, "digest: 50 days old is stale");
  ok(reviewSubject("2026-11-01", dg).includes("(1 overdue)"), "subject flags overdue");
  ok(reviewText(dg).includes("OVERDUE 2026-10-01"), "text lists overdue");
  const h = reviewHtml(reviewDigest([mk({ id: "z", title: "<b>x</b>", deadline: "2026-11-02" })], "2026-11-01", "2026-11-01"), PLATFORM_SOURCES, "https://g/x");
  ok(h.includes("&lt;b&gt;x&lt;/b&gt;") && !h.includes("<b>x</b>"), "review html is escaped");
  ok(h.includes("supabase.com/changelog"), "review html lists the sources");
  ok(deadlineSubject(e, "overdue").includes("OVERDUE"), "deadline subject overdue");
  ok(deadlineHtml(e, "2026-12-03", "https://g/x").includes("2 day(s) ago"), "deadline html says how late");

  console.log(`platform-changes: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
