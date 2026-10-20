// ─────────────────────────────────────────────────────────────────────────────
// CactusGen mark: a lime saguaro (trunk + two arms). `tile` puts it on the
// dark rounded square used for the app icon. The same paths live in
// public/cactus.svg (static uses) and scripts/desktop/render-icon.mjs (app icons).
// ─────────────────────────────────────────────────────────────────────────────

export const CACTUS_LIME = "#d4ff2a";

export function CactusGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 6.5V26" strokeWidth={6} />
      <path d="M13.2 19.5H10.6A2.6 2.6 0 0 1 8 16.9V12.5" strokeWidth={4} />
      <path d="M18.8 15.5H21.4A2.6 2.6 0 0 0 24 12.9V9" strokeWidth={4} />
    </g>
  );
}

export function CactusLogo({
  size = 24,
  tile = false,
  className,
  title,
}: {
  size?: number;
  /** Dark rounded-square background (app-icon look). */
  tile?: boolean;
  className?: string;
  /** Accessible name; omit when a visible "CactusGen" label sits next to it. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={{ color: CACTUS_LIME, flexShrink: 0 }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {tile ? (
        <>
          <rect x="1" y="1" width="30" height="30" rx="7" fill="#11130c" />
          <g transform="translate(16 16) scale(0.78) translate(-16 -16.25)">
            <CactusGlyph />
          </g>
        </>
      ) : (
        <CactusGlyph />
      )}
    </svg>
  );
}
