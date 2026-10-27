"use client";

/**
 * PERF-S5: lazy, async-decoded thumbnail for back-office grids. Requests a
 * resized Supabase render URL; if the transform endpoint is unavailable it
 * falls back to the original image once, so a thumbnail can never go blank.
 */
import { useState } from "react";
import { adminThumbUrl } from "@/lib/media/thumb-url-core";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; width?: number };

export function AdminThumb({ src, width = 320, alt = "", ...rest }: Props) {
  const thumb = adminThumbUrl(src, width);
  const [failed, setFailed] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      alt={alt}
      src={failed ? src : thumb}
      loading={rest.loading ?? "lazy"}
      decoding="async"
      onError={() => {
        if (!failed && thumb !== src) setFailed(true);
      }}
    />
  );
}
