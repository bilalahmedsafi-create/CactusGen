"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — media inputs: start / end frame, reference strip, input video.
// Shown in the composer's "+" popover. Every slot takes a click (file chooser),
// a drop (files, or a /generated URL dragged from the page) and a paste while
// focused (handled by the studio through the data-slot attribute).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from "react";
import { AudioLines, Film, ImagePlus, Images, LoaderCircle, Plus, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAudioUrl, isVideoUrl, type MediaItem, type SlotTarget } from "./shared";
import { FOCUS } from "./ui";

type MediaKind = MediaItem["kind"];

/** Drag type for reordering tiles inside a reference strip (never a file drop). */
const REF_MIME = "application/x-cactusgen-ref";

const isRefDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(REF_MIME);

const urlKind = (url: string): MediaKind => (isVideoUrl(url) ? "video" : isAudioUrl(url) ? "audio" : "image");

/** Files of the wanted kind from a drop. */
function droppedFiles(e: React.DragEvent, kind: MediaKind): File[] {
  return Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith(`${kind}/`));
}

/** A local media URL dragged from elsewhere on the page (history card, slot thumbnail). */
function droppedLocalUrl(e: React.DragEvent): string | null {
  const raw = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split("\n")[0].trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.href);
    if (u.origin === window.location.origin && u.pathname.startsWith("/generated/")) return u.pathname;
  } catch { /* not a URL */ }
  return null;
}

function useDropZone(kind: MediaKind, enabled: boolean, onFiles: (f: File[]) => void, onUrl: (u: string) => void) {
  const [over, setOver] = useState(false);
  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!enabled || isRefDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (!over) setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!enabled || isRefDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const files = droppedFiles(e, kind);
      if (files.length) return onFiles(files);
      const url = droppedLocalUrl(e);
      if (url && urlKind(url) === kind) onUrl(url);
    },
  };
  return { over, handlers };
}

export function Thumb({ item, onRatio, className }: { item: MediaItem; onRatio?: (r: number) => void; className?: string }) {
  if (item.kind === "audio") {
    return (
      <span className={cn("grid h-full w-full place-items-center bg-[#d4ff2a]/[0.08] text-[#d4ff2a]", className)} aria-hidden>
        <AudioLines className="size-5" strokeWidth={1.8} />
      </span>
    );
  }
  if (item.kind === "video") {
    return (
      <video
        src={item.preview.startsWith("blob:") ? item.preview : `${item.preview}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) onRatio?.(v.videoWidth / v.videoHeight);
        }}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local /generated and blob: previews
    <img
      src={item.preview}
      alt=""
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth && img.naturalHeight) onRatio?.(img.naturalWidth / img.naturalHeight);
      }}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

export function StatusOverlay({ item, compact }: { item: MediaItem; compact?: boolean }) {
  if (item.uploading) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-black/55" aria-label="Uploading">
        <LoaderCircle className={cn("animate-spin text-[#d4ff2a]", compact ? "size-4" : "size-5")} strokeWidth={2.2} />
      </div>
    );
  }
  if (item.error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 px-2 text-center" title={item.error}>
        <TriangleAlert className="size-4 text-(--c-danger)" strokeWidth={2} />
        {!compact && <span className="line-clamp-2 text-[11px] leading-tight text-(--c-danger)">{item.error}</span>}
      </div>
    );
  }
  return null;
}

function RemoveButton({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute right-1.5 top-1.5 z-10 grid place-items-center rounded-full border border-white/15 bg-black/70 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/90 hover:text-white",
        small ? "size-5" : "size-6",
        FOCUS,
      )}
    >
      <X className={small ? "size-3" : "size-3.5"} strokeWidth={2.5} />
    </button>
  );
}

// ── Single slot (start frame / end frame / input video) ────────────────────────

export function SingleSlot({
  slot,
  label,
  item,
  accept,
  disabled,
  lockedReason,
  required,
  onFiles,
  onUrl,
  onRemove,
  onLibrary,
  onRatio,
  className,
}: {
  slot: Exclude<SlotTarget, "refs">;
  label: string;
  item: MediaItem | null;
  accept: "image" | "video";
  disabled?: boolean;
  lockedReason?: string;
  required?: boolean;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
  onRemove: () => void;
  onLibrary: () => void;
  onRatio: (ratio: number) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { over, handlers } = useDropZone(accept, !disabled, onFiles, onUrl);
  const Icon = accept === "video" ? Film : ImagePlus;

  return (
    <div className={cn("group/slot relative min-w-0", className)} {...handlers}>
      <button
        type="button"
        data-slot={slot}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={item ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
        className={cn(
          "relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden rounded-[10px] text-center transition-[border-color,background-color,box-shadow] duration-150",
          item
            ? "border border-(--c-line) bg-(--c-input)"
            : "border border-dashed border-white/[0.16] bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]",
          over && "border-solid border-[#d4ff2a] bg-[#d4ff2a]/[0.07] shadow-[0_0_0_3px_rgba(212,255,42,0.18)]",
          disabled && "cursor-not-allowed opacity-45 hover:border-white/[0.16] hover:bg-white/[0.02]",
          FOCUS,
        )}
      >
        {item ? (
          <>
            <Thumb item={item} onRatio={onRatio} />
            <StatusOverlay item={item} />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-left text-[11px] font-medium text-white/90">
              {label}
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-3">
            <Icon className={cn("size-5 transition-colors", over ? "text-[#d4ff2a]" : "text-(--c-text-3) group-hover/slot:text-(--c-text-2)")} strokeWidth={1.6} />
            <span className="text-[13px] font-medium text-(--c-text)">
              {label}
              {required && <span className="ml-1 text-[#d4ff2a]" aria-label="required">*</span>}
            </span>
            <span className="text-[11px] leading-snug text-(--c-text-3)">
              {disabled && lockedReason ? lockedReason : "Drop, paste or click"}
            </span>
          </span>
        )}
      </button>

      {item && !item.uploading && <RemoveButton label={`Remove ${label.toLowerCase()}`} onClick={onRemove} />}

      {!item && !disabled && (
        <button
          type="button"
          onClick={onLibrary}
          aria-label={`Pick ${label.toLowerCase()} from your library`}
          className={cn(
            "absolute bottom-1.5 right-1.5 grid size-6 place-items-center rounded-md text-(--c-text-3) transition-colors hover:bg-white/[0.08] hover:text-(--c-text)",
            FOCUS,
          )}
        >
          <Images className="size-3.5" strokeWidth={1.8} />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={`${accept}/*`}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

// ── Reference strip ───────────────────────────────────────────────────────────
// Images, clips or sounds the model keeps consistent. Each tile shows the tag
// the prompt can mention it by (image1, video2 …); tiles drag to reorder (or
// Alt + ←/→ when focused) and the prompt's @tags follow the files.

const KIND_NOUN: Record<MediaKind, string> = { image: "image", video: "video", audio: "sound" };

export function RefsStrip({
  items,
  max,
  locked,
  lockedReason,
  required,
  onFiles,
  onUrl,
  onRemove,
  onLibrary,
  onReorder,
  kind = "image",
  tagPrefix,
  slot = "refs",
  label = "References",
  emptyHint = "Characters, products or styles to keep consistent.",
}: {
  label?: string;
  emptyHint?: string;
  items: MediaItem[];
  max: number;
  locked: boolean;
  lockedReason: string;
  required?: boolean;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
  onRemove: (id: string) => void;
  /** Library picker; omitted for sounds (the library holds pictures and clips). */
  onLibrary?: () => void;
  /** Move `fromId` to where `toId` is. */
  onReorder?: (fromId: string, toId: string) => void;
  kind?: MediaKind;
  /** Mention tag stem shown on each tile ("image" → image1, image2 …). */
  tagPrefix?: string;
  /** data-slot of the add button (paste target + library "upload" shortcut). */
  slot?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const room = Math.max(0, max - items.length);
  const { over, handlers } = useDropZone(kind, !locked && room > 0, onFiles, onUrl);
  const overflow = items.length > max;
  const noun = KIND_NOUN[kind];
  const canReorder = !!onReorder && items.length > 1;

  const move = (id: string, delta: number) => {
    const i = items.findIndex((x) => x.id === id);
    const target = items[i + delta];
    if (i >= 0 && target && onReorder) onReorder(id, target.id);
  };

  return (
    <div {...handlers} className={cn("rounded-[10px] transition-opacity", locked && "opacity-45")}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-(--c-text-2)">
          {label}
          {required && <span className="ml-1 text-[#d4ff2a]" aria-label="required">*</span>}
        </span>
        <span className="flex items-center gap-1">
          <span className={cn("text-[11px] tabular-nums", overflow ? "text-(--c-danger)" : "text-(--c-text-3)")}>
            {items.length} / {max}
          </span>
          {!locked && room > 0 && onLibrary && (
            <button
              type="button"
              onClick={onLibrary}
              aria-label={`Pick ${label.toLowerCase()} from your library`}
              className={cn("grid size-6 place-items-center rounded-md text-(--c-text-3) transition-colors hover:bg-white/[0.08] hover:text-(--c-text)", FOCUS)}
            >
              <Images className="size-3.5" strokeWidth={1.8} />
            </button>
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="list" aria-label={label}>
        {items.map((item, i) => {
          const tag = tagPrefix ? `${tagPrefix}${i + 1}` : null;
          const draggable = canReorder && !item.uploading;
          return (
            <div
              key={item.id}
              role="listitem"
              tabIndex={canReorder ? 0 : undefined}
              aria-label={`${tag ?? `${noun} ${i + 1}`}${canReorder ? " — Alt + arrow keys to move" : ""}`}
              title={canReorder ? "Drag to reorder (Alt + ←/→)" : undefined}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable) return;
                e.dataTransfer.setData(REF_MIME, item.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(item.id);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => {
                if (!isRefDrag(e) || !dragId) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (overId !== item.id) setOverId(item.id);
              }}
              onDragLeave={() => { if (overId === item.id) setOverId(null); }}
              onDrop={(e) => {
                if (!isRefDrag(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const from = e.dataTransfer.getData(REF_MIME);
                setDragId(null);
                setOverId(null);
                if (from && from !== item.id) onReorder?.(from, item.id);
              }}
              onKeyDown={(e) => {
                if (!canReorder || !e.altKey) return;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  move(item.id, e.key === "ArrowLeft" ? -1 : 1);
                }
              }}
              className={cn(
                "relative size-14 shrink-0 overflow-hidden rounded-lg border bg-(--c-input) transition-[opacity,box-shadow] duration-150",
                i >= max ? "border-(--c-danger)/60" : "border-(--c-line)",
                draggable && "cursor-grab active:cursor-grabbing",
                dragId === item.id && "opacity-40",
                overId === item.id && dragId !== item.id && "shadow-[0_0_0_2px_#d4ff2a]",
                FOCUS,
              )}
            >
              <Thumb item={item} />
              <StatusOverlay item={item} />
              {tag && (
                <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/75 px-1 text-[9.5px] font-semibold leading-[14px] text-white/95">
                  {tag}
                </span>
              )}
              {!item.uploading && <RemoveButton small label={`Remove ${tag ?? `${noun} ${i + 1}`}`} onClick={() => onRemove(item.id)} />}
            </div>
          );
        })}
        {room > 0 && (
          <button
            type="button"
            data-slot={slot}
            disabled={locked}
            onClick={() => inputRef.current?.click()}
            aria-label={`Add ${label.toLowerCase()}`}
            className={cn(
              "grid size-14 shrink-0 place-items-center rounded-lg border border-dashed border-white/[0.16] bg-white/[0.02] text-(--c-text-3) transition-[border-color,background-color,color] duration-150 hover:border-white/30 hover:text-(--c-text-2)",
              over && "border-solid border-[#d4ff2a] bg-[#d4ff2a]/[0.07] text-[#d4ff2a]",
              locked && "cursor-not-allowed hover:border-white/[0.16] hover:text-(--c-text-3)",
              FOCUS,
            )}
          >
            <Plus className="size-4" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-(--c-text-3)">
        {locked
          ? lockedReason
          : overflow
            ? `This model takes ${max}. Only the first ${max} are sent.`
            : items.length === 0
              ? emptyHint
              : null}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={`${kind}/*`}
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
