export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getKieToken } from "@/lib/getKieToken";
import { getAzureToken } from "@/lib/getAzureKey";
import { getAnthropicApiKey } from "@/lib/guest/db";
import { isClaudeModel, normalizeModelId } from "@/lib/models";
import { KIE_CLAUDE_ENDPOINT, SSE_HEADERS, describeAnthropicError, streamAnthropicAsSse } from "@/lib/claude";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Models that use OpenAI-compatible chat/completions endpoint
const OPENAI_COMPAT_ENDPOINTS: Record<string, string> = {
  "gemini-3-flash":  "https://api.kie.ai/gemini-3-flash/v1/chat/completions",
  "gemini-3.1-pro":  "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions",
  "gpt-5-2":         "https://api.kie.ai/gpt-5-2/v1/chat/completions",
};

const AZURE_API_VERSION = "2024-04-01-preview";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    messages?: Message[];
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    azureEndpoint?: string;
    azureDeployment?: string;
    azureModelName?: string;
  };

  // Old saved ids (claude-sonnet-4-6 …) map to the current model of the same family.
  const model = normalizeModelId(body.model);

  let messages: Message[];

  if (body.messages && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.prompt?.trim()) {
    messages = [];
    if (body.systemPrompt?.trim()) {
      messages.push({ role: "user", content: body.systemPrompt.trim() });
      messages.push({ role: "assistant", content: "Understood." });
    }
    messages.push({ role: "user", content: body.prompt.trim() });
  } else {
    return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Azure Auto (model-router) ──────────────────────────────────────────────
  if (model === "azure-auto") {
    const azureKey = await getAzureToken(req);
    if (!azureKey) {
      return new Response(
        JSON.stringify({ error: "No Azure API key configured. Add one in Settings." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    // Normalise: strip trailing slashes and any /openai suffix users may have pasted
    const endpoint = (body.azureEndpoint ?? "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/openai$/i, "");
    const deployment  = (body.azureDeployment || "auto-model").trim();
    const modelName   = (body.azureModelName  || "model-router").trim();
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "Azure base URL not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;
    console.log("[azure-auto] POST", url.replace(/api-version=.*/, "api-version=…"));
    const upstream = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "api-key": azureKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        max_tokens: 8192,
        temperature: 0.7,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      // Extract human-readable message from Azure error envelope
      let errorMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed?.error?.message ?? parsed?.message ?? errText;
      } catch { /* use raw text */ }
      console.error("[azure-auto] upstream error", upstream.status, errorMsg);
      return new Response(
        JSON.stringify({ error: `Azure ${upstream.status}: ${errorMsg}` }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache, no-transform",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Claude with the user's own Anthropic key (direct, official SDK) ──────
  if (isClaudeModel(model)) {
    const anthropicKey = getAnthropicApiKey();
    if (anthropicKey) {
      // The Messages API takes instructions as top-level `system`, not as a
      // message, and wants the conversation to start with a user turn.
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns = messages
        .filter((m): m is Message & { role: "user" | "assistant" } => m.role !== "system" && !!m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      while (turns.length && turns[0].role !== "user") turns.shift();
      if (!turns.length) {
        return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const stream = await streamAnthropicAsSse(anthropicKey, {
          model,
          system: system || undefined,
          messages: turns,
          signal: req.signal,
        });
        return new Response(stream, { headers: SSE_HEADERS });
      } catch (e) {
        const { status, message } = describeAnthropicError(e);
        console.error("[assistant] Anthropic error", status, message);
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  // ── Kie.ai models (Claude through kie's proxy when no Anthropic key) ─────
  const apiKey = await getKieToken(req);
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: isClaudeModel(model)
          ? "No Claude (Anthropic) or Kie.ai API key configured. Add one in Settings → API Keys."
          : "No Kie.ai API key configured. Add one in Settings.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const openaiEndpoint = OPENAI_COMPAT_ENDPOINTS[model];

  const upstream = openaiEndpoint
    ? await fetch(openaiEndpoint, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages.map(m => ({
            role: m.role,
            content: [{ type: "text", text: m.content }],
          })),
          stream: true,
        }),
      })
    : await fetch(KIE_CLAUDE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          thinkingFlag: true,
          max_tokens: 4096,
        }),
      });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: errText }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, { headers: SSE_HEADERS });
}
