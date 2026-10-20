"use client";
// The create page reads localStorage (settings, draft, in-flight jobs) while it
// initialises, so it renders on the client only — no hydration mismatch.
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import styles from "./create.module.css";

function CreateSkeleton() {
  return (
    <div className={cn(styles.tokens, "flex min-h-0 flex-1 bg-(--c-bg) max-md:flex-col")} aria-busy="true" aria-label="Loading">
      <div className="flex w-full shrink-0 flex-col gap-6 bg-(--c-panel) p-4 md:w-[380px] md:border-r md:border-(--c-line)">
        <div className={cn(styles.skeleton, "h-[62px] rounded-xl")} />
        <div className={cn(styles.skeleton, "h-[124px] rounded-[10px]")} />
        <div className={cn(styles.skeleton, "h-[168px] rounded-xl")} />
      </div>
      <div className="flex-1" />
    </div>
  );
}

const CreateStudio = dynamic(() => import("./CreateStudio"), {
  ssr: false,
  loading: CreateSkeleton,
});

export default function CreateLoader() {
  return <CreateStudio />;
}
