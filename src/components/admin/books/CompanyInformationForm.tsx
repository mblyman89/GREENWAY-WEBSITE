"use client";

/**
 * src/components/admin/books/CompanyInformationForm.tsx   (slice books-31)
 *
 * THE COMPANY INFORMATION SCREEN, WITH THE CPA SITTING NEXT TO IT.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "I want to make sure we record every company detail we need according to
 *    all the different forms they will be auto filling for me."
 *
 *   "This page should be pretty self explanatory, but because I really like to
 *    be thorough and all inclusive, I want this screen to have a mentoring
 *    guiding cpa cfo help me fill it out properly, explain what everything is
 *    used for, where it is used, and why. Give verbatim authoritative source
 *    documents to cite it as well as plain English interpretations of the cited
 *    sources."
 *
 * So this screen is two things at once, like the payroll setup screen before
 * it. The left column is the form. The right column is the reason for the form.
 * Neither is a tooltip: a tooltip is guidance you have to already suspect you
 * need, and the whole complaint about Sage was being stopped without being told
 * anything.
 *
 * THREE THINGS ON SCREEN AT ONCE, ON PURPOSE
 *
 *   1. THE FORM, grouped the way the questions actually cluster - who you are
 *      to the IRS, where you are, who signs, who Washington thinks you are.
 *   2. THE READINESS PANEL, recomputed on every keystroke from the SAME engine
 *      function the server uses. It answers "which forms can I file right now",
 *      which is the only question this data exists to answer.
 *   3. THE LESSON, for whichever field has focus, with the verbatim quote and
 *      the plain-English reading side by side.
 *
 * WHY THE READINESS PANEL RECOMPUTES LOCALLY
 *
 * Guidance that arrives after you press Save is not guidance, it is a
 * complaint. But the local computation is ADVICE, NOT A PERMISSION SLIP - the
 * server action re-runs the identical engine, because there is exactly one
 * definition of "ready to file" in this system and both halves ask the same
 * function. If the view layer could decide, two screens could disagree about
 * the same company and whichever one he happened to be looking at would become
 * the truth.
 *
 * WHY A BLANK SAVE IS ALLOWED
 *
 * Michael will fill this in over several sittings. A form that refused to save
 * until it was complete would force him to invent placeholder values, and an
 * invented EIN is far worse than a missing one - a missing one stops a filing,
 * an invented one produces a filing addressed to somebody else. So the save
 * always succeeds and the panel always tells the truth about what is still
 * blocked.
 */

import { useMemo, useState } from "react";

import { Badge, Button, Card, CardHeader, Field, Input, Section } from "@/components/admin/ui";
import {
  COMPANY_FIELDS,
  FORM_TITLES,
  allFormReadiness,
  signerRuleFor,
  type CompanyFieldSpec,
  type CompanyProfileValues,
} from "@/lib/accounting/company-identity-core";
import {
  COMPANY_FIELD_LESSONS,
  COMPANY_SCREEN_LESSONS,
  explainFormNeeds,
} from "@/lib/accounting/company-identity-mentor";
import { COMPANY_IDENTITY_AUTHORITIES } from "@/lib/accounting/company-identity-authorities";

/**
 * How the fields are grouped on screen.
 *
 * The grouping is presentation only - every field still comes from
 * COMPANY_FIELDS, and a field missing from every group would be caught by the
 * check below rather than silently disappearing off the page. That check is the
 * point: a field the software collects but never shows is a field that stays
 * blank forever while looking configured.
 */
const GROUPS: ReadonlyArray<{ readonly title: string; readonly blurb: string; readonly fields: readonly string[] }> = [
  {
    title: "Who you are to the IRS",
    blurb:
      "These four answer the question every federal form opens with. They come off your CP 575 letter " +
      "and your S-election acceptance, not off your letterhead.",
    fields: ["ein", "legal_name", "trade_name", "entity_type"],
  },
  {
    title: "What the IRS expects from you",
    blurb:
      "The IRS assigns both of these by notice. They are not preferences, and guessing at them is how a " +
      "business ends up with unfiled quarters or late deposits.",
    fields: ["federal_return_form", "deposit_schedule"],
  },
  {
    title: "Where you are",
    blurb: "The address every notice is mailed to. A notice you never received still starts its clock.",
    fields: ["address_line1", "city", "state_code", "zip_code"],
  },
  {
    title: "Who signs, and who answers the phone",
    blurb:
      "A federal employment tax return is signed under penalty of perjury, and the instructions say which " +
      "people may sign it for your kind of entity.",
    fields: ["signer_name", "signer_title", "contact_name", "contact_phone", "contact_email"],
  },
  {
    title: "Who Washington thinks you are",
    blurb:
      "Three separate agencies, three separate account numbers, one business. The FUTA credit that turns " +
      "6.0% into 0.6% depends on the state side being right.",
    fields: ["wa_ubi", "esd_account_number", "suta_state_code", "lni_account_number", "lni_risk_class"],
  },
];

function specFor(field: string): CompanyFieldSpec | undefined {
  return COMPANY_FIELDS.find((f) => f.field === field);
}

function lessonFor(field: string) {
  return COMPANY_FIELD_LESSONS.find((l) => l.field === field);
}

function authoritiesFor(ids: readonly string[]) {
  return ids
    .map((id) => COMPANY_IDENTITY_AUTHORITIES.find((a) => a.id === id))
    .filter((a): a is (typeof COMPANY_IDENTITY_AUTHORITIES)[number] => Boolean(a));
}

export type SaveAction = (
  values: CompanyProfileValues,
) => Promise<{ ok: boolean; message?: string; field?: string }>;

export function CompanyInformationForm({
  initial,
  saveAction,
}: {
  initial: CompanyProfileValues;
  saveAction: SaveAction;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of COMPANY_FIELDS) {
      const v = initial[f.field];
      seed[f.field] = typeof v === "string" ? v : "";
    }
    return seed;
  });
  const [focused, setFocused] = useState<string>("ein");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Recomputed on every keystroke, from the same engine the server uses.
  const readiness = useMemo(() => allFormReadiness(values), [values]);
  const readyCount = readiness.filter((r) => r.ready).length;

  /**
   * A field that exists in the registry and appears in no group would never be
   * rendered. Shown as a visible warning rather than silently dropped, because
   * the invisible version of this bug is a form that cannot be filed and a
   * screen that offers no way to fix it.
   */
  const ungrouped = useMemo(() => {
    const shown = new Set(GROUPS.flatMap((g) => g.fields));
    return COMPANY_FIELDS.filter((f) => !shown.has(f.field)).map((f) => f.field);
  }, []);

  const lesson = lessonFor(focused);
  const spec = specFor(focused);
  const lessonAuthorities = authoritiesFor(lesson?.authorityIds ?? []);
  const signerRule = signerRuleFor(values.entity_type ?? "");

  async function onSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await saveAction(values);
      setResult({
        ok: res.ok,
        message: res.ok
          ? "Saved. The readiness panel below reflects what is now on file."
          : (res.message ?? "The save was refused and no reason was given, which is itself a bug."),
      });
    } catch (e) {
      setResult({ ok: false, message: `The save failed: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {ungrouped.length > 0 ? (
        <Card>
          <p className="text-sm text-[var(--admin-danger)]">
            These fields are collected by the engine but appear in no group on this screen, so they can
            never be filled in: {ungrouped.join(", ")}. That is a bug in this page, not in your data.
          </p>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Can I file yet?"
          subtitle="Recalculated as you type, from the same rules the save path uses."
        />
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={readyCount === readiness.length ? "green" : "orange"}>
            {readyCount} of {readiness.length} forms ready
          </Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {readiness.map((r) => (
            <div
              key={r.form}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-[var(--admin-text)]">{r.title}</span>
                <Badge tone={r.ready ? "green" : "danger"}>{r.ready ? "Ready" : "Blocked"}</Badge>
              </div>
              {r.blockers.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {r.blockers.map((b) => (
                    <li key={b.field} className="text-xs text-[var(--admin-danger)]">
                      {b.label}: {b.help}
                    </li>
                  ))}
                </ul>
              ) : null}
              {r.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {r.warnings.map((w) => (
                    <li key={w.field} className="text-xs text-[var(--admin-text-faint)]">
                      {w.label}: {w.help}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-[0.7rem] text-[var(--admin-text-faint)]">
                {explainFormNeeds(r.form).narration}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-6">
          {GROUPS.map((group) => (
            <Card key={group.title}>
              <CardHeader title={group.title} subtitle={group.blurb} />
              <div className="grid gap-4 md:grid-cols-2">
                {group.fields.map((name) => {
                  const s = specFor(name);
                  if (!s) return null;
                  const value = values[name] ?? "";
                  const malformed = value.trim() !== "" && s.pattern && !s.pattern.test(value.trim());
                  const isRequiredSomewhere = s.consumers.some((c) => c.necessity === "required");
                  return (
                    <Field
                      key={name}
                      label={s.label}
                      htmlFor={`cp-${name}`}
                      required={isRequiredSomewhere}
                      error={malformed ? s.patternHelp : undefined}
                      help={
                        malformed
                          ? undefined
                          : `Used by: ${s.consumers.map((c) => FORM_TITLES[c.form]).join("; ")}`
                      }
                    >
                      <Input
                        id={`cp-${name}`}
                        value={value}
                        onFocus={() => setFocused(name)}
                        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                      />
                    </Field>
                  );
                })}
              </div>
            </Card>
          ))}

          <div className="flex items-center gap-3">
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Save company information"}
            </Button>
            {result ? (
              <span
                className={
                  result.ok
                    ? "text-sm text-[var(--admin-accent)]"
                    : "text-sm text-[var(--admin-danger)]"
                }
              >
                {result.message}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={lesson ? spec?.label : "Select a field"}
              subtitle="Your CPA, on the field you are editing."
            />
            {lesson ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    What it is
                  </p>
                  <p className="text-[var(--admin-text)]">{lesson.whatItIs}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Where it is used
                  </p>
                  <p className="text-[var(--admin-text)]">{lesson.whereItIsUsed}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Why it matters
                  </p>
                  <p className="text-[var(--admin-text)]">{lesson.whyItMatters}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    The trap
                  </p>
                  <p className="text-[var(--admin-text)]">{lesson.theTrap}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    How to be sure
                  </p>
                  <p className="text-[var(--admin-text)]">{lesson.howToBeSure}</p>
                </div>

                {focused === "entity_type" && signerRule ? (
                  <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                      With your current answer, who may sign
                    </p>
                    <p className="text-[var(--admin-text)]">{signerRule.rule}</p>
                  </div>
                ) : null}

                {lessonAuthorities.length > 0 ? (
                  <div className="space-y-3 border-t border-[var(--admin-border)] pt-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                      The source, word for word
                    </p>
                    {lessonAuthorities.map((a) => (
                      <div key={a.id} className="space-y-1">
                        <p className="text-xs font-medium text-[var(--admin-text-muted)]">{a.cite}</p>
                        <blockquote className="border-l-2 border-[var(--admin-accent)] pl-3 text-xs italic text-[var(--admin-text)]">
                          {a.quote}
                        </blockquote>
                        <p className="text-xs text-[var(--admin-text-faint)]">
                          <span className="font-medium">In plain English: </span>
                          {a.soWhat}
                        </p>
                        <a
                          className="text-xs text-[var(--admin-accent)] underline"
                          href={a.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Read the original
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="border-t border-[var(--admin-border)] pt-3 text-xs text-[var(--admin-text-faint)]">
                    No authority is cited for this field yet. Washington L&amp;I&apos;s quarterly-report
                    instructions have not been mirrored into this system, and inventing a citation would be
                    worse than admitting the gap.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--admin-text-faint)]">
                Click into any field and its explanation appears here.
              </p>
            )}
          </Card>
        </div>
      </div>

      <Section title="Why this screen is built the way it is">
        <div className="grid gap-4 md:grid-cols-2">
          {COMPANY_SCREEN_LESSONS.map((l) => (
            <Card key={l.topic}>
              <CardHeader title={l.topic} />
              <p className="text-sm text-[var(--admin-text)]">{l.plainEnglish}</p>
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                <span className="font-medium">Why it matters: </span>
                {l.whyItMatters}
              </p>
              {authoritiesFor(l.authorityIds).map((a) => (
                <div key={a.id} className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-[var(--admin-text-muted)]">{a.cite}</p>
                  <blockquote className="border-l-2 border-[var(--admin-accent)] pl-3 text-xs italic text-[var(--admin-text)]">
                    {a.quote}
                  </blockquote>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}
