/**
 * R58-S2 — curved text (server-safe, no JS). Draws a text box's words along a
 * circular arc with SVG <textPath>. Two SVGs are emitted — computer geometry
 * and phone geometry (the box width differs) — and the `gwb` container query
 * shows the right one, exactly like the phone picture swap.
 *
 * Paint (colour / gradient / sticker outline / shadow) is applied to the SVG
 * letters; the holder box (curvedBoxStyle) keeps position, font and rotate.
 */
import type { CSSProperties } from "react";
import { DESKTOP_REF_PX, MOBILE_REF_PX, shadowAsFilter, shadowCss, type DesignTextBox } from "@/lib/cms/banner-design-core";
import { curveGeometry } from "@/lib/cms/banner-curve-core";

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function caseText(t: string, tr: DesignTextBox["transform"]): string {
  const one = t.replace(/\s*\n\s*/g, " ").trim();
  if (tr === "uppercase") return one.toUpperCase();
  if (tr === "lowercase") return one.toLowerCase();
  if (tr === "capitalize") return one.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return one;
}

function Arc({ box, text, phone }: { box: DesignTextBox; text: string; phone: boolean }) {
  const curve = box.curve ?? 0;
  const wPct = phone ? (box.mw ?? box.w) : box.w;
  const W = Math.max(20, (wPct / 100) * (phone ? MOBILE_REF_PX : DESKTOP_REF_PX));
  const fs = phone ? box.sizeMobile : box.size;
  const g = curveGeometry(curve, W, fs);
  const id = `gwc${hash(`${g.d}|${box.id}`)}`;
  const grad = box.gradient && box.backdrop === "none" ? box.gradient : null;
  const sw = box.strokeWidth && box.strokeWidth > 0 ? box.strokeWidth * 2 : box.outline ? 1 : 0;
  const strokeColor = box.strokeWidth ? (box.strokeColor ?? "#000000") : box.backdropColor;
  const style: CSSProperties = {
    display: "block",
    width: `${g.widthPct}%`,
    marginLeft: `${g.leftPct}%`,
    aspectRatio: `${1 / g.aspect}`,
    height: "auto",
    overflow: "visible",
    ...(box.shadow !== "none" ? { filter: shadowAsFilter(shadowCss(box)) } : {}),
  };
  return (
    <svg className={phone ? "gw-curve-m" : "gw-curve-d"} viewBox={g.viewBox} style={style} aria-hidden="true" focusable="false">
      <defs>
        <path id={id} d={g.d} fill="none" />
        {grad ? (
          <linearGradient id={`${id}g`} gradientTransform={`rotate(${grad.angle - 90} .5 .5)`}>
            <stop offset="0" stopColor={grad.from} />
            <stop offset="1" stopColor={grad.to} />
          </linearGradient>
        ) : null}
      </defs>
      <text
        fontSize={fs}
        fill={grad ? `url(#${id}g)` : box.color}
        letterSpacing={`${box.letterSpacing}em`}
        {...(sw ? { stroke: strokeColor, strokeWidth: sw, strokeLinejoin: "round" as const, paintOrder: "stroke fill" } : {})}
        style={{ textDecoration: [box.underline ? "underline" : "", box.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined }}
      >
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {text}
        </textPath>
      </text>
    </svg>
  );
}

/** Children for a curved box: both geometries + a real-text copy for screen readers / SEO. */
export function CurvedText({ box, text }: { box: DesignTextBox; text: string }) {
  const t = caseText(text, box.transform);
  return (
    <>
      <span className="sr-only">{text}</span>
      <Arc box={box} text={t} phone={false} />
      <Arc box={box} text={t} phone />
    </>
  );
}
