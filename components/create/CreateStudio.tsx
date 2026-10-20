"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE (video) — full-bleed studio: top bar, the generations feed, and
// the floating composer at the bottom (media "+", prompt, setting chips,
// Generate). Queued jobs appear in the feed instantly and finished clips stack
// up newest first. Rendered client-only (see CreateLoader) so it can read
// localStorage freely.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Gem, Scan, Server, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { useWorkflowStore } from "@/lib/store";
import { MediaPickerModal } from "@/components/MediaPickerModal";
import { requestNotificationPermission } from "@/lib/browserNotify";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import { estimateRevanaCost, isRevanaModel } from "@/lib/revanaModels";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";
import { AttachmentList, Composer, DurationChip, OptionChip, RatioGlyph, ToggleChip, prettyRatio, type Attached, type Blocker } from "./Composer";
import { EmptyHero, HistoryFeed, entryUrl, type FeedEntry } from "./HistoryFeed";
import { RefsStrip, SingleSlot } from "./MediaSlots";
import { ModelChip, type ModelRow } from "./ModelPopover";
import { ResultViewer, type ViewerData } from "./ResultViewer";
import { TopNav } from "./TopNav";
import { useCreateJobs, jobUrls } from "./useCreateJobs";
import { useHistory } from "./useHistory";
import { FOCUS } from "./ui";
import {
  DEFAULT_MODEL_ID,
  getCaps,
  modelExists,
  effectiveProvider,
  normalizeDuration,
  readSavedProvider,
  writeProvider,
  type CreateProvider,
  type ModelCaps,
} from "./modelCaps";
import {
  forgetMeta,
  isVideoUrl,
  loadDraft,
  loadFormSettings,
  loadMeta,
  loadRatioCache,
  newId,
  parseRatio,
  rememberRatio,
  saveDraft,
  saveFormSettings,
  uploadAsset,
  type CreateJob,
  type JobSettings,
  type MediaItem,
  type SlotTarget,
} from "./shared";

type SingleTarget = Exclude<SlotTarget, "refs">;

const SLOT_LABEL: Record<SlotTarget, string> = {
  startFrame: "start frame",
  endFrame: "end frame",
  refs: "reference",
  video: "input video",
};

/** Featured in the model picker, in this order. */
const FEATURED: string[] = ["seedance-2-5", "seedance-2-5-edit", "kling-3.0", "veo3", "seedance-2"];
const BADGES: Record<string, "TOP" | "NEW"> = { "seedance-2-5": "TOP", "seedance-2-5-edit": "NEW" };

/** Explicit per-model provider choices (models never set are left out). */
function readAllSaved(): Record<string, CreateProvider | undefined> {
  return Object.fromEntries(VIDEO_MODELS.map((m) => [m.id, readSavedProvider(m.id)]));
}

/** Revana edits keep the clip's length; price the worst case (the server caps it the same way). */
const EDIT_PRICE_SECONDS = 30;

function mediaFromUrl(url: string | undefined | null, kind: "image" | "video"): MediaItem | null {
  if (!url) return null;
  return { id: newId(), url, preview: url, kind, uploading: false, error: null };
}

function byNewest(a: { at: string }, b: { at: string }) {
  return new Date(b.at).getTime() - new Date(a.at).getTime();
}

function videoSpecs(caps: ModelCaps): string[] {
  const out: string[] = [];
  const top = caps.resolutions[caps.resolutions.length - 1]?.label;
  if (top) out.push(top);
  const d = caps.duration;
  if (d.kind === "range") out.push(`${d.min}s–${d.max}s`);
  else if (d.kind === "list") out.push(d.values.length > 1 ? `${d.values[0]}s–${d.values[d.values.length - 1]}s` : `${d.values[0]}s`);
  else if (caps.isVeo) out.push("8s");
  if (caps.video && !caps.isMotionControl) out.push("Edit video");
  if (caps.isMotionControl) out.push("Motion");
  if (caps.sound) out.push("Audio");
  if (caps.provider === "revana") out.push("Revana");
  return out;
}

export default function CreateStudio() {
  const debugMode = useWorkflowStore((s) => s.debugMode);
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const revanaKeySet = useWorkflowStore((s) => s.revanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const addToast = useWorkflowStore((s) => s.addToast);

  // ── Form state, restored from the last session ──────────────────────────────
  const [boot] = useState(() => {
    const saved = loadFormSettings();
    const draft = loadDraft();
    const savedModel = saved?.model;
    const model = modelExists(savedModel) ? savedModel : DEFAULT_MODEL_ID;
    return { saved, draft, model, caps: getCaps(model, readSavedProvider(model) ?? "kie") };
  });

  const [model, setModel] = useState(boot.model);
  const [savedProviders, setSavedProviders] = useState(readAllSaved);
  // What each model will run on, as the server will resolve it.
  const providers = useMemo(
    () => Object.fromEntries(VIDEO_MODELS.map((m) => [
      m.id,
      effectiveProvider(m.id, savedProviders[m.id], { kie: kieKeySet, revana: revanaKeySet }),
    ])) as Record<string, CreateProvider>,
    [savedProviders, kieKeySet, revanaKeySet],
  );
  const provider: CreateProvider = providers[model] ?? "kie";
  const caps = useMemo(() => getCaps(model, provider), [model, provider]);

  const [prompt, setPrompt] = useState(boot.draft?.prompt ?? "");
  const [duration, setDuration] = useState<number>(boot.saved?.duration ?? boot.caps.defaultDuration);
  const [resolution, setResolution] = useState(boot.saved?.resolution ?? boot.caps.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState(boot.saved?.aspectRatio ?? boot.caps.defaultRatio);
  const [sound, setSound] = useState(boot.saved?.sound ?? false);
  const [mode, setMode] = useState(boot.saved?.mode ?? boot.caps.defaultMode);

  const [startFrame, setStartFrame] = useState(() => mediaFromUrl(boot.draft?.startFrameUrl, "image"));
  const [endFrame, setEndFrame] = useState(() => mediaFromUrl(boot.draft?.endFrameUrl, "image"));
  const [video, setVideo] = useState(() => mediaFromUrl(boot.draft?.videoUrl, "video"));
  const [refs, setRefs] = useState<MediaItem[]>(() =>
    (boot.draft?.referenceImageUrls ?? []).flatMap((u) => mediaFromUrl(u, "image") ?? []),
  );

  const [submitting, setSubmitting] = useState(false);
  const [promptFlash, setPromptFlash] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [picker, setPicker] = useState<SlotTarget | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [ratios, setRatios] = useState(loadRatioCache);
  const [meta, setMeta] = useState(loadMeta);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLElement>(null);
  const blobUrls = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Values the request actually uses (state clamped to the current model) ────
  const effDuration = normalizeDuration(caps.duration, duration);
  const resOpt = caps.resolutions.find((r) => r.value === resolution)
    ?? caps.resolutions.find((r) => r.value === caps.defaultResolution)
    ?? caps.resolutions[0];
  const effResolution = resOpt?.value ?? "";
  const effRatio = caps.ratios.includes(aspectRatio) ? aspectRatio : caps.defaultRatio;
  const effMode = resOpt?.mode ?? (caps.modes.length ? (caps.modes.some((m) => m.value === mode) ? mode : caps.defaultMode) : undefined);
  const effSound = caps.sound && sound;

  // Start/end frames and references are mutually exclusive; frames win.
  const framesActive = (caps.startFrame && !!startFrame) || (caps.endFrame && !!endFrame);
  const refsActive = caps.maxRefs > 0 && refs.length > 0;
  const refsLocked = framesActive;
  const framesLocked = refsActive && !framesActive;

  const sendStart = caps.startFrame && !framesLocked ? startFrame : null;
  const sendEnd = caps.endFrame && !framesLocked ? endFrame : null;
  const sendRefs = caps.maxRefs > 0 && !refsLocked ? refs.slice(0, caps.maxRefs) : [];
  const sendVideo = caps.video ? video : null;
  const inUse = [sendStart, sendEnd, sendVideo, ...sendRefs].filter((m): m is MediaItem => !!m);

  // ── Persistence ─────────────────────────────────────────────────────────────
  useEffect(() => {
    saveFormSettings({ model, duration: effDuration, resolution: effResolution, aspectRatio: effRatio, sound, mode: effMode });
  }, [model, effDuration, effResolution, effRatio, sound, effMode]);

  const refsKey = refs.map((r) => r.url ?? "").join("|");
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft({
        prompt,
        startFrameUrl: startFrame?.url ?? undefined,
        endFrameUrl: endFrame?.url ?? undefined,
        referenceImageUrls: refsKey ? refsKey.split("|").filter(Boolean) : [],
        videoUrl: video?.url ?? undefined,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [prompt, startFrame?.url, endFrame?.url, refsKey, video?.url]);

  // Provider choices are shared with Settings and the gallery.
  useEffect(() => {
    const sync = () => setSavedProviders(readAllSaved());
    window.addEventListener("aiui-providers-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("aiui-providers-changed", sync);
      window.removeEventListener("storage", sync);
    };
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
  const history = useHistory("video");
  const refreshHistory = history.refresh;
  const pruneRef = useRef<(urls: Set<string>) => void>(() => {});
  const handleJobDone = useCallback(async (job: CreateJob) => {
    setMeta(loadMeta());
    const urls = jobUrls(job);
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await refreshHistory();
      pruneRef.current(new Set(fresh.map((i) => i.url)));
      // The gallery row is written right after the done event — look once more if we raced it.
      if (!urls.length || urls.every((u) => fresh.some((i) => i.url === u))) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, [refreshHistory]);
  const { jobs, submit, dismiss, pruneDone } = useCreateJobs({ kind: "video", debugMode, onJobDone: handleJobDone });
  useEffect(() => { pruneRef.current = pruneDone; }, [pruneDone]);

  const historyUrls = useMemo(() => new Set(history.items.map((i) => i.url)), [history.items]);
  const activeCount = jobs.filter((j) => j.status === "submitting" || j.status === "pending").length;

  const entries = useMemo<FeedEntry[]>(() => {
    // In-flight and just-finished jobs on top; failures interleave with history by date.
    // Finished clips are keyed by URL, so a job card hands over to its history
    // row without remounting (and an open viewer stays on it).
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
        top.push({ kind: "job", key: `v:${url}`, job, url });
      }
    }
    for (const item of history.items) {
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      dated.push({ kind: "item", key: `v:${item.url}`, item, url: item.url, meta: meta[item.url], at: item.created_at });
    }
    dated.sort(byNewest);
    return [...top, ...dated];
  }, [jobs, history.items, historyUrls, meta]);

  // ── Media ───────────────────────────────────────────────────────────────────
  const setSingle = (t: SingleTarget) => (t === "startFrame" ? setStartFrame : t === "endFrame" ? setEndFrame : setVideo);
  const currentSingle = (t: SingleTarget) => (t === "startFrame" ? startFrame : t === "endFrame" ? endFrame : video);

  const release = (item: MediaItem | null | undefined) => {
    if (item?.preview.startsWith("blob:")) {
      URL.revokeObjectURL(item.preview);
      blobUrls.current.delete(item.preview);
    }
  };

  const patchItem = (target: SlotTarget, id: string, patch: Partial<MediaItem>) => {
    if (target === "refs") setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    else setSingle(target)((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const addFiles = (target: SlotTarget, files: File[]) => {
    const kind = target === "video" ? "video" : "image";
    const accepted = files.filter((f) => f.type.startsWith(`${kind}/`));
    if (!accepted.length) {
      addToast(kind === "video" ? "That slot takes a video file." : "That slot takes image files.", "error");
      return;
    }
    const take = target === "refs" ? accepted.slice(0, Math.max(0, caps.maxRefs - refs.length)) : accepted.slice(0, 1);
    if (!take.length) {
      addToast(`${caps.name} takes up to ${caps.maxRefs} references.`, "info");
      return;
    }
    const items: MediaItem[] = take.map((file) => {
      const preview = URL.createObjectURL(file);
      blobUrls.current.add(preview);
      return { id: newId(), url: null, preview, kind, uploading: true, error: null };
    });
    if (target === "refs") setRefs((prev) => [...prev, ...items]);
    else {
      release(currentSingle(target));
      setSingle(target)(items[0]);
    }
    items.forEach((item, i) => {
      uploadAsset(take[i])
        .then((url) => patchItem(target, item.id, { url, uploading: false }))
        .catch((e: unknown) => patchItem(target, item.id, { uploading: false, error: e instanceof Error ? e.message : "Upload failed" }));
    });
  };

  const addUrl = (target: SlotTarget, url: string) => {
    const item = mediaFromUrl(url, target === "video" ? "video" : "image");
    if (!item) return;
    if (target === "refs") {
      setRefs((prev) => (prev.some((r) => r.url === url) || prev.length >= caps.maxRefs ? prev : [...prev, item]));
    } else {
      release(currentSingle(target));
      setSingle(target)(item);
    }
  };

  const removeItem = (target: SlotTarget, id: string) => {
    if (target === "refs") {
      release(refs.find((r) => r.id === id));
      setRefs((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    const cur = currentSingle(target);
    if (cur?.id === id) {
      release(cur);
      setSingle(target)(null);
    }
  };

  const setItemRatio = (target: SlotTarget, id: string, ratio: number) => {
    const cur = target === "refs" ? refs.find((r) => r.id === id) : currentSingle(target);
    if (!cur || cur.id !== id || (cur.ratio && Math.abs(cur.ratio - ratio) < 0.001)) return;
    patchItem(target, id, { ratio });
  };

  /** Where an image without an explicit slot should go. */
  const routeImage = (preferred: SlotTarget | undefined, count: number): SlotTarget | null => {
    const can = (t: SlotTarget) =>
      t === "startFrame" ? caps.startFrame && !framesLocked
        : t === "endFrame" ? caps.endFrame && !framesLocked
          : t === "refs" ? caps.maxRefs > 0 && !refsLocked && refs.length < caps.maxRefs
            : false;
    if (preferred && preferred !== "video" && can(preferred)) return preferred;
    if (count > 1 && can("refs")) return "refs";
    if (can("startFrame") && !startFrame) return "startFrame";
    if (can("refs")) return "refs";
    if (can("endFrame") && !endFrame) return "endFrame";
    if (can("startFrame")) return "startFrame";
    return null;
  };

  const routeFiles = (files: File[], preferred?: SlotTarget) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    let used = false;
    if (videos.length && caps.video) {
      addFiles("video", videos.slice(0, 1));
      used = true;
    }
    if (images.length) {
      const t = routeImage(preferred, images.length);
      if (t) {
        addFiles(t, t === "refs" ? images : images.slice(0, 1));
        used = true;
      }
    }
    if (!used && (images.length || videos.length)) {
      addToast(`${caps.name} doesn't take ${images.length ? "image" : "video"} inputs here.`, "info");
    }
  };

  // Paste images/videos anywhere on the page (into the focused slot if one is focused).
  const handlePaste = useEffectEvent((e: ClipboardEvent) => {
    if (viewerOpen || picker) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => /^(image|video)\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const slotEl = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-slot]");
    routeFiles(files, slotEl?.dataset.slot as SlotTarget | undefined);
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const dropHint = (() => {
    const t = routeImage(undefined, 1);
    if (t) return `Drop to add as ${SLOT_LABEL[t]}`;
    if (caps.video) return "Drop a video to edit";
    return `${caps.name} doesn't take files`;
  })();

  // ── Model / provider ────────────────────────────────────────────────────────
  const changeProvider = (p: CreateProvider) => {
    writeProvider(model, p);
    setSavedProviders((prev) => ({ ...prev, [model]: p }));
  };

  const modelRows = useMemo<ModelRow[]>(() => {
    const rows = VIDEO_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      maker: m.provider,
      badge: BADGES[m.id],
      featured: FEATURED.includes(m.id),
      specs: videoSpecs(getCaps(m.id, providers[m.id] ?? "kie")),
    }));
    const rank = (r: ModelRow) => (r.featured ? FEATURED.indexOf(r.id) : FEATURED.length);
    return rows.sort((a, b) => rank(a) - rank(b));
  }, [providers]);

  // ── Generate ────────────────────────────────────────────────────────────────
  const uploading = inUse.some((m) => m.uploading);
  const failedUpload = inUse.some((m) => !!m.error);
  const hasMedia = inUse.some((m) => !!m.url);
  const promptOver = caps.promptMaxLength !== null && prompt.length > caps.promptMaxLength;

  let blocker: Blocker | null = null;
  if (provider === "kie" && kieKeySet === false) {
    blocker = {
      text: isRevanaModel(model) ? "Add a Kie.ai key, or run this model on Revana." : "Add your Kie.ai API key to generate.",
      action: "settings",
    };
  }
  else if (provider === "revana" && revanaKeySet === false) blocker = { text: "Add your Revana API key to generate.", action: "settings" };
  else if (uploading) blocker = { text: "Uploading…" };
  else if (failedUpload) blocker = { text: "Remove the upload that failed first." };
  else if (caps.video?.required && !sendVideo?.url) blocker = { text: caps.isMotionControl ? "Add a motion video with +." : "Add the video you want to edit with +." };
  else if (caps.requiresStartFrame && !sendStart?.url) blocker = { text: caps.isMotionControl ? "Add a character image with +." : "Add a start frame with +." };
  else if (caps.requiresRefs && !sendRefs.some((r) => r.url)) blocker = { text: "Add a reference image with +." };
  else if (provider === "revana" && sendEnd && !sendStart) blocker = { text: "Add a start frame — on Revana an end frame needs one." };
  else if (provider === "revana" && !prompt.trim()) blocker = { text: "Write a prompt — Revana needs one." };
  else if (!caps.promptOptional && !prompt.trim()) blocker = { text: "Write a prompt." };
  else if (caps.promptOptional && !prompt.trim() && !hasMedia) blocker = { text: "Write a prompt or add an image." };
  else if (promptOver) blocker = { text: `The prompt is over ${caps.promptMaxLength?.toLocaleString()} characters.` };

  const priceIsMax = caps.duration.kind === "none";
  const price = provider === "revana"
    ? estimateRevanaCost(model, effResolution, priceIsMax ? EDIT_PRICE_SECONDS : effDuration, effSound)
    : null;

  const generate = () => {
    if (blocker || submitting) return;
    requestNotificationPermission();
    const settings: JobSettings = {
      kind: "video",
      model,
      provider,
      ...(savedProviders[model] ? { providerSaved: savedProviders[model] } : {}),
      prompt: prompt.trim(),
      duration: effDuration,
      resolution: effResolution,
      aspectRatio: effRatio,
      sound: effSound,
      ...(effMode ? { mode: effMode } : {}),
      ...(sendStart?.url ? { startFrameUrl: sendStart.url } : {}),
      ...(sendEnd?.url ? { endFrameUrl: sendEnd.url } : {}),
      referenceImageUrls: sendRefs.flatMap((r) => (r.url ? [r.url] : [])),
      ...(sendVideo?.url ? { videoUrl: sendVideo.url, videoKey: caps.video?.key } : {}),
      ratioHint: parseRatio(effRatio) ?? sendStart?.ratio ?? sendVideo?.ratio ?? sendRefs[0]?.ratio,
    };
    setSubmitting(true);
    later(() => setSubmitting(false), 650);
    void submit(settings);
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Reuse ───────────────────────────────────────────────────────────────────
  const applySettings = (s: Partial<JobSettings>, loose: boolean) => {
    const nextModel = modelExists(s.model) ? s.model : model;
    let nextProvider: CreateProvider = providers[nextModel] ?? "kie";
    if (s.providerSaved && isRevanaModel(nextModel)) {
      const chosen = s.providerSaved;
      if (chosen !== savedProviders[nextModel]) {
        writeProvider(nextModel, chosen);
        setSavedProviders((prev) => ({ ...prev, [nextModel]: chosen }));
      }
      nextProvider = chosen;
    }
    const c = getCaps(nextModel, nextProvider);
    setModel(nextModel);
    if (typeof s.prompt === "string") setPrompt(s.prompt);
    if (typeof s.duration === "number" && s.duration > 0) setDuration(s.duration);
    if (s.resolution) setResolution(s.resolution);
    if (s.aspectRatio) setAspectRatio(s.aspectRatio);
    if (typeof s.sound === "boolean") setSound(s.sound);
    if (s.mode) setMode(s.mode);

    [startFrame, endFrame, video, ...refs].forEach(release);
    let start = s.startFrameUrl;
    let vid = s.videoUrl;
    let refUrls = s.referenceImageUrls ?? [];
    if (loose) {
      // Gallery rows only list "inputs" without roles — make a sensible guess.
      const vids = refUrls.filter(isVideoUrl);
      const imgs = refUrls.filter((u) => !isVideoUrl(u));
      vid = c.video ? vids[0] : undefined;
      refUrls = imgs;
      if ((c.maxRefs === 0 || c.isMotionControl) && c.startFrame && imgs.length) {
        start = imgs[0];
        refUrls = [];
      }
    }
    setStartFrame(mediaFromUrl(start, "image"));
    setEndFrame(mediaFromUrl(s.endFrameUrl, "image"));
    setVideo(mediaFromUrl(vid, "video"));
    setRefs(refUrls.flatMap((u) => mediaFromUrl(u, "image") ?? []));

    setViewerOpen(false);
    setPromptFlash(true);
    later(() => setPromptFlash(false), 1100);
    requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }));
  };

  const reuse = (entry: FeedEntry) => {
    if (entry.kind === "job") return applySettings(entry.job.settings, false);
    if (entry.meta) return applySettings(entry.meta, false);
    applySettings({
      model: entry.item.model,
      prompt: entry.item.prompt,
      aspectRatio: entry.item.aspect_ratio,
      referenceImageUrls: entry.item.referenceImageUrls ?? [],
    }, true);
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const download = async (url: string): Promise<boolean> => {
    const filename = `heliosgen-${Date.now()}.mp4`;
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
    void download(url).then((ok) => { if (!ok) addToast("Couldn't download that video.", "error"); });
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
          settings: viewerEntry.meta ?? { aspectRatio: viewerEntry.item.aspect_ratio },
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
    const next = viewable[viewerIndex + 1] ?? viewable[viewerIndex - 1] ?? null;
    const ok = await history.remove(viewerEntry.item);
    if (ok) {
      forgetMeta(viewerEntry.item.url);
      if (next) setViewerKey(next.key);
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
  const showFrames = caps.startFrame || caps.endFrame;
  const lockedFramesText = "Off while references are set";
  const lockedRefsText = "Off while a start or end frame is set. A clip starts from frames or from references, not both.";
  const hasPlus = !!caps.video || showFrames || caps.maxRefs > 0;

  const plusContent = hasPlus ? (
    <div className="flex flex-col gap-4">
      {caps.video && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-(--c-text-2)">{caps.isMotionControl ? "Motion video" : "Video to edit"}</div>
          <SingleSlot
            slot="video"
            label={caps.isMotionControl ? "Motion video" : "Input video"}
            accept="video"
            item={video}
            required={caps.video.required}
            onFiles={(f) => addFiles("video", f)}
            onUrl={(u) => addUrl("video", u)}
            onRemove={() => video && removeItem("video", video.id)}
            onLibrary={() => setPicker("video")}
            onRatio={(r) => video && setItemRatio("video", video.id, r)}
            className="aspect-video"
          />
        </div>
      )}
      {showFrames && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-(--c-text-2)">
            {caps.startFrame && caps.endFrame ? "Frames" : caps.isMotionControl ? "Character" : "Image"}
          </div>
          <div className={cn("grid gap-2", caps.startFrame && caps.endFrame ? "grid-cols-2" : "grid-cols-1")}>
            {caps.startFrame && (
              <SingleSlot
                slot="startFrame"
                label={caps.isMotionControl ? "Character image" : "Start frame"}
                accept="image"
                item={startFrame}
                required={caps.requiresStartFrame}
                disabled={framesLocked}
                lockedReason={lockedFramesText}
                onFiles={(f) => addFiles("startFrame", f)}
                onUrl={(u) => addUrl("startFrame", u)}
                onRemove={() => startFrame && removeItem("startFrame", startFrame.id)}
                onLibrary={() => setPicker("startFrame")}
                onRatio={(r) => startFrame && setItemRatio("startFrame", startFrame.id, r)}
                className={caps.endFrame ? "h-[120px]" : "h-[150px]"}
              />
            )}
            {caps.endFrame && (
              <SingleSlot
                slot="endFrame"
                label="End frame"
                accept="image"
                item={endFrame}
                disabled={framesLocked}
                lockedReason={lockedFramesText}
                onFiles={(f) => addFiles("endFrame", f)}
                onUrl={(u) => addUrl("endFrame", u)}
                onRemove={() => endFrame && removeItem("endFrame", endFrame.id)}
                onLibrary={() => setPicker("endFrame")}
                onRatio={(r) => endFrame && setItemRatio("endFrame", endFrame.id, r)}
                className="h-[120px]"
              />
            )}
          </div>
        </div>
      )}
      {caps.maxRefs > 0 && (
        <RefsStrip
          items={refs}
          max={caps.maxRefs}
          locked={refsLocked}
          lockedReason={lockedRefsText}
          required={caps.requiresRefs}
          onFiles={(f) => addFiles("refs", f)}
          onUrl={(u) => addUrl("refs", u)}
          onRemove={(id) => removeItem("refs", id)}
          onLibrary={() => setPicker("refs")}
        />
      )}
      <p className="text-[11px] leading-snug text-(--c-text-3)">Tip: drop or paste files anywhere on the page.</p>
    </div>
  ) : null;

  const unusedFrames = framesLocked ? "Not sent while references are set" : undefined;
  const attached: Attached[] = [
    ...(caps.video && video ? [{ key: `video:${video.id}`, item: video, label: "Video" }] : []),
    ...(caps.startFrame && startFrame ? [{ key: `startFrame:${startFrame.id}`, item: startFrame, label: caps.isMotionControl ? "Char" : "Start", unusedReason: unusedFrames }] : []),
    ...(caps.endFrame && endFrame ? [{ key: `endFrame:${endFrame.id}`, item: endFrame, label: "End", unusedReason: unusedFrames }] : []),
    ...(caps.maxRefs > 0
      ? refs.map((r, i) => ({
          key: `refs:${r.id}`,
          item: r,
          label: `Ref ${i + 1}`,
          unusedReason: refsLocked ? "Not sent while a frame is set" : i >= caps.maxRefs ? "Over this model's limit — not sent" : undefined,
        }))
      : []),
  ];
  const removeAttached = (key: string) => {
    const at = key.indexOf(":");
    removeItem(key.slice(0, at) as SlotTarget, key.slice(at + 1));
  };
  const attachments = <AttachmentList items={attached} onRemove={removeAttached} onOpen={() => setPlusOpen(true)} />;

  const chips = (
    <>
      <ModelChip value={model} rows={modelRows} onChange={setModel} label="Video model" />
      {isRevanaModel(model) && (
        <OptionChip
          icon={<Server className="size-3.5" strokeWidth={2.2} />}
          label={provider === "revana" ? "Revana" : "Kie.ai"}
          title="Run on"
          value={provider}
          options={[
            { value: "kie", label: "Kie.ai" },
            { value: "revana", label: "Revana", hint: "pay per clip" },
          ]}
          onChange={(v) => changeProvider(v === "revana" ? "revana" : "kie")}
        />
      )}
      <DurationChip
        spec={caps.duration}
        value={effDuration}
        onChange={setDuration}
        fixedLabel={caps.video ? "Clip length" : caps.isVeo ? "8s" : "Auto"}
      />
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
          label={resOpt?.label ?? effResolution}
          title="Resolution"
          value={effResolution}
          options={caps.resolutions.map((r) => {
            const p = provider === "revana" ? estimateRevanaCost(model, r.value, 1, effSound) : null;
            return { value: r.value, label: r.label, hint: p !== null ? `$${p.toFixed(2)}/s` : undefined };
          })}
          onChange={setResolution}
        />
      )}
      {caps.modes.length > 1 && (
        <OptionChip
          icon={<SlidersHorizontal className="size-3.5" strokeWidth={2.2} />}
          label={caps.modes.find((m) => m.value === effMode)?.label ?? "Mode"}
          title="Mode"
          value={effMode ?? ""}
          options={caps.modes.map((m) => ({ value: m.value, label: m.label }))}
          onChange={setMode}
        />
      )}
      {caps.sound && (
        <ToggleChip
          icon={sound ? <Volume2 className="size-3.5" strokeWidth={2.2} /> : <VolumeX className="size-3.5" strokeWidth={2.2} />}
          label={sound ? "On" : "Off"}
          title="Sound"
          pressed={sound}
          onChange={setSound}
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
        routeFiles(files);
      }}
    >
      <TopNav mode="video" />

      <main ref={feedRef} className={cn(styles.scroll, "relative min-h-0 flex-1 overflow-y-auto")}>
        <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 pb-[300px] pt-5 sm:pb-[250px] md:px-6">
          {showHero ? (
            <EmptyHero
              title="Create video."
              subline="Describe a shot, add a start frame or references with +, and render it with Seedance 2.5, Kling, Veo and more."
              error={history.error}
              onRetry={() => { void history.refresh(); }}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-[13px] font-semibold text-(--c-text)">Your videos</span>
                <span className="text-[12px] tabular-nums text-(--c-text-3)" aria-live="polite">
                  {activeCount > 0
                    ? `${activeCount} generating`
                    : history.items.length > 0
                      ? `${history.items.length}${history.hasMore ? "+" : ""}`
                      : ""}
                </span>
                <Link
                  href="/gallery?tab=videos"
                  className={cn("ml-auto inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-(--c-text-3) transition-colors hover:text-(--c-text)", FOCUS)}
                >
                  Open gallery
                  <ArrowUpRight className="size-3.5" strokeWidth={2} />
                </Link>
              </div>
              <HistoryFeed
                media="video"
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
        label="Create a video"
        plusContent={plusContent}
        plusLabel={caps.video ? "Add a video" : "Add images"}
        plusOpen={plusOpen}
        onPlusOpenChange={setPlusOpen}
        attachments={attachments}
        attachmentCount={attached.length}
        prompt={prompt}
        onPromptChange={setPrompt}
        promptRef={promptRef}
        placeholder={caps.video
          ? "Describe the change, e.g. turn the street into a rainy neon night"
          : "Describe the shot: subject, action, camera move, light, mood"}
        promptFlash={promptFlash}
        promptMaxLength={caps.promptMaxLength}
        chips={chips}
        onGenerate={generate}
        blocker={blocker}
        submitting={submitting}
        price={price}
        priceIsMax={priceIsMax}
        priceNote="estimated Revana cost"
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {pageDrag && (
        <div className="pointer-events-none absolute inset-3 top-[68px] z-50 grid place-items-center rounded-2xl border-2 border-dashed border-[#d4ff2a]/60 bg-[#0b0b0b]/75 backdrop-blur-sm">
          <span className="rounded-lg bg-black/60 px-3 py-2 text-[13px] font-semibold text-(--c-text)">{dropHint}</span>
        </div>
      )}

      <ResultViewer
        media="video"
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
          mediaKind={picker === "video" ? "video" : "image"}
          onClose={() => setPicker(null)}
          onPickUrl={(url, type) => {
            const want = picker === "video" ? "video" : "image";
            if (type !== want) {
              addToast(`Pick ${want === "video" ? "a video" : "an image"} for the ${SLOT_LABEL[picker]}.`, "info");
              return;
            }
            addUrl(picker, url);
            if (picker !== "refs") setPicker(null);
          }}
          onDeselect={picker === "refs" ? (url) => {
            const r = refs.find((x) => x.url === url);
            if (r) removeItem("refs", r.id);
          } : undefined}
          onUpload={() => {
            const target = picker;
            setPicker(null);
            setPlusOpen(true);
            // The "+" popover mounts its slots a frame or two later.
            later(() => document.querySelector<HTMLButtonElement>(`[data-slot="${target}"]`)?.click(), 120);
          }}
          selectedUrls={picker === "refs" ? refs.flatMap((r) => (r.url ? [r.url] : [])) : undefined}
          maxCount={picker === "refs" ? caps.maxRefs : undefined}
        />
      )}
    </div>
  );
}
