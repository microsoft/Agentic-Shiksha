import { useEffect, useState, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { Sidebar } from "@/components/layout/Sidebar";
import { useChatStore } from "@/lib/chatStore";
import { useShallow } from "zustand/react/shallow";
import { getCourseName, getCourseId } from "@/lib/utils";
import {
  TEMP_PREVIEW_DEFAULT_MODEL,
  AVAILABLE_MODELS,
  MODEL_DEPLOYMENT_DEFAULT,
  fetchBackendConfig,
} from "@/lib/config";
import type { View } from "@/lib/types";
import { logger } from "@/lib/loggingService";
import { useChatSync } from "@/lib/useChatSync";

// Cache for teaching assistants: { courseId: { id, name } }
type CourseAgentCache = Record<string, { id: string; name: string }>;

// Persisted create-form state (survives navigation away from CreateView)
export interface CreateFormState {
  courseName: string;
  courseLevel: string;
  courseSpan: string;
  courseNotes: string;
  courseCode: string;
  prerequisites: string[];
  courseUrls: Array<{ url: string; description?: string }>;
  agentImagePreview: string | null;
  agentImageFile: File | null;
  textbooks: Array<{
    id: string;
    name: string;
    edition: string;
    authors?: string[];
    type: "primary" | "reference";
    description?: string;
    file?: File;
  }>;
  courseDescFile: File | null;
  kbUploads: File[];
  conversationStarters: Array<{ title: string; prompt: string }>;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  courseName: "",
  courseLevel: "",
  courseSpan: "",
  courseNotes: "",
  courseCode: "",
  prerequisites: [],
  courseUrls: [],
  agentImagePreview: null,
  agentImageFile: null,
  textbooks: [],
  courseDescFile: null,
  kbUploads: [],
  conversationStarters: [
    { title: FIXED_FIRST_STARTER, prompt: FIXED_FIRST_STARTER },
    { title: "How do I check if I know some of the concepts already?", prompt: "How do I check if I know some of the concepts already?" },
    { title: "Give me an example of a simple challenge", prompt: "Give me an example of a simple challenge, and tell me what topics it covers." },
    { title: "Can you explain a threshold concept", prompt: "Can you explain a threshold concept from this course in my preferred language?" },
  ],
};

// Context for sharing state across routed components
import { createContext, useContext } from "react";
import { UpdateBanner } from "@/components/UpdateBanner";
import { FIXED_FIRST_STARTER } from "@/lib/starters";

export interface AppContextType {
  sessionUuid: string;
  courseAgentId: string | null;
  setCourseAgentId: (id: string | null) => void;
  courseAgentName: string;
  setCourseAgentName: (name: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  vectorStoreId: string | null;
  setVectorStoreId: (id: string | null) => void;
  pendingMessage: string | null;
  setPendingMessage: (msg: string | null) => void;
  pendingInputText: string | null;  // Prefills input box without auto-sending
  setPendingInputText: (text: string | null) => void;
  pendingWebSearchEnabled: boolean;
  setPendingWebSearchEnabled: (enabled: boolean) => void;
  pendingDeepResearchEnabled: boolean;
  setPendingDeepResearchEnabled: (enabled: boolean) => void;
  editingAgentId: string | null;
  setEditingAgentId: (id: string | null) => void;
  editingAgentKind: "course";  // Always "course" - single agent per course
  setEditingAgentKind: (kind: "course") => void;  // No-op, always course
  editMode: "simplistic" | "advanced";
  setEditMode: (mode: "simplistic" | "advanced") => void;
  isCreatingAgent: boolean;
  setIsCreatingAgent: (v: boolean) => void;
  createFormState: CreateFormState;
  setCreateFormState: React.Dispatch<React.SetStateAction<CreateFormState>>;
  handleSelectThread: (threadId: string, agentId: string, agentName: string) => void;
  handleSelectCourse: (agentId: string, agentName: string, initialMessage?: string) => void;
  handleStartChatFromProject: (threadId: string, agentId: string, agentName: string, initialMessage?: string, webSearchEnabled?: boolean, deepResearchEnabled?: boolean) => void;
  handleNewChat: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within MainLayout");
  }
  return context;
}

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Initialize chat sync with Cosmos DB
  const { userId, isAuthenticated } = useChatSync();
  
  const [sessionUuid, setSessionUuid] = useState<string>("");
  const [courseAgentId, setCourseAgentId] = useState<string | null>(null);
  const [courseAgentName, setCourseAgentName] = useState<string>("");
  
  // Cache for teaching assistants
  const courseAgentCacheRef = useRef<CourseAgentCache>({});

  const { getOrCreateAgentProject, setActiveThread, createThreadForAgent, getProjectByAgentName, updateProjectAgentId, threads, projects, cleanupEmptyThreads } = useChatStore(
    useShallow((s) => ({
      getOrCreateAgentProject: s.getOrCreateAgentProject,
      setActiveThread: s.setActiveThread,
      threads: s.threads,
      projects: s.projects,
      createThreadForAgent: s.createThreadForAgent,
      getProjectByAgentName: s.getProjectByAgentName,
      updateProjectAgentId: s.updateProjectAgentId,
      cleanupEmptyThreads: s.cleanupEmptyThreads,
    }))
  );

  const [selectedModel, setSelectedModel] = useState<string>(
    TEMP_PREVIEW_DEFAULT_MODEL
  );
  const [vectorStoreId, setVectorStoreId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingInputText, setPendingInputText] = useState<string | null>(null);  // Prefills input without auto-sending
  const [pendingWebSearchEnabled, setPendingWebSearchEnabled] = useState<boolean>(false);
  const [pendingDeepResearchEnabled, setPendingDeepResearchEnabled] = useState<boolean>(false);

  // Edit view state — persisted to sessionStorage so values survive page refresh
  const [editingAgentId, setEditingAgentIdRaw] = useState<string | null>(
    () => sessionStorage.getItem("editingAgentId") || null
  );
  const [editMode, setEditModeRaw] = useState<"simplistic" | "advanced">(
    () => (sessionStorage.getItem("editMode") as "simplistic" | "advanced") || "simplistic"
  );

  const setEditingAgentId = (id: string | null) => {
    setEditingAgentIdRaw(id);
    if (id) sessionStorage.setItem("editingAgentId", id);
    else sessionStorage.removeItem("editingAgentId");
  };
  const setEditMode = (mode: "simplistic" | "advanced") => {
    setEditModeRaw(mode);
    sessionStorage.setItem("editMode", mode);
  };

  // Agent creation in-progress flag (persists across navigation)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);

  // Create-form state (persists across navigation so form isn't lost)
  const [createFormState, setCreateFormState] = useState<CreateFormState>(EMPTY_CREATE_FORM);

  useEffect(() => {
    setSessionUuid(uuidv4());
    
    // Fetch default model from backend
    fetchBackendConfig().then((config) => {
      setSelectedModel(config.default_model);
    }).catch(() => {
      // Fallback to local config
      setSelectedModel(
        AVAILABLE_MODELS.includes(TEMP_PREVIEW_DEFAULT_MODEL as any)
          ? TEMP_PREVIEW_DEFAULT_MODEL
          : MODEL_DEPLOYMENT_DEFAULT
      );
    });
  }, []);

  // Restore agent context from URL on page load/refresh
  // This handles the case where the user refreshes on a /chat/:courseName/:threadId URL
  useEffect(() => {
    const path = location.pathname;
    // /home is course-agnostic: without clearing here the previous course stayed
    // selected and the first click appeared to do nothing.
    if (path === "/home") {
      if (courseAgentId !== null) setCourseAgentId(null);
      if (courseAgentName !== "") setCourseAgentName("");
      return;
    }
    // Check if we're on a chat page with a threadId
    // Handle /course/:courseName URL (no threadId)
    const courseMatch = path.match(/^\/course\/([^/]+)$/);
    if (courseMatch) {
      const courseName = decodeURIComponent(courseMatch[1]);
      const project = getProjectByAgentName(courseName);
      if (project && project.agentId) {
        if (courseAgentId !== project.agentId) setCourseAgentId(project.agentId);
        const agentName = project.agentName || courseName;
        if (courseAgentName !== agentName) setCourseAgentName(agentName);
      }
    }

    const chatMatch = path.match(/^\/chat\/([^/]+)\/([^/]+)$/);
    if (chatMatch) {
      const courseName = decodeURIComponent(chatMatch[1]);
      const threadId = chatMatch[2];
      
      // Try to find the thread in the store
      const thread = threads[threadId];
      if (thread && thread.agentId) {
        // Found the thread - restore agent context
        const agentId = thread.agentId;
        
        // Try to find the project to get the agent name
        const project = Object.values(projects).find(p => p.agentId === agentId);
        const agentName = project?.agentName || thread.context?.agentName || courseName;
        
        console.log("Restoring agent context from URL:", { agentId, agentName, threadId });
        
        if (courseAgentId !== agentId) setCourseAgentId(agentId);
        if (courseAgentName !== agentName) setCourseAgentName(agentName);
        setActiveThread(threadId);
      } else {
        // Thread not found - try to find agent by course name in projects
        const project = getProjectByAgentName(courseName);
        if (project && project.agentId) {
          console.log("Restoring agent context from course name:", { agentId: project.agentId, courseName });
          if (courseAgentId !== project.agentId) setCourseAgentId(project.agentId);
          const agentName = project.agentName || courseName;
          if (courseAgentName !== agentName) setCourseAgentName(agentName);
        }
      }
    }
  }, [location.pathname, courseAgentId, courseAgentName, threads, projects, setActiveThread, getProjectByAgentName]);

  // Derive view from current path for Sidebar
  const getViewFromPath = (): View => {
    const path = location.pathname;
    if (path.startsWith("/library")) return "library";
    if (path.startsWith("/assets")) return "assets";
    if (path.startsWith("/create")) return "create";
    if (path.startsWith("/edit")) return "edit";
    if (path.startsWith("/course")) return "chat";
    if (path.startsWith("/home") || path.startsWith("/chat")) return "chat";
    return "chat";
  };

  const view = getViewFromPath();

  const setView = (newView: View) => {
    switch (newView) {
      case "library":
        navigate("/library");
        break;
      case "assets":
        navigate("/assets");
        break;
      case "create":
        navigate("/create");
        break;
      case "edit":
        if (editingAgentId && courseAgentName) {
          const courseName = getCourseName(courseAgentName);
          navigate(`/edit/${encodeURIComponent(courseName)}`);
        }
        break;
      case "projectHome":
        if (courseAgentId && courseAgentName) {
          const courseName = getCourseName(courseAgentName);
          navigate(`/chat/${encodeURIComponent(courseName)}/${createThreadForAgent(courseAgentId)}`);
        }
        break;
      case "chat":
      default:
        // Clear agent context when going to home to show welcome screen
        setCourseAgentId(null);
        setCourseAgentName("");
        setActiveThread(null);
        navigate("/home");
        break;
    }
  };

  const handleSelectThread = (threadId: string, agentId: string, agentName: string) => {
    // Log agent switch if switching to a different agent
    if (courseAgentId && courseAgentId !== agentId) {
      logger.logAgentSwitch({
        fromAgentId: courseAgentId,
        fromAgentName: courseAgentName,
        toAgentId: agentId,
        toAgentName: agentName,
      });
    }
    
    // Log thread selection
    logger.logThreadSelected({
      threadId,
      agentId,
      agentName,
    });
    
    setActiveThread(threadId);
    setCourseAgentId(agentId);
    setCourseAgentName(agentName);
    
    // Use course name in URL
    const courseName = getCourseName(agentName);
    navigate(`/chat/${encodeURIComponent(courseName)}/${threadId}`);
  };

  const handleSelectCourse = async (agentId: string, agentName: string, initialMessage?: string) => {
    // Create or get existing project for this agent
    getOrCreateAgentProject(agentId, agentName, "course");
    setCourseAgentId(agentId);
    setCourseAgentName(agentName);
    
    // If there's an initial message (e.g., from conversation starters), prefill the input
    if (initialMessage) {
      // Use pendingInputText to prefill the input box without auto-sending
      // This allows the user to customize the message before sending
      setPendingInputText(initialMessage);
      // Create a new thread and navigate to chat
      const newThreadId = createThreadForAgent(agentId);
      setActiveThread(newThreadId);
      const courseName = getCourseName(agentName);
      navigate(`/chat/${encodeURIComponent(courseName)}/${newThreadId}`);
    } else {
      // Navigate directly to chat with a fresh thread
      const newThreadId = createThreadForAgent(agentId);
      setActiveThread(newThreadId);
      const courseName = getCourseName(agentName);
      navigate(`/chat/${encodeURIComponent(courseName)}/${newThreadId}`);
    }
    
    // Cache the current agent
    const courseId = getCourseId(agentName);
    const normalizedCourseId = courseId.toLowerCase().replace(/_/g, "-");
    courseAgentCacheRef.current[normalizedCourseId] = { id: agentId, name: agentName };
  };

  const handleStartChatFromProject = (threadId: string, agentId: string, agentName: string, initialMessage?: string, webSearchEnabled?: boolean, deepResearchEnabled?: boolean) => {
    // Called when user starts a new chat with an initial message
    setActiveThread(threadId);
    setCourseAgentId(agentId);
    setCourseAgentName(agentName);
    setPendingMessage(initialMessage || null);
    setPendingWebSearchEnabled(webSearchEnabled ?? false);
    setPendingDeepResearchEnabled(deepResearchEnabled ?? false);
    
    // Use course name in URL
    const courseName = getCourseName(agentName);
    navigate(`/chat/${encodeURIComponent(courseName)}/${threadId}`);
  };

  const handleNewChat = () => {
    if (!courseAgentId) {
      console.warn("[handleNewChat] courseAgentId is null, cannot create new chat");
      return;
    }
    console.log("[handleNewChat] Creating new chat for agent:", courseAgentId, courseAgentName);
    // Clean up existing empty threads first
    cleanupEmptyThreads();
    // Force-create a fresh thread (skip empty-thread reuse to avoid stale-state race)
    const newThreadId = createThreadForAgent(courseAgentId, undefined, true);
    setActiveThread(newThreadId);
    
    // Log thread creation
    logger.logThreadCreated({
      threadId: newThreadId,
      agentId: courseAgentId,
      agentName: courseAgentName,
    });
    
    // Use course name in URL
    const courseName = getCourseName(courseAgentName);
    navigate(`/chat/${encodeURIComponent(courseName)}/${newThreadId}`);
  };

  const contextValue: AppContextType = {
    sessionUuid,
    courseAgentId,
    setCourseAgentId,
    courseAgentName,
    setCourseAgentName,
    selectedModel,
    setSelectedModel,
    vectorStoreId,
    setVectorStoreId,
    pendingMessage,
    setPendingMessage,
    pendingInputText,
    setPendingInputText,
    pendingWebSearchEnabled,
    setPendingWebSearchEnabled,
    pendingDeepResearchEnabled,
    setPendingDeepResearchEnabled,
    editingAgentId,
    setEditingAgentId,
    editingAgentKind: "course" as const,  // Always course - single agent per course
    setEditingAgentKind: () => {},  // No-op
    editMode,
    setEditMode,
    isCreatingAgent,
    setIsCreatingAgent,
    createFormState,
    setCreateFormState,
    handleSelectThread,
    handleSelectCourse,
    handleStartChatFromProject,
    handleNewChat,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div className="flex h-dvh w-screen overflow-hidden bg-neutral-950 text-neutral-100">
        <Sidebar
          view={view}
          setView={setView}
          activeAgentId={courseAgentId}
          onSelectThread={handleSelectThread}
          onSelectCourse={handleSelectCourse}
        />

        {/* Main area gets a slightly lighter dark bg for contrast */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-neutral-950">
          <Outlet />
        </main>
        <UpdateBanner />
      </div>
    </AppContext.Provider>
  );
}
