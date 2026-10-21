"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE (image) — the picture twin of CreateStudio: same top bar, feed
// and floating composer. Models are lib/revanaModels.ts REVANA_IMAGE_MODELS
// (GPT Image 2.5 Flare by default); each runs on Revana, or on Kie.ai when the
// user picks it. "+" holds the reference pictures (edit / combine). Submits to
// POST /api/generate and follows the job like a video job.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Gem, Scan, Server } from "lucide-react";
import { useWorkflowStore } from "@/lib/store";
import { MediaPickerModal } from "@/components/MediaPickerModal";
import { requestNotificationPermission } from "@/lib/browserNotify";
import { REVANA_IMAGE_MODELS, estimateRevanaImageCost } from "@/lib/revanaModels";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";
import { AttachmentList, Composer, OptionChip, RatioGlyph, prettyRatio, type Attached, type Blocker } from "./Composer";
import { EmptyHero, HistoryFeed, entryUrl, type FeedEntry } from "./HistoryFeed";
import {
  DEFAULT_IMAGE_MODEL_ID,
  effectiveImageProvider,
  getImageCaps,
  imageModelExists,
  imagePrice,
  type ImageCaps,
} from "./imageCaps";
import { RefsStrip } from "./MediaSlots";
import { ModelChip, type ModelRow } from "./ModelPopover";
import type { CreateProvider } from "./modelCaps";
import { ResultViewer, type ViewerData } from "./ResultViewer";
import { useCreateJobs, jobUrls } from "./useCreateJobs";
import { useHistory } from "./useHistory";
import { moveItem, remapMentions, type MentionTarget } from "./mentions";
import { usePromptCoach } from "./usePromptCoach";
import { FOCUS } from "./ui";
import {
  forgetMeta,
  loadImageDraft,
  loadImageForm,
  loadImageProviders,
  loadMeta,
  loadRatioCache,
  newId,
  parseRatio,
  rememberRatio,
  saveImageDraft,
  saveImageForm,
  saveImageProvider,
  uploadAsset,
  type CreateJob,
  type JobSettings,
  type MediaItem,
} from "./shared";

const FEATURED = ["gpt-image-2-5-flare", "gpt-image-2-5-sunburst", "nano-banana-pro", "gpt-image-2"];
const BADGES: Record<string, "TOP" | "NEW"> = {
  "gpt-image-2-5-flare": "NEW",
  "gpt-image-2-5-sunburst": "NEW",
  "nano-banana-pro": "TOP",
};

function mediaFromUrl(url: string | undefined | null): MediaItem | null {
  if (!url) return null;
  return { id: newId(), url, preview: url, kind: "image", uploading: false, error: null };
}

function byNewest(a: { at: string }, b: { at: string }) {
  return new Date(b.at).getTime() - new Date(a.at).getTime();
}

/** The model's resolution matching `want` (any case), else its default. */
function pickResolution(caps: ImageCaps, want: string | undefined): string {
  const hit = caps.resolutions.find((r) => r.toLowerCase() === (want ?? "").toLowerCase());
  return hit ?? (caps.resolutions.includes(caps.defaultResolution) ? caps.defaultResolution : caps.resolutions[0] ?? "");
}

function imageSpecs(caps: ImageCaps): string[] {
  const out: string[] = [];
  const top = caps.resolutions[caps.resolutions.length - 1];
  if (top) out.push(top);
  if (caps.maxRefs > 0) out.push("Edit");
  if (caps.maxRefs > 1) out.push(`${caps.maxRefs} refs`);
  const p = caps.provider === "revana" ? estimateRevanaImageCost(caps.id, caps.defaultResolution) : null;
  if (p !== null) out.push(`$${p.toFixed(2)}`);
  out.push(caps.provider === "revana" ? "Revana" : "Kie.ai");
  return out;
}

function fileExt(url: string): string {
  const m = /\.(png|jpe?g|webp|gif)(\?|#|$)/i.exec(url);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
}

export default function ImageStudio() {
  const debugMode = useWorkflowStore((s) => s.debugMode);
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const revanaKeySet = useWorkflowStore((s) => s.revanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const addToast = useWorkflowStore((s) => s.addToast);

  // ── Form state, restored from the last session ──────────────────────────────
  const [boot] = useState(() => {
    const saved = loadImageForm();
    const draft = loadImageDraft();
    return { saved, draft, model: imageModelExists(saved?.model) ? saved.model : DEFAULT_IMAGE_MODEL_ID };
  });

  const [model, setModel] = useState(boot.model);
  const [savedProviders, setSavedProviders] = useState(loadImageProviders);
  const providerFor = useCallback(
    (id: string) => effectiveImageProvider(id, savedProviders[id], { kie: kieKeySet, revana: revanaKeySet }),
    [savedProviders, kieKeySet, revanaKeySet],
  );
  const provider = providerFor(model);
  const caps = useMemo(() => getImageCaps(model, provider), [model, provider]);

  const [prompt, setPrompt] = useState(boot.draft?.prompt ?? "");
  const [resolution, setResolution] = useState(boot.saved?.resolution ?? "");
  const [aspectRatio, setAspectRatio] = useState(boot.saved?.aspectRatio ?? "");
  const [refs, setRefs] = useState<MediaItem[]>(() =>
    (boot.draft?.referenceImageUrls ?? []).flatMap((u) => mediaFromUrl(u) ?? []),
  );

  const [submitting, setSubmitting] = useState(false);
  const [promptFlash, setPromptFlash] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [ratios, setRatios] = useState(loadRatioCache);
  const [meta, setMeta] = useState(loadMeta);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLElement>(null);
  const blobUrls = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Values the request actually uses ────────────────────────────────────────
  const effResolution = pickResolution(caps, resolution);
  const effRatio = caps.ratios.includes(aspectRatio) ? aspectRatio : caps.defaultRatio;
  const sendRefs = refs.slice(0, caps.maxRefs);

  // ── Persistence ─────────────────────────────────────────────────────────────
  useEffect(() => {
    saveImageForm({ model, resolution: effResolution, aspectRatio: effRatio });
  }, [model, effResolution, effRatio]);

  const refsKey = refs.map((r) => r.url ?? "").join("|");
  useEffect(() => {
    const t = setTimeout(() => {
      saveImageDraft({ prompt, referenceImageUrls: refsKey ? refsKey.split("|").filter(Boolean) : [] });
    }, 300);
    return () => clearTimeout(t);
  }, [prompt, refsKey]);

  useEffect(() => {
    const sync = () => setSavedProviders(loadImageProviders());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    const blobs = blobUrls.current;
    const pending = timers.current;
    return () => {
      blobs.forEach((u) => URL.revokeObjectURL(u));
      blobs.clear();
      pending.forEach(clearTimeout);
    };
  }, []);

  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  // ── History + jobs ──────────────────────────────────────────────────────────
  const history = useHistory("image");
  const refreshHistory = history.refresh;
  const pruneRef = useRef<(urls: Set<string>) => void>(() => {});
  const handleJobDone = useCallback(async (job: CreateJob) => {
    setMeta(loadMeta());
    const urls = jobUrls(job);
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await refreshHistory();
      const known = new Set(fresh.flatMap((i) => [i.url, ...(i.imageUrls ?? [])]));
      pruneRef.current(known);
      if (!urls.length || urls.every((u) => known.has(u))) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, [refreshHistory]);
  const { jobs, submit, dismiss, pruneDone } = useCreateJobs({ kind: "image", debugMode, onJobDone: handleJobDone });
  useEffect(() => { pruneRef.current = pruneDone; }, [pruneDone]);

  const historyUrls = useMemo(
    () => new Set(history.items.flatMap((i) => [i.url, ...(i.imageUrls ?? [])])),
    [history.items],
  );
  const activeCount = jobs.filter((j) => j.status === "submitting" || j.status === "pending").length;

  const entries = useMemo<FeedEntry[]>(() => {
    // Every picture gets its own card, keyed by URL so a job card hands over to
    // its history row without remounting.
    const top: FeedEntry[] = [];
    const dated: (FeedEntry & { at: string })[] = [];
    const seenUrls = new Set<string>();
    for (const job of jobs) {
      if (job.status === "error") {
        dated.push({ kind: "job", key: `job:${job.id}`, job, at: job.createdAt });
        continue;
      }
      if (job.status !== "done") {
        top.push({ kind: "job", key: `job:${job.id}`, job });
        continue;
      }
      for (const url of jobUrls(job)) {
        if (historyUrls.has(url) || seenUrls.has(url)) continue;
        seenUrls.add(url);
        top.push({ kind: "job", key: `i:${url}`, job, url });
      }
    }
    for (const item of history.items) {
      const urls = item.imageUrls?.length ? item.imageUrls : [item.url];
      for (const url of urls) {
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        dated.push({ kind: "item", key: `i:${url}`, item, url, meta: meta[url], at: item.created_at });
      }
    }
    dated.sort(byNewest);
    return [...top, ...dated];
  }, [jobs, history.items, historyUrls, meta]);

  // ── Media (reference pictures) ──────────────────────────────────────────────
  const release = (item: MediaItem | null | undefined) => {
    if (item?.preview.startsWith("blob:")) {
      URL.revokeObjectURL(item.preview);
      blobUrls.current.delete(item.preview);
    }
  };

  const patchRef = (id: string, patch: Partial<MediaItem>) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addFiles = (files: File[]) => {
    const accepted = files.filter((f) => f.type.startsWith("image/"));
    if (!accepted.length) {
      addToast("Reference slots take image files.", "error");
      return;
    }
    const take = accepted.slice(0, Math.max(0, caps.maxRefs - refs.length));
    if (!take.length) {
      addToast(`${caps.name} takes up to ${caps.maxRefs} reference images.`, "info");
      return;
    }
    const items: MediaItem[] = take.map((file) => {
      const preview = URL.createObjectURL(file);
      blobUrls.current.add(preview);
      return { id: newId(), url: null, preview, kind: "image", uploading: true, error: null };
    });
    setRefs((prev) => [...prev, ...items]);
    items.forEach((item, i) => {
      uploadAsset(take[i])
        .then((url) => patchRef(item.id, { url, uploading: false }))
        .catch((e: unknown) => patchRef(item.id, { uploading: false, error: e instanceof Error ? e.message : "Upload failed" }));
    });
  };

  const addUrl = (url: string) => {
    const item = mediaFromUrl(url);
    if (!item) return;
    setRefs((prev) => (prev.some((r) => r.url === url) || prev.length >= caps.maxRefs ? prev : [...prev, item]));
  };

  /** The reference list changed order or lost items — keep @tags on the same pictures. */
  const followMentions = (prev: MediaItem[], next: MediaItem[]) => {
    const r = remapMentions(prompt, "image", prev.map((x) => x.id), next.map((x) => x.id));
    if (r.prompt !== prompt) setPrompt(r.prompt);
    if (r.removed.length) addToast(`Removed ${r.removed.join(", ")} from the prompt.`, "info");
  };

  const removeRef = (id: string) => {
    const next = refs.filter((r) => r.id !== id);
    release(refs.find((r) => r.id === id));
    setRefs(next);
    followMentions(refs, next);
  };

  const reorderRefs = (fromId: string, toId: string) => {
    const next = moveItem(refs, fromId, toId);
    if (next === refs) return;
    setRefs(next);
    followMentions(refs, next);
  };

  // What the prompt can mention: @image1 = refs[0] …, in the order they're sent.
  const mentionTargets: MentionTarget[] = refs.map((item, i) => {
    const note = caps.maxRefs === 0
      ? `${caps.name} takes no reference images`
      : i >= caps.maxRefs
        ? `Over this model's limit of ${caps.maxRefs}`
        : undefined;
    return { tag: `image${i + 1}`, kind: "image", item, sent: !note, note };
  });

  const handlePaste = useEffectEvent((e: ClipboardEvent) => {
    if (viewerOpen || picker) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // ── Model / provider ────────────────────────────────────────────────────────
  const changeProvider = (p: CreateProvider) => {
    saveImageProvider(model, p);
    setSavedProviders((prev) => ({ ...prev, [model]: p }));
  };

  const modelRows = useMemo<ModelRow[]>(() => {
    const rows = REVANA_IMAGE_MODELS.map((m) => ({
      id: m.heliosId,
      name: m.name,
      maker: m.maker,
      badge: BADGES[m.heliosId],
      featured: FEATURED.includes(m.heliosId),
      specs: imageSpecs(getImageCaps(m.heliosId, providerFor(m.heliosId))),
    }));
    const rank = (r: ModelRow) => (r.featured ? FEATURED.indexOf(r.id) : FEATURED.length);
    return rows.sort((a, b) => rank(a) - rank(b));
  }, [providerFor]);

  // ── Generate ────────────────────────────────────────────────────────────────
  const uploading = sendRefs.some((m) => m.uploading);
  const failedUpload = sendRefs.some((m) => !!m.error);
  const promptOver = prompt.length > caps.promptMaxLength;

  let blocker: Blocker | null = null;
  if (provider === "revana" && revanaKeySet === false) {
    blocker = {
      text: caps.hasProviderChoice && kieKeySet ? "Add a Revana API key, or run this model on Kie.ai." : "Add your Revana API key to generate.",
      action: "settings",
    };
  }
  else if (provider === "kie" && kieKeySet === false) blocker = { text: "Add a Kie.ai key, or run this model on Revana.", action: "settings" };
  else if (uploading) blocker = { text: "Uploading…" };
  else if (failedUpload) blocker = { text: "Remove the upload that failed first." };
  else if (!prompt.trim()) blocker = { text: "Write a prompt." };
  else if (promptOver) blocker = { text: `The prompt is over ${caps.promptMaxLength.toLocaleString()} characters.` };
  // References over the model's limit aren't a stop: they show dimmed and only the first ones are sent.

  const price = imagePrice(caps, effResolution);

  const generate = () => {
    if (blocker || submitting) return;
    requestNotificationPermission();
    const settings: JobSettings = {
      kind: "image",
      model,
      provider,
      ...(savedProviders[model] ? { providerSaved: savedProviders[model] } : {}),
      prompt: prompt.trim(),
      duration: 0,
      resolution: effResolution,
      aspectRatio: effRatio,
      sound: false,
      referenceImageUrls: sendRefs.flatMap((r) => (r.url ? [r.url] : [])),
      ratioHint: parseRatio(effRatio) ?? sendRefs[0]?.ratio,
    };
    setSubmitting(true);
    later(() => setSubmitting(false), 650);
    void submit(settings);
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Improve prompt (Claude) ─────────────────────────────────────────────────
  const coach = usePromptCoach({
    prompt,
    setPrompt,
    getInput: () => ({
      idea: prompt,
      kind: "image",
      model: {
        id: model,
        name: caps.name,
        resolution: effResolution,
        aspectRatio: effRatio,
        promptMaxLength: caps.promptMaxLength,
      },
      targets: mentionTargets,
      frames: [],
    }),
  });

  // ── Reuse ───────────────────────────────────────────────────────────────────
  const applySettings = (s: Partial<JobSettings>) => {
    const nextModel = imageModelExists(s.model) ? s.model : model;
    if (s.providerSaved && s.providerSaved !== savedProviders[nextModel]) {
      const chosen = s.providerSaved;
      saveImageProvider(nextModel, chosen);
      setSavedProviders((prev) => ({ ...prev, [nextModel]: chosen }));
    }
    setModel(nextModel);
    if (typeof s.prompt === "string") setPrompt(s.prompt);
    if (s.resolution) setResolution(s.resolution);
    if (s.aspectRatio) setAspectRatio(s.aspectRatio);
    refs.forEach(release);
    setRefs((s.referenceImageUrls ?? []).flatMap((u) => mediaFromUrl(u) ?? []));

    setViewerOpen(false);
    setPromptFlash(true);
    later(() => setPromptFlash(false), 1100);
    requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }));
  };

  const reuse = (entry: FeedEntry) => {
    if (entry.kind === "job") return applySettings(entry.job.settings);
    if (entry.meta) return applySettings(entry.meta);
    applySettings({
      model: entry.item.model,
      prompt: entry.item.prompt,
      aspectRatio: entry.item.aspect_ratio,
      resolution: entry.item.quality,
      referenceImageUrls: entry.item.referenceImageUrls ?? [],
    });
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const download = async (url: string): Promise<boolean> => {
    const filename = `cactusgen-${Date.now()}.${fileExt(url)}`;
    const save = (href: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    try {
      const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${filename}`);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      save(href);
      setTimeout(() => URL.revokeObjectURL(href), 2000);
      return true;
    } catch {
      try { save(url); return true; } catch { return false; }
    }
  };

  const downloadFromCard = (url: string) => {
    void download(url).then((ok) => { if (!ok) addToast("Couldn't download that picture.", "error"); });
  };

  // ── Viewer ──────────────────────────────────────────────────────────────────
  const viewable = entries.filter((e) => entryUrl(e));
  const viewerIndex = viewable.findIndex((e) => e.key === viewerKey);
  const viewerEntry = viewerIndex >= 0 ? viewable[viewerIndex] : null;
  const viewerData: ViewerData | null = !viewerEntry
    ? null
    : viewerEntry.kind === "job"
      ? {
          key: viewerEntry.key,
          url: entryUrl(viewerEntry)!,
          model: viewerEntry.job.settings.model,
          prompt: viewerEntry.job.settings.prompt,
          settings: viewerEntry.job.settings,
          createdAt: viewerEntry.job.createdAt,
          deletable: false,
        }
      : {
          key: viewerEntry.key,
          url: viewerEntry.url,
          model: viewerEntry.item.model,
          prompt: viewerEntry.item.prompt,
          settings: viewerEntry.meta ?? { aspectRatio: viewerEntry.item.aspect_ratio, resolution: viewerEntry.item.quality?.toUpperCase() },
          looseInputs: viewerEntry.meta ? undefined : viewerEntry.item.referenceImageUrls,
          createdAt: viewerEntry.item.created_at,
          deletable: viewerEntry.item.source === "generation",
        };

  const openViewer = (key: string) => {
    setViewerKey(key);
    setViewerOpen(true);
  };

  const deleteCurrent = async (): Promise<boolean> => {
    if (!viewerEntry || viewerEntry.kind !== "item") return false;
    const item = viewerEntry.item;
    const siblings = new Set(item.imageUrls?.length ? item.imageUrls : [item.url]);
    const rest = viewable.filter((e) => !(e.kind === "item" && e.item.id === item.id));
    const next = viewable.slice(viewerIndex + 1).find((e) => !siblings.has(entryUrl(e) ?? ""))
      ?? [...viewable.slice(0, viewerIndex)].reverse().find((e) => !siblings.has(entryUrl(e) ?? ""))
      ?? null;
    const ok = await history.remove(item);
    if (ok) {
      siblings.forEach(forgetMeta);
      if (next && rest.length) setViewerKey(next.key);
      else setViewerOpen(false);
    }
    return ok;
  };

  const onRatio = useCallback((url: string, w: number, h: number) => {
    const r = w / h;
    setRatios((prev) => (prev[url] && Math.abs(prev[url] - r) < 0.001 ? prev : { ...prev, [url]: r }));
    rememberRatio(url, w, h);
  }, []);

  // ── Composer parts ──────────────────────────────────────────────────────────
  const plusContent = caps.maxRefs > 0 ? (
    <div className="flex flex-col gap-3">
      <RefsStrip
        label="Reference images"
        emptyHint="Pictures to edit, combine, or match the look of. Mention them in the prompt as @image1, @image2 …"
        tagPrefix="image"
        onReorder={reorderRefs}
        items={refs}
        max={caps.maxRefs}
        locked={false}
        lockedReason=""
        onFiles={addFiles}
        onUrl={addUrl}
        onRemove={removeRef}
        onLibrary={() => setPicker(true)}
      />
      <p className="text-[11px] leading-snug text-(--c-text-3)">Tip: drop or paste pictures anywhere on the page.</p>
    </div>
  ) : null;

  const attached: Attached[] = refs.map((r, i) => ({
    key: r.id,
    item: r,
    label: `image${i + 1}`,
    unusedReason: i >= caps.maxRefs ? "Over this model's limit — not sent" : undefined,
  }));
  const attachments = <AttachmentList items={attached} onRemove={removeRef} onOpen={() => setPlusOpen(true)} />;

  const chips = (
    <>
      <ModelChip value={model} rows={modelRows} onChange={setModel} label="Image model" />
      {caps.hasProviderChoice && (
        <OptionChip
          icon={<Server className="size-3.5" strokeWidth={2.2} />}
          label={provider === "revana" ? "Revana" : "Kie.ai"}
          title="Run on"
          value={provider}
          options={[
            { value: "revana", label: "Revana", hint: price !== null || provider === "kie" ? "pay per image" : undefined },
            { value: "kie", label: "Kie.ai" },
          ]}
          onChange={(v) => changeProvider(v === "kie" ? "kie" : "revana")}
        />
      )}
      {caps.ratios.length > 1 && (
        <OptionChip
          icon={<Scan className="size-3.5" strokeWidth={2.2} />}
          label={prettyRatio(effRatio)}
          title="Aspect ratio"
          value={effRatio}
          options={caps.ratios.map((r) => ({ value: r, label: prettyRatio(r), glyph: <RatioGlyph ratio={r} /> }))}
          onChange={setAspectRatio}
        />
      )}
      {caps.resolutions.length > 1 && (
        <OptionChip
          icon={<Gem className="size-3.5" strokeWidth={2.2} />}
          label={effResolution}
          title="Resolution"
          value={effResolution}
          options={caps.resolutions.map((r) => {
            const p = imagePrice(caps, r);
            return { value: r, label: r, hint: p !== null ? `$${p.toFixed(2)}` : undefined };
          })}
          onChange={setResolution}
        />
      )}
    </>
  );

  const showHero = !history.loading && entries.length === 0;

  // ── Layout ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(styles.tokens, "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-(--c-bg)")}
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) setPageDrag(true);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setPageDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPageDrag(false);
      }}
      onDrop={(e) => {
        setPageDrag(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        addFiles(files);
      }}
    >
      <main ref={feedRef} className={cn(styles.scroll, "relative min-h-0 flex-1 overflow-y-auto")}>
        <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 pb-[300px] pt-5 sm:pb-[250px] md:px-6">
          {showHero ? (
            <EmptyHero
              title="Create image."
              subline="Describe a picture, add references with + to edit or combine them, and generate with GPT Image 2.5, Nano Banana Pro and more."
              error={history.error}
              onRetry={() => { void history.refresh(); }}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-[13px] font-semibold text-(--c-text)">Your images</span>
                <span className="text-[12px] tabular-nums text-(--c-text-3)" aria-live="polite">
                  {activeCount > 0
                    ? `${activeCount} generating`
                    : history.items.length > 0
                      ? `${history.items.length}${history.hasMore ? "+" : ""}`
                      : ""}
                </span>
                <Link
                  href="/gallery?tab=images"
                  className={cn("ml-auto inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-(--c-text-3) transition-colors hover:text-(--c-text)", FOCUS)}
                >
                  Open gallery
                  <ArrowUpRight className="size-3.5" strokeWidth={2} />
                </Link>
              </div>
              <HistoryFeed
                media="image"
                entries={entries}
                ratios={ratios}
                loading={history.loading}
                loadingMore={history.loadingMore}
                hasMore={history.hasMore}
                error={history.error}
                onLoadMore={history.loadMore}
                onRetry={() => { void (history.items.length ? history.loadMore() : history.refresh()); }}
                onRatio={onRatio}
                onOpen={openViewer}
                onReuse={reuse}
                onDownload={downloadFromCard}
                onDismiss={dismiss}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </>
          )}
        </div>
      </main>

      <Composer
        label="Create an image"
        plusContent={plusContent}
        plusLabel="Add reference images"
        plusOpen={plusOpen}
        onPlusOpenChange={setPlusOpen}
        attachments={attachments}
        attachmentCount={refs.length}
        prompt={prompt}
        onPromptChange={setPrompt}
        promptRef={promptRef}
        placeholder={refs.length
          ? "Describe the edit, e.g. put the product from @image1 on a marble table at golden hour"
          : "Describe the picture: subject, style, setting, light, mood"}
        promptFlash={promptFlash}
        promptMaxLength={caps.promptMaxLength}
        mentions={mentionTargets}
        mentionEmpty={caps.maxRefs > 0 ? "Add reference images with + to mention them here as @image1, @image2 …" : null}
        coach={coach}
        chips={chips}
        onGenerate={generate}
        blocker={blocker}
        submitting={submitting}
        price={price}
        priceNote="estimated Revana cost per image"
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {pageDrag && (
        <div className="pointer-events-none absolute inset-3 top-[68px] z-50 grid place-items-center rounded-2xl border-2 border-dashed border-[#d4ff2a]/60 bg-[#0b0b0b]/75 backdrop-blur-sm">
          <span className="rounded-lg bg-black/60 px-3 py-2 text-[13px] font-semibold text-(--c-text)">
            {caps.maxRefs > refs.length ? "Drop to add as reference" : `${caps.name} takes up to ${caps.maxRefs} references`}
          </span>
        </div>
      )}

      <ResultViewer
        media="image"
        open={viewerOpen}
        data={viewerData}
        hasPrev={viewerIndex > 0}
        hasNext={viewerIndex >= 0 && viewerIndex < viewable.length - 1}
        onPrev={() => { if (viewerIndex > 0) setViewerKey(viewable[viewerIndex - 1].key); }}
        onNext={() => { if (viewerIndex < viewable.length - 1) setViewerKey(viewable[viewerIndex + 1].key); }}
        onClose={() => setViewerOpen(false)}
        onClosed={() => setViewerKey(null)}
        onDownload={download}
        onReuse={() => { if (viewerEntry) reuse(viewerEntry); }}
        onDelete={deleteCurrent}
      />

      {picker && (
        <MediaPickerModal
          open
          mediaKind="image"
          onClose={() => setPicker(false)}
          onPickUrl={(url, type) => {
            if (type !== "image") {
              addToast("Pick an image for the references.", "info");
              return;
            }
            addUrl(url);
          }}
          onDeselect={(url) => {
            const r = refs.find((x) => x.url === url);
            if (r) removeRef(r.id);
          }}
          onUpload={() => {
            setPicker(false);
            setPlusOpen(true);
            // The "+" popover mounts its slots a frame or two later.
            later(() => document.querySelector<HTMLButtonElement>('[data-slot="refs"]')?.click(), 120);
          }}
          selectedUrls={refs.flatMap((r) => (r.url ? [r.url] : []))}
          maxCount={caps.maxRefs}
        />
      )}
    </div>
  );
}
