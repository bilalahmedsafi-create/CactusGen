/**
 * A small, stateless MCP server (JSON-RPC 2.0 over Streamable HTTP, JSON
 * responses only). Handles initialize, notifications/initialized, ping,
 * tools/list and tools/call. No sessions: every POST stands alone, which is
 * all the tools need. Transport + auth live in app/api/mcp/route.ts.
 */
import { appVersion } from "@/lib/appInfo";
import { TOOLS, ToolError, callTool, hasTool, type ToolContext } from "./tools";

/** Newest first; we answer with the client's version when we know it. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const INSTRUCTIONS = [
  "CactusGen makes AI videos and images on this computer and spends the user's Kie.ai / Revana credit.",
  "Typical flow: list_models → (estimate_cost) → generate_video or generate_image → get_job with wait_seconds until done → the result is a local file path.",
  "Mention reference media in prompts as @image1, @image2 …, @video1 …, @audio1 … in the order you pass them. A start frame can't be combined with reference media.",
  "Every generation also appears in the CactusGen app's Create page and gallery.",
].join(" ");

type Id = string | number | null;

export interface RpcRequest {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function rpcError(id: Id, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Handle one JSON-RPC message. Returns null for notifications and for
 * responses a client sends us (nothing to answer).
 */
export async function handleMessage(msg: unknown, ctx: ToolContext, signal?: AbortSignal): Promise<RpcResponse | null> {
  if (!isRecord(msg) || msg.jsonrpc !== "2.0") return rpcError(null, RPC.INVALID_REQUEST, "Invalid JSON-RPC 2.0 message.");
  const hasId = "id" in msg && msg.id !== undefined;
  const id: Id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;

  // A response or error from the client (we never send requests) — ignore.
  if (typeof msg.method !== "string") {
    return hasId && ("result" in msg || "error" in msg) ? null : rpcError(id, RPC.INVALID_REQUEST, "Missing method.");
  }
  const method = msg.method;
  const params = isRecord(msg.params) ? msg.params : {};

  // Notifications get no answer.
  if (!hasId) return null;

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cactusgen", title: "CactusGen", version: appVersion() },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !hasTool(name)) {
        return rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      try {
        const result = await callTool(name, args, ctx, signal);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        });
      } catch (e) {
        const message = e instanceof ToolError
          ? e.message
          : `CactusGen hit an error running ${name}: ${e instanceof Error ? e.message : String(e)}`;
        if (!(e instanceof ToolError)) console.error(`[mcp] ${name} failed:`, e);
        return ok(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    // Optional lists some clients probe for — answer empty instead of erroring.
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
