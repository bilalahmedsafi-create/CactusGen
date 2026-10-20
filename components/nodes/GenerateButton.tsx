"use client";
import React, { useState } from "react";

interface Props {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  extracting?: boolean;
  warningMessages?: string[];
}

export default function GenerateButton({ onClick, busy, disabled, extracting, warningMessages }: Props) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hasWarning = !!(warningMessages?.length);

  // Visual state only — lime primary, quiet fill when disabled, lime-soft while busy.
  const isOff = !!disabled && !busy && !extracting && !hasWarning;
  const isPrimary = !hasWarning && !extracting && !busy && !isOff;

  const bg = hasWarning
    ? "rgba(239,68,68,0.15)"
    : extracting
    ? "rgba(251,146,60,0.15)"
    : busy
    ? "var(--c-accent-soft)"
    : isOff
    ? "var(--c-fill)"
    : undefined; // primary: lime via className so hover can lift it

  const border = hasWarning
    ? "1px solid rgba(239,68,68,0.45)"
    : extracting
    ? "1px solid rgba(251,146,60,0.45)"
    : busy
    ? "1px solid var(--c-accent-line)"
    : "1px solid transparent";

  const fg = hasWarning ? "#ef4444" : isOff ? "rgba(245,245,244,0.3)" : "#0e1004";

  return (
    <div
      style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={() => hasWarning && setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        disabled={disabled || busy || extracting}
        className={`h-7 px-3 rounded-lg flex items-center gap-1.5 transition-colors ${
          isPrimary ? "bg-(--c-accent) hover:bg-(--c-accent-hover)" : hasWarning || extracting ? "disabled:opacity-50" : ""
        }`}
        style={{
          background: bg,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border,
          cursor: disabled || busy || hasWarning ? "not-allowed" : "pointer",
        }}
      >
        {busy ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
            <circle cx="5" cy="5" r="4" stroke="rgba(212,255,42,0.25)" strokeWidth="1.5" />
            <path d="M5 1 A4 4 0 0 1 9 5" stroke="#d4ff2a" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : extracting ? (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
              <circle cx="5" cy="5" r="4" stroke="rgba(251,146,60,0.25)" strokeWidth="1.5" />
              <path d="M5 1 A4 4 0 0 1 9 5" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-[11px] font-medium" style={{ color: "#fb923c" }}>Extracting…</span>
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span className="text-[11px] font-bold" style={{ color: fg }}>Generate</span>
          </>
        )}
      </button>

      {tooltipVisible && warningMessages && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 5px)",
            right: 0,
            background: "var(--c-popup)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10,
            padding: "6px 10px",
            whiteSpace: "nowrap",
            fontSize: 11,
            color: "var(--c-text-2)",
            boxShadow: "var(--c-shadow-pop)",
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          {warningMessages.map((msg, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#ef4444", fontSize: 8 }}>●</span>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
