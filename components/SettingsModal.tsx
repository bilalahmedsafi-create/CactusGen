"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { MODEL_GROUPS } from "@/lib/models";
import { useWorkflowStore } from "@/lib/store";
import { PROVIDERS, ProviderId, loadModelProviders, saveModelProviders, getModelProvider, providersForModel, modelHasProviderChoice } from "@/lib/providers";
import { isRevanaModel } from "@/lib/revanaModels";

/* ─── Provider options (re-exported for backwards compat) ───────────────────── */

export { PROVIDERS, loadModelProviders, saveModelProviders, getModelProvider };
export type { ProviderId };

export type CodexStatus =
  | { kind: "unknown" }
  | { kind: "ready" }
  | { kind: "not_ready"; installed: boolean; authFound: boolean };

/* ─── Persistence ───────────────────────────────────────────────────────────── */

const AZURE_DEPLOYS_KEY      = "aiui-azure-endpoints";       // per-model deployment names
const AZURE_BASE_KEY         = "aiui-azure-base-url";        // global Foundry base URL
const AZURE_TEXT_DEPLOY_KEY  = "aiui-azure-text-deployment"; // text model deployment (URL path)
const AZURE_TEXT_MODEL_KEY   = "aiui-azure-text-model";      // text model name (request body)

/** Per-model deployment name map (e.g. { "gpt-image-2": "gpt-image-2" }). */
export function loadAzureEndpoints(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AZURE_DEPLOYS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAzureEndpoints(map: Record<string, string>) {
  try {
    localStorage.setItem(AZURE_DEPLOYS_KEY, JSON.stringify(map));
  } catch { /* noop */ }
}

/** Returns the deployment name for a given model, or "" if unset. */
export function getAzureDeployment(modelId: string): string {
  return loadAzureEndpoints()[modelId] ?? "";
}

/** Global Azure Cognitive Services base URL (shared across all models). */
export function loadAzureBaseUrl(): string {
  try {
    return localStorage.getItem(AZURE_BASE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAzureBaseUrl(url: string) {
  try {
    localStorage.setItem(AZURE_BASE_KEY, url);
  } catch { /* noop */ }
}

/** @deprecated renamed — use getAzureDeployment(). Kept for backwards compat. */
export const getAzureEndpoint = getAzureDeployment;

/** Deployment name — used in the URL path (defaults to "auto-model"). */
export function loadAzureTextDeployment(): string {
  try {
    return localStorage.getItem(AZURE_TEXT_DEPLOY_KEY) ?? "auto-model";
  } catch {
    return "auto-model";
  }
}

export function saveAzureTextDeployment(name: string) {
  try {
    localStorage.setItem(AZURE_TEXT_DEPLOY_KEY, name);
  } catch { /* noop */ }
}

/** Model name — passed in the request body (defaults to "model-router"). */
export function loadAzureTextModelName(): string {
  try {
    return localStorage.getItem(AZURE_TEXT_MODEL_KEY) ?? "model-router";
  } catch {
    return "model-router";
  }
}

export function saveAzureTextModelName(name: string) {
  try {
    localStorage.setItem(AZURE_TEXT_MODEL_KEY, name);
  } catch { /* noop */ }
}

/* ─── Nav items ─────────────────────────────────────────────────────────────── */

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

type NavId = "api-keys" | "image-models" | "video-models" | "text-models" | "claude-mcp" | "debug";

const NAV_BASE: { id: NavId; label: string; icon: React.ReactNode }[] = [
  {
    id: "api-keys",
    label: "API Keys",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="15" r="4" />
        <path d="m11.31 11.31 5.19-5.19" />
        <path d="m17 5 1.5 1.5" />
        <path d="m14 8 1.5 1.5" />
      </svg>
    ),
  },
  {
    id: "image-models",
    label: "Image Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    id: "video-models",
    label: "Video Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m22 8-6 4 6 4V8z" />
        <rect x="2" y="6" width="14" height="12" rx="2" />
      </svg>
    ),
  },
  {
    id: "text-models",
    label: "Text Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "claude-mcp",
    label: "Connect Claude",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 7V3M15 7V3" />
        <path d="M6 7h12v4a6 6 0 0 1-12 0V7z" />
        <path d="M12 17v4" />
      </svg>
    ),
  },
];

const DEBUG_NAV_ITEM: { id: NavId; label: string; icon: React.ReactNode } = {
  id: "debug",
  label: "Debug",
  icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
};

const NAV = IS_DEBUG ? [...NAV_BASE, DEBUG_NAV_ITEM] : NAV_BASE;

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface SettingsModalProps {
  onClose: () => void;
}

/* ─── Provider brand icons (kie/azure/codex/revana backend pills) ────────────── */

function ProviderBrandIcon({ id, size = 12 }: { id: ProviderId; size?: number }) {
  if (id === "kie" || id === "revana") {
    return (
      <span className="text-(--c-accent) shrink-0" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.83)}px`, fontWeight: 700 }}>
        {id === "kie" ? "K" : "R"}
      </span>
    );
  }
  if (id === "codex") {
    return (
      <svg className="text-(--c-accent) shrink-0" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd">
        <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
      </svg>
    );
  }
  if (id === "azure") {
    return (
      <svg className="shrink-0" width={size} height={size} viewBox="0 0 256 199">
        <path d="M118.432 187.698c32.89-5.81 60.055-10.618 60.367-10.684l.568-.12l-31.052-36.935c-17.078-20.314-31.051-37.014-31.051-37.11c0-.182 32.063-88.477 32.243-88.792c.06-.105 21.88 37.567 52.893 91.32c29.035 50.323 52.973 91.815 53.195 92.203l.405.707l-98.684-.012l-98.684-.013l59.8-10.564zM0 176.435c0-.052 14.631-25.451 32.514-56.442l32.514-56.347l37.891-31.799C123.76 14.358 140.867.027 140.935.001c.069-.026-.205.664-.609 1.534s-18.919 40.582-41.145 88.25l-40.41 86.67l-29.386.037c-16.162.02-29.385-.005-29.385-.057z" fill="#0089D6" fillRule="nonzero" />
      </svg>
    );
  }
  return null;
}

/* ─── Toggle ─────────────────────────────────────────────────────────────────── */

function ProviderToggle({
  modelId,
  value,
  onChange,
}: {
  modelId: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--c-input)",
        borderRadius: "10px",
        padding: "3px",
        gap: "2px",
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}
    >
      {providersForModel(modelId).map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            id={`provider-${modelId}-${p.id}`}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(p.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.01em",
              transition: "background 140ms ease, color 140ms ease",
              background: active ? "rgba(255,255,255,0.1)" : "transparent",
              color: active ? "var(--c-text)" : "var(--c-text-3)",
              whiteSpace: "nowrap",
            }}
          >
            <ProviderBrandIcon id={p.id} />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Model row ─────────────────────────────────────────────────────────────── */

function ModelRow({
  id,
  name,
  providerLabel,
  category,
  value,
  onChange,
  hasProviderChoice,
}: {
  id: string;
  name: string;
  providerLabel: string;
  category: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
  hasProviderChoice: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "11px 16px",
        borderRadius: "12px",
        background: "var(--c-raise)",
        border: "1px solid var(--c-line)",
      }}
    >
      {/* Labels */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.28)",
            marginTop: "2px",
          }}
        >
          {providerLabel} · {category}
        </div>
      </div>

      {/* Provider toggle — only shown for models with more than one backend to choose from */}
      {hasProviderChoice && <ProviderToggle modelId={id} value={value} onChange={onChange} />}
    </div>
  );
}

/* ─── Section group ─────────────────────────────────────────────────────────── */

function ModelGroup({
  title,
  accent,
  models,
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
  defaultProvider = () => "kie",
}: {
  title: string;
  accent: string;
  models: { id: string; name: string; provider: string; category: string; hasAzureDeployment?: boolean }[];
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
  /** Backend shown for a model the user never picked one for. */
  defaultProvider?: (modelId: string) => ProviderId;
}) {
  return (
    <div>
      {/* Group header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
          {title}
        </span>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {models.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <ModelRow
              id={m.id}
              name={m.name}
              providerLabel={m.provider}
              category={m.category}
              value={providers[m.id] ?? defaultProvider(m.id)}
              onChange={(v) => onProviderChange(m.id, v)}
              hasProviderChoice={modelHasProviderChoice(m.id)}
            />
            {/* Deployment name — shown only for Azure-capable models when Azure is selected */}
            {m.hasAzureDeployment && (providers[m.id] ?? "kie") === "azure" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "12px",
                }}
              >
                <label
                  htmlFor={`azure-deploy-${m.id}`}
                  style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}
                >
                  Deployment Name
                </label>
                <input
                  id={`azure-deploy-${m.id}`}
                  type="text"
                  placeholder={`e.g. ${m.id}`}
                  value={azureDeployments[m.id] ?? ""}
                  onChange={(e) => onDeploymentChange(m.id, e.target.value)}
                  style={{
                    background: "var(--c-input)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    padding: "7px 11px",
                    fontSize: "12px",
                    color: "var(--c-text)",
                    outline: "none",
                    fontFamily: "inherit",
                    fontFeatureSettings: "\"tnum\"",
                  }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
                  onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                />
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
                  The deployment name within your Azure resource. Combined with the global base URL above.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── API Keys panel ─────────────────────────────────────────────────────────── */

const INPUT_STYLE: React.CSSProperties = {
  background: "var(--c-input)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  padding: "7px 11px",
  fontSize: "12px",
  color: "var(--c-text)",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
};

function ApiKeysPanel({
  azureBaseUrl,
  onBaseUrlChange,
  kieKeyStatus,
  onKieKeySave,
  onKieKeyDelete,
  revanaKeyStatus,
  onRevanaKeySave,
  onRevanaKeyDelete,
  anthropicKeyStatus,
  onAnthropicKeySave,
  onAnthropicKeyDelete,
  azureKeyStatus,
  onAzureKeySave,
  onAzureKeyDelete,
  codexStatus,
  onCodexLoginSuccess,
}: {
  azureBaseUrl: string;
  onBaseUrlChange: (v: string) => void;
  kieKeyStatus: "unknown" | "set" | "unset";
  onKieKeySave: (token: string) => Promise<void>;
  onKieKeyDelete: () => Promise<void>;
  revanaKeyStatus: "unknown" | "set" | "unset";
  onRevanaKeySave: (key: string) => Promise<void>;
  onRevanaKeyDelete: () => Promise<void>;
  anthropicKeyStatus: "unknown" | "set" | "unset";
  onAnthropicKeySave: (key: string) => Promise<void>;
  onAnthropicKeyDelete: () => Promise<void>;
  azureKeyStatus: "unknown" | "set" | "unset";
  onAzureKeySave: (key: string) => Promise<void>;
  onAzureKeyDelete: () => Promise<void>;
  codexStatus: CodexStatus;
  onCodexLoginSuccess: () => void;
}) {
  const [kieInput, setKieInput]       = useState("");
  const [kieSaving, setKieSaving]     = useState(false);
  const [kieError, setKieError]       = useState<string | null>(null);
  const [revanaInput, setRevanaInput]   = useState("");
  const [revanaSaving, setRevanaSaving] = useState(false);
  const [revanaError, setRevanaError]   = useState<string | null>(null);
  const [azureInput, setAzureInput]   = useState("");
  const [azureSaving, setAzureSaving] = useState(false);
  const [azureError, setAzureError]   = useState<string | null>(null);

  type CodexLoginFlow =
    | { status: "idle" }
    | { status: "starting" }
    | { status: "pending"; url: string; code: string }
    | { status: "error"; error: string };
  const [loginFlow, setLoginFlow] = useState<CodexLoginFlow>({ status: "idle" });
  const [codeCopied, setCodeCopied] = useState(false);

  const handleConnectCodex = async () => {
    setLoginFlow({ status: "starting" });
    try {
      const res = await fetch("/api/settings/codex-login", { method: "POST" });
      const d = await res.json();
      if (d.status === "pending") setLoginFlow({ status: "pending", url: d.url, code: d.code });
      else setLoginFlow({ status: "error", error: d.error ?? "Failed to start login" });
    } catch (e: unknown) {
      setLoginFlow({ status: "error", error: e instanceof Error ? e.message : "Failed to start login" });
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    }).catch(() => {});
  };

  /* Poll while a device-code login is pending, until it resolves */
  useEffect(() => {
    if (loginFlow.status !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/settings/codex-login");
        const d = await res.json();
        if (d.status === "success") {
          setLoginFlow({ status: "idle" });
          onCodexLoginSuccess();
        } else if (d.status === "error") {
          // Safety net: the login-store verdict can race the credential write.
          // Before showing a red error, confirm against codex-status (which
          // just checks auth.json on disk) — if the login actually landed,
          // treat it as success instead of latching an error.
          let recovered = false;
          try {
            const s = await fetch("/api/settings/codex-status").then((r) => r.json());
            if (s.ready || s.authFound) recovered = true;
          } catch { /* fall through to error */ }
          if (recovered) {
            setLoginFlow({ status: "idle" });
            onCodexLoginSuccess();
          } else {
            setLoginFlow({ status: "error", error: d.error ?? "Login failed" });
          }
        }
        // "pending" → keep polling
      } catch { /* network hiccup — keep polling */ }
    }, 2500);
    return () => clearInterval(interval);
  }, [loginFlow.status, onCodexLoginSuccess]);

  const handleKieSave = async () => {
    if (!kieInput.trim()) return;
    setKieSaving(true);
    setKieError(null);
    try {
      await onKieKeySave(kieInput.trim());
      setKieInput("");
    } catch (e: unknown) {
      setKieError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setKieSaving(false);
    }
  };

  const handleRevanaSave = async () => {
    if (!revanaInput.trim()) return;
    setRevanaSaving(true);
    setRevanaError(null);
    try {
      await onRevanaKeySave(revanaInput.trim());
      setRevanaInput("");
    } catch (e: unknown) {
      setRevanaError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setRevanaSaving(false);
    }
  };

  const handleAzureSave = async () => {
    if (!azureInput.trim()) return;
    setAzureSaving(true);
    setAzureError(null);
    try {
      await onAzureKeySave(azureInput.trim());
      setAzureInput("");
    } catch (e: unknown) {
      setAzureError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAzureSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0 }}>
          API Keys
        </h2>
        <p style={{ fontSize: "12px", color: "var(--c-text-3)", marginTop: "6px", lineHeight: 1.5 }}>
          Your keys are kept by CactusGen&apos;s local server on this computer — they are never exposed to the browser.
        </p>
      </div>

      {/* ──── Kie.ai API key ──────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "var(--c-raise)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--c-radius-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ProviderBrandIcon id="kie" size={16} />
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Kie.ai</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Used for all image &amp; video generation
            </div>
          </div>
          {kieKeyStatus === "set" && (
            <span
              style={{
                marginLeft: "auto", fontSize: "10px", fontWeight: 600,
                color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
                padding: "2px 7px", letterSpacing: "0.04em",
              }}
            >
              SAVED
            </span>
          )}
        </div>

        {kieKeyStatus === "unknown" ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{
              flex: 1, height: "31px", borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite",
            }} />
            <div style={{
              width: "72px", height: "31px", borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite 0.2s",
            }} />
          </div>
        ) : kieKeyStatus === "set" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="password"
              value="placeholdertoken"
              readOnly
              style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
            />
            <button
              onClick={onKieKeyDelete}
              style={{
                padding: "7px 12px", borderRadius: "10px", border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="password"
                placeholder="Paste your Kie.ai API token"
                value={kieInput}
                onChange={(e) => setKieInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleKieSave(); }}
                style={{ ...INPUT_STYLE, flex: 1 }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
                onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
              />
              <button
                onClick={handleKieSave}
                disabled={!kieInput.trim() || kieSaving}
                style={{
                  padding: "7px 14px", borderRadius: "10px", border: "none",
                  background: kieInput.trim() ? "var(--c-accent)" : "var(--c-fill)",
                  color: kieInput.trim() ? "var(--c-accent-ink)" : "var(--c-text-4)",
                  cursor: kieInput.trim() ? "pointer" : "default",
                  fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                  transition: "background 140ms ease, color 140ms ease",
                }}
              >
                {kieSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {kieError && (
              <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{kieError}</p>
            )}
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Get your token at{" "}
              <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>
                kie.ai/api-key
              </a>
            </p>
          </div>
        )}
      </div>

      {/* ──── Revana API key ──────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "var(--c-raise)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--c-radius-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ProviderBrandIcon id="revana" size={16} />
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Revana</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Optional — runs Seedance, Kling &amp; Veo video models (pick per model in Video Models)
            </div>
          </div>
          {revanaKeyStatus === "set" && (
            <span
              style={{
                marginLeft: "auto", fontSize: "10px", fontWeight: 600,
                color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
                padding: "2px 7px", letterSpacing: "0.04em",
              }}
            >
              SAVED
            </span>
          )}
        </div>

        {revanaKeyStatus === "unknown" ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{
              flex: 1, height: "31px", borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite",
            }} />
            <div style={{
              width: "72px", height: "31px", borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite 0.2s",
            }} />
          </div>
        ) : revanaKeyStatus === "set" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="password"
              value="placeholdertoken"
              readOnly
              aria-label="Saved Revana API key"
              style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
            />
            <button
              onClick={onRevanaKeyDelete}
              style={{
                padding: "7px 12px", borderRadius: "10px", border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="password"
                placeholder="Paste your Revana API key"
                aria-label="Revana API key"
                value={revanaInput}
                onChange={(e) => setRevanaInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRevanaSave(); }}
                style={{ ...INPUT_STYLE, flex: 1 }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
                onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
              />
              <button
                onClick={handleRevanaSave}
                disabled={!revanaInput.trim() || revanaSaving}
                style={{
                  padding: "7px 14px", borderRadius: "10px", border: "none",
                  background: revanaInput.trim() ? "var(--c-accent)" : "var(--c-fill)",
                  color: revanaInput.trim() ? "var(--c-accent-ink)" : "var(--c-text-4)",
                  cursor: revanaInput.trim() ? "pointer" : "default",
                  fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                  transition: "background 140ms ease, color 140ms ease",
                }}
              >
                {revanaSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {revanaError && (
              <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{revanaError}</p>
            )}
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Get a key at{" "}
              <a href="https://revana.si" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>
                revana.si
              </a>
            </p>
          </div>
        )}
      </div>

      {/* ──── Claude (Anthropic) API key ─────────────────────────────── */}
      <ClaudeKeyCard status={anthropicKeyStatus} onSave={onAnthropicKeySave} onDelete={onAnthropicKeyDelete} />

      {/* ──── Azure Foundry API key + endpoint ────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "var(--c-raise)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--c-radius-card)",
        }}
      >
        {/* Azure logo/title row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ProviderBrandIcon id="azure" size={16} />
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Azure Foundry</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              API key &amp; base URL — used by all Azure-routed models
            </div>
          </div>
          {azureKeyStatus === "set" && (
            <span
              style={{
                marginLeft: "auto", fontSize: "10px", fontWeight: 600,
                color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
                padding: "2px 7px", letterSpacing: "0.04em",
              }}
            >
              SAVED
            </span>
          )}
        </div>

        {/* API Key */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label
            htmlFor="azure-api-key"
            style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            API Key
          </label>
          {azureKeyStatus === "unknown" ? (
            <div style={{
              height: "31px", borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite",
            }} />
          ) : azureKeyStatus === "set" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="password"
                value="placeholdertoken"
                readOnly
                style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
              />
              <button
                onClick={onAzureKeyDelete}
                style={{
                  padding: "7px 12px", borderRadius: "10px", border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
                  cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  id="azure-api-key"
                  type="password"
                  placeholder="Paste your Azure Foundry API key"
                  value={azureInput}
                  onChange={(e) => setAzureInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAzureSave(); }}
                  style={{ ...INPUT_STYLE, flex: 1 }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
                  onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                />
                <button
                  onClick={handleAzureSave}
                  disabled={!azureInput.trim() || azureSaving}
                  style={{
                    padding: "7px 14px", borderRadius: "10px", border: "none",
                    background: azureInput.trim() ? "var(--c-accent)" : "var(--c-fill)",
                    color: azureInput.trim() ? "var(--c-accent-ink)" : "var(--c-text-4)",
                    cursor: azureInput.trim() ? "pointer" : "default",
                    fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                    transition: "background 140ms ease, color 140ms ease",
                  }}
                >
                  {azureSaving ? "Saving…" : "Save"}
                </button>
              </div>
              {azureError && (
                <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{azureError}</p>
              )}
            </div>
          )}
        </div>

        {/* Base URL */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label
            htmlFor="azure-global-base-url"
            style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            Base URL
          </label>
          <input
            id="azure-global-base-url"
            type="url"
            placeholder="https://<resource>.cognitiveservices.azure.com"
            value={azureBaseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            style={INPUT_STYLE}
            onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
            onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
          />
          <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
            Combined with per-model deployment names below.
          </p>
        </div>
      </div>

      {/* ──── Codex CLI status ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "var(--c-raise)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--c-radius-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ProviderBrandIcon id="codex" size={16} />
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Codex CLI</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Uses the server&apos;s local <code style={{ fontFamily: "monospace" }}>codex login</code> session — no per-user key
            </div>
          </div>
          <span
            style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 600,
              color: codexStatus.kind === "ready" ? "rgba(74,222,128,0.8)" : "rgba(251,191,36,0.8)",
              background: codexStatus.kind === "ready" ? "rgba(74,222,128,0.08)" : "rgba(251,191,36,0.08)",
              border: `1px solid ${codexStatus.kind === "ready" ? "rgba(74,222,128,0.2)" : "rgba(251,191,36,0.2)"}`,
              borderRadius: "5px", padding: "2px 7px", letterSpacing: "0.04em", whiteSpace: "nowrap",
            }}
          >
            {codexStatus.kind === "unknown" ? "CHECKING…" : codexStatus.kind === "ready" ? "READY" : "NOT CONFIGURED"}
          </span>
        </div>

        {/* auth.json can exist but hold a stale/invalidated refresh token (e.g. the
            "session has ended" 401) — the status check only sees that the file is
            there, so it still reports READY. Offer a manual reauth escape hatch. */}
        {codexStatus.kind === "ready" && loginFlow.status === "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5, flex: 1 }}>
              Getting a &quot;session has ended&quot; or 401 error? Reauth below.
            </p>
            <button
              onClick={handleConnectCodex}
              style={{
                padding: "7px 14px", borderRadius: "10px", border: "1px solid transparent",
                background: "var(--c-accent)", color: "var(--c-accent-ink)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Reauth
            </button>
          </div>
        )}

        {/* Starting a new login immediately invalidates any existing session on this
            host — the CLI clears old credentials the moment a login attempt begins,
            before the user does anything in the browser. Only offer it when auth is
            actually missing; a missing binary alone shouldn't risk a working login. */}
        {codexStatus.kind === "not_ready" && !codexStatus.authFound && loginFlow.status === "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5, flex: 1 }}>
              Requires <a href="https://github.com/jdmnk/codex-imagegen-cli" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>codex-imagegen-cli</a> installed on this server. Sign in below.
            </p>
            <button
              onClick={handleConnectCodex}
              style={{
                padding: "7px 14px", borderRadius: "10px", border: "1px solid transparent",
                background: "var(--c-accent)", color: "var(--c-accent-ink)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Connect Codex
            </button>
          </div>
        )}

        {codexStatus.kind === "not_ready" && codexStatus.authFound && !codexStatus.installed && loginFlow.status === "idle" && (
          <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
            Signed in, but <a href="https://github.com/jdmnk/codex-imagegen-cli" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>codex-imagegen-cli</a> isn&apos;t installed on this server yet — image generation will fail until it is.
          </p>
        )}

        {loginFlow.status === "starting" && (
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", margin: 0 }}>Starting login…</p>
        )}

        {loginFlow.status === "pending" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px", background: "var(--c-input)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px" }}>
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.6 }}>
              1. Open{" "}
              <a href={loginFlow.url} target="_blank" rel="noreferrer" style={{ color: "var(--c-accent)" }}>
                {loginFlow.url}
              </a>
              <br />
              2. Enter this one-time code:
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontFamily: "monospace", fontSize: "15px", fontWeight: 700, letterSpacing: "0.06em",
                  color: "var(--c-accent)", background: "var(--c-accent-soft)",
                  border: "1px solid var(--c-accent-line)", borderRadius: "8px", padding: "6px 12px",
                }}
              >
                {loginFlow.code}
              </span>
              <button
                onClick={() => handleCopyCode(loginFlow.code)}
                style={{
                  padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
                  cursor: "pointer", fontSize: "11px", fontWeight: 500,
                }}
              >
                {codeCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", margin: 0 }}>
              Waiting for confirmation… the code expires in 15 minutes.
            </p>
          </div>
        )}

        {loginFlow.status === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0, flex: 1 }}>{loginFlow.error}</p>
            <button
              onClick={handleConnectCodex}
              style={{
                padding: "6px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

/* ─── Claude (Anthropic) key card ─────────────────────────────────────────────── */

function ClaudeMark({ size = 16 }: { size?: number }) {
  // Anthropic-orange asterisk — a plain glyph, not the logo.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="#D97757" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ClaudeKeyCard({
  status,
  onSave,
  onDelete,
}: {
  status: "unknown" | "set" | "unset";
  onSave: (key: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(input.trim());
      setInput("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: "10px", padding: "16px",
        background: "var(--c-raise)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "var(--c-radius-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          style={{
            width: "28px", height: "28px", borderRadius: "8px", flexShrink: 0,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <ClaudeMark />
        </span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Claude (Anthropic) API key</div>
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
            Optional — Chat, the canvas assistant and &quot;Improve prompt&quot; call Claude directly with it (otherwise through Kie.ai)
          </div>
        </div>
        {status === "set" && (
          <span
            style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 600,
              color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
              padding: "2px 7px", letterSpacing: "0.04em",
            }}
          >
            SAVED
          </span>
        )}
      </div>

      {status === "unknown" ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: 1, height: "31px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", animation: "skeleton-pulse 1.4s ease-in-out infinite" }} />
          <div style={{ width: "72px", height: "31px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", animation: "skeleton-pulse 1.4s ease-in-out infinite 0.2s" }} />
        </div>
      ) : status === "set" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="password"
            value="placeholdertoken"
            readOnly
            aria-label="Saved Claude API key"
            style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
          />
          <button
            onClick={onDelete}
            style={{
              padding: "7px 12px", borderRadius: "10px", border: "1px solid rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
              cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="password"
              placeholder="Paste your Claude API key (sk-ant-…)"
              aria-label="Claude API key"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              style={{ ...INPUT_STYLE, flex: 1 }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <button
              onClick={save}
              disabled={!input.trim() || saving}
              style={{
                padding: "7px 14px", borderRadius: "10px", border: "none",
                background: input.trim() ? "var(--c-accent)" : "var(--c-fill)",
                color: input.trim() ? "var(--c-accent-ink)" : "var(--c-text-4)",
                cursor: input.trim() ? "pointer" : "default",
                fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                transition: "background 140ms ease, color 140ms ease",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{error}</p>}
          <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
            Create a key at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>
              console.anthropic.com/settings/keys
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Connect Claude (MCP) panel ───────────────────────────────────────────────── */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      style={{
        padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)",
        background: copied ? "var(--c-accent-soft)" : "var(--c-fill)",
        color: copied ? "var(--c-accent)" : "var(--c-text-2)",
        cursor: "pointer", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
        transition: "background 140ms ease, color 140ms ease",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Snippet({ title, hint, code, copyLabel }: { title: string; hint: React.ReactNode; code: string; copyLabel: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{title}</div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginTop: "2px", lineHeight: 1.45 }}>{hint}</div>
        </div>
        <CopyButton text={code} label={copyLabel} />
      </div>
      <pre
        style={{
          margin: 0, padding: "10px 12px", borderRadius: "12px",
          background: "var(--c-input)", border: "1px solid rgba(255,255,255,0.08)",
          fontSize: "11.5px", lineHeight: 1.55, color: "rgba(255,255,255,0.75)",
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: "220px", overflow: "auto",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function McpPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url] = useState(() => (typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp"));

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/mcp", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
        if (!alive) return;
        if (d.token) setToken(d.token);
        else setError(d.error ?? `Couldn't load the token (${r.status}).`);
      })
      .catch(() => { if (alive) setError("Couldn't load the token."); });
    return () => { alive = false; };
  }, []);

  const regenerate = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const d = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (d.token) {
        setToken(d.token);
        setRevealed(true);
        setError(null);
      } else setError(d.error ?? "Couldn't make a new token.");
    } finally {
      setBusy(false);
      setConfirmRegen(false);
    }
  };

  const t = token ?? "<TOKEN>";
  const claudeCode = `claude mcp add --transport http cactusgen ${url} --header "Authorization: Bearer ${t}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        cactusgen: {
          command: "npx",
          args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: `Bearer ${t}` },
        },
      },
    },
    null,
    2,
  );
  const isDev = /:3000\//.test(url);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0 }}>
          Connect Claude (MCP)
        </h2>
        <p style={{ fontSize: "12px", color: "var(--c-text-3)", marginTop: "8px", lineHeight: 1.55 }}>
          Let Claude Code or Claude Desktop drive CactusGen: list models, check prices, start video and image
          generations with your saved keys, and get the finished files. Generations appear on the Create page like any other.
          They spend your Kie.ai / Revana credit — keep the token private.
        </p>
      </div>

      <div
        style={{
          display: "flex", flexDirection: "column", gap: "14px", padding: "16px",
          background: "var(--c-raise)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "var(--c-radius-card)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
            Server URL
          </label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input readOnly value={url} aria-label="MCP server URL" style={{ ...INPUT_STYLE, flex: 1, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }} />
            <CopyButton text={url} label="Copy MCP server URL" />
          </div>
          <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.28)", margin: 0, lineHeight: 1.5 }}>
            {isDev
              ? "This is the development server (port 3000). The installed app uses its own port — open this page there for its URL."
              : "Works while CactusGen is open. Only this computer can connect."}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
            Access token
          </label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              readOnly
              type={revealed ? "text" : "password"}
              value={token ?? ""}
              placeholder={error ? "" : "Loading…"}
              aria-label="MCP access token"
              style={{ ...INPUT_STYLE, flex: 1, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
            />
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              disabled={!token}
              style={{
                padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)",
                cursor: token ? "pointer" : "default", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap",
              }}
            >
              {revealed ? "Hide" : "Show"}
            </button>
            {token && <CopyButton text={token} label="Copy MCP access token" />}
          </div>
          {error && <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.75)", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {confirmRegen ? (
              <>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
                  Make a new token? Connected apps stop working until you update them.
                </span>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={busy}
                  style={{
                    padding: "4px 10px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.35)",
                    background: "rgba(239,68,68,0.08)", color: "rgba(239,68,68,0.85)",
                    cursor: "pointer", fontSize: "11px", fontWeight: 600,
                  }}
                >
                  {busy ? "Making…" : "Yes, make a new one"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRegen(false)}
                  style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: "11px" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRegen(true)}
                disabled={!token}
                style={{ background: "none", border: "none", padding: 0, color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: "11px", textDecoration: "underline", textUnderlineOffset: "2px" }}
              >
                Regenerate token
              </button>
            )}
          </div>
        </div>
      </div>

      <Snippet
        title="Claude Code"
        hint="Run once in a terminal. Then ask Claude Code things like “make a 10-second Seedance video of …”."
        code={claudeCode}
        copyLabel="Copy the Claude Code command"
      />
      <Snippet
        title="Claude Desktop"
        hint={<>Settings → Developer → Edit Config, add this to <code>claude_desktop_config.json</code> (merge it into an existing <code>mcpServers</code>), then restart Claude Desktop. Needs Node.js.</>}
        code={desktop}
        copyLabel="Copy the Claude Desktop config"
      />
      <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", margin: 0, lineHeight: 1.55 }}>
        Tools: list_models, estimate_cost, generate_video, generate_image, get_job, list_history. Prompts can mention
        references as @image1, @video1, @audio1. Results are saved in your CactusGen library.
      </p>
    </div>
  );
}

/* ─── Provider legend (shared) ───────────────────────────────────────────────── */

function ProviderLegend({ only }: { only: ProviderId[] }) {
  return (
    <div style={{ display: "flex", gap: "12px", padding: "12px 16px", background: "var(--c-raise)", border: "1px solid var(--c-line)", borderRadius: "12px" }}>
      {PROVIDERS.filter((p) => only.includes(p.id)).map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.02em" }}>
            <ProviderBrandIcon id={p.id} />
          </span>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Image Models panel ─────────────────────────────────────────────────────── */

function ImageModelsPanel({
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
}: {
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
}) {
  const models = IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Image",
    hasAzureDeployment: !!m.azureSizeMap,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0 }}>
          Image Models
        </h2>
        <p style={{ fontSize: "12px", color: "var(--c-text-3)", marginTop: "6px", lineHeight: 1.5 }}>
          Choose which provider serves each image model. Azure-capable models show a deployment name field when Azure is selected.
        </p>
      </div>
      <ProviderLegend only={["kie", "azure", "codex"]} />
      <ModelGroup
        title="Image Models"
        accent="var(--c-accent)"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </div>
  );
}

/* ─── Video Models panel ─────────────────────────────────────────────────────── */

function VideoModelsPanel({
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
  revanaOnly,
}: {
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
  /** Only a Revana key is saved — unpicked Revana models run there (server default). */
  revanaOnly: boolean;
}) {
  const models = VIDEO_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Video",
    hasAzureDeployment: false,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0 }}>
          Video Models
        </h2>
        <p style={{ fontSize: "12px", color: "var(--c-text-3)", marginTop: "6px", lineHeight: 1.5 }}>
          Choose which provider serves each video model. Models with a Revana option run there with your Revana key.
        </p>
      </div>
      <ProviderLegend only={["kie", "revana"]} />
      <ModelGroup
        title="Video Models"
        accent="var(--c-accent)"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
        defaultProvider={(id) => (revanaOnly && isRevanaModel(id) ? "revana" : "kie")}
      />
    </div>
  );
}

/* ─── Text Models panel ──────────────────────────────────────────────────────── */

function TextModelsPanel({
  azureKeyStatus,
  azureBaseUrl,
  azureTextDeployment,
  azureTextModelName,
  onDeploymentChange,
  onModelNameChange,
}: {
  azureKeyStatus: "unknown" | "set" | "unset";
  azureBaseUrl: string;
  azureTextDeployment: string;
  azureTextModelName: string;
  onDeploymentChange: (v: string) => void;
  onModelNameChange: (v: string) => void;
}) {
  const azureReady = azureKeyStatus === "set" && !!azureBaseUrl.trim();
  const kieGroups = MODEL_GROUPS.filter(g => g.label !== "Azure");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0 }}>
          Text Models
        </h2>
        <p style={{ fontSize: "12px", color: "var(--c-text-3)", marginTop: "6px", lineHeight: 1.5 }}>
          Configure AI text models for chat. Azure Auto uses your Azure Foundry credentials from the API Keys tab.
        </p>
      </div>

      {/* Kie.ai models */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {kieGroups.map((group) => (
          <div key={group.label}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--c-accent)", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
                {group.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {group.models.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px",
                    padding: "11px 16px", borderRadius: "12px",
                    background: "var(--c-raise)",
                    border: "1px solid var(--c-line)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.85)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)", marginTop: "2px" }}>
                      Kie.ai · {m.desc}
                    </div>
                  </div>
                  <span style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "3px 8px", borderRadius: "6px",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.4)",
                    whiteSpace: "nowrap",
                  }}>
                    <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>K</span>
                    Kie.ai
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Azure Auto card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          padding: "16px",
          background: "var(--c-raise)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "var(--c-radius-card)",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, color: "var(--c-text-2)",
            }}
          >
            Az
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Azure Auto</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Model-router — automatically selects the best model for each request
            </div>
          </div>
          <span
            style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 600,
              color: azureReady ? "rgba(74,222,128,0.8)" : "rgba(251,191,36,0.8)",
              background: azureReady ? "rgba(74,222,128,0.08)" : "rgba(251,191,36,0.08)",
              border: `1px solid ${azureReady ? "rgba(74,222,128,0.2)" : "rgba(251,191,36,0.2)"}`,
              borderRadius: "5px", padding: "2px 7px", letterSpacing: "0.04em", whiteSpace: "nowrap",
            }}
          >
            {azureReady ? "READY" : "NOT CONFIGURED"}
          </span>
        </div>

        {/* Status notice if not ready */}
        {!azureReady && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(251,191,36,0.05)",
              border: "1px solid rgba(251,191,36,0.15)",
              borderRadius: "8px",
              fontSize: "11px",
              color: "rgba(251,191,36,0.7)",
              lineHeight: 1.5,
            }}
          >
            {azureKeyStatus !== "set"
              ? "Add your Azure Foundry API key in the API Keys tab to enable this model."
              : "Add your Azure Foundry Base URL in the API Keys tab to enable this model."}
          </div>
        )}

        {/* Two-column grid: Model Name + Deployment */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Model Name */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label
              htmlFor="azure-text-model-name"
              style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}
            >
              Model Name
            </label>
            <input
              id="azure-text-model-name"
              type="text"
              placeholder="model-router"
              value={azureTextModelName}
              onChange={(e) => onModelNameChange(e.target.value)}
              style={{
                background: "var(--c-input)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "10px",
                padding: "7px 11px",
                fontSize: "12px",
                color: "var(--c-text)",
                outline: "none",
                fontFamily: "inherit",
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Passed as <code style={{ fontFamily: "monospace" }}>model</code> in the request body.
            </p>
          </div>

          {/* Deployment */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label
              htmlFor="azure-text-deployment"
              style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}
            >
              Deployment
            </label>
            <input
              id="azure-text-deployment"
              type="text"
              placeholder="auto-model"
              value={azureTextDeployment}
              onChange={(e) => onDeploymentChange(e.target.value)}
              style={{
                background: "var(--c-input)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "10px",
                padding: "7px 11px",
                fontSize: "12px",
                color: "var(--c-text)",
                outline: "none",
                fontFamily: "inherit",
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--c-accent-line)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Used in the URL path <code style={{ fontFamily: "monospace" }}>/deployments/{"{deployment}"}</code>.
            </p>
          </div>
        </div>

        {/* API version (read-only) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--c-text-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            API Version
          </span>
          <div style={{ padding: "7px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", fontSize: "12px", color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
            2024-04-01-preview
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Debug panel ───────────────────────────────────────────────────────────── */

function DebugPanel() {
  const debugMode     = useWorkflowStore((s) => s.debugMode);
  const toggleDebug   = useWorkflowStore((s) => s.toggleDebug);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h2 className="cg-display" style={{ fontSize: "28px", color: "var(--c-text)", margin: 0, marginBottom: "6px" }}>Debug</h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
          Only visible when <code style={{ fontFamily: "monospace", color: "rgba(251,191,36,0.8)" }}>NEXT_PUBLIC_DEBUG=true</code>
        </p>
      </div>

      {/* Simulate generation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", borderRadius: "var(--c-radius-card)", background: "var(--c-raise)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>Simulate generation</span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            Skip the real API call — fake a 5-second generation and log the payload to the server console.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={debugMode}
          aria-label="Simulate generation"
          onClick={toggleDebug}
          style={{
            flexShrink: 0,
            width: "40px",
            height: "22px",
            borderRadius: "11px",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            background: debugMode ? "var(--c-accent)" : "rgba(255,255,255,0.12)",
            transition: "background 200ms",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: debugMode ? "var(--c-accent-ink)" : "var(--c-text)",
            transform: debugMode ? "translateX(18px)" : "translateX(0px)",
            transition: "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
            boxShadow: debugMode ? "none" : "0 1px 3px rgba(0,0,0,0.4)",
          }} />
        </button>
      </div>
    </div>
  );
}

/* ─── Main modal ─────────────────────────────────────────────────────────────── */

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeNav, setActiveNav]             = useState<NavId>("api-keys");
  const [modelProviders, setModelProviders]   = useState<Record<string, ProviderId>>({});
  const [azureDeployments, setAzureDeployments] = useState<Record<string, string>>({});
  const [azureBaseUrl, setAzureBaseUrl]               = useState("");
  const [azureTextDeployment, setAzureTextDeployment] = useState("auto-model");
  const [azureTextModelName, setAzureTextModelName]   = useState("model-router");
  const [kieKeyStatus, setKieKeyStatus]               = useState<"unknown" | "set" | "unset">("unknown");
  const [revanaKeyStatus, setRevanaKeyStatus]         = useState<"unknown" | "set" | "unset">("unknown");
  const [anthropicKeyStatus, setAnthropicKeyStatus]   = useState<"unknown" | "set" | "unset">("unknown");
  const [azureKeyStatus, setAzureKeyStatus]   = useState<"unknown" | "set" | "unset">("unknown");
  const [codexStatus, setCodexStatus]         = useState<CodexStatus>({ kind: "unknown" });
  const setKieKeySet    = useWorkflowStore((s) => s.setKieKeySet);
  const setRevanaKeySet = useWorkflowStore((s) => s.setRevanaKeySet);
  const setAnthropicKeySet = useWorkflowStore((s) => s.setAnthropicKeySet);
  const setAzureKeySet  = useWorkflowStore((s) => s.setAzureKeySet);
  const overlayRef = useRef<HTMLDivElement>(null);

  async function authHeader(): Promise<Record<string, string>> {
    return {};
  }

  const refreshCodexStatus = useCallback(() => {
    fetch("/api/settings/codex-status")
      .then((r) => r.json())
      .then((d: { ready: boolean; installed: boolean; authFound: boolean }) =>
        setCodexStatus(d.ready ? { kind: "ready" } : { kind: "not_ready", installed: d.installed, authFound: d.authFound })
      )
      .catch(() => setCodexStatus({ kind: "not_ready", installed: false, authFound: false }));
  }, []);

  /* Load persisted data on mount */
  useEffect(() => {
    setModelProviders(loadModelProviders());
    setAzureDeployments(loadAzureEndpoints());
    setAzureBaseUrl(loadAzureBaseUrl());
    setAzureTextDeployment(loadAzureTextDeployment());
    setAzureTextModelName(loadAzureTextModelName());
    // Check if Kie key is saved on the server
    authHeader().then((h) =>
      fetch("/api/settings/kie-key", { headers: h })
        .then((r) => r.json())
        .then((d) => setKieKeyStatus(d.hasToken ? "set" : "unset"))
        .catch(() => setKieKeyStatus("unset"))
    );
    // Check if Revana key is saved on the server
    authHeader().then((h) =>
      fetch("/api/settings/revana-key", { headers: h })
        .then((r) => r.json())
        .then((d) => setRevanaKeyStatus(d.hasToken ? "set" : "unset"))
        .catch(() => setRevanaKeyStatus("unset"))
    );
    // Check if a Claude (Anthropic) key is saved on the server
    fetch("/api/settings/anthropic-key")
      .then((r) => r.json())
      .then((d) => setAnthropicKeyStatus(d.hasToken ? "set" : "unset"))
      .catch(() => setAnthropicKeyStatus("unset"));
    // Check if Azure key is saved on the server
    authHeader().then((h) =>
      fetch("/api/settings/azure-key", { headers: h })
        .then((r) => r.json())
        .then((d) => setAzureKeyStatus(d.hasToken ? "set" : "unset"))
        .catch(() => setAzureKeyStatus("unset"))
    );
    // Check whether the server has a working codex-imagegen + codex login
    refreshCodexStatus();
  }, [refreshCodexStatus]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Close on backdrop click */
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleProviderChange = (modelId: string, v: ProviderId) => {
    const next = { ...modelProviders, [modelId]: v };
    saveModelProviders(next);
    setModelProviders(next);
  };

  const handleDeploymentChange = (modelId: string, v: string) => {
    setAzureDeployments((prev) => {
      const next = { ...prev, [modelId]: v };
      saveAzureEndpoints(next);
      return next;
    });
  };

  const handleBaseUrlChange = (v: string) => {
    setAzureBaseUrl(v);
    saveAzureBaseUrl(v);
  };

  const handleKieKeySave = async (token: string) => {
    const h = await authHeader();
    const res = await fetch("/api/settings/kie-key", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ kieApiToken: token }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setKieKeyStatus("set");
    setKieKeySet(true);
  };

  const handleKieKeyDelete = async () => {
    const h = await authHeader();
    await fetch("/api/settings/kie-key", { method: "DELETE", headers: h });
    setKieKeyStatus("unset");
    setKieKeySet(false);
  };

  const handleRevanaKeySave = async (key: string) => {
    const h = await authHeader();
    const res = await fetch("/api/settings/revana-key", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ revanaApiKey: key }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setRevanaKeyStatus("set");
    setRevanaKeySet(true);
  };

  const handleRevanaKeyDelete = async () => {
    const h = await authHeader();
    await fetch("/api/settings/revana-key", { method: "DELETE", headers: h });
    setRevanaKeyStatus("unset");
    setRevanaKeySet(false);
  };

  const handleAnthropicKeySave = async (key: string) => {
    const res = await fetch("/api/settings/anthropic-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: key }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setAnthropicKeyStatus("set");
    setAnthropicKeySet(true);
  };

  const handleAnthropicKeyDelete = async () => {
    await fetch("/api/settings/anthropic-key", { method: "DELETE" });
    // An ANTHROPIC_API_KEY environment variable still counts after removal.
    const d = await fetch("/api/settings/anthropic-key").then((r) => r.json()).catch(() => ({ hasToken: false }));
    setAnthropicKeyStatus(d.hasToken ? "set" : "unset");
    setAnthropicKeySet(!!d.hasToken);
  };

  const handleAzureKeySave = async (key: string) => {
    const h = await authHeader();
    const res = await fetch("/api/settings/azure-key", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ azureApiKey: key }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setAzureKeyStatus("set");
    setAzureKeySet(true);
  };

  const handleAzureKeyDelete = async () => {
    const h = await authHeader();
    await fetch("/api/settings/azure-key", { method: "DELETE", headers: h });
    setAzureKeyStatus("unset");
    setAzureKeySet(false);
  };

  const handleAzureTextDeploymentChange = (v: string) => {
    setAzureTextDeployment(v);
    saveAzureTextDeployment(v);
  };

  const handleAzureTextModelNameChange = (v: string) => {
    setAzureTextModelName(v);
    saveAzureTextModelName(v);
  };

  return (
    <>
      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes settingsOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes settingsModalIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        #settings-modal input:focus,
        #settings-modal textarea:focus {
          border-color: var(--c-accent-line) !important;
          box-shadow: 0 0 0 3px rgba(212, 255, 42, 0.12);
        }
        #settings-modal button:disabled { cursor: not-allowed; }
        #settings-modal button:focus-visible { outline: 2px solid rgba(212, 255, 42, 0.8); outline-offset: 2px; }
      `}</style>

      {/* ── Backdrop ── */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          animation: "settingsOverlayIn 180ms ease both",
        }}
      />

      {/* ── Modal shell ── */}
      <div
        id="settings-modal"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          width: "min(75vw, 960px)",
          height: "min(75vh, 680px)",
          display: "flex",
          borderRadius: "20px",
          background: "var(--c-popup)",
          color: "var(--c-text)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "var(--c-shadow-pop)",
          overflow: "hidden",
          animation: "settingsModalIn 220ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        {/* ── Left sidebar ── */}
        <div
          style={{
            width: "200px",
            flexShrink: 0,
            borderRight: "1px solid var(--c-line)",
            background: "rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            padding: "20px 12px",
            gap: "2px",
          }}
        >
          {/* Title */}
          <div
            className="cg-display"
            style={{
              fontSize: "24px",
              color: "var(--c-text)",
              padding: "4px 10px 16px",
            }}
          >
            Settings
          </div>

          {/* Nav items */}
          {NAV.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveNav(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                  color: isActive ? "var(--c-text)" : "var(--c-text-3)",
                  fontSize: "13px",
                  fontWeight: 500,
                  textAlign: "left",
                  transition: "background 130ms ease, color 130ms ease",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--c-text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-3)";
                  }
                }}
              >
                <span style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0, display: "flex", color: isActive ? "var(--c-accent)" : "inherit" }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>

        {/* ── Right content ── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Top bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "16px 20px",
              borderBottom: "1px solid var(--c-line)",
              flexShrink: 0,
            }}
          >
            <button
              id="settings-close"
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              title="Close (Esc)"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "10px",
                border: "none",
                cursor: "pointer",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.4)",
                transition: "background 130ms ease, color 130ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.8)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 28px 40px",
            }}
          >
            {activeNav === "api-keys" && (
              <ApiKeysPanel
                azureBaseUrl={azureBaseUrl}
                onBaseUrlChange={handleBaseUrlChange}
                kieKeyStatus={kieKeyStatus}
                onKieKeySave={handleKieKeySave}
                onKieKeyDelete={handleKieKeyDelete}
                revanaKeyStatus={revanaKeyStatus}
                onRevanaKeySave={handleRevanaKeySave}
                onRevanaKeyDelete={handleRevanaKeyDelete}
                anthropicKeyStatus={anthropicKeyStatus}
                onAnthropicKeySave={handleAnthropicKeySave}
                onAnthropicKeyDelete={handleAnthropicKeyDelete}
                azureKeyStatus={azureKeyStatus}
                onAzureKeySave={handleAzureKeySave}
                onAzureKeyDelete={handleAzureKeyDelete}
                codexStatus={codexStatus}
                onCodexLoginSuccess={refreshCodexStatus}
              />
            )}
            {activeNav === "image-models" && (
              <ImageModelsPanel
                providers={modelProviders}
                onProviderChange={handleProviderChange}
                azureDeployments={azureDeployments}
                onDeploymentChange={handleDeploymentChange}
              />
            )}
            {activeNav === "video-models" && (
              <VideoModelsPanel
                providers={modelProviders}
                onProviderChange={handleProviderChange}
                azureDeployments={azureDeployments}
                onDeploymentChange={handleDeploymentChange}
                revanaOnly={kieKeyStatus === "unset" && revanaKeyStatus === "set"}
              />
            )}
            {activeNav === "text-models" && (
              <TextModelsPanel
                azureKeyStatus={azureKeyStatus}
                azureBaseUrl={azureBaseUrl}
                azureTextDeployment={azureTextDeployment}
                azureTextModelName={azureTextModelName}
                onDeploymentChange={handleAzureTextDeploymentChange}
                onModelNameChange={handleAzureTextModelNameChange}
              />
            )}
            {activeNav === "claude-mcp" && <McpPanel />}
            {activeNav === "debug" && IS_DEBUG && <DebugPanel />}
          </div>
        </div>
      </div>
    </>
  );
}
