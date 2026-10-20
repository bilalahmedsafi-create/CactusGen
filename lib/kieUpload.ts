/**
 * Make image inputs reachable by kie.ai from a machine with no public URL.
 *
 * Hosted mode hands kie.ai a public R2 URL and (with a tunnel) can even expose
 * local files. The desktop app has neither, so local / data-URL images are
 * pushed to kie.ai's temporary file store (`POST /api/file-base64-upload`,
 * retained 3 days — long enough for a generation) and the returned `downloadUrl`
 * is used instead.
 */
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { MEDIA_DIR } from "./guest/paths";

// kie.ai's temp file store lives on this host, not api.kie.ai (their docs are
// stale). Files land on tempfile.redpandaai.co and are purged after 3 days.
const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";

function isRemotelyReachable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const { hostname } = new URL(url);
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "0.0.0.0";
  } catch {
    return false;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/** A local reference that kie.ai can't fetch and we must re-host. */
function isLocalMedia(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("/generated/");
}

/**
 * Read a `/generated/...` path or a `data:` URL into bytes. Also used by
 * `lib/mediaHost.ts` (Revana re-hosting). Refuses paths that escape MEDIA_DIR.
 */
export async function readLocalMedia(input: string): Promise<{ buf: Buffer; mime: string; ext: string }> {
  if (input.startsWith("data:")) {
    const m = input.match(/^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/);
    if (!m) throw new Error("Malformed data: URL");
    const mime = m[1] || "application/octet-stream";
    const isBase64 = m[2].split(";").includes("base64");
    const buf = isBase64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    const ext = Object.keys(MIME_BY_EXT).find((k) => MIME_BY_EXT[k] === mime) ?? "bin";
    return { buf, mime, ext };
  }

  const rel = input.replace(/^\/generated\//, "").replace(/^\/+/, "");
  const root = resolve(MEDIA_DIR);
  const full = resolve(root, rel);
  if (!full.startsWith(root + sep)) throw new Error(`Not a media file: ${input}`);
  const buf = await readFile(full);
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return { buf, mime: MIME_BY_EXT[ext] ?? "application/octet-stream", ext };
}

/** Read a `/generated/...` path or a `data:` URL into a base64 data URL. */
async function toDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;
  const { buf, mime } = await readLocalMedia(input);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Cache so the same reference used in several input fields uploads once.
// Entries are dropped well before kie.ai purges the file (3 days).
const UPLOAD_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const uploadCache = new Map<string, { p: Promise<string>; at: number }>();

async function doUpload(input: string, apiKey: string): Promise<string> {
  const base64Data = await toDataUrl(input);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, uploadPath: "cactusgen" }),
  });
  const json = await res.json().catch(() => null);
  const url = json?.data?.downloadUrl;
  if (!res.ok || !url) {
    throw new Error(`kie.ai file upload failed (${res.status}): ${json?.msg ?? "no downloadUrl"}`);
  }
  return url as string;
}

function uploadOne(input: string, apiKey: string): Promise<string> {
  const hit = uploadCache.get(input);
  if (hit && Date.now() - hit.at < UPLOAD_CACHE_TTL_MS) return hit.p;
  const p = doUpload(input, apiKey);
  uploadCache.set(input, { p, at: Date.now() });
  // Don't pin a failure — the next attempt should retry the upload.
  p.catch(() => uploadCache.delete(input));
  return p;
}

/**
 * Push one local `/generated/...` path or `data:` URL to kie.ai's temporary
 * file store (kept 3 days) and return its public URL. `lib/mediaHost.ts` uses
 * this as the fallback host for Revana inputs when a kie.ai key is configured.
 */
export function uploadToKieTempStore(input: string, apiKey: string): Promise<string> {
  return uploadOne(input, apiKey);
}

/**
 * Return the input list with any locally-hosted image swapped for a kie.ai
 * temporary URL. Already-public URLs pass through untouched. Throws if an upload
 * fails (the caller surfaces it — a silently dropped reference image is worse).
 */
export async function ensureKieReachableImages(urls: string[], apiKey: string): Promise<string[]> {
  return Promise.all(urls.map((u) => (isRemotelyReachable(u) ? Promise.resolve(u) : uploadOne(u, apiKey))));
}

/**
 * Deep-walk a kie.ai `input` payload and replace every local `/generated/...` or
 * `data:` media reference (in strings, arrays, and nested objects) with a kie.ai
 * temporary URL. Mutates in place. Use for the video route, whose payload shape
 * varies a lot between model families.
 */
export async function rewriteLocalMediaForKie(node: unknown, apiKey: string): Promise<void> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string" && isLocalMedia(node[i])) {
        node[i] = await uploadOne(node[i], apiKey);
      } else {
        await rewriteLocalMediaForKie(node[i], apiKey);
      }
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && isLocalMedia(value)) {
        (node as Record<string, unknown>)[key] = await uploadOne(value, apiKey);
      } else {
        await rewriteLocalMediaForKie(value, apiKey);
      }
    }
  }
}
