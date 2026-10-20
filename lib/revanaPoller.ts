/**
 * Background poller for Revana video jobs — the Revana twin of lib/kieJobPoller.
 *
 * Polls `GET /v1/generations/{id}` every 4 s (honouring Retry-After) until the
 * job succeeds or fails. On success the first file is downloaded from
 * `/content` with the API key straight away (Revana's files expire), saved into
 * local storage, and the job is settled exactly like a kie.ai job: jobStore,
 * the `job:<taskId>` event for the SSE stream, and the guest DB row.
 *
 * HeliosGen task IDs for these jobs are `REVANA_TASK_PREFIX + <Revana id>`.
 */
import { settle } from "./kieJobPoller";
import { uploadBuffer } from "./storage";
import { REVANA_TASK_PREFIX } from "./revanaModels";
import { REVANA_API_BASE, friendlyRevanaError, parseRetryAfter } from "./revana";
import * as guestDb from "./guest/db";

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 45 * 60 * 1000; // long (up to 30 s) clips render slowly; Revana may finish a running route up to 40 min
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_ATTEMPTS = 3;

// Tasks currently being polled by this process — guards against double-starts.
const active = new Set<string>();

export function isRevanaTaskId(taskId: string): boolean {
  return taskId.startsWith(REVANA_TASK_PREFIX);
}

/** Start polling a Revana job in the background. Safe to call more than once. */
export function pollRevanaJob(taskId: string, apiKey: string): void {
  if (!isRevanaTaskId(taskId) || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, apiKey)
    .catch((e) => {
      console.error(`[revana-poller] ${taskId} crashed:`, e);
      settle(taskId, "video", { status: "error", error: "Generation failed (poller error)" });
    })
    .finally(() => active.delete(taskId));
}

/**
 * Resume polling a Revana job whose poller was lost to a server restart. No-op
 * if already polling, if the task isn't a Revana job, or if no key is saved.
 */
export function resumeRevanaJob(taskId: string): void {
  if (!isRevanaTaskId(taskId) || active.has(taskId)) return;
  const key = guestDb.getRevanaApiKey();
  if (!key) return;
  pollRevanaJob(taskId, key);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RevanaGeneration {
  status?: "queued" | "running" | "succeeded" | "failed";
  output?: { urls?: string[] } | null;
  error?: { code?: string; message?: string } | null;
}

async function loop(taskId: string, apiKey: string): Promise<void> {
  const id = taskId.slice(REVANA_TASK_PREFIX.length);
  const deadline = Date.now() + MAX_POLL_MS;
  let delay = POLL_INTERVAL_MS;

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
      settle(taskId, "video", { status: "error", error: friendlyRevanaError(res.status, err?.code, err?.message) });
      return;
    }

    if (gen?.status === "succeeded") {
      await settleSuccess(taskId, id, apiKey, gen);
      return;
    }
    if (gen?.status === "failed") {
      settle(taskId, "video", { status: "error", error: gen.error?.message || "Generation failed" });
      return;
    }
    // queued / running → keep polling
  }

  settle(taskId, "video", { status: "error", error: "Generation timed out (Revana took longer than 30 minutes)" });
}

/** Download the first result file. The key goes to Revana only, never to a redirect target. */
async function downloadContent(id: string, apiKey: string): Promise<{ buf: Buffer; contentType: string }> {
  const url = `${REVANA_API_BASE}/generations/${encodeURIComponent(id)}/content`;
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
  // CDN redirects often answer application/octet-stream; video models return mp4.
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  return { buf, contentType: type.startsWith("video/") ? type : "video/mp4" };
}

async function settleSuccess(taskId: string, id: string, apiKey: string, gen: RevanaGeneration): Promise<void> {
  let file: { buf: Buffer; contentType: string } | null = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS && !file; attempt++) {
    try {
      file = await downloadContent(id, apiKey);
    } catch (e) {
      console.warn(`[revana-poller] ${taskId} download attempt ${attempt} failed:`, (e as Error).message);
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(3_000);
    }
  }

  let videoUrl: string | undefined;
  if (file) {
    try {
      videoUrl = await uploadBuffer(file.buf, file.contentType, "videos");
    } catch (e) {
      console.error(`[revana-poller] ${taskId} saving to local storage failed:`, (e as Error).message);
    }
  }
  // Last resort, like the kie.ai poller: Revana's own (expiring) file URL.
  videoUrl ??= gen.output?.urls?.[0];

  if (!videoUrl) {
    settle(taskId, "video", {
      status: "error",
      error: "Revana finished the video but it couldn't be downloaded — check your generations at revana.si.",
    });
    return;
  }
  settle(taskId, "video", { status: "done", videoUrl });
}
