"use client";

/**
 * D263 S7 — "Make my card": contact details + a style → a finished front and
 * back (real layers the owner can still move and restyle).
 */
import { useState } from "react";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { CARD_BACKS, CARD_STYLES, DEFAULT_CARD_INFO, buildBusinessCard, cardTips, type CardBack, type CardInfo, type CardStyle } from "@/lib/printing/business-card-core";
import type { PrintPage } from "@/lib/printing/print-doc-core";

const KEY = "gw.printStudio.card.v1";
const input = "w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white";

function load(): CardInfo {
  try {
    return { ...DEFAULT_CARD_INFO, ...(JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<CardInfo>) };
  } catch {
    return DEFAULT_CARD_INFO;
  }
}

export function BusinessCardBuilder({ base, onBuild }: { base: BannerDesign; onBuild: (pages: PrintPage[]) => void }) {
  const [info, setInfo] = useState<CardInfo>(() => (typeof window === "undefined" ? DEFAULT_CARD_INFO : load()));
  const [style, setStyle] = useState<CardStyle>("classic");
  const [back, setBack] = useState<CardBack>("contact-qr");
  const tips = cardTips(info);
  const set = (k: keyof CardInfo, v: string) => setInfo((i) => ({ ...i, [k]: v }));
  const field = (k: keyof CardInfo, label: string, ph = "") => (
    <label className="block text-xs text-white/70">
      {label}
      <input className={input} value={info[k]} placeholder={ph} maxLength={120} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  function build() {
    const r = buildBusinessCard(base, info, style, back);
    if (!r) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
    if (!window.confirm("Replace this card's front and back with the new layout? (Your picture stays.)")) return;
    onBuild([
      { label: "Front", design: r.front, imageSrc: "" },
      { label: "Back", design: r.back, imageSrc: "" },
    ]);
  }

  return (
    <details className="rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5 p-2" open>
      <summary className="cursor-pointer text-sm font-semibold">Business card maker: type your details, pick a look</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {field("name", "Name", "Jordan Lee")}
        {field("title", "Job title", "Store manager")}
        {field("company", "Company")}
        {field("phone", "Phone", "(360) 555-0100")}
        {field("email", "Email", "you@greenwaymarijuana.com")}
        {field("website", "Website")}
        {field("address", "Address", "123 Main St, Town, WA")}
        {field("instagram", "Instagram", "@greenway")}
        {field("tagline", "Small line", "21+ only")}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-xs text-white/60">Look:</span>
        {CARD_STYLES.map((s) => (
          <button key={s.id} type="button" onClick={() => setStyle(s.id)} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${style === s.id ? "border-[var(--admin-accent)] font-bold" : "border-white/20"}`}>
            <span className="inline-block h-3 w-3 rounded-sm border border-white/30" style={{ background: s.bg }} />
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.accent }} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-xs text-white/70">
          Back of the card
          <select className={`${input} ml-2 w-auto`} value={back} onChange={(e) => setBack(e.target.value as CardBack)}>
            {CARD_BACKS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={build} className="rounded bg-[var(--admin-accent)] px-3 py-1 text-sm font-bold text-black">
          Make my card
        </button>
      </div>
      {tips.length ? (
        <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-gold)]">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-white/50">Tip: print one sheet on plain paper first and hold it against the Avery stock to check that it lines up. Scan the QR with your phone before you order.</p>
    </details>
  );
}
