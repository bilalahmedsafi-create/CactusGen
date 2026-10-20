/**
 * /api/mcp — CactusGen as an MCP server, so Claude Code / Claude Desktop can
 * list models, estimate costs, start generations and fetch the results.
 *
 * Transport: MCP Streamable HTTP, stateless — each POST carries one JSON-RPC
 * message (or a batch) and gets plain JSON back; GET / DELETE answer 405 (no
 * server-initiated stream, no sessions).
 *
 * Security (it spends money): loopback Host only, no foreign browser Origin,
 * and `Authorization: Bearer <token>` — the token is in Settings → Connect
 * Claude (MCP). Details in lib/mcp/security.ts.
 */
import { NextRequest } from "next/server";
import { checkBearer, isAllowedOrigin, isLoopbackHost } from "@/lib/mcp/security";
import { RPC, handleMessage, rpcError, type RpcResponse } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
// get_job may wait 50 s; generate tools import media and submit.
export const maxDuration = 300;

const MAX_BODY = 30 * 1024 * 1024;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function originOf(req: NextRequest): string {
  const host = req.headers.get("host") ?? "127.0.0.1";
  const proto = req.nextUrl.protocol || "http:";
  return `${proto}//${host}`;
}

export async function POST(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isLoopbackHost(host)) {
    return json(rpcError(null, RPC.INVALID_REQUEST, "The CactusGen MCP server only answers on localhost / 127.0.0.1."), 403);
  }
  if (!isAllowedOrigin(req.headers.get("origin"), host)) {
    return json(rpcError(null, RPC.INVALID_REQUEST, "Requests from web pages are not allowed."), 403);
  }
  if (!checkBearer(req.headers.get("authorization"))) {
    return json(
      rpcError(null, RPC.INVALID_REQUEST, "Missing or wrong token. Copy the connect command from CactusGen → Settings → Connect Claude (MCP)."),
      401,
      { "WWW-Authenticate": 'Bearer realm="cactusgen"' },
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(rpcError(null, RPC.INVALID_REQUEST, "Request body too large."), 413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(rpcError(null, RPC.PARSE_ERROR, "Parse error: the body isn't valid JSON."), 400);
  }

  const ctx = { origin: originOf(req) };
  if (Array.isArray(payload)) {
    if (payload.length === 0) return json(rpcError(null, RPC.INVALID_REQUEST, "Empty batch."), 400);
    const answers = (await Promise.all(payload.map((m) => handleMessage(m, ctx, req.signal))))
      .filter((r): r is RpcResponse => r !== null);
    return answers.length ? json(answers) : new Response(null, { status: 202 });
  }
  const answer = await handleMessage(payload, ctx, req.signal);
  return answer ? json(answer) : new Response(null, { status: 202 });
}

function notAllowed() {
  return json(rpcError(null, RPC.INVALID_REQUEST, "Method not allowed — this MCP server is stateless; send JSON-RPC with POST."), 405, { Allow: "POST" });
}

export async function GET() {
  return notAllowed();
}

export async function DELETE() {
  return notAllowed();
}
