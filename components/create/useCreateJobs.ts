"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — job queue. Submits to /api/generate-video (video) or
// /api/generate (image), then follows each task the same way the canvas does
// (SSE on /api/job-stream), falling back to /api/job-status when the stream
// drops or hits its time cap. Jobs are persisted (one list per mode) so
// in-flight generations resume after a reload.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/galleryUtils";
import { browserNotify } from "@/lib/browserNotify";
import { findVideoModel } from "./modelCaps";
import { type CreateJob, type CreateKind, type JobSettings, loadJobs, newId, parseRatio, rememberMeta, saveJobs } from "./shared";

/** How often the page looks for generations started elsewhere (MCP, gallery, canvas). */
const ADOPT_EVERY_MS = 8000;

interface ActiveRow {
  task_id: string;
  model: string | null;
  prompt: string;
  aspect_ratio: string | null;
  duration: number | null;
  sound: boolean;
  quality: string | null;
  reference_image_urls: string[];
  created_at: string;
}

/** A job card for a generation this page didn't start. */
function externalJob(row: ActiveRow, kind: CreateKind): CreateJob {
  return {
    id: newId(),
    taskId: row.task_id,
    status: "pending",
    createdAt: row.created_at,
    external: true,
    settings: {
      kind,
      model: row.model ?? "",
      provider: row.task_id.startsWith("revana-") ? "revana" : "kie",
      prompt: row.prompt,
      duration: row.duration && row.duration > 0 ? row.duration : 0,
      resolution: kind === "image" ? (row.quality ?? "").toUpperCase() : "",
      aspectRatio: row.aspect_ratio ?? "",
      sound: row.sound,
      referenceImageUrls: row.reference_image_urls ?? [],
      ratioHint: parseRatio(row.aspect_ratio),
    },
  };
}

type JobPayload = { status: string; videoUrl?: string; imageUrl?: string; imageUrls?: string[]; error?: string };
type WatchResult = { status: "done"; urls: string[] } | { status: "error"; error: string } | null;

/** Give up following a task after an hour (e.g. a provider that never calls back). */
const HARD_LIMIT_MS = 60 * 60 * 1000;
const DEBUG_DELAY_MS = 2500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** Every result URL a settled job carries (video, or the pictures in order). */
function payloadUrls(p: JobPayload): string[] {
  if (p.videoUrl) return [p.videoUrl];
  const list = p.imageUrls?.length ? p.imageUrls : p.imageUrl ? [p.imageUrl] : [];
  return [...new Set(list.filter(Boolean))];
}

/** One SSE round: resolves with the job-stream payload, or null if the connection failed. */
function streamOnce(taskId: string, signal: AbortSignal): Promise<JobPayload | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const es = new EventSource(`/api/job-stream?taskId=${encodeURIComponent(taskId)}`);
    let settled = false;
    const finish = (value: JobPayload | null) => {
      if (settled) return;
      settled = true;
      es.close();
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    es.onmessage = (ev) => {
      try { finish(JSON.parse(ev.data) as JobPayload); } catch { finish(null); }
    };
    es.onerror = () => finish(null);
    signal.addEventListener("abort", onAbort);
  });
}

async function watchTask(taskId: string, createdAt: string, signal: AbortSignal): Promise<WatchResult> {
  const started = new Date(createdAt).getTime() || Date.now();
  let failures = 0;
  while (!signal.aborted) {
    if (Date.now() - started > HARD_LIMIT_MS) {
      return { status: "error", error: "No result after 60 minutes. If the provider delivers it later, it will appear in your history." };
    }
    const payload = await streamOnce(taskId, signal);
    if (signal.aborted) return null;
    if (payload?.status === "done") return { status: "done", urls: payloadUrls(payload) };
    const notFound = payload?.error === "Job not found";
    const transient = !payload || notFound || payload.error === "Generation timed out";
    if (payload?.status === "error" && !transient) return { status: "error", error: payload.error || "Generation failed" };

    // Stream dropped or hit its time cap — ask the status endpoint what's really going on.
    try {
      const res = await fetch(`/api/job-status?taskId=${encodeURIComponent(taskId)}`, { signal });
      const s = (await res.json()) as JobPayload;
      if (s.status === "done") return { status: "done", urls: payloadUrls(s) };
      if (s.status === "error") return { status: "error", error: s.error || "Generation failed" };
      if (s.status === "not_found") {
        return { status: "error", error: "The server has no record of this job any more. If it finished, it is in your history." };
      }
      failures = 0;
    } catch {
      if (signal.aborted) return null;
      failures++;
    }
    // job-stream can't follow a task it has no live record of ("Job not found")
    // even while job-status still reports it pending — poll gently in that case.
    await sleep(failures ? Math.min(15_000, 2_000 * 2 ** Math.min(failures, 3)) : notFound ? 5_000 : 2_000, signal);
  }
  return null;
}

/** JSON body for POST /api/generate-video. */
export function buildRequestBody(s: JobSettings): Record<string, unknown> {
  const refs = s.referenceImageUrls ?? [];
  const isVeo = !!findVideoModel(s.model).apiInput.useGoogleVeo;
  // Seedance 2.5 Edit on Kie.ai reads its input clip from referenceVideoUrls
  const editClip = s.videoUrl && s.videoKey === "referenceVideo" ? [s.videoUrl] : [];
  const refVideos = [...editClip, ...(s.referenceVideoUrls ?? [])];
  const refAudios = s.referenceAudioUrls ?? [];
  return {
    model: s.model,
    videoModel: s.model, // field name the Kie route reads first
    prompt: s.prompt,
    ...(s.startFrameUrl ? { startFrameUrl: s.startFrameUrl } : {}),
    ...(s.endFrameUrl ? { endFrameUrl: s.endFrameUrl } : {}),
    ...(refs.length ? { referenceImageUrls: refs } : {}),
    ...(s.videoUrl ? { videoRefUrl: s.videoUrl } : {}),
    ...(refVideos.length ? { referenceVideoUrls: refVideos } : {}),
    ...(refAudios.length ? { referenceAudioUrls: refAudios } : {}),
    duration: s.duration,
    resolution: s.resolution,
    aspectRatio: s.aspectRatio,
    sound: s.sound,
    // Only an explicit choice is sent, like the gallery: without one the server
    // falls back to Revana when that's the only key saved.
    ...(s.providerSaved ? { provider: s.providerSaved } : {}),
    ...(s.mode ? { mode: s.mode } : {}),
    ...(isVeo && refs.length ? { veoMode: "references" } : {}),
  };
}

/**
 * JSON body for POST /api/generate (pictures). The backend is always explicit
 * here: image mode resolves Kie.ai vs Revana itself (see imageCaps.ts).
 * `quality` is the kie.ai spelling ("2k"), `resolution` Revana's ("2K").
 */
export function buildImageRequestBody(s: JobSettings): Record<string, unknown> {
  const refs = s.referenceImageUrls ?? [];
  return {
    model: s.model,
    prompt: s.prompt,
    imageUrls: refs,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    quality: s.resolution.toLowerCase(),
    provider: s.provider,
  };
}

export function useCreateJobs({
  kind = "video",
  debugMode,
  onJobDone,
}: {
  kind?: CreateKind;
  debugMode: boolean;
  onJobDone: (job: CreateJob) => void;
}) {
  const [jobs, setJobs] = useState<CreateJob[]>(() => loadJobs(kind));
  const watchersRef = useRef(new Map<string, AbortController>());
  const onDoneRef = useRef(onJobDone);

  useEffect(() => { onDoneRef.current = onJobDone; }, [onJobDone]);
  useEffect(() => { saveJobs(jobs, kind); }, [jobs, kind]);

  const patch = useCallback((id: string, update: Partial<CreateJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...update } : j)));
  }, []);

  // Follow every pending task that isn't followed yet (new submissions + resumed ones).
  useEffect(() => {
    const watchers = watchersRef.current;
    for (const job of jobs) {
      if (job.status !== "pending" || !job.taskId || job.debug || watchers.has(job.id)) continue;
      const ctrl = new AbortController();
      watchers.set(job.id, ctrl);
      watchTask(job.taskId, job.createdAt, ctrl.signal).then((result) => {
        if (watchers.get(job.id) === ctrl) watchers.delete(job.id);
        if (!result) return; // aborted (unmount / dismissed)
        const finishedAt = new Date().toISOString();
        const noun = kind === "image" ? "Image" : "Video";
        if (result.status === "done") {
          const urls = result.urls;
          // Picked-up jobs only know what the history row knows — "Reuse" reads that row instead.
          if (!job.external) urls.forEach((u) => rememberMeta(u, job.settings, job.createdAt));
          const update: Partial<CreateJob> = {
            status: "done",
            urls,
            ...(kind === "video" ? { videoUrl: urls[0] } : {}),
            finishedAt,
          };
          patch(job.id, update);
          onDoneRef.current({ ...job, ...update });
          window.dispatchEvent(new Event("credits-refresh"));
          browserNotify(`${noun} ready`, (job.settings.prompt || `Your ${noun.toLowerCase()} is ready`).slice(0, 100));
        } else {
          patch(job.id, { status: "error", error: result.error, finishedAt });
          browserNotify("Generation failed", result.error.slice(0, 100));
        }
      });
    }
  }, [jobs, patch, kind]);

  // Stop following on unmount; resumed from localStorage next time the page mounts.
  useEffect(() => {
    const watchers = watchersRef.current;
    return () => {
      watchers.forEach((c) => c.abort());
      watchers.clear();
    };
  }, []);

  // Pick up generations started elsewhere — Claude over MCP, the gallery, the
  // canvas — so they run in this feed like the page's own.
  const dismissedTasks = useRef(new Set<string>());
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/generations/active?type=${kind}`, { cache: "no-store" });
        if (!res.ok) return;
        const { items } = (await res.json()) as { items?: ActiveRow[] };
        if (stopped || !items?.length) return;
        setJobs((prev) => {
          // Our own POST may still be waiting for its taskId — try again next round.
          if (prev.some((j) => j.status === "submitting")) return prev;
          const known = new Set(prev.flatMap((j) => (j.taskId ? [j.taskId] : [])));
          const fresh = items.filter((r) => !known.has(r.task_id) && !dismissedTasks.current.has(r.task_id));
          return fresh.length ? [...fresh.map((r) => externalJob(r, kind)), ...prev] : prev;
        });
      } catch { /* offline / server restarting — next round */ }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, ADOPT_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind]);

  const submit = useCallback(async (settings: JobSettings) => {
    const job: CreateJob = { id: newId(), status: "submitting", createdAt: new Date().toISOString(), settings };
    const endpoint = kind === "image" ? "/api/generate" : "/api/generate-video";
    const body = kind === "image" ? buildImageRequestBody(settings) : buildRequestBody(settings);

    if (debugMode) {
      console.log(`[Create · debug] POST ${endpoint} (not sent)`, body);
      setJobs((prev) => [{ ...job, status: "pending", debug: true }, ...prev]);
      setTimeout(() => {
        patch(job.id, {
          status: "error",
          error: "Debug mode is on, so nothing was sent. The request body is in the browser console.",
          finishedAt: new Date().toISOString(),
        });
      }, DEBUG_DELAY_MS);
      return;
    }

    setJobs((prev) => [job, ...prev]);
    try {
      const token = await getToken();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: { taskId?: string; error?: string } = {};
      try { data = JSON.parse(text); } catch {
        throw new Error(res.ok ? "The server sent an unreadable response." : `Server error ${res.status}`);
      }
      if (!res.ok || data.error || !data.taskId) throw new Error(data.error || `Server error ${res.status}`);
      patch(job.id, { status: "pending", taskId: data.taskId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch(job.id, { status: "error", error: msg, finishedAt: new Date().toISOString() });
    }
  }, [debugMode, patch, kind]);

  const dismiss = useCallback((id: string) => {
    const ctrl = watchersRef.current.get(id);
    if (ctrl) {
      ctrl.abort();
      watchersRef.current.delete(id);
    }
    setJobs((prev) => {
      const gone = prev.find((j) => j.id === id);
      if (gone?.taskId) dismissedTasks.current.add(gone.taskId);
      return prev.filter((j) => j.id !== id);
    });
  }, []);

  /** Drop finished jobs once every one of their results is part of the loaded history. */
  const pruneDone = useCallback((historyUrls: Set<string>) => {
    setJobs((prev) => {
      const next = prev.filter((j) => !(j.status === "done" && jobUrls(j).length > 0 && jobUrls(j).every((u) => historyUrls.has(u))));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  return { jobs, submit, dismiss, pruneDone };
}

/** Result URLs of a job (handles jobs saved before `urls` existed). */
export function jobUrls(job: CreateJob): string[] {
  if (job.urls?.length) return job.urls;
  return job.videoUrl ? [job.videoUrl] : [];
}
