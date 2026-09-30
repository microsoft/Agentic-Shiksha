const rawBase =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export const API_BASE_URL = rawBase.replace(/\/+$/, "");

// Dashboard server (separate backend on port 8050)
const rawDashboardBase =
  import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:8050";
export const DASHBOARD_API_URL = rawDashboardBase.replace(/\/+$/, "");

// Opt-in: route chat through the AG-UI protocol endpoint (widgets arrive as
// A2UI messages) instead of the legacy bespoke SSE stream. Off by default.
export const USE_AGUI_TRANSPORT =
  String(import.meta.env.VITE_USE_AGUI ?? "").toLowerCase() === "true";

export type BackendConfig = {
  default_model: string;
  agent_model: string;
  allowed_models: string[];
  version: string;
};

function parseBackendConfig(value: unknown): BackendConfig {
  const isName = (item: unknown): item is string =>
    typeof item === "string" && item.trim().length > 0 && item === item.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model configuration.");
  }
  const { default_model, agent_model, allowed_models, version } = value as Record<string, unknown>;
  if (
    !isName(default_model) ||
    !isName(agent_model) ||
    !isName(version) ||
    !Array.isArray(allowed_models) ||
    !allowed_models.length ||
    !allowed_models.every(isName) ||
    !allowed_models.includes(default_model)
  ) {
    throw new Error("Invalid model configuration.");
  }
  return { default_model, agent_model, allowed_models: [...new Set(allowed_models)], version };
}

let _cachedConfig: BackendConfig | null = null;
let _pendingConfig: Promise<BackendConfig> | null = null;

export async function fetchBackendConfig(): Promise<BackendConfig> {
  if (_cachedConfig) return _cachedConfig;

  if (!_pendingConfig) {
    _pendingConfig = (async () => {
      const res = await fetch(`${API_BASE_URL}/api/config`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error("Model configuration is unavailable.");
      const config = parseBackendConfig(await res.json());
      _cachedConfig = config;
      return config;
    })().finally(() => {
      _pendingConfig = null;
    });
  }

  return _pendingConfig;
}

// New Foundry meta-agent IDs
// CACA (Teaching Assistant Creation Agent): Generates both learning AND exam instructions
// CCA (Course Conversational Agent): Builder agent in edit mode
// Temp Teaching Assistant: Preview agent in edit mode
export const COURSE_AGENT_CREATION_AGENT_ID = "course-agent-creation-agent";  // CACA
export const TEMP_COURSE_AGENT_ID = "temp-course-agent";
export const COURSE_CONVERSATIONAL_AGENT_ID = "course-conversational-agent";  // CCA

export const WHITE_BTN =
  "bg-white text-black hover:bg-neutral-200 border border-neutral-300 shadow-sm";
