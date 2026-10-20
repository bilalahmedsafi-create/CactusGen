"use client";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useWorkflowStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * "No API key" notice under the top nav. The key flags it reads are loaded
 * app-wide by components/AppTopNav (Settings updates them on save / remove).
 */
export default function KieBanner() {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const revanaKeySet = useWorkflowStore((s) => s.revanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  // A Revana key alone is enough to generate video — don't nag then.
  if (kieKeySet !== false || revanaKeySet === true) return null;

  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      className={cn(
        "group flex h-9 w-full shrink-0 items-center justify-center gap-2.5 border-b border-[#f87171]/15 bg-(--c-danger-soft) px-4 text-[12.5px] font-medium text-(--c-text-2) transition-colors hover:bg-[#f87171]/[0.12] hover:text-(--c-text)",
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4ff2a]/80",
      )}
    >
      <TriangleAlert className="size-3.5 shrink-0 text-(--c-danger)" strokeWidth={2.2} aria-hidden />
      <span className="truncate">No Kie.ai or Revana API key configured — generation is disabled.</span>
      <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-(--c-accent) max-sm:hidden">
        Add in Settings
        <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.2} aria-hidden />
      </span>
    </button>
  );
}
