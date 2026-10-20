"use client";
// App chrome around every page: the sidebar + inset card, except on the
// full-bleed Create page (/create, /create/image), which brings its own top bar
// (components/create/TopNav) and loads the API-key flags itself.
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import KieBanner from "@/components/KieBanner";
import UpdateBanner from "@/components/UpdateBanner";
import { DragDropGuard } from "@/components/DragDropGuard";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function isFullBleedRoute(pathname: string | null): boolean {
  return !!pathname && (pathname === "/create" || pathname.startsWith("/create/"));
}

export function AppFrame({ sidebarOpen, children }: { sidebarOpen: boolean; children: React.ReactNode }) {
  const pathname = usePathname();

  if (isFullBleedRoute(pathname)) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0b0b0b]">
        <UpdateBanner />
        <DragDropGuard />
        {children}
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={sidebarOpen} className="h-full">
      <AppSidebar />
      <SidebarInset style={{ backgroundColor: "transparent" }} className="flex flex-col min-h-0 min-w-0 border-l border-r border-t border-white/[0.08] mx-2 mt-2 rounded-tl-xl rounded-tr-xl">
        <KieBanner />
        <UpdateBanner />
        <div className="md:hidden flex items-center h-10 px-3 border-b border-white/[0.08] shrink-0">
          <SidebarTrigger className="text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors rounded-lg p-1.5 [&_svg]:size-4" />
        </div>
        <DragDropGuard />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
