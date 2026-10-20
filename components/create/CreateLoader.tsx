"use client";
// The create page reads localStorage (settings, draft, in-flight jobs) while it
// initialises, so it renders on the client only — no hydration mismatch.
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";
import type { CreateKind } from "./shared";

function CreateSkeleton() {
  return (
    <div className={cn(styles.tokens, "relative flex min-h-0 flex-1 flex-col bg-(--c-bg)")} aria-busy="true" aria-label="Loading">
      <div className="h-14 shrink-0 border-b border-white/[0.06]" />
      <div className="flex-1" />
      <div className="flex justify-center px-4 pb-4">
        <div className={cn(styles.skeleton, "h-[124px] w-full max-w-[780px] rounded-2xl")} />
      </div>
    </div>
  );
}

const VideoStudio = dynamic(() => import("./CreateStudio"), { ssr: false, loading: CreateSkeleton });
const ImageStudio = dynamic(() => import("./ImageStudio"), { ssr: false, loading: CreateSkeleton });

export default function CreateLoader({ mode }: { mode: CreateKind }) {
  return mode === "image" ? <ImageStudio /> : <VideoStudio />;
}
