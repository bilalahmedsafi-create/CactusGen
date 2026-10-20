"use client";
// App chrome around every page: notice bars + the top nav (components/AppTopNav)
// over the page, no sidebar. The Create pages (/create, /create/image) render
// their own copy of the bar (components/create/TopNav) inside the page, so the
// frame only adds the notice bars there. The old sidebar's extras moved:
// folders → the Gallery page's folder panel, chats → the panel beside /chat
// (and the phone menu), credits / GitHub / Settings → the nav's account menu.
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { AppTopNav } from "@/components/AppTopNav";
import { ChatSessionsPanel } from "@/components/ChatSessionsPanel";
import KieBanner from "@/components/KieBanner";
import UpdateBanner from "@/components/UpdateBanner";
import { DragDropGuard } from "@/components/DragDropGuard";

export function isFullBleedRoute(pathname: string | null): boolean {
  return !!pathname && (pathname === "/create" || pathname.startsWith("/create/"));
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isFullBleedRoute(pathname)) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-(--c-bg)">
        <UpdateBanner />
        <DragDropGuard />
        {children}
      </div>
    );
  }

  const isChat = pathname === "/chat" || !!pathname?.startsWith("/chat/");

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--c-bg)">
      <KieBanner />
      <UpdateBanner />
      <AppTopNav />
      <DragDropGuard />
      <div className="flex min-h-0 flex-1">
        {isChat && (
          <Suspense fallback={null}>
            <ChatSessionsPanel />
          </Suspense>
        )}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
