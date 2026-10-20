"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — job queue. Submits to /api/generate-video, then follows each
// task the same way the canvas does (SSE on /api/job-stream), falling back to
// /api/job-status when the stream drops or hits its 12-minute cap. Jobs are
// persisted so in-flight generations resume after a reload.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/galleryUtils";
import { browserNotify } from "@/lib/browserNotify";
import { findVideoModel } from "./modelCaps";
import { type CreateJob, type JobSettings, loadJobs, newId, rememberMeta, saveJobs } from "./shared";

type JobPayload = { status: string; videoUrl?: string; error?: string };
type WatchResult = { status: "done"; videoUrl?: string } | { status: "error"; error: string } | null;

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
    if (payload?.status === "done") return { status: "done", videoUrl: payload.videoUrl };
    const notFound = payload?.error === "Job not found";
    const transient = !payload || notFound || payload.error === "Generation timed out";
    if (payload?.status === "error" && !transient) return { status: "error", error: payload.error || "Generation failed" };

    // Stream dropped or hit its time cap — ask the status endpoint what's really going on.
    try {
      const res = await fetch(`/api/job-status?taskId=${encodeURIComponent(taskId)}`, { signal });
      const s = (await res.json()) as JobPayload;
      if (s.status === "done") return { status: "done", videoUrl: s.videoUrl };
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
  return {
    model: s.model,
    videoModel: s.model, // field name the Kie route reads first
    prompt: s.prompt,
    ...(s.startFrameUrl ? { startFrameUrl: s.startFrameUrl } : {}),
    ...(s.endFrameUrl ? { endFrameUrl: s.endFrameUrl } : {}),
    ...(refs.length ? { referenceImageUrls: refs } : {}),
    ...(s.videoUrl ? { videoRefUrl: s.videoUrl } : {}),
    // Seedance 2.5 Edit on Kie.ai reads its input clip from referenceVideoUrls
    ...(s.videoUrl && s.videoKey === "referenceVideo" ? { referenceVideoUrls: [s.videoUrl] } : {}),
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

export function useCreateJobs({
  debugMode,
  onJobDone,
}: {
  debugMode: boolean;
  onJobDone: (job: CreateJob) => void;
}) {
  const [jobs, setJobs] = useState<CreateJob[]>(loadJobs);
  const watchersRef = useRef(new Map<string, AbortController>());
  const onDoneRef = useRef(onJobDone);

  useEffect(() => { onDoneRef.current = onJobDone; }, [onJobDone]);
  useEffect(() => { saveJobs(jobs); }, [jobs]);

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
        if (result.status === "done") {
          if (result.videoUrl) rememberMeta(result.videoUrl, job.settings, job.createdAt);
          patch(job.id, { status: "done", videoUrl: result.videoUrl, finishedAt });
          onDoneRef.current({ ...job, status: "done", videoUrl: result.videoUrl, finishedAt });
          window.dispatchEvent(new Event("credits-refresh"));
          browserNotify("Video ready", (job.settings.prompt || "Your video is ready").slice(0, 100));
        } else {
          patch(job.id, { status: "error", error: result.error, finishedAt });
          browserNotify("Generation failed", result.error.slice(0, 100));
        }
      });
    }
  }, [jobs, patch]);

  // Stop following on unmount; resumed from localStorage next time the page mounts.
  useEffect(() => {
    const watchers = watchersRef.current;
    return () => {
      watchers.forEach((c) => c.abort());
      watchers.clear();
    };
  }, []);

  const submit = useCallback(async (settings: JobSettings) => {
    const job: CreateJob = { id: newId(), status: "submitting", createdAt: new Date().toISOString(), settings };
    const body = buildRequestBody(settings);

    if (debugMode) {
      console.log("[Create · debug] POST /api/generate-video (not sent)", body);
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
      const res = await fetch("/api/generate-video", {
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
  }, [debugMode, patch]);

  const dismiss = useCallback((id: string) => {
    const ctrl = watchersRef.current.get(id);
    if (ctrl) {
      ctrl.abort();
      watchersRef.current.delete(id);
    }
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  /** Drop finished jobs once their video is part of the loaded history. */
  const pruneDone = useCallback((historyUrls: Set<string>) => {
    setJobs((prev) => {
      const next = prev.filter((j) => !(j.status === "done" && j.videoUrl && historyUrls.has(j.videoUrl)));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  return { jobs, submit, dismiss, pruneDone };
}
