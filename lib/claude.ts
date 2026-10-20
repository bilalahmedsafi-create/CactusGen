/**
 * Claude on the server. Two ways a request reaches Claude:
 *
 *   direct  — the official Anthropic SDK with the key saved in Settings → API
 *             Keys (or ANTHROPIC_API_KEY). Used whenever that key exists.
 *   kie.ai  — the Anthropic-shaped proxy at api.kie.ai/claude/v1/messages, paid
 *             from the Kie.ai balance. Used when only a Kie.ai key is saved.
 *
 * Both answer chat requests as the same server-sent-event stream (Anthropic
 * stream events, `data: {...}` lines), which app/chat, the canvas assistant
 * node and QuickAssist already read. Server-only: keys never reach the browser.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey, getKieApiToken } from "./guest/db";
import { normalizeModelId } from "./models";

export const KIE_CLAUDE_ENDPOINT = "https://api.kie.ai/claude/v1/messages";

/** Server-side refusal fallback: on a policy decline the API re-runs the request on a suitable model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type ClaudeBackend = "anthropic" | "kie";

export interface ClaudeKeys {
  anthropic: string | null;
  kie: string | null;
}

export function claudeKeys(): ClaudeKeys {
  return { anthropic: getAnthropicApiKey(), kie: getKieApiToken() };
}

/** Which backend serves Claude right now: the user's Anthropic key wins. */
export function claudeBackend(keys: ClaudeKeys = claudeKeys()): ClaudeBackend | null {
  if (keys.anthropic) return "anthropic";
  if (keys.kie) return "kie";
  return null;
}

/** Saved / legacy model id → a current Claude model id. */
export function claudeModel(id: string | null | undefined): string {
  return normalizeModelId(id);
}

/** Haiku has no server-side fallback; the Opus / Sonnet / Fable tiers do. */
function fallbackParams(model: string): Pick<Anthropic.Beta.MessageCreateParams, "betas" | "fallbacks"> {
  return model.includes("haiku") ? {} : { betas: [FALLBACK_BETA], fallbacks: "default" };
}

export function anthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/** A user-facing message + HTTP status for an Anthropic SDK error. */
export function describeAnthropicError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "Invalid Claude API key — update it in Settings → API Keys." };
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return { status: 403, message: `Claude refused the key: ${e.message}` };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Claude is rate-limiting this key — try again in a moment." };
  }
  if (e instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Claude couldn't take this request: ${e.message}` };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: "Couldn't reach the Claude API — check your connection." };
  }
  if (e instanceof Anthropic.APIError) {
    return { status: typeof e.status === "number" && e.status >= 400 ? e.status : 502, message: `Claude API error: ${e.message}` };
  }
  return { status: 500, message: e instanceof Error ? e.message : String(e) };
}

const encoder = new TextEncoder();
const sse = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Stream a chat answer straight from the Anthropic API, re-sent as SSE in the
 * Messages streaming shape. Errors before the first event (bad key, bad model)
 * are thrown so the route can answer with a proper status.
 */
export async function streamAnthropicAsSse(
  apiKey: string,
  req: {
    model: string;
    system?: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<ReadableStream<Uint8Array>> {
  const model = claudeModel(req.model);
  const stream = anthropicClient(apiKey).beta.messages.stream(
    {
      model,
      max_tokens: req.maxTokens ?? 64000,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
      ...fallbackParams(model),
    },
    { signal: req.signal },
  );

  const iterator = stream[Symbol.asyncIterator]();
  // Surface auth / validation errors before committing to a 200 stream.
  const first = await iterator.next();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let step = first;
        while (!step.done) {
          const event = step.value;
          controller.enqueue(sse(event.type, event));
          if (event.type === "message_delta" && event.delta.stop_reason === "refusal") {
            // The whole fallback chain declined — say so instead of ending silently.
            controller.enqueue(sse("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "\n\n(Claude declined this request.)" },
            }));
          }
          step = await iterator.next();
        }
      } catch (e) {
        if (!req.signal?.aborted) {
          const { message } = describeAnthropicError(e);
          controller.enqueue(sse("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: `\n\nError: ${message}` },
          }));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
}

/**
 * One complete (non-streaming) answer from the Anthropic API — returns the
 * text of the final message. Throws SDK errors (see describeAnthropicError).
 */
export async function askAnthropic(
  apiKey: string,
  req: { model: string; system: string; content: Anthropic.Beta.BetaContentBlockParam[]; maxTokens?: number },
): Promise<{ text: string; refused: boolean }> {
  const model = claudeModel(req.model);
  const message = await anthropicClient(apiKey).beta.messages.create({
    model,
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: [{ role: "user", content: req.content }],
    ...fallbackParams(model),
  });
  if (message.stop_reason === "refusal") return { text: "", refused: true };
  const text = message.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
  return { text, refused: false };
}

/**
 * The same question through kie.ai's Claude proxy (streamed, as the proxy
 * expects), collected into one string. Throws an Error with a user-facing message.
 */
export async function askKieClaude(
  kieKey: string,
  req: { model: string; system: string; content: unknown[]; maxTokens?: number },
): Promise<string> {
  const res = await fetch(KIE_CLAUDE_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${kieKey}`, "Content-Type": "application/json" },
    // Same shape app/api/assistant has always sent the proxy: the instructions
    // ride as a first user turn rather than a top-level `system` field.
    body: JSON.stringify({
      model: claudeModel(req.model),
      messages: [
        { role: "user", content: req.system },
        { role: "assistant", content: "Understood." },
        { role: "user", content: req.content },
      ],
      stream: true,
      max_tokens: req.maxTokens ?? 8192,
    }),
  });
  if (!res.ok || !res.body) {
    if (res.status === 401) throw new Error("Invalid Kie.ai API key — update it in Settings → API Keys.");
    const text = await res.text().catch(() => "");
    throw new Error(`Kie.ai Claude error ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const ev = JSON.parse(json) as { type?: string; delta?: { text?: string }; error?: { message?: string } };
        if (ev.type === "content_block_delta" && typeof ev.delta?.text === "string") out += ev.delta.text;
        if (ev.type === "error") throw new Error(ev.error?.message ?? "Kie.ai Claude stream error");
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return out;
}
