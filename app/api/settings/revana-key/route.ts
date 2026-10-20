import { NextRequest, NextResponse } from "next/server";
import {
  getRevanaApiKey,
  setRevanaApiKey,
  deleteRevanaApiKey,
} from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getRevanaApiKey() });
}

export async function POST(req: NextRequest) {
  const { revanaApiKey } = await req.json();
  if (typeof revanaApiKey !== "string" || !revanaApiKey.trim()) {
    return NextResponse.json({ error: "revanaApiKey is required" }, { status: 400 });
  }
  setRevanaApiKey(revanaApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteRevanaApiKey();
  return NextResponse.json({ ok: true });
}
