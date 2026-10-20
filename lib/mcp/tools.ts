/**
 * The CactusGen MCP tools (served by app/api/mcp). Generation tools reuse the
 * app's own routes — app/api/generate-video and app/api/generate are called
 * in-process — so validation, provider code, the job poller and the history
 * rows are exactly the ones the Create page uses, and every MCP generation
 * shows up in the app like any other.
 */
import { NextRequest } from "next/server";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import {
  REVANA_IMAGE_MODELS,
  estimateRevanaCost,
  estimateRevanaImageCost,
  getRevanaModel,
} from "@/lib/revanaModels";
import { effectiveProvider, getCaps, normalizeDuration, type ModelCaps } from "@/components/create/modelCaps";
import { effectiveImageProvider, getImageCaps, imageModelExists, type ImageCaps } from "@/components/create/imageCaps";
import { savedBackendKeys, type Backend } from "@/lib/providerRouting";
import { jobStore, type JobResult } from "@/lib/jobStore";
import { resumeKieJob } from "@/lib/kieJobPoller";
import { resumeRevanaJob } from "@/lib/revanaPoller";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { POST as generateVideoRoute } from "@/app/api/generate-video/route";
import { POST as generateImageRoute } from "@/app/api/generate/route";
import { MediaInputError, importMediaInput, importMediaList, localPathOf } from "./media";

export interface ToolContext {
  /** This server's origin, e.g. http://127.0.0.1:41730 — for app URLs in results. */
  origin: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** A tool failure the caller should see as text (isError: true), not a protocol error. */
export class ToolError extends Error {}

const DEFAULT_VIDEO_MODEL = "seedance-2-5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2-5-flare";
/** Edits keep the input clip's length (4–30 s); estimates assume the longest. */
const EDIT_PRICE_SECONDS = 30;
const MAX_WAIT_SECONDS = 50;

// ── Definitions ───────────────────────────────────────────────────────────────

const kindSchema = { type: "string", enum: ["video", "image"], description: "\"video\" or \"image\"." };
const providerSchema = {
  type: "string",
  enum: ["kie", "revana"],
  description: "Backend to run on: \"revana\" (pay per output, priced up front) or \"kie\" (Kie.ai credits). Default: video → Kie.ai unless Revana is the only key saved; image → Revana unless only a Kie.ai key is saved. list_models shows which backends work.",
};
const mediaInput = (what: string) => ({
  type: "string",
  description: `${what}: an absolute local file path (e.g. C:\\\\Users\\\\me\\\\shot.png), an https URL, a data: URL, or a CactusGen library URL (/generated/…). Local files and data: URLs are imported into the CactusGen library.`,
});

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_models",
    title: "List models",
    description: "List CactusGen's video or image models: ids, names, durations, resolutions, aspect ratios, sound, which inputs each takes (start/end frame, reference images/videos/audio), price per second (video) or per image on Revana, and which backends (Kie.ai / Revana) work with the API keys saved in CactusGen. Call this before generate_video / generate_image to pick a model and valid settings.",
    inputSchema: {
      type: "object",
      properties: { kind: kindSchema },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "estimate_cost",
    title: "Estimate cost",
    description: "Estimate the USD cost of one generation before running it. Revana prices are known up front (video: per second of output, by resolution and sound; image: per picture). Kie.ai bills from your Kie.ai credit and has no price here (returns null).",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model id from list_models, e.g. \"seedance-2-5\" or \"gpt-image-2-5-flare\"." },
        kind: kindSchema,
        resolution: { type: "string", description: "e.g. \"720p\" (video) or \"2K\" (image). Default: the model's default." },
        duration: { type: "integer", minimum: 1, description: "Video length in seconds. Default: the model's default." },
        sound: { type: "boolean", description: "Video: generate audio (some models cost more with sound)." },
        provider: providerSchema,
      },
      required: ["model", "kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "generate_video",
    title: "Generate a video",
    description: [
      "Start a paid video generation in CactusGen (Seedance 2.5 by default) and return its task_id at once; poll get_job for the result.",
      "Write the prompt as a cinematic shot list (\"Shot 1 (0–3s): …\") with camera moves, light, action and, when sound is on, a \"Sound:\" line.",
      "Reference media are mentioned in the prompt by tag in the order given: @image1, @image2 … for reference_images, @video1 … for reference_videos, @audio1 … for reference_audios (e.g. \"the woman from @image1 walks into the kitchen from @image2\").",
      "A start frame (start_image, optionally end_image) cannot be combined with reference media — use one or the other; @ tags only apply to references.",
      "Seedance 2.5 Edit (\"seedance-2-5-edit\") changes an input_video instead.",
      "Use estimate_cost first when the price matters; dry_run builds the request without sending it (free).",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: `Video model id from list_models. Default "${DEFAULT_VIDEO_MODEL}".` },
        prompt: { type: "string", description: "What to film. Mention reference media as @image1 / @video1 / @audio1." },
        start_image: mediaInput("Start frame image"),
        end_image: mediaInput("End frame image (needs start_image)"),
        reference_images: { type: "array", items: mediaInput("Reference image"), description: "Reference images, mentioned in the prompt as @image1, @image2 … in this order." },
        reference_videos: { type: "array", items: mediaInput("Reference video"), description: "Reference clips (Seedance 2.5), mentioned as @video1 …" },
        reference_audios: { type: "array", items: mediaInput("Reference audio"), description: "Reference sounds (Seedance 2.5), mentioned as @audio1 …" },
        input_video: mediaInput("The clip to edit (edit models such as seedance-2-5-edit only)"),
        duration: { type: "integer", minimum: 1, description: "Seconds (snapped to what the model allows). Default: the model's default." },
        resolution: { type: "string", description: "e.g. \"480p\", \"720p\", \"1080p\". Default: the model's default." },
        aspect_ratio: { type: "string", description: "e.g. \"16:9\", \"9:16\", \"1:1\", \"adaptive\". Default: the model's default." },
        sound: { type: "boolean", description: "Generate audio with the clip (models with sound only). Default false." },
        provider: providerSchema,
        dry_run: { type: "boolean", description: "Build and validate the request but do not send it (no cost). Returns the request that would be sent." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "generate_image",
    title: "Generate an image",
    description: [
      "Start a paid image generation in CactusGen (GPT Image 2.5 Flare by default) and return its task_id; poll get_job for the result.",
      "Reference images are mentioned in the prompt as @image1, @image2 … in the order given (e.g. \"put the bottle from @image1 on the table from @image2\").",
      "dry_run builds the request without sending it (free).",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: `Image model id from list_models. Default "${DEFAULT_IMAGE_MODEL}".` },
        prompt: { type: "string", description: "The picture to make. Mention reference images as @image1 …" },
        reference_images: { type: "array", items: mediaInput("Reference image"), description: "Pictures to edit, combine or match, as @image1, @image2 … in this order." },
        resolution: { type: "string", description: "e.g. \"1K\", \"2K\", \"4K\". Default: the model's default." },
        aspect_ratio: { type: "string", description: "e.g. \"3:4\", \"1:1\", \"16:9\". Default: the model's default." },
        provider: providerSchema,
        dry_run: { type: "boolean", description: "Build and validate the request but do not send it (no cost)." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "get_job",
    title: "Get a job",
    description: "Status of a generation started with generate_video / generate_image (or in the app): \"pending\", \"done\" or \"error\". When done, lists the output files as absolute paths on this computer plus their CactusGen URLs. wait_seconds (≤ 50) waits for the job to finish before answering — videos usually take 1–10 minutes, so call again while it's pending.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task_id a generate tool returned." },
        wait_seconds: { type: "integer", minimum: 0, maximum: MAX_WAIT_SECONDS, description: "Wait up to this long for the job to settle. Default 0." },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_history",
    title: "List history",
    description: "The newest video or image generations in CactusGen (from the app and from MCP), newest first: task_id, status, model, prompt, time, and output file paths for finished ones.",
    inputSchema: {
      type: "object",
      properties: {
        kind: kindSchema,
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 20, max 50)." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// ── Argument helpers ──────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

const optString = (a: Args, k: string): string | undefined => {
  const v = a[k];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ToolError(`${k} must be a string.`);
  return v.trim() || undefined;
};
const optBool = (a: Args, k: string): boolean | undefined => {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new ToolError(`${k} must be true or false.`);
  return v;
};
const optInt = (a: Args, k: string): number | undefined => {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolError(`${k} must be a number.`);
  return Math.round(n);
};
const kindArg = (a: Args): "video" | "image" => {
  const v = a.kind ?? "video";
  if (v !== "video" && v !== "image") throw new ToolError("kind must be \"video\" or \"image\".");
  return v;
};
const providerArg = (a: Args): Backend | undefined => {
  const v = optString(a, "provider");
  if (v === undefined) return undefined;
  if (v !== "kie" && v !== "revana") throw new ToolError("provider must be \"kie\" or \"revana\".");
  return v;
};

function pick(list: string[], wanted: string | undefined, fallback: string, field: string): string {
  if (wanted === undefined) return fallback;
  const hit = list.find((x) => x.toLowerCase() === wanted.toLowerCase());
  if (!hit) throw new ToolError(`${field} "${wanted}" isn't offered here. Choose one of: ${list.join(", ")}.`);
  return hit;
}

// ── Model descriptions ────────────────────────────────────────────────────────

function durationInfo(c: ModelCaps): unknown {
  const d = c.duration;
  if (d.kind === "range") return { min_seconds: d.min, max_seconds: d.max };
  if (d.kind === "list") return { seconds: d.values };
  return c.video ? "keeps the input clip's length" : c.isVeo ? { seconds: [8] } : "set by the model";
}

function videoCapsSummary(c: ModelCaps) {
  return {
    durations: durationInfo(c),
    default_duration: c.duration.kind === "none" ? null : c.defaultDuration,
    resolutions: c.resolutions.map((r) => r.value),
    default_resolution: c.defaultResolution,
    aspect_ratios: c.ratios,
    default_aspect_ratio: c.ratios.length ? c.defaultRatio : null,
    sound: c.sound,
    start_frame: c.startFrame,
    end_frame: c.endFrame,
    max_reference_images: c.maxRefs,
    max_reference_videos: c.maxRefVideos,
    max_reference_audios: c.maxRefAudios,
    edits_input_video: !!c.video && !c.isMotionControl,
    ...(c.isMotionControl ? { motion_control: "needs start_image (character) + input_video (motion)" } : {}),
    prompt_max_length: c.promptMaxLength,
  };
}

function imageCapsSummary(c: ImageCaps) {
  return {
    resolutions: c.resolutions,
    default_resolution: c.defaultResolution,
    aspect_ratios: c.ratios,
    default_aspect_ratio: c.defaultRatio,
    max_reference_images: c.maxRefs,
    prompt_max_length: c.promptMaxLength,
  };
}

async function listModels(a: Args) {
  const kind = kindArg(a);
  const keys = await savedBackendKeys();
  if (kind === "video") {
    const models = VIDEO_MODELS.map((m) => {
      const rm = getRevanaModel(m.id);
      const def = effectiveProvider(m.id, undefined, keys);
      return {
        id: m.id,
        name: m.name,
        maker: m.provider,
        default_backend: def,
        backends: {
          kie: { works_with_saved_keys: keys.kie, price: "Kie.ai credits (not priced here)", ...videoCapsSummary(getCaps(m.id, "kie")) },
          ...(rm
            ? { revana: { works_with_saved_keys: keys.revana, price_per_second_usd: rm.pricePerSecond, ...videoCapsSummary(getCaps(m.id, "revana")) } }
            : {}),
        },
      };
    });
    return { kind, saved_keys: keys, default_model: DEFAULT_VIDEO_MODEL, models };
  }
  const models = REVANA_IMAGE_MODELS.map((m) => {
    const kieCaps = getImageCaps(m.heliosId, "kie");
    const def = effectiveImageProvider(m.heliosId, undefined, keys);
    return {
      id: m.heliosId,
      name: m.name,
      maker: m.maker,
      default_backend: def,
      backends: {
        revana: { works_with_saved_keys: keys.revana, price_per_image_usd: m.pricePerImage, ...imageCapsSummary(getImageCaps(m.heliosId, "revana")) },
        ...(kieCaps.provider === "kie"
          ? { kie: { works_with_saved_keys: keys.kie, price: "Kie.ai credits (not priced here)", ...imageCapsSummary(kieCaps) } }
          : {}),
      },
    };
  });
  return { kind, saved_keys: keys, default_model: DEFAULT_IMAGE_MODEL, models };
}

function videoModelOrThrow(id: string) {
  if (!VIDEO_MODELS.some((m) => m.id === id)) {
    throw new ToolError(`Unknown video model "${id}". Call list_models with kind "video" for the ids.`);
  }
}

function imageModelOrThrow(id: string) {
  if (!imageModelExists(id)) {
    throw new ToolError(`Unknown image model "${id}". Call list_models with kind "image" for the ids.`);
  }
}

async function videoBackend(model: string, requested: Backend | undefined): Promise<Backend> {
  if (requested === "revana" && !getRevanaModel(model)) throw new ToolError(`${model} doesn't run on Revana — use provider "kie".`);
  return requested ?? effectiveProvider(model, undefined, await savedBackendKeys());
}

async function imageBackend(model: string, requested: Backend | undefined): Promise<Backend> {
  const caps = getImageCaps(model, "kie");
  if (requested === "kie" && caps.provider !== "kie") throw new ToolError(`${model} doesn't run on Kie.ai — use provider "revana".`);
  return requested ?? effectiveImageProvider(model, undefined, await savedBackendKeys());
}

async function estimateCost(a: Args) {
  const kind = kindArg(a);
  const model = optString(a, "model");
  if (!model) throw new ToolError("model is required.");
  const provider = providerArg(a);
  if (kind === "video") {
    videoModelOrThrow(model);
    const backend = await videoBackend(model, provider);
    const caps = getCaps(model, backend);
    const resolution = pick(caps.resolutions.map((r) => r.value), optString(a, "resolution"), caps.defaultResolution, "resolution");
    const isEdit = caps.duration.kind === "none" && !!caps.video;
    const seconds = isEdit ? EDIT_PRICE_SECONDS : normalizeDuration(caps.duration, optInt(a, "duration") ?? caps.defaultDuration);
    const sound = caps.sound && !!optBool(a, "sound");
    const usd = backend === "revana" ? estimateRevanaCost(model, resolution, seconds > 0 ? seconds : 8, sound) : null;
    return {
      model, kind, provider: backend, resolution, duration_seconds: seconds > 0 ? seconds : null, sound,
      estimated_cost_usd: usd,
      note: backend === "revana"
        ? isEdit ? "Edits bill the input clip's real length; this is the 30 s maximum." : "Revana price, charged per second of output."
        : "Kie.ai bills from your Kie.ai credit; the price isn't known here.",
    };
  }
  imageModelOrThrow(model);
  const backend = await imageBackend(model, provider);
  const caps = getImageCaps(model, backend);
  const resolution = pick(caps.resolutions, optString(a, "resolution"), caps.defaultResolution, "resolution");
  const usd = backend === "revana" ? estimateRevanaImageCost(model, resolution) : null;
  return {
    model, kind, provider: backend, resolution,
    estimated_cost_usd: usd,
    note: backend === "revana" ? "Revana price per picture." : "Kie.ai bills from your Kie.ai credit; the price isn't known here.",
  };
}

// ── Generate ──────────────────────────────────────────────────────────────────

async function callRoute(
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await handler(new NextRequest(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

async function generateVideo(a: Args) {
  const model = optString(a, "model") ?? DEFAULT_VIDEO_MODEL;
  videoModelOrThrow(model);
  const prompt = optString(a, "prompt");
  if (!prompt) throw new ToolError("prompt is required.");
  const provider = await videoBackend(model, providerArg(a));
  const caps = getCaps(model, provider);
  if (caps.promptMaxLength && prompt.length > caps.promptMaxLength) {
    throw new ToolError(`The prompt is ${prompt.length} characters; ${caps.name} takes up to ${caps.promptMaxLength}.`);
  }

  const has = (k: string) => a[k] !== undefined && a[k] !== null && !(Array.isArray(a[k]) && (a[k] as unknown[]).length === 0);
  const usesFrames = has("start_image") || has("end_image");
  const usesRefs = has("reference_images") || has("reference_videos") || has("reference_audios");
  if (usesFrames && usesRefs) {
    throw new ToolError("A start/end frame can't be combined with reference media (Seedance/Revana rule). Use start_image (+ end_image) or reference_* — not both.");
  }
  if (has("start_image") && !caps.startFrame) throw new ToolError(`${caps.name} doesn't take a start frame.`);
  if (has("end_image") && !caps.endFrame) throw new ToolError(`${caps.name} doesn't take an end frame.`);
  if (has("end_image") && !has("start_image") && provider === "revana") throw new ToolError("On Revana an end frame needs a start frame too.");
  if (has("input_video") && !caps.video) throw new ToolError(`${caps.name} doesn't take an input video.`);
  if (caps.video?.required && !has("input_video")) {
    throw new ToolError(caps.isMotionControl ? `${caps.name} needs input_video (the motion) and start_image (the character).` : `${caps.name} edits a clip — pass input_video.`);
  }
  if (caps.requiresStartFrame && !has("start_image")) throw new ToolError(`${caps.name} needs start_image.`);
  const limit = (field: string, max: number, noun: string) => {
    const n = Array.isArray(a[field]) ? (a[field] as unknown[]).length : 0;
    if (n > max) throw new ToolError(max === 0 ? `${caps.name} takes no ${noun} on ${provider === "revana" ? "Revana" : "Kie.ai"}.` : `${caps.name} takes up to ${max} ${noun}.`);
  };
  limit("reference_images", caps.maxRefs, "reference images");
  limit("reference_videos", caps.maxRefVideos, "reference videos");
  limit("reference_audios", caps.maxRefAudios, "reference audio files");
  if (caps.requiresRefs && !has("reference_images")) throw new ToolError(`${caps.name} needs at least one reference image.`);

  const resOpt = (() => {
    const wanted = optString(a, "resolution");
    const values = caps.resolutions.map((r) => r.value);
    const value = pick(values, wanted, caps.defaultResolution, "resolution");
    return caps.resolutions.find((r) => r.value === value);
  })();
  const resolution = resOpt?.value ?? caps.defaultResolution;
  const aspectRatio = caps.ratios.length ? pick(caps.ratios, optString(a, "aspect_ratio"), caps.defaultRatio, "aspect_ratio") : undefined;
  const duration = normalizeDuration(caps.duration, optInt(a, "duration") ?? caps.defaultDuration);
  const sound = caps.sound && !!optBool(a, "sound");
  const dryRun = !!optBool(a, "dry_run");

  const [start, end, refs, refVideos, refAudios, inputVideo] = await Promise.all([
    has("start_image") ? importMediaInput(a.start_image, "image", "start_image") : undefined,
    has("end_image") ? importMediaInput(a.end_image, "image", "end_image") : undefined,
    importMediaList(a.reference_images, "image", "reference_images", 60),
    importMediaList(a.reference_videos, "video", "reference_videos", 20),
    importMediaList(a.reference_audios, "audio", "reference_audios", 20),
    has("input_video") ? importMediaInput(a.input_video, "video", "input_video") : undefined,
  ]);

  // Same body the Create page sends (components/create/useCreateJobs buildRequestBody).
  const editClip = inputVideo && caps.video?.key === "referenceVideo" ? [inputVideo] : [];
  const isVeo = !!VIDEO_MODELS.find((m) => m.id === model)?.apiInput.useGoogleVeo;
  const body: Record<string, unknown> = {
    model,
    videoModel: model,
    prompt,
    ...(start ? { startFrameUrl: start } : {}),
    ...(end ? { endFrameUrl: end } : {}),
    ...(refs.length ? { referenceImageUrls: refs } : {}),
    ...(inputVideo ? { videoRefUrl: inputVideo } : {}),
    ...(editClip.length || refVideos.length ? { referenceVideoUrls: [...editClip, ...refVideos] } : {}),
    ...(refAudios.length ? { referenceAudioUrls: refAudios } : {}),
    duration,
    resolution,
    ...(aspectRatio ? { aspectRatio } : {}),
    sound,
    provider,
    ...(resOpt?.mode ? { mode: resOpt.mode } : {}),
    ...(isVeo && refs.length ? { veoMode: "references" } : {}),
    ...(dryRun ? { debugOnly: true } : {}),
  };

  const isEdit = caps.duration.kind === "none" && !!caps.video;
  const estimated = provider === "revana"
    ? estimateRevanaCost(model, resolution, isEdit ? EDIT_PRICE_SECONDS : duration > 0 ? duration : 8, sound)
    : null;

  const { status, data } = await callRoute(generateVideoRoute, "/api/generate-video", body);
  if (dryRun) {
    if (status >= 400 || data.error) throw new ToolError(String(data.error ?? `The request was refused (${status}).`));
    return { dry_run: true, sent: false, model, provider, estimated_cost_usd: estimated, endpoint: data.debugEndpoint, request: data.debugPayload };
  }
  if (status >= 400 || data.error || typeof data.taskId !== "string") {
    throw new ToolError(String(data.error ?? `Generation failed to start (${status}).`));
  }
  return {
    task_id: data.taskId,
    status: "pending",
    estimated_cost_usd: estimated,
    model,
    provider,
    settings: { duration_seconds: duration > 0 ? duration : null, resolution, aspect_ratio: aspectRatio ?? null, sound },
    next: "Call get_job with this task_id (wait_seconds up to 50) until status is done.",
  };
}

async function generateImage(a: Args) {
  const model = optString(a, "model") ?? DEFAULT_IMAGE_MODEL;
  imageModelOrThrow(model);
  const prompt = optString(a, "prompt");
  if (!prompt) throw new ToolError("prompt is required.");
  const provider = await imageBackend(model, providerArg(a));
  const caps = getImageCaps(model, provider);
  if (prompt.length > caps.promptMaxLength) throw new ToolError(`The prompt is ${prompt.length} characters; ${caps.name} takes up to ${caps.promptMaxLength}.`);
  const count = Array.isArray(a.reference_images) ? a.reference_images.length : 0;
  if (count > caps.maxRefs) throw new ToolError(`${caps.name} takes up to ${caps.maxRefs} reference images here.`);
  const resolution = pick(caps.resolutions, optString(a, "resolution"), caps.defaultResolution, "resolution");
  const aspectRatio = pick(caps.ratios, optString(a, "aspect_ratio"), caps.defaultRatio, "aspect_ratio");
  const dryRun = !!optBool(a, "dry_run");
  const refs = await importMediaList(a.reference_images, "image", "reference_images", caps.maxRefs);

  // Same body the Create page sends (buildImageRequestBody).
  const body: Record<string, unknown> = {
    model,
    prompt,
    imageUrls: refs,
    aspectRatio,
    resolution,
    quality: resolution.toLowerCase(),
    provider,
    ...(dryRun ? { debugOnly: true } : {}),
  };
  const estimated = provider === "revana" ? estimateRevanaImageCost(model, resolution) : null;

  const { status, data } = await callRoute(generateImageRoute, "/api/generate", body);
  if (dryRun) {
    if (status >= 400 || data.error) throw new ToolError(String(data.error ?? `The request was refused (${status}).`));
    return { dry_run: true, sent: false, model, provider, estimated_cost_usd: estimated, endpoint: data.debugEndpoint ?? null, request: data.debugPayload ?? body };
  }
  if (status >= 400 || data.error || typeof data.taskId !== "string") {
    throw new ToolError(String(data.error ?? `Generation failed to start (${status}).`));
  }
  return {
    task_id: data.taskId,
    status: "pending",
    estimated_cost_usd: estimated,
    model,
    provider,
    settings: { resolution, aspect_ratio: aspectRatio },
    next: "Call get_job with this task_id (wait_seconds up to 50) until status is done.",
  };
}

// ── Jobs + history ────────────────────────────────────────────────────────────

function files(urls: string[], origin: string) {
  return urls.map((u) => ({
    path: localPathOf(u),
    url: u.startsWith("/") ? `${origin}${u}` : u,
  }));
}

function resultUrls(r: Extract<JobResult, { status: "done" }>): string[] {
  if (r.videoUrl) return [r.videoUrl];
  return [...new Set((r.imageUrls?.length ? r.imageUrls : r.imageUrl ? [r.imageUrl] : []).filter(Boolean))];
}

function genUrls(g: guestDb.Generation): string[] {
  if (g.video_url) return [g.video_url];
  return [...new Set((g.image_urls?.length ? g.image_urls : g.image_url ? [g.image_url] : []).filter(Boolean))];
}

/** jobStore first (live), then the DB row (after a restart). Restarts lost pollers. */
function readJob(taskId: string): { result: JobResult | null; gen: guestDb.Generation | null } {
  const gen = guestDb.getGeneration(taskId);
  let result = jobStore.get(taskId) ?? null;
  if (!result && gen) {
    result = gen.status === "done"
      ? { status: "done", videoUrl: gen.video_url, imageUrl: gen.image_url, imageUrls: gen.image_urls }
      : gen.status === "error"
        ? { status: "error", error: gen.error_msg ?? "Generation failed" }
        : { status: "pending" };
  }
  if (result?.status === "pending" && !taskId.startsWith("azure-") && !taskId.startsWith("codex-")) {
    const kind = gen?.generation_type === "image" || result.type === "image" ? "image" : "video";
    resumeKieJob(taskId, kind);
    resumeRevanaJob(taskId, kind);
  }
  return { result, gen };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJob(a: Args, ctx: ToolContext, signal?: AbortSignal) {
  const taskId = optString(a, "task_id");
  if (!taskId) throw new ToolError("task_id is required.");
  const wait = Math.max(0, Math.min(MAX_WAIT_SECONDS, optInt(a, "wait_seconds") ?? 0));
  const deadline = Date.now() + wait * 1000;
  let { result, gen } = readJob(taskId);
  while (result?.status === "pending" && Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
    ({ result, gen } = readJob(taskId));
  }
  if (!result) throw new ToolError(`No job with task_id "${taskId}".`);
  const base = {
    task_id: taskId,
    kind: gen?.generation_type ?? (result.status === "pending" ? result.type : undefined) ?? null,
    model: gen?.model ?? null,
    prompt: gen?.prompt ?? null,
    created_at: gen?.created_at ?? null,
  };
  if (result.status === "done") return { ...base, status: "done", files: files(resultUrls(result), ctx.origin) };
  if (result.status === "error") return { ...base, status: "error", error: result.error };
  return { ...base, status: "pending", hint: "Still generating — call get_job again (wait_seconds up to 50)." };
}

async function listHistory(a: Args, ctx: ToolContext) {
  const kind = kindArg(a);
  const limit = Math.max(1, Math.min(50, optInt(a, "limit") ?? 20));
  const rows = guestDb.listGenerations(GUEST_USER_ID, kind, { limit });
  return {
    kind,
    items: rows.map((g) => ({
      task_id: g.task_id,
      status: g.status,
      model: g.model ?? null,
      prompt: g.prompt ? (g.prompt.length > 400 ? `${g.prompt.slice(0, 400)}…` : g.prompt) : null,
      created_at: g.created_at,
      ...(g.status === "done" ? { files: files(genUrls(g), ctx.origin) } : {}),
      ...(g.status === "error" && g.error_msg ? { error: g.error_msg } : {}),
    })),
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function callTool(name: string, args: Args, ctx: ToolContext, signal?: AbortSignal): Promise<unknown> {
  try {
    switch (name) {
      case "list_models": return await listModels(args);
      case "estimate_cost": return await estimateCost(args);
      case "generate_video": return await generateVideo(args);
      case "generate_image": return await generateImage(args);
      case "get_job": return await getJob(args, ctx, signal);
      case "list_history": return await listHistory(args, ctx);
    }
  } catch (e) {
    if (e instanceof MediaInputError) throw new ToolError(e.message);
    throw e;
  }
  throw new ToolError(`Unknown tool "${name}".`);
}

export function hasTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name);
}
