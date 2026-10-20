/**
 * Settings → Connect Claude (MCP): reads or regenerates the bearer token the
 * MCP endpoint (app/api/mcp) expects. Only answers on a loopback host, so a
 * DNS-rebinding page can't read the token through the user's browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMcpToken } from "@/lib/guest/db";
import { isAllowedOrigin, isLoopbackHost } from "@/lib/mcp/security";

function guard(req: NextRequest): NextResponse | null {
  const host = req.headers.get("host");
  if (!isLoopbackHost(host) || !isAllowedOrigin(req.headers.get("origin"), host)) {
    return NextResponse.json({ error: "Open CactusGen on localhost to see the MCP token." }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  return NextResponse.json({ token: getMcpToken() }, { headers: { "Cache-Control": "no-store" } });
}

/** POST { action: "regenerate" } → a new token; clients using the old one must reconnect. */
export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "regenerate") {
    return NextResponse.json({ error: 'Send { "action": "regenerate" }' }, { status: 400 });
  }
  return NextResponse.json({ token: getMcpToken(true) }, { headers: { "Cache-Control": "no-store" } });
}
