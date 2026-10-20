/**
 * "Improve prompt" in the Create composer — the instructions Claude gets and
 * the user turn built from the composer state. Shared by the browser (types)
 * and app/api/improve-prompt (which sends it to Claude).
 *
 * The answer comes back between <prompt> tags so stray preamble never lands
 * in the composer.
 */

export interface CoachReference {
  /** "image1", "video2", "audio1" — what the user can write as @image1 … */
  tag: string;
  kind: "image" | "video" | "audio";
  /** Small JPEG (≤1024 px) data URL so Claude can see it; absent for audio. */
  dataUrl?: string;
  /** Sent with the generation? false when over the model's limit. */
  sent: boolean;
}

export interface CoachFrame {
  role: "start" | "end";
  dataUrl?: string;
}

export interface CoachRequest {
  /** The user's rough idea (may be empty when references say enough). */
  idea: string;
  kind: "video" | "image";
  model: {
    id: string;
    name: string;
    /** Seconds of the clip (video only); null = set by the model / the input clip. */
    durationSec?: number | null;
    resolution?: string;
    aspectRatio?: string;
    /** Video: will the clip have generated sound? */
    sound?: boolean;
    /** Video: can this model make sound at all? */
    soundSupported?: boolean;
    /** Edits an input video rather than making one from scratch. */
    editsVideo?: boolean;
    promptMaxLength?: number | null;
  };
  references: CoachReference[];
  /** Start / end frames (video). When present, references are not sent. */
  frames: CoachFrame[];
}

/** Images (references + frames) Claude actually sees; the rest go by tag only. */
export const COACH_MAX_IMAGES = 12;

export const PROMPT_COACH_SYSTEM = `You are CactusGen's prompt director. You turn a creator's rough idea into one finished, production-ready prompt for an AI video or image model.

What you receive:
- The rough idea (sometimes only a few words, sometimes empty when the attached media says enough).
- The target model and its settings: clip length, resolution, aspect ratio, whether sound is on.
- The attached reference media, each with its tag (@image1, @image2 …, @video1 …, @audio1 …) in the exact order the model receives them. You can see the images; videos are shown as one frame; audio is listed by tag only.
- Possibly a start frame and/or end frame instead of references.

How references work on these models:
- A tag like @image1 in the prompt points the model at that exact file. Use the tags to say what each reference contributes: the person's identity and face, a product, an outfit, a location, a visual style, a camera move (from a reference video), a voice or music (from a reference audio).
- Use only the tags you are given, spelled exactly (lowercase, no space: @image1). Never invent a tag, never renumber them. If there are no references, write no tags.
- A reference marked "not sent" is over the model's limit: do not mention it.
- A start frame cannot be combined with reference media. When a start frame is set, the clip begins on that picture: describe how the scene moves on from it, and use no @ tags. With an end frame too, describe the journey from the first picture to the last.

Writing a video prompt:
- Write it as a shot list that fits the clip length exactly: "Shot 1 (0–3s): …", "Shot 2 (3–6s): …". Use roughly one shot per 2–4 seconds; a single continuous shot is fine for short clips or when the idea calls for one take.
- For every shot give: framing and lens (e.g. extreme close-up, 35mm, low angle), the camera move (dolly in, orbit, handheld push, crane down, locked-off), what the subject does, the setting, light (direction, quality, color temperature) and mood.
- Open with one line that sets the overall look (genre, era, color grade, film stock or render style) before the shots.
- Sound on: end with a "Sound:" line — ambience, effects timed to the action, music style and energy, and any spoken words in quotes with who says them. Sound off: write nothing about sound.
- When editing an input video, describe only the change to make and what must stay the same.
- Keep motion physically believable, keep one clear hero action per shot, and keep characters and products consistent across shots.

Writing an image prompt:
- One rich paragraph (no shots): subject, composition and framing, lens and depth of field, setting, lighting, color palette, style or medium, mood. Put any text that must appear in the picture in quotes.

Always:
- Keep the creator's intent, subject and any specific detail they gave; improve, don't replace. If their idea is already detailed, tighten and complete it.
- Write in English, in plain sentences without markdown, bullet symbols or headings other than the "Shot N (a–bs):" and "Sound:" labels.
- Stay well under the prompt length limit you are given; aim for 120–350 words for video (longer clips get more) and 60–180 words for images.
- Do not add logos, brand names, real people or on-screen text the creator did not ask for.

Reply with the finished prompt only, between <prompt> and </prompt>. Nothing before or after.`;

/** The text part of the user turn (images are attached separately by the route). */
export function coachBrief(req: CoachRequest): string {
  const m = req.model;
  const lines: string[] = [];
  lines.push(`Target: ${req.kind === "video" ? "video" : "image"} model ${m.name} (${m.id}).`);
  if (req.kind === "video") {
    if (m.editsVideo) lines.push("Mode: edits an input video (the result keeps the input clip's length).");
    else lines.push(`Clip length: ${m.durationSec && m.durationSec > 0 ? `${m.durationSec} seconds` : "set by the model (about 8 seconds)"}.`);
    lines.push(`Sound: ${m.sound ? "on — the model generates audio" : m.soundSupported ? "off" : "this model makes silent clips"}.`);
  }
  if (m.resolution) lines.push(`Resolution: ${m.resolution}.`);
  if (m.aspectRatio) lines.push(`Aspect ratio: ${m.aspectRatio}.`);
  if (m.promptMaxLength) lines.push(`Prompt length limit: ${m.promptMaxLength.toLocaleString("en-US")} characters.`);

  const frames = req.frames.map((f) => (f.role === "start" ? "start frame" : "end frame"));
  if (frames.length) {
    lines.push(`Frames set: ${frames.join(" and ")} (shown below). References are not sent with frames, so use no @ tags.`);
  }
  const sent = req.references.filter((r) => r.sent);
  const unsent = req.references.filter((r) => !r.sent);
  if (!frames.length && sent.length) {
    lines.push(`References, in the order the model receives them: ${sent.map((r) => `@${r.tag} (${r.kind})`).join(", ")}.`);
  } else if (!frames.length) {
    lines.push("References: none.");
  }
  if (unsent.length) lines.push(`Not sent (over the limit, don't mention): ${unsent.map((r) => `@${r.tag}`).join(", ")}.`);

  lines.push("");
  lines.push(req.idea.trim()
    ? `The creator's idea:\n${req.idea.trim()}`
    : "The creator wrote no idea — build the prompt from the attached media and the settings.");
  return lines.join("\n");
}

/** The prompt between <prompt> tags, or the whole reply when the tags are missing. */
export function extractCoachPrompt(reply: string): string {
  const m = /<prompt>([\s\S]*?)(?:<\/prompt>|$)/i.exec(reply);
  return (m ? m[1] : reply).trim();
}
