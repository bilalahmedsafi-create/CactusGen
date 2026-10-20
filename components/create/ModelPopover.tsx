"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — model chip + picker popover: search field, "Featured models"
// first, then every model grouped by maker. Each row shows a badge (TOP / NEW)
// and small spec chips; the selected one carries a check. Keyboard: type to
// filter, ↑ / ↓ to move, Enter to pick, Esc to close.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, ChartNoAxesColumn, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";
import { CHIP, FOCUS, POPUP } from "./ui";

export interface ModelRow {
  id: string;
  name: string;
  maker: string;
  badge?: "TOP" | "NEW";
  /** Tiny grey spec chips, e.g. "1080p", "4s–30s", "Audio". */
  specs: string[];
  featured?: boolean;
}

interface Section {
  key: string;
  title: string;
  icon?: ReactNode;
  rows: ModelRow[];
}

function buildSections(rows: ModelRow[], query: string): Section[] {
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = rows.filter((r) => `${r.name} ${r.maker} ${r.specs.join(" ")}`.toLowerCase().includes(q));
    return [{ key: "results", title: hits.length ? "Results" : "No models match", rows: hits }];
  }
  const sections: Section[] = [];
  const featured = rows.filter((r) => r.featured);
  if (featured.length) {
    sections.push({ key: "featured", title: "Featured models", icon: <Sparkles className="size-3" strokeWidth={2.2} />, rows: featured });
  }
  for (const r of rows) {
    if (r.featured) continue;
    const s = sections.find((x) => x.key === `maker:${r.maker}`);
    if (s) s.rows.push(r);
    else sections.push({ key: `maker:${r.maker}`, title: r.maker, rows: [r] });
  }
  return sections;
}

function Badge({ kind }: { kind: "TOP" | "NEW" }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-[4px] px-1.5 text-[9px] font-extrabold uppercase italic leading-none tracking-wide",
        kind === "TOP" ? "bg-linear-to-r from-[#2563eb] to-[#60a5fa] text-white" : "bg-(--c-accent) text-(--c-accent-ink)",
      )}
    >
      {kind}
    </span>
  );
}

/** Monogram tile standing in for a maker logo. */
function ModelTile({ row, selected }: { row: ModelRow; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg text-[14px] font-bold transition-colors",
        selected ? "bg-(--c-accent)/15 text-(--c-accent)" : "bg-white/[0.06] text-(--c-text-2)",
      )}
    >
      {row.name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase()}
    </span>
  );
}

export function ModelChip({ value, rows, onChange, label }: {
  value: string;
  rows: ModelRow[];
  onChange: (id: string) => void;
  /** Accessible name prefix, e.g. "Video model". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const sections = useMemo(() => buildSections(rows, query), [rows, query]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const current = rows.find((r) => r.id === value);
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1));

  // Keep the highlighted row in view while moving with the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      const idx = buildSections(rows, "").flatMap((s) => s.rows).findIndex((r) => r.id === value);
      setActive(Math.max(0, idx));
    }
  };

  const choose = (row: ModelRow | undefined) => {
    if (!row) return;
    onChange(row.id);
    setOpen(false);
  };

  // Position of each section's first row in `flat`.
  const offsets = sections.map((_, si) => sections.slice(0, si).reduce((n, x) => n + x.rows.length, 0));
  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger aria-label={`${label}: ${current?.name ?? value}`} className={cn(CHIP, FOCUS, "max-w-[220px]")}>
        <ChartNoAxesColumn className="size-3.5 shrink-0 text-(--c-accent)" strokeWidth={2.6} aria-hidden />
        <span className="truncate">{current?.name ?? value}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={10} collisionPadding={12} className={cn(styles.tokens, "z-[1200] outline-none")}>
          <Popover.Popup
            initialFocus={inputRef}
            className={cn(POPUP, "flex max-h-[min(540px,var(--available-height))] w-[min(440px,calc(100vw-24px))] flex-col p-0")}
          >
            <Popover.Title className="sr-only">Choose a model</Popover.Title>
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] px-3.5">
              <Search className="size-4 shrink-0 text-(--c-text-3)" strokeWidth={2} aria-hidden />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={flat.length ? `${listId}-${activeIdx}` : undefined}
                aria-autocomplete="list"
                aria-label="Search models"
                placeholder="Search..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(flat.length - 1, activeIdx + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, activeIdx - 1)); }
                  else if (e.key === "Home") { e.preventDefault(); setActive(0); }
                  else if (e.key === "End") { e.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); choose(flat[activeIdx]); }
                }}
                className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-(--c-text) outline-none placeholder:text-(--c-text-3)"
              />
            </div>
            <div ref={listRef} id={listId} role="listbox" aria-label="Models" className={cn(styles.scroll, "min-h-0 flex-1 overflow-y-auto p-1.5")}>
              {sections.map((s, si) => (
                <div key={s.key} role="group" aria-label={s.title} className="pb-1">
                  <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2.5 text-[11px] font-semibold text-(--c-text-3)">
                    {s.icon}
                    {s.title}
                  </div>
                  {s.rows.map((r, ri) => {
                    const i = offsets[si] + ri;
                    const selected = r.id === value;
                    return (
                      <div
                        key={r.id}
                        id={`${listId}-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => { if (i !== activeIdx) setActive(i); }}
                        onClick={() => choose(r)}
                        className={cn(
                          "flex cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-100",
                          i === activeIdx ? "bg-white/[0.07]" : selected ? "bg-white/[0.04]" : "",
                        )}
                      >
                        <ModelTile row={r} selected={selected} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-(--c-text)">{r.name}</span>
                            {r.badge && <Badge kind={r.badge} />}
                          </span>
                          {r.specs.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {r.specs.map((sp) => (
                                <span key={sp} className="inline-flex h-[18px] items-center rounded-[5px] bg-white/[0.06] px-1.5 text-[10.5px] font-medium tabular-nums text-(--c-text-3)">
                                  {sp}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-(--c-accent)" strokeWidth={2.4} aria-hidden />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
