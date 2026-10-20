/**
 * Media inputs for the MCP generate tools. Each input may be:
 *   - an absolute local file path (C:\…\shot.png, /Users/…/clip.mp4, file:// URL)
 *   - a data: URL
 *   - an https URL (passed through; the generate routes fetch / re-host it)
 *   - a CactusGen library URL (/generated/… or http://127.0.0.1:<port>/generated/…)
 * Local files and data: URLs are imported into the library exactly like
 * /api/upload-asset does (stored under MEDIA_DIR, recorded as an upload), so
 * they show up in the gallery and the generation history points at them.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadBuffer } from "@/lib/storage";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { isLoopbackHost } from "./security";

export type MediaKind = "image" | "video" | "audio";

const MAX_BYTES = 100 * 1024 * 1024;

const MIME_BY_EXT: Record<string, { mime: string; kind: MediaKind }> = {
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
  ".m4v": { mime: "video/mp4", kind: "video" },
  ".mp3": { mime: "audio/mpeg", kind: "audio" },
  ".wav": { mime: "audio/wav", kind: "audio" },
  ".m4a": { mime: "audio/mp4", kind: "audio" },
  ".ogg": { mime: "audio/ogg", kind: "audio" },
};

export class MediaInputError extends Error {}

/** Image bytes must really be an image (a renamed text file is refused). */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const png = buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG";
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const gif = buf.toString("ascii", 0, 4) === "GIF8";
  const webp = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  return png || jpg || gif || webp;
}

async function store(buf: Buffer, mime: string, kind: MediaKind, field: string): Promise<string> {
  if (buf.byteLength > MAX_BYTES) throw new MediaInputError(`${field}: file is over the 100 MB limit.`);
  if (kind === "image" && !looksLikeImage(buf)) throw new MediaInputError(`${field}: that file isn't a PNG, JPEG, WebP or GIF image.`);
  const folder = kind === "video" ? "references" : "uploads";
  const url = await uploadBuffer(buf, mime, folder);
  guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: url, mime_type: mime, source: "user_upload" });
  return url;
}

function libraryPath(pathname: string): string {
  const rel = normalize(decodeURIComponent(pathname.slice("/generated/".length)));
  if (rel.startsWith("..") || rel.includes("\0")) throw new MediaInputError("Invalid library path.");
  if (!existsSync(join(MEDIA_DIR, rel))) throw new MediaInputError(`Not in the CactusGen library: ${pathname}`);
  return `/generated/${rel.split("\\").join("/")}`;
}

/** Turn one tool input into something the generate routes accept (/generated/… or https). */
export async function importMediaInput(raw: unknown, want: MediaKind, field: string): Promise<string> {
  if (typeof raw !== "string" || !raw.trim()) throw new MediaInputError(`${field}: expected a file path, an https URL or a data: URL.`);
  const input = raw.trim();

  if (input.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(input);
    if (!m) throw new MediaInputError(`${field}: only base64 data: URLs are supported.`);
    const mime = m[1].toLowerCase();
    if (!mime.startsWith(`${want}/`)) throw new MediaInputError(`${field}: expected ${want} data, got ${mime}.`);
    return store(Buffer.from(m[2], "base64"), mime, want, field);
  }

  if (input.startsWith("/generated/")) return libraryPath(input.split(/[?#]/)[0]);

  if (/^https?:\/\//i.test(input)) {
    let u: URL;
    try { u = new URL(input); } catch { throw new MediaInputError(`${field}: not a valid URL.`); }
    if (isLoopbackHost(u.host)) {
      if (u.pathname.startsWith("/generated/")) return libraryPath(u.pathname);
      throw new MediaInputError(`${field}: local URLs must point at /generated/… files.`);
    }
    if (u.protocol !== "https:") throw new MediaInputError(`${field}: remote URLs must use https.`);
    return u.toString();
  }

  let filePath = input;
  if (input.toLowerCase().startsWith("file://")) {
    try { filePath = fileURLToPath(input); } catch { throw new MediaInputError(`${field}: not a valid file:// URL.`); }
  }
  if (!isAbsolute(filePath)) {
    throw new MediaInputError(`${field}: use an absolute file path (e.g. C:\\Users\\me\\shot.png), an https URL or a data: URL.`);
  }
  const type = MIME_BY_EXT[extname(filePath).toLowerCase()];
  if (!type || type.kind !== want) {
    const allowed = Object.entries(MIME_BY_EXT).filter(([, t]) => t.kind === want).map(([e]) => e).join(" ");
    throw new MediaInputError(`${field}: expected a ${want} file (${allowed}).`);
  }
  let size: number;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error("not a file");
    size = s.size;
  } catch {
    throw new MediaInputError(`${field}: file not found: ${filePath}`);
  }
  if (size > MAX_BYTES) throw new MediaInputError(`${field}: file is over the 100 MB limit.`);
  return store(await readFile(filePath), type.mime, want, field);
}

export async function importMediaList(raw: unknown, want: MediaKind, field: string, max: number): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new MediaInputError(`${field}: expected an array.`);
  if (raw.length > max) throw new MediaInputError(`${field}: at most ${max} items.`);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) out.push(await importMediaInput(raw[i], want, `${field}[${i}]`));
  return out;
}

/** /generated/… → absolute path on disk (null for remote URLs). */
export function localPathOf(url: string): string | null {
  if (!url.startsWith("/generated/")) return null;
  const rel = normalize(decodeURIComponent(url.slice("/generated/".length).split(/[?#]/)[0]));
  if (rel.startsWith("..")) return null;
  return join(MEDIA_DIR, rel);
}
