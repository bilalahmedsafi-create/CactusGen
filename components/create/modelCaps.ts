// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — what a video model accepts, for the chosen backend.
// Kie.ai capabilities come from lib/modelConfig.ts (VIDEO_MODELS); Revana ones
// from lib/revanaModels.ts. The UI only ever reads ModelCaps.
// ─────────────────────────────────────────────────────────────────────────────
import { VIDEO_MODELS, type VideoModel, type VideoModelMode } from "@/lib/modelConfig";
import { getRevanaModel, isRevanaModel } from "@/lib/revanaModels";
import { loadModelProviders, setModelProvider, type ProviderId } from "@/lib/providers";

export type CreateProvider = "kie" | "revana";

export const DEFAULT_MODEL_ID = "seedance-2-5";

export type DurationSpec =
  | { kind: "none"; value: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "list"; values: number[] };

export interface ResolutionOption {
  value: string;
  label: string;
  /** Kie models whose "resolution" is really a mode (Kling 3.0: std/pro/4K). */
  mode?: string;
}

export interface ModelCaps {
  id: string;
  name: string;
  provider: CreateProvider;
  startFrame: boolean;
  endFrame: boolean;
  maxRefs: number;
  video: null | { key: "videoRef" | "referenceVideo"; required: boolean };
  requiresStartFrame: boolean;
  requiresRefs: boolean;
  duration: DurationSpec;
  defaultDuration: number;
  resolutions: ResolutionOption[];
  defaultResolution: string;
  /** Non-resolution modes (Grok style, motion-control orientation). Kie only. */
  modes: VideoModelMode[];
  defaultMode: string;
  ratios: string[];
  defaultRatio: string;
  sound: boolean;
  promptOptional: boolean;
  promptMaxLength: number | null;
  isVeo: boolean;
  isMotionControl: boolean;
}

export function findVideoModel(id: string): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === id)
    ?? VIDEO_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)
    ?? VIDEO_MODELS[0];
}

export function modelExists(id: string | undefined | null): id is string {
  return !!id && VIDEO_MODELS.some((m) => m.id === id);
}

// ── Provider (per-model, shared with Settings + gallery via lib/providers) ────

/** The backend the user explicitly picked for this model; undefined = never chose. */
export function readSavedProvider(modelId: string): CreateProvider | undefined {
  if (!isRevanaModel(modelId)) return undefined;
  const v = loadModelProviders()[modelId] as string | undefined;
  return v === "revana" || v === "kie" ? v : undefined;
}

export function writeProvider(modelId: string, provider: CreateProvider) {
  setModelProvider(modelId, provider as string as ProviderId);
}

/**
 * What the server will actually run (mirrors resolveVideoProvider in
 * app/api/generate-video): an explicit choice wins; otherwise a Revana-capable
 * model goes to Revana only when Revana is the sole key saved.
 */
export function effectiveProvider(
  modelId: string,
  saved: CreateProvider | undefined,
  keys: { kie: boolean | null; revana: boolean | null },
): CreateProvider {
  if (!isRevanaModel(modelId)) return "kie";
  if (saved) return saved;
  return keys.kie === false && keys.revana === true ? "revana" : "kie";
}

// ── Capabilities ──────────────────────────────────────────────────────────────

function durationsFromList(values: number[], fallback: number): DurationSpec {
  const sorted = [...new Set(values)].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { kind: "none", value: fallback };
  const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 4) return { kind: "range", min: sorted[0], max: sorted[sorted.length - 1] };
  return { kind: "list", values: sorted };
}

export function normalizeDuration(spec: DurationSpec, value: number): number {
  if (spec.kind === "none") return spec.value;
  if (spec.kind === "range") {
    const v = Number.isFinite(value) ? Math.round(value) : spec.min;
    return Math.max(spec.min, Math.min(spec.max, v));
  }
  return spec.values.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), spec.values[0]);
}

export function maxDuration(spec: DurationSpec): number | null {
  if (spec.kind === "range") return spec.max;
  if (spec.kind === "list") return spec.values[spec.values.length - 1];
  return null;
}

export function getCaps(modelId: string, provider: CreateProvider): ModelCaps {
  const vm = findVideoModel(modelId);
  const handles = new Set<string>(vm.handles);
  const required = new Set<string>(vm.requiredHandles ?? []);
  const rm = provider === "revana" ? getRevanaModel(vm.id) : undefined;
  const isVeo = !!vm.apiInput.useGoogleVeo;
  const isMotionControl = !!vm.apiInput.useMotionControl;

  const kieVideo: ModelCaps["video"] = handles.has("videoRef")
    ? { key: "videoRef", required: required.has("videoRef") }
    : handles.has("referenceVideo") && required.has("referenceVideo")
      ? { key: "referenceVideo", required: true }
      : null;

  const base = {
    id: vm.id,
    name: vm.name,
    promptOptional: !!vm.promptOptional,
    promptMaxLength: vm.apiInput.promptMaxLength ?? null,
    isVeo,
    isMotionControl,
  };

  if (rm) {
    // Revana edits keep the input clip's length — no duration is sent.
    const duration: DurationSpec = rm.videoEdit
      ? { kind: "none", value: -1 }
      : Array.isArray(rm.durations)
        ? durationsFromList(rm.durations, 0)
        : { kind: "range", min: rm.durations.min, max: rm.durations.max };
    const defaultDuration = normalizeDuration(duration, vm.defaultDuration > 0 ? vm.defaultDuration : 5);
    // Kling's Kie config picks resolution through `mode` (std/pro/4K); the server
    // reads that mode on Revana too, so keep the pairing.
    const modeByLabel = !vm.resolutions?.length ? vm.modes ?? [] : [];
    const resolutions: ResolutionOption[] = rm.resolutions.map((r) => {
      const mode = modeByLabel.find((m) => m.label.toLowerCase() === r.toLowerCase())?.value;
      return mode ? { value: r, label: r, mode } : { value: r, label: r };
    });
    const defaultResolution = rm.resolutions.includes(vm.defaultResolution ?? "")
      ? vm.defaultResolution!
      : rm.resolutions.includes("720p") ? "720p" : rm.resolutions[0] ?? "";
    const ratios = rm.aspectRatios;
    return {
      ...base,
      // Revana refuses an empty prompt on every model.
      promptOptional: false,
      provider: "revana",
      startFrame: !rm.videoEdit,
      endFrame: rm.lastFrame,
      maxRefs: rm.maxRefImages,
      video: rm.videoEdit ? { key: kieVideo?.key ?? "referenceVideo", required: true } : null,
      requiresStartFrame: false,
      requiresRefs: false,
      duration,
      defaultDuration,
      resolutions,
      defaultResolution,
      modes: [],
      defaultMode: "",
      ratios,
      defaultRatio: ratios.includes(vm.defaultRatio) ? vm.defaultRatio : ratios[0] ?? vm.defaultRatio,
      sound: rm.audio,
    };
  }

  // ── Kie.ai ──
  let resolutions: ResolutionOption[] = [];
  let modes: VideoModelMode[] = [];
  let defaultResolution = "";
  if (vm.resolutions?.length) {
    resolutions = vm.resolutions.map((r) => ({ value: r, label: r }));
    defaultResolution = vm.defaultResolution && vm.resolutions.includes(vm.defaultResolution) ? vm.defaultResolution : vm.resolutions[0];
    modes = vm.modes ?? [];
  } else if (vm.modes?.length) {
    // Kling 3.0: its modes are output resolutions (std = 720p, pro = 1080p, 4K)
    resolutions = vm.modes.map((m) => ({ value: m.label, label: m.label, mode: m.value }));
    defaultResolution = vm.modes.find((m) => m.value === vm.defaultMode)?.label ?? resolutions[0].value;
  }

  const duration = durationsFromList(vm.durations, vm.defaultDuration);
  return {
    ...base,
    provider: "kie",
    startFrame: handles.has("startFrame"),
    endFrame: handles.has("endFrame"),
    maxRefs: handles.has("resource") && !vm.apiInput.useKlingElements ? (vm.maxResources ?? 3) : 0,
    video: kieVideo,
    requiresStartFrame: required.has("startFrame"),
    requiresRefs: required.has("resource"),
    duration,
    defaultDuration: normalizeDuration(duration, vm.defaultDuration),
    resolutions,
    defaultResolution,
    modes,
    defaultMode: vm.defaultMode ?? modes[0]?.value ?? "",
    ratios: vm.ratios,
    defaultRatio: vm.ratios.includes(vm.defaultRatio) ? vm.defaultRatio : vm.ratios[0] ?? vm.defaultRatio,
    sound: vm.sound,
  };
}

/** Short capability line for the model picker, e.g. "up to 30s · sound". */
export function capsBadge(caps: ModelCaps): string {
  const parts: string[] = [];
  const max = maxDuration(caps.duration);
  if (max) parts.push(`up to ${max}s`);
  else if (caps.isVeo) parts.push("8s");
  else if (caps.video) parts.push("follows input video");
  if (caps.sound) parts.push("sound");
  if (caps.video && !caps.isMotionControl) parts.push("edit");
  if (caps.isMotionControl) parts.push("motion");
  return parts.join(" · ");
}

export interface ModelGroup {
  provider: string;
  models: VideoModel[];
}

/** VIDEO_MODELS grouped by maker, in config order. */
export function groupedVideoModels(): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const m of VIDEO_MODELS) {
    const g = groups.find((x) => x.provider === m.provider);
    if (g) g.models.push(m);
    else groups.push({ provider: m.provider, models: [m] });
  }
  return groups;
}
