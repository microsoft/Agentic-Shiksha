import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { useUpdateStore } from "@/lib/updateStore";
import { ChevronLeft, ChevronRight, ChevronDown, Library, MessageSquare, PlusCircle, Sparkles, Trash2, GraduationCap, MoreHorizontal, Pencil, User, Settings, HelpCircle, MessageSquareMore, LogOut, Activity, Search, X, ExternalLink, Info, Box, LayoutDashboard, RefreshCw } from "lucide-react";
import type { View } from "@/lib/types";
import { useChatStore } from "@/lib/chatStore";
import { useUserStore } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { getCourseName } from "@/lib/utils";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LogViewer } from "@/components/LogViewer";
import { useAuth } from "@/lib/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

// Icon for teaching assistants
const getAgentIcon = () => GraduationCap;

type SidebarProps = {
  view: View;
  setView: (v: View) => void;
  activeAgentId?: string | null;
  onSelectThread?: (threadId: string, agentId: string, agentName: string) => void;
  onSelectCourse?: (agentId: string, agentName: string) => void;
};

export function Sidebar({ view, setView, activeAgentId, onSelectThread, onSelectCourse }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(() => localStorage.getItem("sidebarCollapsed") === "1");
  const [expandedProjects, setExpandedProjects] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set(["history"]));
  const [showAllChats, setShowAllChats] = React.useState<Set<string>>(new Set());
  const [renamingProjectId, setRenamingProjectId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState<string | null>(null);
  const [deleteChatDialogOpen, setDeleteChatDialogOpen] = React.useState<string | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = React.useState("");
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const updateReady = useUpdateStore((s) => s.updateReady);
  const [userInfoOpen, setUserInfoOpen] = React.useState(false);
  const chatHistoryRef = React.useRef<HTMLDivElement>(null);
  const userInfoRef = React.useRef<HTMLDivElement>(null);

  // Close user info popup on outside click
  React.useEffect(() => {
    if (!userInfoOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (userInfoRef.current && !userInfoRef.current.contains(e.target as Node)) {
        setUserInfoOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userInfoOpen]);

  // Microsoft Authentication
  const { user } = useAuth();
  const { can } = useUserRole();
  const navigate = useNavigate();
  const location = useLocation();

  // Navigate to the in-app Dashboard route.
  const handleOpenDashboard = React.useCallback(() => {
    navigate("/dashboard");
  }, [navigate]);

  const toggleShowAllChats = (projectId: string) => {
    setShowAllChats((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const { ensureBootstrap, createThread, projects, threads, messagesByThreadId, activeThreadId, setActiveThread, deleteThread, createThreadForAgent, deleteProject, renameProject, cleanupEmptyThreads, userName, userNickname, userWorkFunction, userPreferences, setUserName, setUserNickname, setUserWorkFunction, setUserPreferences } = useChatStore(
    useShallow((s) => ({
      ensureBootstrap: s.ensureBootstrap,
      createThread: s.createThread,
      projects: s.projects,
      threads: s.threads,
      messagesByThreadId: s.messagesByThreadId,
      activeThreadId: s.activeThreadId,
      setActiveThread: s.setActiveThread,
      deleteThread: s.deleteThread,
      createThreadForAgent: s.createThreadForAgent,
      deleteProject: s.deleteProject,
      renameProject: s.renameProject,
      cleanupEmptyThreads: s.cleanupEmptyThreads,
      userName: s.userName,
      userNickname: s.userNickname,
      userWorkFunction: s.userWorkFunction,
      userPreferences: s.userPreferences,
      setUserName: s.setUserName,
      setUserNickname: s.setUserNickname,
      setUserWorkFunction: s.setUserWorkFunction,
      setUserPreferences: s.setUserPreferences,
    }))
  );

  React.useEffect(() => {
    ensureBootstrap();
  }, [ensureBootstrap]);

  React.useEffect(() => {
    localStorage.setItem("sidebarCollapsed", isCollapsed ? "1" : "0");
    // When sidebar expands, notify other components to close right panels
    if (!isCollapsed) {
      window.dispatchEvent(new Event("sidebar-expand"));
    }
  }, [isCollapsed]);

  // Listen for external collapse requests (e.g. when right panel opens)
  React.useEffect(() => {
    const handleCollapse = () => setIsCollapsed(true);
    window.addEventListener("sidebar-collapse", handleCollapse);
    return () => window.removeEventListener("sidebar-collapse", handleCollapse);
  }, []);

  // Get current user ID and email for filtering
  const currentUserId = useUserStore((s) => s.userId);
  const userEmail = useUserStore((s) => s.email);

  // Group threads by agent (projects with agentId)
  // Only show threads that have messages OR are currently active
  // Only show projects that have at least one thread with messages OR are the active agent
  // IMPORTANT: Only show projects/threads that belong to the current user
  const agentProjects = React.useMemo(() => {
    // Filter projects by current user (or no userId for backwards compat with old data)
    const projectsWithAgents = Object.values(projects).filter((p) => 
      p.agentId && 
      (!p.userId || p.userId === currentUserId)
    );
    
    console.log(`[Sidebar] Found ${projectsWithAgents.length} projects for user ${currentUserId}:`, 
      projectsWithAgents.map(p => ({ id: p.id, name: p.name, agentId: p.agentId })));
    
    const result = projectsWithAgents.map((project) => {
      const allProjectThreads = Object.values(threads)
        .filter((t) => t.agentId === project.agentId)
        // Filter threads by current user (or no userId for backwards compat)
        .filter((t) => !t.userId || t.userId === currentUserId);
      
      const projectThreads = allProjectThreads
        .filter((t) => {
          // Show thread if it has messages OR if it's the currently active thread
          const hasMessages = (messagesByThreadId[t.id]?.length ?? 0) > 0;
          const isActive = t.id === activeThreadId;
          return hasMessages || isActive;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      
      console.log(`[Sidebar] Project "${project.name}": ${allProjectThreads.length} total threads, ${projectThreads.length} with messages`);
      
      return { project, threads: projectThreads };
    })
    // Show projects if they have threads with messages, OR if active, OR if they have ANY threads (even without messages loaded yet)
    .filter(({ project, threads: projectThreads }) => {
      const hasThreadsWithMessages = projectThreads.length > 0;
      const isActiveAgent = project.agentId === activeAgentId;
      // Also show if project has threads (messages might not be loaded yet)
      const hasAnyThreads = Object.values(threads).some(
        (t) => t.agentId === project.agentId && (!t.userId || t.userId === currentUserId)
      );
      return hasThreadsWithMessages || isActiveAgent || hasAnyThreads;
    })
    .sort((a, b) => b.project.updatedAt - a.project.updatedAt);
    
    console.log(`[Sidebar] Final agentProjects count: ${result.length}`);
    return result;
  }, [projects, threads, messagesByThreadId, activeThreadId, activeAgentId, currentUserId]);

  // Unified course grouping: group all threads by course name (stripped prefix)
  // Each course shows recent chats
  const courseGroups = React.useMemo(() => {
    // Get the base course name by stripping course-/course_ prefix and normalizing
    const getBaseName = (name: string) => {
      return name
        .replace(/^course[-_]/i, "")  // Remove course- or course_ prefix
        .replace(/\s+/g, " ")          // Normalize whitespace
        .trim()
        .toLowerCase();
    };

    // Group all projects by their base course name
    const courseMap = new Map<string, {
      courseName: string;
      displayName: string;
      projects: typeof agentProjects;
      allThreads: Array<{ thread: (typeof threads)[string]; project: (typeof projects)[string] }>;
      // Track the most recently updated project as primary
      latestProject: (typeof projects)[string] | null;
    }>();

    agentProjects.forEach(({ project, threads: projectThreads }) => {
      const baseName = getBaseName(project.agentName || project.name);
      
      if (!courseMap.has(baseName)) {
        courseMap.set(baseName, {
          courseName: baseName,
          displayName: getCourseName(project.agentName || project.name),
          projects: [],
          allThreads: [],
          latestProject: null,
        });
      }
      
      const group = courseMap.get(baseName)!;
      group.projects.push({ project, threads: projectThreads });
      
      // Use the most recently updated project as the primary one
      if (!group.latestProject || project.updatedAt > group.latestProject.updatedAt) {
        group.latestProject = project;
      }
      
      projectThreads.forEach((thread) => {
        group.allThreads.push({ thread, project });
      });
    });

    // Sort threads within each course by updatedAt and return as array
    return Array.from(courseMap.values())
      .map((group) => ({
        ...group,
        allThreads: group.allThreads.sort((a, b) => b.thread.updatedAt - a.thread.updatedAt),
        // Use the latest project as primary (most recently updated)
        primaryProject: group.latestProject || group.projects[0]?.project,
      }))
      .sort((a, b) => {
        // Sort courses by most recent thread activity
        const aLatest = a.allThreads[0]?.thread.updatedAt || a.primaryProject?.updatedAt || 0;
        const bLatest = b.allThreads[0]?.thread.updatedAt || b.primaryProject?.updatedAt || 0;
        return bLatest - aLatest;
      });
  }, [agentProjects, projects, threads]);

  // Filter course groups based on search query
  const filteredCourseGroups = React.useMemo(() => {
    if (!chatSearchQuery.trim()) return courseGroups;
    const query = chatSearchQuery.toLowerCase().trim();
    return courseGroups.filter((group) => {
      // Match by course name
      if (group.displayName.toLowerCase().includes(query)) return true;
      if (group.courseName.toLowerCase().includes(query)) return true;
      // Match by thread title
      return group.allThreads.some((t) => 
        t.thread.title?.toLowerCase().includes(query)
      );
    });
  }, [courseGroups, chatSearchQuery]);

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleSectionExpanded = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleNewChatForAgent = (agentId: string, agentName: string) => {
    // Cleanup any empty threads before creating a new one
    cleanupEmptyThreads();
    const threadId = createThreadForAgent(agentId);
    if (onSelectThread) {
      onSelectThread(threadId, agentId, agentName);
    }
    setView("chat");
  };

  const Item = ({
    icon: Icon,
    label,
    active,
    onClick,
  }: {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cx(
        "group rounded-xl transition-all duration-200 border-0 outline-none focus:outline-none focus-visible:outline-none",
        isCollapsed ? "mx-auto size-10 p-0" : "w-full justify-start gap-3 px-3 py-2.5",
        active
          ? isCollapsed
            ? "bg-white/20 text-white border border-neutral-500/50 hover:bg-white/25"
            : "bg-white/10 text-white border border-neutral-600/50 hover:bg-white/15"
          : isCollapsed
            ? "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white"
            : "text-neutral-200 hover:bg-neutral-800/50 hover:text-white"
      )}
      aria-label={label}
    >
      <Icon className={cx("h-5 w-5 transition-transform duration-200", active ? "!text-white scale-110" : "text-neutral-200 group-hover:text-white")} />
      {!isCollapsed && <span className={cx("text-sm font-medium", active ? "text-white" : "text-inherit")}>{label}</span>}
    </Button>
  );

  return (
    <aside
      className={cx(
        "sticky left-0 top-0 h-dvh shrink-0 border-r border-neutral-800/50 flex flex-col will-change-[width] select-none",
        "transition-all duration-300 ease-in-out",
        isCollapsed ? "w-14 overflow-hidden bg-neutral-900 cursor-pointer" : "w-72 bg-neutral-925"
      )}
      onClick={(e) => {
        if (isCollapsed && (e.target as HTMLElement).closest("button, a") === null) {
          setIsCollapsed(false);
        }
      }}
    >
      {/* Header - Sticky at top, only when expanded */}
      {!isCollapsed && (
        <div className="flex-shrink-0 flex items-center p-3 justify-between pt-4 bg-neutral-925 animate-in fade-in slide-in-from-left-2 duration-200">
          <button
            onClick={() => setView("chat")}
            className="px-2 flex items-center hover:opacity-80 transition-opacity cursor-pointer"
          >
            <span className="text-lg font-bold bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent">
              Shiksha
            </span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsCollapsed(true)}
            className="h-8 w-8 mr-1 rounded-lg bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all duration-200"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Expand button - collapsed only */}
      {isCollapsed && (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setIsCollapsed(false)}
          className="size-10 rounded-xl bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all duration-300 border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 mx-auto mt-4 animate-in fade-in zoom-in-95 duration-200"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Collapsed Navigation - Library & Create teaching assistant icons */}
      {isCollapsed && (
        <nav className="flex flex-col items-center gap-3 mt-3 px-2 animate-in fade-in slide-in-from-left-1 duration-200">
          <Item icon={Library} label="Library" active={view === "library"} onClick={() => setView("library")} />
          <Item icon={Box} label="Assets" active={view === "assets"} onClick={() => setView("assets")} />
          {useUserStore.getState().role !== "student" && (
            <Item icon={PlusCircle} label="Create teaching assistant" active={view === "create"} onClick={() => setView("create")} />
          )}
          {can("page:dashboard") && (
            <Item icon={LayoutDashboard} label="Dashboard" active={location.pathname.startsWith("/dashboard")} onClick={handleOpenDashboard} />
          )}
        </nav>
      )}

      {/* Divider between navigation and chat history - collapsed only */}
      {isCollapsed && (
        <div className="flex justify-center py-3 animate-in fade-in duration-200">
          <div className="w-8 h-px bg-neutral-700/50" />
        </div>
      )}

      {/* Content Area - includes Navigation + Chat History */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 animate-in fade-in slide-in-from-left-2 duration-300">
          {/* Navigation */}
          <nav className="flex flex-col gap-2 mb-2">
            <Item icon={Library} label="Library" active={view === "library"} onClick={() => setView("library")} />
            <Item icon={Box} label="Assets" active={view === "assets"} onClick={() => setView("assets")} />
            {useUserStore.getState().role !== "student" && (
              <Item icon={PlusCircle} label="Create" active={view === "create"} onClick={() => setView("create")} />
            )}
            {can("page:dashboard") && (
              <Item icon={LayoutDashboard} label="Dashboard" active={location.pathname.startsWith("/dashboard")} onClick={handleOpenDashboard} />
            )}
          </nav>

          {/* Chat History - Unified by Course */}
          <div className="space-y-2">
            <div>
              {/* My Courses Header - matching nav items style */}
              <button
                onClick={() => toggleSectionExpanded("history")}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-neutral-800/50 transition-all duration-200 group outline-none focus:outline-none"
              >
                <GraduationCap className="h-4 w-4 text-white" />
                <span className="text-sm font-medium text-neutral-200 group-hover:text-white">My Courses</span>
                <ChevronDown className={cx(
                  "h-4 w-4 text-neutral-500 transition-transform duration-300 ml-auto",
                  !expandedSections.has("history") && "-rotate-90"
                )} />
              </button>

              {expandedSections.has("history") && (
                <div className="mt-1 space-y-1" ref={chatHistoryRef}>
                  {filteredCourseGroups.length > 0 ? (
                    filteredCourseGroups.map((courseGroup) => {
                      const { displayName, primaryProject, allThreads, projects: courseProjects } = courseGroup;
                      if (!primaryProject) return null;
                      
                      const isExpanded = expandedProjects.has(primaryProject.id);
                      const isActiveProject = activeAgentId === primaryProject.agentId;
                      const threadsToShow = showAllChats.has(primaryProject.id) ? allThreads : allThreads.slice(0, 3);

                      return (
                        <div key={primaryProject.id} className="space-y-1">
                          {/* Course Header */}
                          {renamingProjectId === primaryProject.id ? (
                            <form
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800/50"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (renameValue.trim()) {
                                  renameProject(primaryProject.id, renameValue.trim());
                                }
                                setRenamingProjectId(null);
                                setRenameValue("");
                              }}
                            >
                              <Input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => {
                                  if (renameValue.trim()) {
                                    renameProject(primaryProject.id, renameValue.trim());
                                  }
                                  setRenamingProjectId(null);
                                  setRenameValue("");
                                }}
                                className="h-6 text-sm bg-neutral-800 border-neutral-700 text-white px-2 py-0"
                              />
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (onSelectCourse && primaryProject.agentId) {
                                  onSelectCourse(primaryProject.agentId, primaryProject.agentName || primaryProject.name);
                                }
                              }}
                              className={cx(
                                "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer group text-left",
                                isActiveProject ? "bg-neutral-800/70" : "hover:bg-neutral-800/40"
                              )}
                            >
                              <span className="flex-1 text-sm font-medium truncate text-left text-neutral-200" title={displayName}>
                                {displayName}
                              </span>
                            </button>
                          )}

                          {/* Delete Project Confirmation Dialog */}
                          <AlertDialog open={deleteDialogOpen === primaryProject.id} onOpenChange={(open) => !open && setDeleteDialogOpen(null)}>
                            <AlertDialogContent className="bg-neutral-900 border-neutral-800">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Delete Chat History?</AlertDialogTitle>
                                <AlertDialogDescription className="text-neutral-400">
                                  This will permanently delete all chat history for "{displayName}". 
                                  This action cannot be undone. The agent itself will not be deleted.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700">
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    // Delete all projects for this course
                                    courseProjects.forEach(({ project }) => {
                                      deleteProject(project.id);
                                    });
                                    setDeleteDialogOpen(null);
                                  }}
                                  className="bg-red-600 text-white hover:bg-red-700"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      );
                    })
                  ) : chatSearchQuery ? (
                    // No search results
                    <div className="px-3 py-4 text-center">
                      <Search className="h-8 w-8 text-neutral-600 mx-auto mb-2" />
                      <p className="text-xs text-neutral-400">No chats found for "{chatSearchQuery}"</p>
                      <button
                        onClick={() => setChatSearchQuery("")}
                        className="mt-2 text-xs text-neutral-400 hover:text-white"
                      >
                        Clear search
                      </button>
                    </div>
                  ) : courseGroups.length > 0 ? null : (
                    <button
                      onClick={() => setView("library")}
                      className="group w-full px-3 py-3 flex items-center gap-3 rounded-lg border border-dashed border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800/50 text-left transition-all duration-200"
                    >
                      <div className="w-8 h-8 rounded-full bg-neutral-700/50 flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-neutral-400 group-hover:text-neutral-300" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-neutral-400 group-hover:text-neutral-300">No chats yet</p>
                        <p className="text-[10px] text-neutral-400 group-hover:text-neutral-300">Browse Agent Library</p>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>


        </div>
      )}
      {isCollapsed && (
        <div className="flex flex-col items-center gap-3 px-2">
          {/* My Courses icon */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsCollapsed(false);
              setExpandedSections((prev) => new Set([...prev, "history"]));
            }}
            className="size-10 rounded-xl bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all duration-200 border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            title={courseGroups.length > 0 ? `My Courses (${courseGroups.length})` : "My Courses"}
          >
            <GraduationCap className="h-5 w-5 text-neutral-300" />
          </Button>
        </div>
      )}

      {/* Spacer to push profile to bottom in collapsed mode */}
      {isCollapsed && <div className="flex-1" />}

      {/* Bottom Section - User Profile with Dropdown - Fixed at bottom */}
      <div className={cx(
        "flex-shrink-0 p-1.5",
        isCollapsed ? "flex flex-col items-center px-2 py-1.5 bg-neutral-900" : "border-t border-white/[0.08] bg-neutral-925"
      )}>
        {/* User Profile - always shown since AuthGuard ensures user is authenticated */}
        <DropdownMenu>
          {isCollapsed ? (
            <DropdownMenuTrigger asChild>
              <button
                className="size-10 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold hover:opacity-90 transition-opacity outline-none focus:outline-none"
                title="User Menu"
              >
                {(() => {
                  const displayName = user?.displayName || userName;
                  const parts = displayName.trim().split(/\s+/);
                  return parts.length >= 2 
                    ? (parts[0][0] + parts[1][0]).toUpperCase() 
                    : displayName.slice(0, 2).toUpperCase();
                })()}
              </button>
            </DropdownMenuTrigger>
          ) : (
            <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-neutral-200 relative">
              <button
                onClick={() => setUserInfoOpen(!userInfoOpen)}
                className="flex items-center gap-3 flex-1 min-w-0 outline-none focus:outline-none hover:opacity-80 transition-opacity"
              >
                <div className="size-8 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold flex-shrink-0">
                  {(() => {
                    const displayName = user?.displayName || userName;
                    const parts = displayName.trim().split(/\s+/);
                    return parts.length >= 2 
                      ? (parts[0][0] + parts[1][0]).toUpperCase() 
                      : displayName.slice(0, 2).toUpperCase();
                  })()}
                </div>
                <span className="flex-1 text-sm font-medium truncate text-left">{user?.displayName || userNickname || userName.split(" ")[0] || userName}</span>
              </button>
              <DropdownMenuTrigger asChild>
                <button className="relative p-1 rounded-md hover:bg-neutral-700 transition-colors outline-none focus:outline-none" title={updateReady ? "Update available" : "User Menu"}>
                  <MoreHorizontal className={`h-5 w-5 ${updateReady ? "text-emerald-400" : "text-neutral-400"}`} />
                  {updateReady && (
                    <span className="absolute right-0 top-0 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              {/* User Info Popup */}
              {userInfoOpen && (
                <div ref={userInfoRef} className="absolute bottom-full left-0 right-0 mb-2 bg-neutral-900 border border-neutral-700/50 rounded-xl shadow-xl p-3 z-50 overflow-hidden">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold flex-shrink-0">
                      {(() => {
                        const displayName = user?.displayName || userName;
                        const parts = displayName.trim().split(/\s+/);
                        return parts.length >= 2 
                          ? (parts[0][0] + parts[1][0]).toUpperCase() 
                          : displayName.slice(0, 2).toUpperCase();
                      })()}
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="text-sm font-medium text-neutral-200 truncate" title={user?.displayName || userName}>{user?.displayName || userName}</div>
                      {(user?.email || userEmail) && <div className="text-xs text-neutral-500 truncate" title={user?.email || userEmail || ""}>{user?.email || userEmail}</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <DropdownMenuContent
            side={isCollapsed ? "right" : "top"}
            align={isCollapsed ? "center" : "start"}
            className="w-60 bg-neutral-900 border-neutral-700/50 shadow-2xl rounded-xl p-1.5"
          >
            {/* Account Section */}
            <DropdownMenuItem 
              className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg"
              onSelect={() => navigate("/settings")}
            >
              <Settings className="h-4 w-4 mr-3 text-neutral-400" />
              Settings
            </DropdownMenuItem>
            
            <div className="h-px bg-neutral-700/50 my-1.5 mx-2" />
            
            {/* Resources Section */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg">
                <Info className="h-4 w-4 mr-3 text-neutral-400" />
                Learn More
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="bg-neutral-900 border-neutral-700/50 rounded-xl p-1.5 shadow-2xl">
                <DropdownMenuItem
                  className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg"
                  onSelect={() => navigate("/learn")}
                >
                  What is Shiksha?
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg flex justify-between"
                  onSelect={() => window.open("http://go.microsoft.com/fwlink/?LinkId=518021", "_blank")}
                >
                  Data Privacy Notice
                  <ExternalLink className="h-3.5 w-3.5 ml-3 text-neutral-500" />
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg flex justify-between"
                  onSelect={() => window.open("https://go.microsoft.com/fwlink/?LinkId=521839", "_blank")}
                >
                  Privacy & Cookies
                  <ExternalLink className="h-3.5 w-3.5 ml-3 text-neutral-500" />
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg"
                  onSelect={() => {
                    if (typeof window !== 'undefined' && (window as any).siteConsent) {
                      (window as any).siteConsent.manageConsent();
                    }
                  }}
                >
                  Manage Cookies
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg"
              onSelect={() => navigate("/help")}
            >
              <HelpCircle className="h-4 w-4 mr-3 text-neutral-400" />
              Help
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-neutral-200 hover:text-white hover:bg-neutral-800 cursor-pointer py-2.5 px-3 rounded-lg"
              onSelect={() => setFeedbackOpen(true)}
            >
              <MessageSquareMore className="h-4 w-4 mr-3 text-neutral-400" />
              Feedback
            </DropdownMenuItem>
            
            <div className="h-px bg-neutral-700/50 my-1.5 mx-2" />
            
            {updateReady && (
              <DropdownMenuItem
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer py-2.5 px-3 rounded-lg"
                onSelect={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4 mr-3" />
                Update available
              </DropdownMenuItem>
            )}

            {/* Sign out Section */}
            <DropdownMenuItem 
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer py-2.5 px-3 rounded-lg"
              onSelect={() => navigate("/signout")}
            >
              <LogOut className="h-4 w-4 mr-3" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Feedback Dialog */}
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </aside>
  );
}
