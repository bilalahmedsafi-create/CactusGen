"use client";
// ─────────────────────────────────────────────────────────────────────────────
// GALLERY — folder filter panel ("All assets" + the folder tree). Moved here
// from the retired app sidebar with the same behaviour: pick a folder to filter
// the grid, drag folders to reorder / nest, ⋯ menu for colour, rename, clean
// failed jobs and delete, + to create a folder (inside the selected one).
// Wide screens: a column left of the grid. Phones: the same panel in a drawer.
// ─────────────────────────────────────────────────────────────────────────────
import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useFolderStore, type Folder as FolderT } from "@/lib/folderStore";
import { cn } from "@/lib/utils";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff2a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0b]";

// Module-level drag tracker (avoids stale closures across re-renders).
let _dragFolderId: string | null = null;

const FOLDER_COLORS: { color: string | null; label: string }[] = [
  { color: null, label: "Default" },
  { color: "#3B82F6", label: "Blue" },
  { color: "#2DD4BF", label: "Cyan" },
  { color: "#A855F7", label: "Purple" },
  { color: "#EC4899", label: "Pink" },
  { color: "#EF4444", label: "Red" },
  { color: "#F97316", label: "Orange" },
  { color: "#EAB308", label: "Yellow" },
  { color: "#22C55E", label: "Green" },
];

const MENU_CLS =
  "fixed z-[9999] min-w-[168px] -translate-x-full rounded-xl border border-white/[0.08] bg-(--c-popup) p-1.5 shadow-(--c-shadow-pop)";
const MENU_ROW =
  "flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[12.5px] font-medium text-(--c-text-2) transition-colors hover:bg-white/[0.07] hover:text-(--c-text) outline-none focus-visible:bg-white/[0.07]";

// Clean failed pending generations from localStorage + notify the gallery page.
function cleanFailedJobs(folderId: string | null) {
  try {
    const stored = localStorage.getItem("aiui-pending-gens");
    if (stored) {
      const parsed = JSON.parse(stored) as Array<{ error?: string; folderId?: string | null }>;
      const cleaned = parsed.filter((pg) => {
        if (!pg.error) return true;
        if (folderId === null) return false;
        return pg.folderId !== folderId;
      });
      localStorage.setItem("aiui-pending-gens", JSON.stringify(cleaned));
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("clean-failed-jobs", { detail: { folderId } }));
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" aria-label="Generating" className="shrink-0 animate-spin">
      <circle cx="5" cy="5" r="3.5" fill="none" stroke="rgba(212,255,42,0.2)" strokeWidth="1.5" />
      <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" fill="none" stroke="#d4ff2a" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UnseenDot() {
  return <span aria-label="New results" className="size-1.5 shrink-0 rounded-full bg-(--c-accent)" />;
}

/** Closes a fixed-position menu on outside mousedown. */
function useOutsideClose(open: boolean, ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

// ── FolderRow — module level so React never remounts it on parent re-renders ──
interface FolderRowProps {
  folder: FolderT;
  allFolders: FolderT[];
  depth: number;
  expandedIds: Set<string>;
  selectedFolderId: string | null;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onMove: (id: string, newParentId: string | null, newOrderIndex: number) => void;
  creatingInFolderId: string | null;
  newFolderName: string;
  onNameChange: (v: string) => void;
  onNameKeyDown: (e: React.KeyboardEvent) => void;
  onNameBlur: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  getCount: (id: string) => number;
  generatingFolderIds: string[];
  unseenFolderIds: string[];
}

const FolderRow = React.memo(function FolderRow({
  folder, allFolders, depth, expandedIds, selectedFolderId,
  onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
  creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
  getCount, generatingFolderIds, unseenFolderIds,
}: FolderRowProps) {
  const [drop, setDrop] = React.useState<"before" | "after" | "inside" | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);

  React.useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  useOutsideClose(menuOpen, menuRef, closeMenu);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  function startRename() {
    setMenuOpen(false);
    setRenameValue(folder.name);
    setIsRenaming(true);
  }

  function confirmRename() {
    const name = renameValue.trim();
    if (name && name !== folder.name) onRename(folder.id, name);
    setIsRenaming(false);
  }

  const children = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const hasChildren = children.length > 0;
  const isCreatingHere = creatingInFolderId === folder.id;
  const isExpanded = expandedIds.has(folder.id);
  const isActive = selectedFolderId === folder.id;
  const isGenerating = generatingFolderIds.includes(folder.id);
  const hasUnseen = unseenFolderIds.includes(folder.id);
  const count = getCount(folder.id);

  function getPos(e: React.DragEvent<HTMLDivElement>): "before" | "after" | "inside" {
    const { top, height } = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientY - top) / height;
    return pct < 0.3 ? "before" : pct > 0.7 ? "after" : "inside";
  }

  const sharedChildProps = {
    allFolders, expandedIds, selectedFolderId,
    onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
    creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
    getCount, generatingFolderIds, unseenFolderIds,
  };

  return (
    <React.Fragment>
      {drop === "before" && <div className="pointer-events-none mx-2 my-px h-0.5 rounded-full bg-(--c-accent)" />}
      <div
        draggable
        onDragStart={(e) => {
          _dragFolderId = folder.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (_dragFolderId === folder.id) return;
          setDrop(getPos(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = _dragFolderId;
          setDrop(null);
          _dragFolderId = null;
          if (!dragged || dragged === folder.id) return;
          const pos = getPos(e);
          if (pos === "inside") {
            const sibs = allFolders.filter((f) => f.parentId === folder.id).sort((a, b) => a.orderIndex - b.orderIndex);
            onMove(dragged, folder.id, sibs.length > 0 ? Math.max(...sibs.map((f) => f.orderIndex)) + 1 : 0);
          } else {
            const sibs = allFolders.filter((f) => f.parentId === folder.parentId && f.id !== dragged).sort((a, b) => a.orderIndex - b.orderIndex);
            const idx = sibs.findIndex((f) => f.id === folder.id);
            onMove(dragged, folder.parentId, pos === "before" ? idx : idx + 1);
          }
        }}
        onDragEnd={() => { _dragFolderId = null; setDrop(null); }}
        onClick={() => !isRenaming && onSelect(folder.id)}
        role="button"
        tabIndex={isRenaming ? -1 : 0}
        aria-current={isActive ? "true" : undefined}
        onKeyDown={(e) => {
          if (isRenaming || e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(folder.id); }
        }}
        className={cn(
          "group flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg pr-1 transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4ff2a]/80",
          isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
          drop === "inside" && "ring-1 ring-inset ring-(--c-accent-line)",
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          tabIndex={hasChildren || isCreatingHere ? 0 : -1}
          aria-label={isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(folder.id); }}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded text-(--c-text-3) hover:text-(--c-text)",
            hasChildren || isCreatingHere ? "" : "pointer-events-none opacity-0",
          )}
        >
          {isExpanded ? <ChevronDown size={12} strokeWidth={2.2} /> : <ChevronRight size={12} strokeWidth={2.2} />}
        </button>

        {isActive
          ? <FolderOpen size={14} strokeWidth={1.9} className="shrink-0" style={{ color: folder.color ?? "var(--c-text)" }} />
          : <Folder size={14} strokeWidth={1.9} className="shrink-0" style={{ color: folder.color ?? "var(--c-text-3)" }} />}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
              if (e.key === "Escape") { e.stopPropagation(); setIsRenaming(false); }
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            aria-label="Folder name"
            className="min-w-0 flex-1 rounded-md bg-(--c-input) px-1.5 py-0.5 text-[13px] text-(--c-text) outline-none ring-1 ring-(--c-accent-line)"
          />
        ) : (
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-tight", isActive ? "font-medium text-(--c-text)" : "text-(--c-text-2)")}>
            {folder.name}
          </span>
        )}

        {!isRenaming && count > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-(--c-text-4) group-hover:hidden">{count}</span>
        )}
        {!isRenaming && isGenerating && <Spinner />}
        {!isRenaming && !isGenerating && hasUnseen && <UnseenDot />}

        {/* ⋯ context menu button */}
        <button
          ref={btnRef}
          type="button"
          onClick={openMenu}
          aria-label={`${folder.name} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md text-(--c-text-3) transition-[opacity,color,background-color] hover:bg-white/[0.08] hover:text-(--c-text)",
            "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
            menuOpen && "opacity-100",
            FOCUS,
          )}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Context menu — fixed-position to escape overflow:auto clipping */}
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          onMouseDown={(e) => e.preventDefault()}
          className={MENU_CLS}
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {/* Colour swatches */}
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1.5">
            {FOLDER_COLORS.map(({ color, label }) => {
              const isSelected = color === null ? !folder.color : folder.color === color;
              return (
                <button
                  key={label}
                  type="button"
                  title={label}
                  aria-label={`${label} colour`}
                  aria-pressed={isSelected}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onColorChange(folder.id, color); }}
                  className={cn(
                    "relative size-4 shrink-0 rounded-full transition-transform hover:scale-110",
                    isSelected ? "ring-2 ring-white/85 ring-offset-1 ring-offset-[#161617]" : "",
                    FOCUS,
                  )}
                  style={{ background: color ?? "rgba(255,255,255,0.18)" }}
                >
                  {color === null && (
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="absolute inset-0 m-auto block">
                      <line x1="2" y1="8" x2="8" y2="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <div className="-mx-1.5 my-1 h-px bg-white/[0.07]" />
          <button type="button" role="menuitem" className={MENU_ROW} onClick={(e) => { e.stopPropagation(); startRename(); }}>
            Rename
          </button>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={(e) => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(folder.id); }}>
            Clean failed jobs
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(MENU_ROW, "text-(--c-danger) hover:bg-(--c-danger-soft) hover:text-(--c-danger)")}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(folder.id); }}
          >
            Delete
          </button>
        </div>
      )}

      {drop === "after" && <div className="pointer-events-none mx-2 my-px h-0.5 rounded-full bg-(--c-accent)" />}
      {isExpanded && (hasChildren || isCreatingHere) && (
        <>
          {children.map((child) => (
            <FolderRow key={child.id} folder={child} depth={depth + 1} {...sharedChildProps} />
          ))}
          {isCreatingHere && (
            <NewFolderInput
              depth={depth + 1}
              value={newFolderName}
              inputRef={inputRef}
              onChange={onNameChange}
              onKeyDown={onNameKeyDown}
              onBlur={onNameBlur}
            />
          )}
        </>
      )}
    </React.Fragment>
  );
});

function NewFolderInput({ depth, value, inputRef, onChange, onKeyDown, onBlur }: {
  depth: number;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2 pr-1" style={{ paddingLeft: `${6 + depth * 14 + 24}px` }}>
      <Folder size={14} strokeWidth={1.9} className="shrink-0 text-(--c-text-3)" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder="Folder name…"
        aria-label="New folder name"
        className="min-w-0 flex-1 rounded-md bg-(--c-input) px-1.5 py-0.5 text-[13px] text-(--c-text) outline-none ring-1 ring-(--c-accent-line) placeholder:text-(--c-text-4)"
      />
    </div>
  );
}

// ── "All assets" row with its own ⋯ menu ──────────────────────────────────────
const AllAssetsRow = React.memo(function AllAssetsRow({ isActive, count, onSelect, isGenerating, hasUnseen }: {
  isActive: boolean;
  count: number;
  onSelect: () => void;
  isGenerating?: boolean;
  hasUnseen?: boolean;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);
  useOutsideClose(menuOpen, menuRef, closeMenu);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  return (
    <React.Fragment>
      <div
        onClick={onSelect}
        role="button"
        tabIndex={0}
        aria-current={isActive ? "true" : undefined}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
        }}
        className={cn(
          "group flex h-9 cursor-pointer items-center gap-2 rounded-lg pl-[30px] pr-1 transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4ff2a]/80",
          isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
        )}
      >
        <LayoutGrid size={14} strokeWidth={1.9} className={cn("shrink-0", isActive ? "text-(--c-text)" : "text-(--c-text-3)")} />
        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-tight", isActive ? "font-medium text-(--c-text)" : "text-(--c-text-2)")}>
          All assets
        </span>
        {count > 0 && <span className="shrink-0 text-[11px] tabular-nums text-(--c-text-4) group-hover:hidden">{count}</span>}
        {isGenerating && <Spinner />}
        {!isGenerating && hasUnseen && <UnseenDot />}
        <button
          ref={btnRef}
          type="button"
          onClick={openMenu}
          aria-label="All assets options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md text-(--c-text-3) transition-[opacity,color,background-color] hover:bg-white/[0.08] hover:text-(--c-text)",
            "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
            menuOpen && "opacity-100",
            FOCUS,
          )}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {menuOpen && menuPos && (
        <div ref={menuRef} role="menu" onMouseDown={(e) => e.preventDefault()} className={MENU_CLS} style={{ left: menuPos.x, top: menuPos.y }}>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={(e) => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(null); }}>
            Clean failed jobs
          </button>
        </div>
      )}
    </React.Fragment>
  );
});

// ── Panel ────────────────────────────────────────────────────────────────────

export function FolderPanel({ tab, className, onPicked, onClose }: {
  /** Gallery tab — picks which count "All assets" shows. */
  tab: "images" | "videos";
  className?: string;
  /** Called after a folder is picked (the phone drawer closes itself). */
  onPicked?: () => void;
  /** Shows a close button (phone drawer). */
  onClose?: () => void;
}) {
  const {
    folders, selectedFolderId,
    createFolder, deleteFolder, selectFolder,
    updateFolder, moveFolder, folderItemCount,
    galleryImageCount, galleryVideoCount,
    generatingFolderIds, unseenFolderIds,
    generatingAllAssets, unseenAllAssets,
  } = useFolderStore();
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const newFolderInputRef = React.useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  function pick(id: string | null) {
    selectFolder(id);
    onPicked?.();
  }

  function handleCreateFolder() {
    setCreatingFolder(true);
    setNewFolderName("");
    // Auto-expand the parent so the inline input is visible.
    if (selectedFolderId) setExpandedIds((prev) => new Set([...prev, selectedFolderId]));
    setTimeout(() => newFolderInputRef.current?.focus(), 50);
  }

  function confirmCreateFolder() {
    const name = newFolderName.trim();
    // A selected folder gets the new one as a subfolder.
    if (name) createFolder(name, selectedFolderId ?? null);
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function handleFolderKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") confirmCreateFolder();
    if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
  }

  function handleToggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const roots = folders.filter((f) => f.parentId === null).sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <aside aria-label="Folders" className={cn("flex w-[232px] shrink-0 flex-col bg-(--c-bg)", className)}>
      <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2.5">
        <h2 className="text-[13px] font-semibold text-(--c-text)">Folders</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleCreateFolder}
            title={selectedFolderId ? "New folder inside the selected one" : "New folder"}
            aria-label="New folder"
            className={cn("grid size-8 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)", FOCUS)}
          >
            <FolderPlus className="size-4" strokeWidth={1.9} aria-hidden />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close folders"
              className={cn("grid size-8 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)", FOCUS)}
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        <AllAssetsRow
          isActive={selectedFolderId === null}
          count={tab === "videos" ? galleryVideoCount : galleryImageCount}
          onSelect={() => pick(null)}
          isGenerating={generatingAllAssets}
          hasUnseen={unseenAllAssets}
        />

        {roots.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            allFolders={folders}
            depth={0}
            expandedIds={expandedIds}
            selectedFolderId={selectedFolderId}
            onToggleExpand={handleToggleExpand}
            onSelect={pick}
            onDelete={deleteFolder}
            onRename={(id, name) => updateFolder(id, { name })}
            onColorChange={(id, color) => updateFolder(id, { color })}
            onMove={moveFolder}
            creatingInFolderId={creatingFolder ? selectedFolderId : null}
            newFolderName={newFolderName}
            onNameChange={setNewFolderName}
            onNameKeyDown={handleFolderKeyDown}
            onNameBlur={confirmCreateFolder}
            inputRef={newFolderInputRef}
            getCount={folderItemCount}
            generatingFolderIds={generatingFolderIds}
            unseenFolderIds={unseenFolderIds}
          />
        ))}

        {/* Root-level new folder input — at the bottom when no folder is selected */}
        {creatingFolder && selectedFolderId === null && (
          <NewFolderInput
            depth={0}
            value={newFolderName}
            inputRef={newFolderInputRef}
            onChange={setNewFolderName}
            onKeyDown={handleFolderKeyDown}
            onBlur={confirmCreateFolder}
          />
        )}

        {roots.length === 0 && !creatingFolder && (
          <button
            type="button"
            onClick={handleCreateFolder}
            className={cn(
              "mt-2 flex h-9 items-center gap-2 rounded-lg border border-dashed border-white/[0.1] px-3 text-[12.5px] text-(--c-text-3) transition-colors hover:border-white/[0.2] hover:text-(--c-text)",
              FOCUS,
            )}
          >
            <FolderPlus className="size-3.5" strokeWidth={1.9} aria-hidden />
            Make a folder to sort results
          </button>
        )}
      </div>
    </aside>
  );
}
