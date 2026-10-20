/**
 * Revana (https://revana.si) video generation — one API key in front of many
 * providers. Server-side only: the key never reaches the browser.
 *
 *   buildRevanaVideoRequest  — HeliosGen inputs → Revana body, validated against
 *                              the model's entry in lib/revanaModels.ts (pure)
 *   buildRevanaImageRequest  — the same for picture models (REVANA_IMAGE_MODELS)
 *   rehostRevanaMedia        — local media → public https URLs (lib/mediaHost)
 *   submitRevanaVideo        — POST /v1/generations (any model, video or image)
 * lib/revanaPoller.ts then polls the job and settles it like a kie.ai job.
 *
 * API spec: https://revana.si/openapi.json
 */
import { randomUUID } from "node:crypto";
import { estimateRevanaCost, estimateRevanaImageCost, type RevanaImageModel, type RevanaModel } from "./revanaModels";
import { ensurePublicUrl, ensurePublicUrls } from "./mediaHost";

export const REVANA_API_BASE = "https://api.revana.si/v1";

// Upper bound for an edit (the result keeps the input clip's length, 4–30 s) —
// used only to cap `max_cost_usd`; Revana bills the real length.
const EDIT_MAX_SECONDS = 30;
// `max_cost_usd` = estimate × this, so a surprise price rise is refused (422,
// nothing charged) instead of silently billed.
const COST_HEADROOM = 1.25;
const REVANA_MAX_COST_CAP = 100; // the API's own maximum for max_cost_usd

export interface RevanaVideoOptions {
  prompt?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** The clip to edit (edit models only). */
  videoUrl?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  /** Tried when the requested resolution / ratio isn't offered on Revana. */
  defaultResolution?: string;
  defaultAspectRatio?: string;
  sound?: boolean;
}

export interface RevanaGenerationBody {
  model: string;
  input: Record<string, unknown>;
  max_cost_usd?: number;
}

export interface BuiltRevanaRequest {
  body: RevanaGenerationBody;
  /** Seconds requested; null for edits (the output keeps the clip's length). */
  duration: number | null;
  resolution: string;
  /** Null when the model takes no aspect ratio. */
  aspectRatio: string | null;
  audio: boolean;
  estimatedCostUsd: number | null;
}

/** A request Revana would refuse — shown to the user before anything is sent. */
export class RevanaInputError extends Error {}

/** A non-2xx answer from the Revana API, carrying a user-facing message. */
export class RevanaApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** User-facing text for a Revana error response. */
export function friendlyRevanaError(status: number, code?: string, message?: string): string {
  if (status === 401) return "Invalid Revana API key — update it in Settings → API Keys.";
  if (status === 402 || code === "insufficient_credits") return "Revana balance too low — top up at revana.si.";
  if (status === 429) return "Revana is busy, try again in a moment.";
  if (status === 422) return message || "Revana can't run this input.";
  if (status === 403) return message || "Revana refused the request — the account is paused or can't generate yet.";
  if (status === 503) {
    return code === "model_unavailable"
      ? message || "This model is down on Revana right now — try again later."
      : "Revana is busy, try again in a moment.";
  }
  return `Revana error ${status}${message ? `: ${message}` : ""}`;
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date), or null. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, (at - Date.now()) / 1000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pickOption(list: string[], wanted: (string | undefined)[]): string | undefined {
  for (const w of wanted) {
    if (!w) continue;
    const hit = list.find((v) => v.toLowerCase() === w.toLowerCase());
    if (hit) return hit;
  }
  return list[0];
}

function pickDuration(m: RevanaModel, requested: number | undefined): number {
  const want = requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : undefined;
  if (Array.isArray(m.durations)) {
    const options = [...m.durations].sort((a, b) => a - b);
    // No length asked for (Veo on Kie.ai is a fixed 8 s) → the longest.
    if (want === undefined) return options[options.length - 1];
    // Nearest allowed value; ties go to the longer one.
    return options.reduce((best, v) => (Math.abs(v - want) <= Math.abs(best - want) ? v : best));
  }
  const { min, max } = m.durations;
  return Math.min(max, Math.max(min, Math.round(want ?? 5)));
}

const clean = (urls: string[] | undefined) => [...new Set((urls ?? []).filter((u) => typeof u === "string" && u))];

/**
 * Build the POST /v1/generations body for one clip. Throws `RevanaInputError`
 * for inputs the model can't take on Revana (better than a silently dropped
 * reference on a paid generation).
 */
export function buildRevanaVideoRequest(m: RevanaModel, opts: RevanaVideoOptions): BuiltRevanaRequest {
  const prompt = (opts.prompt ?? "").trim();
  if (!prompt) throw new RevanaInputError("Revana needs a prompt — describe the video you want.");

  const start = opts.startFrameUrl || undefined;
  const end = opts.endFrameUrl || undefined;
  const refImages = clean(opts.referenceImageUrls);
  const refVideos = clean(opts.referenceVideoUrls);
  const refAudios = clean(opts.referenceAudioUrls);
  const runElsewhere = "remove them or run this model on Kie.ai (Settings → Video Models)";

  const input: Record<string, unknown> = { prompt };
  let duration: number | null = null;

  if (m.videoEdit) {
    const clips = clean([opts.videoUrl ?? "", ...refVideos]);
    if (clips.length === 0) throw new RevanaInputError(`${m.name} needs a video to edit.`);
    if (clips.length > 1) throw new RevanaInputError(`${m.name} on Revana edits a single clip — connect one video.`);
    if (start || end) throw new RevanaInputError(`${m.name} doesn't take start or end frames.`);
    if (refImages.length > 0 && !m.maxRefImages) {
      throw new RevanaInputError(`${m.name} on Revana doesn't take reference images — ${runElsewhere}.`);
    }
    if (refAudios.length > 0 && !m.maxRefAudios) {
      throw new RevanaInputError(`${m.name} on Revana doesn't take reference audio — ${runElsewhere}.`);
    }
    input.video_url = clips[0];
    if (refImages.length > 0) input.image_urls = refImages.slice(0, m.maxRefImages);
    if (refAudios.length > 0) input.audio_urls = refAudios.slice(0, m.maxRefAudios);
    // No `duration` — Revana refuses it with video_url; the result keeps the clip's length.
  } else {
    if (end && !start) throw new RevanaInputError("An end frame needs a start frame on Revana.");
    if (end && !m.lastFrame) {
      throw new RevanaInputError(`${m.name} on Revana takes a start frame only — remove the end frame or run it on Kie.ai.`);
    }
    if (start) {
      // `image_url` can't be combined with reference media. Reference images are
      // dropped when frames are set (same as on Kie.ai); clips/sounds can't be.
      if (refVideos.length > 0 || refAudios.length > 0) {
        throw new RevanaInputError("Revana can't combine a start frame with reference videos or audio — remove one or the other.");
      }
      input.image_url = start;
      if (end) input.end_image_url = end;
    } else {
      if (refImages.length > 0) {
        if (!m.maxRefImages) throw new RevanaInputError(`${m.name} on Revana doesn't take reference images — ${runElsewhere}.`);
        input.image_urls = refImages.slice(0, m.maxRefImages);
      }
      if (refVideos.length > 0) {
        if (!m.maxRefVideos) throw new RevanaInputError(`${m.name} on Revana doesn't take reference videos — ${runElsewhere}.`);
        input.video_urls = refVideos.slice(0, m.maxRefVideos);
      }
      if (refAudios.length > 0) {
        if (!m.maxRefAudios) throw new RevanaInputError(`${m.name} on Revana doesn't take reference audio — ${runElsewhere}.`);
        input.audio_urls = refAudios.slice(0, m.maxRefAudios);
      }
    }
    duration = pickDuration(m, opts.duration);
  }

  const resolution = pickOption(m.resolutions, [opts.resolution, opts.defaultResolution, "720p"])!;
  const aspectRatio =
    m.aspectRatios.length > 0
      ? pickOption(m.aspectRatios, [opts.aspectRatio, opts.defaultAspectRatio, "16:9"])!
      : null;
  const audio = m.audio && !!opts.sound;

  input.resolution = resolution;
  if (aspectRatio) input.aspect_ratio = aspectRatio;
  if (duration !== null) input.duration = duration;
  if (m.audio) input.audio = audio;

  const estimatedCostUsd = estimateRevanaCost(m.heliosId, resolution, duration ?? EDIT_MAX_SECONDS, audio);
  const body: RevanaGenerationBody = { model: m.revanaId, input };
  if (estimatedCostUsd !== null && estimatedCostUsd > 0) {
    body.max_cost_usd = Math.min(REVANA_MAX_COST_CAP, Math.ceil(estimatedCostUsd * COST_HEADROOM * 100 - 1e-9) / 100);
  }

  return { body, duration, resolution, aspectRatio, audio, estimatedCostUsd };
}

// ── Images ────────────────────────────────────────────────────────────────────

export interface RevanaImageOptions {
  prompt?: string;
  /** References / pictures to edit (`input.image_urls`). */
  imageUrls?: string[];
  /** "2K" or "2k" — matched case-insensitively against the model's list. */
  resolution?: string;
  aspectRatio?: string;
}

export interface BuiltRevanaImageRequest {
  body: RevanaGenerationBody;
  resolution: string;
  aspectRatio: string;
  /** Local references in the order sent (before rehosting). */
  imageUrls: string[];
  estimatedCostUsd: number | null;
}

const REVANA_PROMPT_MAX = 30_000;

/**
 * Build the POST /v1/generations body for one picture. Throws
 * `RevanaInputError` for inputs the model can't take.
 */
export function buildRevanaImageRequest(m: RevanaImageModel, opts: RevanaImageOptions): BuiltRevanaImageRequest {
  const prompt = (opts.prompt ?? "").trim().slice(0, REVANA_PROMPT_MAX);
  if (!prompt) throw new RevanaInputError("Revana needs a prompt — describe the picture you want.");

  const imageUrls = clean(opts.imageUrls);
  if (imageUrls.length > m.maxInputImages) {
    throw new RevanaInputError(`${m.name} takes up to ${m.maxInputImages} reference images on Revana — remove ${imageUrls.length - m.maxInputImages}.`);
  }

  const resolution = pickOption(m.resolutions, [opts.resolution, m.defaultResolution])!;
  const aspectRatio = pickOption(m.aspectRatios, [opts.aspectRatio, m.defaultAspectRatio])!;
  const input: Record<string, unknown> = { prompt, resolution, aspect_ratio: aspectRatio };
  if (imageUrls.length > 0) input.image_urls = imageUrls;

  const estimatedCostUsd = estimateRevanaImageCost(m.heliosId, resolution);
  const body: RevanaGenerationBody = { model: m.revanaId, input };
  if (estimatedCostUsd !== null && estimatedCostUsd > 0) {
    // Cents-sized prices leave a 25 % margin almost no room — allow at least 2¢ more.
    const cap = Math.max(estimatedCostUsd * COST_HEADROOM, estimatedCostUsd + 0.02);
    body.max_cost_usd = Math.min(REVANA_MAX_COST_CAP, Math.ceil(cap * 100 - 1e-9) / 100);
  }
  return { body, resolution, aspectRatio, imageUrls, estimatedCostUsd };
}

const SINGLE_MEDIA_KEYS = ["image_url", "end_image_url", "video_url"] as const;
const LIST_MEDIA_KEYS = ["image_urls", "video_urls", "audio_urls"] as const;

/**
 * Swap every local / non-https media reference in a built `input` for a public
 * https URL (mutates in place). Throws `MediaHostError` (lib/mediaHost.ts).
 */
export async function rehostRevanaMedia(input: Record<string, unknown>, kieApiKey: string | null): Promise<void> {
  await Promise.all([
    ...SINGLE_MEDIA_KEYS.map(async (k) => {
      if (typeof input[k] === "string") input[k] = await ensurePublicUrl(input[k] as string, kieApiKey);
    }),
    ...LIST_MEDIA_KEYS.map(async (k) => {
      if (Array.isArray(input[k])) input[k] = await ensurePublicUrls(input[k] as string[], kieApiKey);
    }),
  ]);
}

/**
 * Submit one generation. Retries transient failures (network, 500, 503 busy,
 * 429 rate_limited with a short Retry-After) under the same Idempotency-Key, so
 * a retry can never start a second paid job. Throws `RevanaApiError`.
 */
export async function submitRevanaVideo(
  apiKey: string,
  body: RevanaGenerationBody,
): Promise<{ id: string; quotedUsd: number | null }> {
  const idempotencyKey = `heliosgen-${randomUUID()}`;
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${REVANA_API_BASE}/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(2_000);
        continue;
      }
      throw new RevanaApiError(`Couldn't reach Revana: ${(e as Error).message}`, 502);
    }

    const json = (await res.json().catch(() => null)) as {
      id?: string;
      quoted_usd?: number;
      error?: { code?: string; message?: string };
    } | null;

    if (res.ok) {
      if (!json?.id) throw new RevanaApiError("Revana accepted the job but returned no generation id.", 502);
      return { id: json.id, quotedUsd: typeof json.quoted_usd === "number" ? json.quoted_usd : null };
    }

    const code = json?.error?.code;
    const message = json?.error?.message;
    const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 2;
    const transient =
      res.status === 500 ||
      (res.status === 503 && code !== "model_unavailable") ||
      (res.status === 429 && code === "rate_limited");
    if (transient && attempt < MAX_ATTEMPTS && wait <= 10) {
      await sleep(wait * 1000);
      continue;
    }

    console.error("[revana] submit failed:", res.status, code, message);
    throw new RevanaApiError(friendlyRevanaError(res.status, code, message), res.status, code);
  }
}
