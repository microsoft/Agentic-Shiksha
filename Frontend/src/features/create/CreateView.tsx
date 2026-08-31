// CreateView.tsx – Simplified Creation Flow (creates a single teaching assistant)

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { XCircle, AlertTriangle } from "lucide-react";
import { ManageCodeRevealDialog } from "@/components/ManageCodeDialog";

import {
  createAgentAsync,
  checkAgentNameExists,
  invalidateAgentCache,
  uploadAgentImage,
  saveAgentSetupDetails,
  KBScope,
} from "@/lib/api";
// Model is controlled by backend - no model config imports needed
import { getCourseName } from "@/lib/utils";

import { SetupPhase } from "./SetupPhase";
import type { TextbookEntry } from "./SetupPhase";
import {
  fileKey,
  formatBytes,
} from "./builderTypes";
import { useSetupPhaseLogic } from "./useSetupPhaseLogic";
import { useChatStore } from "@/lib/chatStore";
import { useCurrentUserId, useUserStore } from "@/lib/userStore";
import { useShallow } from "zustand/react/shallow";
import { useAppContext } from "@/layouts/MainLayout";
import type { CreateFormState } from "@/layouts/MainLayout";
import { FIXED_FIRST_STARTER } from "@/lib/starters";

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
    sessionUuid,
    selectedModel,
    setSelectedModel,
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
  const courseName = createFormState.courseName;
  const courseLevel = createFormState.courseLevel;
  const courseSpan = createFormState.courseSpan;
  const courseNotes = createFormState.courseNotes;
  const courseCode = createFormState.courseCode;
  const prerequisites = createFormState.prerequisites;
  const courseUrls = createFormState.courseUrls;
  const agentImageFile = createFormState.agentImageFile;
  const agentImagePreview = createFormState.agentImagePreview;

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
  
  // Azure AI Search index name
  const [indexName, setIndexName] = useState<string | null>(null);

  // Manage code reveal dialog state
  const [manageCodeToShow, setManageCodeToShow] = useState<string | null>(null);
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null);
  const [createdCourseName, setCreatedCourseName] = useState("");

  // Model is fully controlled by backend (AZURE_AI_AGENT_MODEL_DEPLOYMENT env var)

  // Handle image selection - create preview URL
  const handleSelectAgentImage = (file: File) => {
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

  // Creation state — lifted to AppContext so it persists across navigation
  const isCreating = appContext.isCreatingAgent;
  const setIsCreating = appContext.setIsCreatingAgent;

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

      // Upload course knowledge base files first (if any)
      // This puts files in blob storage for the indexer to pick up
      let finalIndexName: string | null = null;
      
      // MCP PIPELINE APPROACH: Upload files, create index + Knowledge Base + MCP connection
      const hasKbFiles = kbUploads.length > 0;
      const textbookFiles = textbooks.filter((tb) => tb.file).map((tb) => tb.file!);
      const hasTextbookFiles = textbookFiles.length > 0;
      
      if (hasKbFiles || hasTextbookFiles) {
        try {
          const { uploadKnowledgeFiles, createMcpPipeline } = await import("@/lib/api");
          
          // Step 1: Upload course material files to blob storage
          if (hasKbFiles) {
            await uploadKnowledgeFiles(
              sessionUuid,
              kbUploads,
              "course",
              undefined,
              Object.keys(kbFileDescriptions).length > 0 ? kbFileDescriptions : undefined
            );
            console.log("Course files uploaded to blob storage");
          }
          
          // Step 2: Upload textbook PDFs to blob storage (separate partition)
          if (hasTextbookFiles) {
            await uploadKnowledgeFiles(
              sessionUuid,
              textbookFiles,
              "textbook",
              undefined
            );
            console.log("Textbook files uploaded to blob storage");
          }

          // Step 3: Create FULL MCP Pipeline (Index + Knowledge Source + Knowledge Base + Project Connection)
          // This enables the agent to use MCPTool for agentic retrieval
          // Pass all teacher-curated URLs to create Web Knowledge Source
          const allTeacherUrls = courseUrls.map((u) => u.url);
          console.log("Creating MCP pipeline for session:", sessionUuid, "with URLs:", allTeacherUrls);
          
          // Retry pipeline creation up to 3 times with increasing delays
          const COMMON_INDEX_FALLBACK = "course-material-common-index-v1";
          let pipelineOk = false;
          for (let attempt = 1; attempt <= 3 && !pipelineOk; attempt++) {
            try {
              if (attempt > 1) {
                console.log(`MCP Pipeline retry attempt ${attempt}/3, waiting ${attempt * 3}s...`);
                await new Promise((r) => setTimeout(r, attempt * 3000));
              }
              const pipelineResult = await createMcpPipeline(sessionUuid, allTeacherUrls);
              if (pipelineResult.ok && pipelineResult.index_name) {
                finalIndexName = pipelineResult.index_name;
                setIndexName(pipelineResult.index_name);
                pipelineOk = true;
                console.log("MCP Pipeline created:", {
                  index: pipelineResult.index_name,
                  filter: pipelineResult.session_filter,
                });
              } else {
                console.warn(`MCP Pipeline attempt ${attempt} returned not-ok:`, pipelineResult);
              }
            } catch (retryErr) {
              console.warn(`MCP Pipeline attempt ${attempt} failed:`, retryErr);
            }
          }
          
          if (!pipelineOk) {
            // All retries exhausted — use the known index name as fallback.
            // The indexer runs on a schedule and will pick up the uploaded files automatically.
            console.warn("MCP Pipeline failed after 3 attempts, using fallback index name:", COMMON_INDEX_FALLBACK);
            finalIndexName = COMMON_INDEX_FALLBACK;
            setIndexName(COMMON_INDEX_FALLBACK);
            toast(
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-neutral-100 truncate">{courseName || "Course"}</span>
                  <span className="text-sm text-neutral-400 truncate">Knowledge base indexing in progress — files will be searchable shortly</span>
                </div>
              </div>,
              { duration: 5000 }
            );
          }
        } catch (error: any) {
          // File upload itself failed (steps 1-2) — this is a hard failure
          console.error("File upload error:", error);
          toast(
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                <XCircle className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-neutral-100 truncate">{courseName || "Course"}</span>
                <span className="text-sm text-neutral-400 truncate">Failed to upload files — please try again</span>
              </div>
            </div>,
            { duration: 5000 }
          );
          setIsCreating(false);
          return;
        }
      }
      // Model is controlled by backend (AZURE_AI_AGENT_MODEL_DEPLOYMENT env var)
      console.log("Creating agent with MCP Knowledge Base, index:", finalIndexName);

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
        // Knowledge params - pass index name so backend attaches MCPTool
        sessionUuid: sessionUuid,
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
      });

      console.log("Agent created:", result);

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

      // Set the teaching assistant as the active one
      setCourseAgentId(result.agent_id);
      setCourseAgentName(result.name);

      // Save conversation starters to setup details
      const nonEmptyStarters = conversationStarters.filter(s => s.prompt.trim());
      if (nonEmptyStarters.length > 0) {
        try {
          await saveAgentSetupDetails({
            agentId: result.agent_id,
            agentKind: "course",
            courseName,
            courseLevel,
            courseDuration: courseSpan,
            additionalContext: courseNotes,
            courseCode: courseCode || undefined,
            prerequisites: prerequisites.length > 0 ? prerequisites : undefined,
            textbooks,
            vectorStoreId: finalIndexName,
            knowledgeUrls: courseUrls.length > 0 ? courseUrls : undefined,
            conversationStarters: nonEmptyStarters,
            sessionUuid,
          });
        } catch (e) {
          console.warn("Failed to save conversation starters:", e);
        }
      }
      
      // Create project in the chat store
      getOrCreateAgentProject(result.agent_id, result.name, "course");
      
      // Invalidate agent cache so Library view refreshes
      invalidateAgentCache();
      
      // Create a new thread for the agent and set it as active
      const newThreadId = createThreadForAgent(result.agent_id, "New Chat");
      setActiveThread(newThreadId);
      
      // Navigate to the chat view with the new agent
      const courseNameForUrl = getCourseName(result.name);
      const navUrl = `/chat/${encodeURIComponent(courseNameForUrl)}/${newThreadId}`;

      // If a manage code was returned, show it before navigating
      if (result.manage_code) {
        setCreatedCourseName(courseName);
        setManageCodeToShow(result.manage_code);
        setPendingNavUrl(navUrl);
      } else {
        navigate(navUrl);
      }

      // Reset form state for next creation
      setCreateFormState({
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
      });
    } catch (error: any) {
      toast(
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
            <XCircle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-medium text-neutral-100 truncate">{courseName || "Agent"}</span>
            <span className="text-sm text-neutral-400 truncate">Failed to create agent</span>
          </div>
        </div>,
        { duration: 4000 }
      );
    } finally {
      setIsCreating(false);
    }
  }

  /* ===================== Render ===================== */

  return (
    <>
    <SetupPhase
      mode="create"
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
      // Conversation starters
      conversationStarters={conversationStarters}
      setConversationStarters={setConversationStarters}
    />

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
