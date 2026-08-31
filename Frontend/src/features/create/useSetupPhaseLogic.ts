// useSetupPhaseLogic.ts

import { useState, useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { KnowledgeFile } from "@/lib/api";
import {
  listKnowledgeFiles,
  deleteKnowledgeFile,
  uploadKnowledgeFiles,
  cacaExamStart,
  ccaStart,
  KBScope,
} from "@/lib/api";

import type { GeneratedDoc, BuilderChatMsg } from "./markdownUtils";
import { pushAssistantReplyWithOptionalDoc } from "./markdownUtils";
import type { AgentKind, Phase } from "./builderTypes";
import { fileKey } from "./builderTypes";

interface UseSetupPhaseArgs {
  sessionUuid: string | null;
  kbScope: KBScope;

  /**
   * When true, do not auto-clear an existing vector store on entering setup.
   * This is important for Edit flows where a previously-attached knowledge base
   * should be shown immediately.
   */
  preserveVectorStore?: boolean;

  phase: Phase;
  setPhase: (p: Phase) => void;
  agentKind: AgentKind;

  vectorStoreId: string | null;
  setVectorStoreId: (v: string | null) => void;

  courseName: string;
  courseLevel: string;
  courseSpan: string;
  courseNotes: string;

  // builder state
  isBuilderSending: boolean;
  setIsBuilderSending: (v: boolean) => void;
  setLacaPreviewSynced: (v: boolean) => void;

  tcThreadId: string | null;
  ecaThreadId: string | null;
  setTcThreadId: (id: string) => void;
  setEcaThreadId: (id: string) => void;

  setTcaMessages: Dispatch<SetStateAction<BuilderChatMsg[]>>;
  setExamMessages: Dispatch<SetStateAction<BuilderChatMsg[]>>;
  setGeneratedDocs: Dispatch<SetStateAction<GeneratedDoc[]>>;

  /** Pre-populated KB uploads from a previous mount (persisted in AppContext) */
  initialKbUploads?: File[];
}

interface UseSetupPhaseReturn {
  kbUploads: File[];
  onSelectKbUploads: (files: File[]) => void;
  onRemoveUpload: (index: number) => void;

  kbFiles: KnowledgeFile[];
  setKbFiles: React.Dispatch<React.SetStateAction<KnowledgeFile[]>>;
  loadingKbFiles: boolean;
  kbFilesError: string | null;
  refreshKbFiles: () => Promise<void>;

  fileToDelete: string | null;
  setFileToDelete: (filename: string | null) => void;
  isDeletingFile: boolean;
  handleDeleteKbFile: (filename: string) => Promise<void>;

  isSetupActionLoading: boolean;
  handleSetupPrimaryAction: () => Promise<void>;
}

export function useSetupPhaseLogic(
  args: UseSetupPhaseArgs
): UseSetupPhaseReturn {
  const {
    sessionUuid,
    kbScope,
    preserveVectorStore,
    phase,
    setPhase,
    agentKind,
    vectorStoreId,
    setVectorStoreId,
    courseName,
    courseLevel,
    courseSpan,
    courseNotes,
    isBuilderSending,
    setIsBuilderSending,
    setLacaPreviewSynced,
    tcThreadId,
    ecaThreadId,
    setTcThreadId,
    setEcaThreadId,
    setTcaMessages,
    setExamMessages,
    setGeneratedDocs,
  } = args;

  // Local KB uploads selected in UI (initialized from persisted state if available)
  const [kbUploads, setKbUploads] = useState<File[]>(args.initialKbUploads || []);
  const [uploading, setUploading] = useState(false);

  const onSelectKbUploads = useCallback((files: File[]) => {
    setKbUploads((prev) => {
      const seen = new Set(prev.map(fileKey));
      const merged = [...prev];
      for (const f of files) {
        const k = fileKey(f);
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(f);
        }
      }
      return merged;
    });
  }, []);

  const onRemoveUpload = useCallback((index: number) => {
    setKbUploads((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Existing KB files stored for this session
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [loadingKbFiles, setLoadingKbFiles] = useState(false);
  const [kbFilesError, setKbFilesError] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);

  /* --------- KB files: fetch + helpers --------- */

  const refreshKbFiles = useCallback(async () => {
    if (!sessionUuid) {
      console.log("[KB Files] No sessionUuid, skipping fetch");
      return;
    }
    console.log(`[KB Files] Fetching files for session=${sessionUuid}, kbScope=${kbScope}, vectorStoreId=${vectorStoreId}`);
    setLoadingKbFiles(true);
    setKbFilesError(null);
    try {
      const { files } = await listKnowledgeFiles(sessionUuid, kbScope, vectorStoreId);
      console.log(`[KB Files] Found ${files?.length || 0} files:`, files);
      setKbFiles(files || []);
    } catch (e: any) {
      console.error("[KB Files] Error fetching files:", e);
      // Don't clear existing files on error — this prevents flickering when
      // concurrent Azure CLI credential requests cause transient failures.
      // Only set error for display purposes.
      setKbFilesError(e?.message || "Failed to load existing files");
    } finally {
      setLoadingKbFiles(false);
    }
  }, [sessionUuid, kbScope, vectorStoreId]);

  useEffect(() => {
    void refreshKbFiles();
  }, [refreshKbFiles]);

  // In a fresh session, clear any leftover vector store so we don’t show old files.
  useEffect(() => {
    if (!preserveVectorStore && phase === "setup" && !tcThreadId && !ecaThreadId && vectorStoreId) {
      setVectorStoreId(null);
      setKbFiles([]);
    }
  }, [preserveVectorStore, phase, tcThreadId, ecaThreadId, vectorStoreId, setVectorStoreId]);

  async function handleDeleteKbFile(filename: string) {
    if (!sessionUuid) return;
    setIsDeletingFile(true);
    try {
      await deleteKnowledgeFile(sessionUuid, filename, kbScope, vectorStoreId || undefined);
      setKbFiles((prev) => prev.filter((f) => f.filename !== filename));
      toast.success("File removed from knowledge base");
      setFileToDelete(null);
    } catch (e: any) {
      toast.error(`Failed to delete file: ${e?.message || "Unknown error"}`);
    } finally {
      setIsDeletingFile(false);
    }
  }

  /* --------- Start builders from Setup --------- */

  async function startExamFromSetup() {
    if (!courseName.trim()) return toast.error("Please enter a course/exam name.");

    const parts: string[] = [];
    parts.push(
      "You are a Teaching Assistant Creation Agent (CACA) helping a teacher design an exam-focused agent."
    );
    parts.push(
      "Keep replies concise and interaction-focused. Avoid long essays or full exam papers in a single response."
    );

    parts.push(`Course / Exam name: ${courseName.trim()}`);
    if (courseLevel.trim()) parts.push(`Level: ${courseLevel.trim()}`);
    if (courseSpan.trim()) parts.push(`Exam span / schedule: ${courseSpan.trim()}`);
    if (courseNotes.trim()) {
      parts.push(
        `Additional constraints or notes about exam style/students: ${courseNotes.trim()}`
      );
    }

    if (vectorStoreId) {
      parts.push(
        "You may refer to the attached knowledge base (syllabus, lecture notes, PYQs) when reasoning about exam focus, important topics, and difficulty."
      );
    }

    parts.push(
      [
        "For this FIRST reply:",
        "- Briefly restate the exam/course focus in 1–2 lines.",
        "- Ask what kind of exam agent is needed (practice generator, rubric explainer, viva-style, etc.).",
        "- Propose 2–3 example capabilities such an exam agent could have.",
        "- Ask 1–3 short clarifying questions, not a full questionnaire.",
      ].join("\n")
    );

    const teacherOpening = parts.join("\n\n");

    setIsBuilderSending(true);
    try {
      const { thread_id, last_reply } = await cacaExamStart(teacherOpening, sessionUuid!, vectorStoreId);
      setEcaThreadId(thread_id);
      setExamMessages([]);
      pushAssistantReplyWithOptionalDoc(last_reply, setExamMessages, setGeneratedDocs);
      setPhase("builder");
      toast.success("Exam builder started!");
    } catch (e: any) {
      toast.error(`Error starting exam builder: ${e?.message || "Unknown error"}`);
    } finally {
      setIsBuilderSending(false);
    }
  }

  async function startCcaFromSetup() {
    if (!courseName.trim()) return toast.error("Please enter a course name.");

    const parts: string[] = [];
    parts.push("You are a Course Conversational Agent (CCA) helping a teacher design a specific course.");
    parts.push(
      "Your top priority is to keep replies SHORT, concrete, and interaction-focused. " +
        "Do NOT write long summaries, do NOT explain your full plan, and do NOT give lectures."
    );

    parts.push(`Course name: ${courseName.trim()}`);
    if (courseLevel.trim()) parts.push(`Level of the course: ${courseLevel.trim()}`);
    if (courseSpan.trim()) parts.push(`Span of learning: ${courseSpan.trim()}`);
    if (courseNotes.trim())
      parts.push(`Additional context about learners/constraints: ${courseNotes.trim()}`);

    if (vectorStoreId) {
      parts.push(
        "You have access to a temporary knowledge base built from the uploaded course files. " +
          "You MAY refer to it when inferring likely threshold concepts, but keep the reply short."
      );
    }

    parts.push(
      "Even if no course PDFs are attached, you can still infer plausible threshold concepts " +
        "for this course using your own existing disciplinary knowledge. When you mention this, keep it brief."
    );

    parts.push(
      [
        "Now generate ONLY your first reply to the teacher.",
        "Hard constraints for this FIRST reply:",
        "- Maximum ~80–100 words.",
        "- NO multi-paragraph explanation of your process.",
        "- NO detailed restatement of all course details.",
        "",
        "The reply MUST follow this exact structure:",
        "1) One short sentence thanking them for the course details/materials.",
        "2) One short sentence that very briefly names the course and level in your own words (no more than 1 line).",
        "3) One short sentence asking them to choose ONE of two options:",
        "   (a) type the threshold concepts they already have in mind, OR",
        "   (b) allow you to propose an initial list of threshold concepts using your current knowledge of this discipline, " +
          "and, if available, a quick scan of the attached knowledge base.",
        "4) Then give 2–3 bullet points with EXAMPLE threshold concepts that are plausible for THIS course,",
        "   each bullet with the TC name and ONE short reason why it is a threshold concept in this context.",
        "",
        "Do NOT describe future phases like sequencing or concept inventories in this first reply.",
        "Do NOT outline a big plan. Just thank, ask for TCs / permission, and show 2–3 example TCs with very short reasons.",
      ].join("\n")
    );

    const teacherOpening = parts.join("\n\n");

    setIsBuilderSending(true);
    try {
      const { thread_id, last_reply, vector_store_id } = await ccaStart(
        teacherOpening,
        sessionUuid!,
        vectorStoreId
      );
      setTcThreadId(thread_id);
      setTcaMessages([]);
      pushAssistantReplyWithOptionalDoc(last_reply, setTcaMessages, setGeneratedDocs);

      if (vector_store_id) setVectorStoreId(vector_store_id);
      setLacaPreviewSynced(false);
      setPhase("builder");
      toast.success("Agent builder started!");
    } catch (e: any) {
      toast.error(`Error starting: ${e?.message || "Unknown error"}`);
    } finally {
      setIsBuilderSending(false);
    }
  }

  /* --------- Setup Primary Action: upload KB (if any) + continue/update --------- */

  const isReturningFromBuilder = tcThreadId !== null || ecaThreadId !== null;
  const isSetupActionLoading = uploading || isBuilderSending;

  async function handleSetupPrimaryAction() {
    if (uploading || isBuilderSending) return;

    // 1) If there are new KB files, upload them first
    if (kbUploads.length > 0 && sessionUuid) {
      const hadVectorStore = !!vectorStoreId;
      setUploading(true);
      try {
        const { index_name } = await uploadKnowledgeFiles(
          sessionUuid,
          kbUploads,
          kbScope,
          vectorStoreId ?? undefined
        );

        setVectorStoreId(index_name);
        toast.success(hadVectorStore ? "Knowledge base updated!" : "Knowledge base created!");

        setKbUploads([]);
        await refreshKbFiles();
      } catch (e: any) {
        toast.error(`Failed to build knowledge base: ${e?.message || "Unknown error"}`);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // 2) Then either go back to builder or start it
    if (isReturningFromBuilder) {
      setPhase("builder");
      return;
    }

    // Always use CCA flow for teaching assistants
    await startCcaFromSetup();
  }

  return {
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
    isSetupActionLoading,
    handleSetupPrimaryAction,
  };
}