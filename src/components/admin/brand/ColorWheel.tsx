"use client";

/**
 * R64 — a colour wheel / spectrum picker. Angle = hue, distance from the
 * centre = saturation, the slider below = brightness. Drag or click anywhere
 * on the wheel; keyboard users can use the arrow keys (hue ←/→, saturation
 * ↑/↓) or type a hex value in the field next to it.
 */
import { useRef } from "react";
import { hexToHsv, hsvToHex } from "@/lib/brand/brand-kit-core";

export function ColorWheel({ value, onChange, size = 180 }: { value: string; onChange: (hex: string) => void; size?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { h, s, v } = hexToHsv(value);
  const pickAt = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const sat = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    onChange(hsvToHex(hue, sat, v || 1));
  };
  const angle = ((h - 90) * Math.PI) / 180;
  const dotX = 50 + Math.cos(angle) * s * 50;
  const dotY = 50 + Math.sin(angle) * s * 50;
  return (
    <div className="space-y-2" style={{ width: size }}>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Colour wheel — arrow keys change hue and saturation"
        aria-valuenow={Math.round(h)}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuetext={value}
        className="relative cursor-crosshair touch-none rounded-full border border-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle closest-side, rgba(255,255,255,1), rgba(255,255,255,0)), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)`,
          filter: `brightness(${Math.max(0.15, v)})`,
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pickAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pickAt(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 2;
          if (e.key === "ArrowLeft") onChange(hsvToHex(h - step, s, v));
          else if (e.key === "ArrowRight") onChange(hsvToHex(h + step, s, v));
          else if (e.key === "ArrowUp") onChange(hsvToHex(h, Math.min(1, s + step / 100), v));
          else if (e.key === "ArrowDown") onChange(hsvToHex(h, Math.max(0, s - step / 100), v));
          else return;
          e.preventDefault();
        }}
      >
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${dotX}%`, top: `${dotY}%`, backgroundColor: value }}
        />
      </div>
      <label className="block text-[0.68rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
        Brightness
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(v * 100)}
          onChange={(e) => onChange(hsvToHex(h, s, Number(e.target.value) / 100))}
          className="mt-1 w-full accent-[var(--admin-accent)]"
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex(h, s, 1)})` }}
        />
      </label>
    </div>
  );
}
