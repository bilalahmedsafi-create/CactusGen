"use client";
// ─────────────────────────────────────────────────────────────────────────────
// APP TOP NAV — the one frame for every page (the old left sidebar is retired).
// One bar on every route, the Create pages included: logo, Image | Video create
// tabs and the app links (all one style, current page = white + lime underline),
// the API-key pill,
// and an account menu holding what used to live in the sidebar footer (Kie
// credits, buy credits, GitHub star / fork, Settings). Phones: the links fold
// into one menu, which also lists recent chats.
//
// Mounted by components/AppFrame on every route, it also loads the app-wide
// flags the sidebar used to load: Kie / Revana / Azure / Anthropic key status
// and the Kie credit balance (refreshed every minute and on the "credits-refresh" event).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  Coins,
  ExternalLink,
  GitFork,
  LayoutGrid,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  Star,
  Workflow,
} from "lucide-react";
import { useWorkflowStore } from "@/lib/store";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { useFolderStore } from "@/lib/folderStore";
import { GITHUB_API_URL, GITHUB_URL } from "@/lib/appInfo";
import { cn } from "@/lib/utils";
import { CactusLogo } from "@/components/CactusLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const PRODUCT_NAME = "CactusGen";
const KIE_CREDITS_URL = "https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec";

/** Lime keyboard-focus ring, offset from the near-black page (= create/ui FOCUS). */
export const NAV_FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff2a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0b]";

type Match = (pathname: string) => boolean;

const CREATE_TABS: { label: string; href: string; match: Match }[] = [
  { label: "Image", href: "/create/image", match: (p) => p === "/create/image" || p.startsWith("/create/image/") },
  { label: "Video", href: "/create", match: (p) => p === "/create" },
];

const LINKS: { label: string; href: string; icon: typeof LayoutGrid; match: Match }[] = [
  { label: "Gallery", href: "/gallery", icon: LayoutGrid, match: (p) => p === "/gallery" || p.startsWith("/gallery/") },
  { label: "Workflow", href: "/workflow", icon: Workflow, match: (p) => p === "/workflow" || p.startsWith("/workflow/") },
  { label: "Chat", href: "/chat", icon: MessageSquare, match: (p) => p === "/chat" || p.startsWith("/chat/") },
];

// ── App-wide flags + credits ─────────────────────────────────────────────────

/** Key flags + gallery folders, loaded once per app frame (was the sidebar's job). */
function useAppBootstrap() {
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const setRevanaKeySet = useWorkflowStore((s) => s.setRevanaKeySet);
  const setAzureKeySet = useWorkflowStore((s) => s.setAzureKeySet);
  const setAnthropicKeySet = useWorkflowStore((s) => s.setAnthropicKeySet);
  const loadFolders = useFolderStore((s) => s.loadFromServer);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    let alive = true;
    const load = (url: string, set: (v: boolean | null) => void) =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => { if (alive) set(!!d.hasToken); })
        .catch(() => { if (alive) set(null); });
    load("/api/settings/kie-key", setKieKeySet);
    load("/api/settings/revana-key", setRevanaKeySet);
    load("/api/settings/azure-key", setAzureKeySet);
    // "Improve prompt" on Create runs on Claude: the Anthropic key, else Kie.ai.
    load("/api/settings/anthropic-key", setAnthropicKeySet);
    return () => { alive = false; };
  }, [setKieKeySet, setRevanaKeySet, setAzureKeySet, setAnthropicKeySet]);
}

/** Kie credit balance; null until known (or when no Kie key is set). */
function useKieBalance(): number | null {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/credit");
        if (!res.ok) { if (alive) setBalance(null); return; }
        const data = await res.json();
        const val = typeof data?.data === "number"
          ? data.data
          : (data?.data?.balance ?? data?.balance ?? null);
        if (alive) setBalance(typeof val === "number" ? val : null);
      } catch { /* offline — keep the last value */ }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    window.addEventListener("credits-refresh", fetchBalance);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("credits-refresh", fetchBalance);
    };
    // Re-read when the Kie key is added or removed in Settings.
  }, [kieKeySet]);

  return balance;
}

function useGitHubStats(enabled: boolean) {
  const [stats, setStats] = useState<{ stars: number; forks: number } | null>(null);
  useEffect(() => {
    if (!enabled || stats) return;
    let alive = true;
    fetch(GITHUB_API_URL)
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.stargazers_count === "number") {
          setStats({ stars: d.stargazers_count, forks: d.forks_count ?? 0 });
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled, stats]);
  return stats;
}

const noopSubscribe = () => () => {};
/** true after hydration — persisted stores (chats) only render client-side. */
function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function KeyPill({ imageMode }: { imageMode: boolean }) {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const revanaKeySet = useWorkflowStore((s) => s.revanaKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  if (kieKeySet === null && revanaKeySet === null) {
    return <span className="h-8 w-8 rounded-full bg-white/[0.04] sm:w-[136px]" aria-hidden />;
  }

  const connected = [revanaKeySet ? "Revana" : null, kieKeySet ? "Kie.ai" : null].filter(Boolean) as string[];

  if (connected.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-(--c-accent) px-3.5 text-[12px] font-bold text-(--c-accent-ink) transition-colors hover:bg-(--c-accent-hover)",
          NAV_FOCUS,
        )}
      >
        Add API key
      </button>
    );
  }

  // Image mode runs on Revana first; show just that one there (as the Create bar did).
  const label = `${imageMode ? connected[0] : connected.join(" + ")} connected`;
  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      title={`${label} — open Settings`}
      aria-label={`${label}. Open Settings`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-full bg-white/[0.06] text-[12px] font-semibold text-(--c-text-2) transition-colors hover:bg-white/[0.1] hover:text-(--c-text) max-sm:w-8 sm:px-3",
        NAV_FOCUS,
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-(--c-ok)/40 motion-safe:animate-ping" />
        <span className="relative size-2 rounded-full bg-(--c-ok)" />
      </span>
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

// Deterministic pixel avatar (moved from the old sidebar footer).
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function PixelAvatar({ seed = "guest", size = 24 }: { seed?: string; size?: number }) {
  const rand = lcg(fnv1a(seed));
  const hue1 = Math.floor(rand() * 360);
  const hue2 = (hue1 + 100 + Math.floor(rand() * 120)) % 360;
  const palette = [`hsl(${hue1}, 22%, 10%)`, `hsl(${hue1}, 68%, 58%)`, `hsl(${hue2}, 62%, 48%)`, `hsl(${hue1}, 18%, 5%)`];
  const cells = Array.from({ length: 8 }, () => {
    const row = new Array<number>(8).fill(0);
    for (let c = 0; c < 4; c++) {
      const v = Math.floor(rand() * 4);
      row[c] = v;
      row[7 - c] = v;
    }
    return row;
  });
  const px = size / 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ display: "block", imageRendering: "pixelated" }}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.flatMap((row, r) =>
        row.map((v, c) => (v === 0 ? null : <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={palette[v]} />)),
      )}
    </svg>
  );
}

/** Credits header + buy / GitHub / Settings rows, shared by both menus. */
function AccountItems({ balance, stats }: { balance: number | null; stats: { stars: number; forks: number } | null }) {
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  return (
    <>
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
        <span className="overflow-hidden rounded-xl ring-1 ring-white/10">
          <PixelAvatar size={40} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--c-text-3)">Kie.ai credits</div>
          {balance !== null ? (
            <div className="text-[20px] font-bold leading-tight tabular-nums text-(--c-text)">{balance.toLocaleString()}</div>
          ) : (
            <div className="text-[13px] leading-snug text-(--c-text-3)">Add a Kie.ai key to see them</div>
          )}
        </div>
      </div>
      <DropdownMenuItem onClick={() => window.open(KIE_CREDITS_URL, "_blank", "noopener")}>
        <Coins />
        Buy Kie credits
        <ExternalLink className="ml-auto size-3.5 opacity-60" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => window.open(GITHUB_URL, "_blank", "noopener")}>
        <Star />
        Star on GitHub
        {stats && <DropdownMenuShortcut>{fmtCount(stats.stars)}</DropdownMenuShortcut>}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.open(`${GITHUB_URL}/fork`, "_blank", "noopener")}>
        <GitFork />
        Fork on GitHub
        {stats && <DropdownMenuShortcut>{fmtCount(stats.forks)}</DropdownMenuShortcut>}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
        <Settings />
        Settings
      </DropdownMenuItem>
    </>
  );
}

function AccountMenu({ balance }: { balance: number | null }) {
  const [open, setOpen] = useState(false);
  const stats = useGitHubStats(open);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={balance !== null ? `Account — ${balance.toLocaleString()} Kie credits` : "Account"}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-white/[0.06] p-1 text-[12px] font-semibold tabular-nums text-(--c-text-2) transition-colors hover:bg-white/[0.1] hover:text-(--c-text) data-popup-open:bg-white/[0.12] data-popup-open:text-(--c-text)",
              balance !== null && "pl-3",
              NAV_FOCUS,
            )}
          />
        }
      >
        {balance !== null && (
          <span className="inline-flex items-center gap-1.5">
            <Coins className="size-3.5 text-(--c-accent)" strokeWidth={2} aria-hidden />
            {balance.toLocaleString()}
          </span>
        )}
        <span className="overflow-hidden rounded-full">
          <PixelAvatar size={24} />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[264px]">
        <AccountItems balance={balance} stats={stats} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones: the app links, Settings, recent chats and the account rows in one menu. */
function MobileMenu({ pathname, balance }: { pathname: string; balance: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const stats = useGitHubStats(open);
  const isClient = useIsClient();
  const sessions = useChatSessionStore((s) => s.sessions);
  const recent = isClient ? sessions.slice(0, 5) : [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Menu"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg text-(--c-text-2) transition-colors hover:bg-white/[0.06] hover:text-(--c-text) data-popup-open:bg-white/[0.1] data-popup-open:text-(--c-text) md:hidden",
              NAV_FOCUS,
            )}
          />
        }
      >
        <Menu className="size-[18px]" strokeWidth={2} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="max-h-[min(80vh,var(--available-height))] w-[min(280px,calc(100vw-32px))]">
        <DropdownMenuGroup>
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <DropdownMenuItem key={l.href} onClick={() => router.push(l.href)} className={active ? "text-(--c-text)" : undefined}>
                <l.icon />
                {l.label}
                {active && <Check className="ml-auto size-4 text-(--c-accent)" aria-label="current page" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Chats</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push("/chat")}>
            <Plus />
            New chat
          </DropdownMenuItem>
          {recent.map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => router.push(`/chat?id=${s.id}`)}>
              <MessageSquare className="opacity-50" />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <AccountItems balance={balance} stats={stats} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Bar ──────────────────────────────────────────────────────────────────────

export function AppTopNav() {
  const pathname = usePathname() ?? "";
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  useAppBootstrap();
  const balance = useKieBalance();

  const linkCls = cn(
    "relative inline-flex h-8 shrink-0 items-center rounded-md px-2 text-[13px] font-medium transition-colors",
    NAV_FOCUS,
  );
  const linkState = (active: boolean) =>
    active
      ? "text-(--c-text) after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-(--c-accent)"
      : "text-(--c-text-3) hover:text-(--c-text)";

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-(--c-bg) px-4 md:gap-6 md:px-5">
      <Link href="/create" aria-label={`${PRODUCT_NAME} — Create`} className={cn("flex shrink-0 items-center gap-2 rounded-md", NAV_FOCUS)}>
        <CactusLogo size={24} />
        <span className="text-[15px] font-bold tracking-tight text-(--c-text) max-sm:hidden">{PRODUCT_NAME}</span>
      </Link>

      <div className="flex min-w-0 items-center gap-1">
        <nav aria-label="Create" className="flex shrink-0 items-center gap-1">
          {CREATE_TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn(linkCls, linkState(active))}>
                {t.label}
              </Link>
            );
          })}
        </nav>

        <span className="mx-1.5 h-4 w-px shrink-0 bg-white/[0.1] max-md:hidden" aria-hidden />

        <nav aria-label="App" className="flex items-center gap-1 max-md:hidden">
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={cn(linkCls, linkState(active))}>
                {l.label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setSettingsOpen(true)} className={cn(linkCls, linkState(false))}>
            Settings
          </button>
        </nav>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <KeyPill imageMode={pathname === "/create/image" || pathname.startsWith("/create/image/")} />
        <span className="max-md:hidden">
          <AccountMenu balance={balance} />
        </span>
        <MobileMenu pathname={pathname} balance={balance} />
      </div>
    </header>
  );
}
