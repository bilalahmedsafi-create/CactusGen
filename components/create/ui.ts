// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — shared class strings (focus ring, chips, popovers). The accent
// is the lime of the Generate button; `.tokens` in create.module.css holds the
// colour variables these refer to.
// ─────────────────────────────────────────────────────────────────────────────

export const ACCENT = "#d4ff2a";

/** Visible keyboard focus ring (lime, offset from the near-black page). */
export const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff2a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0b]";

/** Small composer chip (model, duration, aspect …). */
export const CHIP =
  "inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-semibold tabular-nums text-(--c-text) transition-colors duration-150 hover:bg-white/[0.1] data-popup-open:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40";

/** Popover / menu surface opening above the composer. */
export const POPUP =
  "origin-(--transform-origin) rounded-2xl border border-white/[0.08] bg-[#161617]/[0.98] p-1.5 text-(--c-text) shadow-[0_24px_60px_rgba(0,0,0,0.6),0_2px_10px_rgba(0,0,0,0.45)] outline-none backdrop-blur-xl transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

/** One selectable row inside a menu popover. */
export const MENU_ROW =
  "flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-(--c-text-2) outline-none data-checked:text-(--c-text) data-highlighted:bg-white/[0.07] data-highlighted:text-(--c-text)";
