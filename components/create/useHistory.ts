"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CREATE PAGE — past generations from the gallery API (newest first), paged 20
// at a time: videos or pictures. Shares the gallery page's "videos-generation" /
// "images-generation" cache so both pages paint instantly from whatever the
// other one loaded last.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { type GalleryItem, galleryCache, getToken } from "@/lib/galleryUtils";
import type { CreateKind } from "./shared";

const PAGE_SIZE = 20;

const cacheKey = (kind: CreateKind) => (kind === "image" ? "images-generation" : "videos-generation");

function mergeByNewest(prev: GalleryItem[], incoming: GalleryItem[]): GalleryItem[] {
  const seen = new Set(prev.map((i) => i.id));
  const fresh = incoming.filter((i) => !seen.has(i.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function fetchPage(kind: CreateKind, page: number): Promise<{ items: GalleryItem[]; hasMore: boolean }> {
  const token = await getToken();
  const res = await fetch(`/api/gallery?type=${kind}&page=${page}&source=generation`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Couldn't load your history (${res.status})`);
  const data = (await res.json()) as { items?: GalleryItem[]; hasMore?: boolean };
  // Rows still pending have no file yet.
  return { items: (data.items ?? []).filter((i) => !!i.url), hasMore: !!data.hasMore };
}

export function useHistory(kind: CreateKind = "video") {
  const key = cacheKey(kind);
  const [items, setItems] = useState<GalleryItem[]>(() => galleryCache.get(key)?.items ?? []);
  const [hasMore, setHasMore] = useState<boolean>(() => galleryCache.get(key)?.hasMore ?? true);
  const [loading, setLoading] = useState<boolean>(() => !galleryCache.get(key));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const busyRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
    galleryCache.set(key, { items, hasMore });
  }, [items, hasMore, key]);

  /** Merge a fresh page 0 into what we hold, dropping rows deleted elsewhere. */
  const applyFirstPage = useCallback((fresh: GalleryItem[], more: boolean) => {
    setItems((prev) => {
      if (prev.length === 0) return fresh;
      // Rows inside page 0's time window that the server no longer returns were deleted elsewhere.
      const freshIds = new Set(fresh.map((i) => i.id));
      const oldest = fresh.length ? new Date(fresh[fresh.length - 1].created_at).getTime() : Infinity;
      const kept = prev.filter((i) => freshIds.has(i.id) || new Date(i.created_at).getTime() < oldest);
      return mergeByNewest(kept, fresh);
    });
    if (itemsRef.current.length <= PAGE_SIZE) setHasMore(more);
    setError(null);
  }, []);

  /** Re-reads page 0 and merges anything new on top. Returns the fresh page. */
  const refresh = useCallback(async (): Promise<GalleryItem[]> => {
    try {
      const { items: fresh, hasMore: more } = await fetchPage(kind, 0);
      applyFirstPage(fresh, more);
      return fresh;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [applyFirstPage, kind]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    fetchPage(kind, 0)
      .then(({ items: fresh, hasMore: more }) => { if (!cancelled) applyFirstPage(fresh, more); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyFirstPage, kind]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      // Page from the count we hold, so items prepended since (new results) never cause a skip.
      const page = Math.floor(itemsRef.current.length / PAGE_SIZE);
      const { items: next, hasMore: more } = await fetchPage(kind, page);
      setItems((prev) => mergeByNewest(prev, next));
      setHasMore(more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, kind]);

  /** Same delete route the gallery uses. Optimistic, rolled back on failure. */
  const remove = useCallback(async (item: GalleryItem): Promise<boolean> => {
    const snapshot = itemsRef.current;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const token = await getToken();
      const res = await fetch("/api/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: item.id, source: item.source }),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      return true;
    } catch {
      setItems(snapshot);
      return false;
    }
  }, []);

  return { items, hasMore, loading, loadingMore, error, refresh, loadMore, remove };
}
