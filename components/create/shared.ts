// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — shared types, localStorage helpers and the upload helper.
// Everything here is browser-only (the page is rendered client-side).
// ─────────────────────────────────────────────────────────────────────────────
import { getToken } from "@/lib/galleryUtils";
import type { CreateProvider } from "./modelCaps";

export interface MediaItem {
  id: string;
  /** Stored local URL (/generated/...) once the upload finished. */
  url: string | null;
  /** What the thumbnail shows: an object URL while uploading, else `url`. */
  preview: string;
  kind: "image" | "video" | "audio";
  uploading: boolean;
  error: string | null;
  /** Natural width / height, once known. */
  ratio?: number;
}

export type SlotTarget = "startFrame" | "endFrame" | "refs" | "video";

/** Reference lists the video composer can hold (images, clips, sounds). */
export type RefList = "refs" | "refVideos" | "refAudios";

export type CreateKind = "video" | "image";

/** Snapshot of the form at submit time — drives the request, the cards and "Reuse". */
export interface JobSettings {
  /** Absent on jobs saved before image mode existed — those are videos. */
  kind?: CreateKind;
  model: string;
  /** Backend the job ran on (as the UI resolved it). */
  provider: CreateProvider;
  /** The user's explicit per-model choice, sent as `provider`; absent = server decides. */
  providerSaved?: CreateProvider;
  prompt: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  sound: boolean;
  mode?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls: string[];
  /** Reference clips (@video1 …) — Seedance-style multimodal references. */
  referenceVideoUrls?: string[];
  /** Reference sounds (@audio1 …). */
  referenceAudioUrls?: string[];
  videoUrl?: string;
  videoKey?: "videoRef" | "referenceVideo";
  /** Width / height hint for the history card before the video loads. */
  ratioHint?: number;
}

export type JobStatus = "submitting" | "pending" | "done" | "error";

export interface CreateJob {
  id: string;
  taskId?: string;
  status: JobStatus;
  error?: string;
  /** Every result file once done (videos: one; pictures: one or more). */
  urls?: string[];
  /** Video jobs: the clip (= urls[0]). */
  videoUrl?: string;
  createdAt: string;
  finishedAt?: string;
  /** Simulated job (store debug mode) — never sent to the server. */
  debug?: boolean;
  /** Started outside this page (MCP / Claude, gallery, canvas) and picked up while running. */
  external?: boolean;
  settings: JobSettings;
}

export interface FormSettings {
  model: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  sound: boolean;
  mode?: string;
}

export interface DraftState {
  prompt: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  videoUrl?: string;
}

const KEY_SETTINGS = "hg-create-settings";
const KEY_DRAFT    = "hg-create-draft";
const KEY_JOBS     = "hg-create-jobs";
const KEY_META     = "hg-create-meta";
const KEY_IMAGE_SETTINGS  = "hg-create-image-settings";
const KEY_IMAGE_DRAFT     = "hg-create-image-draft";
const KEY_IMAGE_JOBS      = "hg-create-image-jobs";
/** Image mode's Kie.ai / Revana pick per model (separate from Settings' map). */
const KEY_IMAGE_PROVIDERS = "hg-create-image-providers";
/** Shared with the gallery page: url → "w / h" natural ratio cache. */
const KEY_RATIOS   = "hg-ratios";

const MAX_JOBS = 60;
const MAX_META = 300;

function readJson<T>(storage: "local" | "session", key: string): T | null {
  try {
    const store = storage === "local" ? window.localStorage : window.sessionStorage;
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: "local" | "session", key: string, value: unknown) {
  try {
    const store = storage === "local" ? window.localStorage : window.sessionStorage;
    store.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked — non-critical */ }
}

export const loadFormSettings = () => readJson<Partial<FormSettings>>("local", KEY_SETTINGS);
export const saveFormSettings = (s: FormSettings) => writeJson("local", KEY_SETTINGS, s);

export const loadDraft = () => readJson<DraftState>("local", KEY_DRAFT);
export const saveDraft = (d: DraftState) => writeJson("local", KEY_DRAFT, d);

export interface ImageFormSettings {
  model: string;
  resolution: string;
  aspectRatio: string;
}

export interface ImageDraftState {
  prompt: string;
  referenceImageUrls?: string[];
}

export const loadImageForm = () => readJson<Partial<ImageFormSettings>>("local", KEY_IMAGE_SETTINGS);
export const saveImageForm = (s: ImageFormSettings) => writeJson("local", KEY_IMAGE_SETTINGS, s);
export const loadImageDraft = () => readJson<ImageDraftState>("local", KEY_IMAGE_DRAFT);
export const saveImageDraft = (d: ImageDraftState) => writeJson("local", KEY_IMAGE_DRAFT, d);

export function loadImageProviders(): Record<string, "kie" | "revana"> {
  const raw = readJson<Record<string, string>>("local", KEY_IMAGE_PROVIDERS) ?? {};
  return Object.fromEntries(
    Object.entries(raw).filter((e): e is [string, "kie" | "revana"] => e[1] === "kie" || e[1] === "revana"),
  );
}

export function saveImageProvider(model: string, provider: "kie" | "revana") {
  writeJson("local", KEY_IMAGE_PROVIDERS, { ...loadImageProviders(), [model]: provider });
}

/**
 * Jobs survive a reload so in-flight generations resume. A job that was still
 * "submitting" when the page went away never got its taskId back, so we can't
 * track it — surface that honestly instead of spinning forever.
 */
export function loadJobs(kind: CreateKind = "video"): CreateJob[] {
  const raw = readJson<CreateJob[]>("local", kind === "image" ? KEY_IMAGE_JOBS : KEY_JOBS);
  if (!Array.isArray(raw)) return [];
  return raw
    // Finished results come back through the history API; keeping them here
    // would resurrect clips that were deleted from the gallery meanwhile.
    .filter((j) => j && typeof j.id === "string" && j.settings && j.status !== "done")
    .map((j) => {
      if (j.debug && (j.status === "pending" || j.status === "submitting")) {
        return { ...j, status: "error" as const, error: "Debug run interrupted by a reload." };
      }
      if (j.status === "submitting" || (j.status === "pending" && !j.taskId)) {
        return {
          ...j,
          status: "error" as const,
          error: "The page reloaded before the server confirmed this job. If it went through, it will show up in your history.",
        };
      }
      return j;
    });
}

export function saveJobs(jobs: CreateJob[], kind: CreateKind = "video") {
  writeJson("local", kind === "image" ? KEY_IMAGE_JOBS : KEY_JOBS, jobs.slice(0, MAX_JOBS));
}

type MetaMap = Record<string, JobSettings & { createdAt?: string }>;

/** Full settings for results made on this page, keyed by result URL (the gallery API doesn't carry them). */
export function loadMeta(): MetaMap {
  return readJson<MetaMap>("local", KEY_META) ?? {};
}

export function rememberMeta(url: string, settings: JobSettings, createdAt: string) {
  const map = loadMeta();
  delete map[url];
  map[url] = { ...settings, createdAt };
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_META))) delete map[k];
  writeJson("local", KEY_META, map);
}

export function forgetMeta(url: string) {
  const map = loadMeta();
  if (!(url in map)) return;
  delete map[url];
  writeJson("local", KEY_META, map);
}

export function loadRatioCache(): Record<string, number> {
  const raw = readJson<Record<string, string>>("session", KEY_RATIOS) ?? {};
  const out: Record<string, number> = {};
  for (const [url, v] of Object.entries(raw)) {
    const [w, h] = String(v).split("/").map((n) => Number(n.trim()));
    if (w > 0 && h > 0) out[url] = w / h;
  }
  return out;
}

export function rememberRatio(url: string, width: number, height: number) {
  if (!(width > 0 && height > 0)) return;
  const raw = readJson<Record<string, string>>("session", KEY_RATIOS) ?? {};
  raw[url] = `${width} / ${height}`;
  writeJson("session", KEY_RATIOS, raw);
}

/** "16:9" → 1.777…; "adaptive" / "auto" → undefined. */
export function parseRatio(r: string | undefined | null): number | undefined {
  if (!r) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/i.exec(r.trim());
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Same endpoint the gallery and canvas use: raw bytes to /api/upload-asset,
 * which stores the file locally and returns its /generated/... URL.
 */
export async function uploadAsset(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is over the 100 MB limit");
  const token = await getToken();
  const res = await fetch("/api/upload-asset", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  let data: { cdnUrl?: string; error?: string } = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.cdnUrl;
}

/** Server errors that mean "go fix your API key". */
export function isKeyError(message: string | undefined): boolean {
  if (!message) return false;
  return /(api[\s-]?key|apikey|\btoken\b|unauthori[sz]ed|\b401\b|credential)/i.test(message);
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|mkv)(\?|#|$)/i.test(url);
}

export function isAudioUrl(url: string): boolean {
  return /\.(mp3|wav|m4a|ogg|aac|flac)(\?|#|$)/i.test(url);
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
