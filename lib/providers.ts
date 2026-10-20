// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS — single source of truth for per-model backend selection
// (Kie.ai / Azure Foundry / Codex CLI / Revana), shared by the Settings modal,
// the workflow GenerateNode, and the gallery generation composer.
// ─────────────────────────────────────────────────────────────────────────────
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { isRevanaModel } from "@/lib/revanaModels";

export const PROVIDERS = [
  { id: "kie",    label: "Kie.ai" },
  { id: "azure",  label: "Azure Foundry" },
  { id: "codex",  label: "Codex CLI" },
  { id: "revana", label: "Revana" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];
type Provider = (typeof PROVIDERS)[number];

const STORAGE_KEY = "aiui-model-providers";

export function loadModelProviders(): Record<string, ProviderId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveModelProviders(map: Record<string, ProviderId>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("aiui-providers-changed"));
  } catch { /* noop */ }
}

export function getModelProvider(modelId: string): ProviderId {
  return loadModelProviders()[modelId] ?? "kie";
}

/**
 * The backend the user explicitly picked for this model, or undefined when they
 * never chose one. Video requests send this as `provider` so the server can fall
 * back to Revana by itself when Revana is the only key saved.
 */
export function getSavedModelProvider(modelId: string): ProviderId | undefined {
  const saved = loadModelProviders()[modelId];
  return PROVIDERS.some((p) => p.id === saved) ? saved : undefined;
}

/** Persists the backend for a single model, leaving the others untouched. */
export function setModelProvider(modelId: string, provider: ProviderId) {
  const map = loadModelProviders();
  saveModelProviders({ ...map, [modelId]: provider });
}

/**
 * Image models with more than one backend to choose from. Both Azure and Codex
 * are image-only, and Azure additionally needs a per-model deployment configured.
 */
const MULTI_PROVIDER_IMAGE_MODEL_IDS = new Set(
  IMAGE_MODELS.filter((m) => !!m.azureSizeMap).map((m) => m.id),
);

const byId = (...ids: ProviderId[]): Provider[] => PROVIDERS.filter((p) => ids.includes(p.id));

/**
 * Backends that can serve this model: Kie.ai always; Azure Foundry and Codex CLI
 * for Azure-capable image models; Revana for the video models in
 * lib/revanaModels.ts.
 */
export function providersForModel(modelId: string): Provider[] {
  if (MULTI_PROVIDER_IMAGE_MODEL_IDS.has(modelId)) return byId("kie", "azure", "codex");
  if (isRevanaModel(modelId)) return byId("kie", "revana");
  return byId("kie");
}

export function modelHasProviderChoice(modelId: string): boolean {
  return providersForModel(modelId).length > 1;
}
