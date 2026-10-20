"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — result viewer: the clip large, its prompt and settings beside
// it, plus Download / Reuse settings / Delete. ← / → step through results.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Check, ChevronLeft, ChevronRight, Copy, Download, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";
import { modelName } from "./HistoryFeed";
import { isVideoUrl, type JobSettings } from "./shared";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#2DD4BF]/75 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1118]";

export interface ViewerData {
  key: string;
  url: string;
  model?: string;
  prompt?: string;
  settings?: Partial<JobSettings>;
  createdAt?: string;
  /** Inputs whose role is unknown (gallery rows made outside this page). */
  looseInputs?: string[];
  /** Present when the clip can be deleted (it has a gallery row). */
  deletable: boolean;
}

type DownloadState = "idle" | "busy" | "done" | "error";

function prettyRatio(r: string | undefined): string | undefined {
  if (!r) return undefined;
  if (r.toLowerCase() === "adaptive") return "Adaptive";
  if (r.toLowerCase() === "auto") return "Auto";
  return r;
}

function InputThumb({ url, label, video }: { url: string; label: string; video?: boolean }) {
  return (
    <figure className="w-16 shrink-0">
      <div className="size-16 overflow-hidden rounded-lg border border-(--c-line) bg-(--c-input)">
        {video ? (
          <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- local /generated input
          <img src={url} alt={label} className="h-full w-full object-cover" />
        )}
      </div>
      <figcaption className="mt-1 truncate text-[10.5px] text-(--c-text-3)">{label}</figcaption>
    </figure>
  );
}

function ViewerBody({ data, hasPrev, hasNext, onPrev, onNext, onDownload, onReuse, onDelete }: {
  data: ViewerData;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onDownload: (url: string) => Promise<boolean>;
  onReuse: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const s = data.settings;
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [download, setDownload] = useState<DownloadState>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const rows: [string, string | undefined][] = [
    ["Model", modelName(data.model)],
    ["Provider", s?.provider ? (s.provider === "revana" ? "Revana" : "Kie.ai") : undefined],
    ["Duration", s?.duration && s.duration > 0 ? `${s.duration} s` : undefined],
    ["Resolution", s?.resolution || undefined],
    ["Aspect ratio", prettyRatio(s?.aspectRatio)],
    ["Sound", s?.sound === undefined ? undefined : s.sound ? "On" : "Off"],
    ["Created", data.createdAt ? new Date(data.createdAt).toLocaleString() : undefined],
  ];

  const inputs: { url: string; label: string; video?: boolean }[] = [
    ...(s?.startFrameUrl ? [{ url: s.startFrameUrl, label: "Start frame" }] : []),
    ...(s?.endFrameUrl ? [{ url: s.endFrameUrl, label: "End frame" }] : []),
    ...(s?.videoUrl ? [{ url: s.videoUrl, label: "Input video", video: true }] : []),
    ...(s?.referenceImageUrls ?? []).map((url, i) => ({ url, label: `Reference ${i + 1}` })),
    ...(data.looseInputs ?? []).map((url, i) => ({ url, label: `Input ${i + 1}`, video: isVideoUrl(url) })),
  ];

  const navBtn = "absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white disabled:pointer-events-none disabled:opacity-0";

  return (
    <>
      <div className="relative flex min-h-[38vh] flex-1 items-center justify-center bg-black md:min-h-0">
        <video
          key={data.url}
          src={data.url}
          controls
          autoPlay
          loop
          playsInline
          className="max-h-full max-w-full"
        />
        <button type="button" aria-label="Previous video" disabled={!hasPrev} onClick={onPrev} className={cn(navBtn, "left-3", FOCUS)}>
          <ChevronLeft className="size-5" strokeWidth={2} />
        </button>
        <button type="button" aria-label="Next video" disabled={!hasNext} onClick={onNext} className={cn(navBtn, "right-3", FOCUS)}>
          <ChevronRight className="size-5" strokeWidth={2} />
        </button>
      </div>

      <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-(--c-line) bg-(--c-panel) md:max-h-none md:w-[340px] md:border-l">
        <div className="flex items-center gap-2 border-b border-(--c-line) px-4 py-3">
          <Dialog.Title className="min-w-0 flex-1 truncate text-[14px] font-semibold text-(--c-text)">
            {modelName(data.model)}
          </Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            className={cn("grid size-8 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)", FOCUS)}
          >
            <X className="size-4" strokeWidth={2.2} />
          </Dialog.Close>
        </div>

        <div className={cn(styles.scroll, "min-h-0 flex-1 overflow-y-auto px-4 py-4")}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-medium text-(--c-text-2)">Prompt</span>
            {data.prompt && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(data.prompt ?? "").then(() => {
                    setCopied(true);
                    later(() => setCopied(false), 1500);
                  }).catch(() => {});
                }}
                className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)", FOCUS)}
              >
                {copied ? <Check className="size-3.5 text-[#2DD4BF]" strokeWidth={2.4} /> : <Copy className="size-3.5" strokeWidth={2} />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <Dialog.Description
            render={<p />}
            className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-(--c-text)"
          >
            {data.prompt || <span className="text-(--c-text-3)">No prompt.</span>}
          </Dialog.Description>

          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-(--c-text-3)">{k}</dt>
                <dd className="min-w-0 truncate text-right tabular-nums text-(--c-text-2)">{v}</dd>
              </div>
            ))}
          </dl>

          {inputs.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[12px] font-medium text-(--c-text-2)">Inputs</div>
              <div className="flex flex-wrap gap-2">
                {inputs.map((i) => <InputThumb key={`${i.label}-${i.url}`} {...i} />)}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-(--c-line) p-4">
          <button
            type="button"
            disabled={download === "busy"}
            onClick={async () => {
              setDownload("busy");
              const ok = await onDownload(data.url);
              setDownload(ok ? "done" : "error");
              later(() => setDownload("idle"), 2200);
            }}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-[10px] bg-white text-[13px] font-semibold text-[#0b0e14] transition-colors hover:bg-white/90 disabled:cursor-progress",
              FOCUS,
            )}
          >
            {download === "busy" ? <LoaderCircle className="size-4 animate-spin" strokeWidth={2.4} />
              : download === "done" ? <Check className="size-4" strokeWidth={2.4} />
              : <Download className="size-4" strokeWidth={2.2} />}
            {download === "busy" ? "Preparing…" : download === "done" ? "Saved" : download === "error" ? "Download failed — retry" : "Download"}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onReuse}
              className={cn("flex h-10 items-center justify-center gap-2 rounded-[10px] border border-(--c-line-2) text-[13px] font-medium text-(--c-text) transition-colors hover:border-white/25 hover:bg-white/[0.04]", FOCUS)}
            >
              <RotateCcw className="size-4" strokeWidth={2} />
              Reuse settings
            </button>
            <button
              type="button"
              disabled={!data.deletable || deleting}
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  later(() => setConfirmDelete(false), 3500);
                  return;
                }
                setDeleting(true);
                const ok = await onDelete();
                if (!ok) {
                  setDeleting(false);
                  setConfirmDelete(false);
                  setDeleteFailed(true);
                  later(() => setDeleteFailed(false), 2500);
                }
              }}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-[10px] border text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                confirmDelete
                  ? "border-(--c-danger)/60 bg-(--c-danger)/15 text-(--c-danger)"
                  : "border-(--c-line-2) text-(--c-text-2) hover:border-(--c-danger)/45 hover:text-(--c-danger)",
                FOCUS,
              )}
            >
              {deleting ? <LoaderCircle className="size-4 animate-spin" strokeWidth={2.4} /> : <Trash2 className="size-4" strokeWidth={2} />}
              {deleteFailed ? "Couldn't delete" : confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          </div>
          {!data.deletable && (
            <p className="text-[11px] leading-snug text-(--c-text-3)">Delete is available once the clip shows up in your library.</p>
          )}
        </div>
      </aside>
    </>
  );
}

export function ResultViewer({
  open,
  data,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onClosed,
  onDownload,
  onReuse,
  onDelete,
}: {
  open: boolean;
  data: ViewerData | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** After the close animation — safe to drop `data`. */
  onClosed: () => void;
  onDownload: (url: string) => Promise<boolean>;
  onReuse: () => void;
  onDelete: () => Promise<boolean>;
}) {
  // Focus the popup itself on open so ← / → step through results right away
  // (the first tabbable element would be the <video>, which eats arrow keys).
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open={open && !!data}
      onOpenChange={(next) => { if (!next) onClose(); }}
      onOpenChangeComplete={(next) => { if (!next) onClosed(); }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-[6px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={popupRef}
          tabIndex={-1}
          onKeyDown={(e) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "VIDEO" || tag === "INPUT" || tag === "TEXTAREA") return;
            if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
            if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
          }}
          className={cn(
            styles.tokens,
            "fixed inset-2 z-[1001] flex flex-col overflow-hidden rounded-2xl border border-(--c-line-2) bg-(--c-panel) shadow-[0_30px_90px_rgba(0,0,0,0.75)] outline-none transition-[opacity,scale] duration-200 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 md:inset-6 md:flex-row",
          )}
        >
          {data && (
            <ViewerBody
              key={data.key}
              data={data}
              hasPrev={hasPrev}
              hasNext={hasNext}
              onPrev={onPrev}
              onNext={onNext}
              onDownload={onDownload}
              onReuse={onReuse}
              onDelete={onDelete}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
