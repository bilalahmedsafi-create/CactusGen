"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — left control panel: model, provider, media, prompt, settings
// and the sticky Generate bar. Stateless: CreateStudio owns every value.
// ─────────────────────────────────────────────────────────────────────────────
import { useLayoutEffect, useRef, useState } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Minus, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRevanaModel } from "@/lib/revanaModels";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import styles from "./create.module.css";
import { capsBadge, getCaps, groupedVideoModels, type CreateProvider, type ModelCaps } from "./modelCaps";
import { RefsStrip, SingleSlot } from "./MediaSlots";
import { parseRatio, type MediaItem, type SlotTarget } from "./shared";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#2DD4BF]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e14]";

export interface Blocker {
  text: string;
  action?: "settings";
}

export interface ControlPanelProps {
  model: string;
  providers: Record<string, CreateProvider>;
  caps: ModelCaps;
  onModelChange: (id: string) => void;
  onProviderChange: (p: CreateProvider) => void;

  startFrame: MediaItem | null;
  endFrame: MediaItem | null;
  refs: MediaItem[];
  video: MediaItem | null;
  framesLocked: boolean;
  refsLocked: boolean;
  onFiles: (target: SlotTarget, files: File[]) => void;
  onUrl: (target: SlotTarget, url: string) => void;
  onRemove: (target: SlotTarget, id: string) => void;
  onLibrary: (target: SlotTarget) => void;
  onRatio: (target: SlotTarget, id: string, ratio: number) => void;

  prompt: string;
  onPromptChange: (v: string) => void;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  promptFlash: boolean;

  duration: number;
  onDurationChange: (n: number) => void;
  resolution: string;
  onResolutionChange: (v: string) => void;
  mode: string;
  onModeChange: (v: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (v: string) => void;
  sound: boolean;
  onSoundChange: (v: boolean) => void;

  blocker: Blocker | null;
  submitting: boolean;
  price: number | null;
  /** Price is a ceiling (edits bill the input clip's length, unknown up front). */
  priceIsMax?: boolean;
  summary: string;
  onGenerate: () => void;
  onOpenSettings: () => void;
}

// ── Small building blocks ─────────────────────────────────────────────────────

function SectionLabel({ children, id, trailing }: { children: React.ReactNode; id?: string; trailing?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span id={id} className="text-[12px] font-medium text-(--c-text-2)">{children}</span>
      {trailing}
    </div>
  );
}

function RevanaBadge() {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-(--c-revana)/35 bg-(--c-revana)/10 px-1.5 text-[10px] font-semibold tracking-wide text-(--c-revana)">
      Revana
    </span>
  );
}

interface ChipOption {
  value: string;
  label: string;
  glyph?: React.ReactNode;
}

/** Single-choice chip row (radiogroup with roving focus + arrow keys). */
function ChipGroup({ label, options, value, onChange }: {
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = `chips-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (delta: number) => {
    const next = (current + delta + options.length) % options.length;
    onChange(options[next].value);
    btnRefs.current[next]?.focus();
  };

  return (
    <div>
      <SectionLabel id={labelId}>{label}</SectionLabel>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        }}
      >
        {options.map((o, i) => {
          const active = i === current;
          return (
            <button
              key={o.value}
              ref={(el) => { btnRefs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex h-8 select-none items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium tabular-nums transition-colors duration-150",
                active
                  ? "border-[#2DD4BF]/55 bg-(--c-accent-soft) text-(--c-text)"
                  : "border-(--c-line) bg-white/[0.02] text-(--c-text-2) hover:border-(--c-line-2) hover:text-(--c-text)",
                FOCUS,
              )}
            >
              {o.glyph}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatioGlyph({ ratio, active }: { ratio: string; active: boolean }) {
  const r = parseRatio(ratio);
  const color = active ? "border-[#2DD4BF]" : "border-current";
  if (!r) return <span aria-hidden className={cn("inline-block size-3 rounded-[2px] border border-dashed opacity-80", color)} />;
  const max = 13;
  const w = r >= 1 ? max : Math.max(5, Math.round(max * r));
  const h = r >= 1 ? Math.max(5, Math.round(max / r)) : max;
  return <span aria-hidden className={cn("inline-block rounded-[2px] border-[1.5px] opacity-90", color)} style={{ width: w, height: h }} />;
}

function prettyRatio(r: string): string {
  if (r.toLowerCase() === "adaptive") return "Adaptive";
  if (r.toLowerCase() === "auto") return "Auto";
  return r;
}

// ── Model picker ──────────────────────────────────────────────────────────────

function ModelPicker({ model, caps, providers, onChange }: {
  model: string;
  caps: ModelCaps;
  providers: Record<string, CreateProvider>;
  onChange: (id: string) => void;
}) {
  const groups = groupedVideoModels();
  return (
    <Select.Root value={model} onValueChange={(v) => { if (typeof v === "string") onChange(v); }}>
      <Select.Label className="mb-2 text-[12px] font-medium text-(--c-text-2)">Model</Select.Label>
      <Select.Trigger
        className={cn(
          "flex w-full select-none items-center gap-3 rounded-xl border border-(--c-line) bg-(--c-raise) px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-(--c-line-2) data-popup-open:border-white/20",
          FOCUS,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-(--c-text)">{caps.name}</span>
            {isRevanaModel(model) && <RevanaBadge />}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-(--c-text-3)">{capsBadge(caps) || caps.id}</span>
        </span>
        <Select.Icon className="shrink-0 text-(--c-text-3)">
          <ChevronDown className="size-4" strokeWidth={2} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner alignItemWithTrigger={false} sideOffset={6} className={cn(styles.tokens, "z-[1200] outline-none")}>
          <Select.Popup
            className={cn(
              styles.scroll,
              "max-h-[min(70vh,var(--available-height))] w-(--anchor-width) min-w-[300px] origin-(--transform-origin) overflow-y-auto rounded-xl border border-(--c-line-2) bg-(--c-raise) p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.65),0_2px_8px_rgba(0,0,0,0.4)] outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            )}
          >
            <Select.List>
              {groups.map((g) => (
                <Select.Group key={g.provider} className="pb-1 last:pb-0">
                  <Select.GroupLabel className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-(--c-text-3)">{g.provider}</Select.GroupLabel>
                  {g.models.map((m) => {
                    const badge = capsBadge(getCaps(m.id, providers[m.id] ?? "kie"));
                    return (
                      <Select.Item
                        key={m.id}
                        value={m.id}
                        className="group/item flex cursor-default select-none items-center gap-3 rounded-lg px-2.5 py-2 outline-none data-highlighted:bg-white/[0.06]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Select.ItemText className="truncate text-[13px] font-medium text-(--c-text)">{m.name}</Select.ItemText>
                            {isRevanaModel(m.id) && <RevanaBadge />}
                          </span>
                          {badge && <span className="mt-0.5 block truncate text-[11.5px] text-(--c-text-3)">{badge}</span>}
                        </span>
                        <Select.ItemIndicator className="shrink-0 text-[#2DD4BF]">
                          <Check className="size-4" strokeWidth={2.2} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    );
                  })}
                </Select.Group>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function ProviderToggle({ value, onChange }: { value: CreateProvider; onChange: (p: CreateProvider) => void }) {
  const options: { id: CreateProvider; label: string }[] = [
    { id: "kie", label: "Kie.ai" },
    { id: "revana", label: "Revana" },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div>
      <SectionLabel id="provider-label">Run on</SectionLabel>
      <div
        role="radiogroup"
        aria-labelledby="provider-label"
        className="grid grid-cols-2 gap-0.5 rounded-[10px] border border-(--c-line) bg-(--c-input) p-0.5"
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            const next = value === "kie" ? 1 : 0;
            onChange(options[next].id);
            refs.current[next]?.focus();
          }
        }}
      >
        {options.map((o, i) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(o.id)}
              className={cn(
                "h-8 select-none rounded-lg text-[12.5px] font-medium transition-colors duration-150",
                active
                  ? o.id === "revana"
                    ? "bg-(--c-revana)/15 text-(--c-text) shadow-[inset_0_0_0_1px_rgba(180,162,251,0.35)]"
                    : "bg-white/[0.09] text-(--c-text) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                  : "text-(--c-text-3) hover:text-(--c-text-2)",
                FOCUS,
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DurationControl({ caps, value, onChange }: { caps: ModelCaps; value: number; onChange: (n: number) => void }) {
  const spec = caps.duration;
  if (spec.kind === "none") {
    return (
      <div>
        <SectionLabel>Duration</SectionLabel>
        <p className="text-[12px] text-(--c-text-3)">
          {caps.video ? "Follows the length of the input video." : caps.isVeo ? "Fixed at 8 seconds by the model." : "Set by the model."}
        </p>
      </div>
    );
  }
  if (spec.kind === "list") {
    return (
      <ChipGroup
        label="Duration"
        options={spec.values.map((v) => ({ value: String(v), label: `${v}s` }))}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
      />
    );
  }
  const pct = spec.max === spec.min ? 100 : ((value - spec.min) / (spec.max - spec.min)) * 100;
  const step = (d: number) => onChange(Math.max(spec.min, Math.min(spec.max, value + d)));
  return (
    <div>
      <SectionLabel trailing={<span className="text-[11px] tabular-nums text-(--c-text-3)">{spec.min}–{spec.max}s</span>}>
        <label htmlFor="create-duration">Duration</label>
      </SectionLabel>
      <div className="flex items-center gap-3">
        <input
          id="create-duration"
          type="range"
          min={spec.min}
          max={spec.max}
          step={1}
          value={value}
          aria-valuetext={`${value} seconds`}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.range}
          style={{ ["--fill" as string]: `${pct}%` } as React.CSSProperties}
        />
        <div className="flex h-8 shrink-0 items-center rounded-lg border border-(--c-line) bg-(--c-input)">
          <button
            type="button"
            aria-label="Shorter"
            disabled={value <= spec.min}
            onClick={() => step(-1)}
            className={cn("grid h-full w-7 place-items-center rounded-l-lg text-(--c-text-2) transition-colors hover:text-(--c-text) disabled:opacity-35", FOCUS)}
          >
            <Minus className="size-3.5" strokeWidth={2} />
          </button>
          <span className="w-8 text-center text-[12.5px] font-medium tabular-nums text-(--c-text)">{value}s</span>
          <button
            type="button"
            aria-label="Longer"
            disabled={value >= spec.max}
            onClick={() => step(1)}
            className={cn("grid h-full w-7 place-items-center rounded-r-lg text-(--c-text-2) transition-colors hover:text-(--c-text) disabled:opacity-35", FOCUS)}
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SoundSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div id="sound-label" className="text-[12px] font-medium text-(--c-text-2)">Sound</div>
        <div className="text-[11.5px] text-(--c-text-3)">Generate audio with the clip</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby="sound-label"
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-150",
          value ? "border-[#2DD4BF]/70 bg-[#2DD4BF]" : "border-(--c-line-2) bg-white/[0.06]",
          FOCUS,
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-[18px] -translate-y-1/2 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-[left,background-color] duration-150",
            value ? "left-[19px] bg-(--c-accent-ink)" : "left-[2px] bg-white/80",
          )}
        />
      </button>
    </div>
  );
}

function PromptBox({ value, onChange, caps, promptRef, flash, onSubmit }: {
  value: string;
  onChange: (v: string) => void;
  caps: ModelCaps;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  flash: boolean;
  onSubmit: () => void;
}) {
  const [isMac] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  const max = caps.promptMaxLength;
  const over = max !== null && value.length > max;
  const near = max !== null && value.length > max * 0.8;

  // Autosize between ~5 lines and 45% of the viewport.
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 132), Math.round(window.innerHeight * 0.45))}px`;
  }, [value, promptRef]);

  return (
    <div>
      <SectionLabel trailing={caps.promptOptional ? <span className="text-[11px] text-(--c-text-3)">Optional</span> : undefined}>
        <label htmlFor="create-prompt">Prompt</label>
      </SectionLabel>
      <div
        className={cn(
          "rounded-xl border bg-(--c-input) transition-[border-color,box-shadow] duration-200 focus-within:border-white/20",
          over ? "border-(--c-danger)/60" : "border-(--c-line)",
          flash && "border-[#2DD4BF]/60 shadow-[0_0_0_3px_rgba(45,212,191,0.15)]",
        )}
      >
        <textarea
          id="create-prompt"
          ref={promptRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={5}
          spellCheck
          autoComplete="off"
          placeholder={caps.video
            ? "Describe the change, e.g. turn the street into a rainy neon night"
            : "Describe the shot: subject, action, camera move, light, mood"}
          className={cn(styles.prompt, "block w-full bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-relaxed text-(--c-text) outline-none")}
        />
        <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-1">
          <span className={cn("text-[11px] tabular-nums", over ? "text-(--c-danger)" : near ? "text-(--c-text-2)" : "text-(--c-text-3)")}>
            {max !== null ? `${value.length.toLocaleString()} / ${max.toLocaleString()}` : `${value.length.toLocaleString()} chars`}
          </span>
          <span className="hidden items-center gap-1.5 text-[11px] text-(--c-text-3) md:flex">
            <KbdGroup>
              <Kbd className="bg-white/[0.07] text-(--c-text-2)">{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd className="bg-white/[0.07] text-(--c-text-2)">Enter</Kbd>
            </KbdGroup>
            to generate
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ControlPanel(p: ControlPanelProps) {
  const { caps } = p;
  const provider = p.providers[p.model] ?? "kie";
  const showFrames = caps.startFrame || caps.endFrame;
  const lockedFramesText = "Off while references are set";
  const lockedRefsText = "Off while a start or end frame is set. A clip starts from frames or from references, not both.";

  const ratioOptions: ChipOption[] = caps.ratios.map((r) => ({
    value: r,
    label: prettyRatio(r),
    glyph: <RatioGlyph ratio={r} active={r === p.aspectRatio} />,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn(styles.scroll, "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pt-4 max-md:overflow-visible")}>
        <section className="flex flex-col gap-3">
          <ModelPicker model={p.model} caps={caps} providers={p.providers} onChange={p.onModelChange} />
          {isRevanaModel(p.model) && <ProviderToggle value={provider} onChange={p.onProviderChange} />}
        </section>

        {(caps.video || showFrames || caps.maxRefs > 0) && (
          <section className="flex flex-col gap-4" aria-label="Inputs">
            {caps.video && (
              <div>
                <SectionLabel>{caps.isMotionControl ? "Motion video" : "Video to edit"}</SectionLabel>
                <SingleSlot
                  slot="video"
                  label={caps.isMotionControl ? "Motion video" : "Input video"}
                  accept="video"
                  item={p.video}
                  required={caps.video.required}
                  onFiles={(f) => p.onFiles("video", f)}
                  onUrl={(u) => p.onUrl("video", u)}
                  onRemove={() => p.video && p.onRemove("video", p.video.id)}
                  onLibrary={() => p.onLibrary("video")}
                  onRatio={(r) => p.video && p.onRatio("video", p.video.id, r)}
                  className="aspect-video"
                />
              </div>
            )}

            {showFrames && (
              <div>
                <SectionLabel>{caps.startFrame && caps.endFrame ? "Frames" : caps.isMotionControl ? "Character" : "Image"}</SectionLabel>
                <div className={cn("grid gap-2", caps.startFrame && caps.endFrame ? "grid-cols-2" : "grid-cols-1")}>
                  {caps.startFrame && (
                    <SingleSlot
                      slot="startFrame"
                      label={caps.isMotionControl ? "Character image" : "Start frame"}
                      accept="image"
                      item={p.startFrame}
                      required={caps.requiresStartFrame}
                      disabled={p.framesLocked}
                      lockedReason={lockedFramesText}
                      onFiles={(f) => p.onFiles("startFrame", f)}
                      onUrl={(u) => p.onUrl("startFrame", u)}
                      onRemove={() => p.startFrame && p.onRemove("startFrame", p.startFrame.id)}
                      onLibrary={() => p.onLibrary("startFrame")}
                      onRatio={(r) => p.startFrame && p.onRatio("startFrame", p.startFrame.id, r)}
                      className={caps.endFrame ? "h-[124px]" : "h-[150px]"}
                    />
                  )}
                  {caps.endFrame && (
                    <SingleSlot
                      slot="endFrame"
                      label="End frame"
                      accept="image"
                      item={p.endFrame}
                      disabled={p.framesLocked}
                      lockedReason={lockedFramesText}
                      onFiles={(f) => p.onFiles("endFrame", f)}
                      onUrl={(u) => p.onUrl("endFrame", u)}
                      onRemove={() => p.endFrame && p.onRemove("endFrame", p.endFrame.id)}
                      onLibrary={() => p.onLibrary("endFrame")}
                      onRatio={(r) => p.endFrame && p.onRatio("endFrame", p.endFrame.id, r)}
                      className="h-[124px]"
                    />
                  )}
                </div>
              </div>
            )}

            {caps.maxRefs > 0 && (
              <RefsStrip
                items={p.refs}
                max={caps.maxRefs}
                locked={p.refsLocked}
                lockedReason={lockedRefsText}
                required={caps.requiresRefs}
                onFiles={(f) => p.onFiles("refs", f)}
                onUrl={(u) => p.onUrl("refs", u)}
                onRemove={(id) => p.onRemove("refs", id)}
                onLibrary={() => p.onLibrary("refs")}
              />
            )}
          </section>
        )}

        <PromptBox
          value={p.prompt}
          onChange={p.onPromptChange}
          caps={caps}
          promptRef={p.promptRef}
          flash={p.promptFlash}
          onSubmit={p.onGenerate}
        />

        <section className="flex flex-col gap-5" aria-label="Settings">
          <DurationControl caps={caps} value={p.duration} onChange={p.onDurationChange} />
          {caps.resolutions.length > 1 && (
            <ChipGroup
              label="Resolution"
              options={caps.resolutions.map((r) => ({ value: r.value, label: r.label }))}
              value={p.resolution}
              onChange={p.onResolutionChange}
            />
          )}
          {caps.modes.length > 1 && (
            <ChipGroup
              label="Mode"
              options={caps.modes.map((m) => ({ value: m.value, label: m.label }))}
              value={p.mode}
              onChange={p.onModeChange}
            />
          )}
          {caps.ratios.length > 1 && (
            <ChipGroup label="Aspect ratio" options={ratioOptions} value={p.aspectRatio} onChange={p.onAspectRatioChange} />
          )}
          {caps.sound && <SoundSwitch value={p.sound} onChange={p.onSoundChange} />}
        </section>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-(--c-line) bg-(--c-panel) px-4 pb-4 pt-3">
        <div className="mb-2.5 flex min-h-[18px] items-center gap-1.5 text-[12px]" aria-live="polite">
          {p.blocker ? (
            <>
              <CircleAlert className="size-3.5 shrink-0 text-(--c-text-3)" strokeWidth={2} />
              <span className="min-w-0 truncate text-(--c-text-2)">{p.blocker.text}</span>
              {p.blocker.action === "settings" && (
                <button
                  type="button"
                  onClick={p.onOpenSettings}
                  className={cn("ml-auto shrink-0 rounded text-[12px] font-medium text-[#2DD4BF] underline-offset-2 hover:underline", FOCUS)}
                >
                  Open settings
                </button>
              )}
            </>
          ) : (
            <span className="min-w-0 truncate text-(--c-text-3)">{p.summary}</span>
          )}
        </div>
        <button
          type="button"
          onClick={p.onGenerate}
          disabled={!!p.blocker || p.submitting}
          className={cn(
            "flex h-11 w-full select-none items-center justify-center gap-2 rounded-[11px] text-[14px] font-semibold transition-[background-color,box-shadow,transform,color] duration-150",
            p.blocker
              ? "cursor-not-allowed bg-white/[0.06] text-(--c-text-3)"
              : "bg-[#2DD4BF] text-(--c-accent-ink) shadow-[0_6px_20px_rgba(45,212,191,0.22)] hover:bg-[#3ee0cb] hover:shadow-[0_8px_26px_rgba(45,212,191,0.32)] active:scale-[0.985] disabled:cursor-progress",
            FOCUS,
          )}
        >
          {p.submitting
            ? <LoaderCircle className="size-4 animate-spin" strokeWidth={2.4} />
            : <Sparkles className="size-4" strokeWidth={2.2} />}
          <span>Generate</span>
          {p.price !== null && (
            <span className="tabular-nums opacity-80">· {p.priceIsMax ? "up to " : ""}${p.price.toFixed(2)}</span>
          )}
        </button>
      </div>
    </div>
  );
}
