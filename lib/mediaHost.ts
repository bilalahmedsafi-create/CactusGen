/**
 * Make media inputs reachable by Revana (https://revana.si).
 *
 * Revana only takes public https URLs that download directly — it has no upload
 * endpoint and does not accept `data:` URIs. Local media (`/generated/...` files
 * under MEDIA_DIR, `data:` URLs, links to this machine, plain-http links) is
 * pushed to a temporary public host and that URL is sent instead, trying in order:
 *   1. uguu.se — anonymous, files deleted after 3 h, 128 MB max.
 *   2. litterbox.catbox.moe — anonymous, files deleted after 24 h (blocks some
 *      networks with a 403).
 *   3. kie.ai's temp store (`lib/kieUpload.ts`, kept 3 days) — only when a
 *      kie.ai key is saved.
 * Already-public https URLs pass through untouched. Uploads are cached by
 * content hash for the life of the process, while the hosted copy is fresh.
 */
import { createHash } from "node:crypto";
import { readLocalMedia, uploadToKieTempStore } from "./kieUpload";

const UGUU_URL = "https://uguu.se/upload";
const UGUU_TTL_MS = 3 * 60 * 60 * 1000;
const UGUU_MAX_BYTES = 128 * 1024 * 1024;
const LITTERBOX_URL = "https://litterbox.catbox.moe/resources/internals/api.php";
const LITTERBOX_TTL_MS = 24 * 60 * 60 * 1000;
const KIE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Only reuse a hosted copy with this much life left — a queued generation may
// fetch its inputs a while after it was submitted.
const MIN_REMAINING_MS = 60 * 60 * 1000;
// After a host fails, skip it for a while instead of waiting on it for every
// file (only while another host is left to try).
const HOST_COOLDOWN_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;

export class MediaHostError extends Error {}

interface Hosted {
  url: string;
  expiresAt: number;
}

const byHash = new Map<string, Promise<Hosted>>();
const downUntil = new Map<string, number>();

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

function isThisMachine(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1" || h.startsWith("127.");
}

function shortRef(input: string): string {
  return input.startsWith("data:") ? `${input.slice(0, 30)}…` : input.length > 120 ? `${input.slice(0, 120)}…` : input;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Upload timeout that grows with the file (assumes at least ~50 KB/s upstream). */
function uploadTimeout(bytes: number): number {
  return Math.max(60_000, Math.ceil(bytes / 50_000) * 1000);
}

async function uploadToUguu(buf: Buffer, mime: string, ext: string): Promise<string> {
  if (buf.byteLength > UGUU_MAX_BYTES) throw new Error("file over 128 MB");
  const form = new FormData();
  form.append("files[]", new Blob([new Uint8Array(buf)], { type: mime }), `cactusgen.${ext || "bin"}`);
  const res = await fetch(UGUU_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(uploadTimeout(buf.byteLength)),
  });
  const text = await res.text();
  let url: unknown;
  try {
    url = JSON.parse(text)?.files?.[0]?.url;
  } catch { /* not JSON — reported below */ }
  if (!res.ok || typeof url !== "string" || !/^https:\/\/\S+$/.test(url)) {
    const detail = /^\s*</.test(text) ? "HTML error page" : text.slice(0, 120) || "empty response";
    throw new Error(`HTTP ${res.status} (${detail})`);
  }
  return url;
}

async function uploadToLitterbox(buf: Buffer, mime: string, ext: string): Promise<string> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "24h");
  form.append("fileToUpload", new Blob([new Uint8Array(buf)], { type: mime }), `cactusgen.${ext || "bin"}`);
  const res = await fetch(LITTERBOX_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(uploadTimeout(buf.byteLength)),
  });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https:\/\/\S+$/.test(text)) {
    const detail = /^\s*</.test(text) ? "HTML error page" : text.slice(0, 120) || "empty response";
    throw new Error(`HTTP ${res.status} (${detail})`);
  }
  return text;
}

/** Bytes of a reference we can't hand to Revana as-is. */
async function loadBytes(input: string, localRef: string | null): Promise<{ buf: Buffer; mime: string; ext: string }> {
  if (localRef) {
    try {
      return await readLocalMedia(localRef);
    } catch (e) {
      throw new MediaHostError(`Couldn't read local file ${shortRef(localRef)}: ${errMsg(e)}`);
    }
  }
  let res: Response;
  try {
    res = await fetch(input, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new MediaHostError(`Couldn't download ${shortRef(input)}: ${errMsg(e)}`);
  }
  if (!res.ok) throw new MediaHostError(`Couldn't download ${shortRef(input)}: HTTP ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, mime, ext: EXT_BY_MIME[mime] ?? "bin" };
}

async function host(
  buf: Buffer,
  mime: string,
  ext: string,
  kieInput: () => string,
  kieApiKey: string | null,
): Promise<Hosted> {
  const failures: string[] = [];
  const anonHosts = [
    { name: "uguu.se", upload: uploadToUguu, ttl: UGUU_TTL_MS },
    { name: "litterbox.catbox.moe", upload: uploadToLitterbox, ttl: LITTERBOX_TTL_MS },
  ];

  for (const [i, h] of anonHosts.entries()) {
    const isLastResort = i === anonHosts.length - 1 && !kieApiKey;
    if (!isLastResort && Date.now() < (downUntil.get(h.name) ?? 0)) continue;
    try {
      const url = await h.upload(buf, mime, ext);
      downUntil.delete(h.name);
      return { url, expiresAt: Date.now() + h.ttl };
    } catch (e) {
      downUntil.set(h.name, Date.now() + HOST_COOLDOWN_MS);
      console.warn(`[mediaHost] ${h.name} upload failed:`, errMsg(e));
      failures.push(`${h.name}: ${errMsg(e)}`);
    }
  }

  if (kieApiKey) {
    try {
      const url = await uploadToKieTempStore(kieInput(), kieApiKey);
      return { url, expiresAt: Date.now() + KIE_TTL_MS };
    } catch (e) {
      console.warn("[mediaHost] kie.ai temp upload failed:", errMsg(e));
      failures.push(`kie.ai temp store: ${errMsg(e)}`);
    }
  }

  throw new MediaHostError(
    `Couldn't put a local file on a temporary public host for Revana (${failures.join("; ")}). ` +
      (kieApiKey ? "" : "Saving a Kie.ai key in Settings → API Keys adds a fallback host. ") +
      "Using public https links for your references avoids the upload.",
  );
}

/**
 * Return a public https URL Revana can download for `input`. Already-public
 * https links pass through; anything else is uploaded (cached by content hash).
 * Throws `MediaHostError` with a user-facing message on failure.
 */
export async function ensurePublicUrl(input: string, kieApiKey: string | null = null): Promise<string> {
  let localRef: string | null = null;
  if (input.startsWith("data:") || input.startsWith("/generated/")) {
    localRef = input;
  } else {
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      throw new MediaHostError(`Unsupported media reference: ${shortRef(input)}`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new MediaHostError(`Unsupported media reference: ${shortRef(input)}`);
    }
    const local = isThisMachine(u.hostname);
    if (!local && u.protocol === "https:") return input;
    if (local && u.pathname.startsWith("/generated/")) localRef = decodeURI(u.pathname);
  }

  const { buf, mime, ext } = await loadBytes(input, localRef);
  if (buf.byteLength === 0) throw new MediaHostError(`Empty media file: ${shortRef(input)}`);

  const hash = createHash("sha256").update(buf).digest("hex");
  const cached = byHash.get(hash);
  if (cached) {
    const hit = await cached.catch(() => null);
    if (hit && hit.expiresAt - Date.now() > MIN_REMAINING_MS) return hit.url;
  }

  const kieInput = () => localRef ?? `data:${mime};base64,${buf.toString("base64")}`;
  const p = host(buf, mime, ext, kieInput, kieApiKey);
  byHash.set(hash, p);
  p.catch(() => {
    if (byHash.get(hash) === p) byHash.delete(hash);
  });
  return (await p).url;
}

/** `ensurePublicUrl` over a list, in order. */
export function ensurePublicUrls(inputs: string[], kieApiKey: string | null = null): Promise<string[]> {
  return Promise.all(inputs.map((u) => ensurePublicUrl(u, kieApiKey)));
}
