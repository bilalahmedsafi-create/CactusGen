/**
 * Revana (https://revana.si) picture generation — the server side of image jobs
 * sent with `provider: "revana"` (or a Revana-only model id) to /api/generate
 * and /api/generate-image. Mirrors the Revana video path in
 * app/api/generate-video: build → rehost local references → submit → poll.
 *
 * Request body (JSON, same names the kie.ai image route reads):
 *   model        CactusGen id ("gpt-image-2-5-flare") or Revana id ("gpt-image-2.5-flare")
 *   prompt       required
 *   imageUrls    reference pictures / the picture to edit (also `referenceImageUrls`)
 *   resolution   "1K" | "2K" | "4K" … (falls back to `quality`, e.g. "2k")
 *   aspectRatio  "3:4" … (also `aspect_ratio`)
 *   provider     "revana" — explicit choice; see resolveImageProvider
 *   debugOnly    true → returns { debugPayload, debugEndpoint, estimatedCostUsd }, sends nothing
 * Answers `{ taskId, referenceImageUrls }`; the job settles with `imageUrl` +
 * `imageUrls` like a kie.ai image job (lib/revanaPoller.ts).
 */
import { NextResponse } from "next/server";
import { IMAGE_MODELS } from "./modelConfig";
import { getKieTokenForUser } from "./getKieToken";
import { GUEST_USER_ID } from "./guestMode";
import * as guestDb from "./guest/db";
import { jobStore } from "./jobStore";
import { ensureR2 } from "./storage";
import { MediaHostError } from "./mediaHost";
import { getRevanaImageModel, isRevanaImageModel, REVANA_TASK_PREFIX } from "./revanaModels";
import {
  REVANA_API_BASE,
  RevanaApiError,
  RevanaInputError,
  buildRevanaImageRequest,
  rehostRevanaMedia,
  submitRevanaVideo,
  type BuiltRevanaImageRequest,
} from "./revana";
import { pollRevanaJob } from "./revanaPoller";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && !!u) : [];

/**
 * Whether an image request goes to Revana. An explicit `provider` wins
 * ("revana" → yes; "kie" / "azure" / "codex" → no), as do the Azure / Codex
 * fields. Otherwise a Revana picture model goes to Revana when kie.ai can't run
 * it (no IMAGE_MODELS entry), or when Revana is the only key saved.
 */
export async function shouldUseRevanaForImage(body: Record<string, unknown>): Promise<boolean> {
  const requested = str(body.provider);
  if (requested === "revana") return true;
  if (requested) return false;
  if (body.codexProvider || (body.azureBaseUrl && body.azureDeployment)) return false;
  const model = str(body.model);
  if (!model || !isRevanaImageModel(model)) return false;
  if (!IMAGE_MODELS.some((m) => m.id === model)) return true;
  const kieKey = await getKieTokenForUser();
  return !kieKey && !!guestDb.getRevanaApiKey();
}

/** Handle one Revana picture request. Never throws for user errors — answers JSON. */
export async function generateImageWithRevana(body: Record<string, unknown>): Promise<NextResponse> {
  const debugOnly = body.debugOnly === true;
  const modelId = str(body.model) ?? "";
  const rm = getRevanaImageModel(modelId);
  if (!rm) {
    const name = IMAGE_MODELS.find((m) => m.id === modelId)?.name ?? (modelId || "This model");
    return NextResponse.json({ error: `${name} isn't available on Revana — run it on Kie.ai instead.` }, { status: 400 });
  }

  const revanaKey = guestDb.getRevanaApiKey();
  if (!revanaKey && !debugOnly) {
    return NextResponse.json({ error: "No Revana API key configured. Add one in Settings → API Keys." }, { status: 401 });
  }

  // data: URLs become local files first so the gallery record keeps a stable
  // path; lib/mediaHost turns local files into public links right before submit.
  const refs = [...new Set([...strs(body.imageUrls), ...strs(body.referenceImageUrls)])];
  let localRefs: string[];
  try {
    localRefs = await Promise.all(refs.map((u) => (u.startsWith("data:") ? ensureR2(u, "references") : Promise.resolve(u))));
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read a reference image: ${(e as Error).message}` }, { status: 400 });
  }

  let built: BuiltRevanaImageRequest;
  try {
    built = buildRevanaImageRequest(rm, {
      prompt: str(body.prompt),
      imageUrls: localRefs,
      resolution: str(body.resolution) ?? str(body.quality),
      aspectRatio: str(body.aspectRatio) ?? str(body.aspect_ratio),
    });
  } catch (e) {
    if (e instanceof RevanaInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  if (debugOnly) {
    console.log("[DEBUG] generate (image) payload → Revana", JSON.stringify(built.body, null, 2));
    return NextResponse.json({
      debugPayload: built.body,
      debugEndpoint: `${REVANA_API_BASE}/generations`,
      estimatedCostUsd: built.estimatedCostUsd,
    });
  }

  try {
    await rehostRevanaMedia(built.body.input, await getKieTokenForUser());
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
    `[generate] Revana image job ${created.id} · ${rm.revanaId} · quoted $${created.quotedUsd ?? "?"} · cap $${built.body.max_cost_usd ?? "-"}`,
  );

  jobStore.set(taskId, { status: "pending", type: "image", userId: GUEST_USER_ID });
  guestDb.insertGeneration({
    task_id: taskId, user_id: GUEST_USER_ID, generation_type: "image",
    status: "pending", prompt: str(body.prompt), model: rm.heliosId,
    aspect_ratio: built.aspectRatio, quality: built.resolution.toLowerCase(),
    reference_image_urls: built.imageUrls,
  });
  pollRevanaJob(taskId, revanaKey!, "image");

  return NextResponse.json({ taskId, referenceImageUrls: built.imageUrls });
}
