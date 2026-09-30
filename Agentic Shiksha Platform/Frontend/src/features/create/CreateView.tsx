// CreateView.tsx – Simplified Creation Flow (creates a single teaching assistant)

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { XCircle, AlertTriangle } from "lucide-react";
import { ManageCodeRevealDialog } from "@/components/ManageCodeDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

import {
  createAgentAsync,
  createMaterialDraft,
  checkAgentNameExists,
  getCourseCreation,
  invalidateAgentCache,
  preflightMaterials,
  retryCourseCreation,
  uploadAgentImage,
  uploadKnowledgeFiles,
  waitForCourseCreation,
  type CreatedCourse,
  type CourseCreationStatus,
  type MaterialJobStatus,
  type MaterialPreflight,
  KBScope,
} from "@/lib/api";
// Model is controlled by backend - no model config imports needed
import { getCourseName } from "@/lib/utils";

import { SetupPhase } from "./SetupPhase";
import { FormAssistant } from "./FormAssistant";
import { MaterialJobPanel, MaterialReviewDialog } from "./MaterialWorkflow";
import type { TextbookEntry } from "./SetupPhase";
import {
  companionUpdatedFields,
  createEmptyCreateForm,
  fileKey,
  formatBytes,
  type CompanionChanges,
} from "./builderTypes";
import { useSetupPhaseLogic } from "./useSetupPhaseLogic";
import { useChatStore } from "@/lib/chatStore";
import { useCurrentUserId, useUserStore } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { useAppContext } from "@/layouts/MainLayout";
import type { CreateFormState } from "@/layouts/MainLayout";

/* ----------------------------- Main Component ----------------------------- */

export function CreateView() {
  const navigate = useNavigate();

  // Students cannot create agents — redirect to library
  const userRole = useUserStore((s) => s.role);
  useEffect(() => {
    if (userRole === "student") {
      navigate("/library", { replace: true });
    }
  }, [userRole, navigate]);

  const appContext = useAppContext();
  
  const {
    vectorStoreId,
    setVectorStoreId,
    setCourseAgentId,
    setCourseAgentName,
  } = appContext;

  // Chat store for creating agent projects
  const { getOrCreateAgentProject, setActiveThread, createThreadForAgent } = useChatStore(
    useShallow((s) => ({
      getOrCreateAgentProject: s.getOrCreateAgentProject,
      setActiveThread: s.setActiveThread,
      createThreadForAgent: s.createThreadForAgent,
    }))
  );

  // Get current userId for agent ownership (normalized design - store userId not username)
  const userId = useCurrentUserId();
  const creatorDisplayName = useUserStore((s) => s.displayName || s.email || "");

  // Reset vector store ID when component mounts
  useEffect(() => {
    setVectorStoreId(null);
  }, []);

  // KB scope for course materials
  const kbScope: KBScope = "course";

  // Setup form state — persisted in AppContext so it survives navigation
  const { createFormState, setCreateFormState } = appContext;
  const sessionUuid = createFormState.sessionUuid;
  const [assistantSession, setAssistantSession] = useState<string | null>(null);
  const [headerContainer, setHeaderContainer] = useState<HTMLDivElement | null>(null);
  const [companionChanges, setCompanionChanges] = useState<CompanionChanges | null>(null);
  const [companionFiles, setCompanionFiles] = useState<{ sessionUuid: string; keys: string[] } | null>(null);
  const assistantOpen = assistantSession === sessionUuid;
  const courseName = createFormState.courseName;
  const courseLevel = createFormState.courseLevel;
  const courseSpan = createFormState.courseSpan;
  const courseNotes = createFormState.courseNotes;
  const courseCode = createFormState.courseCode;
  const prerequisites = createFormState.prerequisites;
  const courseUrls = createFormState.courseUrls;
  const agentImageFile = createFormState.agentImageFile;
  const agentImagePreview = createFormState.agentImagePreview;
  const agentAvatar = createFormState.agentAvatar;

  const updateForm = <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) =>
    setCreateFormState((prev) => ({ ...prev, [key]: value }));

  const setCourseName = (v: string) => updateForm("courseName", v);
  const setCourseLevel = (v: string) => updateForm("courseLevel", v);
  const setCourseSpan = (v: string) => updateForm("courseSpan", v);
  const setCourseNotes = (v: string) => updateForm("courseNotes", v);
  const setCourseCode = (v: string) => updateForm("courseCode", v);
  const setPrerequisites = (v: string[] | ((prev: string[]) => string[])) =>
    setCreateFormState((prev) => ({
      ...prev,
      prerequisites: typeof v === "function" ? v(prev.prerequisites) : v,
    }));
  const setCourseUrls = (v: Array<{ url: string; description?: string }> | ((prev: Array<{ url: string; description?: string }>) => Array<{ url: string; description?: string }>)) =>
    setCreateFormState((prev) => ({
      ...prev,
      courseUrls: typeof v === "function" ? v(prev.courseUrls) : v,
    }));

  // Textbook entries — persisted in AppContext so they survive navigation
  const textbooks = createFormState.textbooks;
  const setTextbooks = (v: typeof textbooks | ((prev: typeof textbooks) => typeof textbooks)) =>
    setCreateFormState((prev) => ({
      ...prev,
      textbooks: typeof v === "function" ? v(prev.textbooks) : v,
    }));

  // Conversation starters — persisted in AppContext so they survive navigation
  const conversationStarters = createFormState.conversationStarters;
  const setConversationStarters = (v: Array<{ title: string; prompt: string }>) =>
    setCreateFormState((prev) => ({ ...prev, conversationStarters: v }));

  // Course description file attachment — persisted in AppContext
  const courseDescFile = createFormState.courseDescFile;
  const setCourseDescFile = (f: File | null) =>
    setCreateFormState((prev) => ({ ...prev, courseDescFile: f }));
  
  const workflowStorageKey = `course-creation-job:${userId}`;
  const isCreating = appContext.isCreatingAgent;
  const setIsCreating = appContext.setIsCreatingAgent;
  const [materialJob, setMaterialJob] = useState<MaterialJobStatus | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(() => localStorage.getItem(workflowStorageKey));
  const [creationStatus, setCreationStatus] = useState<CourseCreationStatus | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [confirmFreshStart, setConfirmFreshStart] = useState(false);
  const [materialRevision, setMaterialRevision] = useState(0);
  const [materialReview, setMaterialReview] = useState<MaterialPreflight | null>(null);
  const reviewDecision = useRef<((confirmed: boolean) => void) | null>(null);
  const creationAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    setPendingJobId(localStorage.getItem(workflowStorageKey));
    setMaterialJob(null);
    setCreationStatus(null);
    setCreationError(null);
    setIsCreating(false);
    return () => {
      reviewDecision.current?.(false);
      creationAbort.current?.abort();
      creationAbort.current = null;
      setIsCreating(false);
    };
  }, [workflowStorageKey]);

  useEffect(() => {
    if (!pendingJobId || isCreating) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const status = await getCourseCreation(pendingJobId, controller.signal);
        if (controller.signal.aborted) return;
        setCreationStatus(status);
        if (status.status === "PENDING" || status.status === "RUNNING" || status.status === "COMPLETED") setCreationError(null);
        if (status.status === "PENDING" || status.status === "RUNNING") timer = setTimeout(check, 2500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setCreationError(error instanceof Error ? error.message : "Saved creation status could not be checked. Retry checking or start a new TA.");
        }
      }
    };
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pendingJobId, isCreating, workflowStorageKey]);

  const completeCreation = (result: CreatedCourse) => {
    setCourseAgentId(result.agent_id);
    setCourseAgentName(result.name);
    getOrCreateAgentProject(result.agent_id, result.name, "course");
    invalidateAgentCache();
    const newThreadId = createThreadForAgent(result.agent_id, "New Chat");
    setActiveThread(newThreadId);
    const navUrl = `/chat/${encodeURIComponent(getCourseName(result.name))}/${newThreadId}`;
    setCreatedCourseName(getCourseName(result.name));
    setManageCodeToShow(result.manage_code);
    setPendingNavUrl(navUrl);
    localStorage.removeItem(workflowStorageKey);
    setPendingJobId(null);
    setCreationStatus(null);
    setCreationError(null);
    setMaterialJob(null);
    if (result.materials_status === "failed") {
      toast.warning("TA created, but some materials need attention. Retry them in Edit TA.");
    } else {
      toast.success(result.knowledge_pending ? "TA created. Materials are still processing." : "TA created. Materials ready.");
    }
    setCreateFormState(createEmptyCreateForm());
  };

  const resumeCreation = async () => {
    if (!pendingJobId || isCreating) return;
    setIsCreating(true);
    setCreationError(null);
    const controller = new AbortController();
    creationAbort.current = controller;
    try {
      const status = await getCourseCreation(pendingJobId, controller.signal);
      controller.signal.throwIfAborted();
      setCreationStatus(status);
      if (status.status === "NOT_STARTED") {
        setCreationError(status.error || "TA creation was not submitted. Return to the form to submit it.");
        return;
      }
      if (status.status === "FAILED") {
        const retried = await retryCourseCreation(pendingJobId);
        controller.signal.throwIfAborted();
        setCreationStatus(retried);
        setMaterialRevision(value => value + 1);
      }
      const result = status.status === "COMPLETED" && status.result
        ? status.result
        : await waitForCourseCreation(pendingJobId, setCreationStatus, controller.signal);
      controller.signal.throwIfAborted();
      completeCreation(result);
    } catch (error) {
      if (!controller.signal.aborted) setCreationError(error instanceof Error ? error.message : "TA creation could not be resumed.");
    } finally {
      if (creationAbort.current === controller) {
        creationAbort.current = null;
        setIsCreating(false);
      }
    }
  };

  const leaveSavedCreation = (startFresh: boolean) => {
    creationAbort.current?.abort();
    creationAbort.current = null;
    localStorage.removeItem(workflowStorageKey);
    setPendingJobId(null);
    setCreationStatus(null);
    setCreationError(null);
    setIsCreating(false);
    setConfirmFreshStart(false);
    if (startFresh) {
      if (agentImagePreview) URL.revokeObjectURL(agentImagePreview);
      setMaterialJob(null);
      setKbFileDescriptions({});
      setCompanionChanges(null);
      setCompanionFiles(null);
      setAssistantSession(null);
      setCreateFormState(createEmptyCreateForm());
    }
  };

  // Manage code reveal dialog state
  const [manageCodeToShow, setManageCodeToShow] = useState<string | null>(null);
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null);
  const [createdCourseName, setCreatedCourseName] = useState("");

  // Model is fully controlled by backend (AZURE_AI_AGENT_MODEL_DEPLOYMENT env var)

  // Handle image selection - create preview URL
  const handleSelectAgentImage = (file: File) => {
    if (agentImagePreview?.startsWith("blob:")) URL.revokeObjectURL(agentImagePreview);
    const preview = URL.createObjectURL(file);
    setCreateFormState((prev) => ({
      ...prev,
      agentImageFile: file,
      agentImagePreview: preview,
    }));
  };

  // Clear image
  const handleClearAgentImage = () => {
    if (agentImagePreview) {
      URL.revokeObjectURL(agentImagePreview);
    }
    setCreateFormState((prev) => ({
      ...prev,
      agentImageFile: null,
      agentImagePreview: null,
    }));
  };

  /* --------- Setup-phase logic (KB file uploads) --------- */

  const {
    kbUploads,
    onSelectKbUploads,
    onRemoveUpload,
    kbFiles,
    loadingKbFiles,
    kbFilesError,
    fileToDelete,
    setFileToDelete,
    isDeletingFile,
    handleDeleteKbFile,
  } = useSetupPhaseLogic({
    sessionUuid,
    kbScope,
    phase: "setup",
    setPhase: () => {},
    agentKind: "course",
    vectorStoreId,
    setVectorStoreId,
    courseName,
    courseLevel,
    courseSpan,
    courseNotes,
    isBuilderSending: false,
    setIsBuilderSending: () => {},
    setLacaPreviewSynced: () => {},
    tcThreadId: null,
    ecaThreadId: null,
    setTcThreadId: () => {},
    setEcaThreadId: () => {},
    setTcaMessages: () => {},
    setExamMessages: () => {},
    setGeneratedDocs: () => {},
    initialKbUploads: createFormState.kbUploads,
  });

  // Sync kbUploads back to AppContext so they persist across navigation
  useEffect(() => {
    setCreateFormState((prev) => {
      if (prev.kbUploads === kbUploads) return prev;
      return { ...prev, kbUploads };
    });
  }, [kbUploads]);

  // File descriptions for additional course materials
  const [kbFileDescriptions, setKbFileDescriptions] = useState<Record<string, string>>({});

  /* --------- Agent creation (creates a single teaching assistant with parallel processing) --------- */

  async function handleCreateAgent() {
    if (isCreating || pendingJobId) return;
    if (!courseName.trim()) {
      toast(
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
            <XCircle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-medium text-neutral-100 truncate">Validation Error</span>
            <span className="text-sm text-neutral-400 truncate">Please enter a course name</span>
          </div>
        </div>,
        { duration: 4000 }
      );
      return;
    }

    // Single teaching assistant name with "course-" prefix
    const courseAgentName = `course-${courseName.trim()}`;

    setIsCreating(true);
    setCreationError(null);
    const controller = new AbortController();
    creationAbort.current = controller;

    try {
      // Check if agent name already exists
      const agentExists = await checkAgentNameExists(courseAgentName);
      
      if (agentExists) {
        toast(
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-medium text-neutral-100 truncate">{courseName}</span>
              <span className="text-sm text-neutral-400 truncate">Agent already exists. Choose a different name.</span>
            </div>
          </div>,
          { duration: 4000 }
        );
        setIsCreating(false);
        return;
      }

      const textbookFiles = textbooks.filter((tb) => tb.file).map((tb) => tb.file!);
      const files = [...kbUploads, ...textbookFiles];
      if (files.length) {
        const report = await preflightMaterials(files, controller.signal);
        setMaterialReview(report);
        const confirmed = await new Promise<boolean>(resolve => { reviewDecision.current = resolve; });
        reviewDecision.current = null;
        setMaterialReview(null);
        if (!confirmed || !report.accepted) return;
      }
      controller.signal.throwIfAborted();
      const draft = await createMaterialDraft(sessionUuid);
      const materialSession = draft.session_uuid;
      setMaterialJob(draft);
      const finalIndexName = draft.index_name;
      for (const [scope, selected] of [["course", kbUploads], ["textbook", textbookFiles]] as const) {
        for (const file of selected) {
          controller.signal.throwIfAborted();
          setMaterialJob(await uploadKnowledgeFiles(materialSession, [file], scope));
        }
      }

      // Build additionalContext: combine typed courseNotes with attached file content
      let additionalContext = courseNotes;
      if (courseDescFile) {
        try {
          const { extractTextFromDocument } = await import("@/lib/api");
          const extraction = await extractTextFromDocument(courseDescFile);
          if (extraction.success && extraction.extracted_text) {
            additionalContext = additionalContext
              ? `${additionalContext}\n\n--- Attached File: ${courseDescFile.name} ---\n${extraction.extracted_text}`
              : extraction.extracted_text;
            console.log(`Extracted ${extraction.extracted_text.length} chars from ${courseDescFile.name}`);
          } else {
            console.warn("Document extraction failed:", extraction.error);
          }
        } catch (err) {
          console.warn("Could not extract text from course description file:", err);
        }
      }

      // Append KB file descriptions so the research pipeline knows what each uploaded file contains
      const fileDescEntries = Object.entries(kbFileDescriptions).filter(([, v]) => v.trim());
      if (fileDescEntries.length > 0) {
        const fileDescSection = fileDescEntries
          .map(([name, desc]) => `- ${name}: ${desc}`)
          .join("\n");
        additionalContext = additionalContext
          ? `${additionalContext}\n\n--- Course Material File Descriptions ---\n${fileDescSection}`
          : `--- Course Material File Descriptions ---\n${fileDescSection}`;
      }

      // Append course URL descriptions so the research pipeline knows what each URL is for
      const urlDescEntries = courseUrls.filter((u) => u.description);
      if (urlDescEntries.length > 0) {
        const urlDescSection = urlDescEntries
          .map((u) => `- ${u.url}: ${u.description}`)
          .join("\n");
        additionalContext = additionalContext
          ? `${additionalContext}\n\n--- Course URL Descriptions ---\n${urlDescSection}`
          : `--- Course URL Descriptions ---\n${urlDescSection}`;
      }

      controller.signal.throwIfAborted();
      localStorage.setItem(workflowStorageKey, draft.job_id);
      setPendingJobId(draft.job_id);
      const result = await createAgentAsync({
        kind: "course",
        name: courseAgentName,
        description: `Course assistant for ${courseName}`,
        courseName,
        courseLevel,
        courseDuration: courseSpan,
        additionalContext,
        courseCode: courseCode || undefined,
        prerequisites: prerequisites.length > 0 ? prerequisites : undefined,
        createdById: userId,
        createdByName: creatorDisplayName,
        agentAvatar,
        // Knowledge params - pass index name so backend attaches MCPTool
        sessionUuid: materialSession,
        kbScope: "course",  // For Cosmos DB metadata only
        indexName: finalIndexName ?? undefined,
        // Teacher-curated URLs for focused web search
        courseUrls: courseUrls.length > 0 ? courseUrls.map((u) => u.url) : undefined,
        // Textbook metadata for course curriculum research
        textbooks: textbooks.map((tb) => ({
          name: tb.name,
          edition: tb.edition,
          authors: tb.authors || [],
          type: tb.type,
          description: tb.description || "",
        })),
        conversationStarters: conversationStarters.filter(starter => starter.prompt.trim()),
      }, status => {
        if (controller.signal.aborted) return;
        localStorage.setItem(workflowStorageKey, status.job_id);
        setPendingJobId(status.job_id);
        setCreationStatus(status);
      }, controller.signal);

      // NOTE: No need to attach exam index separately anymore!
      // The unified index already covers both course and exam materials.

      // Upload agent image to Azure Blob Storage if selected
      // This is done AFTER agent creation so we have the agent_id
      let agentImageUrl: string | null = null;
      if (agentImageFile) {
        try {
          console.log("Uploading agent image to blob storage");
          const uploadResult = await uploadAgentImage(result.agent_id, agentImageFile);
          agentImageUrl = uploadResult.imageUrl;
          console.log("Agent image uploaded:", agentImageUrl);
        } catch (error: any) {
          console.error("Failed to upload agent image:", error);
          // Don't fail agent creation if image upload fails
          toast(
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-neutral-100 truncate">{courseName}</span>
                <span className="text-sm text-neutral-400 truncate">Agent image upload failed</span>
              </div>
            </div>,
            { duration: 4000 }
          );
        }
      }

      controller.signal.throwIfAborted();
      completeCreation(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        setCreationError(error instanceof Error ? error.message : "TA creation failed. Your saved progress has been kept.");
      }
    } finally {
      if (creationAbort.current === controller) {
        creationAbort.current = null;
        setIsCreating(false);
      }
    }
  }

  /* ===================== Render ===================== */

  return (
    <>
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div ref={setHeaderContainer} role="region" aria-label="Course builder header" className="w-full shrink-0" />
    {pendingJobId ? (
      <Dialog key={`${workflowStorageKey}:${pendingJobId}`} defaultOpen>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3 text-sm">
          <p className="text-neutral-400">View your saved creation to resume or start a new TA.</p>
          <DialogTrigger asChild>
            <button type="button" className="shrink-0 rounded-md border border-neutral-600 px-3 py-2 text-neutral-100 hover:bg-neutral-800">View saved creation</button>
          </DialogTrigger>
        </div>
        <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-xl border-neutral-700 bg-neutral-900 p-0 text-neutral-100">
          <section aria-label="TA creation recovery" className="flex min-h-0 flex-col text-sm">
            <DialogHeader className="shrink-0 px-5 py-5 pr-12 text-left">
              <DialogTitle>{creationStatus?.status === "FAILED" ? "TA creation needs attention" : creationStatus?.status === "COMPLETED" ? "TA created" : creationStatus?.status === "NOT_STARTED" ? "TA creation not submitted" : "Saved TA creation"}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
              {creationStatus?.course_name && <p className="break-words font-medium text-neutral-200">{creationStatus.course_name}</p>}
              <DialogDescription className="text-neutral-400">
                {creationStatus?.status === "NOT_STARTED"
                  ? "No TA creation request was saved. Return to the form to submit again, or start fresh. Uploaded files have not been deleted."
                  : "Your saved progress and uploads are kept. Resume this job without uploading again, or start a separate TA."}
              </DialogDescription>
              {(creationError || creationStatus?.error) && <p role="alert" className="break-words text-amber-300">{creationError || creationStatus?.error}</p>}
              <MaterialJobPanel key={`${pendingJobId}:${materialRevision}`} jobId={pendingJobId} initialStatus={materialJob} showCreationStatus={false} />
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t border-neutral-800 px-5 py-4 sm:space-x-0">
              <button type="button" onClick={() => setConfirmFreshStart(true)} className="rounded-md border border-neutral-600 px-3 py-2 hover:bg-neutral-800">Start a new TA</button>
              {creationStatus?.status === "NOT_STARTED"
                ? <button type="button" onClick={() => leaveSavedCreation(false)} className="rounded-md bg-white px-3 py-2 font-medium text-neutral-900 hover:bg-neutral-200">Return to form</button>
                : <button type="button" disabled={isCreating} onClick={() => void resumeCreation()} className="rounded-md bg-white px-3 py-2 font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50">
                  {isCreating ? "Checking creation..." : creationStatus?.status === "FAILED" ? "Retry creation" : creationStatus?.status === "COMPLETED" ? "Open TA" : "Resume creation"}
                </button>}
            </DialogFooter>
          </section>
        </DialogContent>
      </Dialog>
    ) : <>
      {creationError && <p role="alert" className="shrink-0 break-words border-b border-neutral-700 px-4 py-3 text-sm text-amber-300">{creationError}</p>}
      <MaterialJobPanel key={`${workflowStorageKey}:${materialJob?.job_id}:${materialRevision}`} jobId={materialJob?.job_id || null} initialStatus={materialJob} />
    </>}
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div role="region" aria-label="Course form" inert={!!pendingJobId} className={`min-h-0 min-w-0 flex-1 ${assistantOpen && !pendingJobId ? "hidden lg:block" : ""} ${pendingJobId ? "opacity-50" : ""}`}>
    <SetupPhase
      key={sessionUuid}
      mode="create"
      hideButton={!!pendingJobId}
      headerContainer={headerContainer}
      companionUpdatedFields={[
        ...companionUpdatedFields(createFormState, companionChanges),
        ...(companionFiles?.sessionUuid === sessionUuid && kbUploads.some(file => companionFiles.keys.includes(fileKey(file))) ? ["kbUploads" as const] : []),
      ]}
      kind="course"
      isReturningFromBuilder={false}
      courseName={courseName}
      setCourseName={setCourseName}
      courseLevel={courseLevel}
      setCourseLevel={setCourseLevel}
      courseSpan={courseSpan}
      setCourseSpan={setCourseSpan}
      courseNotes={courseNotes}
      setCourseNotes={setCourseNotes}
      courseCode={courseCode}
      setCourseCode={setCourseCode}
      prerequisites={prerequisites}
      setPrerequisites={setPrerequisites}
      // Course materials
      courseUrls={courseUrls}
      setCourseUrls={setCourseUrls}
      kbUploads={kbUploads}
      onSelectKbUploads={onSelectKbUploads}
      onRemoveUpload={onRemoveUpload}
      // Textbook entries
      textbooks={textbooks}
      onAddTextbook={(entry) => setTextbooks((prev) => [...prev, entry])}
      onRemoveTextbook={(id) => setTextbooks((prev) => prev.filter((tb) => tb.id !== id))}
      // Course description file attachment
      courseDescFile={courseDescFile}
      onCourseDescFile={setCourseDescFile}
      // Shared
      fileKey={fileKey}
      formatBytes={formatBytes}
      kbFiles={kbFiles}
      loadingKbFiles={loadingKbFiles}
      kbFilesError={kbFilesError}
      fileToDelete={fileToDelete}
      setFileToDelete={setFileToDelete}
      isDeletingFile={isDeletingFile}
      handleDeleteKbFile={handleDeleteKbFile}
      vectorStoreId={vectorStoreId}
      isSetupActionLoading={isCreating}
      handleSetupPrimaryAction={handleCreateAgent}
      onSave={undefined}
      createsBothAgents={true}
      // File descriptions
      kbFileDescriptions={kbFileDescriptions}
      setKbFileDescriptions={setKbFileDescriptions}
      // Agent image
      agentImagePreview={agentImagePreview}
      onSelectAgentImage={handleSelectAgentImage}
      onClearAgentImage={handleClearAgentImage}
      agentAvatar={agentAvatar}
      onChangeAgentAvatar={value => updateForm("agentAvatar", value)}
      // Conversation starters
      conversationStarters={conversationStarters}
      setConversationStarters={setConversationStarters}
    />
    </div>

    {userRole !== "student" && !pendingJobId && (
      <FormAssistant
        key={`${userId}:${sessionUuid}`}
        form={createFormState}
        setForm={setCreateFormState}
        userId={userId}
        onAddCourseFiles={files => {
          onSelectKbUploads(files);
          setCompanionFiles({ sessionUuid, keys: files.map(fileKey) });
        }}
        onChanges={changes => {
          setCompanionChanges(changes);
          if (!changes) setCompanionFiles(null);
        }}
        disabled={isCreating || !!manageCodeToShow}
        open={assistantOpen}
        onOpenChange={open => {
          if (open && window.innerWidth < 1024) window.dispatchEvent(new Event("sidebar-collapse"));
          setAssistantSession(open ? sessionUuid : null);
        }}
      />
    )}
    </div>
    </div>

    <MaterialReviewDialog report={materialReview} onClose={() => reviewDecision.current?.(false)} onConfirm={() => reviewDecision.current?.(true)} />
    <AlertDialog open={confirmFreshStart} onOpenChange={setConfirmFreshStart}>
      <AlertDialogContent className="max-h-[85dvh] w-[calc(100%_-_2rem)] overflow-y-auto border-neutral-700 bg-neutral-900 text-neutral-100">
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new TA?</AlertDialogTitle>
          <AlertDialogDescription className="text-neutral-300">
            This clears the saved creation link and form in this browser. It does not delete the previous job or uploaded files.
            Work already running on the server may still finish. Use a different course name for the new TA.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep saved creation</AlertDialogCancel>
          <AlertDialogAction onClick={() => leaveSavedCreation(true)}>Start fresh</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {/* Manage Code Reveal Dialog – shown after agent creation */}
    <ManageCodeRevealDialog
      code={manageCodeToShow ?? ""}
      courseName={createdCourseName}
      open={!!manageCodeToShow}
      onClose={() => {
        setManageCodeToShow(null);
        if (pendingNavUrl) {
          navigate(pendingNavUrl);
          setPendingNavUrl(null);
        }
      }}
    />
    </>
  );
}
