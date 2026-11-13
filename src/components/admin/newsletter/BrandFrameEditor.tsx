"use client";

/**
 * BrandFrameEditor — D243 E-1 (SOP-22 G-121).
 *
 * Owner/admin settings for the locked newsletter header and footer. The
 * preview on the right is the real email renderer with a sample body, in
 * the dark and the light look, so what you see is what members get.
 */
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Input, Select, Textarea } from "@/components/admin/ui";
import {
  FRAME_LOGO_MAX,
  FRAME_LOGO_MIN,
  FRAME_NOTE_MAX,
  FRAME_STYLES,
  FRAME_STYLE_LABEL,
  FRAME_TAGLINE_MAX,
  FRAME_TITLE_MAX,
  SOCIAL_KEYS,
  normalizeFrame,
  type BrandFrame,
} from "@/lib/cms/newsletter-frame-core";
import { normalizeCanvas, renderCanvasEmail, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";
import { saveBrandFrameAction, uploadFrameLogoAction } from "@/app/admin/newsletter/frame/actions";

const LABEL = "block text-[0.68rem] font-black uppercase tracking-[0.12em] text-[var(--admin-text-faint)]";
const SOCIAL_LABEL: Record<(typeof SOCIAL_KEYS)[number], string> = { instagram: "Instagram", facebook: "Facebook", google: "Google", yelp: "Yelp", leafly: "Leafly" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Tick({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--admin-accent)]" />
      {children}
    </label>
  );
}

const SAMPLE_BODY = normalizeCanvas({
  subject: "Sample",
  preheader: "Sample",
  blocks: [
    { id: "s1", type: "headline", text: "Your body goes here", sub: "Everything between the header and the footer is yours to design.", size: 28 },
    { id: "s2", type: "text", text: "This sample shows how the brand frame wraps every newsletter. Change a setting on the left and the preview updates.", align: "center" },
    { id: "s3", type: "button", label: "Shop the menu", href: "https://www.greenwaymarijuana.com/menu", color: "accent" },
  ],
});

export function BrandFrameEditor({ initial, renderOpts, canEdit }: { initial: BrandFrame; renderOpts: RenderOpts; canEdit: boolean }) {
  const [frame, setFrameRaw] = useState<BrandFrame>(initial);
  const [dirty, setDirty] = useState(false);
  const [look, setLook] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<"desktop" | "phone">("desktop");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoTarget = useRef<"logoUrl" | "logoUrlLight">("logoUrl");

  const set = (patch: Partial<BrandFrame>) => {
    setFrameRaw({ ...frame, ...patch });
    setDirty(true);
  };
  const clean = useMemo(() => normalizeFrame(frame), [frame]);
  const html = useMemo(
    () => renderCanvasEmail({ ...SAMPLE_BODY, theme: look }, { ...renderOpts, frame: clean, issue: renderOpts.issue ?? { number: 1, date: new Date().toISOString().slice(0, 10) } }),
    [clean, look, renderOpts],
  );

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveBrandFrameAction(frame);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      setFrameRaw(r.frame);
      setDirty(false);
      setMsg({ tone: "ok", text: "Saved. Every newsletter now uses this frame (drafts, tests and sends)." });
    });
  const onFile = (f: File | undefined) => {
    if (!f) return;
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadFrameLogoAction(fd);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      set({ [logoTarget.current]: r.src, logo: "custom" } as Partial<BrandFrame>);
      setMsg({ tone: "ok", text: "Logo uploaded. Press Save to use it." });
    });
  };
  const pick = (t: "logoUrl" | "logoUrlLight") => {
    logoTarget.current = t;
    fileRef.current?.click();
  };

  const dis = !canEdit;
  return (
    <div className="space-y-4" data-testid="brand-frame-editor">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
        <Button type="button" variant="save" size="sm" onClick={save} disabled={pending || dis}>{dirty ? "Save frame" : "Saved"}</Button>
        <Button type="button" variant="neutral" size="sm" onClick={() => set(normalizeFrame(null))} disabled={pending || dis}>Reset to Greenway default</Button>
        {pending ? <span className="text-xs text-[var(--admin-text-faint)]">Working…</span> : null}
        {dis ? <span className="text-xs text-[var(--admin-orange)]">View only: the owner or an admin changes the brand frame.</span> : null}
      </div>
      {msg ? (
        <p role="status" className={`rounded-[var(--admin-radius-md)] px-3 py-2 text-xs ${msg.tone === "ok" ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>{msg.text}</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <fieldset disabled={dis} className="space-y-4">
          <div className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Header</p>
            <Tick checked={frame.enabled} onChange={(v) => set({ enabled: v })}>Use the brand frame on every newsletter (off = the old plain header)</Tick>
            <Row label="Style">
              <div className="grid gap-2 sm:grid-cols-3">
                {FRAME_STYLES.map((s) => (
                  <button key={s} type="button" onClick={() => set({ style: s })} className={`rounded-[var(--admin-radius-md)] border p-2 text-left text-xs ${frame.style === s ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-text)]" : "border-[var(--admin-border)] text-[var(--admin-text-muted)]"}`}>
                    <span className="block font-semibold capitalize">{s}</span>
                    {FRAME_STYLE_LABEL[s].split(": ")[1]}
                  </button>
                ))}
              </div>
            </Row>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Logo">
                <Select value={frame.logo} onChange={(e) => set({ logo: e.target.value as BrandFrame["logo"] })}>
                  <option value="wordmark">Greenway wordmark (auto light/dark)</option>
                  <option value="custom">My own logo</option>
                  <option value="none">No logo (store name in text)</option>
                </Select>
              </Row>
              <Row label={`Logo width (${FRAME_LOGO_MIN}-${FRAME_LOGO_MAX} px)`}>
                <Input type="number" min={FRAME_LOGO_MIN} max={FRAME_LOGO_MAX} value={frame.logoWidth} onChange={(e) => set({ logoWidth: Number(e.target.value) })} />
              </Row>
            </div>
            {frame.logo === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Row label="Logo for dark emails (light artwork)">
                  <div className="flex gap-2">
                    <Input value={frame.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…png" />
                    <Button type="button" size="sm" variant="neutral" onClick={() => pick("logoUrl")}>Upload</Button>
                  </div>
                </Row>
                <Row label="Logo for light emails (dark artwork, optional)">
                  <div className="flex gap-2">
                    <Input value={frame.logoUrlLight} onChange={(e) => set({ logoUrlLight: e.target.value })} placeholder="https://…png" />
                    <Button type="button" size="sm" variant="neutral" onClick={() => pick("logoUrlLight")}>Upload</Button>
                  </div>
                </Row>
              </div>
            ) : null}
            <Row label={`Newsletter title (${frame.title.length}/${FRAME_TITLE_MAX})`}>
              <Input value={frame.title} maxLength={FRAME_TITLE_MAX} onChange={(e) => set({ title: e.target.value })} placeholder="The Greenway Weekly" />
            </Row>
            <Row label={`Tagline (${frame.tagline.length}/${FRAME_TAGLINE_MAX})`}>
              <Input value={frame.tagline} maxLength={FRAME_TAGLINE_MAX} onChange={(e) => set({ tagline: e.target.value })} />
            </Row>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tick checked={frame.showIssue} onChange={(v) => set({ showIssue: v })}>Issue number</Tick>
              <Tick checked={frame.showDate} onChange={(v) => set({ showDate: v })}>Date</Tick>
              <Row label="Issues before the app">
                <Input type="number" min={0} max={9999} value={frame.issueOffset} onChange={(e) => set({ issueOffset: Number(e.target.value) })} />
              </Row>
            </div>
            <Row label="Accent colour (rules, the Bold band, the 21+ badge; blank = the look's green)">
              <div className="flex items-center gap-2">
                <input type="color" value={frame.accent || "#7ed957"} onChange={(e) => set({ accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-[var(--admin-border)] bg-transparent" aria-label="Accent colour" />
                <Input value={frame.accent} onChange={(e) => set({ accent: e.target.value })} placeholder="#7ed957" className="w-32" />
                <Button type="button" size="sm" variant="neutral" onClick={() => set({ accent: "" })}>Use the look&apos;s green</Button>
              </div>
            </Row>
          </div>

          <div className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Footer</p>
            <Row label="Social icons">
              <div className="flex flex-wrap gap-3">
                {SOCIAL_KEYS.map((k) => (
                  <Tick key={k} checked={frame.social[k]} onChange={(v) => set({ social: { ...frame.social, [k]: v } })}>{SOCIAL_LABEL[k]}</Tick>
                ))}
              </div>
            </Row>
            <div className="flex flex-wrap gap-4">
              <Tick checked={frame.showAddress} onChange={(v) => set({ showAddress: v })}>Address</Tick>
              <Tick checked={frame.showHours} onChange={(v) => set({ showHours: v })}>Hours</Tick>
              <Tick checked={frame.showPhone} onChange={(v) => set({ showPhone: v })}>Phone</Tick>
              <Tick checked={frame.showAgeBadge} onChange={(v) => set({ showAgeBadge: v })}>21+ badge</Tick>
            </div>
            <Row label={`Footer note (optional, ${frame.footerNote.length}/${FRAME_NOTE_MAX})`}>
              <Textarea rows={2} maxLength={FRAME_NOTE_MAX} value={frame.footerNote} onChange={(e) => set({ footerNote: e.target.value })} placeholder="e.g. Cash and debit accepted. ATM on site." />
            </Row>
            <p className="rounded-[var(--admin-radius-md)] border border-dashed border-[var(--admin-border)] px-3 py-2 text-xs text-[var(--admin-text-faint)]">
              Always printed, whatever you pick: the four required warnings (WAC 314-55-155(7)) and the unsubscribe link.
            </p>
          </div>
        </fieldset>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Preview</p>
            <span className="ml-auto" />
            {(["dark", "light"] as const).map((l) => (
              <Button key={l} type="button" size="sm" variant={look === l ? "confirm" : "neutral"} onClick={() => setLook(l)}>{l === "dark" ? "Dark look" : "Light look"}</Button>
            ))}
            {(["desktop", "phone"] as const).map((v) => (
              <Button key={v} type="button" size="sm" variant={view === v ? "confirm" : "neutral"} onClick={() => setView(v)}>{v === "desktop" ? "Desktop" : "Phone"}</Button>
            ))}
          </div>
          <div className="flex justify-center rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2,#111)] p-3">
            <iframe title="Brand frame preview" sandbox="" srcDoc={html} className="h-[900px] rounded-[var(--admin-radius-md)] border-0 bg-white" style={{ width: view === "phone" ? 375 : "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
