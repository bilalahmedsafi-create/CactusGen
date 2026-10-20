/**
 * Background poller for Revana jobs — the Revana twin of lib/kieJobPoller.
 *
 * Polls `GET /v1/generations/{id}` every 4 s (honouring Retry-After) until the
 * job succeeds or fails. On success the output is downloaded with the API key
 * straight away (Revana's files expire), saved into local storage, and the job
 * is settled exactly like a kie.ai job: jobStore, the `job:<taskId>` event for
 * the SSE stream, and the guest DB row.
 *   video → the first file (`/content`), settled as `videoUrl`
 *   image → every file (`/content`, `/content/2`, …), settled as `imageUrl` + `imageUrls`
 *
 * HeliosGen task IDs for these jobs are `REVANA_TASK_PREFIX + <Revana id>`.
 */
import { settle } from "./kieJobPoller";
import { uploadBuffer } from "./storage";
import { REVANA_TASK_PREFIX } from "./revanaModels";
import { REVANA_API_BASE, friendlyRevanaError, parseRetryAfter } from "./revana";
import * as guestDb from "./guest/db";

type Kind = "image" | "video";

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 45 * 60 * 1000; // long (up to 30 s) clips render slowly; Revana may finish a running route up to 40 min
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_ATTEMPTS = 3;
const MAX_IMAGE_FILES = 16;

// Tasks currently being polled by this process — guards against double-starts.
const active = new Set<string>();

export function isRevanaTaskId(taskId: string): boolean {
  return taskId.startsWith(REVANA_TASK_PREFIX);
}

/** Start polling a Revana job in the background. Safe to call more than once. */
export function pollRevanaJob(taskId: string, apiKey: string, kind: Kind = "video"): void {
  if (!isRevanaTaskId(taskId) || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, apiKey, kind)
    .catch((e) => {
      console.error(`[revana-poller] ${taskId} crashed:`, e);
      settle(taskId, kind, { status: "error", error: "Generation failed (poller error)" });
    })
    .finally(() => active.delete(taskId));
}

/**
 * Resume polling a Revana job whose poller was lost to a server restart. No-op
 * if already polling, if the task isn't a Revana job, or if no key is saved.
 */
export function resumeRevanaJob(taskId: string, kind: Kind = "video"): void {
  if (!isRevanaTaskId(taskId) || active.has(taskId)) return;
  const key = guestDb.getRevanaApiKey();
  if (!key) return;
  pollRevanaJob(taskId, key, kind);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RevanaGeneration {
  status?: "queued" | "running" | "succeeded" | "failed";
  output?: { urls?: string[] } | null;
  error?: { code?: string; message?: string } | null;
}

async function loop(taskId: string, apiKey: string, kind: Kind): Promise<void> {
  const id = taskId.slice(REVANA_TASK_PREFIX.length);
  const deadline = Date.now() + MAX_POLL_MS;
  let delay = kind === "image" ? 2_500 : POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = POLL_INTERVAL_MS;

    let res: Response;
    try {
      res = await fetch(`${REVANA_API_BASE}/generations/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      console.warn(`[revana-poller] ${taskId} transient poll error:`, (e as Error).message);
      continue;
    }

    // Rate-limited or Revana hiccup → wait (Retry-After if given) and ask again.
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      delay = Math.max(POLL_INTERVAL_MS, Math.min(60_000, (retryAfter ?? 0) * 1000));
      continue;
    }

    const gen = (await res.json().catch(() => null)) as RevanaGeneration | null;
    if (!res.ok) {
      // 401 (key removed/changed) or 404 (unknown id) won't fix themselves.
      const err = (gen as { error?: { code?: string; message?: string } } | null)?.error;
      settle(taskId, kind, { status: "error", error: friendlyRevanaError(res.status, err?.code, err?.message) });
      return;
    }

    if (gen?.status === "succeeded") {
      if (kind === "image") await settleImages(taskId, id, apiKey, gen);
      else await settleVideo(taskId, id, apiKey, gen);
      return;
    }
    if (gen?.status === "failed") {
      settle(taskId, kind, { status: "error", error: gen.error?.message || "Generation failed" });
      return;
    }
    // queued / running → keep polling
  }

  settle(taskId, kind, { status: "error", error: "Generation timed out (Revana took longer than 30 minutes)" });
}

/** File type from its first bytes — CDN redirects often answer application/octet-stream. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/**
 * Download one result file — `/content` for the first, `/content/<n>` after.
 * The key goes to Revana only, never to a redirect target.
 */
async function downloadContent(id: string, apiKey: string, index: number, kind: Kind): Promise<{ buf: Buffer; contentType: string }> {
  const url = `${REVANA_API_BASE}/generations/${encodeURIComponent(id)}/content${index > 1 ? `/${index}` : ""}`;
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "manual", signal });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new Error(`HTTP ${res.status} without a Location header`);
    // A short-lived signed file URL — fetched without the key.
    res = await fetch(new URL(location, url), { signal });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("empty file");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (kind === "video") return { buf, contentType: type.startsWith("video/") ? type : "video/mp4" };
  return { buf, contentType: type.startsWith("image/") ? type : sniffImageType(buf) ?? "image/png" };
}

/** Download + save one file into local storage (3 tries). Null when it couldn't. */
async function fetchAndStore(taskId: string, id: string, apiKey: string, index: number, kind: Kind): Promise<string | null> {
  let file: { buf: Buffer; contentType: string } | null = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS && !file; attempt++) {
    try {
      file = await downloadContent(id, apiKey, index, kind);
    } catch (e) {
      console.warn(`[revana-poller] ${taskId} file ${index} download attempt ${attempt} failed:`, (e as Error).message);
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(3_000);
    }
  }
  if (!file) return null;
  try {
    return await uploadBuffer(file.buf, file.contentType, kind === "video" ? "videos" : "images");
  } catch (e) {
    console.error(`[revana-poller] ${taskId} saving file ${index} to local storage failed:`, (e as Error).message);
    return null;
  }
}

async function settleVideo(taskId: string, id: string, apiKey: string, gen: RevanaGeneration): Promise<void> {
  // Last resort, like the kie.ai poller: Revana's own (expiring) file URL.
  const videoUrl = (await fetchAndStore(taskId, id, apiKey, 1, "video")) ?? gen.output?.urls?.[0];
  if (!videoUrl) {
    settle(taskId, "video", {
      status: "error",
      error: "Revana finished the video but it couldn't be downloaded — check your generations at revana.si.",
    });
    return;
  }
  settle(taskId, "video", { status: "done", videoUrl });
}

async function settleImages(taskId: string, id: string, apiKey: string, gen: RevanaGeneration): Promise<void> {
  const remote = gen.output?.urls ?? [];
  const count = Math.min(MAX_IMAGE_FILES, Math.max(1, remote.length));
  const stored = await Promise.all(
    Array.from({ length: count }, (_, i) => fetchAndStore(taskId, id, apiKey, i + 1, "image")),
  );
  // A file that couldn't be saved falls back to Revana's (expiring) URL for it.
  const imageUrls = stored
    .map((u, i) => u ?? remote[i])
    .filter((u): u is string => typeof u === "string" && !!u);

  if (imageUrls.length === 0) {
    settle(taskId, "image", {
      status: "error",
      error: "Revana finished the picture but it couldn't be downloaded — check your generations at revana.si.",
    });
    return;
  }
  settle(taskId, "image", { status: "done", imageUrl: imageUrls[0], imageUrls });
}
