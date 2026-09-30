// src/pages/ProjectHomeView.tsx

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/lib/chatStore";
import { getCourseName } from "@/lib/utils";
import { MoreHorizontal, Trash2, Settings, GraduationCap, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import { ChatHistoryDrawer } from "@/components/chat/ChatHistoryDrawer";
import { useAppContext } from "@/layouts/MainLayout";
import { deleteAzureAgent, getAgentCourseCurriculum, listAzureAgents } from "@/lib/api";
import { useCurrentUserId } from "@/lib/userStore";
import { toast } from "sonner";
import { applyNameGuard } from "@/lib/nameGuard";
import { ManageCodeVerifyDialog } from "@/components/ManageCodeDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function ProjectHomeView() {
  const navigate = useNavigate();
  const params = useParams<{ courseName: string }>();
  const appContext = useAppContext();
  
  const {
    courseAgentId: contextAgentId,
    courseAgentName: contextAgentName,
    setCourseAgentId,
    setCourseAgentName,
    handleStartChatFromProject,
    handleSelectThread,
    setEditingAgentId,
    setEditMode,
  } = appContext;

  const { projects, createThreadForAgent, getOrCreateAgentProject, deleteProject, userLearningProfile, setUserLearningProfile } = useChatStore(
    useShallow((s) => ({
      projects: s.projects,
      createThreadForAgent: s.createThreadForAgent,
      getOrCreateAgentProject: s.getOrCreateAgentProject,
      deleteProject: s.deleteProject,
      userLearningProfile: s.userLearningProfile,
      setUserLearningProfile: s.setUserLearningProfile,
    }))
  );

  // Try to find agent from URL param if context is missing
  const courseNameFromUrl = params.courseName ? decodeURIComponent(params.courseName) : null;
  
  // Look up teaching assistant from projects based on URL course name
  const courseProjectFromUrl = useMemo(() => {
    if (!courseNameFromUrl) return null;
    // If we have context, still look up the project for consistency
    // Convert course name to expected agent name format (lowercase with hyphens)
    const normalizedName = courseNameFromUrl.toLowerCase().replace(/\s+/g, "-");
    const courseAgentName = `course-${normalizedName}`;
    
    // Try multiple matching strategies
    return Object.values(projects).find(p => {
      const pName = (p.name || "").toLowerCase();
      const pAgentName = (p.agentName || "").toLowerCase();
      const pCourseName = getCourseName(p.name || p.agentName || "").toLowerCase();
      const urlCourseLower = courseNameFromUrl.toLowerCase();
      
      return pName === courseAgentName || 
             pAgentName === courseAgentName ||
             pCourseName === urlCourseLower ||
             pName.includes(normalizedName) ||
             pAgentName.includes(normalizedName);
    });
  }, [projects, courseNameFromUrl]);
  
  // Agent ID and name come from context, or fall back to URL-based lookup
  const agentId = contextAgentId || courseProjectFromUrl?.agentId || "";
  const agentName = contextAgentName || courseProjectFromUrl?.agentName || courseProjectFromUrl?.name || "";

  // Redirect to library if no agent found and URL courseName is generic "Course"
  useEffect(() => {
    if (!agentId && (!courseNameFromUrl || courseNameFromUrl.toLowerCase() === "course")) {
      navigate("/library");
    }
  }, [agentId, courseNameFromUrl, navigate]);

  const [inputValue, setInputValue] = useState("");
  const [isScrolled, setIsScrolled] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showManageCodeVerify, setShowManageCodeVerify] = useState(false);

  // Chat history drawer state
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const handleDrawerSelectThread = useCallback(
    (threadId: string) => {
      if (agentId && agentName) {
        handleSelectThread(threadId, agentId, agentName);
      }
    },
    [agentId, agentName, handleSelectThread]
  );

  // Creator check for Edit/Delete permissions
  const currentUserId = useCurrentUserId();
  const [agentCreatorId, setAgentCreatorId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!agentId) return;
    listAzureAgents().then((agents) => {
      const match = agents.find((a) => a.id === agentId);
      if (match) setAgentCreatorId(match.created_by_id);
    });
  }, [agentId]);

  const isMyAgent = !agentCreatorId || agentCreatorId === currentUserId;

  // Syllabus state
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [syllabusData, setSyllabusData] = useState<any>(null);
  const [syllabusStatus, setSyllabusStatus] = useState<string>("");
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());
  const [expandedConcepts, setExpandedConcepts] = useState<Set<number>>(new Set());
  const [syllabusTab, setSyllabusTab] = useState<"modules" | "concepts">("modules");

  // Conversation starters — fallback defaults
  const emptyStateSuggestions = useMemo(() => {
    return [
      { title: "Why Learn This Course", description: "Why should I learn this course?" },
      { title: "Check my Knowledge", description: "How do I know how much I know about this subject?" },
      { title: "Try a Challenge", description: "Give me an example of a simple challenge, and tell me what topics it covers." },
      { title: "Explain in My Language", description: "Can you explain a threshold concept from this course in my preferred language?" },
    ];
  }, []);

  // Proactively check course curriculum availability on mount
  useEffect(() => {
    if (!agentId) return;
    getAgentCourseCurriculum(agentId).then((result) => {
      if (result.status === "ready" && result.course_curriculum) {
        setSyllabusData(result.course_curriculum);
      }
    }).catch(() => {});
  }, [agentId]);

  /** Strip "Module N:" prefix from titles (the UI already shows a number) */
  const stripModulePrefix = (text: string) => text.replace(/^Module\s+\d+\s*:\s*/i, "");

  const toggleModule = (idx: number) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleConcept = (idx: number) => {
    setExpandedConcepts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleOpenSyllabus = async () => {
    setSyllabusOpen(true);
    if (syllabusData) return; // Already loaded
    if (!agentId) return;
    setSyllabusLoading(true);
    try {
      const result = await getAgentCourseCurriculum(agentId);
      if (result.status === "ready" && result.course_curriculum) {
        setSyllabusData(result.course_curriculum);
      } else {
        setSyllabusStatus(result.message || "Course curriculum not available yet.");
      }
    } catch (e: any) {
      setSyllabusStatus(`Failed to load: ${e.message}`);
    } finally {
      setSyllabusLoading(false);
    }
  };

  const courseName = getCourseName(agentName);

  const handleStartChat = () => {
    if (!inputValue.trim()) return;

    // Ensure project exists
    getOrCreateAgentProject(agentId, agentName);

    // Create a new thread for the agent
    const threadId = createThreadForAgent(agentId);

    // Navigate to chat view with the new thread and pass the initial message
    const message = applyNameGuard(inputValue.trim());
    setInputValue("");
    
    handleStartChatFromProject(threadId, agentId, agentName, message, false, deepResearchEnabled);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  // Learning Profile dialog state
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileData, setProfileData] = useState({
    instructions: "",
    skills: [] as string[],
    learningGoal: "",
    proficiencyLevel: "beginner" as "beginner" | "intermediate" | "advanced",
  });
  const [newSkill, setNewSkill] = useState("");

  // Load learning profile from store when dialog opens
  useEffect(() => {
    if (profileOpen && userLearningProfile) {
      try {
        const parsed = JSON.parse(userLearningProfile);
        setProfileData({
          instructions: parsed.instructions || "",
          skills: parsed.skills || [],
          learningGoal: parsed.learningGoal || "",
          proficiencyLevel: parsed.proficiencyLevel || "beginner",
        });
      } catch {
        // If JSON parse fails, start fresh
      }
    }
  }, [profileOpen, userLearningProfile]);

  const handleAddSkill = () => {
    const skill = newSkill.trim();
    if (skill && !profileData.skills.includes(skill)) {
      setProfileData((prev) => ({ ...prev, skills: [...prev.skills, skill] }));
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setProfileData((prev) => ({ ...prev, skills: prev.skills.filter((s) => s !== skill) }));
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      // Serialize learning profile and save to store (auto-syncs to Cosmos DB)
      const profileJson = JSON.stringify(profileData);
      setUserLearningProfile(profileJson);
      setProfileOpen(false);
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="relative flex flex-col h-full bg-gradient-to-br from-neutral-950 via-black to-neutral-950">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/3 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-500/3 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>
      {/* Header with course name left, menu right */}
      <PageHeader title={courseName} showBorder={isScrolled}>
        {/* Three dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-all">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/50 rounded-xl min-w-[190px] p-1">
            <DropdownMenuItem
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
              onClick={handleOpenSyllabus}
            >
              <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="h-3.5 w-3.5 text-neutral-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-medium leading-tight">Course Syllabus</span>
                <span className="text-[10px] text-neutral-500 leading-tight">View modules & course curriculum</span>
              </div>
            </DropdownMenuItem>
            {/* Edit Agent disabled for now */}
            <DropdownMenuSeparator className="bg-neutral-800/60 my-0.5" />
            <DropdownMenuItem
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                onClick={() => setShowManageCodeVerify(true)}
              >
                <div className="w-7 h-7 rounded-md bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="h-3.5 w-3.5 text-red-400/80" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium leading-tight">Delete Agent</span>
                  <span className="text-[10px] text-red-400/50 leading-tight">Remove this teaching assistant</span>
                </div>
              </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {/* Chat container - matches ChatView layout */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <UnifiedChatContainer
          messages={[]}
          input={inputValue}
          onInputChange={(e) => setInputValue(e.target.value)}
          onSend={handleStartChat}
          isSending={false}
          placeholder="Ask anything about the course..."
          emptyStateTitle=""
          emptyStateDescription=""
          emptyStateSuggestions={emptyStateSuggestions}
          onSuggestionClick={handleSuggestionClick}
          deepResearchEnabled={deepResearchEnabled}
          onDeepResearchToggle={setDeepResearchEnabled}
          showDeepResearchButton={true}
          onScrollStateChange={setIsScrolled}
          bottomSlot={
            <ChatHistoryDrawer
              agentId={agentId}
              activeThreadId={null}
              onSelectThread={handleDrawerSelectThread}
              isOpen={isHistoryDrawerOpen}
              onClose={() => setIsHistoryDrawerOpen(false)}
            />
          }
        />
      </div>

      {/* Manage Code Verify Dialog – gate before delete */}
      <ManageCodeVerifyDialog
        open={showManageCodeVerify}
        onClose={() => setShowManageCodeVerify(false)}
        onVerified={() => {
          setShowManageCodeVerify(false);
          setShowDeleteConfirm(true);
        }}
        agentId={agentId}
        action="delete"
      />

      {/* Delete Agent Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Delete "{courseName}"?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This will permanently delete the teaching assistant and all its data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              disabled={isDeleting}
              onClick={async () => {
                if (!agentId) return;
                setIsDeleting(true);
                const toastId = toast.loading(`Deleting '${courseName}'...`);
                try {
                  await deleteAzureAgent(agentId);
                  // Clean up local state
                  const courseProject = Object.values(projects).find(p => p.agentId === agentId);
                  if (courseProject) deleteProject(courseProject.id);
                  setCourseAgentId(null);
                  setCourseAgentName("");
                  toast.success(`Deleted '${courseName}' successfully`, { id: toastId });
                  setShowDeleteConfirm(false);
                  navigate("/library");
                } catch (e: any) {
                  toast.error(`Failed to delete: ${e.message}`, { id: toastId });
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Learning Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden p-0">
          {/* Fixed Header */}
          <div className="px-6 pt-4 pb-4 border-b border-neutral-800 flex-shrink-0 flex items-center justify-between">
            <DialogTitle className="text-neutral-100 text-lg">Learning Profile</DialogTitle>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              {/* Proficiency Level */}
              <div>
                <label className="text-sm font-medium text-neutral-300 block">Proficiency Level</label>
                <p className="text-xs text-neutral-500 mb-2">Select your current knowledge level</p>
                <div className="flex gap-2">
                  {(["beginner", "intermediate", "advanced"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setProfileData((prev) => ({ ...prev, proficiencyLevel: level }))}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                        profileData.proficiencyLevel === level
                          ? "bg-white text-neutral-900"
                          : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 border border-neutral-700"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="px-5 py-2 border-t border-neutral-800 flex-shrink-0 flex justify-end gap-2">
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              onClick={() => setProfileOpen(false)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={profileSaving}
              onClick={handleSaveProfile}
            >
              {profileSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Syllabus Dialog */}
      <Dialog open={syllabusOpen} onOpenChange={setSyllabusOpen}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0">
          {/* Fixed Header + Tabs */}
          <div className="flex-shrink-0">
            <div className="px-6 pt-4 pb-3 flex items-center gap-2">
              <DialogTitle className="text-neutral-100 text-lg">
                Course Syllabus
              </DialogTitle>
            </div>
            {/* Tab bar */}
            {syllabusData && (
              <div className="px-6 flex gap-1 border-b border-neutral-800">
                <button
                  onClick={() => setSyllabusTab("modules")}
                  className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                    syllabusTab === "modules"
                      ? "text-white"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  Modules
                  {syllabusTab === "modules" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                  )}
                </button>
                <button
                  onClick={() => setSyllabusTab("concepts")}
                  className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                    syllabusTab === "concepts"
                      ? "text-white"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  Threshold Concepts
                  {syllabusTab === "concepts" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {syllabusLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
                <p className="text-sm text-neutral-500">Loading course curriculum...</p>
              </div>
            ) : syllabusData ? (
              <>
                {/* Modules Tab */}
                {syllabusTab === "modules" && (
                  <div className="space-y-4">
                    {/* Course overview */}
                    {syllabusData.course_name && (
                      <div>
                        <h3 className="text-base font-semibold text-neutral-200">{syllabusData.course_name}</h3>
                        {syllabusData.course_level && (
                          <p className="text-xs text-neutral-500 mt-0.5">Level: {syllabusData.course_level}</p>
                        )}
                      </div>
                    )}

                    {syllabusData.syllabus && syllabusData.syllabus.length > 0 ? (
                      <div className="space-y-2">
                        {syllabusData.syllabus.map((mod: any, idx: number) => (
                          <div key={idx} className="rounded-lg border border-neutral-800 overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                              onClick={() => toggleModule(idx)}
                            >
                              <span className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                                <span className="text-sm text-neutral-500 font-mono w-6">{idx + 1}.</span>
                                {stripModulePrefix(mod.title || mod.module || mod.name || `Module ${idx + 1}`)}
                              </span>
                              {expandedModules.has(idx) ? (
                                <ChevronDown className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                              )}
                            </button>
                            {expandedModules.has(idx) && (
                              <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                {/* Two-column: Topics left, Learning Objectives right */}
                                <div className="grid grid-cols-2 gap-4">
                                  {mod.topics && mod.topics.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Topics</p>
                                      <div className="ml-2 space-y-1.5">
                                        {mod.topics.map((topic: string, tIdx: number) => (
                                          <div key={tIdx} className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-neutral-600/80 border border-neutral-500/50 flex-shrink-0" />
                                            <span className="text-xs text-neutral-300">
                                              {typeof topic === "string" ? topic : (topic as any).title || (topic as any).name || JSON.stringify(topic)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {mod.learning_objectives && mod.learning_objectives.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Learning Objectives</p>
                                      <div className="ml-2 space-y-1.5">
                                        {mod.learning_objectives.map((obj: string, oIdx: number) => (
                                          <div key={oIdx} className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500/50 border border-emerald-400/40 flex-shrink-0" />
                                            <span className="text-xs text-neutral-300">{obj}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {/* Prerequisites full width below */}
                                {mod.prerequisites && mod.prerequisites.length > 0 && (
                                  <div className="flex items-center flex-wrap gap-2 pt-3 mt-1 border-t border-neutral-800/40">
                                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mr-1">Prerequisites</span>
                                      {mod.prerequisites.map((prereq: string, pIdx: number) => (
                                        <span
                                          key={pIdx}
                                          className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] text-neutral-100 bg-neutral-800 shadow-sm shadow-black/15"
                                        >
                                          {stripModulePrefix(prereq)}
                                        </span>
                                      ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 text-center py-8">No modules available in the course curriculum.</p>
                    )}
                  </div>
                )}

                {/* Threshold Concepts Tab */}
                {syllabusTab === "concepts" && (
                  <div className="space-y-3">
                    {syllabusData.all_threshold_concepts && syllabusData.all_threshold_concepts.length > 0 ? (
                      <div className="space-y-2">
                        {syllabusData.all_threshold_concepts.map((tcName: string, idx: number) => {
                          const tc = syllabusData[tcName] || {};
                          return (
                          <div key={idx} className="rounded-lg border border-neutral-800 overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                              onClick={() => toggleConcept(idx)}
                            >
                              <span className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                                <span className="text-sm text-neutral-500 font-mono w-6">{idx + 1}.</span>
                                {tcName}
                              </span>
                              {expandedConcepts.has(idx) ? (
                                <ChevronDown className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                              )}
                            </button>
                            {expandedConcepts.has(idx) && (
                              <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                {tc.description && (
                                  <p className="text-xs text-neutral-400 leading-relaxed">{tc.description}</p>
                                )}
                                {tc.why_threshold && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider whitespace-nowrap mt-0.5">Why it's hard</span>
                                    <p className="text-xs text-neutral-400 leading-relaxed">{tc.why_threshold}</p>
                                  </div>
                                )}
                                {tc.misconceptions && tc.misconceptions.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-red-400/70 uppercase tracking-wider mb-1.5">Common Misconceptions</p>
                                    <div className="space-y-1.5">
                                      {tc.misconceptions.map((m: any, mIdx: number) => (
                                        <div key={mIdx} className="flex items-center gap-2">
                                          <div className="w-2 h-2 rounded-full bg-neutral-600/80 border border-neutral-500/50 flex-shrink-0" />
                                          <span className="text-xs text-neutral-400">
                                            {typeof m === "string" ? m : m.misconception || m.description || JSON.stringify(m)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 text-center py-8">No threshold concepts available in the course curriculum.</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <GraduationCap className="h-10 w-10 text-neutral-700" />
                <p className="text-sm text-neutral-500">{syllabusStatus || "No course curriculum available."}</p>
                <p className="text-xs text-neutral-600 max-w-sm">
                  Course curriculum is generated automatically when you create an agent with textbooks.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
