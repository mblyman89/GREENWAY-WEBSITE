/**
 * Knowledge base → Compliance guardrails (D244 R-23).
 *
 * Owner round 10: "I want every banned and warning words and phrases to be in
 * this page ... I need to be in control, and if I choose something is ok to
 * do, thats my choice ... so I can fine tune them myself and enable and
 * disable them as I see fit."
 *
 * One page with EVERY word rule that can stop or flag text (catalog:
 * src/lib/ai/guardrails-catalog-core.ts), each with its words, its exact
 * pattern, where it applies, and a Block / Warn / Off choice; the owner's
 * allowed words (skipped by every rule); the owner's own phrases; a text
 * tester; and the checks that are not word rules.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { getKbCounts, listKbBanned } from "@/lib/ai/kb/store";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { checkCompliance } from "@/lib/ai/compliance";
import { getGuardrailsForEdit } from "@/lib/ai/guardrails-server";
import { setActiveGuardrails, type GuardrailLevel } from "@/lib/ai/guardrails-state-core";
import {
  GUARDRAIL_GROUPS,
  GUARDRAIL_RULES,
  NOT_WORD_RULES,
  readableWords,
  testRules,
  type GuardrailRule,
} from "@/lib/ai/guardrails-catalog-core";
import {
  setGuardrailLevelAction,
  resetAllGuardrailsAction,
  addAllowedWordAction,
  removeAllowedWordAction,
  addOwnerPhraseAction,
  toggleOwnerPhraseAction,
  updateBannedPhraseAction,
  deleteBannedPhraseAction,
  seedMedicalHereAction,
} from "./guardrails-actions";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

const TEST_MAX = 4000;

const LEVEL_TEXT: Record<GuardrailLevel, string> = { block: "Block", warn: "Warn", off: "Off" };
const LEVEL_HELP: Record<GuardrailLevel, string> = {
  block: "stops the text until it is fixed",
  warn: "shows a heads-up, nothing is stopped",
  off: "not checked at all",
};
const LEVEL_BADGE: Record<GuardrailLevel, string> = {
  block: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange-soft)] text-[var(--admin-text)]",
  warn: "border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/15 text-[var(--admin-text)]",
  off: "border-[var(--admin-border)] bg-[var(--admin-bg)] text-[var(--admin-text-muted)]",
};

const card = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const input =
  "mt-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const muted = "text-sm text-[var(--admin-text-muted)]";

function anchorFor(key: string): string {
  return `rule-${key}`;
}

function Badge({ level }: { level: GuardrailLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${LEVEL_BADGE[level]}`}>
      {LEVEL_TEXT[level]}
    </span>
  );
}

function wordsOf(rule: GuardrailRule): string[] {
  if (rule.list) return [...rule.list];
  if (rule.pattern) return readableWords(rule.pattern);
  return [];
}

function RuleRow({ rule, current, allow }: { rule: GuardrailRule; current: GuardrailLevel; allow: readonly string[] }) {
  const words = wordsOf(rule);
  const changed = current !== rule.builtIn;
  const shown = words.slice(0, 24);
  return (
    <li id={anchorFor(rule.key)} className="scroll-mt-24 border-t border-[var(--admin-border)] py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--admin-text)]">{rule.name}</h4>
            <Badge level={current} />
            {changed ? (
              <span className="text-xs text-[var(--admin-text-muted)]">
                changed by you (built-in: {LEVEL_TEXT[rule.builtIn]})
              </span>
            ) : (
              <span className="text-xs text-[var(--admin-text-muted)]">built-in level</span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            {rule.why}
            {rule.cite ? <> Source: {rule.cite}.</> : null}
          </p>
          {words.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {shown.map((w) => (
                <span
                  key={w}
                  className={`rounded border px-1.5 py-0.5 text-xs ${
                    allow.includes(w.toLowerCase())
                      ? "border-[var(--admin-accent)]/50 text-[var(--admin-accent)] line-through"
                      : "border-[var(--admin-border)] text-[var(--admin-text)]"
                  }`}
                  title={allow.includes(w.toLowerCase()) ? "You allowed this word" : undefined}
                >
                  {w}
                </span>
              ))}
              {words.length > shown.length ? (
                <details className="w-full">
                  <summary className="cursor-pointer text-xs text-[var(--admin-accent)]">
                    Show all {words.length} words
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {words.slice(shown.length).map((w) => (
                      <span key={w} className="rounded border border-[var(--admin-border)] px-1.5 py-0.5 text-xs text-[var(--admin-text)]">
                        {w}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs italic text-[var(--admin-text-muted)]">Not a word list: this rule checks the text another way (see above).</p>
          )}
          {rule.pattern ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--admin-text-muted)]">Exact pattern the check uses</summary>
              <code className="mt-1 block break-all rounded bg-[var(--admin-bg)] p-2 text-[0.7rem] text-[var(--admin-text)]">{rule.pattern}</code>
            </details>
          ) : null}
        </div>
        <form action={setGuardrailLevelAction} className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="key" value={rule.key} />
          {rule.levels.map((l) => (
            <button
              key={l}
              type="submit"
              name="level"
              value={l}
              disabled={l === current}
              title={`${LEVEL_TEXT[l]}: ${LEVEL_HELP[l]}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-default ${
                l === current ? LEVEL_BADGE[l] + " ring-1 ring-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              }`}
            >
              {LEVEL_TEXT[l]}
            </button>
          ))}
          {changed ? (
            <button type="submit" name="level" value="default" className="ml-1 text-xs text-[var(--admin-accent)] hover:underline">
              Reset
            </button>
          ) : null}
        </form>
      </div>
    </li>
  );
}

export default async function KbCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; test?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error, test } = await searchParams;

  const [counts, banned, settings, ownerPhrases] = await Promise.all([
    getKbCounts(),
    listKbBanned(500),
    getGuardrailsForEdit(),
    loadBannedPhrases(),
  ]);
  // The tester and the levels below use the settings as saved right now.
  setActiveGuardrails(settings);

  const levelOf = (r: GuardrailRule): GuardrailLevel => settings.rules[r.key] ?? r.builtIn;
  const changedCount = GUARDRAIL_RULES.filter((r) => levelOf(r) !== r.builtIn).length;
  const offCount = GUARDRAIL_RULES.filter((r) => levelOf(r) === "off").length;
  const blockCount = GUARDRAIL_RULES.filter((r) => levelOf(r) === "block").length;

  const testText = String(test ?? "").slice(0, TEST_MAX);
  const verdict = testText.trim() ? checkCompliance(testText, ownerPhrases) : null;
  const hits = testText.trim() ? testRules(testText) : [];
  const ownerHits = testText.trim()
    ? ownerPhrases.filter((p) => testText.toLowerCase().includes(p.phrase.toLowerCase()) && !settings.allow.includes(p.phrase.toLowerCase()))
    : [];

  return (
    <div>
      <AdminPageHeader
        title="Compliance guardrails"
        subtitle="Every word rule that can stop or flag text on this site. You choose Block, Warn or Off for each one."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Compliance" },
            ]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <KbFlash msg={msg} error={error} />

        <section className={card}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">How this page works</h2>
          <p className={`mt-1 ${muted}`}>
            Every rule below is a check that the site runs on text before it is saved, accepted or published.{" "}
            <strong>Block</strong> stops the text until it is fixed. <strong>Warn</strong> only shows a heads-up.{" "}
            <strong>Off</strong> means the rule is not checked at all. <strong>Allowed words</strong> are skipped by
            every rule. Changes take effect on the next check (within a minute everywhere) and every change is kept in
            the audit log. <strong>Reset</strong> puts a rule back to how it shipped.
          </p>
          <p className={`mt-2 ${muted}`}>
            The rules come from the Washington advertising rules (WAC 314-55-155) and your own earlier decisions. Turning
            a rule off is your call; the site will not stop you.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--admin-text)]">
            <span>{GUARDRAIL_RULES.length} built-in rules</span>
            <span>{blockCount} on Block</span>
            <span>{offCount} turned off</span>
            <span>{changedCount} changed by you</span>
            <span>{settings.allow.length} allowed words</span>
            <span>{counts.banned} of your own phrases</span>
          </div>
          <nav className="mt-3 flex flex-wrap gap-2 text-xs">
            <a href="#test" className="text-[var(--admin-accent)] hover:underline">Test some text</a>
            <a href="#allowed" className="text-[var(--admin-accent)] hover:underline">Allowed words</a>
            <a href="#phrases" className="text-[var(--admin-accent)] hover:underline">Your own phrases</a>
            {GUARDRAIL_GROUPS.map((g) => (
              <a key={g.key} href={`#group-${g.key}`} className="text-[var(--admin-accent)] hover:underline">
                {g.title}
              </a>
            ))}
            <a href="#other-checks" className="text-[var(--admin-accent)] hover:underline">Other checks</a>
            <a href="#reset" className="text-[var(--admin-accent)] hover:underline">Reset all</a>
          </nav>
        </section>

        {/* ── Test some text ─────────────────────────────────────────────── */}
        <section id="test" className={`${card} scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Test some text</h2>
          <p className={`mt-1 ${muted}`}>
            Paste the words that were stopped. You will see which rules catch them, at your current levels, with a
            link to each rule so you can change it.
          </p>
          <form method="get" action="#test" className="mt-3 space-y-2">
            <textarea
              name="test"
              defaultValue={testText}
              maxLength={TEST_MAX}
              rows={4}
              className={`${input} w-full`}
              placeholder="e.g. Slow cured for 21 days. The best gummies in town."
            />
            <div className="flex gap-3">
              <Button type="submit" variant="neutral">Test</Button>
              {testText ? (
                <Link href="/admin/knowledge-base/compliance#test" className="self-center text-xs text-[var(--admin-accent)] hover:underline">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
          {verdict ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-[var(--admin-text)]">
                <strong>Main AI writing check:</strong>{" "}
                {verdict.blockingFlags.length > 0
                  ? `would STOP this text (${verdict.blockingFlags.join("; ")}).`
                  : verdict.flags.length > 0
                    ? `would pass with a heads-up (${verdict.flags.join("; ")}).`
                    : "would pass with nothing to fix."}
              </p>
              {hits.length === 0 && ownerHits.length === 0 ? (
                <p className={muted}>No word rule matches this text.</p>
              ) : (
                <ul className="space-y-1">
                  {hits.map((h) => (
                    <li key={h.key} className="flex flex-wrap items-center gap-2">
                      <Badge level={h.level} />
                      <a href={`#${anchorFor(h.key)}`} className="text-[var(--admin-accent)] hover:underline">
                        {GUARDRAIL_GROUPS.find((g) => g.key === h.group)?.title}: {h.name}
                      </a>
                      <span className="text-[var(--admin-text-muted)]">
                        matched {h.words.map((w) => `\u201c${w}\u201d`).join(", ")}
                      </span>
                    </li>
                  ))}
                  {ownerHits.map((p) => (
                    <li key={p.phrase} className="flex flex-wrap items-center gap-2">
                      <Badge level={p.severity} />
                      <a href="#phrases" className="text-[var(--admin-accent)] hover:underline">
                        Your own phrase: &ldquo;{p.phrase}&rdquo;
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-[var(--admin-text-muted)]">
                The main AI check also reads the words around a match, so an everyday use such as &ldquo;slow cured&rdquo;
                or &ldquo;a sweet treat&rdquo; can match a word rule here and still pass. Rules that are not word lists
                (amounts, links, source lines) are not tested here.
              </p>
            </div>
          ) : null}
        </section>

        {/* ── Allowed words ──────────────────────────────────────────────── */}
        <section id="allowed" className={`${card} scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Allowed words ({settings.allow.length})</h2>
          <p className={`mt-1 ${muted}`}>
            A word or phrase here is skipped by every rule on this page, everywhere on the site. Type it exactly as it
            is matched (for example &ldquo;relief&rdquo; or &ldquo;best seller&rdquo;). Capital letters do not matter.
            The other words in the same rule are still checked.
          </p>
          <form action={addAllowedWordAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[16rem] flex-1 text-sm">
              <span className="block text-[var(--admin-text-muted)]">Words to allow (one per line or separated by commas)</span>
              <textarea name="words" rows={2} required className={`${input} w-full`} placeholder="e.g. relief, best seller" />
            </label>
            <Button type="submit" variant="neutral">Allow</Button>
          </form>
          {settings.allow.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {settings.allow.map((w) => (
                <li key={w} className="flex items-center gap-1 rounded-full border border-[var(--admin-accent)]/40 px-3 py-1 text-xs text-[var(--admin-text)]">
                  {w}
                  <form action={removeAllowedWordAction}>
                    <input type="hidden" name="word" value={w} />
                    <button type="submit" className="ml-1 text-[var(--admin-text-muted)] hover:text-[var(--admin-orange)]" title={`Check \u201c${w}\u201d again`}>
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs italic text-[var(--admin-text-muted)]">No allowed words yet.</p>
          )}
        </section>

        {/* ── The owner's own phrases ────────────────────────────────────── */}
        <section id="phrases" className={`${card} scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Your own phrases ({counts.banned})</h2>
          <p className={`mt-1 ${muted}`}>
            Extra words and phrases checked by the main AI writing check (and the crawler) on top of the built-in rules.
            Turn any of them off, change Block to Warn, change the reason, or delete it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <form action={seedMedicalHereAction}>
              <Button type="submit" variant="neutral" disabled={!counts.migrated}>
                Add missing starter medical phrases
              </Button>
            </form>
            <span className="text-xs text-[var(--admin-text-muted)]">Phrases you already have are never changed or turned back on.</span>
          </div>
          <form action={addOwnerPhraseAction} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Phrase</span>
              <input name="phrase" required maxLength={200} className={`${input} w-64`} placeholder="e.g. couch lock" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Level</span>
              <select name="severity" className={input}>
                <option value="block">Block</option>
                <option value="warn">Warn</option>
              </select>
            </label>
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="block text-[var(--admin-text-muted)]">Reason (optional)</span>
              <input name="reason" maxLength={300} className={`${input} w-full`} placeholder="why it is checked" />
            </label>
            <Button type="submit" variant="neutral" disabled={!counts.migrated}>Add phrase</Button>
          </form>

          {banned.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Phrase</th>
                    <th className="py-2 pr-4 font-medium">Level and reason</th>
                    <th className="py-2 pr-4 font-medium">On / off</th>
                    <th className="py-2 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {banned.map((b) => (
                    <tr key={b.id} className={`border-t border-[var(--admin-border)] ${b.active ? "" : "opacity-60"}`}>
                      <td className="py-2 pr-4 align-top text-[var(--admin-text)]">
                        {b.phrase}
                        {settings.allow.includes(b.phrase.toLowerCase()) ? (
                          <span className="ml-2 text-xs text-[var(--admin-accent)]">(allowed, skipped)</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <form action={updateBannedPhraseAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={b.id} />
                          <select name="severity" defaultValue={b.severity === "warn" ? "warn" : "block"} className={`${input} mt-0 py-1`}>
                            <option value="block">Block</option>
                            <option value="warn">Warn</option>
                          </select>
                          <input name="reason" defaultValue={b.reason ?? ""} maxLength={300} className={`${input} mt-0 w-56 py-1`} placeholder="reason" />
                          <button type="submit" className="text-xs text-[var(--admin-accent)] hover:underline">Save</button>
                        </form>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <form action={toggleOwnerPhraseAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="active" value={(!b.active).toString()} />
                          <button type="submit" className="text-xs text-[var(--admin-accent)] hover:underline">
                            {b.active ? "On \u2014 turn off" : "Off \u2014 turn on"}
                          </button>
                        </form>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <form action={deleteBannedPhraseAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="phrase" value={b.phrase} />
                          <button type="submit" className="text-xs text-[var(--admin-orange)] hover:underline">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* ── Every built-in rule, by where it applies ───────────────────── */}
        {GUARDRAIL_GROUPS.map((g) => {
          const rules = GUARDRAIL_RULES.filter((r) => r.group === g.key);
          return (
            <section key={g.key} id={`group-${g.key}`} className={`${card} scroll-mt-24`}>
              <h2 className="text-base font-semibold text-[var(--admin-text)]">
                {g.title} ({rules.length})
              </h2>
              <p className={`mt-1 ${muted}`}>
                <strong>Where it applies:</strong> {g.where}
              </p>
              <ul className="mt-2">
                {rules.map((r) => (
                  <RuleRow key={r.key} rule={r} current={levelOf(r)} allow={settings.allow} />
                ))}
              </ul>
            </section>
          );
        })}

        {/* ── Checks that are not word rules ─────────────────────────────── */}
        <section id="other-checks" className={`${card} scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Other checks (not word rules)</h2>
          <p className={`mt-1 ${muted}`}>
            These check that something is present or correct, not which words are used, so there is nothing to allow
            here. They are listed so nothing that can stop you is hidden.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--admin-text)]">
            {NOT_WORD_RULES.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        {/* ── Reset everything ───────────────────────────────────────────── */}
        <section id="reset" className={`${card} scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Reset all rules</h2>
          <p className={`mt-1 ${muted}`}>Puts every built-in rule back to how it shipped. Your own phrases are not touched.</p>
          <form action={resetAllGuardrailsAction} className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[var(--admin-text)]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="confirm" value="yes" required /> Yes, reset every rule
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="allow" value="yes" /> Also clear the allowed words
            </label>
            <Button type="submit" variant="neutral" disabled={changedCount === 0 && settings.allow.length === 0}>
              Reset
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
