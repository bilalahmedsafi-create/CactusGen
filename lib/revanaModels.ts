// ─────────────────────────────────────────────────────────────────────────────
// REVANA MODELS — which HeliosGen video models can run through Revana
// (https://revana.si, one key for many providers) and what each accepts.
// Shared by the server route (lib/revana.ts) and the Create page UI.
// Source: https://revana.si/data/models.json (snapshot 2026-10-20, re-checked
// against GET /v1/models). Prices are USD per second of output video, keyed by
// resolution.
// ─────────────────────────────────────────────────────────────────────────────

export interface RevanaModel {
  /** HeliosGen model id (lib/modelConfig.ts VIDEO_MODELS). */
  heliosId: string;
  /** Revana model id sent as `model` to POST /v1/generations. */
  revanaId: string;
  name: string;
  resolutions: string[];
  /**
   * Accepted `aspect_ratio` values. Empty = the model takes no aspect ratio on
   * Revana (Kling: the output follows the start frame / the provider default).
   */
  aspectRatios: string[];
  /** Either a {min,max} range of whole seconds or a fixed list. */
  durations: { min: number; max: number } | number[];
  /** Model can generate sound (`input.audio`). */
  audio: boolean;
  /** Max reference images (`input.image_urls`); 0 = no reference mode. */
  maxRefImages: number;
  /** Max reference clips (`input.video_urls`) — Seedance 2.5 only. */
  maxRefVideos?: number;
  /** Max reference sounds (`input.audio_urls`) — Seedance 2.5 only. */
  maxRefAudios?: number;
  /** Supports `end_image_url` (first + last frame). */
  lastFrame: boolean;
  /** Supports `video_url` (edit an input clip). */
  videoEdit: boolean;
  /**
   * USD per second, keyed by resolution. Models that charge more for sound also
   * carry `"<resolution>+audio"` keys (see estimateRevanaCost).
   */
  pricePerSecond: Record<string, number>;
}

const SEEDANCE_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];

export const REVANA_MODELS: RevanaModel[] = [
  {
    heliosId: "seedance-2-5",
    revanaId: "seedance-2.5",
    name: "Seedance 2.5",
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: SEEDANCE_RATIOS,
    durations: { min: 4, max: 30 },
    audio: true,
    maxRefImages: 30,
    maxRefVideos: 10,
    maxRefAudios: 10,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: { "480p": 0.11, "720p": 0.25, "1080p": 0.55 },
  },
  {
    heliosId: "seedance-2-5-edit",
    revanaId: "seedance-2.5",
    name: "Seedance 2.5 Edit",
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["adaptive"],
    durations: { min: 4, max: 30 },
    audio: true,
    maxRefImages: 0,
    lastFrame: false,
    videoEdit: true,
    pricePerSecond: { "480p": 0.06, "720p": 0.15, "1080p": 0.34 },
  },
  {
    heliosId: "seedance-2",
    revanaId: "seedance-2.0",
    name: "Seedance 2.0",
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: SEEDANCE_RATIOS,
    durations: { min: 4, max: 15 },
    audio: true,
    maxRefImages: 9,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: { "480p": 0.08, "720p": 0.15, "1080p": 0.4 },
  },
  {
    heliosId: "seedance-2-fast",
    revanaId: "seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    resolutions: ["480p", "720p"],
    aspectRatios: SEEDANCE_RATIOS,
    durations: { min: 4, max: 15 },
    audio: true,
    maxRefImages: 9,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: { "480p": 0.05, "720p": 0.11 },
  },
  {
    heliosId: "seedance-2-mini",
    revanaId: "seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    resolutions: ["480p", "720p"],
    aspectRatios: SEEDANCE_RATIOS,
    durations: { min: 4, max: 15 },
    audio: true,
    maxRefImages: 9,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: { "480p": 0.03, "720p": 0.05 },
  },
  {
    heliosId: "kling-3.0",
    revanaId: "kling-3.0",
    name: "Kling 3.0",
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: [],
    durations: { min: 3, max: 15 },
    audio: true,
    maxRefImages: 0,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: {
      "720p": 0.09, "720p+audio": 0.13,
      "1080p": 0.12, "1080p+audio": 0.17,
      "4K": 0.42, "4K+audio": 0.42,
    },
  },
  {
    heliosId: "kling-3.0-turbo",
    revanaId: "kling-3.0-turbo",
    name: "Kling 3.0 Turbo",
    resolutions: ["720p", "1080p"],
    aspectRatios: [],
    durations: { min: 3, max: 15 },
    audio: false,
    maxRefImages: 0,
    lastFrame: false,
    videoEdit: false,
    pricePerSecond: { "720p": 0.12, "1080p": 0.15 },
  },
  {
    heliosId: "veo3",
    revanaId: "veo-3.1",
    name: "Veo 3.1",
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    audio: true,
    maxRefImages: 0,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: {
      "720p": 0.2, "720p+audio": 0.4,
      "1080p": 0.2, "1080p+audio": 0.4,
      "4K": 0.4, "4K+audio": 0.6,
    },
  },
  {
    heliosId: "veo3_fast",
    revanaId: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: ["16:9", "9:16", "Auto"],
    durations: [4, 6, 8],
    audio: true,
    maxRefImages: 3,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: {
      "720p": 0.08, "720p+audio": 0.1,
      "1080p": 0.1, "1080p+audio": 0.11,
      "4K": 0.25, "4K+audio": 0.29,
    },
  },
  {
    heliosId: "veo3_lite",
    revanaId: "veo-3.1-lite",
    name: "Veo 3.1 Lite",
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: ["16:9", "9:16", "Auto"],
    durations: [4, 6, 8],
    audio: true,
    maxRefImages: 3,
    lastFrame: true,
    videoEdit: false,
    pricePerSecond: { "720p": 0.05, "1080p": 0.06, "4K": 0.24 },
  },
];

const BY_HELIOS_ID = new Map(REVANA_MODELS.map((m) => [m.heliosId, m]));

export function getRevanaModel(heliosId: string): RevanaModel | undefined {
  return BY_HELIOS_ID.get(heliosId);
}

export function isRevanaModel(heliosId: string): boolean {
  return BY_HELIOS_ID.has(heliosId);
}

/**
 * Estimated USD cost of one clip, or null when the resolution has no price.
 * Pass `audio: true` when sound is on — some models (Kling 3.0, Veo 3.1) charge
 * a higher `"<resolution>+audio"` rate.
 */
export function estimateRevanaCost(
  heliosId: string,
  resolution: string,
  seconds: number,
  audio = false,
): number | null {
  const prices = BY_HELIOS_ID.get(heliosId)?.pricePerSecond;
  const price = (audio ? prices?.[`${resolution}+audio`] : undefined) ?? prices?.[resolution];
  return price == null ? null : Math.round(price * seconds * 100) / 100;
}

/** Task IDs minted for Revana jobs carry this prefix so the kie.ai poller skips them. */
export const REVANA_TASK_PREFIX = "revana-";

// ── Image models ──────────────────────────────────────────────────────────────
// Picture models on Revana (same POST /v1/generations, `input.image_urls` for
// edits / references). Source: https://revana.si/data/models.json + GET
// /v1/models, checked 2026-10-21 — all live. Revana has no "number of images"
// field; one request returns the model's output (usually one picture).

export interface RevanaImageModel {
  /**
   * HeliosGen model id. Matches the lib/modelConfig.ts IMAGE_MODELS id when
   * Kie.ai can run the same model, so a request can go to either backend.
   */
  heliosId: string;
  /** Revana model id sent as `model`. */
  revanaId: string;
  name: string;
  maker: string;
  /** Accepted `resolution` values, as Revana spells them ("1K", "2K", "4K"…). */
  resolutions: string[];
  defaultResolution: string;
  /** Accepted `aspect_ratio` values. */
  aspectRatios: string[];
  defaultAspectRatio: string;
  /** Max `input.image_urls` (references / pictures to edit). */
  maxInputImages: number;
  /** USD per output picture, keyed by resolution. */
  pricePerImage: Record<string, number>;
}

const GPT_IMAGE_RATIOS = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9", "5:2"];
const NANO_BANANA_PRO_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];

export const REVANA_IMAGE_MODELS: RevanaImageModel[] = [
  {
    heliosId: "gpt-image-2-5-flare",
    revanaId: "gpt-image-2.5-flare",
    name: "GPT Image 2.5 Flare",
    maker: "OpenAI",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: GPT_IMAGE_RATIOS,
    defaultAspectRatio: "3:4",
    maxInputImages: 16,
    pricePerImage: { "1K": 0.02, "2K": 0.02, "4K": 0.03 },
  },
  {
    heliosId: "gpt-image-2-5-sunburst",
    revanaId: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    maker: "OpenAI",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: GPT_IMAGE_RATIOS,
    defaultAspectRatio: "3:4",
    maxInputImages: 16,
    pricePerImage: { "1K": 0.02, "2K": 0.02, "4K": 0.03 },
  },
  {
    heliosId: "gpt-image-2",
    revanaId: "gpt-image-2",
    name: "GPT Image 2",
    maker: "OpenAI",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: GPT_IMAGE_RATIOS,
    defaultAspectRatio: "3:4",
    maxInputImages: 16,
    pricePerImage: { "1K": 0.02, "2K": 0.02, "4K": 0.03 },
  },
  {
    heliosId: "nano-banana-pro",
    revanaId: "nano-banana-pro",
    name: "Nano Banana Pro",
    maker: "Google",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: NANO_BANANA_PRO_RATIOS,
    defaultAspectRatio: "3:4",
    maxInputImages: 14,
    pricePerImage: { "1K": 0.04, "2K": 0.04, "4K": 0.04 },
  },
  {
    heliosId: "nano-banana-2",
    revanaId: "nano-banana-2",
    name: "Nano Banana 2",
    maker: "Google",
    resolutions: ["0.5K", "1K", "2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: [...NANO_BANANA_PRO_RATIOS, "1:4", "4:1", "1:8", "8:1"],
    defaultAspectRatio: "3:4",
    maxInputImages: 14,
    pricePerImage: { "0.5K": 0.07, "1K": 0.03, "2K": 0.03, "4K": 0.04 },
  },
  {
    heliosId: "seedream-5-pro",
    revanaId: "seedream-5.0-pro",
    name: "Seedream 5.0 Pro",
    maker: "ByteDance",
    resolutions: ["1K", "1.5K", "2K"],
    defaultResolution: "2K",
    aspectRatios: NANO_BANANA_PRO_RATIOS,
    defaultAspectRatio: "3:4",
    maxInputImages: 10,
    pricePerImage: { "1K": 0.04, "1.5K": 0.04, "2K": 0.04 },
  },
];

/** The Create page's default picture model. */
export const DEFAULT_REVANA_IMAGE_MODEL_ID = "gpt-image-2-5-flare";

// Looked up by HeliosGen id or by Revana id ("gpt-image-2-5-flare" or "gpt-image-2.5-flare").
const IMAGE_BY_ID = new Map<string, RevanaImageModel>(
  REVANA_IMAGE_MODELS.flatMap((m) => [[m.heliosId, m], [m.revanaId, m]] as [string, RevanaImageModel][]),
);

export function getRevanaImageModel(id: string): RevanaImageModel | undefined {
  return IMAGE_BY_ID.get(id);
}

export function isRevanaImageModel(id: string): boolean {
  return IMAGE_BY_ID.has(id);
}

/** Estimated USD for `count` pictures at `resolution`, or null when unpriced. */
export function estimateRevanaImageCost(id: string, resolution: string, count = 1): number | null {
  const prices = IMAGE_BY_ID.get(id)?.pricePerImage;
  const hit = prices && Object.entries(prices).find(([r]) => r.toLowerCase() === resolution.toLowerCase());
  return hit ? Math.round(hit[1] * count * 100) / 100 : null;
}
