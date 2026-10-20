/**
 * GET /api/generations/active?type=video|image — generations still running
 * (started in the last 3 hours), newest first. The Create page polls this to
 * pick up jobs it didn't start itself (MCP / Claude, the gallery, the canvas)
 * and shows them in its feed like its own.
 */
import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

const WINDOW_MS = 3 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") === "image" ? "image" : "video";
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const rows = guestDb.listGenerations(GUEST_USER_ID, type, { status: "pending", since, limit: 30 });
  return NextResponse.json(
    {
      items: rows.map((g) => ({
        task_id: g.task_id,
        model: g.model ?? null,
        prompt: g.prompt ?? "",
        aspect_ratio: g.aspect_ratio ?? null,
        duration: g.duration ?? null,
        sound: !!g.sound,
        quality: g.quality ?? null,
        reference_image_urls: g.reference_image_urls ?? [],
        created_at: g.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
