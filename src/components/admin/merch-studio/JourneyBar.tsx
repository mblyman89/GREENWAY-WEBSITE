"use client";

/**
 * D232 M-3b (SOP-11 B.5 items 2 and 3, G-78): the Product journey stepper for
 * the open design plus the one-line coaching strip for the current tab.
 *
 * Mounted by MerchStudio only after its localStorage restore and re-mounted on
 * every tab change (key=tab), so reading this browser's drafts in the state
 * initializer is hydration-safe and always fresh (same pattern as ProofPanel).
 */
import Link from "next/link";
import { useState } from "react";
import { getBlank } from "@/lib/merch-studio/garment-catalog-core";
import { checkSides, type MerchDesign } from "@/lib/merch-studio/merch-design-core";
import { planPrintFiles, sampleChecklist } from "@/lib/merch-studio/print-export-core";
import { buildJourney, nextLine, TAB_COACH, type JourneyInput, type JourneyState } from "@/lib/merch-studio/merch-journey-core";
import type { StudioTab } from "@/lib/merch-studio/studio-tabs-core";
import { loadDesigns } from "./merch-assets";

const CURRENT_KEY = "gw-merch-current-design";
const sampleKey = (id: string) => `gw-merch-sample-${id}`;

export interface JourneyPublished { designId: string; handle: string; status: "live" | "hidden"; images: number; stockSyncedAt: string; minRetailCents: number }
export interface JourneyServer { published: JourneyPublished[]; shopOk: boolean | null; approvals?: Record<string, boolean> }

function readInput(server: JourneyServer): JourneyInput & { designName: string } {
  const list: MerchDesign[] = loadDesigns();
  let id: string | null = null;
  try { id = window.localStorage.getItem(CURRENT_KEY); } catch { /* blocked */ }
  const d = list.find((x) => x.id === id) ?? list[0] ?? null;
  if (!d) return { design: null, sample: { ticked: 0, total: 0 }, published: null, shopOk: server.shopOk, designName: "" };
  const planned = planPrintFiles(d);
  const sides = checkSides(d);
  const issues = [...planned.issues, ...planned.plans.flatMap((p) => p.issues), ...sides.flatMap((s) => s.issues)];
  const blockers = new Set(issues.filter((i) => i.level === "blocker" && !d.ack.includes(i.id)).map((i) => i.id)).size;
  const elements = Object.values(d.sides).reduce((n, s) => n + s.elements.filter((e) => !e.hidden).length, 0);
  let ticks: Record<string, boolean> = {};
  try { ticks = JSON.parse(window.localStorage.getItem(sampleKey(d.id)) ?? "{}") as Record<string, boolean>; } catch { /* corrupt */ }
  const list8 = sampleChecklist(d);
  const pub = server.published.find((p) => p.designId === d.id) ?? null;
  return {
    designName: d.name,
    design: { name: d.name, garmentOk: !!getBlank(d.blankId), elements, blockers, printFiles: planned.plans.length },
    sample: { ticked: list8.filter((c) => ticks[c.id]).length, total: list8.length, approved: server.approvals ? !!server.approvals[d.id] : undefined },
    published: pub ? { handle: pub.handle, status: pub.status, images: pub.images, stockSyncedAt: pub.stockSyncedAt, minRetailCents: pub.minRetailCents } : null,
    shopOk: server.shopOk,
  };
}

const ICON: Record<JourneyState, string> = { done: "\u2713", todo: "\u2b1c", blocked: "\u26d4", optional: "\u25cb" };
const TONE: Record<JourneyState, string> = {
  done: "border-[var(--admin-accent)]/60 text-white",
  todo: "border-white/15 text-white/70",
  blocked: "border-[var(--admin-danger)]/70 text-white",
  optional: "border-white/10 text-white/50",
};

export function JourneyBar({ tab, server, onTab }: { tab: string; server: JourneyServer; onTab: (t: StudioTab) => void }) {
  const [input] = useState(() => readInput(server));
  const j = buildJourney(input);
  const line = nextLine(j, input.published);
  const coach = (TAB_COACH as Record<string, (typeof TAB_COACH)[StudioTab] | undefined>)[tab];
  return (
    <div className="mb-3 space-y-2">
      <nav aria-label="Product journey" className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-2">
        <p className="mb-1 text-xs text-white/60">
          <b className="text-white">Product journey</b>{input.designName ? <> for &ldquo;{input.designName}&rdquo;</> : " (no design yet)"} &middot; {j.doneCount} of {j.stages.length} done
        </p>
        <ol className="flex flex-wrap items-center gap-1 text-xs">
          {j.stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1">
              {s.tab ? (
                <button type="button" onClick={() => onTab(s.tab!)} title={s.note} aria-current={tab === s.tab ? "step" : undefined}
                  className={`rounded-full border px-2 py-0.5 ${TONE[s.state]} hover:bg-white/5`}>
                  {ICON[s.state]} {s.label}
                </button>
              ) : (
                <Link href={s.href ?? "#"} title={s.note} className={`rounded-full border px-2 py-0.5 ${TONE[s.state]} hover:bg-white/5`}>
                  {ICON[s.state]} {s.label}
                </Link>
              )}
              {i < j.stages.length - 1 ? <span aria-hidden className="text-white/30">&rarr;</span> : null}
            </li>
          ))}
        </ol>
        {line ? <p role="status" className="mt-1 text-xs text-white/85">{line}</p> : null}
      </nav>
      {coach ? (
        <p className="rounded-[var(--admin-radius-sm)] bg-white/5 px-3 py-1.5 text-xs text-white/80">
          <b className="text-white">You are here:</b> {coach.here}. <b className="text-white">Do this:</b> {coach.todo}{" "}
          <b className="text-white">Then:</b>{" "}
          {coach.thenTab ? (
            <button type="button" className="text-[var(--admin-accent)] hover:underline" onClick={() => onTab(coach.thenTab!)}>{coach.then} &rarr;</button>
          ) : (
            <Link href="/admin/inventory/merch" className="text-[var(--admin-accent)] hover:underline">{coach.then} &rarr;</Link>
          )}
        </p>
      ) : null}
    </div>
  );
}
