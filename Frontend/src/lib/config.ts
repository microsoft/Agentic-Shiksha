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

// ===================== Backend Config (fetched dynamically) =====================
// These are fallbacks - actual values come from /api/config
type BackendConfig = { default_model: string; allowed_models: string[] };

let _cachedConfig: BackendConfig | null = null;
let _pendingConfig: Promise<BackendConfig> | null = null;

export async function fetchBackendConfig(): Promise<BackendConfig> {
  if (_cachedConfig) return _cachedConfig;

  if (!_pendingConfig) {
    _pendingConfig = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/config`);
        if (res.ok) {
          _cachedConfig = await res.json() as BackendConfig;
          return _cachedConfig;
        }
      } catch (e) {
        console.warn("Failed to fetch backend config, using fallbacks:", e);
      }

      return {
        default_model: "gpt-5.2-chat",
        allowed_models: ["gpt-5.2-chat", "gpt-4.1", "gpt-4.1-mini"],
      };
    })().finally(() => {
      _pendingConfig = null;
    });
  }

  return _pendingConfig;
}

// Sync fallback for components that can't await
export const AVAILABLE_MODELS = ["gpt-5.2-chat", "gpt-4.1", "gpt-4.1-mini"] as const;
export const MODEL_DEPLOYMENT_DEFAULT = "gpt-5.2-chat" as const;

// New Foundry meta-agent IDs
// CACA (Teaching Assistant Creation Agent): Generates both learning AND exam instructions
// CCA (Course Conversational Agent): Builder agent in edit mode
// Temp Teaching Assistant: Preview agent in edit mode
export const COURSE_AGENT_CREATION_AGENT_ID = "course-agent-creation-agent";  // CACA
export const TEMP_COURSE_AGENT_ID = "temp-course-agent";
export const COURSE_CONVERSATIONAL_AGENT_ID = "course-conversational-agent";  // CCA
export const TEMP_PREVIEW_DEFAULT_MODEL = "gpt-5.2-chat" as const;

export const WHITE_BTN =
  "bg-white text-black hover:bg-neutral-200 border border-neutral-300 shadow-sm";

export const MODEL_DEPLOYMENTS: Record<string, string> = {
  "gpt-5.2-chat": "gpt-5.2-chat",
  "gpt-4.1": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini",
  // Model router deployments with different routing modes
  "model-router-balanced": "model-router-balanced",
  "model-router-cost": "model-router-cost",
  "model-router-quality": "model-router-quality",
};

// Model router mode options for the dropdown
export const MODEL_ROUTER_MODES = [
  { value: "model-router-balanced", label: "Balanced", description: "Best cost within 1-2% quality" },
  { value: "model-router-cost", label: "Cost Effective", description: "Maximum cost savings" },
  { value: "model-router-quality", label: "Quality", description: "Highest quality model" },
] as const;

export type ModelRouterMode = typeof MODEL_ROUTER_MODES[number]["value"];
