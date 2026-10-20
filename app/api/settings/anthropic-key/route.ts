import { NextRequest, NextResponse } from "next/server";
import {
  getAnthropicApiKey,
  setAnthropicApiKey,
  deleteAnthropicApiKey,
} from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getAnthropicApiKey() });
}

export async function POST(req: NextRequest) {
  const { anthropicApiKey } = await req.json();
  if (typeof anthropicApiKey !== "string" || !anthropicApiKey.trim()) {
    return NextResponse.json({ error: "anthropicApiKey is required" }, { status: 400 });
  }
  setAnthropicApiKey(anthropicApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteAnthropicApiKey();
  return NextResponse.json({ ok: true });
}
