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
