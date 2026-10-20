"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — generations feed above the composer: in-flight jobs first
// (shimmer + timer), failed jobs with the server's message, then finished
// results (newest first). Videos or pictures; cards keep the result's aspect
// ratio on a shared row height. Plus the big empty-state headline.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Download, KeyRound, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { thumbSrc, type GalleryItem } from "@/lib/galleryUtils";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { getRevanaImageModel } from "@/lib/revanaModels";
import styles from "./create.module.css";
import { type CreateJob, type CreateKind, type JobSettings, formatElapsed, isKeyError, parseRatio } from "./shared";
import { FOCUS } from "./ui";

export type FeedEntry =
  | { kind: "job"; key: string; job: CreateJob; /** Set on finished jobs: the result this card shows. */ url?: string }
  | { kind: "item"; key: string; item: GalleryItem; url: string; meta?: JobSettings };

/** URL of a finished entry, or null while pending / failed. */
export function entryUrl(e: FeedEntry): string | null {
  if (e.kind === "item") return e.url;
  return e.job.status === "done" && e.url ? e.url : null;
}

export function modelName(id: string | undefined, fallback = "Generation"): string {
  if (!id) return fallback;
  return VIDEO_MODELS.find((m) => m.id === id)?.name
    ?? getRevanaImageModel(id)?.name
    ?? IMAGE_MODELS.find((m) => m.id === id)?.name
    ?? id;
}

function settingsRatio(s: Partial<JobSettings> | undefined): number | undefined {
  return parseRatio(s?.aspectRatio) ?? s?.ratioHint;
}

function chipText(model: string | undefined, s?: Partial<JobSettings>): string {
  const parts = [modelName(model)];
  if (s?.duration && s.duration > 0) parts.push(`${s.duration}s`);
  if (s?.resolution) parts.push(s.resolution);
  return parts.join(" · ");
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyHero({ title, subline, error, onRetry }: {
  title: string;
  subline: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-4 text-center">
      <h1 className={cn(styles.display, "text-balance text-(--c-text)")}>{title}</h1>
      <p className="mt-4 max-w-[64ch] text-balance text-[15px] leading-relaxed text-(--c-text-3)">{subline}</p>
      {error && (
        <button type="button" onClick={onRetry} className={cn("mt-5 rounded-md text-[13px] font-semibold text-(--c-accent) underline-offset-2 hover:underline", FOCUS)}>
          {error} · Try again
        </button>
      )}
    </div>
  );
}

// ── Pending ───────────────────────────────────────────────────────────────────

function Elapsed({ since }: { since: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = new Date(since).getTime();
    const tick = () => { if (ref.current) ref.current.textContent = formatElapsed(Date.now() - start); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since]);
  return <span ref={ref} className="tabular-nums">0:00</span>;
}

function PendingCard({ job, media }: { job: CreateJob; media: CreateKind }) {
  const s = job.settings;
  const ratio = settingsRatio(s) ?? (media === "image" ? 3 / 4 : 16 / 9);
  const backdrop = s.startFrameUrl ?? s.referenceImageUrls[0];
  return (
    <div className={cn(styles.card, "min-w-[180px] bg-(--c-raise)")} style={{ aspectRatio: ratio }} role="group" aria-busy="true" aria-label={`Generating with ${modelName(s.model)}`}>
      {backdrop && (
        // eslint-disable-next-line @next/next/no-img-element -- local /generated input frame, blurred backdrop
        <img src={backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl" />
      )}
      <div className={styles.shimmer} />
      <div className={styles.pendingGlow} />
      <div className="relative flex h-full flex-col justify-between p-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-(--c-text)">
          <LoaderCircle className="size-3.5 animate-spin text-(--c-accent)" strokeWidth={2.4} />
          <span>{job.status === "submitting" ? "Sending" : "Generating"}</span>
          <span className="text-(--c-text-3)">·</span>
          <Elapsed since={job.createdAt} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-(--c-text-2)">
            {chipText(s.model, s)}{s.provider === "revana" ? " · Revana" : ""}
          </div>
          {s.prompt && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-(--c-text-3)">{s.prompt}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Failed ────────────────────────────────────────────────────────────────────

function ErrorCard({ job, media, onDismiss, onReuse, onOpenSettings }: {
  job: CreateJob;
  media: CreateKind;
  onDismiss: () => void;
  onReuse: () => void;
  onOpenSettings: () => void;
}) {
  const s = job.settings;
  const ratio = settingsRatio(s) ?? (media === "image" ? 3 / 4 : 16 / 9);
  const keyProblem = isKeyError(job.error);
  return (
    <div
      className={cn(styles.card, "flex min-w-[260px] flex-col border border-(--c-danger)/25 bg-(--c-danger-soft)")}
      style={{ aspectRatio: ratio }}
      role="group"
      aria-label="Generation failed"
    >
      <div className="flex items-start gap-2 p-3 pb-0">
        <TriangleAlert className="mt-px size-4 shrink-0 text-(--c-danger)" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-(--c-text)">Generation failed</div>
          <div className="truncate text-[11.5px] text-(--c-text-3)">{chipText(s.model, s)}</div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={cn("-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-md text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)", FOCUS)}
        >
          <X className="size-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <p className={cn(styles.scroll, "mx-3 mt-2 min-h-0 flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-snug text-(--c-danger)")}>
        {job.error || "The server didn't say why."}
      </p>
      <div className="flex flex-wrap gap-1.5 p-3">
        {keyProblem && (
          <button
            type="button"
            onClick={onOpenSettings}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-md bg-(--c-accent) px-2.5 text-[12px] font-bold text-(--c-accent-ink) transition-colors hover:bg-(--c-accent-hover)", FOCUS)}
          >
            <KeyRound className="size-3.5" strokeWidth={2.2} />
            Open API keys
          </button>
        )}
        <button
          type="button"
          onClick={onReuse}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border border-(--c-line-2) px-2.5 text-[12px] font-medium text-(--c-text-2) transition-colors hover:border-white/25 hover:text-(--c-text)", FOCUS)}
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Reuse settings
        </button>
      </div>
    </div>
  );
}

// ── Finished ──────────────────────────────────────────────────────────────────

function ResultCard({ media, url, model, settings, prompt, ratio, onRatio, onOpen, onReuse, onDownload }: {
  media: CreateKind;
  url: string;
  model?: string;
  settings?: Partial<JobSettings>;
  prompt?: string;
  ratio: number;
  onRatio: (url: string, w: number, h: number) => void;
  onOpen: () => void;
  onReuse: () => void;
  onDownload: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = media === "video";

  // Only attach the source once the card is near the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setInView(true);
      else videoRef.current?.pause();
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const play = () => { if (isVideo) void videoRef.current?.play().catch(() => {}); };
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try { v.currentTime = 0.1; } catch { /* not seekable yet */ }
  };

  return (
    <div
      ref={wrapRef}
      className={cn(styles.card, "group/card min-w-[120px]")}
      style={{ aspectRatio: ratio }}
      onMouseEnter={play}
      onMouseLeave={stop}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/uri-list", new URL(url, window.location.href).href);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {!loaded && !failed && <div className={cn(styles.skeleton, "absolute inset-0")} />}
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-[12px] text-(--c-text-3)">
          {isVideo ? "This clip can't be played." : "This picture can't be shown."} The file may have been moved or deleted.
        </div>
      )}
      {isVideo ? (
        <video
          ref={videoRef}
          src={inView ? `${url}#t=0.1` : undefined}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setLoaded(true);
            if (v.videoWidth && v.videoHeight) onRatio(url, v.videoWidth, v.videoHeight);
          }}
          onError={() => setFailed(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : inView ? (
        // eslint-disable-next-line @next/next/no-img-element -- local /generated result through the image optimiser
        <img
          src={thumbSrc(url, 360)}
          alt={prompt ? prompt.slice(0, 120) : "Generated picture"}
          draggable={false}
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            setLoaded(true);
            if (img.naturalWidth && img.naturalHeight) onRatio(url, img.naturalWidth, img.naturalHeight);
          }}
          onError={() => setFailed(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        onFocus={play}
        onBlur={stop}
        aria-label={`Open ${isVideo ? "video" : "picture"}${prompt ? `: ${prompt.slice(0, 80)}` : ""}`}
        className={cn("absolute inset-0 z-[1] cursor-zoom-in rounded-[12px]", FOCUS, "focus-visible:ring-offset-0")}
      />
      <div className={cn(styles.cardInfo, "pointer-events-none absolute inset-0 z-[2] flex flex-col justify-between")}>
        <div className="flex items-start justify-between gap-2 bg-linear-to-b from-black/55 to-transparent p-2 pb-6">
          <span className="truncate rounded-md bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            {chipText(model, settings)}
          </span>
          <span className="pointer-events-auto flex shrink-0 gap-1">
            <button
              type="button"
              aria-label="Reuse settings"
              title="Reuse settings"
              onClick={onReuse}
              className={cn("grid size-7 place-items-center rounded-md bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white", FOCUS)}
            >
              <RotateCcw className="size-3.5" strokeWidth={2.1} />
            </button>
            <button
              type="button"
              aria-label="Download"
              title="Download"
              onClick={onDownload}
              className={cn("grid size-7 place-items-center rounded-md bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white", FOCUS)}
            >
              <Download className="size-3.5" strokeWidth={2.1} />
            </button>
          </span>
        </div>
        {prompt && (
          <p className="line-clamp-2 bg-linear-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 text-[12px] leading-snug text-white/90">
            {prompt}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export function HistoryFeed({
  media,
  entries,
  ratios,
  loading,
  loadingMore,
  hasMore,
  error,
  onLoadMore,
  onRetry,
  onRatio,
  onOpen,
  onReuse,
  onDownload,
  onDismiss,
  onOpenSettings,
}: {
  media: CreateKind;
  entries: FeedEntry[];
  ratios: Record<string, number>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onRatio: (url: string, w: number, h: number) => void;
  onOpen: (key: string) => void;
  onReuse: (entry: FeedEntry) => void;
  onDownload: (url: string) => void;
  onDismiss: (jobId: string) => void;
  onOpenSettings: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  useEffect(() => { loadMoreRef.current = onLoadMore; }, [onLoadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMoreRef.current();
    }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, entries.length]);

  const fallbackRatio = media === "image" ? 3 / 4 : 16 / 9;

  if (loading && entries.length === 0) {
    const shapes = media === "image" ? [3 / 4, 1, 3 / 4, 4 / 3, 3 / 4, 1] : [16 / 9, 9 / 16, 16 / 9, 1, 9 / 16, 16 / 9];
    return (
      <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading history">
        {shapes.map((r, i) => (
          <div key={i} className={cn(styles.card, styles.skeleton)} style={{ aspectRatio: r, animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <h2 className="sr-only">Your {media === "image" ? "pictures" : "videos"}</h2>
      <div className="flex flex-wrap content-start gap-2">
        {entries.map((e) => {
          if (e.kind === "job") {
            const job = e.job;
            if (job.status === "error") {
              return (
                <ErrorCard
                  key={e.key}
                  job={job}
                  media={media}
                  onDismiss={() => onDismiss(job.id)}
                  onReuse={() => onReuse(e)}
                  onOpenSettings={onOpenSettings}
                />
              );
            }
            if (job.status !== "done" || !e.url) return <PendingCard key={e.key} job={job} media={media} />;
            const url = e.url;
            return (
              <ResultCard
                key={e.key}
                media={media}
                url={url}
                model={job.settings.model}
                settings={job.settings}
                prompt={job.settings.prompt}
                ratio={ratios[url] ?? settingsRatio(job.settings) ?? fallbackRatio}
                onRatio={onRatio}
                onOpen={() => onOpen(e.key)}
                onReuse={() => onReuse(e)}
                onDownload={() => onDownload(url)}
              />
            );
          }
          const { item, meta, url } = e;
          return (
            <ResultCard
              key={e.key}
              media={media}
              url={url}
              model={item.model}
              settings={meta ?? { aspectRatio: item.aspect_ratio, resolution: item.quality?.toUpperCase() }}
              prompt={item.prompt}
              ratio={ratios[url] ?? settingsRatio(meta) ?? parseRatio(item.aspect_ratio) ?? fallbackRatio}
              onRatio={onRatio}
              onOpen={() => onOpen(e.key)}
              onReuse={() => onReuse(e)}
              onDownload={() => onDownload(url)}
            />
          );
        })}
      </div>
      <div ref={sentinelRef} className="flex h-16 items-center justify-center text-[12px] text-(--c-text-3)">
        {loadingMore ? (
          <LoaderCircle className="size-4 animate-spin" strokeWidth={2.2} aria-label="Loading more" />
        ) : error ? (
          <button type="button" onClick={onRetry} className={cn("rounded-md font-semibold text-(--c-accent) underline-offset-2 hover:underline", FOCUS)}>
            {error} · Try again
          </button>
        ) : !hasMore && entries.length > 8 ? (
          "That's everything."
        ) : null}
      </div>
    </>
  );
}
