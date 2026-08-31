// EditView.tsx – Agent Editing with Simplistic and Advanced modes

import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { applyNameGuard } from "@/lib/nameGuard";
import ReactMarkdown from "react-markdown";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  fetchAgentSetupDetails,
  saveAgentSetupDetails,
  attachKnowledgeToAgent,
  regenerateAndUpdateAgent,
  uploadAgentImage,
  deleteAgentImage,
  invalidateAgentCache,
  absoluteBackendUrl,
  ccaStart,
  ccaStep,
  cacaExamStart,
  cacaExamStep,
  KBScope,
  simpleStreamChat,
  listAzureAgents,
} from "@/lib/api";
import { getCourseName } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/config";
import { useCurrentUserId } from "@/lib/userStore";

import { SetupPhase } from "../create/SetupPhase";
import type { TextbookEntry } from "../create/SetupPhase";
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import { LoadingButton } from "../create/sharedUI";
import { KICKER, FIELD, LABEL as LABEL_CLASS } from "../create/designSystem";
import {
  AgentKind,
  fileKey,
  formatBytes,
  DEFAULT_TEMP_INSTRUCTIONS,
} from "../create/builderTypes";
import { useSetupPhaseLogic } from "../create/useSetupPhaseLogic";
import type { BuilderChatMsg, GeneratedDoc } from "../create/markdownUtils";
import { pushAssistantReplyWithOptionalDoc } from "../create/markdownUtils";
import type { ChatMsg } from "@/features/chat/ChatPane";
import {
  Loader2,
  CheckCircle2,
  FileText,
  X,
  Settings2,
  MessageSquare,
  BookOpen,
  FileEdit,
  Layers,
  Zap,
  Download,
  Trash2,
  Eye,
  ArrowLeft,
} from "lucide-react";
import { DarkFileInput } from "@/components/common/DarkFileInput";
import { IconButton } from "../create/sharedUI";
import { useAppContext } from "@/layouts/MainLayout";
import { applyFixedFirstStarter } from "@/lib/starters";

type EditMode = "simplistic" | "advanced";
type AdvancedTab = "chat" | "configure" | "preview";

type EditViewProps = {
  sessionUuid: string;
  agentId: string;
  agentKind: AgentKind;
  editMode: EditMode;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  vectorStoreId: string | null;
  setVectorStoreId: (v: string | null) => void;
  onSaveComplete: () => void; // Navigate back to library
  onViewEnter?: () => void; // Called when entering edit view
  onModeChange?: (mode: EditMode) => void; // Called when user wants to switch mode
};

export function EditView() {
  const navigate = useNavigate();
  const params = useParams<{ courseName: string }>();
  const appContext = useAppContext();
  const currentUserId = useCurrentUserId();
  
  const {
    sessionUuid,
    selectedModel,
    setSelectedModel,
    vectorStoreId,
    setVectorStoreId,
    editingAgentKind: agentKind,
    editMode,
    setEditMode,
    setEditingAgentId,
    editingAgentId,
  } = appContext;

  // Resolve agent ID from URL courseName when editingAgentId is missing (e.g. page refresh)
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const courseNameFromUrl = params.courseName ? decodeURIComponent(params.courseName) : null;

  useEffect(() => {
    if (editingAgentId) {
      // Already have an agent ID from context — no resolution needed
      setResolvedAgentId(null);
      return;
    }
    if (!courseNameFromUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const agents = await listAzureAgents();
        const urlLower = courseNameFromUrl.toLowerCase();
        const normalizedName = `course-${urlLower.replace(/\s+/g, "-")}`;

        // Prefer exact match, fall back to startsWith for long/truncated names.
        // Avoid loose substring (includes) which can match the wrong agent.
        let match = agents.find((a) => {
          const aName = a.name.toLowerCase();
          const aCourseName = getCourseName(a.name).toLowerCase();
          return (
            aName === normalizedName ||
            aCourseName === urlLower
          );
        });
        // Fallback: startsWith for long course names that may be truncated in the URL
        if (!match && urlLower.length >= 10) {
          match = agents.find((a) => {
            const aCourseName = getCourseName(a.name).toLowerCase();
            return aCourseName.startsWith(urlLower) || urlLower.startsWith(aCourseName);
          });
        }

        if (!cancelled && match) {
          setResolvedAgentId(match.id);
          setEditingAgentId(match.id);
        } else if (!cancelled) {
          toast.error("Agent not found for this course. Redirecting to library.");
          navigate("/library");
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[EditView] Failed to resolve agent from URL:", err);
          toast.error("Failed to find agent. Redirecting to library.");
          navigate("/library");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [editingAgentId, courseNameFromUrl]);

  // Agent ID comes from context, or resolved from URL
  const agentId = editingAgentId || resolvedAgentId || "";
  
  const onSaveComplete = () => {
    setEditingAgentId(null);
    // Land on the agent that was just edited so the changes are visible immediately.
    navigate(courseNameFromUrl ? `/course/${encodeURIComponent(courseNameFromUrl)}` : "/library");
  };
  
  const onModeChange = (mode: EditMode) => {
    setEditMode(mode);
  };

  // Loading state for initial fetch (starts false; set true when load begins)
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // File descriptions for additional course materials
  const [kbFileDescriptions, setKbFileDescriptions] = useState<Record<string, string>>({});

  // Session UUID from the original agent creation (for loading KB files)
  // This is loaded from setup details and takes priority over the new sessionUuid
  const [storedSessionUuid, setStoredSessionUuid] = useState<string | null>(null);
  // Files live under sessions/{sessionUuid}/, so without it they cannot be listed at all.
  const [kbFilesUnavailable, setKbFilesUnavailable] = useState(false);

  // Setup form state
  const [courseName, setCourseName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [courseSpan, setCourseSpan] = useState("");
  const [courseNotes, setCourseNotes] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [prerequisites, setPrerequisites] = useState<string[]>([]);
  
  // Course URLs (for course materials)
  const [courseUrls, setCourseUrls] = useState<Array<{ url: string; description?: string }>>([]);
  
  // Textbook entries
  const [textbooks, setTextbooks] = useState<TextbookEntry[]>([]);
  
  // Conversation starters (editable in edit mode)
  const [conversationStarters, setConversationStarters] = useState<Array<{ title: string; prompt: string }>>([]);
  
  // Track files to delete on save (soft delete - removed from UI immediately, deleted on Update)
  const [kbFilesToDelete, setKbFilesToDelete] = useState<string[]>([]);
  
  // Azure AI Search index names (for new uploads)
  const [indexName, setIndexName] = useState<string | null>(null);
  
  // Agent image (URL from blob storage, and file for new uploads)
  const [agentImageUrl, setAgentImageUrl] = useState<string | null>(null);  // Existing blob URL
  const [agentImageFile, setAgentImageFile] = useState<File | null>(null);  // New file to upload
  const [agentImagePreview, setAgentImagePreview] = useState<string | null>(null);  // Preview URL

  // Handle image selection
  const handleSelectAgentImage = (file: File) => {
    setAgentImageFile(file);
    setAgentImagePreview(URL.createObjectURL(file));
  };

  // Clear image
  const handleClearAgentImage = () => {
    if (agentImagePreview && agentImagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(agentImagePreview);
    }
    setAgentImageFile(null);
    setAgentImagePreview(null);
    setAgentImageUrl(null);  // Mark for deletion on save
  };

  // Track initial values for dirty detection
  const initialValuesRef = React.useRef<{
    courseName: string;
    courseLevel: string;
    courseSpan: string;
    courseNotes: string;
    courseCode: string;
    prerequisites: string[];
    textbooks: TextbookEntry[];
    courseUrls: Array<{ url: string; description?: string }>;
    agentImageUrl: string | null;
    conversationStarters: Array<{ title: string; prompt: string }>;
  } | null>(null);
  
  // Legacy URL state (for backward compatibility)
  const [knowledgeUrls, setKnowledgeUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");

  // URL helper functions
  const addUrl = () => {
    let raw = urlInput.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    const normalized = parsed.toString();
    if (knowledgeUrls.includes(normalized)) {
      setUrlInput("");
      return;
    }
    setKnowledgeUrls([...knowledgeUrls, normalized]);
    setUrlInput("");
  };

  const removeUrl = (u: string) => {
    setKnowledgeUrls(knowledgeUrls.filter((x) => x !== u));
  };

  // Textbook handlers
  const onAddTextbook = (entry: TextbookEntry) => {
    setTextbooks((prev) => [...prev, entry]);
  };

  const onRemoveTextbook = (id: string) => {
    setTextbooks((prev) => prev.filter((tb) => tb.id !== id));
  };

  // Advanced mode: tab state (chat vs configure vs preview)
  // Default to "configure" so users see settings first when entering advanced mode
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>("configure");

  // Preview chat state - single teaching assistant
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<ChatMsg[]>([]);
  const [previewInput, setPreviewInput] = useState("");
  const [isPreviewSending, setIsPreviewSending] = useState(false);
  const [previewWebSearchEnabled, setPreviewWebSearchEnabled] = useState(false);
  const [previewDeepResearchEnabled, setPreviewDeepResearchEnabled] = useState(false);
  const [builderWebSearchEnabled, setBuilderWebSearchEnabled] = useState(false);
  const [builderDeepResearchEnabled, setBuilderDeepResearchEnabled] = useState(false);
  
  // Current agent ID for preview - use the teaching assistant being edited
  const currentPreviewAgentId = agentId;

  // Builder chat state (for advanced mode)
  const [tcThreadId, setTcThreadId] = useState<string | null>(null);
  const [tcaMessages, setTcaMessages] = useState<BuilderChatMsg[]>([]);
  const [builderInput, setBuilderInput] = useState("");
  const [isBuilderSending, setIsBuilderSending] = useState(false);

  const [ecaThreadId, setEcaThreadId] = useState<string | null>(null);
  const [examMessages, setExamMessages] = useState<BuilderChatMsg[]>([]);
  const [examInput, setExamInput] = useState("");
  const [isExamSending, setIsExamSending] = useState(false);

  // Configure state (for advanced mode)
  const [cfgName, setCfgName] = useState("");
  const [cfgDesc, setCfgDesc] = useState("");
  const [cfgInstr, setCfgInstr] = useState(DEFAULT_TEMP_INSTRUCTIONS);

  // Generated docs (for advanced mode)
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [openGeneratedDoc, setOpenGeneratedDoc] = useState<GeneratedDoc | null>(null);

  // KB scope is always course now (single agent per course)
  const kbScope: KBScope = "course";

  /* --------- Setup-phase logic (KB file uploads) --------- */

  // Use stored session UUID from agent setup (for loading existing KB files)
  // Don't fall back to new sessionUuid — that would cause a spurious fetch with the wrong session
  // which returns 0 files and causes flickering. The hook guards against null sessionUuid.
  const effectiveSessionUuid = storedSessionUuid;
  
  // Debug logging
  console.log("[EditView] Session UUIDs:", {
    storedSessionUuid,
    sessionUuid,
    effectiveSessionUuid,
    agentId,
  });

  const {
    kbUploads,
    onSelectKbUploads,
    onRemoveUpload,
    kbFiles,
    setKbFiles,
    loadingKbFiles,
    kbFilesError,
    refreshKbFiles,
    fileToDelete,
    setFileToDelete,
    isDeletingFile,
    handleDeleteKbFile,
  } = useSetupPhaseLogic({
    sessionUuid: effectiveSessionUuid,
    kbScope,
    preserveVectorStore: true,
    phase: "setup",
    setPhase: () => {},
    agentKind,
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
  });

  // Without this an unlistable course looks identical to one with no files at all.
  const kbFilesNotice = kbFilesUnavailable
    ? "Existing course files can't be listed for this course, so they aren't shown below. They're still in use by the assistant, and other changes save normally."
    : kbFilesError;

  /* --------- Fetch agent setup details and paired agent on mount --------- */

  useEffect(() => {
    // Don't fetch until we have a valid agent ID (may still be resolving from URL)
    if (!agentId) return;

    // Reset vector store ID before loading — single reset point avoids race conditions
    setVectorStoreId(null);

    async function loadSetupDetails() {
      setIsLoading(true);
      console.log(`[EditView] Loading setup details for agent: ${agentId}`);
      try {
        const details = await fetchAgentSetupDetails(agentId);
        console.log("[EditView] Loaded setup details:", details);
        if (details) {
          setCourseName(details.courseName || "");
          setCourseLevel(details.courseLevel || "");
          setCourseSpan(details.courseDuration || "");
          setCourseNotes(details.additionalContext || "");
          if (details.courseCode) setCourseCode(details.courseCode);
          if (details.prerequisites) setPrerequisites(details.prerequisites);
          if (details.textbooks) setTextbooks(details.textbooks as TextbookEntry[]);
          // Load conversation starters — normalize to {title, prompt} objects
          if (details.conversationStarters && details.conversationStarters.length > 0) {
            const normalized = details.conversationStarters.map((s: string | { title: string; prompt: string }) =>
              typeof s === "string" ? { title: s.slice(0, 40), prompt: s } : { title: s.title, prompt: s.prompt }
            );
            console.log("[EditView] Loaded conversation starters:", normalized);
            setConversationStarters(applyFixedFirstStarter(normalized));
          } else {
            console.log("[EditView] No conversation starters found in setup details");
          }
          if (details.vectorStoreId) setVectorStoreId(details.vectorStoreId);
          // Load URLs
          const urls = details.knowledgeUrls || [];
          // Backward compat: knowledgeUrls may be string[] (legacy) or {url,description}[]
          const normalizedUrls = urls.map((u: any) => typeof u === "string" ? { url: u } : u);
          setKnowledgeUrls(normalizedUrls.map((u: any) => u.url));
          setCourseUrls(normalizedUrls);
          // Load agent image URL from blob storage
          if (details.agentImageUrl) {
            setAgentImageUrl(details.agentImageUrl);
            // Convert relative proxy URL to absolute URL for preview
            // Add timestamp to bust browser cache and always show fresh image
            const baseUrl = absoluteBackendUrl(details.agentImageUrl);
            const cacheBustedUrl = baseUrl.includes('?') 
              ? `${baseUrl}&_t=${Date.now()}` 
              : `${baseUrl}?_t=${Date.now()}`;
            setAgentImagePreview(cacheBustedUrl);
          }
          // Load session UUID for KB file access (this is the session used during agent creation)
          if (details.sessionUuid) {
            console.log(`[EditView] Found stored sessionUuid: ${details.sessionUuid}`);
            setStoredSessionUuid(details.sessionUuid);
            setKbFilesUnavailable(false);
          } else {
            console.log("[EditView] No sessionUuid in setup details - files won't be loadable for this agent");
            setKbFilesUnavailable(true);
          }
          // Capture initial values for dirty tracking right after loading
          // (avoids stale closure if set in a separate effect)
          initialValuesRef.current = {
            courseName: details.courseName || "",
            courseLevel: details.courseLevel || "",
            courseSpan: details.courseDuration || "",
            courseNotes: details.additionalContext || "",
            courseCode: details.courseCode || "",
            prerequisites: details.prerequisites || [],
            textbooks: (details.textbooks as TextbookEntry[]) || [],
            courseUrls: (details.knowledgeUrls || []).map((u: any) => typeof u === "string" ? { url: u } : u),
            agentImageUrl: details.agentImageUrl || null,
            conversationStarters: details.conversationStarters
              ? applyFixedFirstStarter(
                  details.conversationStarters.map((s: string | { title: string; prompt: string }) =>
                    typeof s === "string" ? { title: s.slice(0, 40), prompt: s } : { title: s.title, prompt: s.prompt }
                  )
                )
              : [],
          };
        }
      } catch (error: any) {
        console.error("[EditView] Failed to load setup details:", error);
        toast.error(`Failed to load agent details: ${error?.message || "Unknown error"}`);
      } finally {
        setIsLoading(false);
      }
    }
    loadSetupDetails();
  }, [agentId]);

  // Compute dirty state
  const isDirty = React.useMemo(() => {
    if (!initialValuesRef.current) return false;
    const iv = initialValuesRef.current;
    return (
      courseName !== iv.courseName ||
      courseLevel !== iv.courseLevel ||
      courseSpan !== iv.courseSpan ||
      courseNotes !== iv.courseNotes ||
      courseCode !== iv.courseCode ||
      JSON.stringify(prerequisites) !== JSON.stringify(iv.prerequisites) ||
      JSON.stringify(textbooks) !== JSON.stringify(iv.textbooks) ||
      JSON.stringify(courseUrls) !== JSON.stringify(iv.courseUrls) ||
      JSON.stringify(conversationStarters) !== JSON.stringify(iv.conversationStarters) ||
      agentImageUrl !== iv.agentImageUrl ||
      kbUploads.length > 0 ||
      kbFilesToDelete.length > 0 ||
      agentImageFile !== null
    );
  }, [courseName, courseLevel, courseSpan, courseNotes, courseCode, prerequisites, textbooks, courseUrls, conversationStarters, agentImageUrl, kbUploads, kbFilesToDelete, agentImageFile]);

  /* --------- Soft delete handlers (remove from UI, delete on save) --------- */

  function handleSoftDeleteKbFile(filename: string) {
    // Remove from displayed list immediately
    setKbFiles((prev) => prev.filter((f) => f.filename !== filename));
    // Track for actual deletion on save
    setKbFilesToDelete((prev) => [...prev, filename]);
  }

  /* --------- Save handler --------- */

  async function handleSave() {
    if (!agentId) {
      toast.error("No agent ID available. Cannot save.");
      return;
    }
    // Validate: after deletions, there must be at least one course file OR new upload.
    // Only enforced when this save actually touches course files: an empty kbFiles
    // also means "not loaded" (no session, or a failed fetch that keeps the list
    // empty), which would otherwise block edits to unrelated fields.
    const remainingCourseFiles = kbFiles.length; // Already filtered by soft delete
    const willHaveCourseFiles = remainingCourseFiles > 0 || kbUploads.length > 0;
    const touchesCourseFiles = kbUploads.length > 0 || kbFilesToDelete.length > 0;

    if (touchesCourseFiles && !willHaveCourseFiles) {
      toast.error("Course material is required. Please upload at least one course file.");
      return;
    }

    // Validate: at least 2 non-empty conversation starters
    const nonEmptyStarters = conversationStarters.filter(s => s.prompt.trim());
    if (nonEmptyStarters.length < 2) {
      toast.error(`At least 2 conversation starters are required (currently ${nonEmptyStarters.length} filled).`);
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    try {
      const sessionToUse = storedSessionUuid || sessionUuid;
      let courseFilesChanged = false;
      
      // Delete files that were marked for deletion (soft deleted from UI)
      if (kbFilesToDelete.length > 0 && sessionToUse) {
        const { deleteKnowledgeFile } = await import("@/lib/api");
        for (const filename of kbFilesToDelete) {
          try {
            await deleteKnowledgeFile(sessionToUse, filename, "course", indexName || undefined);
            console.log(`Deleted course file: ${filename}`);
            courseFilesChanged = true;
          } catch (e: any) {
            console.error(`Failed to delete course file ${filename}:`, e);
          }
        }
        setKbFilesToDelete([]);
      }

      // Upload knowledge base files if any are selected
      let finalIndexName = indexName;
      if (kbUploads.length > 0) {
        try {
          const { uploadKnowledgeFiles } = await import("@/lib/api");
          const result = await uploadKnowledgeFiles(
            sessionToUse,
            kbUploads,
            kbScope,
            indexName ?? undefined
          );
          finalIndexName = result.index_name;
          setIndexName(result.index_name);
          courseFilesChanged = true;
          toast.success(
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-neutral-100">{courseName}</span>
                <span className="text-sm text-neutral-400">Knowledge base updated</span>
              </div>
            </div>
          );
          console.log("Index updated:", result.index_name);

          // Attach knowledge base to agent if not already attached
          if (!indexName || indexName !== result.index_name) {
            try {
              await attachKnowledgeToAgent(result.index_name, agentId, courseName);
              console.log("Knowledge base attached to agent");
            } catch (attachError: any) {
              console.error("Failed to attach knowledge base:", attachError);
              // Non-fatal - continue with update
            }
          }
        } catch (error: any) {
          console.error("Knowledge base upload error:", error);
          toast.error(`Failed to upload knowledge base: ${error?.message || "Unknown error"}`);
          setIsSaving(false);
          return;
        }
      }

      // Update the Azure AI Search indexes if files changed
      if (courseFilesChanged && sessionToUse) {
        try {
          const { updateCourseIndex } = await import("@/lib/api");
          const updateResult = await updateCourseIndex(sessionToUse, "course");
          console.log("Course index update triggered:", updateResult);
          if (updateResult.ok) {
            toast.info("Course index is being updated. This may take a few minutes.");
          }
        } catch (error: any) {
          console.error("Failed to update course index:", error);
          toast.warning("Could not update search index. Files will be indexed on next indexer run.");
        }
      }

      // Regenerate agent instructions only when content-related fields changed
      // (skip for image-only or metadata-only changes to avoid slow unnecessary regen)
      const iv = initialValuesRef.current;
      const contentChanged = courseFilesChanged ||
        !iv ||
        courseName !== iv.courseName ||
        courseLevel !== iv.courseLevel ||
        courseSpan !== iv.courseSpan ||
        courseNotes !== iv.courseNotes ||
        JSON.stringify(courseUrls) !== JSON.stringify(iv.courseUrls);

      let regenResult: { description?: string; conversation_starters?: any[]; learning_prompt_length?: number; exam_prompt_length?: number; instructions_length?: number } = {};
      if (contentChanged) {
        toast.info("Regenerating agent instructions... This may take a moment.");
        regenResult = await regenerateAndUpdateAgent(agentId, {
          courseName,
          courseLevel: courseLevel || undefined,
          courseDuration: courseSpan || undefined,
          additionalContext: courseNotes || undefined,
          courseUrls: courseUrls.length > 0 ? courseUrls.map((u) => u.url) : undefined,
        });
        console.log(`[EditView] Prompt regenerated: learning=${regenResult.learning_prompt_length} chars, exam=${regenResult.exam_prompt_length} chars, total=${regenResult.instructions_length} chars`);
      }

      // Handle agent image upload/deletion
      let finalImageUrl: string | null = agentImageUrl;  // Keep existing URL by default
      
      if (agentImageFile) {
        // New image selected - upload to blob storage
        try {
          console.log("Uploading new agent image to blob storage");
          const uploadResult = await uploadAgentImage(agentId, agentImageFile);
          finalImageUrl = uploadResult.imageUrl;
          console.log("Agent image uploaded:", finalImageUrl);
        } catch (error: any) {
          console.error("Failed to upload agent image:", error);
          toast.warning(`Image upload failed: ${error?.message || "Unknown error"}`);
        }
      } else if (!agentImagePreview && agentImageUrl) {
        // Image was cleared - delete from blob storage
        try {
          console.log("Deleting agent image from blob storage");
          await deleteAgentImage(agentId);
          finalImageUrl = null;
          console.log("Agent image deleted");
        } catch (error: any) {
          console.warn("Failed to delete agent image:", error);
        }
      }

      // Save setup details to JSON file
      // Include regenerated description and conversation starters from CACA
      // Use the stored session UUID consistently for all operations
      await saveAgentSetupDetails({
        agentId,
        agentKind: "course",
        courseName,
        courseLevel,
        courseDuration: courseSpan,
        additionalContext: courseNotes,
        courseCode,
        prerequisites,
        textbooks,
        vectorStoreId: finalIndexName || vectorStoreId, // Use new indexName or fall back to vectorStoreId
        knowledgeUrls: courseUrls.length > 0 ? courseUrls : (knowledgeUrls.length > 0 ? knowledgeUrls.map(u => ({ url: u })) : undefined),
        agentDescription: regenResult.description,
        // Use user-edited starters; only fall back to regen result if user hasn't touched them
        // Filter out starters with empty title AND empty prompt
        conversationStarters: (JSON.stringify(conversationStarters) !== JSON.stringify(initialValuesRef.current?.conversationStarters)
          ? conversationStarters
          : (regenResult.conversation_starters || conversationStarters)
        ).filter((s: { title: string; prompt: string }) => s.title.trim() || s.prompt.trim()),
        agentImageUrl: finalImageUrl,  // Store blob storage URL
        sessionUuid: sessionToUse,  // Store session UUID for KB file access in edit mode
      });

      // Invalidate agent cache so Library view refreshes with new image
      invalidateAgentCache();

      toast.success(
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-medium text-neutral-100">{courseName}</span>
            <span className="text-sm text-neutral-400">Agent updated successfully</span>
          </div>
        </div>
      );
      onSaveComplete();
    } catch (error: any) {
      toast.error(`Failed to save: ${error?.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  }

  /* --------- Builder send (for advanced mode) --------- */

  async function sendBuilder() {
    const text = applyNameGuard(builderInput.trim());
    if (!text || isBuilderSending) return;

    setBuilderInput("");
    setTcaMessages((m) => [...m, { role: "user", content: text }]);
    setIsBuilderSending(true);

    try {
      if (!tcThreadId) {
        const { thread_id, last_reply, vector_store_id } = await ccaStart(
          text,
          sessionUuid,
          vectorStoreId
        );
        setTcThreadId(thread_id);

        pushAssistantReplyWithOptionalDoc(last_reply, setTcaMessages, setGeneratedDocs);

        if (vector_store_id) setVectorStoreId(vector_store_id);
      } else {
        const { last_reply, vector_store_id } = await ccaStep(
          tcThreadId,
          text,
          sessionUuid,
          vectorStoreId
        );

        pushAssistantReplyWithOptionalDoc(last_reply, setTcaMessages, setGeneratedDocs);

        if (vector_store_id) setVectorStoreId(vector_store_id);
      }
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      toast.error(`Error: ${msg}`);

      setTcaMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Error while contacting builder: ${msg}` },
      ]);
    } finally {
      setIsBuilderSending(false);
    }
  }

  async function sendExamBuilder() {
    const text = applyNameGuard(examInput.trim());
    if (!text || isExamSending) return;

    setExamInput("");
    setExamMessages((m) => [...m, { role: "user", content: text }]);
    setIsExamSending(true);

    try {
      if (!ecaThreadId) {
        const { thread_id, last_reply } = await cacaExamStart(text, sessionUuid, vectorStoreId);
        setEcaThreadId(thread_id);

        pushAssistantReplyWithOptionalDoc(last_reply, setExamMessages, setGeneratedDocs);
      } else {
        const { last_reply } = await cacaExamStep(ecaThreadId, text);

        pushAssistantReplyWithOptionalDoc(last_reply, setExamMessages, setGeneratedDocs);
      }
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      toast.error(`Error: ${msg}`);

      setExamMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Error while contacting exam builder: ${msg}` },
      ]);
    } finally {
      setIsExamSending(false);
    }
  }

  /* --------- Preview send (for testing agent in preview panel) --------- */

  async function sendPreviewMessage() {
    const text = applyNameGuard(previewInput.trim());
    if (!text || isPreviewSending) return;

    setPreviewInput("");
    setPreviewMessages((m) => [...m, { role: "user" as const, content: text }]);
    setIsPreviewSending(true);

    try {
      const { thread_id, reply } = await simpleStreamChat(currentPreviewAgentId, text, currentUserId, previewThreadId || null, undefined, previewWebSearchEnabled);
      if (!previewThreadId && thread_id) setPreviewThreadId(thread_id);
      setPreviewMessages((m) => [...m, { role: "assistant" as const, content: reply }]);
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      toast.error(`Preview error: ${msg}`);
      setPreviewMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `⚠️ Error: ${msg}` },
      ]);
    } finally {
      setIsPreviewSending(false);
    }
  }

  /* --------- Preview message edit handler --------- */
  async function handlePreviewMessageEdit(index: number, newContent: string) {
    if (isPreviewSending) return;
    
    // Truncate messages up to and including the edited message
    const truncated = previewMessages.slice(0, index);
    const editedMessage: ChatMsg = { role: "user", content: newContent };
    
    setPreviewMessages([...truncated, editedMessage]);
    setIsPreviewSending(true);

    try {
      // Start a new thread with the edited message (edit = resend from scratch for preview)
      const { thread_id, reply } = await simpleStreamChat(currentPreviewAgentId, newContent, currentUserId, null, undefined, previewWebSearchEnabled);
      setPreviewThreadId(thread_id);
      setPreviewMessages((m) => [...m, { role: "assistant" as const, content: reply }]);
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      toast.error(`Preview error: ${msg}`);
      setPreviewMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `⚠️ Error: ${msg}` },
      ]);
    } finally {
      setIsPreviewSending(false);
    }
  }

  /* --------- Preview retry handler --------- */
  async function handlePreviewRetry() {
    if (isPreviewSending || previewMessages.length === 0) return;
    
    // Find the last user message
    let lastUserIndex = -1;
    for (let i = previewMessages.length - 1; i >= 0; i--) {
      if (previewMessages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    
    if (lastUserIndex === -1) return;
    
    const lastUserMessage = previewMessages[lastUserIndex].content;
    
    // Remove all messages after (and including) the last assistant response
    const truncated = previewMessages.slice(0, lastUserIndex + 1);
    setPreviewMessages(truncated);
    setIsPreviewSending(true);

    try {
      const { thread_id, reply } = await simpleStreamChat(currentPreviewAgentId, lastUserMessage, currentUserId, previewThreadId || null, undefined, previewWebSearchEnabled);
      if (!previewThreadId && thread_id) setPreviewThreadId(thread_id);
      setPreviewMessages((m) => [...m, { role: "assistant" as const, content: reply }]);
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      toast.error(`Preview error: ${msg}`);
      setPreviewMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `⚠️ Error: ${msg}` },
      ]);
    } finally {
      setIsPreviewSending(false);
    }
  }

  /* ===================== Render ===================== */

  // Show loading while resolving agent from URL or fetching setup details
  if (isLoading || !agentId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-900">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mb-6" />
          <p className="text-neutral-400 text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  // Simplistic mode: Configure tab only (Chat and Preview disabled)
  if (editMode === "simplistic") {
    return (
      <div className="h-screen flex flex-col bg-neutral-900 overflow-hidden">
        {/* Animated background */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/3 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-500/3 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Top Header Bar - Sticky */}
        <div className="sticky top-0 z-40 px-3 sm:px-4 lg:px-6 py-3 border-b border-white/[0.08] backdrop-blur-xl bg-neutral-900/80">
          <div className="max-w-[2000px] mx-auto flex items-center justify-between gap-2 sm:gap-4 pr-2">
            {/* Left: Title with info button */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
                title="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 hidden sm:block">
                <div className="flex items-center gap-1">
                  <h1 className="text-lg sm:text-xl font-bold text-white whitespace-nowrap">
                    Edit Teaching Assistant
                  </h1>
                  <div className="relative group">
                    <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                      <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                      <p className="text-xs text-neutral-300">Edit your agent's course details, materials, and configuration settings.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Center: Chat | Configure | Preview tabs */}
            <div className="flex items-center gap-1 p-1 bg-white/[0.03] border border-white/10 rounded-xl shrink-0">
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold text-neutral-600 cursor-not-allowed"
                title="Chat is only available in Advanced mode"
              >
                <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Chat</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 bg-white text-neutral-900 hover:bg-neutral-200"
              >
                <Settings2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Configure</span>
              </button>
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold text-neutral-600 cursor-not-allowed"
                title="Preview is only available in Advanced mode"
              >
                <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Preview</span>
              </button>
            </div>

            {/* Right: Advanced toggle and Update button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled
                title="Advanced mode is coming soon"
                className="flex items-center justify-center gap-1.5 h-9 sm:h-10 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 bg-neutral-800/50 text-neutral-500 border border-neutral-700 cursor-not-allowed opacity-50"
              >
                <Settings2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Advanced</span>
              </button>

              <LoadingButton
                variant="default"
                loading={isSaving}
                loadingText="Updating"
                disabled={!isDirty || isLoading || loadingKbFiles}
                onClick={handleSave}
                className="flex items-center justify-center h-9 sm:h-10 px-3 sm:px-5 text-xs sm:text-sm font-semibold transition-all duration-200 rounded-xl !bg-white hover:!bg-neutral-200 !text-neutral-900 border-0"
              >
                Update
              </LoadingButton>
            </div>
          </div>
        </div>

        {/* Main content area - Configure tab content using SetupPhase */}
        <div className="relative flex-1 overflow-y-auto">
          <SetupPhase
            mode="edit"
            hideButton={true}
            kind={agentKind}
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
            // Textbook materials
            textbooks={textbooks}
            onAddTextbook={onAddTextbook}
            onRemoveTextbook={onRemoveTextbook}
            // Soft delete handlers (removes from UI, deletes on save)
            onSoftDeleteKbFile={handleSoftDeleteKbFile}
            // Conversation starters (editable in edit mode)
            conversationStarters={conversationStarters}
            setConversationStarters={setConversationStarters}
            // Shared
            fileKey={fileKey}
            formatBytes={formatBytes}
            kbFiles={kbFiles}
            loadingKbFiles={loadingKbFiles}
            kbFilesError={kbFilesNotice}
            fileToDelete={fileToDelete}
            setFileToDelete={setFileToDelete}
            isDeletingFile={isDeletingFile}
            handleDeleteKbFile={handleDeleteKbFile}
            vectorStoreId={vectorStoreId}
            isSetupActionLoading={isSaving}
            handleSetupPrimaryAction={handleSave}
            onSave={handleSave}
            createsBothAgents={true}
            // File descriptions
            kbFileDescriptions={kbFileDescriptions}
            setKbFileDescriptions={setKbFileDescriptions}
            // Agent image
            agentImagePreview={agentImagePreview}
            onSelectAgentImage={handleSelectAgentImage}
            onClearAgentImage={handleClearAgentImage}
          />
        </div>
      </div>
    );
  }

  // Retry functions for builder chat (for advanced mode)
  async function retryBuilder(fromMessage?: string, opts?: { replaceLastAssistant?: boolean }) {
    if (opts?.replaceLastAssistant) {
      setTcaMessages((prev) => prev.slice(0, -1));
    }
    await sendBuilder();
  }
  async function retryExamBuilder(fromMessage?: string, opts?: { replaceLastAssistant?: boolean }) {
    if (opts?.replaceLastAssistant) {
      setExamMessages((prev) => prev.slice(0, -1));
    }
    await sendExamBuilder();
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-900 overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/3 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-500/3 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Top Header Bar */}
      <div className="relative px-3 sm:px-4 lg:px-6 py-3 border-b border-white/[0.08] backdrop-blur-xl bg-neutral-900/80 shrink-0 z-50">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between gap-2 sm:gap-4 pr-2">
          {/* Left: Title with info button */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0 relative z-[60]">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              title="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 hidden sm:block">
              <div className="flex items-center gap-1">
                <h1 className="text-lg sm:text-xl font-bold text-white whitespace-nowrap">
                  Edit Teaching Assistant
                </h1>
                <div className="relative group">
                  <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                    <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100]">
                    <p className="text-xs text-neutral-300">Edit your agent's course details, materials, and configuration settings.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Center: Chat | Configure | Preview tabs */}
          <div className="flex items-center gap-1 p-1 bg-white/[0.03] border border-white/10 rounded-xl shrink-0 relative z-40">
            <button
              type="button"
              onClick={() => setAdvancedTab("chat")}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
                advancedTab === "chat"
                  ? "bg-white text-neutral-900 hover:bg-neutral-200"
                  : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setAdvancedTab("configure")}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
                advancedTab === "configure"
                  ? "bg-white text-neutral-900 hover:bg-neutral-200"
                  : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Configure</span>
            </button>
            <button
              type="button"
              onClick={() => setAdvancedTab("preview")}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
                advancedTab === "preview"
                  ? "bg-white text-neutral-900 hover:bg-neutral-200"
                  : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          </div>

          {/* Right: Advanced toggle and Update button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onModeChange?.("simplistic")}
              className="flex items-center justify-center gap-1.5 h-9 sm:h-10 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 bg-neutral-700/50 text-neutral-300 border border-neutral-600 hover:bg-neutral-700 hover:text-white hover:border-neutral-500"
            >
              <Settings2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Simple</span>
            </button>

            <LoadingButton
              variant="default"
              loading={isSaving}
              loadingText="Updating"
              disabled={!isDirty || isLoading || loadingKbFiles}
              onClick={handleSave}
              className="flex items-center justify-center h-9 sm:h-10 px-3 sm:px-5 text-xs sm:text-sm font-semibold transition-all duration-200 rounded-xl !bg-white hover:!bg-neutral-200 !text-neutral-900 border-0"
            >
              Update
            </LoadingButton>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Content based on advancedTab */}
        <div className="flex-1 flex min-w-0">
          {/* Chat Tab: Builder Chat + optional document split */}
          {advancedTab === "chat" && (
            <>
              <div
                className="flex flex-col min-w-0"
                style={{ width: openGeneratedDoc ? "50%" : "100%" }}
              >
                <UnifiedChatContainer
                messages={tcaMessages}
                input={builderInput}
                onInputChange={(e) => setBuilderInput(e.target.value)}
                onSend={() => {
                  if (!isBuilderSending) void sendBuilder();
                }}
                isSending={isBuilderSending}
                placeholder="Ask anything about the course..."
                emptyStateTitle="Builder Chat"
                emptyStateDescription="Chat with the builder to discuss key ideas and difficult concepts for your course."
                emptyStateSuggestions={["Key concepts", "Difficult topics", "Learning objectives"]}
                showUserActions
                onUserMessageEdit={(index, newContent) => {
                  setTcaMessages((prev) =>
                    prev.map((m, i) =>
                      i === index ? { ...m, content: newContent } : m
                    )
                  );
                }}
                onGeneratedDocClick={(docId) => {
                  const doc = generatedDocs.find((d) => d.id === docId);
                  if (doc) {
                    setOpenGeneratedDoc(doc);
                  }
                }}
                onAssistantRetry={() => {
                  void retryBuilder(undefined, {
                    replaceLastAssistant: true,
                  });
                }}
                showWebSearchToggle={true}
                webSearchEnabled={builderWebSearchEnabled}
                onWebSearchToggle={setBuilderWebSearchEnabled}
                deepResearchEnabled={builderDeepResearchEnabled}
                onDeepResearchToggle={setBuilderDeepResearchEnabled}
                showDeepResearchButton={true}
              />
              </div>

              {/* Document preview split pane - 50% width when generated doc is open */}
              {openGeneratedDoc && (
                <div className="w-1/2 border-l border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
                  {/* Improved header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-gradient-to-r from-blue-500/5 to-cyan-500/5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-400/40 shadow-lg shadow-blue-500/10">
                        <FileText className="h-5 w-5 text-blue-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-white truncate">
                          {openGeneratedDoc.title}
                        </p>
                        <p className="text-xs text-blue-300/70">
                          Generated document
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenGeneratedDoc(null)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-neutral-400 hover:text-white transition-all duration-200"
                      title="Close document"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Improved content area */}
                  <div className="flex-1 overflow-auto p-5">
                    <div className="rounded-2xl bg-slate-900/60 border border-slate-700/40 p-6 shadow-xl">
                      <div
                        className="
                          prose prose-invert prose-base
                          prose-headings:text-sky-300 prose-headings:font-bold
                          prose-h1:text-2xl prose-h1:mb-4 prose-h1:pb-3 prose-h1:border-b prose-h1:border-sky-500/30
                          prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-sky-200
                          prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-sky-100
                          prose-strong:text-sky-100 prose-strong:font-semibold
                          prose-p:text-slate-200 prose-p:leading-relaxed
                          prose-li:text-slate-200 prose-li:leading-relaxed
                          prose-ul:my-3 prose-ol:my-3
                          prose-code:bg-slate-800 prose-code:text-amber-200 prose-code:px-2 prose-code:py-1 prose-code:rounded-md prose-code:text-sm prose-code:font-mono
                          prose-pre:bg-slate-800/80 prose-pre:border prose-pre:border-slate-700/50 prose-pre:rounded-xl
                          max-w-none
                        "
                      >
                        <ReactMarkdown>{openGeneratedDoc.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Configure Tab: Use SetupPhase + Special Instructions */}
          {advancedTab === "configure" && (
            <div className="flex-1 overflow-y-auto">
              {/* SetupPhase for Course Info and Resources - same as simple edit mode */}
              <SetupPhase
                mode="edit"
                hideButton={true}
                kind={agentKind}
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
                // Textbook materials
                textbooks={textbooks}
                onAddTextbook={onAddTextbook}
                onRemoveTextbook={onRemoveTextbook}
                // Soft delete handlers (removes from UI, deletes on save)
                onSoftDeleteKbFile={handleSoftDeleteKbFile}
                // Shared
                fileKey={fileKey}
                formatBytes={formatBytes}
                kbFiles={kbFiles}
                loadingKbFiles={loadingKbFiles}
                kbFilesError={kbFilesNotice}
                fileToDelete={fileToDelete}
                setFileToDelete={setFileToDelete}
                isDeletingFile={isDeletingFile}
                handleDeleteKbFile={handleDeleteKbFile}
                vectorStoreId={vectorStoreId}
                isSetupActionLoading={isSaving}
                handleSetupPrimaryAction={handleSave}
                onSave={handleSave}
                createsBothAgents={true}
                // File descriptions
                kbFileDescriptions={kbFileDescriptions}
                setKbFileDescriptions={setKbFileDescriptions}
                // Agent image
                agentImagePreview={agentImagePreview}
                onSelectAgentImage={handleSelectAgentImage}
                onClearAgentImage={handleClearAgentImage}
                // Special Instructions - show in advanced mode
                showSpecialInstructions={true}
                cfgDesc={cfgDesc}
                setCfgDesc={setCfgDesc}
                cfgInstr={cfgInstr}
                setCfgInstr={setCfgInstr}
              />
            </div>
          )}

          {/* Preview Tab: Full screen preview with same UI as builder */}
          {advancedTab === "preview" && (
            <div className="flex-1 flex flex-col min-w-0 w-full">
              <UnifiedChatContainer
                messages={previewMessages}
                input={previewInput}
                onInputChange={(e) => setPreviewInput(e.target.value)}
                onSend={sendPreviewMessage}
                isSending={isPreviewSending}
                placeholder="Ask anything about the course..."
                emptyStateTitle="Preview Agent"
                emptyStateDescription="Test your agent to see how it responds to different queries."
                emptyStateSuggestions={["Explain a concept", "Ask a question", "Test knowledge"]}
                onSuggestionClick={(suggestion) => {
                  setPreviewInput(suggestion);
                }}
                showUserActions={true}
                onUserMessageEdit={handlePreviewMessageEdit}
                onAssistantRetry={handlePreviewRetry}
                showWebSearchToggle={true}
                webSearchEnabled={previewWebSearchEnabled}
                onWebSearchToggle={setPreviewWebSearchEnabled}
                deepResearchEnabled={previewDeepResearchEnabled}
                onDeepResearchToggle={setPreviewDeepResearchEnabled}
                showDeepResearchButton={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
