/**
 * D263 S5: draws a designer QR element (vector, sharp at any print size).
 * The module path is rebuilt from the stored spec (memo per spec), so the
 * design JSON stays small. Gradient fill and colour come from the element.
 */
import { useMemo } from "react";
import type { DesignElement } from "@/lib/cms/banner-elements-core";
import { qrDesignPath, qrPayload } from "@/lib/printing/qr-design-core";

export function DesignQr({ el }: { el: DesignElement }) {
  const spec = el.qr!;
  const key = JSON.stringify(spec);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const b = useMemo(() => qrDesignPath(qrPayload(spec.content), spec), [key]);
  const gid = `qrg-${el.id}`;
  const fill = el.gradient ? `url(#${gid})` : el.fill;
  const pad = spec.plate ? 16 : 0;
  const box = 256 + pad * 2;
  const hole = (spec.logoHole / 100) * 256;
  return (
    <svg viewBox={`${-pad} ${-pad} ${box} ${box}`} width="100%" height="100%" style={{ display: "block" }} role="img" aria-label="QR code" data-qr="">
      {el.gradient ? (
        <defs>
          <linearGradient id={gid} gradientTransform={`rotate(${el.gradient.angle - 90} .5 .5)`}>
            <stop offset="0" stopColor={el.gradient.from} />
            <stop offset="1" stopColor={el.gradient.to} />
          </linearGradient>
        </defs>
      ) : null}
      {spec.plate ? <rect x={-pad} y={-pad} width={box} height={box} rx={pad} fill={spec.plate} /> : null}
      {b.ok ? (
        <>
          <path d={b.path} fill={fill} />
          <path d={b.eyes} fill={spec.eyeColor ?? fill} />
          {spec.logo && hole > 0 ? (
            <image href={spec.logo} x={128 - hole / 2 + hole * 0.08} y={128 - hole / 2 + hole * 0.08} width={hole * 0.84} height={hole * 0.84} preserveAspectRatio="xMidYMid meet" />
          ) : null}
        </>
      ) : (
        <text x="128" y="134" textAnchor="middle" fontSize="18" fill="#c00">
          QR: fill in the link
        </text>
      )}
    </svg>
  );
}
