"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CHAT — saved conversations list, shown beside the Chat page on wide screens
// (moved here from the retired app sidebar; phones reach chats through the top
// nav menu). Same rows and actions as before: open, delete, new chat.
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, SquarePen, Trash2 } from "lucide-react";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { cn } from "@/lib/utils";
import { NAV_FOCUS } from "@/components/AppTopNav";

const noopSubscribe = () => () => {};

export function ChatSessionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeChatId = searchParams.get("id");
  const { sessions, deleteSession } = useChatSessionStore();
  // Sessions live in localStorage — render them only after hydration.
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const list = isClient ? sessions : [];

  function handleDeleteChat(id: string, isActive: boolean) {
    deleteSession(id);
    if (isActive) {
      const next = sessions.find((s) => s.id !== id);
      router.push(next ? `/chat?id=${next.id}` : "/chat");
    }
  }

  return (
    <aside aria-label="Chats" className="flex w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-(--c-bg) max-md:hidden">
      <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2.5">
        <h2 className="text-[13px] font-semibold text-(--c-text)">Chats</h2>
        <button
          type="button"
          onClick={() => router.push("/chat")}
          title="New chat"
          aria-label="New chat"
          className={cn(
            "grid size-8 place-items-center rounded-lg text-(--c-text-3) transition-colors hover:bg-white/[0.06] hover:text-(--c-text)",
            NAV_FOCUS,
          )}
        >
          <SquarePen className="size-4" strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {list.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="mx-auto mb-2 size-5 text-(--c-text-4)" strokeWidth={1.8} aria-hidden />
            <p className="text-[12.5px] text-(--c-text-3)">No chats yet</p>
            <p className="mt-0.5 text-[11.5px] text-(--c-text-4)">Your conversations show up here.</p>
          </div>
        ) : (
          list.map((sess) => {
            const isActive = pathname === "/chat" && sess.id === activeChatId;
            return (
              <div
                key={sess.id}
                className={cn(
                  "group flex h-9 items-center gap-1 rounded-lg pr-1 transition-colors",
                  isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                )}
              >
                <button
                  type="button"
                  onClick={() => router.push(`/chat?id=${sess.id}`)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex h-full min-w-0 flex-1 items-center rounded-lg px-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4ff2a]/80",
                    isActive ? "font-medium text-(--c-text)" : "text-(--c-text-2) group-hover:text-(--c-text)",
                  )}
                >
                  <span className="truncate">{sess.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteChat(sess.id, isActive)}
                  aria-label={`Delete chat "${sess.title}"`}
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-md text-(--c-text-3) opacity-0 transition-[opacity,color,background-color] hover:bg-[#f87171]/10 hover:text-(--c-danger) focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                    NAV_FOCUS,
                  )}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
