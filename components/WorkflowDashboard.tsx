"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { useWorkflowStore, Space } from "@/lib/store";
import { makeUGCTemplate } from "@/lib/templates";
import { timeAgo } from "@/lib/useSpaceSync";
import { WorkflowHero } from "@/components/WorkflowHero";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  /* Workflow card — #161616 on the near-black page, 16px radius, 1px white/7% line */
  .wsd-card {
    position: relative;
    background: var(--c-raise);
    border: 1px solid var(--c-line);
    border-radius: 16px;
    cursor: pointer;
    transition: transform 220ms cubic-bezier(.22,1,.36,1),
                box-shadow  220ms cubic-bezier(.22,1,.36,1),
                border-color 200ms ease;
  }
  .wsd-card:hover {
    transform: translateY(-2px);
    border-color: rgba(255,255,255,0.14);
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
  }
  /* lift the card above its neighbours while its menu is open */
  .wsd-card-menu { z-index: 20; }
  .wsd-card:hover .wsd-actions,
  .wsd-card:focus-within .wsd-actions,
  .wsd-card-menu .wsd-actions { opacity: 1; transform: translateY(0); }
  .wsd-card:hover .wsd-thumb-overlay { opacity: 1; }
  @media (hover: none) {
    .wsd-actions { opacity: 1 !important; transform: none !important; }
  }

  .wsd-actions {
    position: absolute; top: 10px; right: 10px;
    display: inline-flex; gap: 4px;
    opacity: 0; transform: translateY(-6px);
    transition: opacity 180ms ease, transform 180ms ease;
    z-index: 3;
  }
  .wsd-act {
    width: 30px; height: 30px; border-radius: 9px;
    display: grid; place-items: center;
    background: rgba(14,14,14,0.78);
    color: var(--c-text-2);
    border: 1px solid rgba(255,255,255,0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    cursor: pointer;
    transition: background 130ms ease, color 130ms ease, border-color 130ms ease;
  }
  .wsd-act:hover { color: var(--c-text); border-color: rgba(255,255,255,0.2); background: rgba(36,36,37,0.95); }

  .wsd-menu { width: 186px; }

  .wsd-thumbs {
    position: relative;
    aspect-ratio: 3/2;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    background: var(--c-bg);
    border-radius: 15px 15px 0 0;
    overflow: hidden;
  }
  .wsd-thumb-cell {
    position: relative; overflow: hidden;
  }
  .wsd-thumb-cell-empty {
    background: #1b1b1b;
    color: var(--c-text);
    display: grid; place-items: center;
  }
  .wsd-thumb-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(0,0,0,0) 40%,
      rgba(0,0,0,0.5) 100%);
    opacity: 0; transition: opacity 220ms ease;
    pointer-events: none; z-index: 1;
  }

  .wsd-foot {
    padding: 12px 14px 14px;
    display: flex; flex-direction: column; gap: 6px;
    border-top: 1px solid var(--c-line);
  }
  .wsd-foot-row {
    display: flex; align-items: center; gap: 8px;
  }

  /* "New workflow" tile — quiet dashed card, lime orb */
  .wsd-new {
    position: relative;
    background: var(--c-raise);
    border: 1px dashed rgba(255,255,255,0.14);
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    display: flex; flex-direction: column;
    transition: transform 220ms cubic-bezier(.22,1,.36,1),
                box-shadow  220ms cubic-bezier(.22,1,.36,1),
                border-color 200ms ease,
                background 200ms ease;
  }
  .wsd-new:hover {
    border-color: var(--c-accent-line);
    background: #191919;
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    transform: translateY(-2px);
  }
  .wsd-new:hover .wsd-plus-orb { background: var(--c-accent-hover); transform: scale(1.05); }
  .wsd-new-art {
    flex: 1; aspect-ratio: 3/2;
    display: grid; place-items: center;
    position: relative; overflow: hidden;
  }
  .wsd-new-art::before {
    content:""; position:absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 20px 20px;
    mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 0%, transparent 100%);
    -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 0%, transparent 100%);
  }
  .wsd-plus-orb {
    position: relative; z-index: 1;
    width: 56px; height: 56px; border-radius: 50%;
    background: var(--c-accent);
    display: grid; place-items: center;
    color: var(--c-accent-ink);
    transition: background 180ms ease, transform 220ms cubic-bezier(.22,1,.36,1);
  }

  /* Header buttons: lime primary pill + quiet fill */
  .wsd-new-btn {
    appearance: none; border: 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 7px;
    height: 36px; padding: 0 16px 0 13px;
    background: var(--c-accent);
    color: var(--c-accent-ink); font-size: 13px; font-weight: 700; border-radius: 999px;
    transition: background 140ms ease, transform 140ms ease;
    white-space: nowrap; font-family: inherit;
  }
  .wsd-new-btn:hover { background: var(--c-accent-hover); }
  .wsd-new-btn:active { transform: scale(0.98); }

  .wsd-import-btn {
    appearance: none; border: 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 7px;
    height: 36px; padding: 0 15px 0 13px;
    background: var(--c-fill);
    color: var(--c-text); font-size: 13px; font-weight: 600; border-radius: 999px;
    transition: background 140ms ease, transform 140ms ease;
    white-space: nowrap; font-family: inherit;
  }
  .wsd-import-btn:hover:not(:disabled) { background: var(--c-fill-2); }
  .wsd-import-btn:active:not(:disabled) { transform: scale(0.98); }
  .wsd-import-btn:disabled { opacity: 0.5; cursor: default; }

  @keyframes wsd-spin { to { transform: rotate(360deg); } }

  /* Template card — same surface as a workflow card */
  .wsd-tmpl {
    position: relative;
    background: var(--c-raise);
    border: 1px solid var(--c-line);
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    display: flex; flex-direction: column;
    transition: transform 220ms cubic-bezier(.22,1,.36,1),
                box-shadow  220ms cubic-bezier(.22,1,.36,1),
                border-color 200ms ease;
  }
  .wsd-tmpl:hover {
    border-color: rgba(255,255,255,0.14);
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    transform: translateY(-2px);
  }
  .wsd-tmpl:hover .wsd-thumb-overlay { opacity: 1; }
  .wsd-tmpl .wsd-thumbs { border-radius: 0; }

  .wsd-reset {
    appearance: none; border: 0; flex-shrink: 0;
    width: 28px; height: 28px; border-radius: 8px;
    display: grid; place-items: center; cursor: pointer;
    background: var(--c-fill); color: var(--c-text-3);
    transition: background 140ms ease, color 140ms ease;
  }
  .wsd-reset:hover { background: var(--c-fill-2); color: var(--c-text); }

  .wsd-head {
    padding: 28px 32px 20px;
    display: flex; align-items: flex-end; gap: 24px;
    flex-wrap: wrap; row-gap: 16px;
  }
  .wsd-head-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }

  .wsd-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
    padding: 0 32px;
  }
  @media (max-width: 1180px) {
    .wsd-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 860px) {
    .wsd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0 16px; }
    .wsd-head { padding: 20px 16px 16px; }
  }
  @media (max-width: 479px) {
    .wsd-grid { gap: 10px; }
    .wsd-foot { padding: 10px 12px 12px; }
    .wsd-menu { width: 152px; }
    .wsd-head-actions { margin-left: 0; }
  }
`;

// ── Template card ─────────────────────────────────────────────────────────────

const TEMPLATE_PREVIEWS = [
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/1.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/2.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/3.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/4.png",
];

function TemplateCard({ onLoad, onReset }: { onLoad: () => void; onReset: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="wsd-tmpl"
      role="button"
      tabIndex={0}
      onClick={onLoad}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onLoad(); }}
    >
      <div className="wsd-thumbs">
        {TEMPLATE_PREVIEWS.map((url, i) => (
          <div key={i} className="wsd-thumb-cell">
            <NextImage src={url} alt="" fill sizes="160px" style={{ objectFit: "cover" }} />
          </div>
        ))}
        <div className="wsd-thumb-overlay" />
      </div>
      <div className="wsd-foot">
        <div className="wsd-foot-row" style={{ justifyContent: "space-between" }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 600, color: "var(--c-text)", letterSpacing: "-0.01em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            UGC Template
          </div>
          <button
            className="wsd-reset"
            onClick={onReset}
            title="Reset template"
            aria-label="Reset template"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
        <div className="wsd-foot-row" style={{ fontSize: "12px", fontWeight: 500, color: "var(--c-text-3)" }}>
          <span>4× Image → 4× Video</span>
        </div>
      </div>
    </div>
  );
}

// ── Media collection ──────────────────────────────────────────────────────────

type MediaItem = { type: "image"; url: string } | { type: "video"; url: string };

function collectMedia(space: Space): MediaItem[] {
  const items: MediaItem[] = [];
  for (const node of space.nodes) {
    const { r2Url, imageUrl, videoUrl } = node.data;
    if (typeof videoUrl === "string" && videoUrl) {
      items.push({ type: "video", url: videoUrl });
    } else if (typeof r2Url === "string" && r2Url) {
      items.push({ type: "image", url: r2Url });
    } else if (typeof imageUrl === "string" && imageUrl) {
      items.push({ type: "image", url: imageUrl });
    }
  }
  return items;
}

// ── 4-cell thumbnail mosaic ───────────────────────────────────────────────────

function ThumbnailMosaic({ space }: { space: Space }) {
  const media = collectMedia(space).slice(0, 4);
  return (
    <div className="wsd-thumbs">
      {Array.from({ length: 4 }).map((_, i) => {
        const item = media[i];
        return (
          <div key={i} className={`wsd-thumb-cell${item ? "" : " wsd-thumb-cell-empty"}`}>
            {item ? (
              item.type === "video" ? (
                <video
                  src={item.url}
                  muted loop playsInline autoPlay preload="metadata"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <NextImage src={item.url} alt="" fill sizes="160px" style={{ objectFit: "cover" }} />
              )
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                style={{ opacity: 0.12 }}>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M3 16l5-5 4 4 3-3 6 5" />
              </svg>
            )}
          </div>
        );
      })}
      <div className="wsd-thumb-overlay" />
    </div>
  );
}

// ── Card menu ─────────────────────────────────────────────────────────────────

interface CardMenuProps {
  spaceId: string;
  spaceName: string;
  onOpen: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function CardMenu({ spaceId, onOpen, onStartRename, onDelete, onClose }: CardMenuProps) {
  const duplicateSpace = useWorkflowStore((s) => s.duplicateSpace);
  const spaces = useWorkflowStore((s) => s.spaces);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const item = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    danger = false,
    disabled = false
  ) => (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) action(); }}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: "10px", width: "100%",
        minHeight: "34px", padding: "6px 10px", background: "transparent", border: "none", borderRadius: "10px",
        color: disabled ? "var(--c-text-4)" : danger ? "var(--c-danger)" : "var(--c-text)",
        fontSize: "13px", fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "inherit", textAlign: "left",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = danger ? "var(--c-danger-soft)" : "rgba(255,255,255,0.07)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ color: disabled ? "var(--c-text-4)" : danger ? "var(--c-danger)" : "var(--c-text-3)", flexShrink: 0, display: "flex" }}>
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="wsd-menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        padding: "6px",
        background: "rgba(22,22,23,0.98)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "16px",
        boxShadow: "var(--c-shadow-pop)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      {item("Open", <OpenIcon />, () => { onClose(); onOpen(); })}
      <div style={{ height: "1px", background: "var(--c-line)", margin: "4px 6px" }} />
      {item("Rename", <RenameIcon />, () => { onClose(); onStartRename(); })}
      {item("Duplicate", <DuplicateIcon />, () => { duplicateSpace(spaceId); onClose(); })}
      <div style={{ height: "1px", background: "var(--c-line)", margin: "4px 6px" }} />
      {item("Delete", <DeleteIcon />, () => { onClose(); onDelete(); }, true, spaces.length <= 1)}
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteConfirmModal({
  spaceName,
  onConfirm,
  onCancel,
}: {
  spaceName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--c-popup)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px", padding: "22px", width: "min(340px, calc(100vw - 32px))",
          boxShadow: "var(--c-shadow-pop)",
        }}
      >
        <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--c-text)", margin: "0 0 8px" }}>
          Delete workflow?
        </p>
        <p style={{ fontSize: "13px", color: "var(--c-text-3)", margin: "0 0 22px", lineHeight: 1.5, overflowWrap: "anywhere" }}>
          &ldquo;{spaceName}&rdquo; will be permanently deleted. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            className="bg-white/[0.06] transition-colors hover:bg-white/[0.1]"
            style={{
              height: "34px", padding: "0 16px", borderRadius: "999px",
              border: "none",
              color: "var(--c-text)", fontSize: "13px", fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              height: "34px", padding: "0 16px", borderRadius: "999px", border: "none",
              background: "var(--c-danger)", color: "#1a0606", fontSize: "13px", fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Space card ────────────────────────────────────────────────────────────────


function SpaceCard({ space, onOpen }: { space: Space; onOpen: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renameSpace = useWorkflowStore((s) => s.renameSpace);
  const deleteSpace = useWorkflowStore((s) => s.deleteSpace);

  const ts = space.updatedAt ?? space.createdAt;

  const startRename = () => {
    setDraft(space.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (draft.trim()) renameSpace(space.id, draft.trim());
    else setDraft(space.name);
    setRenaming(false);
  };

  return (
    <article
      className={`wsd-card${menuOpen ? " wsd-card-menu" : ""}`}
      onClick={() => { if (!renaming && !menuOpen) onOpen(); }}
    >
      {/* Hover action buttons */}
      <div className="wsd-actions" onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <button
            className="wsd-act"
            aria-label="More"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <MoreHorizIcon />
          </button>
          {menuOpen && (
            <CardMenu
              spaceId={space.id}
              spaceName={space.name}
              onOpen={onOpen}
              onStartRename={startRename}
              onDelete={() => setConfirmDelete(true)}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Thumbnails */}
      <ThumbnailMosaic space={space} />

      {/* Footer */}
      <div className="wsd-foot">
        {/* Title row */}
        <div className="wsd-foot-row">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraft(space.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                flex: 1, minWidth: 0, background: "transparent", border: "none",
                color: "var(--c-text)", fontSize: "14px", fontWeight: 600,
                outline: "none", padding: 0, fontFamily: "inherit",
                letterSpacing: "-0.01em", caretColor: "var(--c-accent)",
                boxShadow: "inset 0 -1px 0 var(--c-accent-line)",
              }}
            />
          ) : (
            <div style={{
              flex: 1, minWidth: 0,
              fontSize: "14px", fontWeight: 600, color: "var(--c-text)",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {space.name}
            </div>
          )}
        </div>

        {/* Meta row: timestamp */}
        <div className="wsd-foot-row">
          <span style={{
            fontSize: "12px", fontWeight: 500,
            color: "var(--c-text-3)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {timeAgo(new Date(ts))}
          </span>
        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirmModal
          spaceName={space.name}
          onConfirm={() => { deleteSpace(space.id); setConfirmDelete(false); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </article>
  );
}

// ── Create card ───────────────────────────────────────────────────────────────

function CreateCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="wsd-new"
      role="button"
      tabIndex={0}
      onClick={onCreate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onCreate(); }}
    >
      <div className="wsd-new-art">
        <div className="wsd-plus-orb">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round"
            style={{ width: 24, height: 24, strokeWidth: 2.4 }}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
      </div>
      <div className="wsd-foot">
        <div className="wsd-foot-row" style={{ fontSize: "14px", fontWeight: 600, color: "var(--c-text)", letterSpacing: "-0.01em" }}>
          New workflow
        </div>
        <div className="wsd-foot-row" style={{ fontSize: "12px", fontWeight: 500, color: "var(--c-text-3)" }}>
          <span>Start from scratch</span>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function WorkflowDashboard() {
  const router = useRouter();
  const spaces = useWorkflowStore((s) => s.spaces);
  const createSpace = useWorkflowStore((s) => s.createSpace);
  const switchSpace = useWorkflowStore((s) => s.switchSpace);
  const deleteSpace = useWorkflowStore((s) => s.deleteSpace);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const openSpace = (id: string) => {
    switchSpace(id);
    router.push(`/workflow/${id}`);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    const { addToast } = useWorkflowStore.getState();
    setImporting(true);
    try {
      const { importWorkflowZip } = await import("@/lib/importWorkflow");
      const wf = await importWorkflowZip(file);

      createSpace(wf.name, {
        nodes: wf.nodes,
        edges: wf.edges,
        nodeCounters: wf.nodeCounters,
      });
      const newId = useWorkflowStore.getState().activeSpaceId;
      if (wf.viewport) useWorkflowStore.getState().saveViewport(wf.viewport);

      addToast(
        wf.skipped > 0
          ? `Imported "${wf.name}" — ${wf.assetCount} asset(s), ${wf.skipped} couldn't be restored`
          : `Imported "${wf.name}" — ${wf.assetCount} asset(s)`,
        wf.skipped > 0 ? "info" : "success",
      );
      router.push(`/workflow/${newId}`);
    } catch (err) {
      addToast(`Import failed: ${(err as Error).message}`, "error");
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = () => {
    createSpace(`Space ${spaces.length + 1}`);
    const newId = useWorkflowStore.getState().activeSpaceId;
    router.push(`/workflow/${newId}`);
  };

  const TEMPLATE_NAME = "UGC Template";

  const spawnFreshTemplate = () => {
    const store = useWorkflowStore.getState();
    const existing = store.spaces.find((sp) => sp.name === TEMPLATE_NAME);
    if (existing) {
      if (store.spaces.length === 1) store.createSpace("Space 1");
      deleteSpace(existing.id);
    }
    createSpace(TEMPLATE_NAME, makeUGCTemplate());
    const newId = useWorkflowStore.getState().activeSpaceId;
    router.push(`/workflow/${newId}`);
  };

  const handleLoadTemplate = () => spawnFreshTemplate();

  const handleResetTemplate = (e: React.MouseEvent) => {
    e.stopPropagation();
    spawnFreshTemplate();
  };

  const sorted = [...spaces]
    .filter((sp) => sp.nodes.length > 0 && sp.name !== TEMPLATE_NAME)
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        position: "relative",
        background: "var(--c-bg)",
        overflowX: "hidden",
      }}
    >
      <DotCanvasBackground />
      <style>{CSS}</style>

      <div style={{ position: "relative", paddingBottom: "80px" }}>

        <WorkflowHero />

        {/* ── Page header ── */}
        <section className="wsd-head">
          <div style={{ minWidth: 0 }}>
            <h1
              className="cg-display"
              style={{
                margin: 0,
                fontSize: "clamp(36px, 5vw, 64px)",
                color: "var(--c-text)",
              }}
            >
              My Workflows
            </h1>
            <div style={{
              marginTop: "8px",
              display: "inline-flex", alignItems: "center", gap: "6px",
              fontSize: "13px", fontWeight: 500, color: "var(--c-text-3)",
              fontVariantNumeric: "tabular-nums",
            }}>
              <b style={{ color: "var(--c-text-2)", fontWeight: 600 }}>{sorted.length}</b>
              <span>workspace{sorted.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <div className="wsd-head-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={handleImportFile}
              style={{ display: "none" }}
            />
            <button
              className="wsd-import-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? <SpinnerIcon /> : <ImportIcon />}
              {importing ? "Importing…" : "Import"}
            </button>
            <button className="wsd-new-btn" onClick={handleCreate}>
              <PlusIcon />
              New workflow
            </button>
          </div>
        </section>

        {/* ── Grid ── */}
        <section className="wsd-grid">
          <CreateCard onCreate={handleCreate} />
          <TemplateCard onLoad={handleLoadTemplate} onReset={handleResetTemplate} />
          {sorted.map((sp) => (
            <SpaceCard key={sp.id} space={sp} onOpen={() => openSpace(sp.id)} />
          ))}
        </section>

      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function MoreHorizIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "wsd-spin 0.7s linear infinite", transformOrigin: "center" }}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
