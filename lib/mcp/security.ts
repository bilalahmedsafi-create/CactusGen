/**
 * Guards for the MCP endpoint (app/api/mcp) and the route that shows its token
 * (app/api/settings/mcp). The MCP endpoint can start paid generations, so:
 *
 *   - Host must be a loopback name. Stops DNS-rebinding pages (evil.com
 *     resolving to 127.0.0.1) from talking to it.
 *   - A browser Origin, when present, must be the app's own origin. Claude
 *     Code / mcp-remote send no Origin; a web page always does.
 *   - Authorization: Bearer <token>, compared in constant time.
 */
import { timingSafeEqual } from "node:crypto";
import { getMcpToken } from "@/lib/guest/db";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** "localhost:3000" / "127.0.0.1" / "[::1]:41730" / "app.localhost" → true. */
export function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOOPBACK.has(name) || name.endsWith(".localhost");
}

/** No Origin (CLI clients) or exactly this server's origin (the app itself). */
export function isAllowedOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    return (origin.protocol === "http:" || origin.protocol === "https:")
      && !!hostHeader
      && origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

export function checkBearer(authHeader: string | null): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader?.trim() ?? "");
  if (!m) return false;
  const given = Buffer.from(m[1].trim());
  const expected = Buffer.from(getMcpToken());
  return given.length === expected.length && timingSafeEqual(given, expected);
}
