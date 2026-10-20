"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — "Improve prompt" (sparkle button in the composer). Sends the
// rough idea, the model's abilities and small JPEG copies of the attached media
// (as @image1 … tags) to /api/improve-prompt, which asks Claude Sonnet 5.5 for
// a full shot-by-shot prompt, then swaps it into the composer with one-click
// undo. Works with a Claude (Anthropic) key or, failing that, a Kie.ai key.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "@/lib/store";
import type { CoachRequest } from "@/lib/promptCoach";
import { COACH_MAX_IMAGES } from "@/lib/promptCoach";
import type { MediaItem } from "./shared";
import type { MentionTarget } from "./mentions";
import type { Blocker } from "./Composer";

const MAX_EDGE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

function videoFrame(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const fail = () => reject(new Error("video failed to load"));
    const timer = setTimeout(fail, 8000);
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => { clearTimeout(timer); resolve(v); };
    v.onerror = () => { clearTimeout(timer); fail(); };
    v.src = src;
  });
}

/** A ≤1024 px JPEG data URL of an image (or a video's first moments); undefined when it can't be read. */
export async function mediaToJpeg(item: MediaItem): Promise<string | undefined> {
  if (item.kind === "audio") return undefined;
  const src = item.preview || item.url;
  if (!src) return undefined;
  try {
    const el = item.kind === "video" ? await videoFrame(src) : await loadImage(src);
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return undefined;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

export interface CoachInput {
  idea: string;
  kind: CoachRequest["kind"];
  model: CoachRequest["model"];
  /** Everything mentionable, in tag order. */
  targets: MentionTarget[];
  /** Start / end frames that will be sent (video). */
  frames: { role: "start" | "end"; item: MediaItem }[];
}

export async function buildCoachRequest(input: CoachInput): Promise<CoachRequest> {
  let budget = COACH_MAX_IMAGES;
  const frames = await Promise.all(input.frames.map(async (f) => ({
    role: f.role,
    dataUrl: budget-- > 0 ? await mediaToJpeg(f.item) : undefined,
  })));
  const refs = input.frames.length ? [] : input.targets;
  const references = await Promise.all(refs.map(async (t) => ({
    tag: t.tag,
    kind: t.kind,
    sent: t.sent,
    dataUrl: t.sent && t.kind !== "audio" && budget-- > 0 ? await mediaToJpeg(t.item) : undefined,
  })));
  return { idea: input.idea, kind: input.kind, model: input.model, references, frames };
}

export interface PromptCoach {
  improve: () => void;
  undo: (() => void) | null;
  busy: boolean;
  /** Message for the composer's hint line (errors, missing key). */
  notice: Blocker | null;
  /** A key that can reach Claude is (or may be) saved. */
  available: boolean;
}

export function usePromptCoach({
  prompt,
  setPrompt,
  getInput,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  /** Called on click — collects the composer state at that moment. */
  getInput: () => CoachInput;
}): PromptCoach {
  const anthropicKeySet = useWorkflowStore((s) => s.anthropicKeySet);
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const available = !(anthropicKeySet === false && kieKeySet === false);

  const [busy, setBusy] = useState(false);
  // A notice belongs to the prompt it was about — editing the prompt hides it.
  const [notice, setNotice] = useState<{ prompt: string; value: Blocker } | null>(null);
  const [history, setHistory] = useState<{ before: string; after: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const improve = useCallback(() => {
    if (busy) return;
    if (!available) {
      setNotice({ prompt, value: { text: "Add a Claude (Anthropic) or Kie.ai API key to improve prompts.", action: "settings" } });
      return;
    }
    const input = getInput();
    if (!input.idea.trim() && input.targets.length === 0 && input.frames.length === 0) {
      setNotice({ prompt, value: { text: "Write a rough idea first — Claude turns it into a full prompt." } });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const body = await buildCoachRequest(input);
        const res = await fetch("/api/improve-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { prompt?: string; error?: string };
        if (!res.ok || !data.prompt) {
          setNotice({
            prompt: input.idea,
            value: {
              text: data.error || `Couldn't improve the prompt (error ${res.status}).`,
              ...(res.status === 401 ? { action: "settings" as const } : {}),
            },
          });
          return;
        }
        setHistory({ before: input.idea, after: data.prompt });
        setPrompt(data.prompt);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setNotice({ prompt: input.idea, value: { text: "Couldn't reach the server to improve the prompt." } });
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
      }
    })();
  }, [available, busy, getInput, prompt, setPrompt]);

  // Undo stays offered while the improved prompt is untouched.
  const undo = history && history.after === prompt
    ? () => {
        setPrompt(history.before);
        setHistory(null);
      }
    : null;

  return { improve, undo, busy, notice: notice && notice.prompt === prompt ? notice.value : null, available };
}
