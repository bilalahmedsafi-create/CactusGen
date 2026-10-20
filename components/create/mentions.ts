// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — @mentions of attached reference media (Seedance-style
// multimodal prompts). `@image1` is the first reference image in the order the
// request sends them (`referenceImageUrls` / `image_urls`), `@video1` the first
// reference clip, `@audio1` the first reference sound. Tokens travel to the API
// as plain text; this module only finds, renumbers and checks them.
// Pure functions — no React.
// ─────────────────────────────────────────────────────────────────────────────
import type { MediaItem } from "./shared";

export type MentionKind = "image" | "video" | "audio";

/** One thing the prompt can mention. */
export interface MentionTarget {
  /** "image1" — written in the prompt as @image1. */
  tag: string;
  kind: MentionKind;
  item: MediaItem;
  /** Sent with the current settings? */
  sent: boolean;
  /** Why it isn't sent (shown in the menu and the hint line). */
  note?: string;
}

export interface MentionToken {
  start: number;
  end: number;
  kind: MentionKind;
  n: number;
  tag: string;
}

const tokenRe = () => /@(image|video|audio)([1-9]\d{0,2})(?![\w])/gi;

export function findMentions(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  const re = tokenRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase() as MentionKind;
    const n = Number(m[2]);
    out.push({ start: m.index, end: m.index + m[0].length, kind, n, tag: `${kind}${n}` });
  }
  return out;
}

/** Tags for a list, in order: ["image1", "image2", …]. */
export function tagsFor(kind: MentionKind, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${kind}${i + 1}`);
}

/**
 * Keep @kindN tokens pointing at the same files after the `kind` list changed
 * (removal / reorder). `prevIds[i]` is the id behind @kind(i+1) before, `nextIds`
 * the order after. Tokens of a removed file are taken out of the prompt; tokens
 * beyond the old list (typed by hand) stay untouched.
 */
export function remapMentions(
  prompt: string,
  kind: MentionKind,
  prevIds: string[],
  nextIds: string[],
): { prompt: string; removed: string[] } {
  const removed: string[] = [];
  const REMOVED = "\u0000";
  let changed = false;
  const mapped = prompt.replace(tokenRe(), (match, k: string, n: string) => {
    if (k.toLowerCase() !== kind) return match;
    const id = prevIds[Number(n) - 1];
    if (!id) return match;
    const at = nextIds.indexOf(id);
    if (at < 0) {
      changed = true;
      removed.push(`@${kind}${n}`);
      return REMOVED;
    }
    const next = `@${kind}${at + 1}`;
    if (next !== match) changed = true;
    return next;
  });
  if (!changed) return { prompt, removed };
  // Drop removed tokens with the space before them ("from @image2 and" → "from and").
  const tidy = mapped.replace(/[ \t]?\u0000/g, "");
  return { prompt: tidy, removed: [...new Set(removed)] };
}

/** Moves the item with `fromId` to the position of `toId`; same list if either is missing. */
export function moveItem<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
  const from = list.findIndex((x) => x.id === fromId);
  const to = list.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The @-word being typed at the caret: "@", "@im", "@image2" — or null when
 * the caret isn't right after one. An "@" glued to a word (e-mail) doesn't count.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  if (caret < 1 || caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && /[a-z0-9]/i.test(text[i])) i--;
  if (i < 0 || text[i] !== "@") return null;
  if (caret - i - 1 > 12) return null;
  if (i > 0 && /[\w@]/.test(text[i - 1])) return null;
  return { start: i, query: text.slice(i + 1, caret).toLowerCase() };
}

/** Targets matching what's typed after "@". */
export function filterTargets(targets: MentionTarget[], query: string): MentionTarget[] {
  if (!query) return targets;
  const digits = /^\d+$/.test(query) ? query : null;
  return targets.filter((t) => t.tag.startsWith(query) || (digits !== null && t.tag.replace(/\D/g, "") === digits));
}

/** Is `query` the start of a mention word (so an empty-state hint makes sense)? */
export function looksLikeMention(query: string): boolean {
  return !query || ["image", "video", "audio"].some((k) => k.startsWith(query) || query.startsWith(k));
}

export type MentionState = "ok" | "unsent" | "missing";

export function mentionState(tag: string, targets: MentionTarget[]): MentionState {
  const t = targets.find((x) => x.tag === tag);
  if (!t) return "missing";
  return t.sent ? "ok" : "unsent";
}

const listTags = (tags: string[]) => {
  const shown = tags.slice(0, 3).map((t) => `@${t}`);
  return tags.length > 3 ? `${shown.join(", ")} and ${tags.length - 3} more` : shown.join(tags.length === 2 ? " and " : ", ");
};

/** One hint line about mentions that point nowhere / won't be sent, or null. */
export function mentionWarning(prompt: string, targets: MentionTarget[]): string | null {
  const tokens = findMentions(prompt);
  if (!tokens.length) return null;
  const missing = [...new Set(tokens.filter((t) => mentionState(t.tag, targets) === "missing").map((t) => t.tag))];
  if (missing.length) {
    return `${listTags(missing)} ${missing.length === 1 ? "isn't" : "aren't"} attached — the prompt mentions media that doesn't exist.`;
  }
  const unsent = [...new Set(tokens.filter((t) => mentionState(t.tag, targets) === "unsent").map((t) => t.tag))];
  if (unsent.length) {
    const note = targets.find((t) => t.tag === unsent[0])?.note;
    return `${listTags(unsent)} won't be sent${note ? ` — ${note.charAt(0).toLowerCase()}${note.slice(1)}` : ""}.`;
  }
  return null;
}
