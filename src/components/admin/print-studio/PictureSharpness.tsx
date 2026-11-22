"use client";

/** D263 S3: warn-only print sharpness of the background picture. */
import { useEffect, useState } from "react";
import type { DesignPrint } from "@/lib/cms/banner-design-core";
import { pictureSharpness } from "@/lib/printing/print-sizes-core";

export function PictureSharpness({ src, print, need }: { src: string; print?: DesignPrint; need: number }) {
  const [size, setSize] = useState<{ src: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setSize({ src, w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);
  if (!src || !print || !size || size.src !== src) return null;
  const s = pictureSharpness(size.w, size.h, print, need);
  if (!s) return null;
  const c = s.tone === "good" ? "text-emerald-300" : s.tone === "ok" ? "text-[var(--admin-gold)]" : "text-red-300";
  return (
    <p className={`mt-1 text-xs ${c}`}>
      {s.tone === "good" ? "✓" : "⚠️"} {size.w.toLocaleString()} × {size.h.toLocaleString()} px. {s.text}
    </p>
  );
}
