"use client";

/**
 * R41 S8 — "✨ AI suggest" for the Studio (moved out of BannerStudio in D263
 * S11 so the print workspace can show it inside the Picture panel). Drafts
 * only: Apply changes unsaved studio state; nothing is saved until Save.
 */
import { useState, useTransition } from "react";
import { mobileImageSrc, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { applySuggestion, type PlacementSuggestion } from "@/lib/cms/banner-ai-core";
import { suggestBannerPlacementAction } from "@/app/admin/banner-ai-actions";
import { CONTROL_HELP } from "@/lib/cms/studio-help-core";
import { Tip } from "./StudioHelp";

export function useStudioAi({
  design,
  imageSrc,
  legacy,
  device,
  setDevice,
  change,
}: {
  design: BannerDesign;
  imageSrc: string;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  device: DesignDevice;
  setDevice: (d: DesignDevice) => void;
  change: (d: BannerDesign) => void;
}) {
  const [ai, setAi] = useState<{ s: PlacementSuggestion; device: DesignDevice } | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiBusy, startAi] = useTransition();

  function askAi() {
    setAiMsg(null);
    setAi(null);
    const forDevice = device;
    startAi(async () => {
      try {
        const res = await suggestBannerPlacementAction({
          imageSrc: forDevice === "mobile" ? mobileImageSrc(design, imageSrc) : imageSrc,
          design,
          legacy,
          device: forDevice,
        });
        if (res.ok) setAi({ s: res.suggestion, device: forDevice });
        else setAiMsg(res.message);
      } catch {
        setAiMsg("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  function applyAi() {
    if (!ai) return;
    if (ai.device !== device) setDevice(ai.device);
    change(applySuggestion(design, ai.s, legacy, ai.device));
    setAi(null);
    setAiMsg("Applied. Not saved yet — press Save draft when you're happy (Undo puts it back).");
  }

  const ghost = ai && ai.device === device ? { zone: ai.s.textZone, focusX: ai.s.focusX, focusY: ai.s.focusY } : null;
  const box = (
    <div className="rounded-md border border-[#ffd700]/30 bg-[#ffd700]/5 px-3 py-2 text-xs text-white/80">
      <div className="flex flex-wrap items-center gap-2">
        <Tip text={imageSrc ? CONTROL_HELP.ai : "Pick a picture first."}>
          <button
            type="button"
            onClick={askAi}
            disabled={aiBusy || !imageSrc}
            className="rounded-full bg-[#ffd700] px-3 py-1 text-xs font-bold text-black hover:bg-[#ffe34d] disabled:opacity-40"
          >
            {aiBusy ? "✨ Looking at the picture…" : `✨ AI suggest (${device === "mobile" ? "phone" : "computer"})`}
          </button>
        </Tip>
        <span className="text-white/55">Suggests the picture focus, where the text fits best, the shade and text colour. Nothing is saved until you press Save.</span>
      </div>
      {ai ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite">
          <span className="text-[#ffd700]">
            Suggestion for {ai.device === "mobile" ? "phone" : "computer"} (dotted box = text area, ring = focus):
          </span>
          <span className="text-white/80">{ai.s.reason || "No reason given."}</span>
          <button type="button" onClick={applyAi} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black">
            Apply
          </button>
          <button type="button" onClick={() => setAi(null)} className="rounded-full bg-white/10 px-3 py-1 text-white/80 hover:bg-white/20">
            Dismiss
          </button>
        </div>
      ) : aiMsg ? (
        <p className="mt-2 text-white/75" aria-live="polite">
          {aiMsg}
        </p>
      ) : null}
    </div>
  );
  return { ghost, box };
}
