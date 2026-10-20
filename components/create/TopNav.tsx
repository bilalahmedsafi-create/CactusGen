"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — top bar: logo, Image | Video mode tabs, links to the rest of
// the app, and the API-key status pill (opens Settings). The Create page has
// no app sidebar, so this bar also loads the key flags the sidebar and the
// key banner load everywhere else.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { useWorkflowStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CreateKind } from "./shared";
import { FOCUS } from "./ui";

const TABS: { kind: CreateKind; label: string; href: string }[] = [
  { kind: "image", label: "Image", href: "/create/image" },
  { kind: "video", label: "Video", href: "/create" },
];

const LINKS = [
  { label: "Gallery", href: "/gallery" },
  { label: "Workflow", href: "/workflow" },
  { label: "Chat", href: "/chat" },
];

function KeyPill({ mode }: { mode: CreateKind }) {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const revanaKeySet = useWorkflowStore((s) => s.revanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  if (kieKeySet === null && revanaKeySet === null) {
    return <span className="h-8 w-[136px] rounded-full bg-white/[0.04]" aria-hidden />;
  }

  const connected = [revanaKeySet ? "Revana" : null, kieKeySet ? "Kie.ai" : null].filter(Boolean) as string[];
  // Image mode runs on Revana first; show that one when both are there.
  const shown = connected.length > 1 && mode === "video" ? connected.join(" + ") : connected[0];

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full bg-(--c-accent) px-3.5 text-[12px] font-bold text-(--c-accent-ink) transition-colors hover:bg-(--c-accent-hover)",
          FOCUS,
        )}
      >
        Add API key
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      title="API keys — open Settings"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.06] px-3 text-[12px] font-semibold text-(--c-text-2) transition-colors hover:bg-white/[0.1] hover:text-(--c-text)",
        FOCUS,
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-[#4ade80]/40 motion-safe:animate-ping" />
        <span className="relative size-2 rounded-full bg-[#4ade80]" />
      </span>
      <span>{shown} connected</span>
    </button>
  );
}

export function TopNav({ mode }: { mode: CreateKind }) {
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const setRevanaKeySet = useWorkflowStore((s) => s.setRevanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/kie-key")
      .then((r) => r.json())
      .then((d) => { if (alive) setKieKeySet(!!d.hasToken); })
      .catch(() => { if (alive) setKieKeySet(null); });
    fetch("/api/settings/revana-key")
      .then((r) => r.json())
      .then((d) => { if (alive) setRevanaKeySet(!!d.hasToken); })
      .catch(() => { if (alive) setRevanaKeySet(null); });
    return () => { alive = false; };
  }, [setKieKeySet, setRevanaKeySet]);

  const linkCls = cn(
    "inline-flex h-8 items-center rounded-md px-2 text-[13px] font-medium text-(--c-text-3) transition-colors hover:text-(--c-text)",
    FOCUS,
  );

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-(--c-bg) px-4 md:gap-6 md:px-5">
      <Link href="/create" aria-label="HeliosGen — Create" className={cn("flex shrink-0 items-center gap-2 rounded-md", FOCUS)}>
        <Image src="/HG.svg" alt="" width={22} height={22} priority />
        <span className="text-[15px] font-bold tracking-tight text-(--c-text) max-sm:hidden">HeliosGen</span>
      </Link>

      <nav aria-label="Create mode" className="flex items-center gap-0.5 rounded-lg bg-white/[0.05] p-0.5">
        {TABS.map((t) => {
          const active = t.kind === mode;
          return (
            <Link
              key={t.kind}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-3 text-[13px] font-semibold transition-colors",
                active ? "bg-white/[0.12] text-(--c-text)" : "text-(--c-text-3) hover:text-(--c-text)",
                FOCUS,
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <nav aria-label="App" className="flex items-center gap-1 max-md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={linkCls}>{l.label}</Link>
        ))}
        <button type="button" onClick={() => setSettingsOpen(true)} className={linkCls}>Settings</button>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/gallery"
          aria-label="Gallery"
          className={cn("grid size-8 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text) md:hidden", FOCUS)}
        >
          <LayoutGrid className="size-4" strokeWidth={2} />
        </Link>
        <KeyPill mode={mode} />
      </div>
    </header>
  );
}
