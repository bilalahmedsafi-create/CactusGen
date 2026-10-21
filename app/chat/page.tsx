"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatSessionStore, type StoredMessage, type ChatSession } from "@/lib/chatSessionStore";
import { getToken } from "@/lib/galleryUtils";
import { DEFAULT_CLAUDE_MODEL, MODEL_GROUPS, MODELS, isClaudeModel, normalizeModelId, type ModelId } from "@/lib/models";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { Send, ChevronUp, Copy, Check, ChartNoAxesColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHIP, FOCUS, POPUP } from "@/components/create/ui";
import { motion } from "motion/react";
import { CactusLogo } from "@/components/CactusLogo";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";
import TypewriterHeading from "@/components/ui/TypewriterHeading";
import { useWorkflowStore } from "@/lib/store";
import { loadAzureBaseUrl, loadAzureTextDeployment, loadAzureTextModelName } from "@/components/SettingsModal";

// ── Logo ──────────────────────────────────────────────────────────────────────

function LogoIcon({ size = 40 }: { size?: number }) {
  return <CactusLogo size={size} />;
}

// ── Key gate ──────────────────────────────────────────────────────────────────

/**
 * Loads the key flags this page needs and says whether a model is blocked:
 * Claude models run with a Claude (Anthropic) key or a Kie.ai key; the others
 * need the Kie.ai key (Azure has its own check below).
 */
function useModelBlocked(): (model: string) => boolean {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const anthropicKeySet = useWorkflowStore((s) => s.anthropicKeySet);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const setAnthropicKeySet = useWorkflowStore((s) => s.setAnthropicKeySet);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings/anthropic-key")
      .then((r) => r.json())
      .then((d) => { if (alive) setAnthropicKeySet(!!d.hasToken); })
      .catch(() => {});
    fetch("/api/settings/kie-key")
      .then((r) => r.json())
      .then((d) => { if (alive) setKieKeySet(!!d.hasToken); })
      .catch(() => {});
    return () => { alive = false; };
  }, [setKieKeySet, setAnthropicKeySet]);
  return (model) => (isClaudeModel(model) ? kieKeySet === false && anthropicKeySet === false : kieKeySet === false);
}

// ── Model picker ──────────────────────────────────────────────────────────────
// Same rows as the Create page ModelPopover: monogram tile, name, quiet spec
// chip, lime check on the selected one.

function ModelPicker({
  model, onChange, direction = "up", disabledIds = [],
}: {
  model: ModelId;
  onChange: (id: ModelId) => void;
  direction?: "up" | "down";
  disabledIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  // Old saved ids (claude-sonnet-4-6 …) resolve to the current model so the chip never renders empty.
  const resolvedId = normalizeModelId(model);
  const current = MODELS.find(m => m.id === resolvedId) ?? MODELS.find(m => m.id === DEFAULT_CLAUDE_MODEL);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${current?.label ?? ""}`}
        className={cn(CHIP, FOCUS, "max-w-[200px]", open && "bg-white/[0.12]")}
      >
        <ChartNoAxesColumn className="size-3.5 shrink-0 text-(--c-accent)" strokeWidth={2.6} aria-hidden />
        <span className="truncate">{current?.label}</span>
        <ChevronUp
          aria-hidden
          className={cn(
            "size-3 shrink-0 opacity-50 transition-transform duration-150",
            direction === "up" ? (open && "rotate-180") : (!open && "rotate-180"),
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Models"
          className={cn(
            POPUP,
            "absolute right-0 z-[100] max-h-[min(560px,70vh)] w-[min(300px,calc(100vw-32px))] overflow-y-auto",
            direction === "up" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
        >
          {MODEL_GROUPS.map((group, gi) => (
            <div key={group.label} role="group" aria-label={group.label} className={cn(gi > 0 && "mt-1 border-t border-white/[0.07] pt-1")}>
              <div className="px-2.5 pb-1.5 pt-2 text-[11px] font-semibold text-(--c-text-3)">{group.label}</div>
              {group.models.map(m => {
                const disabled = disabledIds.includes(m.id);
                const selected = resolvedId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={disabled || undefined}
                    onClick={() => { if (!disabled) { onChange(m.id); setOpen(false); } }}
                    title={disabled ? "Configure Azure in Settings → API Keys" : undefined}
                    className={cn(
                      "flex w-full select-none items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors duration-100 focus-visible:bg-white/[0.07]",
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.07]",
                      selected && "bg-white/[0.04]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold transition-colors",
                        selected ? "bg-(--c-accent)/15 text-(--c-accent)" : "bg-white/[0.06] text-(--c-text-2)",
                      )}
                    >
                      {m.label.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-(--c-text)">{m.label}</span>
                      <span className="mt-1 inline-flex h-[18px] items-center rounded-[5px] bg-white/[0.06] px-1.5 text-[10.5px] font-medium text-(--c-text-3)">
                        {disabled ? "needs Azure key" : m.desc}
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-(--c-accent)" strokeWidth={2.4} aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Send button + input bar ───────────────────────────────────────────────────

function SendButton({ enabled, onClick, size = 36 }: { enabled: boolean; onClick: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Send"
      style={{ width: size, height: size }}
      className={cn(
        FOCUS,
        "grid shrink-0 place-items-center rounded-full transition-colors duration-150",
        enabled
          ? "cursor-pointer bg-(--c-accent) text-(--c-accent-ink) hover:bg-(--c-accent-hover)"
          : "cursor-not-allowed bg-white/[0.06] text-(--c-text-4)",
      )}
    >
      <Send size={size > 32 ? 15 : 14} strokeWidth={2.2} />
    </button>
  );
}

/** Text field shell: neutral input surface, white/8% border, lime ring while typing. */
const INPUT_BAR =
  "flex items-center rounded-2xl border border-white/[0.08] bg-(--c-input) transition-[border-color,box-shadow] duration-150 has-[textarea:focus]:border-(--c-accent-line) has-[textarea:focus]:shadow-[0_0_0_3px_rgba(212,255,42,0.12)]";

const TEXTAREA =
  "min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent p-0 text-(--c-text) outline-none placeholder:text-(--c-text-4)";

// ── Cycling placeholder ───────────────────────────────────────────────────────

const PLACEHOLDER_SENTENCES = [
  "Convert this prompt into a JSON prompt",
  "Improve this prompt by giving more camera details",
  "Generate a prompt to create an image of a girl holding a flower",
  "Make this prompt more cinematic and add lighting details",
  "Rewrite this prompt for a photorealistic style",
];

function useCyclingPlaceholder(paused: boolean) {
  const [text, setText] = useState("");
  const idx = useRef(0);
  const phase = useRef<"typing" | "waiting" | "deleting">("typing");
  const char = useRef(0);

  useEffect(() => {
    if (paused) return;

    let timeout: ReturnType<typeof setTimeout>;

    function tick() {
      const sentence = PLACEHOLDER_SENTENCES[idx.current];

      if (phase.current === "typing") {
        char.current++;
        setText(sentence.slice(0, char.current));
        if (char.current >= sentence.length) {
          phase.current = "waiting";
          timeout = setTimeout(tick, 2000);
        } else {
          timeout = setTimeout(tick, 42);
        }
      } else if (phase.current === "waiting") {
        phase.current = "deleting";
        timeout = setTimeout(tick, 40);
      } else {
        char.current--;
        setText(sentence.slice(0, char.current));
        if (char.current <= 0) {
          idx.current = (idx.current + 1) % PLACEHOLDER_SENTENCES.length;
          phase.current = "typing";
          timeout = setTimeout(tick, 300);
        } else {
          timeout = setTimeout(tick, 28);
        }
      }
    }

    timeout = setTimeout(tick, 400);
    return () => clearTimeout(timeout);
  }, [paused]);

  return text;
}

// ── Landing view (no active session) ─────────────────────────────────────────


function LandingView({
  onSubmit, model, onModelChange,
}: {
  onSubmit: (text: string) => void;
  model: ModelId;
  onModelChange: (id: ModelId) => void;
}) {
  const [input, setInput] = useState("");
  const [headingDone, setHeadingDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const animatedPlaceholder = useCyclingPlaceholder(!headingDone || input.length > 0);
  const isBlocked   = useModelBlocked();
  const keyBlocked  = isBlocked(model);
  const azureKeySet = useWorkflowStore((s) => s.azureKeySet);
  const disabledIds = azureKeySet === true ? [] : ["azure-auto"];

  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
  }

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "0 24px 80px", position: "relative", overflow: "hidden",
    }}>
      <DotCanvasBackground />
      {/* Logo */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <LogoIcon size={48} />

      {/* Title */}
      <TypewriterHeading text="I'm here to help you make better prompts." onDone={() => setHeadingDone(true)} />
      <motion.p
        initial={{ filter: "blur(10px)", opacity: 0 }}
        animate={{ filter: "blur(0px)", opacity: 1 }}
        transition={{ duration: 1 }}
        style={{ color: "var(--c-text-3)", fontSize: "15px", marginBottom: "40px", textAlign: "center" }}
      >
        Give me a prompt and I&apos;ll make it better.
      </motion.p>

      {/* Input + suggestions */}
      <div style={{ width: "100%", maxWidth: "680px" }}>
        {/* Input bar */}
        <div className={INPUT_BAR} style={{ padding: "10px 10px 10px 20px" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={input.length > 0 ? "" : animatedPlaceholder}
            rows={1}
            aria-label="Prompt"
            className={TEXTAREA}
            style={{ fontSize: "15px", lineHeight: "24px", maxHeight: "120px" }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px", flexShrink: 0 }}>
            <ModelPicker model={model} onChange={onModelChange} direction="down" disabledIds={disabledIds} />
            <SendButton
              onClick={() => submit(input)}
              enabled={!!input.trim() && !keyBlocked && !disabledIds.includes(model)}
            />
          </div>
        </div>

      </div>
      </div>
    </div>
  );
}

// ── Chat window ───────────────────────────────────────────────────────────────

interface LiveMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function ChatWindow({
  session, onUpdate, defaultModel, onModelChange, onAuthRequired, initialMessage,
}: {
  session: ChatSession;
  onUpdate: (msgs: StoredMessage[], model: string) => void;
  defaultModel?: string;
  onModelChange?: (id: ModelId) => void;
  onAuthRequired?: () => void;
  initialMessage?: string;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<LiveMessage[]>(() =>
    session.messages.map((m) => ({ ...m }))
  );
  const [input, setInput] = useState("");
  // Sessions saved with an older model id (claude-sonnet-4-6 …) continue on the current one.
  const [model, setModel] = useState<ModelId>(normalizeModelId(session.model || defaultModel) as ModelId);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const isBlocked   = useModelBlocked();
  const keyBlocked  = isBlocked(model);
  const azureKeySet = useWorkflowStore((s) => s.azureKeySet);
  const disabledIds = azureKeySet === true ? [] : ["azure-auto"];

  function handleModelChange(id: ModelId) { setModel(id); onModelChange?.(id); }
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    if (onAuthRequired) { onAuthRequired(); return; }

    const contextMessages: StoredMessage[] = [
      ...session.messages,
      { role: "user", content: trimmed },
    ];

    const assistantIdx = contextMessages.length; // index in the new messages array
    flushSync(() => {
      setMessages((prev) => [
        ...prev.filter((m) => !m.streaming),
        { role: "user", content: trimmed },
        { role: "assistant", content: "", streaming: true },
      ]);
      setInput("");
      setIsStreaming(true);
    });

    onUpdate(contextMessages, model);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const token = await getToken();
      const azureConfig = model === "azure-auto" ? {
        azureEndpoint:   loadAzureBaseUrl(),
        azureDeployment: loadAzureTextDeployment(),
        azureModelName:  loadAzureTextModelName(),
      } : {};

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
          ...azureConfig,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = "Request failed";
        try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch { errMsg = await res.text().catch(() => errMsg); }
        setMessages((prev) => prev.map((m, i) => i === assistantIdx ? { ...m, content: `Error: ${errMsg}`, streaming: false } : m));
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const chunk =
              (parsed.type === "content_block_delta" ? parsed.delta?.text : null) ??
              parsed.choices?.[0]?.delta?.content ??
              null;
            if (chunk) accumulated += chunk;
          } catch { /* skip malformed SSE */ }
        }
        // One state update per network read — the await above yields to the browser for painting
        setMessages((prev) => prev.map((m, i) =>
          i === assistantIdx ? { ...m, content: accumulated } : m
        ));
      }

      const finalMessages: StoredMessage[] = [...contextMessages, { role: "assistant", content: accumulated }];
      setMessages(finalMessages.map((m) => ({ ...m })));
      onUpdate(finalMessages, model);
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) => prev.map((m, i) => i === assistantIdx ? { ...m, content: "Request failed.", streaming: false } : m));
      }
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, model, onAuthRequired, session, onUpdate]);

  const hasSentInitial = useRef(false);
  useEffect(() => {
    if (initialMessage && !hasSentInitial.current) {
      hasSentInitial.current = true;
      send(initialMessage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  // ── Empty state: centered welcome + input ──────────────────────────────────
  if (messages.length === 0 && !isStreaming) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px 80px", minWidth: 0 }}>
        <LogoIcon size={48} />
        <TypewriterHeading text="I'm here to help you make better prompts." />
        <div style={{ width: "100%", maxWidth: "680px" }}>
          <div className={INPUT_BAR} style={{ padding: "10px 10px 10px 20px" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Describe your image or video idea…"
              rows={1}
              aria-label="Message"
              className={TEXTAREA}
              style={{ fontSize: "15px", lineHeight: "24px", maxHeight: "120px" }}
              onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px", flexShrink: 0 }}>
              <ModelPicker model={model} onChange={handleModelChange} direction="down" disabledIds={disabledIds} />
              <SendButton onClick={() => send(input)} enabled={!!input.trim() && !keyBlocked && !disabledIds.includes(model)} />
            </div>
          </div>
        </div>
        <style>{`@keyframes chatDot { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} } @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      </div>
    );
  }

  // ── Normal chat layout ─────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--c-line)", flexShrink: 0 }}>
        <h2 className="truncate" style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--c-text)", letterSpacing: "-0.01em", maxWidth: "760px", marginInline: "auto" }}>
          {session.title}
        </h2>
      </div>

      {/* Messages — user in a neutral bubble, assistant as plain text (QuickAssist style) */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px 20px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", maxWidth: m.role === "user" ? "78%" : "100%", minWidth: 0 }}>
              <div style={m.role === "user" ? {
                padding: "10px 14px",
                borderRadius: "16px 16px 4px 16px",
                background: "var(--c-raise-2)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: "14px", lineHeight: 1.6, letterSpacing: "-0.01em",
                color: "var(--c-text)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              } : {
                padding: "2px 0",
                fontSize: "14px", lineHeight: 1.65, letterSpacing: "-0.01em",
                color: "rgba(245,245,244,0.88)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
                {m.streaming && (
                  m.content
                    ? <span style={{ display: "inline-block", width: "2px", height: "14px", background: "var(--c-accent)", borderRadius: "1px", marginLeft: "2px", verticalAlign: "text-bottom", animation: "cursorBlink 0.8s ease-in-out infinite" }} />
                    : <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
                        {[0, 1, 2].map(d => (
                          <span key={d} style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--c-text-3)", animation: `chatDot 1s ${d * 0.2}s infinite` }} />
                        ))}
                      </span>
                )}
              </div>
              {m.role === "assistant" && !m.streaming && m.content && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(m.content);
                    setCopiedIdx(i);
                    setTimeout(() => setCopiedIdx(null), 1500);
                  }}
                  title="Copy response"
                  className={cn(
                    FOCUS,
                    "mt-1.5 -ml-2 flex cursor-pointer items-center gap-1 rounded-md px-2 py-[3px] text-[11px] font-medium transition-colors duration-150 hover:bg-white/[0.06]",
                    copiedIdx === i ? "text-(--c-accent)" : "text-(--c-text-4) hover:text-(--c-text-2)",
                  )}
                >
                  {copiedIdx === i ? <Check size={11} /> : <Copy size={11} />}
                  {copiedIdx === i ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* Input bar */}
      <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--c-line)", flexShrink: 0 }}>
        <div className={INPUT_BAR} style={{ padding: "8px 8px 8px 14px", maxWidth: "760px", margin: "0 auto" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Send a message…"
            rows={1}
            disabled={isStreaming}
            aria-label="Message"
            className={cn(TEXTAREA, "disabled:cursor-not-allowed")}
            style={{ fontSize: "14px", lineHeight: "22px", maxHeight: "120px" }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px", flexShrink: 0 }}>
            <ModelPicker model={model} onChange={handleModelChange} disabledIds={disabledIds} />
            <SendButton
              size={32}
              onClick={() => send(input)}
              enabled={!!input.trim() && !isStreaming && !keyBlocked && !disabledIds.includes(model)}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Inner page (uses useSearchParams) ────────────────────────────────────────

function ChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");

  const { sessions, createSession, upsertSession, preferredModel, setPreferredModel } = useChatSessionStore();
  const [hydrated, setHydrated] = useState(false);
  const [landingModel, setLandingModel] = useState<ModelId>(DEFAULT_CLAUDE_MODEL);
  const [pendingMessage, setPendingMessage] = useState("");

  // Sync landingModel from store once hydrated
  useEffect(() => { if (hydrated) setLandingModel(normalizeModelId(preferredModel) as ModelId); }, [hydrated]);

  useEffect(() => {
    const unsub = useChatSessionStore.persist?.onFinishHydration(() => setHydrated(true));
    if (useChatSessionStore.persist?.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  const activeSession = idParam ? (sessions.find(s => s.id === idParam) ?? null) : null;

  function handleLandingSubmit(text: string) {
    const id = createSession(landingModel, text.slice(0, 50));
    setPendingMessage(text);
    router.push(`/chat?id=${id}`);
  }

  if (!hydrated) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-4)", fontSize: "14px" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {activeSession ? (
        <ChatWindow
          key={activeSession.id}
          session={activeSession}
          onUpdate={(msgs, mdl) => upsertSession(activeSession.id, msgs, mdl)}
          defaultModel={preferredModel}
          onModelChange={setPreferredModel}
          initialMessage={pendingMessage || undefined}
        />
      ) : (
        <LandingView
          onSubmit={handleLandingSubmit}
          model={landingModel}
          onModelChange={id => { setLandingModel(id); setPreferredModel(id); }}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <Suspense fallback={<div style={{ flex: 1 }} />}>
        <ChatInner />
      </Suspense>
    </div>
  );
}
