/**
 * POST /api/improve-prompt — the Create composer's "Improve prompt" button.
 *
 * Body: CoachRequest (lib/promptCoach.ts) — the rough idea, the target model
 * and its settings, and the attached media as @image1 … tags with small JPEG
 * copies. Answers { prompt, backend } with a full shot-by-shot prompt.
 *
 * Runs on Claude Sonnet 5.5: directly with the user's Anthropic key when one
 * is saved, else through kie.ai's Claude proxy with the Kie.ai key.
 */
import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { askAnthropic, askKieClaude, claudeBackend, claudeKeys, describeAnthropicError } from "@/lib/claude";
import {
  COACH_MAX_IMAGES,
  PROMPT_COACH_SYSTEM,
  coachBrief,
  extractCoachPrompt,
  type CoachRequest,
} from "@/lib/promptCoach";

export const maxDuration = 300;

const COACH_MODEL = "claude-sonnet-5-5";
const MAX_IMAGE_CHARS = 1_500_000; // one ≤1024 px JPEG data URL is far below this
const MAX_TOTAL_CHARS = 12_000_000;

type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function parseDataUrl(url: unknown): { media: ImageMedia; data: string } | null {
  if (typeof url !== "string" || url.length > MAX_IMAGE_CHARS) return null;
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (!m || !IMAGE_TYPES.has(m[1].toLowerCase())) return null;
  return { media: m[1].toLowerCase() as ImageMedia, data: m[2] };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_TOTAL_CHARS) return bad("Too much attached media — remove a few references and try again.", 413);

  let body: CoachRequest;
  try {
    body = JSON.parse(raw) as CoachRequest;
  } catch {
    return bad("Invalid JSON body.");
  }
  if (!body || (body.kind !== "video" && body.kind !== "image") || !body.model?.id) {
    return bad("kind and model are required.");
  }
  const req0: CoachRequest = {
    idea: typeof body.idea === "string" ? body.idea.slice(0, 30_000) : "",
    kind: body.kind,
    model: body.model,
    references: Array.isArray(body.references) ? body.references.slice(0, 60) : [],
    frames: Array.isArray(body.frames) ? body.frames.slice(0, 2) : [],
  };
  if (!req0.idea.trim() && req0.references.length === 0 && req0.frames.length === 0) {
    return bad("Write a rough idea or attach a reference first.");
  }

  const keys = claudeKeys();
  const backend = claudeBackend(keys);
  if (!backend) {
    return bad("Add a Claude (Anthropic) or Kie.ai API key in Settings → API Keys to improve prompts.", 401);
  }

  // Pictures first, each labelled, then the brief (vision works best that way).
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let shown = 0;
  const addImage = (label: string, dataUrl: string | undefined) => {
    const img = parseDataUrl(dataUrl);
    if (!img || shown >= COACH_MAX_IMAGES) return;
    shown++;
    content.push({ type: "text", text: label });
    content.push({ type: "image", source: { type: "base64", media_type: img.media, data: img.data } });
  };
  for (const f of req0.frames) addImage(f.role === "start" ? "Start frame:" : "End frame:", f.dataUrl);
  if (!req0.frames.length) {
    for (const r of req0.references) {
      if (!r.sent || r.kind === "audio") continue;
      addImage(`@${r.tag}${r.kind === "video" ? " (one frame of the reference video)" : ""}:`, r.dataUrl);
    }
  }
  content.push({ type: "text", text: coachBrief(req0) });

  try {
    let reply: string;
    if (backend === "anthropic") {
      const res = await askAnthropic(keys.anthropic!, {
        model: COACH_MODEL,
        system: PROMPT_COACH_SYSTEM,
        content,
      });
      if (res.refused) return bad("Claude declined to write this prompt. Try rephrasing the idea.", 422);
      reply = res.text;
    } else {
      reply = await askKieClaude(keys.kie!, {
        model: COACH_MODEL,
        system: PROMPT_COACH_SYSTEM,
        content,
      });
    }
    const prompt = extractCoachPrompt(reply);
    if (!prompt) return bad("Claude sent back an empty prompt. Try again.", 502);
    const max = req0.model.promptMaxLength;
    return NextResponse.json({ prompt: max && prompt.length > max ? prompt.slice(0, max) : prompt, backend });
  } catch (e) {
    if (backend === "anthropic") {
      const { status, message } = describeAnthropicError(e);
      console.error("[improve-prompt] Anthropic error", status, message);
      return bad(message, status);
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[improve-prompt] kie.ai error", message);
    return bad(message, /invalid kie\.ai api key/i.test(message) ? 401 : 502);
  }
}
