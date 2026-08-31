import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CreateButton } from "@/components/ui/CreateButton";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { getCourseName } from "@/lib/utils";
import {
  PlusCircle,
  Plus,
  Trash2,
  Search,
  GraduationCap,
  User,
  FileText,
  AlertCircle,
  Loader2,
  Edit,
  Sparkles,
  ArrowUp,
  X,
  MessageCircle,
  ArrowRight,
  Link2
} from "lucide-react";
import { useChatStore } from "@/lib/chatStore";
import { useCurrentUserId, useUserStore } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { listAzureAgents, deleteAzureAgent, fetchAgentSetupDetails, absoluteBackendUrl } from "@/lib/api";
import type { AzureAgentRow } from "@/lib/types";
import { useAppContext } from "@/layouts/MainLayout";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ManageCodeVerifyDialog, ConnectAgentDialog } from "@/components/ManageCodeDialog";
import { LibraryMediaGrid } from "@/pages/LibraryMedia";
import { applyFixedFirstStarterText } from "@/lib/starters";

/* ----------------------------- Design System ----------------------------- */
const BUTTON_PRIMARY = `
  bg-white hover:bg-neutral-200
  text-neutral-900
  border-0
  transition-all duration-200
  font-semibold
  rounded-full
  hover:scale-[1.02]
  active:scale-[0.98]
`;

const BUTTON_SECONDARY = `
  bg-white/5 hover:bg-white/10 
  text-white border border-white/10 
  hover:border-white/20
  transition-all duration-300
  hover:scale-[1.02]
  active:scale-[0.98]
`;
/* ------------------------------------------------------------------------- */

type TabKey = "all" | "course";

export function LibraryView() {
  const navigate = useNavigate();
  const appContext = useAppContext();
  
  const {
    courseAgentId,
    setCourseAgentId,
    setCourseAgentName,
    setEditingAgentId,
    setEditingAgentKind,
    setEditMode,
    handleSelectCourse,
  } = appContext;

  const onCreate = () => navigate("/create");
  
  const onChat = (ag: AzureAgentRow, initialMessage?: string) => {
    handleSelectCourse(ag.id, ag.name, initialMessage);
  };
  
  const onEdit = async (ag: AzureAgentRow, mode: "simplistic" | "advanced") => {
    setEditingAgentId(ag.id);
    
    // Always use course kind now (single agent per course)
    setEditingAgentKind("course");
    
    setEditMode(mode);
    
    // Use course name in URL instead of agent ID
    const courseName = getCourseName(ag.name);
    navigate(`/edit/${encodeURIComponent(courseName)}`);
  };
  
  const onDeletedCurrent = () => {
    setCourseAgentId(null);
    setCourseAgentName("");
  };

  const [agents, setAgents] = useState<AzureAgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showMyAgents, setShowMyAgents] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"agents" | "media">("agents");
  
  // Store fetched agent descriptions from setup details
  const [agentDescriptions, setAgentDescriptions] = useState<Record<string, string>>({});
  // Store fetched conversation starters from setup details (prompt strings only)
  const [agentConversationStarters, setAgentConversationStarters] = useState<Record<string, string[]>>({});
  // Store fetched agent images from setup details
  const [agentImages, setAgentImages] = useState<Record<string, string>>({});
  
  // Agent preview modal state
  const [previewAgent, setPreviewAgent] = useState<{
    agent: AzureAgentRow;
    courseName: string;
    description: string;
    conversationStarters: string[];
  } | null>(null);

  // Manage code verification state for Library delete
  const [showLibraryManageCodeVerify, setShowLibraryManageCodeVerify] = useState(false);
  const [libraryDeleteConfirmed, setLibraryDeleteConfirmed] = useState(false);

  // Connect agent dialog state
  const [showConnectAgent, setShowConnectAgent] = useState(false);

  // Get user display name for "Created by" info
  const { userName, userNickname, projects, deleteProject } = useChatStore(
    useShallow((s) => ({
      userName: s.userName,
      userNickname: s.userNickname,
      projects: s.projects,
      deleteProject: s.deleteProject,
    }))
  );
  // Current user's display name - only used for agents created by current user
  const currentUserDisplayName = userNickname || userName.split(" ")[0] || "User";
  
  // Get current userId for permission checks (normalized design)
  const currentUserId = useCurrentUserId();
  
  // Teachers assigned by an admin; falls back to the creator when none are set yet.
  const getTeacherDisplayName = (agent: AzureAgentRow) => {
    const assigned = (agent.teachers || []).filter(Boolean);
    if (assigned.length > 0) {
      return assigned.length > 2
        ? `${assigned.slice(0, 2).join(", ")} +${assigned.length - 2}`
        : assigned.join(", ");
    }
    return getCreatorDisplayName(agent);
  };

  // Helper to get creator display name for an agent
  const getCreatorDisplayName = (agent: AzureAgentRow) => {
    // If agent has a created_by display name from backend, use it
    if (agent.created_by) {
      return agent.created_by;
    }
    // If this is the current user's agent, use their local display name
    if (agent.created_by_id === currentUserId) {
      return currentUserDisplayName;
    }
    // Fallback: extract something readable from created_by_id (e.g. email prefix)
    if (agent.created_by_id) {
      const id = agent.created_by_id;
      // If it looks like an email, use the part before @
      if (id.includes("@")) return id.split("@")[0];
      // Otherwise just show the id
      return id;
    }
    return "Unknown";
  };


  async function refreshAzure(forceRefresh = false) {
    try {
      const list = await listAzureAgents(forceRefresh);
      setAgents(list);
      setError(null);
      if (forceRefresh) {
        toast.success("Agents refreshed successfully");
      }
    } catch (e: any) {
      setAgents([]);
      const msg = e.message || "Failed to load agents";
      if (
        msg.includes(
          "Microsoft.CognitiveServices/accounts/AIServices/agents/read",
        )
      ) {
        setError(
          "Couldn't load agents from Azure AI Foundry. The current identity may be missing the Microsoft.CognitiveServices/accounts/AIServices/agents/read data action.",
        );
      } else setError(`Couldn't load agents from Azure AI Foundry: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refreshAzure(true); // Always force refresh on mount to ensure user-scoped data
  }, []);

  // Fetch agent descriptions, conversation starters from setup details when agents change
  // Note: agentImageUrl now comes directly from Cosmos DB via the agent list
  useEffect(() => {
    async function fetchSetupDetails() {
      const newDescriptions: Record<string, string> = {};
      const newConversationStarters: Record<string, string[]> = {};
      const newImages: Record<string, string> = {};
      
      // Helper to add cache-busting timestamp to image URLs
      const cacheBustUrl = (url: string): string => {
        const absUrl = absoluteBackendUrl(url);
        return absUrl.includes('?') 
          ? `${absUrl}&_t=${Date.now()}` 
          : `${absUrl}?_t=${Date.now()}`;
      };
      
      // First, get images directly from agent list (Cosmos DB)
      // Convert relative proxy URLs to absolute URLs with cache busting
      for (const agent of agents) {
        if (agent.agentImageUrl) {
          newImages[agent.id] = cacheBustUrl(agent.agentImageUrl);
        }
      }
      
      // Fetch setup details for descriptions and conversation starters
      const promises = agents.map(async (agent) => {
        try {
          const setupDetails = await fetchAgentSetupDetails(agent.id);
          if (setupDetails?.agentDescription) {
            newDescriptions[agent.id] = setupDetails.agentDescription;
          }
          if (setupDetails?.conversationStarters && setupDetails.conversationStarters.length > 0) {
            // Normalize: extract prompt strings from {title, prompt} objects or keep legacy strings
            newConversationStarters[agent.id] = applyFixedFirstStarterText(
              setupDetails.conversationStarters.map((s: string | { title: string; prompt: string }) =>
                typeof s === "string" ? s : s.prompt
              )
            );
          }
          // Fallback: if image not in Cosmos DB, check setup details
          if (!newImages[agent.id] && setupDetails?.agentImageUrl) {
            newImages[agent.id] = cacheBustUrl(setupDetails.agentImageUrl);
          }
        } catch {
          // Ignore errors for individual agents
        }
      });
      
      await Promise.all(promises);
      setAgentDescriptions(newDescriptions);
      setAgentConversationStarters(newConversationStarters);
      setAgentImages(newImages);
    }
    
    if (agents.length > 0) {
      fetchSetupDetails();
    }
  }, [agents]);

  // ---------- Tab-based filtering with search ----------
  // Group agents by course name - show only agents starting with "course-"
  const courseAgents = useMemo(() => {
    const result: Array<{
      courseName: string;
      primaryAgent: AzureAgentRow;
      hasCourse: boolean;
      courseAgent?: AzureAgentRow;
      isCourseAgent?: boolean;
    }> = [];
    
    // Only include agents that start with "course-" or "course_"
    agents.forEach((ag) => {
      const name = (ag.name || "").trim().toLowerCase();
      if (!name) return;
      
      // Only show agents that start with "course"
      if (!name.startsWith("course")) return;
      
      // Exclude system/meta agents and test agents
      if (
        name.includes("agent creation") || 
        name.includes("conversational agent") ||
        name.includes("agent_creation") ||
        name.includes("conversational_agent") ||
        name === "temp_course_agent" ||
        name.startsWith("temp_")
      ) return;
      
      // Extract course name by removing the "course-" or "course_" prefix and converting hyphens to spaces
      const rawName = (ag.name || "").replace(/^course[-_]/i, "").trim();
      const displayName = rawName.replace(/[-_]/g, " ").trim() || "Unnamed Course";
      
      result.push({
        courseName: displayName,
        primaryAgent: ag,
        hasCourse: true,
        isCourseAgent: true,
      });
    });
    
    return result;
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return courseAgents.filter((course) => {
      const matchesSearch = searchQuery === "" || 
        course.courseName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (course.primaryAgent.description?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // In "My Agents" mode, filter to only show agents created by the current user
      // Use created_by_id (userId) for permission checks - normalized design
      const isMyAgent = !course.primaryAgent.created_by_id || 
        course.primaryAgent.created_by_id === currentUserId;
      const matchesMyAgents = !showMyAgents || isMyAgent;
      
      return matchesSearch && matchesMyAgents;
    });
  }, [courseAgents, searchQuery, showMyAgents, currentUserId]);

  // Check if there are any displayable teaching assistants (new single agents or legacy pairs)
  const hasAnyAgents = courseAgents.length > 0;

  // Scroll to top handler
  const scrollToTop = () => {
    const scrollableArea = document.getElementById('library-scroll-area');
    scrollableArea?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div 
      id="library-scroll-area" 
      className="h-full overflow-y-auto bg-neutral-900 select-none"
      onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 10)}
    >
      {/* Header with Create + Connect buttons - sticky at top */}
      <PageHeader
        title="Library"
        showBorder={isScrolled}
        centerContent={
          <div
            role="tablist"
            aria-label="Library sections"
            className="relative grid h-[38px] w-[188px] grid-cols-2 rounded-lg border border-neutral-600 bg-neutral-900/80 p-0.5"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-neutral-100 shadow-sm transition-transform duration-200 ease-out ${libraryTab === "media" ? "translate-x-full" : ""}`}
            />
            {(["agents", "media"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={libraryTab === key}
                onClick={() => setLibraryTab(key)}
                className={`relative z-10 flex items-center justify-center rounded-md px-2 text-sm font-medium capitalize transition-colors ${
                  libraryTab === key ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        }
      >
        {!isLoading && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConnectAgent(true)}
              className="inline-flex items-center justify-center rounded-lg px-5 py-1.5 font-medium border border-neutral-600 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-white hover:border-neutral-500 transition-all duration-300"
            >
              <Link2 className="h-4 w-4 mr-1.5 hidden" />
              Connect
            </button>
            {hasAnyAgents && useUserStore.getState().role !== "student" && (
              <CreateButton onClick={onCreate} />
            )}
          </div>
        )}
      </PageHeader>

      {/* Content area */}
      {hasAnyAgents && libraryTab === "agents" && (
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pb-4 pt-16">
          {/* Centered Title - GPTs style - Only show when there are agents */}
          <div className="text-center mb-2">
            <h1 className="text-6xl font-bold text-white mb-4">
              Teaching Assistants
            </h1>
            <p className="text-neutral-400 text-lg max-w-2xl mx-auto leading-relaxed">
              {showMyAgents 
                ? "Manage your AI-powered teaching assistants with full edit and delete access."
                  : "Discover and interact with AI-powered teaching assistants to enhance your educational experience."}
              </p>
            </div>
        </div>
      )}

        {/* Search Bar - Only show when there are agents */}
        {!isLoading && !error && (libraryTab === "media" || hasAnyAgents) && (
          <div className="sticky top-[56px] z-20 pt-4 pb-0.3 bg-neutral-900">
            <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
              <div className="relative w-full">
                <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 h-5 w-5 text-neutral-400" />
                <Input
                  type="text"
                  placeholder={libraryTab === "media" ? "Search Media..." : "Search Agents..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-14 pr-5 py-7 text-[18px] bg-neutral-800/80 border border-neutral-700/60 rounded-xl text-white placeholder:text-[18px] placeholder:text-neutral-500 focus:border-neutral-600 focus:bg-neutral-800 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none hover:border-neutral-600 transition-colors shadow-md shadow-black/20"
                />
              </div>
            </div>
          </div>
        )}

        {libraryTab === "media" && (
          <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pb-8 pt-6">
            <LibraryMediaGrid searchQuery={searchQuery} />
          </div>
        )}

        {libraryTab === "agents" && (
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pb-8 pt-4">
          {/* Agent List - No card wrapper */}
          <div>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-12 h-12 rounded-full border-4 border-neutral-600/30 border-t-neutral-400 animate-spin mb-6" />
                <p className="text-neutral-400 text-lg">Loading...</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-400">{error}</p>
                </div>
              </div>
            ) : !hasAnyAgents ? (
              /* Empty State - matching home page style */
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] -mt-8 text-center max-w-lg mx-auto">
                {/* Title */}
                <h1 className="text-4xl font-semibold tracking-tight text-white">
                  Teaching Assistants
                </h1>
                <p className="mt-4 text-[15px] text-neutral-400 leading-relaxed">
                  Create AI-powered course assistants that help you learn, explore concepts, and master new subjects.
                </p>
                
                {/* CTA Buttons */}
                <div className="flex items-center justify-center gap-3 mt-8">
                  {useUserStore.getState().role !== "student" && (
                    <Button 
                      className="px-5 h-10 bg-white hover:bg-neutral-200 text-neutral-900 font-medium text-sm rounded-lg transition-colors duration-200"
                      onClick={onCreate}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Agent
                    </Button>
                  )}
                  <Button 
                    variant="outline"
                    className="px-5 h-10 border-neutral-700 hover:border-neutral-600 bg-transparent hover:bg-neutral-800 text-neutral-300 hover:text-white font-medium text-sm rounded-lg transition-colors duration-200"
                    onClick={() => setShowConnectAgent(true)}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Connect Agent
                  </Button>
                </div>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="border-2 border-dashed border-neutral-700 rounded-2xl px-16 py-12 flex flex-col items-center justify-center">
                  {searchQuery ? (
                    <>
                      <h3 className="text-xl font-semibold text-white mb-3">No matching agents</h3>
                      <p className="text-neutral-400 text-center mb-6">
                        No agents found matching "{searchQuery}"
                      </p>
                      <Button
                        className={BUTTON_SECONDARY}
                        onClick={() => setSearchQuery("")}
                      >
                        Clear Search
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl font-semibold text-white mb-3">No agents yet</h2>
                      <p className="text-neutral-400 text-center mb-8 max-w-md">
                        Create your first AI-powered teaching assistant to get started with personalized learning
                      </p>
                      <Button className={BUTTON_PRIMARY} onClick={onCreate}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Create Your First Agent
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredAgents.map((course) => {
                  const ag = course.primaryAgent;
                  // Use stored agentDescription from setup details first, then fall back to dummy
                  const storedDesc = agentDescriptions[ag.id];
                  const storedStarters = agentConversationStarters[ag.id] || [];
                  const dummyDescriptions = [
                    "An intelligent AI assistant that helps you learn and understand complex topics through personalized explanations.",
                    "A comprehensive learning companion designed to adapt to your learning style and provide guidance.",
                    "Your personal AI tutor that breaks down difficult concepts into easy-to-understand explanations.",
                    "An advanced educational agent that combines knowledge retrieval with conversational AI.",
                    "A smart study assistant that helps you master new subjects through adaptive questioning.",
                  ];
                  const dummyDesc = dummyDescriptions[Math.abs(ag.id.charCodeAt(ag.id.length - 1)) % dummyDescriptions.length];
                  // Priority: stored agentDescription > agent.description > dummyDesc
                  const displayDesc = storedDesc || ag.description || dummyDesc;
                  // Pass all starters (up to 15) — random selection of 4 happens at display time
                  const displayStarters = storedStarters.length > 0 ? storedStarters : [
                    "Why should I learn this course?",
                    "How do I know how much I know about this subject?",
                    "Give me an example of a simple challenge, and tell me what topics it covers.",
                    "Can you explain a threshold concept from this course in my preferred language?",
                  ];

                  return (
                  <div
                    key={course.courseName}
                    className="group relative"
                  >
                    {/* Horizontal Card - button for main interaction */}
                    <button
                      type="button"
                      onClick={() => setPreviewAgent({ agent: ag, courseName: course.courseName, description: displayDesc, conversationStarters: displayStarters })}
                      className="w-full h-[120px] flex items-start gap-4 p-4 rounded-xl bg-neutral-800/40 hover:bg-neutral-800/70 border border-neutral-700/40 hover:border-neutral-600/50 cursor-pointer transition-all duration-200 text-left shadow-md shadow-black/20 hover:shadow-lg hover:shadow-black/25 overflow-hidden"
                    >
                      {/* Square Icon - show uploaded image or default icon */}
                      <div className={`w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden ${agentImages[ag.id] ? '' : 'bg-neutral-700/60 border border-neutral-600/30'}`}>
                        {agentImages[ag.id] ? (
                          <img 
                            src={agentImages[ag.id]} 
                            alt={course.courseName}
                            className="w-full h-full object-cover rounded-xl"
                          />
                        ) : (
                          <GraduationCap className="h-6 w-6 text-neutral-400" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-white text-[15px] leading-tight mb-0.5 truncate">
                          {course.courseName}
                        </h3>
                        <p className="text-neutral-400 text-sm line-clamp-2 leading-relaxed">
                          {displayDesc}
                        </p>
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 truncate">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{getTeacherDisplayName(ag)}</span>
                        </p>
                      </div>
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}

      {/* Agent Preview Modal */}
      {previewAgent && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPreviewAgent(null)}
        >
          <div 
            className="relative w-full max-w-md mx-4 max-h-[90vh] rounded-2xl border border-neutral-700/50 bg-neutral-900/95 backdrop-blur-xl text-neutral-100 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top bar with actions */}
            <div className="flex items-center justify-end px-4 py-3 border-b border-neutral-800/60">
              <div className="flex items-center gap-1.5">
                {/* Delete Agent — gated behind manage code verification, hidden for students */}
                {useUserStore.getState().role !== "student" && (
                  <>
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-neutral-700/50 hover:bg-white/10 hover:border-neutral-500/50 transition-colors"
                      title="Edit agent"
                      onClick={() => {
                        setPreviewAgent(null);
                        onEdit(previewAgent.agent, "simplistic");
                      }}
                    >
                      <Edit className="h-4 w-4 text-neutral-400" />
                    </button>
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-neutral-700/50 hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
                      title="Delete agent"
                      onClick={() => setShowLibraryManageCodeVerify(true)}
                    >
                      <Trash2 className="h-4 w-4 text-neutral-400 hover:text-red-400" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPreviewAgent(null)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-neutral-700/50 hover:bg-white/10 transition-colors"
                >
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              </div>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col items-center">
                {/* Agent Icon - show uploaded image or default icon */}
                <div className="pt-6 pb-6">
                  <div className={`w-24 h-24 rounded-2xl flex items-center justify-center overflow-hidden ${agentImages[previewAgent.agent.id] ? '' : 'bg-neutral-700/50 border-2 border-neutral-600/40'}`}>
                    {agentImages[previewAgent.agent.id] ? (
                      <img 
                        src={agentImages[previewAgent.agent.id]} 
                        alt={previewAgent.courseName}
                        className="w-full h-full object-cover rounded-2xl"
                      />
                    ) : (
                      <GraduationCap className="h-12 w-12 text-neutral-400" />
                    )}
                  </div>
                </div>

                {/* Agent Name */}
                <h2 className="text-2xl font-bold text-white mb-2 text-center px-6 break-words">
                  {previewAgent.courseName}
                </h2>

                {/* Description */}
                <p className="text-neutral-300 text-sm text-center px-8 mb-8 leading-relaxed">
                  {previewAgent.description}
                </p>

                {/* Conversation Starters */}
                <div className="w-full px-6 pb-6">
                  <h3 className="text-sm font-semibold text-white mb-3">Conversation Starters</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(() => {
                      // Randomly pick 4 out of all available starters
                      const all = previewAgent.conversationStarters;
                      const pick = all.length <= 4
                        ? all
                        : [...all].sort(() => Math.random() - 0.5).slice(0, 4);
                      return pick.map((starter, index) => (
                        <button
                          key={index}
                          className="p-3 text-center text-sm text-neutral-300 bg-neutral-800/60 hover:bg-neutral-700/60 border border-neutral-700/50 rounded-xl transition-colors"
                          onClick={() => {
                            onChat(previewAgent.agent, starter);
                            setPreviewAgent(null);
                          }}
                        >
                          {starter}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Start Chat Button */}
            <div className="w-full px-6 py-4 border-t border-neutral-800/60 rounded-b-2xl">
              <Button
                className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 text-neutral-900 font-medium text-sm transition-all duration-200"
                onClick={() => {
                  onChat(previewAgent.agent);
                  setPreviewAgent(null);
                }}
              >
                Start Chat
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Code Verify Dialog for Library delete */}
      {previewAgent && (
        <ManageCodeVerifyDialog
          open={showLibraryManageCodeVerify}
          onClose={() => setShowLibraryManageCodeVerify(false)}
          onVerified={() => {
            setShowLibraryManageCodeVerify(false);
            setLibraryDeleteConfirmed(true);
          }}
          agentId={previewAgent.agent.id}
          action="delete"
        />
      )}

      {/* Delete confirmation after manage code verified */}
      {previewAgent && (
        <AlertDialog open={libraryDeleteConfirmed} onOpenChange={setLibraryDeleteConfirmed}>
          <AlertDialogContent className="border-white/10 bg-neutral-900/95 backdrop-blur-xl text-neutral-100">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl">
                Delete "{previewAgent.courseName}"?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-neutral-300">
                This will permanently delete the teaching assistant. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={BUTTON_SECONDARY}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={async () => {
                  const agentIdToDelete = previewAgent.agent.id;
                  const courseNameToDelete = previewAgent.courseName;
                  const toastId = toast(
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative flex items-center justify-center w-8 h-8 flex-shrink-0">
                        <div className="absolute inset-0 rounded-full border border-neutral-700 border-t-red-500 animate-spin" />
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-neutral-100 truncate">{courseNameToDelete}</span>
                        <span className="text-sm text-neutral-400">Deleting...</span>
                      </div>
                    </div>,
                    { duration: Infinity }
                  );
                  try {
                    await deleteAzureAgent(agentIdToDelete);
                    setAgents((prev) => prev.filter((a) => a.id !== agentIdToDelete));
                    if (courseAgentId === agentIdToDelete) onDeletedCurrent();
                    setPreviewAgent(null);
                    const courseProject = Object.values(projects).find(p => p.agentId === agentIdToDelete);
                    if (courseProject) deleteProject(courseProject.id);
                    toast.success(
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium text-neutral-100">{courseNameToDelete}</span>
                          <span className="text-sm text-neutral-400">has been removed</span>
                        </div>
                      </div>,
                      { id: toastId }
                    );
                  } catch (e: any) {
                    toast.error(
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-neutral-100">Delete Failed</span>
                          <span className="text-sm text-neutral-400 truncate">{e.message}</span>
                        </div>
                      </div>,
                      { id: toastId }
                    );
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Connect Agent Dialog */}
      <ConnectAgentDialog
        open={showConnectAgent}
        onClose={() => setShowConnectAgent(false)}
        onConnected={(agentId, courseName) => {
          setShowConnectAgent(false);
          toast.success(`Connected to "${courseName}"`);
          // Refresh agent list so the connected agent appears (skip toast for this refresh)
          listAzureAgents(true).then((list) => { setAgents(list); setError(null); }).catch(() => {});
          navigate("/library");
        }}
      />
    </div>
  );
}