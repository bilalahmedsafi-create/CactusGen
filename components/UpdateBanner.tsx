"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Update available" bar — a slim notice under the top nav, styled like
 * {@link KieBanner}. Polls `/api/update-check` (GitHub latest release vs the
 * bundled version); tapping the bar opens a dialog with the release notes and a
 * Download link. No self-install — Download just opens the release page in the
 * OS browser (caught by {@link DesktopLinkHandler}).
 */

const DISMISS_KEY = "helios-update-dismissed"; // holds the version the user dismissed

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff2a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0b]";

type UpdateInfo = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  name?: string;
  notes?: string;
  url?: string;
  publishedAt?: string;
};

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/update-check")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UpdateInfo | null) => {
        if (!alive || !d?.updateAvailable) return;
        try {
          if (localStorage.getItem(DISMISS_KEY) === d.latestVersion) setDismissed(true);
        } catch {
          /* private mode — just show it */
        }
        setInfo(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!info?.updateAvailable || dismissed) return null;

  const dismiss = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    try {
      if (info.latestVersion) localStorage.setItem(DISMISS_KEY, info.latestVersion);
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <>
      <div className="relative flex h-9 w-full shrink-0 items-center justify-center border-b border-white/[0.06] bg-(--c-panel) px-12">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "group inline-flex min-w-0 items-center gap-2.5 rounded-md text-[12.5px] font-medium text-(--c-text-2) transition-colors hover:text-(--c-text)",
            FOCUS,
          )}
        >
          <span className="inline-flex h-4 shrink-0 items-center rounded-[4px] bg-(--c-accent) px-1.5 text-[9px] font-extrabold uppercase italic leading-none tracking-wide text-(--c-accent-ink)">
            New
          </span>
          <span className="truncate">
            Update available{info.latestVersion ? ` — ${info.latestVersion}` : ""}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-(--c-accent) max-sm:hidden">
            View changes
            <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.2} aria-hidden />
          </span>
        </button>
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={dismiss}
          className={cn(
            "absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)",
            FOCUS,
          )}
        >
          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
        </button>
      </div>

      {open && <ChangelogModal info={info} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangelogModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[9999] bg-black/65 backdrop-blur-[4px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="fixed left-1/2 top-1/2 z-[10000] flex max-h-[min(80vh,640px)] w-[min(calc(100vw-32px),560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-(--c-popup) text-(--c-text) shadow-(--c-shadow-pop)"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-4 shrink-0 items-center rounded-[4px] bg-(--c-accent) px-1.5 text-[9px] font-extrabold uppercase italic leading-none tracking-wide text-(--c-accent-ink)">
                New
              </span>
              <h2 id="update-dialog-title" className="truncate text-[15px] font-bold">
                {info.name || "Update available"}
              </h2>
            </div>
            <div className="mt-1 text-[12px] tabular-nums text-(--c-text-3)">
              {info.currentVersion} → {info.latestVersion}
              {info.publishedAt ? ` · ${new Date(info.publishedAt).toLocaleDateString()}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.07] hover:text-(--c-text)",
              FOCUS,
            )}
          >
            <X className="size-4" strokeWidth={2.2} aria-hidden />
          </button>
        </div>

        {/* Notes */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Notes text={info.notes || "No release notes provided."} />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "inline-flex h-9 items-center rounded-lg bg-white/[0.06] px-4 text-[13px] font-semibold text-(--c-text-2) transition-colors hover:bg-white/[0.1] hover:text-(--c-text)",
              FOCUS,
            )}
          >
            Later
          </button>
          {/* No target="_blank": DesktopLinkHandler intercepts the click and
              hands the URL to the OS browser via /api/open-external. A _blank
              would also trigger Tauri's own (unpermitted) shell.open. */}
          <a
            href={info.url}
            onClick={onClose}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg bg-(--c-accent) px-4 text-[13px] font-bold text-(--c-accent-ink) no-underline transition-colors hover:bg-(--c-accent-hover)",
              FOCUS,
            )}
          >
            <Download className="size-4" strokeWidth={2.2} aria-hidden />
            Download
          </a>
        </div>
      </div>
    </>
  );
}

/** Minimal, safe Markdown-ish renderer for a GitHub release body. */
function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="text-[13px] leading-relaxed text-(--c-text-2)">
      {lines.map((raw, i) => {
        const line = raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
        const heading = line.match(/^#{1,6}\s+(.*)/);
        if (heading) {
          return (
            <div key={i} className={cn("font-semibold text-(--c-text)", i ? "mb-1 mt-3" : "mb-1")}>
              {heading[1]}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2.5 py-px">
              <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rounded-full bg-(--c-accent)" />
              <span>{bullet[1]}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return (
          <div key={i} className="py-px">
            {line}
          </div>
        );
      })}
    </div>
  );
}
