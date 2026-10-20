// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE (image mode) — what a picture model accepts, per backend.
// The model list is lib/revanaModels.ts REVANA_IMAGE_MODELS. Each of them also
// exists in lib/modelConfig.ts IMAGE_MODELS, so it can run on Kie.ai too; the
// choice is stored per model in localStorage (shared.ts, not Settings' map,
// which also drives Azure / Codex for the workflow canvas).
// ─────────────────────────────────────────────────────────────────────────────
import { IMAGE_MODELS } from "@/lib/modelConfig";
import {
  DEFAULT_REVANA_IMAGE_MODEL_ID,
  REVANA_IMAGE_MODELS,
  estimateRevanaImageCost,
  getRevanaImageModel,
} from "@/lib/revanaModels";
import type { CreateProvider } from "./modelCaps";

export const DEFAULT_IMAGE_MODEL_ID = DEFAULT_REVANA_IMAGE_MODEL_ID;

export interface ImageCaps {
  id: string;
  name: string;
  maker: string;
  provider: CreateProvider;
  /** Both Kie.ai and Revana can run it. */
  hasProviderChoice: boolean;
  resolutions: string[];
  defaultResolution: string;
  ratios: string[];
  defaultRatio: string;
  maxRefs: number;
  promptMaxLength: number;
}

export const IMAGE_MODEL_IDS = REVANA_IMAGE_MODELS.map((m) => m.heliosId);

export function imageModelExists(id: string | undefined | null): id is string {
  return !!id && IMAGE_MODEL_IDS.includes(id);
}

const kieModel = (id: string) => IMAGE_MODELS.find((m) => m.id === id);

/**
 * Which backend runs a picture: the explicit pick for this model wins;
 * otherwise Revana, unless only a Kie.ai key is saved. Revana-only models
 * always run on Revana.
 */
export function effectiveImageProvider(
  id: string,
  saved: CreateProvider | undefined,
  keys: { kie: boolean | null; revana: boolean | null },
): CreateProvider {
  if (!kieModel(id)) return "revana";
  if (saved) return saved;
  return keys.revana === false && keys.kie === true ? "kie" : "revana";
}

export function getImageCaps(id: string, provider: CreateProvider): ImageCaps {
  const rm = getRevanaImageModel(id) ?? getRevanaImageModel(DEFAULT_IMAGE_MODEL_ID)!;
  const km = kieModel(rm.heliosId);
  const base = {
    id: rm.heliosId,
    name: rm.name,
    maker: rm.maker,
    hasProviderChoice: !!km,
  };
  if (provider === "kie" && km) {
    const resolutions = (km.supportsQuality ? km.apiInput.qualityOptions ?? ["1k", "2k", "4k"] : []).map((q) => q.toUpperCase());
    const ratios = km.ratios;
    return {
      ...base,
      provider: "kie",
      resolutions,
      defaultResolution: resolutions.includes(rm.defaultResolution) ? rm.defaultResolution : resolutions[0] ?? "",
      ratios,
      defaultRatio: ratios.includes(rm.defaultAspectRatio) ? rm.defaultAspectRatio : ratios[0] ?? "1:1",
      maxRefs: km.supportsImages ? km.maxImages : 0,
      promptMaxLength: km.textOnlyPromptMaxLength ?? km.apiInput.promptMaxLength,
    };
  }
  return {
    ...base,
    provider: "revana",
    resolutions: rm.resolutions,
    defaultResolution: rm.defaultResolution,
    ratios: rm.aspectRatios,
    defaultRatio: rm.defaultAspectRatio,
    maxRefs: rm.maxInputImages,
    promptMaxLength: 30_000,
  };
}

/** USD per picture on Revana; null on Kie.ai (priced in kie credits). */
export function imagePrice(caps: ImageCaps, resolution: string): number | null {
  return caps.provider === "revana" ? estimateRevanaImageCost(caps.id, resolution) : null;
}
