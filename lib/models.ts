export interface Model {
  id: string;
  label: string;
  desc: string;
}

export interface ModelGroup {
  label: string;
  models: Model[];
}

/** Current Claude models. Sonnet is the default everywhere a Claude model is picked for you. */
export const CLAUDE_MODELS: Model[] = [
  { id: "claude-opus-5-5",   label: "Opus 5.5",   desc: "Best"    },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", desc: "Default" },
  { id: "claude-haiku-5-5",  label: "Haiku 5.5",  desc: "Fast"    },
  { id: "claude-fable-5-1",  label: "Fable 5.1",  desc: "Premium" },
];

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Anthropic",
    models: CLAUDE_MODELS,
  },
  {
    label: "Google",
    models: [
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", desc: "Pro"  },
      { id: "gemini-3-flash", label: "Gemini Flash",   desc: "Fast" },
    ],
  },
  {
    label: "OpenAI",
    models: [
      { id: "gpt-5-2", label: "GPT 5.2", desc: "Latest" },
    ],
  },
  {
    label: "Azure",
    models: [
      { id: "azure-auto", label: "Azure Auto", desc: "Router" },
    ],
  },
];

export const MODELS: Model[] = MODEL_GROUPS.flatMap(g => g.models);
export type ModelId = string;

export function isClaudeModel(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("claude-");
}

/**
 * Model ids saved by older versions (chat sessions, canvas nodes) → the current
 * model of the same family, so old sessions keep working. Non-Claude ids and
 * unknown values pass through / fall back to the default.
 */
export function normalizeModelId(id: string | null | undefined, fallback: string = DEFAULT_CLAUDE_MODEL): string {
  if (!id) return fallback;
  if (!isClaudeModel(id)) return MODELS.some((m) => m.id === id) ? id : fallback;
  if (CLAUDE_MODELS.some((m) => m.id === id)) return id;
  if (id.includes("opus")) return "claude-opus-5-5";
  if (id.includes("haiku")) return "claude-haiku-5-5";
  if (id.includes("fable") || id.includes("mythos")) return "claude-fable-5-1";
  return DEFAULT_CLAUDE_MODEL;
}
