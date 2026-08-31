/**
 * DashboardView — Instructor / Admin learning-progress dashboard.
 *
 * Layout:
 *   Left sidebar   – Agent selector + Overview / Chat tab buttons
 *   Right content   – Either the analytics overview OR the logging-agent chat
 *
 * The chat pane uses a lightweight DashboardChat component.
 * All code is self-contained — no external dashboard component imports.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import OverviewContent from "@/pages/OverviewPage";
import { DASHBOARD_API_URL } from "@/lib/config";
import { applyNameGuard } from "@/lib/nameGuard";
import {
  triggerInstituteResearch,
  getInstituteResearch,
  triggerDepartmentResearch,
  getDepartmentResearch,
  cancelInstituteResearch,
  cancelDepartmentResearch,
  getBulkResearchStatus,
  type ResearchStatus,
  type BulkResearchItem,
} from "@/lib/api";
import type { ChatMsg } from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { useUserStore } from "@/lib/userStore";
import {
  BarChart3,
  Users,
  BookOpen,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Clock,
  Circle,
  TrendingUp,
  Shield,
  Target,
  FileSearch,
  UserCog,
  GraduationCap,
  Crown,
  Pencil,
  Building2,
  Library,
  LayoutDashboard,
  ChevronLeft,
  UserPlus,
  Plus,
  Upload,
  CheckCircle,
  AlertTriangle,
  FileDown,
  Eye,
  Trash2,
  Microscope,
  MessageSquare,
  Paperclip,
  StopCircle,
  ArrowRightLeft,
  X,
} from "lucide-react";
import {
  listDashboardAgents,
  getAgentOverview,
  getStudentDetail,
  transferAgentOwnership,
  getAgentTeachers,
  setAgentTeachers,
  listFeedback,
  type FeedbackItem,
  type FeedbackStats,
} from "@/lib/dashboardApi";
import type {
  DashboardAgent,
  AgentOverview,
  StudentSummary,
  StudentDetail,
  GroundednessEvaluation,
  GroundednessSummary,
} from "@/lib/dashboardApi";
import { getCourseName } from "@/lib/utils";
import {
  USER_DIRECTORY,
  type UserEntry,
  getAllInstitutes,
  getAllDepartments,
  groupByInstituteDept,
  addUser,
  removeUser,
  updateUser,
  addInstitute,
  addDepartment,
  renameInstitute,
  deleteInstitute,
  renameDepartment,
  deleteDepartment,
  loadDirectory,
  isDirectoryLoaded,
} from "@/lib/userDirectory";
import { type UserRole, ALL_ROLES, getRoleLabel } from "@/lib/roles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Cosmetic only — the server is the authority on super-admin privileges.
const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL ?? "").toLowerCase();

/* ═══════════════════════  Helpers  ═══════════════════════ */

function pctColor(pct: number): string {
  if (pct >= 75) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  if (pct >= 25) return "text-orange-400";
  return "text-red-400";
}

function pctBg(pct: number): string {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  if (pct >= 25) return "bg-orange-500";
  return "bg-red-500";
}

function statusIcon(status: string) {
  if (status === "learned")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (status === "in_progress")
    return <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-neutral-600 shrink-0" />;
}

/* ═══════════════════  Logging-Agent Chat Hook  ═══════════════════ */

function useLoggingChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: text.trim(), createdAt: Date.now() },
        { role: "assistant", content: "", createdAt: Date.now() },
      ]);
      setIsWaitingForResponse(true);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `${DASHBOARD_API_URL}/api/dashboard/logging-agent/chat/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: text.trim(),
              conversation_id: conversationIdRef.current,
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        setIsWaitingForResponse(false);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "thread_id" && evt.conversation_id) {
                conversationIdRef.current = evt.conversation_id;
              } else if (evt.type === "delta" && evt.content) {
                setMessages((p) => {
                  const u = [...p];
                  const l = u[u.length - 1];
                  if (l?.role === "assistant") u[u.length - 1] = { ...l, content: l.content + evt.content };
                  return u;
                });
              } else if (evt.type === "message_block" && evt.content) {
                setMessages((p) => {
                  const u = [...p];
                  const l = u[u.length - 1];
                  if (l?.role === "assistant") {
                    u[u.length - 1] = { ...l, content: l.content + (l.content ? "\n\n" : "") + evt.content };
                  }
                  return u;
                });
              } else if (evt.type === "message_block_delta" && evt.delta) {
                setMessages((p) => {
                  const u = [...p];
                  const l = u[u.length - 1];
                  if (l?.role === "assistant") u[u.length - 1] = { ...l, content: l.content + evt.delta };
                  return u;
                });
              } else if (evt.type === "error" && evt.error) {
                setMessages((p) => {
                  const u = [...p];
                  const l = u[u.length - 1];
                  if (l?.role === "assistant") u[u.length - 1] = { ...l, content: `⚠️ ${evt.error}` };
                  return u;
                });
              }
            } catch { /* skip */ }
          }
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setMessages((p) => {
            const u = [...p];
            const l = u[u.length - 1];
            if (l?.role === "assistant") u[u.length - 1] = { ...l, content: `⚠️ Error: ${e.message}` };
            return u;
          });
        }
      } finally {
        setIsStreaming(false);
        setIsWaitingForResponse(false);
        abortRef.current = null;
      }
    },
    [isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setIsWaitingForResponse(false);
  }, []);

  return { messages, send, stop, isStreaming, isWaitingForResponse };
}

/* ═══════════════════════  Main Component  ═══════════════════════ */

export function DashboardView() {
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const dashboardTab: "overview" | "analytics" | "directory" | "feedback" = location.pathname.includes("/overview") ? "overview" : location.pathname.includes("/user-directory") ? "directory" : location.pathname.includes("/feedback") ? "feedback" : "analytics";
  const setDashboardTab = (tab: "overview" | "analytics" | "directory" | "feedback") => {
    const paths = { overview: "/overview", analytics: "/analytics", directory: "/user-directory", feedback: "/feedback" };
    navigate(paths[tab], { replace: true });
  };
  const { user } = useAuth();

  // ── Data state ──
  const [agents, setAgents] = useState<DashboardAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Groundedness state ──
  const [groundednessEvals, _setGroundednessEvals] = useState<GroundednessEvaluation[]>([]);
  const [groundednessSummary, _setGroundednessSummary] = useState<GroundednessSummary | null>(null);
  const [loadingGroundedness, setLoadingGroundedness] = useState(false);

  // ── Transfer ownership state ──
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetUser, setTransferTargetUser] = useState<string>("");
  const [transferring, setTransferring] = useState(false);

  // ── Assign teachers state ──
  const [teachersDialogOpen, setTeachersDialogOpen] = useState(false);
  const [assignedTeacherIds, setAssignedTeacherIds] = useState<string[]>([]);
  const [teachersOwnerId, setTeachersOwnerId] = useState<string>("");
  const [savingTeachers, setSavingTeachers] = useState(false);

  const openTeachersDialog = async () => {
    if (!selectedAgent) return;
    setTeachersDialogOpen(true);
    try {
      const data = await getAgentTeachers(selectedAgent);
      setAssignedTeacherIds(data.teachers.map((t) => t.user_id));
      setTeachersOwnerId(data.owner_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load teachers");
      setTeachersDialogOpen(false);
    }
  };

  // ── Analytics filter state ──
  const [analyticsInstFilter, setAnalyticsInstFilter] = useState<string>("");
  const [analyticsDeptFilter, setAnalyticsDeptFilter] = useState<string>("");
  const analyticsInstitutes = getAllInstitutes();
  const analyticsDepartments = getAllDepartments(analyticsInstFilter || undefined);
  const handleAnalyticsInstChange = (val: string) => {
    setAnalyticsInstFilter(val);
    setAnalyticsDeptFilter("");
  };

  // ── Chat state ──
  const { messages, send, stop, isStreaming, isWaitingForResponse } = useLoggingChat();
  const [chatInput, setChatInput] = useState("");

  const handleChatSend = useCallback(() => {
    if (!chatInput.trim()) return;
    send(applyNameGuard(chatInput));
    setChatInput("");
  }, [chatInput, send]);

  // ── Fetch agents ──
  useEffect(() => {
    (async () => {
      try {
        const data = await listDashboardAgents();
        setAgents(data.agents);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingAgents(false);
      }
    })();
  }, []);

  // ── Fetch groundedness evaluations (disabled) ──
  const fetchGroundedness = useCallback(async () => {
    // Groundedness evaluation disabled for now
    setLoadingGroundedness(false);
  }, []);

  useEffect(() => {
    fetchGroundedness();
  }, [fetchGroundedness]);

  // ── Select agent ──
  const selectAgent = useCallback(async (agentId: string) => {
    setSelectedAgent(agentId);
    setExpandedStudent(null);
    setStudentDetail(null);
    setError(null);
    setLoadingOverview(true);
    setLoadingStudents(true);
    try {
      const ov = await getAgentOverview(agentId);
      setOverview(ov);
      setStudents(ov.students ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingOverview(false);
      setLoadingStudents(false);
    }
  }, []);

  // ── Toggle student detail ──
  const toggleStudent = useCallback(
    async (userId: string) => {
      if (expandedStudent === userId) {
        setExpandedStudent(null);
        setStudentDetail(null);
        return;
      }
      setExpandedStudent(userId);
      setStudentDetail(null);
      setLoadingDetail(true);
      try {
        const d = await getStudentDetail(selectedAgent!, userId);
        setStudentDetail(d);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedAgent, expandedStudent],
  );

  /* ════════════════════════  Render  ════════════════════════ */

  const userInitials = (() => {
    const displayName = user?.displayName || "User";
    const parts = displayName.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : displayName.slice(0, 2).toUpperCase();
  })();

  return (
    <div className="flex h-dvh bg-neutral-950 text-neutral-100">
      {/* ═════  LEFT SIDEBAR (full height, matches Shiksha style)  ═════ */}
      <aside
        className={`sticky left-0 top-0 h-dvh shrink-0 border-r border-neutral-800/50 flex flex-col will-change-[width] select-none transition-all duration-300 ease-in-out ${
          sidebarOpen
            ? "w-72 bg-neutral-925"
            : "w-14 overflow-hidden bg-neutral-950 cursor-pointer"
        }`}
        onClick={(e) => {
          if (!sidebarOpen && (e.target as HTMLElement).closest("button, a") === null) {
            setSidebarOpen(true);
          }
        }}
      >
        {/* Header - expanded */}
        {sidebarOpen && (
          <div className="flex-shrink-0 flex items-center p-3 justify-between pt-4 bg-neutral-925 animate-in fade-in slide-in-from-left-2 duration-200">
            <span className="px-2 text-lg font-bold bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent">
              Dashboard
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="h-8 w-8 mr-1 rounded-lg bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all duration-200 flex items-center justify-center"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Expand button - collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="size-10 rounded-xl bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all duration-300 mx-auto mt-4 flex items-center justify-center"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Navigation */}
        {sidebarOpen ? (
          <nav className="flex flex-col gap-2 px-3 mt-2 animate-in fade-in slide-in-from-left-2 duration-300">
            <button
              onClick={() => setDashboardTab("overview")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group ${
                dashboardTab === "overview"
                  ? "bg-white/10 text-white border border-neutral-600/50 hover:bg-white/15"
                  : "text-neutral-200 hover:bg-neutral-800/50 hover:text-white"
              }`}
            >
              <BarChart3 className={`h-5 w-5 transition-transform duration-200 ${dashboardTab === "overview" ? "text-white scale-110" : "text-neutral-200 group-hover:text-white"}`} />
              <span className={`text-sm font-medium ${dashboardTab === "overview" ? "text-white" : "text-inherit"}`}>Overview</span>
            </button>
            <button
              onClick={() => setDashboardTab("analytics")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group ${
                dashboardTab === "analytics"
                  ? "bg-white/10 text-white border border-neutral-600/50 hover:bg-white/15"
                  : "text-neutral-200 hover:bg-neutral-800/50 hover:text-white"
              }`}
            >
              <LayoutDashboard className={`h-5 w-5 transition-transform duration-200 ${dashboardTab === "analytics" ? "text-white scale-110" : "text-neutral-200 group-hover:text-white"}`} />
              <span className={`text-sm font-medium ${dashboardTab === "analytics" ? "text-white" : "text-inherit"}`}>Analytics</span>
            </button>
            <button
              onClick={() => setDashboardTab("directory")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group ${
                dashboardTab === "directory"
                  ? "bg-white/10 text-white border border-neutral-600/50 hover:bg-white/15"
                  : "text-neutral-200 hover:bg-neutral-800/50 hover:text-white"
              }`}
            >
              <Users className={`h-5 w-5 transition-transform duration-200 ${dashboardTab === "directory" ? "text-white scale-110" : "text-neutral-200 group-hover:text-white"}`} />
              <span className={`text-sm font-medium ${dashboardTab === "directory" ? "text-white" : "text-inherit"}`}>User Directory</span>
            </button>
            <button
              onClick={() => setDashboardTab("feedback")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group ${
                dashboardTab === "feedback"
                  ? "bg-white/10 text-white border border-neutral-600/50 hover:bg-white/15"
                  : "text-neutral-200 hover:bg-neutral-800/50 hover:text-white"
              }`}
            >
              <MessageSquare className={`h-5 w-5 transition-transform duration-200 ${dashboardTab === "feedback" ? "text-white scale-110" : "text-neutral-200 group-hover:text-white"}`} />
              <span className={`text-sm font-medium ${dashboardTab === "feedback" ? "text-white" : "text-inherit"}`}>Feedback</span>
            </button>
          </nav>
        ) : (
          <nav className="flex flex-col items-center gap-3 mt-3 px-2 animate-in fade-in slide-in-from-left-1 duration-200">
            <button
              onClick={() => { setDashboardTab("overview"); setSidebarOpen(true); }}
              title="Overview"
              className={`size-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                dashboardTab === "overview"
                  ? "bg-white/20 text-white border border-neutral-500/50 hover:bg-white/25"
                  : "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              <BarChart3 className="h-5 w-5" />
            </button>
            <button
              onClick={() => { setDashboardTab("analytics"); setSidebarOpen(true); }}
              title="Analytics"
              className={`size-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                dashboardTab === "analytics"
                  ? "bg-white/20 text-white border border-neutral-500/50 hover:bg-white/25"
                  : "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              <LayoutDashboard className="h-5 w-5" />
            </button>
            <button
              onClick={() => { setDashboardTab("directory"); setSidebarOpen(true); }}
              title="User Directory"
              className={`size-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                dashboardTab === "directory"
                  ? "bg-white/20 text-white border border-neutral-500/50 hover:bg-white/25"
                  : "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              <Users className="h-5 w-5" />
            </button>
            <button
              onClick={() => { setDashboardTab("feedback"); setSidebarOpen(true); }}
              title="Feedback"
              className={`size-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                dashboardTab === "feedback"
                  ? "bg-white/20 text-white border border-neutral-500/50 hover:bg-white/25"
                  : "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
          </nav>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom - User Profile */}
        <div className={`flex-shrink-0 p-1.5 ${
          sidebarOpen ? "border-t border-white/[0.08] bg-neutral-925" : "flex flex-col items-center px-2 py-1.5 bg-neutral-950"
        }`}>
          {sidebarOpen ? (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-neutral-200">
              <div className="size-8 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold flex-shrink-0">
                {userInitials}
              </div>
              <span className="flex-1 text-sm font-medium truncate">{user?.displayName || "User"}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <div
                className="size-10 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold"
                title={user?.displayName || "User"}
              >
                {userInitials}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ═════  RIGHT: Header + Content  ═════ */}
      <div className="flex-1 flex flex-col min-w-0 h-dvh">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 px-6 h-14 bg-neutral-950 sticky top-0 z-30 border-b border-neutral-700/60 transition-all duration-300">
          <h1 className="text-[1.25rem] font-semibold text-neutral-100">
            {dashboardTab === "overview" ? "Overview" : dashboardTab === "analytics" ? "Analytics" : dashboardTab === "directory" ? "User Directory" : "Feedback"}
          </h1>
          {dashboardTab === "analytics" && (() => {
            const allSelected = !!analyticsInstFilter && !!analyticsDeptFilter && !!selectedAgent;
            return (
              <button
                onClick={() => { if (allSelected || chatOpen) setChatOpen((o) => !o); }}
                disabled={!allSelected && !chatOpen}
                className={`flex items-center gap-1.5 h-9 px-4 text-xs font-medium transition-all duration-200 border ${
                  chatOpen
                    ? "rounded-lg bg-neutral-300 text-neutral-900 border-neutral-300 hover:bg-neutral-400"
                    : allSelected
                      ? "rounded-lg bg-neutral-300 text-neutral-900 border-neutral-300 hover:bg-neutral-400"
                      : "rounded-lg bg-neutral-800/50 border-neutral-700/40 text-neutral-500 cursor-not-allowed"
                }`}
              >
                {chatOpen ? "Close" : "Ask Agent"}
              </button>
            );
          })()}
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-300/60 hover:text-red-100 text-lg leading-none">&times;</button>
          </div>
        )}

        {/* ═════  CONTENT AREA  ═════ */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            <div className="px-8 py-6 space-y-6">

              {/* ── Analytics Filters Row ── */}
              {dashboardTab === "analytics" && (
                <div className="grid grid-cols-3 gap-2.5 -mt-1">
                  {/* Institute filter */}
                  <Select value={analyticsInstFilter || undefined} onValueChange={handleAnalyticsInstChange}>
                    <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
                      <SelectValue placeholder="Select institute…" />
                    </SelectTrigger>
                    <SelectContent>
                      {analyticsInstitutes.map((i: string) => (
                        <SelectItem key={i} value={i}>{i}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Department filter */}
                  <Select value={analyticsDeptFilter || undefined} onValueChange={setAnalyticsDeptFilter}>
                    <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
                      <SelectValue placeholder="Select department…" />
                    </SelectTrigger>
                    <SelectContent>
                      {analyticsDepartments.map((d: string) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Course filter */}
                  {loadingAgents ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading courses…
                    </div>
                  ) : (
                    <Select value={selectedAgent ?? undefined} onValueChange={selectAgent}>
                      <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
                        <SelectValue placeholder="Select course…" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => {
                          const id = a.agentId || a.id;
                          return (
                            <SelectItem key={id} value={id}>
                              {getCourseName(a.name || id)}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                  {/* Transfer Ownership button */}
                  {selectedAgent && (
                    <button
                      onClick={() => { setTransferTargetUser(""); setTransferDialogOpen(true); }}
                      className="h-8 px-3 flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white bg-neutral-800/80 border border-neutral-700/50 rounded-md hover:border-neutral-600 transition-colors"
                      title="Transfer course ownership"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      Transfer
                    </button>
                  )}
                  {/* Assign Teachers button */}
                  {selectedAgent && (
                    <button
                      onClick={openTeachersDialog}
                      className="h-8 px-3 flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white bg-neutral-800/80 border border-neutral-700/50 rounded-md hover:border-neutral-600 transition-colors"
                      title="Assign teachers to this course"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Teachers
                    </button>
                  )}
                </div>
              )}

              {/* ── Assign Teachers Dialog ── */}
              <Dialog open={teachersDialogOpen} onOpenChange={setTeachersDialogOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Assign Teachers</DialogTitle>
                    <DialogDescription>
                      Choose who teaches{" "}
                      <span className="font-semibold text-white">{getCourseName(selectedAgent || "")}</span>.
                      These names are shown to students in the library.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="max-h-72 overflow-y-auto py-2">
                    {USER_DIRECTORY
                      .filter((u) => u.role === "teacher" || u.role === "admin")
                      .map((u) => {
                        const checked = assignedTeacherIds.includes(u.id);
                        const isOwner = u.id === teachersOwnerId;
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${isOwner ? "opacity-60" : "cursor-pointer hover:bg-neutral-800/60"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isOwner}
                              onChange={(e) => setAssignedTeacherIds((prev) =>
                                e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))}
                              className="h-4 w-4 accent-white"
                            />
                            <span className="min-w-0 flex-1 truncate text-neutral-200">
                              {u.name || u.email}
                              {isOwner && <span className="ml-2 text-xs text-neutral-500">owner</span>}
                            </span>
                            <span className="shrink-0 text-xs text-neutral-500">{u.institute || u.role}</span>
                          </label>
                        );
                      })}
                  </div>
                  <DialogFooter>
                    <button
                      onClick={() => setTeachersDialogOpen(false)}
                      className="px-4 py-2 text-sm text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={savingTeachers}
                      onClick={async () => {
                        if (!selectedAgent) return;
                        setSavingTeachers(true);
                        try {
                          await setAgentTeachers(selectedAgent, assignedTeacherIds);
                          setTeachersDialogOpen(false);
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "Failed to save teachers");
                        } finally {
                          setSavingTeachers(false);
                        }
                      }}
                      className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
                    >
                      {savingTeachers ? "Saving…" : "Save"}
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* ── Transfer Ownership Dialog ── */}
              <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Transfer Course Ownership</DialogTitle>
                    <DialogDescription>
                      Select a teacher to become the new owner of{" "}
                      <span className="font-semibold text-white">{getCourseName(selectedAgent || "")}</span>.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <label className="text-xs text-neutral-400 mb-1.5 block">New Owner</label>
                    <Select value={transferTargetUser} onValueChange={setTransferTargetUser}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a teacher…" />
                      </SelectTrigger>
                      <SelectContent>
                        {USER_DIRECTORY
                          .filter((u) => u.role === "teacher" || u.role === "admin")
                          .map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name || u.email} — {u.role} {u.institute ? `(${u.institute})` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <button
                      onClick={() => setTransferDialogOpen(false)}
                      className="px-4 py-2 text-sm text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={!transferTargetUser || transferring}
                      onClick={async () => {
                        if (!selectedAgent || !transferTargetUser) return;
                        setTransferring(true);
                        try {
                          const result = await transferAgentOwnership(selectedAgent, transferTargetUser);
                          setTransferDialogOpen(false);
                          alert(`Ownership transferred to ${result.new_owner_name || transferTargetUser}`);
                        } catch (err: any) {
                          alert(err.message || "Failed to transfer ownership");
                        } finally {
                          setTransferring(false);
                        }
                      }}
                      className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {transferring ? "Transferring…" : "Transfer"}
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* ── Tab Content ── */}
              {dashboardTab === "overview" ? (
                <OverviewContent />
              ) : dashboardTab === "directory" ? (
                <UserDirectorySection />
              ) : dashboardTab === "feedback" ? (
                <FeedbackSection />
              ) : !selectedAgent ? (
                <div className="space-y-6">
                  {/* Empty state prompt */}
                  <div className="flex flex-col items-center justify-center h-[60vh] text-neutral-500">
                    <div className="relative mb-5">
                      <BarChart3 className="w-14 h-14 text-neutral-700" />
                      <TrendingUp className="w-6 h-6 text-neutral-600 absolute -right-2 -top-1" />
                    </div>
                    <p className="text-base font-medium text-neutral-400">Select a course to view analytics</p>
                    <p className="text-sm text-neutral-600 mt-1">Choose from the filters above</p>
                  </div>
                </div>
              ) : loadingOverview ? (
                <div className="flex flex-col items-center justify-center h-[60vh]">
                  <Loader2 className="w-7 h-7 animate-spin text-neutral-600" />
                  <p className="text-sm text-neutral-600 mt-3">Loading analytics…</p>
                </div>
              ) : overview ? (
                <>
                  {/* ── Course header with creator ── */}
                  {(() => {
                    const agent = agents.find((a) => (a.agentId || a.id) === selectedAgent);
                    return agent?.createdByName ? (
                      <div className="flex items-center gap-2 text-xs text-neutral-500 mb-3">
                        <Crown className="w-3.5 h-3.5 text-amber-500/70" />
                        <span>Created by <span className="text-neutral-300">{agent.createdByName}</span></span>
                      </div>
                    ) : null;
                  })()}
                  {/* ── Stat Cards ── */}
                  <div className={`grid gap-4 ${chatOpen ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
                    <StatCard
                      label="Active Students"
                      value={overview.usage?.active_students ?? overview.student_count}
                      icon={<Users className="w-5 h-5" />}
                      accent="indigo"
                    />
                    <StatCard
                      label="Active Teachers"
                      value={overview.usage?.active_teachers ?? 0}
                      icon={<BookOpen className="w-5 h-5" />}
                      accent="sky"
                    />
                    <StatCard
                      label="Avg. Completion"
                      value={`${overview.avg_pct_complete}%`}
                      icon={<TrendingUp className="w-5 h-5" />}
                      accent="emerald"
                      valueClass={pctColor(overview.avg_pct_complete)}
                    />
                    <StatCard
                      label="Topics"
                      value={overview.total_topics}
                      icon={<Clock className="w-5 h-5" />}
                      accent="amber"
                    />
                  </div>

                  {/* ── Distribution Bar ── */}
                  {overview.distribution && overview.student_count > 0 && (
                    <div className="bg-neutral-900/80 rounded-2xl p-5 border border-neutral-800/60">
                      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-4">
                        Completion Distribution
                      </h3>
                      <div className="flex h-7 rounded-full overflow-hidden bg-neutral-800/80">
                        {(["0-25%", "25-50%", "50-75%", "75-100%"] as const).map((bucket) => {
                          const count = overview.distribution[bucket];
                          const pct = (count / overview.student_count) * 100;
                          if (pct === 0) return null;
                          const colors: Record<string, string> = {
                            "0-25%": "bg-red-500/90",
                            "25-50%": "bg-orange-500/90",
                            "50-75%": "bg-amber-400/90",
                            "75-100%": "bg-emerald-500/90",
                          };
                          return (
                            <div
                              key={bucket}
                              className={`${colors[bucket]} flex items-center justify-center text-[10px] font-bold text-white transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                              title={`${bucket}: ${count} student${count !== 1 ? "s" : ""}`}
                            >
                              {pct > 12 ? bucket : ""}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-5 mt-3 text-[11px] text-neutral-500">
                        {(["0-25%", "25-50%", "50-75%", "75-100%"] as const).map((b) => (
                          <span key={b} className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                b === "0-25%"
                                  ? "bg-red-500"
                                  : b === "25-50%"
                                    ? "bg-orange-500"
                                    : b === "50-75%"
                                      ? "bg-amber-400"
                                      : "bg-emerald-500"
                              }`}
                            />
                            {b} ({overview.distribution[b]})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Struggle Topics ── */}
                  {overview.top_struggle_topics && overview.top_struggle_topics.length > 0 && (
                    <div className="bg-neutral-900/80 rounded-2xl p-5 border border-neutral-800/60">
                      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-4">
                        Top Struggle Topics
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {overview.top_struggle_topics.map((t) => (
                          <span
                            key={t.topic}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-red-950/40 text-red-300 border border-red-800/30"
                          >
                            {t.topic}
                            <span className="text-red-500 font-bold">&times;{t.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Students Table ── */}
                  <div className="bg-neutral-900/80 rounded-2xl border border-neutral-800/60 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-neutral-800/60 flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                        Students ({students.length})
                      </h3>
                    </div>
                    {loadingStudents ? (
                      <div className="flex justify-center py-10">
                        <Loader2 className="w-5 h-5 animate-spin text-neutral-600" />
                      </div>
                    ) : students.length === 0 ? (
                      <div className="flex flex-col items-center py-12 text-neutral-600">
                        <Users className="w-8 h-8 mb-2 opacity-40" />
                        <p className="text-sm">No students have started learning with this agent yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-neutral-800/60">
                        {students.map((s) => (
                          <StudentRow
                            key={s.user_id}
                            summary={s}
                            isExpanded={expandedStudent === s.user_id}
                            onToggle={() => toggleStudent(s.user_id)}
                            detail={expandedStudent === s.user_id ? studentDetail : null}
                            loadingDetail={expandedStudent === s.user_id && loadingDetail}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {/* ── RAG Quality / Groundedness ── */}
                  <GroundednessSection
                    evaluations={groundednessEvals}
                    summary={groundednessSummary}
                    loading={loadingGroundedness}
                    onRefresh={fetchGroundedness}
                    chatOpen={chatOpen}
                  />
                </>
              ) : null}
            </div>
          </main>

        {/* ── Right-side Chat Pane ── */}
        <aside
          className={`shrink-0 border-l border-neutral-800/60 flex flex-col overflow-hidden bg-neutral-900 transition-all duration-300 ${
            chatOpen ? "w-1/2" : "w-0 border-l-0"
          }`}
          style={{ minHeight: 0 }}
        >
          {chatOpen && (
            <div className="flex flex-col h-full w-full">
              <UnifiedChatContainer
                messages={messages}
                input={chatInput}
                onInputChange={(e) => setChatInput(e.target.value)}
                onSend={handleChatSend}
                onStop={stop}
                isSending={isWaitingForResponse || isStreaming}
                isTyping={isStreaming && !isWaitingForResponse}
                placeholder="Ask about student progress, learning trajectories…"
                emptyStateTitle="Learning Analytics Agent"
                emptyStateDescription="Ask questions about student progress, course analytics, struggle areas, and learning trajectories."
                suggestions={[
                  { title: "All students", description: "Show me all students and their progress" },
                  { title: "Course overview", description: "Give me an overview of the Machine Learning course" },
                  { title: "Struggle areas", description: "Which topics are students struggling with the most?" },
                  { title: "Student detail", description: "How is a specific student doing in their course?" },
                ]}
                onSuggestionClick={(s) => setChatInput(s)}
                disabled={false}
              />
            </div>
          )}
        </aside>
      </div>
      </div>
    </div>
  );
}

/* ════════════════════════  Feedback Section  ════════════════════════ */

function FeedbackSection() {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false);
  const [attachmentDialogUrls, setAttachmentDialogUrls] = useState<string[]>([]);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerType, setViewerType] = useState<"image" | "pdf" | "other">("other");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await listFeedback(500);
        setFeedback(data.feedback);
        setStats(data.stats);
      } catch (err: any) {
        setError(err.message || "Failed to load feedback");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = stats ? Object.keys(stats.categories).sort() : [];
  const sentiments = stats ? Object.keys(stats.sentiments).sort() : [];

  const filtered = feedback.filter((f) => {
    if (categoryFilter !== "all" && (f.category || "General") !== categoryFilter) return false;
    if (sentimentFilter !== "all" && (f.sentiment || "unknown") !== sentimentFilter) return false;
    return true;
  });

  const sentimentEmoji = (s: string | null) => {
    switch (s) {
      case "positive": return "😊";
      case "negative": return "😞";
      case "neutral": return "😐";
      default: return "💬";
    }
  };

  const sentimentColor = (s: string | null) => {
    switch (s) {
      case "positive": return "text-green-400 bg-green-500/10 border-green-500/20";
      case "negative": return "text-red-400 bg-red-500/10 border-red-500/20";
      case "neutral": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
      default: return "text-neutral-400 bg-neutral-500/10 border-neutral-500/20";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <Loader2 className="w-7 h-7 animate-spin text-neutral-600" />
        <p className="text-sm text-neutral-600 mt-3">Loading feedback…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-red-400">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-neutral-800/50 border border-neutral-700/40 rounded-xl px-4 py-3">
            <div className="text-xs text-neutral-500 mb-1">Total</div>
            <div className="text-xl font-semibold text-white">{stats.total}</div>
          </div>
          {["positive", "negative", "neutral"].map((s) => (
            <div key={s} className="bg-neutral-800/50 border border-neutral-700/40 rounded-xl px-4 py-3">
              <div className="text-xs text-neutral-500 mb-1 capitalize">{sentimentEmoji(s)} {s}</div>
              <div className="text-xl font-semibold text-white">{stats.sentiments[s] || 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All sentiments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sentiments</SelectItem>
            {sentiments.map((s) => (
              <SelectItem key={s} value={s}>{sentimentEmoji(s)} {s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-neutral-500 self-center ml-auto">{filtered.length} items</span>
      </div>

      {/* Feedback list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[40vh] text-neutral-500">
          <MessageSquare className="w-10 h-10 mb-3 text-neutral-700" />
          <p className="text-sm">No feedback yet</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
          {filtered.map((f) => (
            <div
              key={f.id}
              className="bg-neutral-800/40 border border-neutral-700/30 rounded-xl p-4 hover:border-neutral-600/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${sentimentColor(f.sentiment)}`}>
                    {sentimentEmoji(f.sentiment)} {f.sentiment || "unknown"}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-700/50 text-neutral-400 border border-neutral-600/30">
                    {f.category}
                  </span>
                </div>
                <span className="text-xs text-neutral-600 whitespace-nowrap">
                  {new Date(f.createdAt).toLocaleDateString()} {new Date(f.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-sm text-neutral-200 whitespace-pre-wrap">{f.text}</p>
              <div className="flex items-center gap-3 mt-2">
                {f.imageUrls && f.imageUrls.length > 0 && (
                  <button
                    onClick={() => {
                      setAttachmentDialogUrls(f.imageUrls);
                      setAttachmentDialogOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    {f.imageUrls.length} Attachment{f.imageUrls.length > 1 ? "s" : ""}
                  </button>
                )}
                {(f.userName || f.userEmail) && (
                  <span className="text-xs text-neutral-500">
                    {f.userName && f.userName !== "student_name" ? f.userName : ""}{f.userEmail ? ` (${f.userEmail})` : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Attachments dialog — file list */}
      <Dialog open={attachmentDialogOpen} onOpenChange={(open) => { setAttachmentDialogOpen(open); if (!open) setViewerUrl(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attachments ({attachmentDialogUrls.length})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {attachmentDialogUrls.map((url, i) => {
              const proxyUrl = `${DASHBOARD_API_URL}/api/dashboard/blob/proxy?url=${encodeURIComponent(url)}`;
              const ext = (url.split(".").pop() || "").toLowerCase().split("?")[0];
              const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
              const isPdf = ext === "pdf";
              const icon = isImage ? <Eye className="w-4 h-4" /> : isPdf ? <FileDown className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />;
              const label = isImage ? `Image ${i + 1}` : isPdf ? `Document ${i + 1} (.pdf)` : `File ${i + 1} (.${ext})`;
              return (
                <button
                  key={i}
                  onClick={() => {
                    const type = isImage ? "image" : isPdf ? "pdf" : "other";
                    if (type === "other") {
                      window.open(proxyUrl, "_blank");
                    } else {
                      setViewerUrl(proxyUrl);
                      setViewerType(type);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-neutral-700/40 bg-neutral-800/30 hover:bg-neutral-700/50 hover:border-neutral-600/50 transition-colors text-left"
                >
                  <span className="text-neutral-400">{icon}</span>
                  <span className="text-sm text-neutral-200 flex-1">{label}</span>
                  <span className="text-xs text-neutral-600">{isImage ? "View" : isPdf ? "View" : "Download"}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Attachment viewer — fullscreen overlay for images and PDFs */}
      {viewerUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setViewerUrl(null)}
        >
          <div
            className="relative w-[90vw] h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/90 rounded-t-xl border border-neutral-700/50">
              <span className="text-sm text-neutral-300">{viewerType === "image" ? "Image Viewer" : "Document Viewer"}</span>
              <button
                onClick={() => setViewerUrl(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4 text-neutral-400" />
              </button>
            </div>
            <div className="flex-1 bg-neutral-950 rounded-b-xl border border-t-0 border-neutral-700/50 overflow-hidden">
              {viewerType === "image" ? (
                <img
                  src={viewerUrl}
                  alt="Attachment"
                  className="w-full h-full object-contain"
                />
              ) : (
                <iframe
                  src={viewerUrl}
                  className="w-full h-full border-0"
                  title="Document viewer"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════  Sub-components  ════════════════════════ */

function UserDirectorySection() {
  const storeEmail = useUserStore((s) => s.email);
  const callerEmail = (storeEmail || "").toLowerCase();
  // Dashboard is an admin-only tool — always grant super-admin privileges
  const isSuperAdmin = true;
  const isAdmin = true;

  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [instFilter, setInstFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dirLoading, setDirLoading] = useState(!isDirectoryLoaded());
  const [dirError, setDirError] = useState<string | null>(null);

  // Load directory from backend on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setDirLoading(true);
        await loadDirectory();
        if (!cancelled) { setDirLoading(false); forceRefresh((n) => n + 1); }
      } catch (err) {
        if (!cancelled) { setDirError(String(err)); setDirLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Add-user dialog state ──
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("student");
  const [newInstitute, setNewInstitute] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [_refreshTick, forceRefresh] = useState(0);

  // ── Edit user dialog state ──
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserEntry | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("student");
  const [editInstitute, setEditInstitute] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Remove user confirm state ──
  const [removeConfirmUser, setRemoveConfirmUser] = useState<UserEntry | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const openEditDialog = (u: UserEntry) => {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditInstitute(u.institute);
    setEditDepartment(u.department);
    setEditError(null);
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editUser) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await updateUser(editUser.id, {
        name: editName.trim(),
        role: editRole,
        institute: editInstitute.trim(),
        department: editDepartment.trim(),
      });
      setEditOpen(false);
      setEditUser(null);
      forceRefresh((n) => n + 1);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setEditLoading(false);
    }
  };

  const handleRemoveConfirm = async () => {
    if (!removeConfirmUser) return;
    setRemoveLoading(true);
    setRemoveError(null);
    try {
      const ok = await removeUser(removeConfirmUser.id);
      if (!ok) throw new Error("Failed to remove user");
      setRemoveConfirmUser(null);
      forceRefresh((n) => n + 1);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setRemoveLoading(false);
    }
  };

  /** Can the caller edit this user? */
  const canEdit = (u: UserEntry): boolean => {
    if (isSuperAdmin) return true;
    // Admins can edit themselves only
    if (isAdmin && u.email.toLowerCase() === callerEmail) return true;
    return false;
  };

  /** Can the caller remove this user? */
  const canRemove = (u: UserEntry): boolean => {
    // Super-admin cannot be removed
    if (u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return false;
    // Super-admin can remove anyone else
    if (isSuperAdmin) return true;
    // Admins can remove teachers and students (not other admins)
    if (isAdmin && u.role !== "admin") return true;
    return false;
  };

  // ── Add-institution dialog state ──
  const [addInstOpen, setAddInstOpen] = useState(false);
  const [newInstName, setNewInstName] = useState("");

  // ── Add-department dialog state ──
  const [addDeptOpen, setAddDeptOpen] = useState(false);
  const [deptForInst, setDeptForInst] = useState("");
  const [newDeptName, setNewDeptName] = useState("");

  // ── Rename / Delete institution dialog state ──
  const [renameInstOpen, setRenameInstOpen] = useState(false);
  const [renameInstOld, setRenameInstOld] = useState("");
  const [renameInstNew, setRenameInstNew] = useState("");
  const [renameInstLoading, setRenameInstLoading] = useState(false);

  const [deleteInstConfirm, setDeleteInstConfirm] = useState<string | null>(null);
  const [deleteInstLoading, setDeleteInstLoading] = useState(false);

  // ── Rename / Delete department dialog state ──
  const [renameDeptOpen, setRenameDeptOpen] = useState(false);
  const [renameDeptInst, setRenameDeptInst] = useState("");
  const [renameDeptOld, setRenameDeptOld] = useState("");
  const [renameDeptNew, setRenameDeptNew] = useState("");
  const [renameDeptLoading, setRenameDeptLoading] = useState(false);

  const [deleteDeptConfirm, setDeleteDeptConfirm] = useState<{ institute: string; department: string } | null>(null);
  const [deleteDeptLoading, setDeleteDeptLoading] = useState(false);

  // ── Deep Research state ──
  // Map key = institute name or "inst::dept" → research status
  const [researchStatuses, setResearchStatuses] = useState<Record<string, ResearchStatus["status"]>>({});
  const researchPollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ── Deep Research viewer dialog state ──
  const [researchViewerOpen, setResearchViewerOpen] = useState(false);
  const [researchViewerData, setResearchViewerData] = useState<Record<string, unknown> | null>(null);
  const [researchViewerTitle, setResearchViewerTitle] = useState("");
  const [researchViewerLoading, setResearchViewerLoading] = useState(false);

  // ── Deep Research prompt dialog state (additional instructions) ──
  const [researchPromptOpen, setResearchPromptOpen] = useState(false);
  const [researchPromptTarget, setResearchPromptTarget] = useState<{ type: "institute" | "department"; institute: string; department?: string } | null>(null);
  const [researchPromptInstructions, setResearchPromptInstructions] = useState("");

  // ── CSV Import state ──
  type CsvMode = "users" | "institutions" | "departments";
  const [csvResult, setCsvResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvMode | null>(null);

  // ── CSV parsing helpers ──
  const CSV_TEMPLATES: Record<CsvMode, { columns: string[]; example: string }> = {
    users: {
      columns: ["name", "email", "role", "institute", "department"],
      example: "Dr. Priya Sharma,ravi@example.com,teacher,IIT Bombay,Computer Science",
    },
    institutions: {
      columns: ["name"],
      example: "IIT Bombay",
    },
    departments: {
      columns: ["institute", "department"],
      example: "IIT Bombay,Computer Science",
    },
  };

  const downloadCsvTemplate = (mode: CsvMode) => {
    const t = CSV_TEMPLATES[mode];
    const header = t.columns.join(",");
    const blob = new Blob([header + "\n" + t.example + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mode}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsvText = (text: string): string[][] => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const cells: string[] = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else if (ch === '"') {
              inQuotes = false;
            } else {
              cur += ch;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
            } else if (ch === ",") {
              cells.push(cur.trim());
              cur = "";
            } else {
              cur += ch;
            }
          }
        }
        cells.push(cur.trim());
        return cells;
      });
  };

  const handleCsvImport = (file: File, mode: CsvMode) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const rows = parseCsvText(text);
      const template = CSV_TEMPLATES[mode];
      let dataRows = rows;
      if (
        rows.length > 0 &&
        rows[0].length === template.columns.length &&
        rows[0].every((cell, i) => cell.toLowerCase() === template.columns[i].toLowerCase())
      ) {
        dataRows = rows.slice(1);
      }

      let added = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = i + 1;

        if (mode === "users") {
          if (row.length < 5) { errors.push(`Row ${rowNum}: expected 5 columns (name, email, role, institute, department), got ${row.length}`); skipped++; continue; }
          const [name, email, role, institute, department] = row;
          if (!email) { errors.push(`Row ${rowNum}: email is required`); skipped++; continue; }
          const validRoles: UserRole[] = ["student", "teacher", "admin"];
          const normalRole = role.toLowerCase() as UserRole;
          if (!validRoles.includes(normalRole)) { errors.push(`Row ${rowNum}: invalid role "${role}" (use student/teacher/admin)`); skipped++; continue; }
          try {
            // The backend decides whether this is a duplicate; the in-memory
            // directory goes stale after deletes made elsewhere.
            const result = await addUser({ name: name || (normalRole === "student" ? "student_name" : ""), email, role: normalRole, institute, department });
            if (result.alreadyExists) {
              errors.push(`Row ${rowNum}: email "${email}" already exists`);
              skipped++;
            } else {
              added++;
            }
          } catch (err) {
            errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : "failed to invite"}`);
            skipped++;
          }
        } else if (mode === "institutions") {
          if (row.length < 1 || !row[0]) { errors.push(`Row ${rowNum}: institution name is required`); skipped++; continue; }
          addInstitute(row[0]);
          added++;
        } else if (mode === "departments") {
          if (row.length < 2) { errors.push(`Row ${rowNum}: expected 2 columns (institute, department), got ${row.length}`); skipped++; continue; }
          const [inst, dept] = row;
          if (!inst || !dept) { errors.push(`Row ${rowNum}: both institute and department are required`); skipped++; continue; }
          addDepartment(inst, dept);
          added++;
        }
      }

      setCsvResult({ added, skipped, errors });
      if (added > 0) forceRefresh((n) => n + 1);
    };
    reader.readAsText(file);
  };

  // Simple toast state for add-user feedback
  const [addUserToastMsg, setAddUserToastMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const addUserToast = (text: string, type: "success" | "error" | "info") => {
    setAddUserToastMsg({ text, type });
    setTimeout(() => setAddUserToastMsg(null), 4000);
  };

  const resetForm = () => {
    setNewEmail("");
    setNewName("");
    setNewRole("student");
    setNewInstitute("");
    setNewDepartment("");
  };

  const handleAddInstitute = () => {
    if (!newInstName.trim()) return;
    addInstitute(newInstName.trim());
    setNewInstName("");
    setAddInstOpen(false);
    forceRefresh((n) => n + 1);
  };

  const handleAddDepartment = () => {
    if (!deptForInst.trim() || !newDeptName.trim()) return;
    addDepartment(deptForInst.trim(), newDeptName.trim());
    setDeptForInst("");
    setNewDeptName("");
    setAddDeptOpen(false);
    forceRefresh((n) => n + 1);
  };

  // ── Rename / Delete handlers ──

  const handleRenameInstitute = async () => {
    if (!renameInstOld.trim() || !renameInstNew.trim()) return;
    setRenameInstLoading(true);
    try {
      await renameInstitute(renameInstOld.trim(), renameInstNew.trim());
      setRenameInstOpen(false);
      setRenameInstOld("");
      setRenameInstNew("");
      forceRefresh((n) => n + 1);
    } catch (err) {
      console.error("Failed to rename institute:", err);
    } finally {
      setRenameInstLoading(false);
    }
  };

  const handleDeleteInstitute = async () => {
    if (!deleteInstConfirm) return;
    setDeleteInstLoading(true);
    try {
      await deleteInstitute(deleteInstConfirm);
      setDeleteInstConfirm(null);
      forceRefresh((n) => n + 1);
    } catch (err) {
      console.error("Failed to delete institute:", err);
    } finally {
      setDeleteInstLoading(false);
    }
  };

  const handleRenameDepartment = async () => {
    if (!renameDeptInst.trim() || !renameDeptOld.trim() || !renameDeptNew.trim()) return;
    setRenameDeptLoading(true);
    try {
      await renameDepartment(renameDeptInst.trim(), renameDeptOld.trim(), renameDeptNew.trim());
      setRenameDeptOpen(false);
      setRenameDeptInst("");
      setRenameDeptOld("");
      setRenameDeptNew("");
      forceRefresh((n) => n + 1);
    } catch (err) {
      console.error("Failed to rename department:", err);
    } finally {
      setRenameDeptLoading(false);
    }
  };

  const handleDeleteDepartment = async () => {
    if (!deleteDeptConfirm) return;
    setDeleteDeptLoading(true);
    try {
      await deleteDepartment(deleteDeptConfirm.institute, deleteDeptConfirm.department);
      setDeleteDeptConfirm(null);
      forceRefresh((n) => n + 1);
    } catch (err) {
      console.error("Failed to delete department:", err);
    } finally {
      setDeleteDeptLoading(false);
    }
  };

  // ── Deep Research handlers ──

  const pollResearchStatus = useCallback((key: string, type: "institute" | "department", institute: string, department?: string) => {
    // Clear existing poll if any
    if (researchPollRef.current[key]) clearInterval(researchPollRef.current[key]);
    researchPollRef.current[key] = setInterval(async () => {
      try {
        const data = type === "institute"
          ? await getInstituteResearch(institute)
          : await getDepartmentResearch(institute, department!);
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(researchPollRef.current[key]);
          delete researchPollRef.current[key];
          setResearchStatuses((prev) => ({ ...prev, [key]: data.status as ResearchStatus["status"] }));
        }
      } catch {
        // ignore poll errors
      }
    }, 15_000); // poll every 15s
  }, []);

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      Object.values(researchPollRef.current).forEach(clearInterval);
    };
  }, []);

  // Load initial research statuses once directory is loaded
  useEffect(() => {
    if (!isSuperAdmin || dirLoading) return;
    const grouped = groupByInstituteDept(USER_DIRECTORY);
    const institutes = Object.keys(grouped);
    if (institutes.length === 0) return;
    let cancelled = false;
    (async () => {
      const statusMap: Record<string, ResearchStatus["status"]> = {};
      // Build all items for a single bulk request
      const items: BulkResearchItem[] = [];
      const itemMeta: { key: string; type: "institute" | "department"; institute: string; department?: string }[] = [];
      for (const institute of institutes) {
        items.push({ type: "institute", institute });
        itemMeta.push({ key: institute, type: "institute", institute });
        for (const dept of Object.keys(grouped[institute])) {
          const deptKey = `${institute}::${dept}`;
          items.push({ type: "department", institute, department: dept });
          itemMeta.push({ key: deptKey, type: "department", institute, department: dept });
        }
      }
      try {
        const statuses = await getBulkResearchStatus(items);
        if (cancelled) return;
        for (const meta of itemMeta) {
          const data = statuses[meta.key];
          if (data) {
            statusMap[meta.key] = data.status as ResearchStatus["status"];
            if (data.status === "researching") {
              pollResearchStatus(meta.key, meta.type, meta.institute, meta.department);
            }
          }
        }
      } catch (err) {
        console.error("[Research] Failed to load bulk statuses:", err);
      }
      setResearchStatuses(statusMap);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, dirLoading, _refreshTick]);

  const handleViewResearch = async (type: "institute" | "department", institute: string, department?: string) => {
    setResearchViewerTitle(type === "institute" ? institute : `${department} — ${institute}`);
    setResearchViewerLoading(true);
    setResearchViewerData(null);
    setResearchViewerOpen(true);
    try {
      const data = type === "institute"
        ? await getInstituteResearch(institute)
        : await getDepartmentResearch(institute, department!);
      setResearchViewerData(data as Record<string, unknown>);
    } catch (err) {
      console.error("Failed to load research data:", err);
      setResearchViewerData({ error: "Failed to load research data." });
    } finally {
      setResearchViewerLoading(false);
    }
  };

  const handleCancelInstituteResearch = async (institute: string) => {
    try {
      // Clear polling interval
      if (researchPollRef.current[institute]) {
        clearInterval(researchPollRef.current[institute]);
        delete researchPollRef.current[institute];
      }
      await cancelInstituteResearch(institute);
      setResearchStatuses((prev) => ({ ...prev, [institute]: "cancelled" }));
    } catch (err) {
      console.error("Failed to cancel institute research:", err);
    }
  };

  const handleCancelDepartmentResearch = async (institute: string, department: string) => {
    const key = `${institute}::${department}`;
    try {
      if (researchPollRef.current[key]) {
        clearInterval(researchPollRef.current[key]);
        delete researchPollRef.current[key];
      }
      await cancelDepartmentResearch(institute, department);
      setResearchStatuses((prev) => ({ ...prev, [key]: "cancelled" }));
    } catch (err) {
      console.error("Failed to cancel department research:", err);
    }
  };

  const handleInstituteResearchClick = async (institute: string, instructions?: string) => {
    try {
      setResearchStatuses((prev) => ({ ...prev, [institute]: "researching" }));
      await triggerInstituteResearch(institute, instructions);
      pollResearchStatus(institute, "institute", institute);
    } catch (err) {
      console.error("Failed to trigger institute research:", err);
      setResearchStatuses((prev) => ({ ...prev, [institute]: "failed" }));
    }
  };

  const handleDepartmentResearchClick = async (institute: string, department: string, instructions?: string) => {
    const key = `${institute}::${department}`;
    try {
      setResearchStatuses((prev) => ({ ...prev, [key]: "researching" }));
      await triggerDepartmentResearch(institute, department, instructions);
      pollResearchStatus(key, "department", institute, department);
    } catch (err) {
      console.error("Failed to trigger department research:", err);
      setResearchStatuses((prev) => ({ ...prev, [key]: "failed" }));
    }
  };

  const openResearchPrompt = (type: "institute" | "department", institute: string, department?: string) => {
    setResearchPromptTarget({ type, institute, department });
    setResearchPromptInstructions("");
    setResearchPromptOpen(true);
  };

  const confirmResearchPrompt = () => {
    if (!researchPromptTarget) return;
    const instr = researchPromptInstructions.trim() || undefined;
    if (researchPromptTarget.type === "institute") {
      handleInstituteResearchClick(researchPromptTarget.institute, instr);
    } else if (researchPromptTarget.department) {
      handleDepartmentResearchClick(researchPromptTarget.institute, researchPromptTarget.department, instr);
    }
    setResearchPromptOpen(false);
    setResearchPromptTarget(null);
    setResearchPromptInstructions("");
  };

  const [addingUser, setAddingUser] = useState(false);

  const handleAddUser = async () => {
    if (!newEmail.trim() || !newInstitute.trim() || !newDepartment.trim()) return;
    // Capture values before reset
    const email = newEmail.trim();
    const institute = newInstitute.trim();
    setAddingUser(true);
    try {
      const result = await addUser({
        name: newName.trim() || (newRole === "student" ? "student_name" : ""),
        email,
        role: newRole,
        institute,
        department: newDepartment.trim(),
      });
      resetForm();
      setAddOpen(false);
      forceRefresh((n) => n + 1);
      if (result.alreadyExists) {
        addUserToast(`${email} already has access at ${institute} — can use all courses there`, "info");
      } else if (result.affiliationAdded) {
        addUserToast(`Added ${institute} affiliation for existing user`, "info");
      } else {
        addUserToast(`Invited ${email} successfully`, "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add user";
      addUserToast(msg, "error");
    } finally {
      setAddingUser(false);
    }
  };

  const institutes = getAllInstitutes();
  const departments = getAllDepartments(instFilter !== "all" ? instFilter : undefined);

  // When institute changes, reset department filter
  const handleInstChange = (val: string) => {
    setInstFilter(val);
    setDeptFilter("all");
  };

  const filtered = USER_DIRECTORY.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (instFilter !== "all" && u.institute !== instFilter) return false;
    if (deptFilter !== "all" && u.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.institute.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const grouped = groupByInstituteDept(filtered.filter((u) => u.institute && u.department));
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="bg-neutral-900/70 border border-neutral-800/60 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-800/60 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-neutral-400" />
            <h3 className="text-sm font-semibold text-neutral-200 tracking-tight">User Directory</h3>
            <span className="text-[11px] text-neutral-500 ml-1">({filtered.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (<>
            <button
              onClick={() => setAddInstOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              <Building2 className="w-3.5 h-3.5" />
              Add Institution
            </button>
            <button
              onClick={() => setAddDeptOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              <Library className="w-3.5 h-3.5" />
              Add Department
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600/80 hover:bg-violet-600 text-white border border-violet-500/50 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add User
            </button>
            </>)}
          </div>
        </div>

        {/* Filters row */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2.5">
          {/* Search */}
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-neutral-800/80 text-xs text-neutral-300 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-neutral-600"
          />
          {/* Institute filter */}
          <Select value={instFilter} onValueChange={handleInstChange}>
            <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
              <SelectValue placeholder="All institutes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All institutes</SelectItem>
              {institutes.map((i) => (
                <SelectItem key={i} value={i}>{i}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Department filter */}
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Role filter */}
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "all")}>
            <SelectTrigger className="h-8 w-full !bg-neutral-800/80 !border text-xs text-neutral-300 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-neutral-600 focus:!ring-neutral-600">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Add Institution Dialog ── */}
      <Dialog open={addInstOpen} onOpenChange={setAddInstOpen}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Building2 className="w-4.5 h-4.5 text-violet-400" />
              Add Institution
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Register a new institution. It will appear in filters and when adding users.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Institution Name</label>
              <input
                type="text"
                value={newInstName}
                onChange={(e) => setNewInstName(e.target.value)}
                placeholder="e.g. IIT Bombay"
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setNewInstName(""); setCsvResult(null); setAddInstOpen(false); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddInstitute}
              disabled={!newInstName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </DialogFooter>

          {/* CSV bulk import */}
          <div className="mt-0">
            <div className="flex items-center gap-3 my-1.5">
              <div className="flex-1 h-px bg-neutral-700/50" />
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-neutral-700/50" />
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Import from CSV</p>
              <button type="button" onClick={() => setCsvPreview("institutions")} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-violet-400 transition-colors">
                <Eye className="w-3 h-3" />View Template
              </button>
            </div>
            <label className="group flex flex-col items-center gap-2 py-4 px-4 rounded-lg border border-dashed border-neutral-700/60 hover:border-violet-500/40 hover:bg-violet-500/[0.03] cursor-pointer transition-colors">
              <Upload className="w-5 h-5 text-neutral-600 group-hover:text-violet-400 transition-colors" />
              <span className="text-xs text-neutral-500 group-hover:text-neutral-400 transition-colors">Click to upload <span className="font-mono text-neutral-600">.csv</span></span>
              <span className="text-[10px] text-neutral-600">One institution name per row</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCsvResult(null); handleCsvImport(f, "institutions"); } e.target.value = ""; }} />
            </label>
            {csvResult && (
              <div className="mt-2.5 bg-neutral-800/60 border border-neutral-700/40 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center gap-3 text-xs">
                  {csvResult.added > 0 && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3" />{csvResult.added} added</span>}
                  {csvResult.skipped > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3 h-3" />{csvResult.skipped} skipped</span>}
                </div>
                {csvResult.errors.length > 0 && <div className="max-h-20 overflow-y-auto space-y-0.5">{csvResult.errors.map((err, i) => <p key={i} className="text-[10px] text-amber-400/80">{err}</p>)}</div>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Department Dialog ── */}
      <Dialog open={addDeptOpen} onOpenChange={setAddDeptOpen}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Library className="w-4.5 h-4.5 text-emerald-400" />
              Add Department
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Register a new department under an institution.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Institution</label>
              <Select value={deptForInst || "__none"} onValueChange={(v) => setDeptForInst(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60 truncate">
                  <SelectValue placeholder="Select institution…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-neutral-500">Select institution…</SelectItem>
                  {getAllInstitutes().map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Department Name</label>
              <input
                type="text"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="e.g. Electrical Engineering"
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setDeptForInst(""); setNewDeptName(""); setCsvResult(null); setAddDeptOpen(false); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddDepartment}
              disabled={!deptForInst.trim() || !newDeptName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </DialogFooter>

          {/* CSV bulk import */}
          <div className="mt-0">
            <div className="flex items-center gap-3 my-1.5">
              <div className="flex-1 h-px bg-neutral-700/50" />
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-neutral-700/50" />
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Import from CSV</p>
              <button type="button" onClick={() => setCsvPreview("departments")} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-violet-400 transition-colors">
                <Eye className="w-3 h-3" />View Template
              </button>
            </div>
            <label className="group flex flex-col items-center gap-2 py-4 px-4 rounded-lg border border-dashed border-neutral-700/60 hover:border-violet-500/40 hover:bg-violet-500/[0.03] cursor-pointer transition-colors">
              <Upload className="w-5 h-5 text-neutral-600 group-hover:text-violet-400 transition-colors" />
              <span className="text-xs text-neutral-500 group-hover:text-neutral-400 transition-colors">Click to upload <span className="font-mono text-neutral-600">.csv</span></span>
              <span className="text-[10px] text-neutral-600">Columns: <span className="text-neutral-500">institute, department</span></span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCsvResult(null); handleCsvImport(f, "departments"); } e.target.value = ""; }} />
            </label>
            {csvResult && (
              <div className="mt-2.5 bg-neutral-800/60 border border-neutral-700/40 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center gap-3 text-xs">
                  {csvResult.added > 0 && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3" />{csvResult.added} added</span>}
                  {csvResult.skipped > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3 h-3" />{csvResult.skipped} skipped</span>}
                </div>
                {csvResult.errors.length > 0 && <div className="max-h-20 overflow-y-auto space-y-0.5">{csvResult.errors.map((err, i) => <p key={i} className="text-[10px] text-amber-400/80">{err}</p>)}</div>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add User Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="w-4.5 h-4.5 text-violet-400" />
              Add New User
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Fill in the details below to add a user to the directory.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 py-3">
            {/* Name */}
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={newRole === "student" ? "student_name" : "e.g. Dr. Priya Sharma"}
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
            {/* Email */}
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="e.g. ravi@ekalaiva.com"
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
            {/* Role */}
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Role</label>
              <Select value={newRole} onValueChange={(v) => {
                const role = v as UserRole;
                setNewRole(role);
                if (role === "student" && !newName.trim()) {
                  setNewName("student_name");
                } else if (role !== "student" && newName === "student_name") {
                  setNewName("");
                }
                if (role === "admin") {
                  setNewInstitute("Microsoft");
                  setNewDepartment("MSR");
                }
              }}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60">
                  <SelectValue placeholder="Select role…" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Institute */}
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Institute</label>
              <Select value={newInstitute || "__none"} onValueChange={(v) => { setNewInstitute(v === "__none" ? "" : v); setNewDepartment(""); }}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60 truncate">
                  <SelectValue placeholder="Select institute…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-neutral-500">Select institute…</SelectItem>
                  {institutes.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Department */}
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Department</label>
              <Select value={newDepartment || "__none"} onValueChange={(v) => setNewDepartment(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60 truncate">
                  <SelectValue placeholder="Select department…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-neutral-500">Select department…</SelectItem>
                  {getAllDepartments(newInstitute || undefined).map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { resetForm(); setAddOpen(false); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddUser}
              disabled={addingUser || !newEmail.trim() || !newInstitute.trim() || !newDepartment.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {addingUser ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Adding…</>
              ) : (
                <><Plus className="w-3.5 h-3.5" />Add User</>
              )}
            </button>
          </DialogFooter>

          {/* CSV bulk import */}
          <div className="mt-0">
            <div className="flex items-center gap-3 my-1.5">
              <div className="flex-1 h-px bg-neutral-700/50" />
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-neutral-700/50" />
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Import from CSV</p>
              <button type="button" onClick={() => setCsvPreview("users")} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-violet-400 transition-colors">
                <Eye className="w-3 h-3" />View Template
              </button>
            </div>
            <label className="group flex flex-col items-center gap-2 py-4 px-4 rounded-lg border border-dashed border-neutral-700/60 hover:border-violet-500/40 hover:bg-violet-500/[0.03] cursor-pointer transition-colors">
              <Upload className="w-5 h-5 text-neutral-600 group-hover:text-violet-400 transition-colors" />
              <span className="text-xs text-neutral-500 group-hover:text-neutral-400 transition-colors">Click to upload <span className="font-mono text-neutral-600">.csv</span></span>
              <span className="text-[10px] text-neutral-600">Columns: <span className="text-neutral-500">name, email, role, institute, department</span></span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCsvResult(null); handleCsvImport(f, "users"); } e.target.value = ""; }} />
            </label>
            {csvResult && (
              <div className="mt-2.5 bg-neutral-800/60 border border-neutral-700/40 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center gap-3 text-xs">
                  {csvResult.added > 0 && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle className="w-3 h-3" />{csvResult.added} added</span>}
                  {csvResult.skipped > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3 h-3" />{csvResult.skipped} skipped</span>}
                </div>
                {csvResult.errors.length > 0 && <div className="max-h-20 overflow-y-auto space-y-0.5">{csvResult.errors.map((err, i) => <p key={i} className="text-[10px] text-amber-400/80">{err}</p>)}</div>}
              </div>
            )}
          </div>

          {/* Inline error toast (shown inside dialog when it stays open) */}
          {addUserToastMsg && addUserToastMsg.type === "error" && (
            <div className="mt-2 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
              {addUserToastMsg.text}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Success / info toast (shown outside dialog so it's visible after close) */}
      {addUserToastMsg && addUserToastMsg.type !== "error" && (
        <div className="fixed bottom-6 right-6 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className={`px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg ${
            addUserToastMsg.type === "success" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 backdrop-blur-sm" :
            "bg-blue-500/15 text-blue-400 border border-blue-500/25 backdrop-blur-sm"
          }`}>
            {addUserToastMsg.text}
          </div>
        </div>
      )}

      {/* ── CSV Template Preview Popup ── */}
      <Dialog open={csvPreview !== null} onOpenChange={(open) => { if (!open) setCsvPreview(null); }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye className="w-4 h-4 text-violet-400" />
              CSV Template — {csvPreview === "users" ? "Users" : csvPreview === "institutions" ? "Institutions" : "Departments"}
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Your CSV file should follow this format. The first row is the header.
            </DialogDescription>
          </DialogHeader>
          {csvPreview && (() => {
            const cols = CSV_TEMPLATES[csvPreview].columns;
            const exampleVals = CSV_TEMPLATES[csvPreview].example.split(",").map(s => s.trim());
            return (
              <div className="space-y-3 min-w-0">
                <div className="rounded-lg border border-neutral-700/40 overflow-x-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#525252 transparent" }}>
                  <table className="min-w-max text-xs font-mono whitespace-nowrap">
                    <thead>
                      <tr className="bg-neutral-800 border-b border-neutral-700/40">
                        {cols.map((col, i) => (
                          <th key={i} className="px-3 py-2 text-left text-[11px] font-semibold text-violet-400 uppercase tracking-wide">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-neutral-800/50">
                        {cols.map((_, i) => (
                          <td key={i} className="px-3 py-2 text-neutral-300">{exampleVals[i] ?? ""}</td>
                        ))}
                      </tr>
                      <tr className="bg-neutral-800/30">
                        {cols.map((_, i) => (
                          <td key={i} className="px-3 py-1.5 text-neutral-600 italic">...</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => { downloadCsvTemplate(csvPreview); setCsvPreview(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors">
                    <FileDown className="w-3.5 h-3.5" />Download Template
                  </button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Grouped content */}
      <div className="divide-y divide-neutral-800/50">
        {dirLoading ? (
          <div className="text-center text-neutral-500 text-xs py-8">Loading directory…</div>
        ) : dirError ? (
          <div className="text-center text-red-400 text-xs py-8">Failed to load directory: {dirError}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-neutral-600 text-xs py-8">
            No users match your filters.
          </div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([institute, depts]) => {
              const instKey = `inst-${institute}`;
              const instCollapsed = collapsed[instKey];
              const instUserCount = Object.values(depts).flat().length;

              return (
                <div key={institute}>
                  {/* Institute header */}
                  <div className="group/inst flex items-center">
                    <button
                      onClick={() => toggleGroup(instKey)}
                      className="flex-1 flex items-center gap-2.5 px-5 py-3 hover:bg-neutral-800/30 transition-colors text-left"
                    >
                      {instCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
                      )}
                      <Building2 className="w-4 h-4 text-violet-400" />
                      <span className="text-[13px] font-semibold text-neutral-200">{institute} <span className="text-[11px] font-normal text-neutral-500 ml-1.5">({instUserCount})</span></span>
                    </button>
                    {isSuperAdmin && (
                      <div className={`flex items-center gap-0.5 pr-4 transition-opacity ${researchStatuses[institute] === "researching" || researchStatuses[institute] === "completed" || researchStatuses[institute] === "failed" ? "opacity-100" : "opacity-0 group-hover/inst:opacity-100"}`}>
                        {researchStatuses[institute] === "researching" ? (
                          <>
                            <span className="p-1 text-amber-400" title="Researching… (5-15 min)">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelInstituteResearch(institute); }}
                              className="p-1 rounded text-red-400/70 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                              title="Stop research"
                            >
                              <StopCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : researchStatuses[institute] === "completed" ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleViewResearch("institute", institute); }}
                              className="p-1 rounded text-emerald-400 hover:bg-neutral-700/60 hover:text-emerald-300 transition-colors"
                              title="View existing research"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openResearchPrompt("institute", institute); }}
                              className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                              title="Run new research"
                            >
                              <Microscope className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : researchStatuses[institute] === "failed" ? (
                          <>
                            <span className="p-1 text-red-400" title="Previous research failed">
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); openResearchPrompt("institute", institute); }}
                              className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                              title="Retry deep research"
                            >
                              <Microscope className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); openResearchPrompt("institute", institute); }}
                            className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                            title="Deep Research this institute"
                          >
                            <Microscope className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenameInstOld(institute); setRenameInstNew(institute); setRenameInstOpen(true); }}
                          className="p-1 rounded hover:bg-neutral-700/60 text-neutral-500 hover:text-neutral-200 transition-colors"
                          title="Rename institution"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteInstConfirm(institute); }}
                          className="p-1 rounded hover:bg-red-500/20 text-neutral-500 hover:text-red-400 transition-colors"
                          title="Delete institution"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!instCollapsed && (
                    <div className="pl-4">
                      {Object.entries(depts)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([dept, users]) => {
                          const deptKey = `${institute}::${dept}`;
                          const deptCollapsed = collapsed[deptKey];

                          return (
                            <div key={dept}>
                              {/* Department header */}
                              <div className="group/dept flex items-center">
                                <button
                                  onClick={() => toggleGroup(deptKey)}
                                  className="flex-1 flex items-center gap-2 px-5 py-2 hover:bg-neutral-800/20 transition-colors text-left"
                                >
                                  {deptCollapsed ? (
                                    <ChevronRight className="w-3 h-3 text-neutral-600" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 text-neutral-600" />
                                  )}
                                  <Library className="w-3.5 h-3.5 text-emerald-400/80" />
                                  <span className="text-xs font-medium text-neutral-400">{dept} <span className="text-[10px] font-normal text-neutral-500 ml-1.5">({users.length})</span></span>
                                </button>
                                {isSuperAdmin && (
                                  <div className={`flex items-center gap-0.5 pr-4 transition-opacity ${researchStatuses[`${institute}::${dept}`] === "researching" || researchStatuses[`${institute}::${dept}`] === "completed" || researchStatuses[`${institute}::${dept}`] === "failed" ? "opacity-100" : "opacity-0 group-hover/dept:opacity-100"}`}>
                                    {researchStatuses[`${institute}::${dept}`] === "researching" ? (
                                      <>
                                        <span className="p-1 text-amber-400" title="Researching… (5-15 min)">
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleCancelDepartmentResearch(institute, dept); }}
                                          className="p-1 rounded text-red-400/70 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                                          title="Stop research"
                                        >
                                          <StopCircle className="w-3 h-3" />
                                        </button>
                                      </>
                                    ) : researchStatuses[`${institute}::${dept}`] === "completed" ? (
                                      <>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleViewResearch("department", institute, dept); }}
                                          className="p-1 rounded text-emerald-400 hover:bg-neutral-700/60 hover:text-emerald-300 transition-colors"
                                          title="View existing research"
                                        >
                                          <Eye className="w-3 h-3" />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); openResearchPrompt("department", institute, dept); }}
                                          className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                                          title="Run new research"
                                        >
                                          <Microscope className="w-3 h-3" />
                                        </button>
                                      </>
                                    ) : researchStatuses[`${institute}::${dept}`] === "failed" ? (
                                      <>
                                        <span className="p-1 text-red-400" title="Previous research failed">
                                          <AlertTriangle className="w-3 h-3" />
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); openResearchPrompt("department", institute, dept); }}
                                          className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                                          title="Retry deep research"
                                        >
                                          <Microscope className="w-3 h-3" />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openResearchPrompt("department", institute, dept); }}
                                        className="p-1 rounded text-neutral-500 hover:bg-violet-500/20 hover:text-violet-400 transition-colors"
                                        title="Deep Research this department"
                                      >
                                        <Microscope className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRenameDeptInst(institute); setRenameDeptOld(dept); setRenameDeptNew(dept); setRenameDeptOpen(true); }}
                                      className="p-1 rounded hover:bg-neutral-700/60 text-neutral-500 hover:text-neutral-200 transition-colors"
                                      title="Rename department"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setDeleteDeptConfirm({ institute, department: dept }); }}
                                      className="p-1 rounded hover:bg-red-500/20 text-neutral-500 hover:text-red-400 transition-colors"
                                      title="Delete department"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {!deptCollapsed && (
                                <div className="pl-4">
                                  {/* Role branches: super-admins → admins → teachers → students */}
                                  {(() => {
                                    const superAdmins = users.filter((u) => u.role === "admin" && u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());
                                    const regularAdmins = users.filter((u) => u.role === "admin" && u.email.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase());
                                    const branches: { key: string; label: string; Icon: typeof Crown; color: string; items: typeof users }[] = [];
                                    if (superAdmins.length > 0) branches.push({ key: "super-admin", label: "Super Admin", Icon: Shield, color: "text-amber-400/80", items: superAdmins });
                                    if (regularAdmins.length > 0) branches.push({ key: "admin", label: "Admins", Icon: Crown, color: "text-rose-400/80", items: regularAdmins });
                                    if (users.some((u) => u.role === "teacher")) branches.push({ key: "teacher", label: "Teachers", Icon: UserCog, color: "text-amber-400/80", items: users.filter((u) => u.role === "teacher") });
                                    if (users.some((u) => u.role === "student")) branches.push({ key: "student", label: "Students", Icon: GraduationCap, color: "text-sky-400/80", items: users.filter((u) => u.role === "student") });
                                    return branches.map(({ key, label, Icon: BranchIcon, color, items }) => {
                                      const roleKey = `${institute}::${dept}::${key}`;
                                      const roleCollapsed = collapsed[roleKey];

                                      return (
                                        <div key={key}>
                                          {/* Role header */}
                                          <button
                                            onClick={() => toggleGroup(roleKey)}
                                            className="w-full flex items-center gap-2 px-5 py-1.5 hover:bg-neutral-800/20 transition-colors text-left"
                                          >
                                            {roleCollapsed ? (
                                              <ChevronRight className="w-2.5 h-2.5 text-neutral-600" />
                                            ) : (
                                              <ChevronDown className="w-2.5 h-2.5 text-neutral-600" />
                                            )}
                                            <BranchIcon className={`w-3.5 h-3.5 ${color}`} />
                                            <span className="text-xs font-medium text-neutral-500">
                                              {label} <span className="font-normal ml-1.5">({items.length})</span>
                                            </span>
                                          </button>

                                          {!roleCollapsed && (
                                            <table className="w-full text-left">
                                              <tbody>
                                                {items.map((u) => (
                                                  <tr
                                                    key={u.id}
                                                    className="border-b border-neutral-800/30 hover:bg-neutral-800/20 transition-colors group/row"
                                                  >
                                                    <td className="pl-[4.5rem] pr-4 py-2 text-xs text-neutral-200 font-medium w-[30%]">
                                                      {u.name}
                                                    </td>
                                                    <td className="px-4 py-2 text-xs text-neutral-400 w-[35%]">
                                                      {u.email}
                                                    </td>
                                                    <td className="px-2 py-2 text-xs text-neutral-500 w-[10%]">
                                                      {(() => {
                                                        const isActive = u.status === "active" || u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
                                                        return (
                                                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                            isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                                                          }`}>
                                                            {isActive ? "Active" : "Invited"}
                                                          </span>
                                                        );
                                                      })()}
                                                    </td>
                                                    <td className="px-2 py-2 text-right w-[15%]">
                                                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                        {canEdit(u) && (
                                                          <button
                                                            onClick={() => openEditDialog(u)}
                                                            className="p-1 rounded hover:bg-neutral-700/60 text-neutral-500 hover:text-neutral-200 transition-colors"
                                                            title="Edit user"
                                                          >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                          </button>
                                                        )}
                                                        {canRemove(u) && (
                                                          <button
                                                            onClick={() => { setRemoveError(null); setRemoveConfirmUser(u); }}
                                                            className="p-1 rounded hover:bg-red-500/20 text-neutral-500 hover:text-red-400 transition-colors"
                                                            title="Remove user"
                                                          >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                          </button>
                                                        )}
                                                      </div>
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* ── Deep Research Prompt Dialog ── */}
      <Dialog open={researchPromptOpen} onOpenChange={(open) => { if (!open) { setResearchPromptOpen(false); setResearchPromptTarget(null); setResearchPromptInstructions(""); } }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Microscope className="w-4 h-4 text-violet-400" />
              Deep Research
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              {researchPromptTarget?.type === "institute"
                ? <>Research <span className="text-neutral-300 font-medium">{researchPromptTarget?.institute}</span>. This takes 5–15 minutes.</>
                : <>Research <span className="text-neutral-300 font-medium">{researchPromptTarget?.department}</span> at <span className="text-neutral-300 font-medium">{researchPromptTarget?.institute}</span>. This takes 5–15 minutes.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Additional Instructions <span className="text-neutral-600 normal-case">(optional)</span></label>
              <textarea
                value={researchPromptInstructions}
                onChange={(e) => setResearchPromptInstructions(e.target.value)}
                placeholder="e.g. Focus on placement statistics and research output…"
                rows={3}
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40 resize-y"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setResearchPromptOpen(false); setResearchPromptTarget(null); setResearchPromptInstructions(""); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmResearchPrompt}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              Start Research
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename Institution Dialog ── */}
      <Dialog open={renameInstOpen} onOpenChange={(open) => { if (!open) { setRenameInstOpen(false); setRenameInstOld(""); setRenameInstNew(""); } }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="w-4 h-4 text-violet-400" />
              Rename Institution
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              All users under <span className="text-neutral-300 font-medium">{renameInstOld}</span> will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">New Name</label>
              <input
                type="text"
                value={renameInstNew}
                onChange={(e) => setRenameInstNew(e.target.value)}
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setRenameInstOpen(false); setRenameInstOld(""); setRenameInstNew(""); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRenameInstitute}
              disabled={!renameInstNew.trim() || renameInstNew.trim() === renameInstOld || renameInstLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {renameInstLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Institution Confirm Dialog ── */}
      <Dialog open={!!deleteInstConfirm} onOpenChange={(open) => { if (!open) setDeleteInstConfirm(null); }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-red-400">
              <Trash2 className="w-4 h-4" />
              Delete Institution
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              This will clear the institution and department fields on all users under <span className="text-neutral-300 font-medium">{deleteInstConfirm}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setDeleteInstConfirm(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteInstitute}
              disabled={deleteInstLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {deleteInstLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename Department Dialog ── */}
      <Dialog open={renameDeptOpen} onOpenChange={(open) => { if (!open) { setRenameDeptOpen(false); setRenameDeptInst(""); setRenameDeptOld(""); setRenameDeptNew(""); } }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="w-4 h-4 text-emerald-400" />
              Rename Department
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Renaming <span className="text-neutral-300 font-medium">{renameDeptOld}</span> under <span className="text-neutral-300 font-medium">{renameDeptInst}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">New Name</label>
              <input
                type="text"
                value={renameDeptNew}
                onChange={(e) => setRenameDeptNew(e.target.value)}
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/40"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setRenameDeptOpen(false); setRenameDeptInst(""); setRenameDeptOld(""); setRenameDeptNew(""); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRenameDepartment}
              disabled={!renameDeptNew.trim() || renameDeptNew.trim() === renameDeptOld || renameDeptLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {renameDeptLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Department Confirm Dialog ── */}
      <Dialog open={!!deleteDeptConfirm} onOpenChange={(open) => { if (!open) setDeleteDeptConfirm(null); }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-red-400">
              <Trash2 className="w-4 h-4" />
              Delete Department
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              This will clear the department field on all users in <span className="text-neutral-300 font-medium">{deleteDeptConfirm?.department}</span> under <span className="text-neutral-300 font-medium">{deleteDeptConfirm?.institute}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setDeleteDeptConfirm(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteDepartment}
              disabled={deleteDeptLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {deleteDeptLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deep Research Viewer Dialog ── */}
      <Dialog open={researchViewerOpen} onOpenChange={(open) => { if (!open) setResearchViewerOpen(false); }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Microscope className="w-4 h-4 text-emerald-400" />
              Deep Research — {researchViewerTitle}
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              {researchViewerData?.completed_at
                ? `Completed ${new Date(researchViewerData.completed_at as string).toLocaleString()} · ${Math.round((researchViewerData.research_duration_seconds as number) / 60)} min`
                : "Loading research data…"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 py-3 pr-1 scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent">
            {researchViewerLoading ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
                <p className="text-xs text-neutral-600">Loading research data…</p>
              </div>
            ) : researchViewerData?.error && typeof researchViewerData.error === "string" ? (
              <div className="flex flex-col items-center gap-2 py-12 text-red-400">
                <AlertTriangle className="w-6 h-6" />
                <p className="text-sm">{researchViewerData.error as string}</p>
              </div>
            ) : researchViewerData ? (
              <ResearchDataRenderer data={researchViewerData} />
            ) : null}
          </div>

          <DialogFooter className="shrink-0 gap-2 sm:gap-2 border-t border-neutral-800/60 pt-3 mt-1">
            <button
              onClick={() => setResearchViewerOpen(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                setResearchViewerOpen(false);
                // Re-trigger research
                const title = researchViewerTitle;
                if (title.includes(" — ")) {
                  const [dept, inst] = title.split(" — ");
                  const key = `${inst}::${dept}`;
                  setResearchStatuses((prev) => ({ ...prev, [key]: "researching" }));
                  triggerDepartmentResearch(inst, dept).then(() => pollResearchStatus(key, "department", inst, dept));
                } else {
                  setResearchStatuses((prev) => ({ ...prev, [title]: "researching" }));
                  triggerInstituteResearch(title).then(() => pollResearchStatus(title, "institute", title));
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <Microscope className="w-3.5 h-3.5" />
              Re-Research
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ── */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setEditUser(null); } }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="w-4 h-4 text-violet-400" />
              Edit User
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Update the details for <span className="text-neutral-300 font-medium">{editUser?.email}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-3">
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-neutral-800/80 text-sm text-neutral-200 placeholder-neutral-600 border border-neutral-700/50 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Role</label>
              <Select
                value={editRole}
                onValueChange={(v) => setEditRole(v as UserRole)}
                disabled={!isSuperAdmin && editUser?.email.toLowerCase() === callerEmail}
              >
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isSuperAdmin && editUser?.email.toLowerCase() === callerEmail && (
                <p className="text-[10px] text-neutral-600">You cannot change your own role.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Institute</label>
              <Select value={editInstitute || "__none"} onValueChange={(v) => { setEditInstitute(v === "__none" ? "" : v); setEditDepartment(""); }}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60 truncate">
                  <SelectValue placeholder="Select institute…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-neutral-500">Select institute…</SelectItem>
                  {getAllInstitutes().map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Department</label>
              <Select value={editDepartment || "__none"} onValueChange={(v) => setEditDepartment(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-9 !bg-neutral-800/80 !border text-sm text-neutral-200 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none !border-neutral-700/50 focus:!border-violet-500/40 focus:!ring-violet-500/60 truncate">
                  <SelectValue placeholder="Select department…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-neutral-500">Select department…</SelectItem>
                  {getAllDepartments(editInstitute || undefined).map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editError && <p className="text-xs text-red-400">{editError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => { setEditOpen(false); setEditUser(null); }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={editLoading || !editName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {editLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove User Confirmation Dialog ── */}
      <Dialog open={removeConfirmUser !== null} onOpenChange={(open) => { if (!open) setRemoveConfirmUser(null); }}>
        <DialogContent className="bg-neutral-900 border-neutral-700/60 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-red-400">
              <Trash2 className="w-4 h-4" />
              Remove User
            </DialogTitle>
            <DialogDescription className="text-neutral-400 text-xs">
              Are you sure you want to remove <span className="text-neutral-200 font-medium">{removeConfirmUser?.name}</span> (<span className="text-neutral-300">{removeConfirmUser?.email}</span>) from the directory?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {removeError && <p className="text-xs text-red-400 mt-2">{removeError}</p>}
          <DialogFooter className="gap-2 sm:gap-2 mt-2">
            <button
              onClick={() => setRemoveConfirmUser(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRemoveConfirm}
              disabled={removeLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {removeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-neutral-900/80 rounded-2xl p-5 border border-neutral-800/60 flex items-start gap-4">
      <div className="text-neutral-500">{icon}</div>
      <div>
        <div className={`text-2xl font-bold tracking-tight ${valueClass ?? "text-white"}`}>{value}</div>
        <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function StudentRow({
  summary,
  isExpanded,
  onToggle,
  detail,
  loadingDetail,
}: {
  summary: StudentSummary;
  isExpanded: boolean;
  onToggle: () => void;
  detail: StudentDetail | null;
  loadingDetail: boolean;
}) {
  const { user_id = "Unknown", pct_complete = 0, learned = 0, in_progress = 0, not_started = 0, total_topics = 0 } = summary ?? {};

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-neutral-800/40 transition-colors text-left group"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-neutral-500 shrink-0 transition-transform" />
        ) : (
          <ChevronRight className="w-4 h-4 text-neutral-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        )}
        <span className="text-sm font-medium text-neutral-200 w-52 truncate">{user_id}</span>
        {/* Mini progress bar */}
        <div className="flex-1 max-w-[220px]">
          <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${pctBg(pct_complete)} transition-all duration-500`}
              style={{ width: `${pct_complete}%` }}
            />
          </div>
        </div>
        <span className={`text-sm font-bold w-14 text-right tabular-nums ${pctColor(pct_complete)}`}>
          {pct_complete}%
        </span>
        <span className="text-xs text-neutral-500 w-44 text-right tabular-nums">
          {learned} learned · {in_progress} active · {not_started} pending / {total_topics}
        </span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-14 pb-5 animate-in slide-in-from-top-1 duration-200">
          {loadingDetail ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-neutral-600" />
            </div>
          ) : detail ? (
            <div className="grid grid-cols-3 gap-6 text-sm">
              <TopicColumn title="Learned" topics={detail.topics_by_status?.learned ?? []} emptyText="No topics learned yet" />
              <TopicColumn title="In Progress" topics={detail.topics_by_status?.in_progress ?? []} emptyText="No topics in progress" />
              <TopicColumn title="Not Started" topics={detail.topics_by_status?.not_started ?? []} emptyText="All topics started!" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TopicColumn({
  title,
  topics,
  emptyText,
}: {
  title: string;
  topics: { topic: string; status: string; latest_summary: string; module: string }[];
  emptyText: string;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">
        {title} ({topics.length})
      </h4>
      {topics.length === 0 ? (
        <p className="text-xs text-neutral-600 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {topics.map((t) => (
            <li key={t.topic} className="flex items-start gap-2">
              {statusIcon(t.status)}
              <div className="min-w-0">
                <span className="text-xs text-neutral-300 block truncate">{t.topic}</span>
                {t.latest_summary && (
                  <span className="text-[11px] text-neutral-500 block truncate">{t.latest_summary}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ════════════════════════  Groundedness / RAG Quality  ════════════════════════ */

function scoreColor(score: number | null, max: number = 5): string {
  if (score === null) return "text-neutral-500";
  const pct = (score / max) * 100;
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  if (pct >= 40) return "text-orange-400";
  return "text-red-400";
}

function ScoreRing({ score, max = 5, size = 48 }: { score: number | null; max?: number; size?: number }) {
  const pct = score !== null ? (score / max) * 100 : 0;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          className="text-neutral-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={scoreColor(score, max)}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${scoreColor(score, max)}`}>
          {score !== null ? score.toFixed(1) : "—"}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════  Deep Research Data Renderer  ════════════════════════ */

const RESEARCH_META_KEYS = new Set([
  "status", "institute_name", "department_name", "completed_at",
  "research_duration_seconds", "started_at", "error",
]);

const SECTION_ICONS: Record<string, string> = {
  profile: "🏛️",
  academic_system: "📚",
  campus_life: "🎓",
  student_demographics: "👥",
  industry_connections: "🏭",
  faculty: "👨‍🏫",
  facilities: "🔬",
  curriculum: "📋",
  research: "🔍",
};

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function RenderValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="text-neutral-600 italic text-xs">N/A</span>;
  }

  if (typeof value === "string") {
    // Multi-line strings
    if (value.includes("\n")) {
      return (
        <div className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">{value}</div>
      );
    }
    return <span className="text-xs text-neutral-300">{value}</span>;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-xs text-neutral-200 font-medium">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-neutral-600 italic text-xs">Empty</span>;
    }
    // Array of objects (e.g. notable_faculty, labs)
    if (typeof value[0] === "object" && value[0] !== null) {
      return (
        <div className="space-y-2 mt-1">
          {value.map((item, i) => (
            <div key={i} className="bg-neutral-800/40 rounded-lg p-3 border border-neutral-700/30">
              {typeof item === "object" && item !== null ? (
                <div className="space-y-1.5">
                  {Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-[11px] text-neutral-500 font-medium min-w-[90px] shrink-0">{prettifyKey(k)}</span>
                      <RenderValue value={v} depth={depth + 1} />
                    </div>
                  ))}
                </div>
              ) : (
                <RenderValue value={item} depth={depth + 1} />
              )}
            </div>
          ))}
        </div>
      );
    }
    // Array of primitives (strings, numbers)
    return (
      <ul className="space-y-0.5 mt-0.5">
        {value.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-300">
            <span className="text-neutral-600 mt-0.5 shrink-0">•</span>
            {typeof item === "string" ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    return (
      <div className={depth > 0 ? "ml-2 mt-1 pl-3 border-l border-neutral-700/40 space-y-1.5" : "space-y-1.5"}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k}>
            <span className="text-[11px] text-neutral-500 font-medium">{prettifyKey(k)}</span>
            <div className="mt-0.5">
              <RenderValue value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-xs text-neutral-400">{JSON.stringify(value)}</span>;
}

function ResearchDataRenderer({ data }: { data: Record<string, unknown> }) {
  const sections = Object.entries(data).filter(([key]) => !RESEARCH_META_KEYS.has(key));

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-neutral-600">
        <Microscope className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No research data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map(([key, value]) => (
        <details key={key} className="group" open>
          <summary className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg bg-neutral-800/60 hover:bg-neutral-800/80 transition-colors select-none">
            <ChevronRight className="w-3.5 h-3.5 text-neutral-500 transition-transform group-open:rotate-90" />
            <span className="text-sm">{SECTION_ICONS[key] ?? "📄"}</span>
            <span className="text-[13px] font-semibold text-neutral-200">{prettifyKey(key)}</span>
          </summary>
          <div className="mt-2 px-4 pb-2">
            <RenderValue value={value} />
          </div>
        </details>
      ))}
    </div>
  );
}

function GroundednessSection({
  evaluations,
  summary,
  loading,
  onRefresh,
  chatOpen,
}: {
  evaluations: GroundednessEvaluation[];
  summary: GroundednessSummary | null;
  loading: boolean;
  onRefresh: () => void;
  chatOpen: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const displayEvals = showAll ? evaluations : evaluations.slice(0, 10);

  return (
    <div className="bg-neutral-900/80 rounded-2xl border border-neutral-800/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-neutral-800/60 flex items-center justify-between min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-4 h-4 text-neutral-500 shrink-0" />
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide truncate">
            RAG Quality — Groundedness Evaluations
          </h3>
        </div>
        <button
          onClick={onRefresh}
          className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
          title="Refresh evaluations"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && evaluations.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-600" />
        </div>
      ) : !summary || evaluations.length === 0 ? (
        <div className="flex flex-col items-center py-12 px-6 text-neutral-600 text-center">
          <Shield className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No groundedness evaluations yet.</p>
          <p className="text-xs text-neutral-700 mt-1">Evaluations run automatically when students chat with teaching assistants.</p>
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Score Cards */}
          <div className={`grid gap-4 ${chatOpen ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
            <div className="bg-neutral-800/60 rounded-xl p-4 flex items-center gap-3">
              <ScoreRing score={summary.avgOverall} />
              <div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wide">Overall</div>
                <div className={`text-lg font-bold ${scoreColor(summary.avgOverall)}`}>
                  {summary.avgOverall?.toFixed(1) ?? "—"}<span className="text-xs text-neutral-600">/5</span>
                </div>
              </div>
            </div>
            <div className="bg-neutral-800/60 rounded-xl p-4 flex items-center gap-3">
              <div className="text-neutral-500"><Shield className="w-5 h-5" /></div>
              <div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wide">Faithfulness</div>
                <div className={`text-lg font-bold ${scoreColor(summary.avgFaithfulness)}`}>
                  {summary.avgFaithfulness?.toFixed(1) ?? "—"}<span className="text-xs text-neutral-600">/5</span>
                </div>
              </div>
            </div>
            <div className="bg-neutral-800/60 rounded-xl p-4 flex items-center gap-3">
              <div className="text-neutral-500"><Target className="w-5 h-5" /></div>
              <div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wide">Relevancy</div>
                <div className={`text-lg font-bold ${scoreColor(summary.avgAnswerRelevancy)}`}>
                  {summary.avgAnswerRelevancy?.toFixed(1) ?? "—"}<span className="text-xs text-neutral-600">/5</span>
                </div>
              </div>
            </div>
            <div className="bg-neutral-800/60 rounded-xl p-4 flex items-center gap-3">
              <div className="text-neutral-500"><FileSearch className="w-5 h-5" /></div>
              <div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wide">Ctx Precision</div>
                <div className={`text-lg font-bold ${scoreColor(summary.avgContextPrecision)}`}>
                  {summary.avgContextPrecision?.toFixed(1) ?? "—"}<span className="text-xs text-neutral-600">/5</span>
                </div>
              </div>
            </div>
          </div>

          {/* Distribution Bar */}
          {summary.distribution && summary.total > 0 && (
            <div>
              <h4 className="text-[11px] text-neutral-500 uppercase tracking-wide mb-2">
                Score Distribution ({summary.total} evaluations)
              </h4>
              <div className="flex h-6 rounded-full overflow-hidden bg-neutral-800/80">
                {(["1-2", "2-3", "3-4", "4-5"] as const).map((bucket) => {
                  const count = summary.distribution[bucket];
                  const pct = (count / summary.total) * 100;
                  if (pct === 0) return null;
                  const colors: Record<string, string> = {
                    "1-2": "bg-red-500/90",
                    "2-3": "bg-orange-500/90",
                    "3-4": "bg-amber-400/90",
                    "4-5": "bg-emerald-500/90",
                  };
                  return (
                    <div
                      key={bucket}
                      className={`${colors[bucket]} flex items-center justify-center text-[10px] font-bold text-white transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                      title={`Score ${bucket}: ${count} evaluation${count !== 1 ? "s" : ""}`}
                    >
                      {pct > 12 ? bucket : ""}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-5 mt-2 text-[11px] text-neutral-500">
                {(["1-2", "2-3", "3-4", "4-5"] as const).map((b) => (
                  <span key={b} className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        b === "1-2" ? "bg-red-500" : b === "2-3" ? "bg-orange-500" : b === "3-4" ? "bg-amber-400" : "bg-emerald-500"
                      }`}
                    />
                    {b} ({summary.distribution[b]})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Evaluation List */}
          <div>
            <h4 className="text-[11px] text-neutral-500 uppercase tracking-wide mb-3">
              Recent Evaluations
            </h4>
            <div className="space-y-1">
              {displayEvals.map((ev) => (
                <div key={ev.id}>
                  <button
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-neutral-800/40 transition-colors text-left group"
                  >
                    {expanded === ev.id ? (
                      <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                    <span className="text-xs text-neutral-300 flex-1 truncate">{ev.query}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-bold tabular-nums ${scoreColor(ev.overallScore)}`}>
                        {ev.overallScore?.toFixed(1) ?? "—"}/5
                      </span>
                      <span className="text-[10px] text-neutral-600">
                        {new Date(ev.evaluatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expanded === ev.id && (
                    <div className="ml-8 mr-4 mb-3 p-4 bg-neutral-800/40 rounded-lg space-y-3 animate-in slide-in-from-top-1 duration-200">
                      {/* Scores row */}
                      <div className="flex flex-wrap gap-4">
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Faithfulness</span>
                          <div className={`text-sm font-bold ${scoreColor(ev.groundednessScore)}`}>
                            {ev.groundednessScore?.toFixed(1) ?? "—"}/5
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Relevancy</span>
                          <div className={`text-sm font-bold ${scoreColor(ev.answerRelevancyScore)}`}>
                            {ev.answerRelevancyScore?.toFixed(1) ?? "—"}/5
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Ctx Precision</span>
                          <div className={`text-sm font-bold ${scoreColor(ev.contextPrecisionScore)}`}>
                            {ev.contextPrecisionScore?.toFixed(1) ?? "—"}/5
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Overall</span>
                          <div className={`text-sm font-bold ${scoreColor(ev.overallScore)}`}>
                            {ev.overallScore?.toFixed(1) ?? "—"}/5
                          </div>
                        </div>
                      </div>

                      {/* Query & Response */}
                      <div>
                        <span className="text-[10px] text-neutral-500 uppercase">Query</span>
                        <p className="text-xs text-neutral-300 mt-0.5">{ev.query}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-neutral-500 uppercase">Response</span>
                        <p className="text-xs text-neutral-400 mt-0.5 line-clamp-4">{ev.response}</p>
                      </div>

                      {/* Reasoning */}
                      {ev.groundednessReason && (
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Faithfulness Reasoning</span>
                          <p className="text-xs text-neutral-400 mt-0.5">{ev.groundednessReason}</p>
                        </div>
                      )}
                      {ev.answerRelevancyReason && (
                        <div>
                          <span className="text-[10px] text-neutral-500 uppercase">Relevancy Reasoning</span>
                          <p className="text-xs text-neutral-400 mt-0.5">{ev.answerRelevancyReason}</p>
                        </div>
                      )}

                      {/* Claims */}
                      {ev.unsupportedClaims && ev.unsupportedClaims.length > 0 && (
                        <div>
                          <span className="text-[10px] text-red-400 uppercase">Unsupported Claims</span>
                          <ul className="mt-1 space-y-1">
                            {ev.unsupportedClaims.map((c, i) => (
                              <li key={i} className="text-xs text-red-300/80 flex items-start gap-1.5">
                                <span className="text-red-500 mt-0.5">•</span>
                                {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="flex gap-4 text-[10px] text-neutral-600 pt-1 border-t border-neutral-700/50">
                        <span>User: {ev.userId}</span>
                        <span>Method: {ev.method}</span>
                        <span>{new Date(ev.evaluatedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Show more / less */}
            {evaluations.length > 10 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="mt-3 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                {showAll ? "Show less" : `Show all ${evaluations.length} evaluations`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
