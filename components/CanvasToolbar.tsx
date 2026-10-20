"use client";
import React, { useState } from "react";
import {
  Plus, MousePointer2, Hand, Scissors, LayoutTemplate,
  MessageSquare, Undo2, Redo2, Download,
} from "lucide-react";

type ToolId = "select" | "hand" | "cut" | "frame" | "comment";

interface CanvasToolbarProps {
  activeTool?: ToolId;
  onToolChange?: (tool: ToolId) => void;
  onAddNode?: (anchorRect: DOMRect) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpenSettings?: () => void;
  onExport?: () => void;
  exporting?: boolean;
}

function Divider() {
  return (
    <span style={{
      display: "block", width: "20px", height: "1px",
      background: "var(--c-line)", margin: "3px auto", flexShrink: 0,
    }} />
  );
}

function Btn({
  id, title, active, activeStyle = "highlight", dimmed, onClick, children,
}: {
  id: string; title: string; active?: boolean;
  activeStyle?: "circle" | "highlight"; dimmed?: boolean;
  onClick: () => void; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const isCircle = active && activeStyle === "circle";

  return (
    <button
      id={id}
      title={title}
      aria-label={title}
      aria-pressed={activeStyle === "circle" ? !!active : undefined}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "34px", height: "34px", borderRadius: "10px",
        border: "none", cursor: "pointer", flexShrink: 0,
        transition: "background 150ms, color 150ms, opacity 150ms",
        // Active tool: lime-soft fill + lime icon (the one accent)
        background: isCircle
          ? "var(--c-accent-soft)"
          : hovered ? "var(--c-fill-2)" : "transparent",
        color: dimmed
          ? "var(--c-text-4)"
          : isCircle ? "var(--c-accent)" : hovered ? "var(--c-text)" : "var(--c-text-2)",
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function CanvasToolbar({
  activeTool: externalTool,
  onToolChange,
  onAddNode,
  onUndo,
  onRedo,
  canUndo = true,
  canRedo = false,
  onExport,
  exporting = false,
}: CanvasToolbarProps) {
  const [internalTool, setInternalTool] = useState<ToolId>("select");
  const [addHovered, setAddHovered] = useState(false);
  const [shareHovered, setShareHovered] = useState(false);
  const activeTool = externalTool ?? internalTool;

  function selectTool(tool: ToolId) {
    setInternalTool(tool);
    onToolChange?.(tool);
  }

  return (
    <div
      id="canvas-toolbar"
      style={{
        position: "absolute", left: "16px", top: "50%",
        transform: "translateY(-50%)", zIndex: 100,
        display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
        padding: "6px",
        borderRadius: "16px",
        background: "rgba(22,22,23,0.96)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "var(--c-shadow-pop)",
        userSelect: "none",
      }}
    >
      {/* Add — the toolbar's primary action, lime */}
      <button
        id="toolbar-add"
        title="Add node (A)"
        aria-label="Add node (A)"
        onMouseEnter={() => setAddHovered(true)}
        onMouseLeave={() => setAddHovered(false)}
        onClick={(e) => onAddNode?.((e.currentTarget as HTMLElement).getBoundingClientRect())}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "34px", height: "34px", borderRadius: "10px",
          border: "none", cursor: "pointer", flexShrink: 0,
          transition: "background 150ms, color 150ms",
          background: addHovered ? "var(--c-accent-hover)" : "var(--c-accent)",
          color: "var(--c-accent-ink)",
        }}
      >
        <Plus size={17} strokeWidth={2.4} />
      </button>

      <Divider />

      <Btn id="toolbar-select" title="Select (V)" active={activeTool === "select"} activeStyle="circle" onClick={() => selectTool("select")}>
        <MousePointer2 size={16} strokeWidth={1.8} />
      </Btn>

      <Btn id="toolbar-hand" title="Hand (H)" active={activeTool === "hand"} activeStyle="circle" onClick={() => selectTool("hand")}>
        <Hand size={16} strokeWidth={1.8} />
      </Btn>

      <Divider />

      <Btn id="toolbar-undo" title="Undo (⌘Z)" dimmed={!canUndo} onClick={() => onUndo?.()}>
        <Undo2 size={16} strokeWidth={1.8} />
      </Btn>

      <Btn id="toolbar-redo" title="Redo (⌘⇧Z)" dimmed={!canRedo} onClick={() => onRedo?.()}>
        <Redo2 size={16} strokeWidth={1.8} />
      </Btn>

      {/* ── Bottom section: export ── */}
      <span style={{
        display: "block", width: "100%", height: "1px",
        background: "var(--c-line)", margin: "4px 0", flexShrink: 0,
      }} />

      <button
        id="toolbar-export"
        title="Export workflow (.zip)"
        aria-label="Export workflow (.zip)"
        onMouseEnter={() => setShareHovered(true)}
        onMouseLeave={() => setShareHovered(false)}
        onClick={() => { if (!exporting) onExport?.(); }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "34px", height: "34px", borderRadius: "10px",
          border: "none", cursor: exporting ? "wait" : "pointer", flexShrink: 0,
          transition: "background 150ms, color 150ms",
          background: exporting ? "var(--c-accent-soft)" : shareHovered ? "var(--c-fill-2)" : "transparent",
          color: exporting ? "var(--c-accent)" : shareHovered ? "var(--c-text)" : "var(--c-text-2)",
        }}
      >
        <Download size={16} strokeWidth={1.8} style={exporting ? { animation: "spin 1s linear infinite" } : undefined} />
      </button>
    </div>
  );
}
