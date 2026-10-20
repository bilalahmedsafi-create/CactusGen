/**
 * Which backend (Kie.ai or Revana) runs a generation when the caller didn't
 * say. Server-side; shared by app/api/generate-video and the MCP tools
 * (lib/mcp/tools.ts) so both decide the same way.
 */
import { getKieTokenForUser } from "./getKieToken";
import * as guestDb from "./guest/db";
import { isRevanaModel } from "./revanaModels";

export type Backend = "kie" | "revana";

export async function savedBackendKeys(): Promise<{ kie: boolean; revana: boolean }> {
  const kie = (await getKieTokenForUser()) ?? process.env.KIE_API_TOKEN ?? null;
  return { kie: !!kie, revana: !!guestDb.getRevanaApiKey() };
}

/**
 * Video: an explicit `provider` from the client wins; without one, a
 * Revana-capable model goes to Revana only when Revana is the sole key saved.
 */
export async function resolveVideoProvider(requested: unknown, model: string): Promise<Backend> {
  if (requested === "revana") return "revana";
  if (requested === "kie") return "kie";
  if (!isRevanaModel(model)) return "kie";
  const keys = await savedBackendKeys();
  return !keys.kie && keys.revana ? "revana" : "kie";
}
