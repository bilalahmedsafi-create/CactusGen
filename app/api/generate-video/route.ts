import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { pollKieJob } from "@/lib/kieJobPoller";
import { rewriteLocalMediaForKie } from "@/lib/kieUpload";
import { ensureR2 } from "@/lib/storage";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import { getKieTokenForUser } from "@/lib/getKieToken";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { getRevanaModel, REVANA_TASK_PREFIX } from "@/lib/revanaModels";
import { resolveVideoProvider } from "@/lib/providerRouting";
import {
  REVANA_API_BASE,
  RevanaApiError,
  RevanaInputError,
  buildRevanaVideoRequest,
  rehostRevanaMedia,
  submitRevanaVideo,
  type BuiltRevanaRequest,
} from "@/lib/revana";
import { pollRevanaJob } from "@/lib/revanaPoller";
import { MediaHostError } from "@/lib/mediaHost";

const KIE_BASE = "https://api.kie.ai";

interface Resource {
  url: string;
  label: string;
}

interface KlingElementInput {
  name: string;
  description: string;
  imageUrls: string[];
}


export async function POST(req: NextRequest) {
  try {
  const body = await req.json();
  const {
    videoModel      = body.model || "kling-3.0",
    prompt,
    startFrameUrl:  rawStartFrame,
    endFrameUrl:    rawEndFrame,
    videoRefUrl:    rawVideoRef,
    resources       = [] as Resource[],
    klingElements   = [] as KlingElementInput[],
    referenceImageUrls:  rawRefImages     = body.imageUrls || [] as string[],
    referenceVideoUrls:  rawRefVideoUrls  = [] as string[],
    referenceAudioUrls:  rawRefAudioUrls  = [] as string[],
    sound           = false,
    duration        = 5,
    aspectRatio     = body.aspect_ratio || "16:9",
    mode            = "pro",
    resolution:     rawResolution,
    seed,
    veoMode,
    generationType: rawGenerationType,
    callBackUrl:    rawCallBackUrl,
    debugOnly       = false,
  } = body;

  const userId = GUEST_USER_ID;

  // Revana is resolved before the kie.ai key check — a Revana-only setup has no
  // kie.ai key at all.
  if ((await resolveVideoProvider(body.provider, videoModel)) === "revana") {
    return await generateWithRevana(body, videoModel, userId, Boolean(debugOnly));
  }

  const apiKey = (await getKieTokenForUser()) ?? process.env.KIE_API_TOKEN ?? null;
  // A dry run (debugOnly) only builds the request, so it needs no key.
  if (!apiKey && !debugOnly) return NextResponse.json({ error: "No Kie.ai API key configured. Add one in Settings." }, { status: 401 });

  // The app polls kie.ai directly (lib/kieJobPoller) — no callback URL needed.
  const callBackUrl = rawCallBackUrl || undefined;

  const cfg = VIDEO_MODELS.find((m) => m.id === videoModel);
  if (!cfg) return NextResponse.json({ error: `Unknown video model: ${videoModel}` }, { status: 400 });

  const resolution = rawResolution || cfg.defaultResolution || "480p";
  const { apiInput } = cfg;
  const isSeedance25EditModel = cfg.id === "seedance-2-5-edit";
  const effectiveAspectRatio = isSeedance25EditModel ? "adaptive" : aspectRatio;

  // Clamp duration to model limits (motion-control has no duration field)
  const clampedDuration = isSeedance25EditModel
    ? -1
    : apiInput.durationMax > 0
    ? Math.max(apiInput.durationMin, Math.min(apiInput.durationMax, Number(duration)))
    : 0;

  let input: Record<string, unknown>;
  let effectiveApiId = cfg.apiId;

  if (apiInput.useMotionControl) {
    // ── Kling 2.6 motion control ──────────────────────────────────────────────
    // { prompt, input_urls, video_urls, mode, character_orientation }
    const [inputImageUrl, inputVideoUrl] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawVideoRef   ? ensureR2(rawVideoRef,   "references").catch(() => rawVideoRef)   : Promise.resolve(undefined),
    ]);

    input = {
      prompt:                prompt ?? "",
      input_urls:            inputImageUrl ? [inputImageUrl] : [],
      video_urls:            inputVideoUrl ? [inputVideoUrl] : [],
      mode:                  resolution,   // "720p" or "1080p"
      character_orientation: mode,         // "image" or "video"
    };
    if (apiInput.extra) Object.assign(input, apiInput.extra);

  } else if (apiInput.useMinimaxH3) {
    // ── MiniMax H3 (text / image / reference to video) ───────────────────────
    const [startFrameUrl, endFrameUrl, r2RefImages, r2RefVideos, r2RefAudios] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references").catch(() => rawEndFrame)   : Promise.resolve(undefined),
      Promise.all((rawRefImages    as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefVideoUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefAudioUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
    ]);

    if (startFrameUrl || endFrameUrl) {
      // image-to-video — frames take priority over references
      effectiveApiId = cfg.imageApiId!;
      input = {
        prompt:                 prompt ?? "",
        [apiInput.durationKey!]: clampedDuration,
      };
      if (startFrameUrl)          input[apiInput.firstFrameKey!] = startFrameUrl;
      if (endFrameUrl)            input[apiInput.lastFrameKey!]  = endFrameUrl;
      if (apiInput.resolutionKey) input[apiInput.resolutionKey]  = resolution;
    } else if (r2RefImages.length > 0) {
      // reference-to-video
      effectiveApiId = "minimax-h3/reference-to-video";
      input = {
        prompt:                     prompt ?? "",
        [apiInput.referenceImagesKey!]: r2RefImages.slice(0, 9),
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      // reference_audio cannot be used alone — it always rides along with images here
      if (r2RefVideos.length > 0 && apiInput.referenceVideosKey) input[apiInput.referenceVideosKey] = r2RefVideos.slice(0, 3);
      if (r2RefAudios.length > 0 && apiInput.referenceAudiosKey) input[apiInput.referenceAudiosKey] = r2RefAudios.slice(0, 3);
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    } else {
      // text-to-video
      effectiveApiId = cfg.apiId;
      input = {
        prompt:                     prompt ?? "",
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    }

  } else if (apiInput.firstFrameKey) {
    // ── Seedance-style models (separate frame keys + multi-ref arrays) ─────────
    const [startFrameUrl, endFrameUrl, r2RefImages, r2RefVideos, r2RefAudios] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references").catch(() => rawEndFrame)   : Promise.resolve(undefined),
      Promise.all((rawRefImages    as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefVideoUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefAudioUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
    ]);

    input = {
      [apiInput.aspectRatioKey!]: effectiveAspectRatio,
      [apiInput.durationKey!]:    clampedDuration,
    };

    if (prompt?.trim())                                        input.prompt                       = prompt;
    if (apiInput.firstFrameKey  && startFrameUrl)              input[apiInput.firstFrameKey]       = startFrameUrl;
    if (apiInput.lastFrameKey   && endFrameUrl)                input[apiInput.lastFrameKey]        = endFrameUrl;
    if (apiInput.resolutionKey)                                input[apiInput.resolutionKey]       = resolution;
    if (apiInput.soundKey)                                     input[apiInput.soundKey]            = Boolean(sound);
    // Seedance (and similar): first/last frames and reference images are mutually exclusive
    if (apiInput.referenceImagesKey && r2RefImages.length > 0 && !startFrameUrl && !endFrameUrl) input[apiInput.referenceImagesKey]  = r2RefImages;
    if (apiInput.referenceVideosKey && r2RefVideos.length > 0) input[apiInput.referenceVideosKey]  = r2RefVideos;
    if (apiInput.referenceAudiosKey && r2RefAudios.length > 0) input[apiInput.referenceAudiosKey]  = r2RefAudios;
    if (apiInput.extra)                                        Object.assign(input, apiInput.extra);

  } else if (apiInput.useHappyHorse) {
    // ── HappyHorse (Alibaba) — routes to text/image/reference endpoint ────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    const startFrameUrl = rawStartFrame
      ? await ensureR2(rawStartFrame, "references").catch(() => rawStartFrame)
      : undefined;

    const maybeSeed = seed !== undefined && seed !== null && Number(seed) > 0 ? Number(seed) : undefined;

    if (refImageUrls.length > 0) {
      effectiveApiId = "happyhorse/reference-to-video";
      input = {
        prompt: prompt ?? "",
        reference_image: refImageUrls.slice(0, 9),
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    } else if (startFrameUrl) {
      effectiveApiId = "happyhorse/image-to-video";
      input = {
        image_urls:             [startFrameUrl],
        [apiInput.durationKey!]: clampedDuration,
      };
      if (prompt?.trim()) input.prompt = prompt;
      // resolution is determined by the input image — do not send it
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    } else {
      effectiveApiId = "happyhorse/text-to-video";
      input = {
        prompt: prompt ?? "",
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    }

  } else if (apiInput.useKlingTurbo) {
    // ── Kling 3.0 Turbo (text-to-video / image-to-video) ─────────────────────
    const startFrameUrl = rawStartFrame
      ? await ensureR2(rawStartFrame, "references").catch(() => rawStartFrame)
      : undefined;

    const durationValue = String(clampedDuration);

    if (startFrameUrl) {
      effectiveApiId = cfg.imageApiId!;
      input = {
        prompt:              prompt ?? "",
        image_urls:          [startFrameUrl],
        [apiInput.durationKey!]: durationValue,
        [apiInput.resolutionKey!]: resolution,
      };
    } else {
      effectiveApiId = cfg.apiId;
      input = {
        prompt:                     prompt ?? "",
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    durationValue,
        [apiInput.resolutionKey!]:  resolution,
      };
    }

  } else if (apiInput.useGoogleVeo) {
    // ── Google Veo 3.1 ───────────────────────────────────────────────────────
    const [startFrameUrl, endFrameUrl, refImages] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references").catch(() => rawEndFrame)   : Promise.resolve(undefined),
      Promise.all((rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
    ]);

    const imageUrls: string[] = [];
    let generationType = "TEXT_2_VIDEO";

    // For veo3.1 lite, if an image is attached use: Image to video, just a text is attached, use text to video.
    // On the two other models (fast/quality), one more element is present: reference.
    const isLite = cfg.id === "veo3_lite";

    if (veoMode === "references" && !isLite) {
      generationType = "REFERENCE_2_VIDEO";
      if (refImages.length > 0) imageUrls.push(...refImages.slice(0, 3));
    } else {
      if (startFrameUrl || endFrameUrl) {
        generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO";
        if (startFrameUrl) imageUrls.push(startFrameUrl);
        if (endFrameUrl) imageUrls.push(endFrameUrl);
      }
    }

    effectiveApiId = cfg.apiId; // Use veo3, veo3_fast, or veo3_lite directly

    input = {
      prompt: prompt ?? "",
      generationType: rawGenerationType || generationType,
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.resolutionKey!]: resolution,
      imageUrls: imageUrls,
      watermark: "",
      enableFallback: false,
      enableTranslation: true,
      callBackUrl,
    };
    if (apiInput.extra) Object.assign(input, apiInput.extra);

  } else if (apiInput.useGeminiOmniVideo) {
    // ── Gemini Omni Video (quota-based: image=1 slot, video=2 slots, max 7) ────
    const r2RefImages = await Promise.all(
      (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => u))
    );
    const r2RefVideos = await Promise.all(
      (rawRefVideoUrls as string[]).slice(0, 1).map((u) => ensureR2(u, "references").catch(() => u))
    );

    const videoSlots = r2RefVideos.length > 0 ? 2 : 0;
    const clampedImages = r2RefImages.slice(0, 7 - videoSlots);

    const maybeSeed = seed !== undefined && seed !== null && Number(seed) > 0 ? Number(seed) : undefined;

    input = { prompt: prompt ?? "" };
    if (clampedImages.length > 0) input.image_urls = clampedImages;
    if (r2RefVideos.length > 0)   input.video_list = r2RefVideos.map((url) => ({ url, start: 0, ends: 10 }));
    // duration is ignored by the model when video input is provided
    if (r2RefVideos.length === 0) input[apiInput.durationKey!] = String(clampedDuration);
    if (apiInput.aspectRatioKey)  input[apiInput.aspectRatioKey] = aspectRatio;
    if (apiInput.resolutionKey)   input[apiInput.resolutionKey]  = resolution;
    if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;

  } else if (apiInput.referenceImagesKey) {
    // ── Reference-image-based models (Grok Imagine, Grok Imagine 1.5) ─────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    const hasImages = refImageUrls.length > 0;
    effectiveApiId = hasImages && cfg.imageApiId ? cfg.imageApiId : cfg.apiId;

    const durationValue = apiInput.durationAsString ? String(clampedDuration) : clampedDuration;

    input = {
      prompt:                     prompt ?? "",
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    durationValue,
    };

    if (apiInput.modeKey)       input[apiInput.modeKey]       = mode;
    if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    if (apiInput.extra)         Object.assign(input, apiInput.extra);
    if (hasImages) input[apiInput.referenceImagesKey] = refImageUrls;

  } else {
    // ── Start/end-frame + elements models (Kling) ─────────────────────────────
    const hasNewElements = (klingElements as KlingElementInput[]).length > 0;

    const [startFrameUrl, endFrameUrl, r2Resources, uploadedElements] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references") : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references") : Promise.resolve(undefined),
      hasNewElements
        ? Promise.resolve([] as Resource[])
        : Promise.all(
            (resources as Resource[]).slice(0, 3).map(async (r) => ({
              ...r,
              url: await ensureR2(r.url, "references").catch(() => r.url),
            }))
          ),
      hasNewElements
        ? Promise.all(
            (klingElements as KlingElementInput[]).slice(0, 3).map(async (el) => ({
              name:        el.name,
              description: el.description,
              imageUrls:   await Promise.all(
                el.imageUrls.map((u) => ensureR2(u, "references").catch(() => u))
              ),
            }))
          )
        : Promise.resolve([] as { name: string; description: string; imageUrls: string[] }[]),
    ]);

    input = {
      prompt:                     prompt ?? "",
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    apiInput.durationAsString ? String(clampedDuration) : clampedDuration,
    };

    if (apiInput.modeKey)       input[apiInput.modeKey]       = mode;
    if (apiInput.soundKey)      input[apiInput.soundKey]      = Boolean(sound);
    if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    if (apiInput.extra)         Object.assign(input, apiInput.extra);

    if (apiInput.useImageUrls) {
      const image_urls: string[] = [];
      if (startFrameUrl) image_urls.push(startFrameUrl);
      if (endFrameUrl)   image_urls.push(endFrameUrl);
      if (image_urls.length > 0) input.image_urls = image_urls;
    }

    if (apiInput.useKlingElements) {
      let kling_elements: { name: string; description: string; element_input_urls: string[] }[] = [];
      if (hasNewElements) {
        kling_elements = uploadedElements.map((el) => ({
          name:               el.name,
          description:        el.description,
          element_input_urls: el.imageUrls.length >= 2 ? el.imageUrls : [el.imageUrls[0], el.imageUrls[0]],
        }));
      } else {
        kling_elements = r2Resources.map((r) => {
          const safeName = r.label.toLowerCase().replace(/\s+#/g, "_").replace(/[^a-z0-9_]/g, "") || "element";
          return { name: safeName, description: r.label, element_input_urls: [r.url, r.url] };
        });
      }
      if (kling_elements.length > 0) input.kling_elements = kling_elements;
    }
  }

  // Submit task to kie.ai
  // Google Veo models require a dedicated endpoint and a flattened structure
  const endpoint = apiInput.useGoogleVeo
    ? `${KIE_BASE}/api/v1/veo/generate`
    : `${KIE_BASE}/api/v1/jobs/createTask`;

  // Debug mode — log payload to server console and return without submitting
  // (and without uploading local media to kie.ai, so a dry run touches nothing).
  if (debugOnly) {
    const debugBody = apiInput.useGoogleVeo
      ? { model: effectiveApiId, ...input }
      : { model: effectiveApiId, callBackUrl, input };
    console.log(`[DEBUG] generate-video payload → ${endpoint}`, JSON.stringify(debugBody, null, 2));
    return NextResponse.json({ debugPayload: debugBody, debugEndpoint: endpoint });
  }

  // kie.ai can't fetch our local reference media, so re-host any /generated or
  // data: URLs in the payload first.
  try {
    await rewriteLocalMediaForKie(input, apiKey!);
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't upload reference media to kie.ai: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const kieBody = apiInput.useGoogleVeo
    ? { model: effectiveApiId, ...input }
    : { model: effectiveApiId, callBackUrl, input };

  console.log(`[generate-video] sending to ${endpoint}:`, JSON.stringify(kieBody));
  const createRes = await fetch(endpoint, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify(kieBody),
  });

  if (!createRes.ok) {
    if (createRes.status === 401) {
      return NextResponse.json({ error: "Invalid Kie.ai API key — please update it in Settings." }, { status: 401 });
    }
    const errText = await createRes.text();
    console.error("[generate-video] kie.ai HTTP error:", createRes.status, errText);
    return NextResponse.json({ error: errText }, { status: 500 });
  }

  const createdText = await createRes.text();
  console.log("[generate-video] kie.ai response:", createdText);
  let created: { code?: number; msg?: string; data?: { taskId?: string; id?: string } };
  try {
    created = JSON.parse(createdText);
  } catch {
    return NextResponse.json({ error: `Upstream returned non-JSON: ${createdText.slice(0, 200)}` }, { status: 500 });
  }
  if (created.code !== 200) {
    console.error("[generate-video] kie.ai API error:", created.code, created.msg, "input:", JSON.stringify(input));
    return NextResponse.json({ error: created.msg ?? "Task creation failed" }, { status: 500 });
  }

  const taskId = created.data?.taskId || created.data?.id;
  if (!taskId) return NextResponse.json({ error: "No taskId returned" }, { status: 500 });

  // Register as pending so the frontend can poll job-status
  jobStore.set(taskId, { status: "pending", type: "video", userId: userId ?? undefined });

  const referenceUrls: string[] = apiInput.useMotionControl
    ? [
        ...((input.input_urls as string[] | undefined) ?? []),
        ...((input.video_urls as string[] | undefined) ?? []),
      ]
    : apiInput.useGeminiOmniVideo
    ? [
        ...((input.image_urls as string[] | undefined) ?? []),
        ...((input.video_list as Array<{ url: string }> | undefined)?.map((v) => v.url) ?? []),
      ]
    : apiInput.useMinimaxH3
    ? [
        ...(input.first_frame_url ? [input.first_frame_url as string] : []),
        ...(input.last_frame_url  ? [input.last_frame_url as string]  : []),
        ...((input.reference_image_urls as string[] | undefined) ?? []),
        ...((input.reference_video_urls as string[] | undefined) ?? []),
        ...((input.reference_audio_urls as string[] | undefined) ?? []),
      ]
    : apiInput.referenceImagesKey
    ? (input[apiInput.referenceImagesKey] as string[] | undefined) ?? []
    : [
        ...((input.image_urls as string[] | undefined) ?? []),
        ...((input.kling_elements as Array<{ element_input_urls: string[] }> | undefined)
          ?.map((el) => el.element_input_urls[0]) ?? []),
      ];

  guestDb.insertGeneration({
    task_id: taskId, user_id: userId, generation_type: "video",
    status: "pending", model: videoModel, prompt, aspect_ratio: effectiveAspectRatio,
    duration: clampedDuration, kling_mode: mode,
    sound: cfg.sound ? Boolean(sound) : false,
    reference_image_urls: referenceUrls,
  });
  if (apiInput.useGoogleVeo) {
    console.warn("[generate-video] Veo has no jobs-API polling yet — result needs a callback URL");
  } else {
    pollKieJob(taskId, apiKey!, "video");
  }

  return NextResponse.json({ taskId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && (e as NodeJS.ErrnoException).cause;
    console.error("[generate-video] unhandled error:", msg, cause ?? "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Revana (https://revana.si) ─────────────────────────────────────────────────

// Which backend runs a request without an explicit `provider`: lib/providerRouting.

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && !!u) : [];

/** Same request body as the kie.ai path, routed to Revana. Returns `{ taskId }`. */
async function generateWithRevana(
  body: Record<string, unknown>,
  videoModel: string,
  userId: string,
  debugOnly: boolean,
): Promise<NextResponse> {
  const revanaKey = guestDb.getRevanaApiKey();
  // A dry run (debugOnly) only builds the request, so it needs no key.
  if (!revanaKey && !debugOnly) {
    return NextResponse.json({ error: "No Revana API key configured. Add one in Settings → API Keys." }, { status: 401 });
  }

  const cfg = VIDEO_MODELS.find((m) => m.id === videoModel);
  const rm = getRevanaModel(videoModel);
  if (!rm) {
    return NextResponse.json(
      { error: `${cfg?.name ?? videoModel} isn't available on Revana — choose Kie.ai for it in Settings → Video Models.` },
      { status: 400 },
    );
  }

  // data: URLs become local files first, so the gallery record keeps a stable
  // path; lib/mediaHost turns local files into public links right before submit.
  const localize = (u: string) => (u.startsWith("data:") ? ensureR2(u, "references") : Promise.resolve(u));
  const localizeAll = (list: string[]) => Promise.all(list.map(localize));

  let startFrameUrl = str(body.startFrameUrl);
  let endFrameUrl = str(body.endFrameUrl);
  let referenceImageUrls = strs(body.referenceImageUrls);
  const generationType = str(body.generationType);
  const imageUrls = strs(body.imageUrls);

  if (generationType) {
    // Gallery Veo shape: frames or references travel in `imageUrls`.
    if (generationType === "FIRST_AND_LAST_FRAMES_2_VIDEO" && !startFrameUrl && imageUrls.length > 0) {
      [startFrameUrl, endFrameUrl] = imageUrls;
    } else if (generationType === "REFERENCE_2_VIDEO" && referenceImageUrls.length === 0) {
      referenceImageUrls = imageUrls;
    }
  } else if (referenceImageUrls.length === 0) {
    // Other aliases for reference images: `imageUrls`, Kling `resources` / `klingElements`.
    referenceImageUrls = imageUrls.length > 0
      ? imageUrls
      : [
          ...(Array.isArray(body.resources) ? (body.resources as Resource[]).map((r) => r?.url) : []),
          ...(Array.isArray(body.klingElements)
            ? (body.klingElements as KlingElementInput[]).flatMap((el) => el?.imageUrls ?? [])
            : []),
        ].filter((u): u is string => typeof u === "string" && !!u);
  }

  const [start, end, refImages, refVideos, refAudios, videoRef] = await Promise.all([
    startFrameUrl ? localize(startFrameUrl) : Promise.resolve(undefined),
    endFrameUrl ? localize(endFrameUrl) : Promise.resolve(undefined),
    localizeAll(referenceImageUrls),
    localizeAll(strs(body.referenceVideoUrls)),
    localizeAll(strs(body.referenceAudioUrls)),
    str(body.videoRefUrl) ? localize(str(body.videoRefUrl)!) : Promise.resolve(undefined),
  ]);

  // Kling picks its resolution through `mode` (std / pro / 4K → "720p" / "1080p" / "4K").
  const modeResolution =
    cfg?.modes?.length && !cfg.resolutions?.length
      ? cfg.modes.find((m) => m.value === (str(body.mode) ?? cfg.defaultMode))?.label
      : undefined;
  const rawDuration = body.duration;
  const duration =
    typeof rawDuration === "number" || (typeof rawDuration === "string" && rawDuration.trim() !== "")
      ? Number(rawDuration)
      : undefined;
  // Veo on Kie.ai always has sound and its UI has no toggle — keep that default.
  const sound = typeof body.sound === "boolean" ? body.sound : !!cfg?.apiInput.useGoogleVeo;

  let built: BuiltRevanaRequest;
  try {
    built = buildRevanaVideoRequest(rm, {
      prompt: str(body.prompt),
      startFrameUrl: start,
      endFrameUrl: end,
      referenceImageUrls: refImages,
      referenceVideoUrls: refVideos,
      referenceAudioUrls: refAudios,
      videoUrl: videoRef,
      duration,
      resolution: modeResolution ?? str(body.resolution),
      aspectRatio: str(body.aspectRatio) ?? str(body.aspect_ratio),
      defaultResolution: cfg?.defaultResolution,
      defaultAspectRatio: cfg?.defaultRatio,
      sound,
    });
  } catch (e) {
    if (e instanceof RevanaInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  // The gallery record keeps the local references — the public copies expire.
  const input = built.body.input;
  const referenceUrls = [
    ...(["image_url", "end_image_url", "video_url"] as const).map((k) => input[k]),
    ...(["image_urls", "video_urls", "audio_urls"] as const).flatMap((k) => (input[k] as string[] | undefined) ?? []),
  ].filter((u): u is string => typeof u === "string");

  if (debugOnly) {
    console.log("[DEBUG] generate-video payload → Revana", JSON.stringify(built.body, null, 2));
    return NextResponse.json({
      debugPayload: built.body,
      debugEndpoint: `${REVANA_API_BASE}/generations`,
      estimatedCostUsd: built.estimatedCostUsd,
    });
  }

  try {
    const kieKey = (await getKieTokenForUser()) ?? process.env.KIE_API_TOKEN ?? null;
    await rehostRevanaMedia(input, kieKey);
  } catch (e) {
    if (e instanceof MediaHostError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }

  let created: { id: string; quotedUsd: number | null };
  try {
    created = await submitRevanaVideo(revanaKey!, built.body);
  } catch (e) {
    if (e instanceof RevanaApiError) {
      const status = [401, 402, 403, 409, 413, 422, 429].includes(e.status) ? e.status : 502;
      return NextResponse.json({ error: e.message }, { status });
    }
    throw e;
  }

  const taskId = `${REVANA_TASK_PREFIX}${created.id}`;
  console.log(
    `[generate-video] Revana job ${created.id} · ${rm.revanaId} · quoted $${created.quotedUsd ?? "?"} · cap $${built.body.max_cost_usd ?? "-"}`,
  );

  jobStore.set(taskId, { status: "pending", type: "video", userId });
  guestDb.insertGeneration({
    task_id: taskId, user_id: userId, generation_type: "video",
    status: "pending", model: videoModel, prompt: str(body.prompt),
    aspect_ratio: built.aspectRatio ?? str(body.aspectRatio) ?? str(body.aspect_ratio),
    duration: built.duration ?? -1, kling_mode: str(body.mode) ?? "pro",
    sound: built.audio,
    reference_image_urls: referenceUrls,
  });
  pollRevanaJob(taskId, revanaKey!);

  return NextResponse.json({ taskId });
}
