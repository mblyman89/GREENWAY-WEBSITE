"use client";

/**
 * D263 S5: designer QR codes (Shapes tab, print designs). Add a QR, pick
 * what it opens (website + tracking, phone, text, email, map, Wi-Fi,
 * contact card, text), dot and eye styles, colours, gradient, a white
 * plate, a logo in the middle. Warn-only scan checks for the print size.
 */
import { useMemo } from "react";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { contrastRatio, nextId } from "@/lib/cms/banner-design-core";
import { defaultIcon, type DesignElement } from "@/lib/cms/banner-elements-core";
import { QR_CONTENT_KINDS, QR_EYE_STYLES, QR_MODULE_STYLES, qrChecks, qrDesignPath, qrPayload, type QrContent, type QrSpec } from "@/lib/printing/qr-design-core";
import { ColorField, NumberSlider, Segmented, Toggle, studioInput } from "@/components/admin/banner-studio/controls";

const QR_PLACEHOLDER = "M0 0h256v256H0z";
const SITE = "https://www.greenwaymarijuana.com/menu";

export function addQrElement(design: BannerDesign): DesignElement {
  const qr: QrSpec = { content: { kind: "url", value: SITE, utm: { source: "print", medium: "qr", campaign: "" } }, modules: "rounded", eyes: "rounded", logoHole: 0, plate: "#ffffff" };
  return { ...defaultIcon("qr", "regular", QR_PLACEHOLDER, { id: nextId(design, "qr"), x: 70, y: 55, w: 20, h: null, fill: "#000000" }), qr };
}

export function QrFields({ el, design, viewFt, patch }: { el: DesignElement; design: BannerDesign; viewFt: number; patch: (p: Partial<DesignElement>) => void }) {
  const spec = el.qr!;
  const set = (p: Partial<QrSpec>) => patch({ qr: { ...spec, ...p } });
  const setC = (p: Partial<QrContent>) => set({ content: { ...spec.content, ...p } });
  const c = spec.content;
  const payload = qrPayload(c);
  const build = useMemo(() => qrDesignPath(payload, spec), [payload, spec]);
  const pr = design.frame.print;
  const sizeIn = pr ? ((pr.w + 2 * pr.bleed) * el.w) / 100 : 0;
  const warns = qrChecks({ fg: el.fill, bg: spec.plate ?? "#ffffff", contrast: contrastRatio(el.fill, spec.plate ?? "#ffffff"), sizeIn, viewFt, plate: !!spec.plate, logoHole: spec.logoHole, modules: spec.modules, payload });
  const input = (label: string, value: string | undefined, on: (v: string) => void, ph = "") => (
    <label className="block text-xs text-white/70">
      {label}
      <input className={studioInput} value={value ?? ""} placeholder={ph} onChange={(e) => on(e.target.value)} />
    </label>
  );
  return (
    <div className="space-y-2 rounded-md border border-[#ffd700]/30 bg-[#ffd700]/5 p-2">
      <p className="text-xs font-semibold text-[#ffd700]">▦ QR code</p>
      <label className="block text-xs text-white/70">
        Opens
        <select className={studioInput} value={c.kind} onChange={(e) => setC({ kind: e.target.value as QrContent["kind"] })}>
          {QR_CONTENT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {c.kind === "url" ? (
        <>
          {input("Link", c.value, (value) => setC({ value }), SITE)}
          <div className="grid grid-cols-3 gap-1">
            {input("Tracking: source", c.utm?.source, (source) => setC({ utm: { medium: "", campaign: "", ...c.utm, source } }), "flyer")}
            {input("medium", c.utm?.medium, (medium) => setC({ utm: { source: "", campaign: "", ...c.utm, medium } }), "print")}
            {input("campaign", c.utm?.campaign, (campaign) => setC({ utm: { source: "", medium: "", ...c.utm, campaign } }), "spring-sale")}
          </div>
          <p className="text-[10px] text-white/45">Tracking shows up in your analytics so you can see which flyer or sign brought people in.</p>
        </>
      ) : c.kind === "wifi" ? (
        <>
          {input("Network name", c.ssid, (ssid) => setC({ ssid }))}
          {input("Password", c.password, (password) => setC({ password }))}
        </>
      ) : c.kind === "vcard" ? (
        <>
          {input("Name", c.name, (name) => setC({ name }), "Greenway Marijuana")}
          {input("Phone", c.value, (value) => setC({ value }))}
          {input("Email", c.email, (email) => setC({ email }))}
          {input("Website", c.url, (url) => setC({ url }))}
          {input("Address", c.address, (address) => setC({ address }))}
        </>
      ) : (
        <>
          {input(c.kind === "map" ? "Address" : c.kind === "email" ? "Email address" : c.kind === "text" ? "Text" : "Phone number", c.value, (value) => setC({ value }))}
          {c.kind === "sms" || c.kind === "email" ? input(c.kind === "sms" ? "Message" : "Subject", c.body, (body) => setC({ body })) : null}
        </>
      )}
      <Segmented label="Dots" value={spec.modules} options={QR_MODULE_STYLES.map((m) => ({ value: m.id, label: m.label }))} onChange={(modules) => set({ modules })} />
      <Segmented label="Corner eyes" value={spec.eyes} options={QR_EYE_STYLES.map((m) => ({ value: m.id, label: m.label }))} onChange={(eyes) => set({ eyes })} />
      <ColorField label="Code colour" value={el.fill} onChange={(fill) => patch({ fill })} />
      <Toggle label="Different eye colour" checked={!!spec.eyeColor} onChange={(on) => set({ eyeColor: on ? "#1f8a3a" : undefined })} />
      {spec.eyeColor ? <ColorField label="Eye colour" value={spec.eyeColor} onChange={(eyeColor) => set({ eyeColor })} /> : null}
      <Toggle label="Gradient code" checked={!!el.gradient} onChange={(on) => patch({ gradient: on ? { from: "#1f8a3a", to: "#000000", angle: 135 } : undefined })} />
      {el.gradient ? (
        <>
          <ColorField label="Gradient start" value={el.gradient.from} onChange={(from) => patch({ gradient: { ...el.gradient!, from } })} />
          <ColorField label="Gradient end" value={el.gradient.to} onChange={(to) => patch({ gradient: { ...el.gradient!, to } })} />
        </>
      ) : null}
      <Toggle label="Light plate behind (recommended)" checked={!!spec.plate} onChange={(on) => set({ plate: on ? "#ffffff" : undefined })} />
      {spec.plate ? <ColorField label="Plate colour" value={spec.plate} onChange={(plate) => set({ plate })} /> : null}
      <NumberSlider label="Logo space in the middle" value={spec.logoHole} min={0} max={22} unit="%" onChange={(logoHole) => set({ logoHole })} />
      {spec.logoHole > 0 ? input("Logo picture link (from Media)", spec.logo, (logo) => set({ logo: logo || undefined }), "https://…") : null}
      <p className="text-[11px] text-white/55">
        {build.ok ? `Version ${build.version}, error-correction ${build.level}. ` : `⚠️ ${build.error} `}
        {sizeIn ? `Prints about ${sizeIn.toFixed(1)}" wide.` : ""}
      </p>
      {warns.map((w, i) => (
        <p key={i} className={`text-[11px] ${w.level === "warn" ? "text-[var(--admin-gold)]" : "text-white/55"}`}>
          {w.level === "warn" ? "⚠️ " : "ℹ️ "}
          {w.text}
        </p>
      ))}
      <p className="text-[10px] text-white/45">Always test-scan the printed proof with your phone before ordering.</p>
    </div>
  );
}
