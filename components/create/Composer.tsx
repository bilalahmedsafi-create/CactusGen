"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — the floating composer docked at the bottom of the page:
//   row 1  round "+" (media popover) · attached thumbnails · autosizing prompt
//   row 2  setting chips (model, duration, aspect, resolution, sound …)
//   right  the lime GENERATE button with the estimated price
// Plus the chip building blocks (option menu, duration, toggle) the video and
// image studios fill it with. Stateless: the studio owns every value.
// ─────────────────────────────────────────────────────────────────────────────
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { Menu } from "@base-ui/react/menu";
import { Check, CircleAlert, Clock, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import styles from "./create.module.css";
import { StatusOverlay, Thumb } from "./MediaSlots";
import type { DurationSpec } from "./modelCaps";
import { parseRatio, type MediaItem } from "./shared";
import { CHIP, FOCUS, MENU_ROW, POPUP } from "./ui";

export interface Blocker {
  text: string;
  action?: "settings";
}

// ── Composer ──────────────────────────────────────────────────────────────────

export interface ComposerProps {
  label: string;
  /** Media popover content ("+"); null hides the button (model takes no files). */
  plusContent: ReactNode | null;
  plusLabel: string;
  plusOpen: boolean;
  onPlusOpenChange: (open: boolean) => void;
  /** Attached media as thumbnails (AttachmentThumb). */
  attachments: ReactNode;
  attachmentCount: number;

  prompt: string;
  onPromptChange: (v: string) => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  promptFlash: boolean;
  promptMaxLength: number | null;

  chips: ReactNode;

  onGenerate: () => void;
  blocker: Blocker | null;
  submitting: boolean;
  price: number | null;
  /** Price is a ceiling (edits bill the input clip's length, unknown up front). */
  priceIsMax?: boolean;
  /** What the price is for, e.g. "per image". */
  priceNote?: string;
  onOpenSettings: () => void;
}

export function Composer({ promptRef, ...p }: ComposerProps) {
  const cardRef = useRef<HTMLFormElement>(null);
  const [isMac] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  const max = p.promptMaxLength;
  const over = max !== null && p.prompt.length > max;
  const disabled = !!p.blocker || p.submitting;

  // Autosize: two lines up to ~35 % of the viewport.
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), Math.max(120, Math.round(window.innerHeight * 0.35)))}px`;
  }, [p.prompt, promptRef]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center bg-linear-to-t from-(--c-bg) from-40% to-transparent px-4 pb-4 pt-12">
      <div className="pointer-events-auto w-full max-w-[780px]">
        <div className="mb-2 flex min-h-5 items-center gap-2 px-1 text-[12px]" aria-live="polite">
          {p.blocker ? (
            <>
              <CircleAlert className="size-3.5 shrink-0 text-(--c-text-3)" strokeWidth={2} />
              <span className="min-w-0 truncate text-(--c-text-2)">{p.blocker.text}</span>
              {p.blocker.action === "settings" && (
                <button
                  type="button"
                  onClick={p.onOpenSettings}
                  className={cn("shrink-0 rounded font-semibold text-(--c-accent) underline-offset-2 hover:underline", FOCUS)}
                >
                  Open settings
                </button>
              )}
            </>
          ) : over ? (
            <span className="text-(--c-danger)">The prompt is over {max?.toLocaleString()} characters.</span>
          ) : null}
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 text-(--c-text-3) md:flex">
            <KbdGroup>
              <Kbd className="bg-white/[0.07] text-(--c-text-2)">{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd className="bg-white/[0.07] text-(--c-text-2)">Enter</Kbd>
            </KbdGroup>
            to generate
          </span>
        </div>

        <form
          ref={cardRef}
          aria-label={p.label}
          onSubmit={(e) => {
            e.preventDefault();
            p.onGenerate();
          }}
          className={cn(
            "relative flex gap-3 rounded-2xl bg-(--c-composer) p-3 shadow-[0_20px_60px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-shadow duration-200 sm:gap-4 sm:p-4 max-sm:flex-col",
            p.promptFlash && "shadow-[0_20px_60px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(212,255,42,0.55),0_0_0_4px_rgba(212,255,42,0.12)]",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {p.attachmentCount > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Attached media" role="group">{p.attachments}</div>
            )}

            <div className="flex items-start gap-3">
              {p.plusContent !== null && (
                <Popover.Root open={p.plusOpen} onOpenChange={(open) => p.onPlusOpenChange(open)}>
                  <Popover.Trigger
                    aria-label={p.plusLabel}
                    className={cn(
                      "relative mt-1.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.08] text-(--c-text) transition-colors duration-150 hover:bg-white/[0.14] data-popup-open:bg-white/[0.16]",
                      FOCUS,
                    )}
                  >
                    <Plus className="size-4" strokeWidth={2.2} />
                    {p.attachmentCount > 0 && (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-(--c-accent) px-1 text-[9.5px] font-bold tabular-nums text-(--c-accent-ink)">
                        {p.attachmentCount}
                      </span>
                    )}
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner
                      anchor={cardRef}
                      side="top"
                      align="start"
                      sideOffset={10}
                      collisionPadding={12}
                      className={cn(styles.tokens, "z-[1200] outline-none")}
                    >
                      <Popover.Popup className={cn(POPUP, styles.scroll, "max-h-[min(70vh,var(--available-height))] w-[min(420px,calc(100vw-32px))] overflow-y-auto p-4")}>
                        <Popover.Title className="mb-3 text-[13px] font-semibold text-(--c-text)">{p.plusLabel}</Popover.Title>
                        {p.plusContent}
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              )}
              <label htmlFor="create-prompt" className="sr-only">Prompt</label>
              <textarea
                id="create-prompt"
                ref={promptRef}
                value={p.prompt}
                onChange={(e) => p.onPromptChange(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    p.onGenerate();
                  }
                }}
                rows={2}
                spellCheck
                autoComplete="off"
                placeholder={p.placeholder}
                aria-invalid={over || undefined}
                className={cn(styles.prompt, "block min-h-11 w-full min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-[22px] text-(--c-text) outline-none")}
              />
            </div>

            <div className={cn(styles.chipRow, "-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-0.5")}>
              {p.chips}
            </div>
          </div>

          <button
            type="submit"
            disabled={disabled}
            aria-label={p.price !== null
              ? `Generate — ${p.priceIsMax ? "up to " : ""}$${p.price.toFixed(2)}${p.priceNote ? ` ${p.priceNote}` : ""}`
              : "Generate"}
            className={cn(
              "flex shrink-0 select-none flex-col items-center justify-center gap-0.5 rounded-xl transition-[background-color,box-shadow,transform,color] duration-150 max-sm:h-12 max-sm:w-full sm:w-[124px] sm:self-stretch",
              p.blocker
                ? "cursor-not-allowed bg-white/[0.07] text-(--c-text-3)"
                : "bg-(--c-accent) text-(--c-accent-ink) shadow-[0_8px_24px_rgba(212,255,42,0.18)] hover:bg-(--c-accent-hover) hover:shadow-[0_10px_30px_rgba(212,255,42,0.28)] active:scale-[0.98] disabled:cursor-progress",
              FOCUS,
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-[0.08em]">
              {p.submitting && <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2.6} />}
              Generate
            </span>
            {p.price !== null && (
              <span className="text-[11px] font-semibold tabular-nums opacity-70" aria-hidden>
                {p.priceIsMax ? "≤ " : ""}${p.price.toFixed(2)}
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Attached media thumbnails ─────────────────────────────────────────────────

export interface Attached {
  /** Stable key, handed back to onRemove. */
  key: string;
  item: MediaItem;
  label: string;
  /** Attached but not sent with the current settings (shown dimmed). */
  unusedReason?: string;
}

export function AttachmentList({ items, onRemove, onOpen }: {
  items: Attached[];
  onRemove: (key: string) => void;
  onOpen: () => void;
}) {
  return items.map((a) => (
    <span key={a.key} className={cn("contents", a.unusedReason && "[&>*]:opacity-40")} title={a.unusedReason}>
      <AttachmentThumb item={a.item} label={a.label} onRemove={() => onRemove(a.key)} onOpen={onOpen} />
    </span>
  ));
}

export function AttachmentThumb({ item, label, onRemove, onOpen }: {
  item: MediaItem;
  label: string;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="group/att relative size-12 shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label}${item.error ? " (upload failed)" : item.uploading ? " (uploading)" : ""} — open media`}
        className={cn("absolute inset-0 rounded-lg", FOCUS, "focus-visible:ring-offset-0")}
      >
        <Thumb item={item} />
      </button>
      <StatusOverlay item={item} compact />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/65 px-0.5 text-center text-[9px] font-bold uppercase leading-[14px] tracking-wide text-white/90">
        {label}
      </span>
      {!item.uploading && (
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={onRemove}
          className={cn(
            "absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full bg-black/80 text-white/90 opacity-0 transition-opacity hover:bg-black group-hover/att:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            FOCUS,
          )}
        >
          <X className="size-3" strokeWidth={2.6} />
        </button>
      )}
    </div>
  );
}

// ── Chips ─────────────────────────────────────────────────────────────────────

export interface ChipOption {
  value: string;
  label: string;
  /** Second line / right-aligned detail in the menu. */
  hint?: string;
  glyph?: ReactNode;
}

/** A chip that opens a menu of choices above the composer (arrow keys + typeahead). */
export function OptionChip({ icon, label, title, value, options, onChange, disabled }: {
  icon: ReactNode;
  /** Text on the chip. */
  label: string;
  /** Menu heading + accessible name, e.g. "Aspect ratio". */
  title: string;
  value: string;
  options: ChipOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger disabled={disabled} aria-label={`${title}: ${label}`} className={cn(CHIP, FOCUS)}>
        <span className="text-(--c-text-2)" aria-hidden>{icon}</span>
        <span>{label}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={10} collisionPadding={12} className={cn(styles.tokens, "z-[1200] outline-none")}>
          <Menu.Popup className={cn(POPUP, styles.scroll, "max-h-[min(380px,var(--available-height))] min-w-[184px] overflow-y-auto")}>
            <div className="px-2.5 pb-1.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--c-text-3)">{title}</div>
            <Menu.RadioGroup value={value} onValueChange={(v) => onChange(String(v))}>
              {options.map((o) => (
                <Menu.RadioItem key={o.value} value={o.value} label={o.label} closeOnClick className={MENU_ROW}>
                  {o.glyph && <span className="grid w-4 shrink-0 place-items-center" aria-hidden>{o.glyph}</span>}
                  <span className="flex-1 tabular-nums">{o.label}</span>
                  {o.hint && <span className="text-[11px] font-medium text-(--c-text-3)">{o.hint}</span>}
                  <span className="grid w-4 shrink-0 place-items-center">
                    <Menu.RadioItemIndicator>
                      <Check className="size-4 text-(--c-accent)" strokeWidth={2.4} />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** On / off chip (sound). */
export function ToggleChip({ icon, label, title, pressed, onChange }: {
  icon: ReactNode;
  label: string;
  title: string;
  pressed: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={title}
      onClick={() => onChange(!pressed)}
      className={cn(CHIP, FOCUS, pressed && "text-(--c-text)")}
    >
      <span className={pressed ? "text-(--c-accent)" : "text-(--c-text-3)"} aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Duration: a menu for fixed lengths, a slider popover for ranges, a static chip otherwise. */
export function DurationChip({ spec, value, onChange, fixedLabel }: {
  spec: DurationSpec;
  value: number;
  onChange: (n: number) => void;
  /** Shown when the model sets the length itself. */
  fixedLabel: string;
}) {
  const icon = <Clock className="size-3.5" strokeWidth={2.2} />;
  if (spec.kind === "none") {
    return (
      <span className={cn(CHIP, "cursor-default hover:bg-white/[0.06]")} title="Set by the model">
        <span className="text-(--c-text-3)" aria-hidden>{icon}</span>
        <span className="text-(--c-text-2)">{fixedLabel}</span>
      </span>
    );
  }
  if (spec.kind === "list") {
    return (
      <OptionChip
        icon={icon}
        label={`${value}s`}
        title="Duration"
        value={String(value)}
        options={spec.values.map((v) => ({ value: String(v), label: `${v} seconds` }))}
        onChange={(v) => onChange(Number(v))}
      />
    );
  }
  const pct = spec.max === spec.min ? 100 : ((value - spec.min) / (spec.max - spec.min)) * 100;
  const step = (d: number) => onChange(Math.max(spec.min, Math.min(spec.max, value + d)));
  const presets = [5, 10, 15, 20, 30].filter((v) => v >= spec.min && v <= spec.max);
  return (
    <Popover.Root modal={false}>
      <Popover.Trigger aria-label={`Duration: ${value} seconds`} className={cn(CHIP, FOCUS)}>
        <span className="text-(--c-text-2)" aria-hidden>{icon}</span>
        <span>{value}s</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={10} collisionPadding={12} className={cn(styles.tokens, "z-[1200] outline-none")}>
          <Popover.Popup className={cn(POPUP, "w-[280px] p-3")}>
            <div className="mb-3 flex items-baseline justify-between">
              <Popover.Title className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--c-text-3)">Duration</Popover.Title>
              <span className="text-[11px] tabular-nums text-(--c-text-3)">{spec.min}–{spec.max}s</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={1}
                value={value}
                aria-label="Duration in seconds"
                aria-valuetext={`${value} seconds`}
                onChange={(e) => onChange(Number(e.target.value))}
                className={styles.range}
                style={{ ["--fill" as string]: `${pct}%` } as React.CSSProperties}
              />
              <div className="flex h-8 shrink-0 items-center rounded-lg bg-white/[0.06]">
                <button
                  type="button"
                  aria-label="Shorter"
                  disabled={value <= spec.min}
                  onClick={() => step(-1)}
                  className={cn("grid h-full w-7 place-items-center rounded-l-lg text-(--c-text-2) transition-colors hover:text-(--c-text) disabled:opacity-35", FOCUS)}
                >
                  <Minus className="size-3.5" strokeWidth={2} />
                </button>
                <span className="w-8 text-center text-[12.5px] font-semibold tabular-nums text-(--c-text)" aria-hidden>{value}s</span>
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
            {presets.length > 1 && (
              <div className="mt-3 flex gap-1.5">
                {presets.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={v === value}
                    onClick={() => onChange(v)}
                    className={cn(
                      "h-7 flex-1 rounded-md text-[12px] font-semibold tabular-nums transition-colors",
                      v === value ? "bg-(--c-accent) text-(--c-accent-ink)" : "bg-white/[0.06] text-(--c-text-2) hover:bg-white/[0.1] hover:text-(--c-text)",
                      FOCUS,
                    )}
                  >
                    {v}s
                  </button>
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Small glyphs ──────────────────────────────────────────────────────────────

export function RatioGlyph({ ratio }: { ratio: string }) {
  const r = parseRatio(ratio);
  if (!r) return <span aria-hidden className="inline-block size-3 rounded-[2px] border border-dashed border-current opacity-80" />;
  const max = 13;
  const w = r >= 1 ? max : Math.max(4, Math.round(max * r));
  const h = r >= 1 ? Math.max(4, Math.round(max / r)) : max;
  return <span aria-hidden className="inline-block rounded-[2px] border-[1.5px] border-current opacity-90" style={{ width: w, height: h }} />;
}

export function prettyRatio(r: string): string {
  if (r.toLowerCase() === "adaptive") return "Adaptive";
  if (r.toLowerCase() === "auto") return "Auto";
  return r;
}
