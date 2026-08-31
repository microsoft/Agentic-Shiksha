// SetupPhase.tsx
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  GraduationCap,
  AlertCircle,
  CheckCircle2,
  FileText,
  Download,
  X,
  Loader2,
  Trash2,
  ArrowRight,
  Zap,
  Layers,
  Bot,
  Settings,
  Settings2,
  ImagePlus,
  Upload,
  ChevronDown,
  Check,
  Search,
  Plus,
  GripVertical,
  Pencil,
  Maximize2,
} from "lucide-react";
import { MdOutlineEditNote } from "react-icons/md";
import { DarkFileInput } from "@/components/common/DarkFileInput";
import { PageHeader } from "@/components/layout/PageHeader";

import type { KnowledgeFile } from "@/lib/api";
import { listAzureAgents, safeImageSrc } from "@/lib/api";
import type { AzureAgentRow } from "@/lib/types";
import { getCourseName } from "@/lib/utils";
// Model is controlled by backend - no model config imports needed

export type TextbookEntry = {
  id: string;
  name: string;
  edition: string;
  authors?: string[];
  type: "primary" | "reference";
  description?: string;
  file?: File;
};

import { PANEL, FIELD, LABEL } from "./designSystem";
import { LoadingButton, StatusBadge, IconButton, ProgressIndicator } from "./sharedUI";
import { CreateButton } from "@/components/ui/CreateButton";

type SetupPhaseProps = {
  mode?: "create" | "edit"; // NEW: Differentiate between create and edit modes
  hideButton?: boolean; // NEW: Hide the Save/Create button (for advanced edit mode)
  kind?: "course"; // Teaching assistant (simplified - no exam mode)
  isReturningFromBuilder: boolean;

  courseName: string;
  setCourseName: (v: string) => void;
  courseLevel: string;
  setCourseLevel: (v: string) => void;
  courseSpan: string;
  setCourseSpan: (v: string) => void;
  courseNotes: string;
  setCourseNotes: (v: string) => void;
  courseCode: string;
  setCourseCode: (v: string) => void;
  prerequisites: string[];
  setPrerequisites: (v: string[]) => void;
  
  // Agent image (optional) - preview URL from parent
  agentImagePreview?: string | null;
  onSelectAgentImage?: (file: File) => void;
  onClearAgentImage?: () => void;

  // Model router mode (for agent creation)


  // Course/Learning materials (when createsBothAgents is true)
  courseUrls?: Array<{ url: string; description?: string }>;
  setCourseUrls?: (urls: Array<{ url: string; description?: string }>) => void;
  
  // Exam materials (when createsBothAgents is true)
  examUrls?: string[];
  setExamUrls?: (urls: string[]) => void;
  examUploads?: File[];
  onSelectExamUploads?: (files: File[]) => void;
  onRemoveExamUpload?: (index: number) => void;

  // Textbook entries (structured data with optional PDF)
  textbooks?: TextbookEntry[];
  onAddTextbook?: (entry: TextbookEntry) => void;
  onRemoveTextbook?: (id: string) => void;

  // Course description file attachment (passed up to CreateView for submission)
  courseDescFile?: File | null;
  onCourseDescFile?: (file: File | null) => void;

  // Legacy single URL list (for backward compatibility when createsBothAgents is false)
  knowledgeUrls?: string[];
  setKnowledgeUrls?: (urls: string[]) => void;

  kbUploads: File[];
  onSelectKbUploads: (files: File[]) => void;
  onRemoveUpload: (index: number) => void;
  fileKey: (f: File) => string;
  formatBytes: (n: number) => string;

  kbFiles: KnowledgeFile[];
  loadingKbFiles: boolean;
  kbFilesError: string | null;
  
  // Exam files (for edit mode in createsBothAgents)
  examFiles?: KnowledgeFile[];
  loadingExamFiles?: boolean;
  
  // Soft delete handlers for edit mode (removes from UI, deletes on save)
  onSoftDeleteKbFile?: (filename: string) => void;
  onSoftDeleteExamFile?: (filename: string) => void;

  // Conversation starters (editable in edit mode)
  conversationStarters?: Array<{ title: string; prompt: string }>;
  setConversationStarters?: (starters: Array<{ title: string; prompt: string }>) => void;

  fileToDelete: string | null;
  setFileToDelete: (name: string | null) => void;
  isDeletingFile: boolean;
  handleDeleteKbFile: (filename: string) => void;

  vectorStoreId: string | null;

  isSetupActionLoading: boolean;
  handleSetupPrimaryAction: () => void;
  onSave?: () => Promise<void>; // NEW: For edit mode save
  createsBothAgents?: boolean; // NEW: When true, creates both learning and exam agents

  // File descriptions for additional course materials
  kbFileDescriptions?: Record<string, string>;
  setKbFileDescriptions?: (descs: Record<string, string>) => void;
  
  // Special Instructions (for advanced edit mode)
  showSpecialInstructions?: boolean;
  cfgDesc?: string;
  setCfgDesc?: (v: string) => void;
  cfgInstr?: string;
  setCfgInstr?: (v: string) => void;
};

export function SetupPhase(props: SetupPhaseProps) {
  const {
    mode = "create", // NEW: Default to create mode
    hideButton = false, // NEW: Default to showing button
    kind,
    isReturningFromBuilder,
    courseName,
    setCourseName,
    courseLevel,
    setCourseLevel,
    courseSpan,
    setCourseSpan,
    courseNotes,
    setCourseNotes,
    courseCode,
    setCourseCode,
    prerequisites,
    setPrerequisites,
    // Agent image
    agentImagePreview,
    onSelectAgentImage,
    onClearAgentImage,

    // Course/Learning materials (for createsBothAgents mode)
    courseUrls = [],
    setCourseUrls,
    // Exam materials (for createsBothAgents mode)
    examUrls = [],
    setExamUrls,
    examUploads = [],
    onSelectExamUploads,
    onRemoveExamUpload,
    // Textbook entries (structured data with optional PDF)
    textbooks = [],
    onAddTextbook,
    onRemoveTextbook,
    // Legacy single URL list (for backward compatibility)
    knowledgeUrls = [],
    setKnowledgeUrls,
    kbUploads,
    onSelectKbUploads,
    onRemoveUpload,
    fileKey,
    formatBytes,
    kbFiles,
    loadingKbFiles,
    kbFilesError,
    // Exam files (for edit mode in createsBothAgents)
    examFiles = [],
    loadingExamFiles = false,
    // Soft delete handlers for edit mode
    onSoftDeleteKbFile,
    onSoftDeleteExamFile,
    // Conversation starters (editable in edit mode)
    conversationStarters = [],
    setConversationStarters,
    fileToDelete,
    setFileToDelete,
    isDeletingFile,
    handleDeleteKbFile,
    vectorStoreId,
    isSetupActionLoading,
    handleSetupPrimaryAction,
    onSave, // NEW: For edit mode
    createsBothAgents = false, // NEW: Dual agent creation
    // File descriptions
    kbFileDescriptions = {},
    setKbFileDescriptions,
    // Special Instructions
    showSpecialInstructions = false,
    cfgDesc = "",
    setCfgDesc,
    cfgInstr = "",
    setCfgInstr,
  } = props;

  // State for image loading
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Reset loading/error state when image URL changes
  useEffect(() => {
    if (agentImagePreview) {
      setImageLoading(true);
      setImageError(false);
    }
  }, [agentImagePreview]);

  // Handler to create agent directly (no confirmation needed)
  const handleCreateClick = () => {
    handleSetupPrimaryAction();
  };

  // Color scheme for teaching assistants (always blue theme)
  const primaryColor = "blue";
  const secondaryColor = "indigo";
  const accentColor = "purple";
  
  // Image upload ref
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSelectAgentImage) {
      onSelectAgentImage(file);
    }
  };

  // Touched state for validation
  const [touchedFields, setTouchedFields] = React.useState<{
    courseName: boolean;
    courseLevel: boolean;
    courseSpan: boolean;
    courseNotes: boolean;
    courseCode: boolean;
    prerequisites: boolean;
  }>({
    courseName: false,
    courseLevel: false,
    courseSpan: false,
    courseNotes: false,
    courseCode: false,
    prerequisites: false,
  });
  
  const handleBlur = (field: 'courseName' | 'courseLevel' | 'courseSpan' | 'courseCode') => {
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  };

  // Textbook inline form state
  const [textbookFormOpen, setTextbookFormOpen] = React.useState(false);
  const [editingTextbookId, setEditingTextbookId] = React.useState<string | null>(null);
  const [courseDescFormOpen, setCourseDescFormOpen] = React.useState(false);
  const [courseUrlFormOpen, setCourseUrlFormOpen] = React.useState(false);
  const [tbName, setTbName] = React.useState("");
  const [tbEdition, setTbEdition] = React.useState("");
  const [tbAuthors, setTbAuthors] = React.useState<string[]>([]);
  const [tbAuthorInput, setTbAuthorInput] = React.useState("");
  const [tbType, setTbType] = React.useState<"primary" | "reference" | "">("");
  const [tbDescription, setTbDescription] = React.useState("");
  const [tbFile, setTbFile] = React.useState<File | null>(null);
  const tbFileInputRef = React.useRef<HTMLInputElement>(null);

  // KB file description editing state
  const [editingDescFile, setEditingDescFile] = React.useState<string | null>(null);
  const [editingDescValue, setEditingDescValue] = React.useState("");
  const [showAllUploads, setShowAllUploads] = React.useState(false);

  // CSV import for textbooks
  const csvImportRef = React.useRef<HTMLInputElement>(null);
  const handleImportCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return; // header + at least 1 row
      // Parse header to find column indices (case-insensitive)
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
      const idx = {
        name: header.findIndex((h) => h === "name" || h === "title" || h === "book" || h === "textbook"),
        type: header.findIndex((h) => h === "type" || h === "category"),
        edition: header.findIndex((h) => h === "edition"),
        authors: header.findIndex((h) => h === "authors" || h === "author"),
      };
      if (idx.name === -1) return; // name column is required
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parse (handles quoted fields with commas)
        const cols: string[] = [];
        let current = "";
        let inQuotes = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQuotes = !inQuotes; }
          else if (ch === "," && !inQuotes) { cols.push(current.trim()); current = ""; }
          else { current += ch; }
        }
        cols.push(current.trim());
        const name = (cols[idx.name] || "").replace(/^"|"$/g, "").trim();
        if (!name) continue;
        const rawType = idx.type >= 0 ? (cols[idx.type] || "").replace(/^"|"$/g, "").trim().toLowerCase() : "";
        const type: "primary" | "reference" = rawType.startsWith("ref") ? "reference" : "primary";
        const edition = idx.edition >= 0 ? (cols[idx.edition] || "").replace(/^"|"$/g, "").trim() : "";
        const authorsStr = idx.authors >= 0 ? (cols[idx.authors] || "").replace(/^"|"$/g, "").trim() : "";
        const authors = authorsStr ? authorsStr.split(/[;&]/).map((a) => a.trim()).filter(Boolean) : undefined;
        const entry: TextbookEntry = {
          id: crypto.randomUUID(),
          name,
          edition,
          authors,
          type,
        };
        onAddTextbook?.(entry);
      }
    };
    reader.readAsText(file);
  };

  // Course description file attachment (attached, not pasted into textarea)
  const descFileInputRef = React.useRef<HTMLInputElement>(null);
  const descFile = props.courseDescFile ?? null;
  const setDescFile = (f: File | null) => props.onCourseDescFile?.(f);

  const resetTextbookForm = () => {
    setTbName("");
    setTbEdition("");
    setTbAuthors([]);
    setTbAuthorInput("");
    setTbType("");
    setTbDescription("");
    setTbFile(null);
  };

  const handleAddTextbook = () => {
    if (!tbName.trim() || !tbType) return;
    const entry: TextbookEntry = {
      id: editingTextbookId || crypto.randomUUID(),
      name: tbName.trim(),
      edition: tbEdition.trim(),
      authors: tbAuthors.length > 0 ? tbAuthors : undefined,
      type: tbType as "primary" | "reference",
      description: tbDescription.trim() || undefined,
      file: tbFile || undefined,
    };
    if (editingTextbookId) {
      // Remove old and add updated
      onRemoveTextbook?.(editingTextbookId);
    }
    onAddTextbook?.(entry);
    resetTextbookForm();
    setEditingTextbookId(null);
    setTextbookFormOpen(false);
  };

  // Prerequisites multi-select state
  const [prereqDropdownOpen, setPrereqDropdownOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AzureAgentRow[]>([]);
  const [prereqSearch, setPrereqSearch] = useState("");
  const prereqRef = useRef<HTMLDivElement>(null);

  // Custom duration state
  const [customDurationNum, setCustomDurationNum] = useState("");
  const [customDurationUnit, setCustomDurationUnit] = useState("");
  const isCustomDuration = courseSpan === "__custom__" || (courseSpan !== "" && !["1 Month", "1 Trimester", "1 Semester", "1 Year"].includes(courseSpan));

  // Custom level state
  const [customLevelText, setCustomLevelText] = useState("");
  const PRESET_LEVELS = ["Undergraduate", "Postgraduate", "Doctoral", "Diploma", "Certificate", "Professional"];
  const isCustomLevel = courseLevel === "__custom_level__" || (courseLevel !== "" && !PRESET_LEVELS.includes(courseLevel));

  // Fetch all agents for the prerequisites dropdown
  useEffect(() => {
    let cancelled = false;
    listAzureAgents().then((agents) => {
      if (!cancelled) {
        // Only show teaching assistants (name starts with "course-")
        const courseAgents = agents.filter(
          (a) => a.name.toLowerCase().startsWith("course-") || a.name.toLowerCase().startsWith("course_")
        );
        setAvailableAgents(courseAgents);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Close prerequisites dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (prereqRef.current && !prereqRef.current.contains(e.target as Node)) {
        setPrereqDropdownOpen(false);
        setPrereqSearch("");
      }
    };
    if (prereqDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [prereqDropdownOpen]);

  const togglePrerequisite = (agentName: string) => {
    if (agentName === "__none__") {
      // Toggle None: if already selected, deselect; otherwise select only None
      if (prerequisites.includes("__none__")) {
        setPrerequisites([]);
      } else {
        setPrerequisites(["__none__"]);
      }
    } else {
      // Toggle a course: remove None if present
      const withoutNone = prerequisites.filter((p) => p !== "__none__");
      if (withoutNone.includes(agentName)) {
        setPrerequisites(withoutNone.filter((p) => p !== agentName));
      } else {
        setPrerequisites([...withoutNone, agentName]);
      }
    }
    setTouchedFields(prev => ({ ...prev, prerequisites: true }));
  };

  // URL input state for both sections
  const [courseUrlInput, setCourseUrlInput] = React.useState("");
  const [courseUrlDesc, setCourseUrlDesc] = React.useState("");
  const [examUrlInput, setExamUrlInput] = React.useState("");
  const [urlInput, setUrlInput] = React.useState(""); // Legacy for single mode

  // URL add/remove handlers for course section
  const addCourseUrl = () => {
    let raw = courseUrlInput.trim();
    if (!raw || !setCourseUrls) return;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    let parsed: URL;
    try { parsed = new URL(raw); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    const normalized = parsed.toString();
    if (courseUrls.some((u) => u.url === normalized)) { setCourseUrlInput(""); return; }
    setCourseUrls([...courseUrls, { url: normalized, description: courseUrlDesc.trim() || undefined }]);
    setCourseUrlInput("");
    setCourseUrlDesc("");
  };

  const removeCourseUrl = (url: string) => {
    if (setCourseUrls) setCourseUrls(courseUrls.filter((x) => x.url !== url));
  };

  // URL add/remove handlers for exam section
  const addExamUrl = () => {
    let raw = examUrlInput.trim();
    if (!raw || !setExamUrls) return;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    let parsed: URL;
    try { parsed = new URL(raw); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    const normalized = parsed.toString();
    if (examUrls.includes(normalized)) { setExamUrlInput(""); return; }
    setExamUrls([...examUrls, normalized]);
    setExamUrlInput("");
  };

  const removeExamUrl = (u: string) => {
    if (setExamUrls) setExamUrls(examUrls.filter((x) => x !== u));
  };

  // Legacy URL handler (for single mode)

  const addUrl = () => {
    let raw = urlInput.trim();
    if (!raw || !setKnowledgeUrls) return;

    // Accept users pasting without scheme
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
    if (setKnowledgeUrls) setKnowledgeUrls(knowledgeUrls.filter((x) => x !== u));
  };

  // Compute header title
  const headerTitle = createsBothAgents
    ? "Build Teaching Assistant"
    : isReturningFromBuilder
      ? "Update Knowledge Base"
      : "Create Teaching Assistant";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-neutral-900">
      {/* Sticky Header - full width */}
      {mode !== "edit" && (
        <PageHeader title={headerTitle} showBorder={isScrolled}>
          {/* Create Button */}
          {!hideButton && (
            <CreateButton
              loading={isSetupActionLoading}
              onClick={handleCreateClick}
              disabled={
                !courseName.trim() ||
                !courseLevel.trim() ||
                !courseSpan.trim() ||
                !courseNotes.trim()
              }
            >
              {isReturningFromBuilder ? "Update" : "Create"}
            </CreateButton>
          )}
        </PageHeader>
      )}

      {/* Main content - Library-style centered layout - SCROLLABLE */}
      <div 
        className="flex-1 overflow-y-auto"
        onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 10)}
      >
        <div className="relative mx-auto max-w-3xl px-4 py-8">
          <div className={`space-y-6 transition-opacity ${isSetupActionLoading ? 'pointer-events-none opacity-50' : ''}`}>
          {/* Course info with Image Placeholder */}
          <div className="p-5 rounded-xl border border-white/40 bg-neutral-900 shadow-lg shadow-black/20">
            <div className="space-y-5">
              {/* Header with info button */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <h3 className="text-lg font-semibold text-white">Course Details</h3>
                    <div className="relative group">
                      <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                        <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                        <p className="text-xs text-neutral-300">Basic information about your course including name, level, and duration</p>
                      </div>
                    </div>
                  </div>
                  {isReturningFromBuilder && (
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-400/40 px-3 py-1 text-sm font-medium">
                      <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                      Read-only
                    </Badge>
                  )}
                </div>
                <div className="border-t border-neutral-600" />
              </div>
            <div className="space-y-5">
              {/* Agent Image Placeholder - Centered */}
              <div className="flex justify-center">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (agentImagePreview) {
                      // Clear the image
                      onClearAgentImage?.();
                      if (imageInputRef.current) imageInputRef.current.value = '';
                    } else {
                      imageInputRef.current?.click();
                    }
                  }}
                  className={`relative group w-28 h-28 rounded-[1.75rem] transition-all duration-200 overflow-hidden outline-none focus:outline-none focus:ring-0 ${
                    agentImagePreview && !imageError
                      ? 'bg-white/[0.04] border border-white/40'
                      : showSpecialInstructions
                      ? 'bg-white/[0.06] border border-white/40 hover:bg-white/[0.09] hover:border-white/60'
                      : 'bg-white/[0.06] border border-white/40 hover:bg-white/[0.09] hover:border-white/60'
                  }`}
                  disabled={isReturningFromBuilder}
                >
                  {agentImagePreview && !imageError ? (
                    <>
                      {/* Show loader while image loads, then reveal full image */}
                      {imageLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-neutral-800/60 rounded-[1.75rem] z-10">
                          <Loader2 className="h-8 w-8 text-white/70 animate-spin" />
                        </div>
                      )}
                      <img
                        src={safeImageSrc(agentImagePreview)}
                        alt="Agent preview"
                        className={`w-full h-full object-cover rounded-[1.75rem] transition-opacity duration-300 ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                        onLoad={() => setImageLoading(false)}
                        onError={() => {
                          setImageLoading(false);
                          setImageError(true);
                        }}
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[1.75rem]">
                        <X className="h-6 w-6 text-rose-500" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full">
                      <ImagePlus className="h-10 w-10 text-white/90" />
                    </div>
                  )}
                </button>
              </div>

              {/* Form fields */}
              <div className="space-y-3.5">
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-neutral-300">Course Name <span className="text-red-500">*</span></Label>
                  <Input
                    className={`h-9 !bg-neutral-900/80 !border text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none ${
                      (isReturningFromBuilder || mode === "edit") ? "opacity-60 cursor-not-allowed !border-white/40 focus:!border-white/60 focus:!ring-white/30" : 
                      touchedFields.courseName && !courseName.trim() 
                        ? "!border-red-500 focus:!border-red-500 focus:!ring-red-500/30" 
                        : "!border-white/40 focus:!border-white/60 focus:!ring-white/30"
                    }`}
                    placeholder="e.g., Data Structures & Algorithms"
                    value={courseName}
                    onChange={(e) => {
                      if (isReturningFromBuilder || mode === "edit") return;
                      const value = e.target.value;
                      // Prevent leading spaces
                      if (value.length > 0 && courseName.length === 0 && value.trim() === '') return;
                      setCourseName(value.trimStart());
                    }}
                    onBlur={() => handleBlur('courseName')}
                    disabled={isReturningFromBuilder || mode === "edit"}
                  />
                  {touchedFields.courseName && !courseName.trim() && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Course name cannot be blank
                    </p>
                  )}

                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-300">Level <span className="text-red-500">*</span></Label>
                    <Select
                      value={isCustomLevel ? "__custom_level__" : courseLevel}
                      onValueChange={(v) => {
                        if (!isReturningFromBuilder) {
                          if (v === "__custom_level__") {
                            setCourseLevel("__custom_level__");
                            setCustomLevelText("");
                          } else {
                            setCourseLevel(v);
                            setCustomLevelText("");
                          }
                          setTouchedFields(prev => ({ ...prev, courseLevel: true }));
                        }
                      }}
                      disabled={isReturningFromBuilder}
                    >
                      <SelectTrigger className={`h-9 !bg-neutral-900/80 !border text-sm text-white data-[placeholder]:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none ${
                        isReturningFromBuilder ? "opacity-60 cursor-not-allowed !border-white/40" :
                        touchedFields.courseLevel && (!courseLevel || courseLevel === "__custom_level__")
                          ? "!border-red-500 focus:!border-red-500 focus:!ring-red-500/30"
                          : "!border-white/40 focus:!border-white/60 focus:!ring-white/30"
                      }`}>
                        <SelectValue placeholder="Select level..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Undergraduate">Undergraduate</SelectItem>
                        <SelectItem value="Postgraduate">Postgraduate</SelectItem>
                        <SelectItem value="Doctoral">Doctoral</SelectItem>
                        <SelectItem value="Diploma">Diploma</SelectItem>
                        <SelectItem value="Certificate">Certificate</SelectItem>
                        <SelectItem value="Professional">Professional</SelectItem>
                        <SelectItem value="__custom_level__">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustomLevel && (
                      <Input
                        className="h-8 mt-1.5 !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 focus:!ring-white/30"
                        placeholder="e.g., Foundation"
                        value={customLevelText || (isCustomLevel && courseLevel !== "__custom_level__" ? courseLevel : "")}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomLevelText(val);
                          if (val.trim()) {
                            setCourseLevel(val);
                          } else {
                            setCourseLevel("__custom_level__");
                          }
                        }}
                        onBlur={() => {
                          if (customLevelText.trim()) {
                            const trimmed = customLevelText.trim();
                            setCustomLevelText(trimmed);
                            setCourseLevel(trimmed);
                          }
                        }}
                        disabled={isReturningFromBuilder}
                      />
                    )}
                    {touchedFields.courseLevel && (!courseLevel || courseLevel === "__custom_level__") && (
                      <p className="text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Level cannot be blank
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-300">Duration <span className="text-red-500">*</span></Label>
                    <Select
                      value={isCustomDuration ? "__custom__" : courseSpan}
                      onValueChange={(v) => {
                        if (!isReturningFromBuilder) {
                          if (v === "__custom__") {
                            setCourseSpan("__custom__");
                            setCustomDurationNum("");
                            setCustomDurationUnit("");
                          } else {
                            setCourseSpan(v);
                            setCustomDurationNum("");
                            setCustomDurationUnit("");
                          }
                          setTouchedFields(prev => ({ ...prev, courseSpan: true }));
                        }
                      }}
                      disabled={isReturningFromBuilder}
                    >
                      <SelectTrigger className={`h-9 !bg-neutral-900/80 !border text-sm text-white data-[placeholder]:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none ${
                        isReturningFromBuilder ? "opacity-60 cursor-not-allowed !border-white/40" :
                        touchedFields.courseSpan && (!courseSpan || courseSpan === "__custom__")
                          ? "!border-red-500 focus:!border-red-500 focus:!ring-red-500/30"
                          : "!border-white/40 focus:!border-white/60 focus:!ring-white/30"
                      }`}>
                        <SelectValue placeholder="Select duration..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1 Month">1 Month</SelectItem>
                        <SelectItem value="1 Trimester">1 Trimester</SelectItem>
                        <SelectItem value="1 Semester">1 Semester</SelectItem>
                        <SelectItem value="1 Year">1 Year</SelectItem>
                        <SelectItem value="__custom__">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustomDuration && (
                      <div className="flex gap-2 mt-1.5">
                        <Input
                          className="h-8 w-24 !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 focus:!ring-white/30"
                          type="number"
                          min={1}
                          placeholder="e.g., 8"
                          value={customDurationNum}
                          onChange={(e) => {
                            const num = e.target.value;
                            setCustomDurationNum(num);
                            if (num && customDurationUnit) {
                              const n = parseInt(num);
                              const unit = n === 1 ? customDurationUnit : customDurationUnit + "s";
                              setCourseSpan(`${n} ${unit}`);
                            }
                          }}
                          disabled={isReturningFromBuilder}
                        />
                        <Select
                          value={customDurationUnit}
                          onValueChange={(u) => {
                            setCustomDurationUnit(u);
                            if (customDurationNum && u) {
                              const n = parseInt(customDurationNum);
                              const unit = n === 1 ? u : u + "s";
                              setCourseSpan(`${n} ${unit}`);
                            }
                          }}
                          disabled={isReturningFromBuilder}
                        >
                          <SelectTrigger className="h-8 flex-1 !bg-neutral-900/80 !border !border-white/40 text-sm text-white !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 focus:!ring-white/30">
                            <SelectValue placeholder="e.g., Weeks" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Week">Weeks</SelectItem>
                            <SelectItem value="Month">Months</SelectItem>
                            <SelectItem value="Trimester">Trimesters</SelectItem>
                            <SelectItem value="Semester">Semesters</SelectItem>
                            <SelectItem value="Year">Years</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {touchedFields.courseSpan && (!courseSpan || courseSpan === "__custom__") && (
                      <p className="text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Duration cannot be blank
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-300">Course Code <span className="text-red-500">*</span></Label>
                    <Input
                      className={`h-9 !bg-neutral-900/80 !border text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-1 focus-visible:!ring-0 focus-visible:!outline-none ${
                        isReturningFromBuilder ? "opacity-60 cursor-not-allowed !border-white/40 focus:!border-white/60 focus:!ring-white/30" :
                        touchedFields.courseCode && !courseCode.trim()
                          ? "!border-red-500 focus:!border-red-500 focus:!ring-red-500/30"
                          : "!border-white/40 focus:!border-white/60 focus:!ring-white/30"
                      }`}
                      placeholder="e.g., CS101"
                      value={courseCode}
                      onChange={(e) => !isReturningFromBuilder && setCourseCode(e.target.value)}
                      onBlur={() => handleBlur('courseCode')}
                      disabled={isReturningFromBuilder}
                    />
                    {touchedFields.courseCode && !courseCode.trim() && (
                      <p className="text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Course code cannot be blank
                      </p>
                    )}
                  </div>

                  <div className="space-y-1" ref={prereqRef}>
                    <Label className="text-sm font-medium text-neutral-300">Prerequisites <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isReturningFromBuilder) {
                            setPrereqDropdownOpen(!prereqDropdownOpen);
                            setTouchedFields(prev => ({ ...prev, prerequisites: true }));
                          }
                        }}
                        disabled={isReturningFromBuilder}
                        className={`flex items-center justify-between w-full h-9 rounded-md px-3 text-sm text-left !bg-neutral-900/80 border text-white placeholder:text-white/70 focus:!border-white/60 focus:!ring-1 focus:!ring-white/30 focus:outline-none ${
                          touchedFields.prerequisites && prerequisites.length === 0
                            ? "!border-red-500"
                            : "!border-white/40"
                        } ${
                          isReturningFromBuilder ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:!border-white/60"
                        }`}
                      >
                        <span className={prerequisites.length === 0 ? "text-white/70" : "text-white truncate"}>
                          {prerequisites.length === 0
                            ? "Select prerequisites..."
                            : prerequisites.includes("__none__")
                              ? "None"
                              : prerequisites.map((p) => {
                                  const agent = availableAgents.find((a) => a.name === p);
                                  const code = agent?.course_code;
                                  return code ? `${code} - ${getCourseName(p)}` : getCourseName(p);
                                }).join(", ")}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-white/50 shrink-0 ml-2 transition-transform ${prereqDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {prereqDropdownOpen && (
                        <div className="absolute z-50 mt-1 w-full max-h-60 rounded-xl border border-neutral-700/40 bg-neutral-900 shadow-2xl">
                          {/* Search input */}
                          <div className="sticky top-0 bg-neutral-900 p-2 border-b border-neutral-700/30 z-10">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                              <input
                                type="text"
                                className="w-full h-7 pl-8 pr-3 rounded-md bg-neutral-800 border border-neutral-700/50 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/50"
                                placeholder="Search courses..."
                                value={prereqSearch}
                                onChange={(e) => setPrereqSearch(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                              />
                            </div>
                          </div>
                          <div className="overflow-y-auto max-h-44">
                          {/* None option */}
                          {(!prereqSearch.trim() || "none".includes(prereqSearch.trim().toLowerCase())) && (
                            <button
                              type="button"
                              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors border-b border-neutral-700/30"
                              onClick={() => togglePrerequisite("__none__")}
                            >
                              <div className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                                prerequisites.includes("__none__") ? "bg-blue-600 border-blue-600" : "border-neutral-600"
                              }`}>
                                {prerequisites.includes("__none__") && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className="text-white">None</span>
                            </button>
                          )}
                          {(() => {
                            const q = prereqSearch.trim().toLowerCase();
                            const filtered = q
                              ? availableAgents.filter((a) => {
                                  const name = getCourseName(a.name).toLowerCase();
                                  const code = (a.course_code || "").toLowerCase();
                                  return name.includes(q) || code.includes(q);
                                })
                              : availableAgents;
                            return filtered.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-neutral-500">{q ? "No matching courses" : "No courses available"}</div>
                            ) : (
                              filtered.map((agent) => {
                                const isSelected = prerequisites.includes(agent.name);
                                const courseName = getCourseName(agent.name);
                                const code = agent.course_code;
                                return (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors"
                                    onClick={() => togglePrerequisite(agent.name)}
                                  >
                                    <div className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                                      isSelected ? "bg-blue-600 border-blue-600" : "border-neutral-600"
                                    }`}>
                                      {isSelected && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="text-white truncate">
                                      {code ? <><span className="text-neutral-400">{code}</span>{" - "}{courseName}</> : courseName}
                                    </span>
                                  </button>
                                );
                              })
                            );
                          })()}
                          </div>
                        </div>
                      )}
                    </div>
                    {touchedFields.prerequisites && prerequisites.length === 0 && (
                      <p className="text-xs text-red-400 mt-1">Prerequisites selection is required</p>
                    )}
                  </div>
                </div>

                <div className="border-t border-neutral-700 my-1" />

                <div className="space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-neutral-100">Course Description <span className="text-red-500">*</span></h4>
                      <p className="text-xs text-neutral-500 mt-0.5">Add course overview, syllabus, and learning outcomes</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCourseDescFormOpen(true)}
                      className="h-[30px] w-[30px] rounded-lg bg-neutral-800/60 border border-white/40 text-white hover:border-white/60 shadow-md shadow-black/30 inline-flex items-center justify-center transition-all duration-200"
                      title="Expand"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Inline description textarea */}
                  <Textarea
                    className="min-h-[80px] text-sm resize-none !bg-neutral-900/80 !border !border-white/40 text-white placeholder:text-white/70 focus:!border-white/60 focus:ring-0 !py-3"
                    placeholder="Course overview, syllabus, and learning outcomes..."
                    value={courseNotes}
                    onChange={(e) => setCourseNotes(e.target.value)}
                    onBlur={() => setTouchedFields(prev => ({ ...prev, courseNotes: true }))}
                  />

                  {/* Attachment */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-neutral-300">Attachment <span className="text-sm text-neutral-500 font-normal">(optional)</span></label>
                    <input
                      ref={descFileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json,.html,.htm,.xml,.rtf,.odt,.ods,.odp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setDescFile(f);
                        e.target.value = "";
                      }}
                    />
                    {descFile ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/20 bg-neutral-800">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        <span className="text-sm text-white truncate flex-1">{descFile.name}</span>
                        <button type="button" onClick={() => setDescFile(null)} className="p-0.5 rounded text-neutral-400 hover:text-red-400 transition-colors" title="Remove">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => descFileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-white/20 text-neutral-400 hover:border-white/40 hover:text-neutral-300 transition-colors"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span className="text-sm">Attach File</span>
                      </button>
                    )}
                  </div>

                  {/* Expanded description modal */}
                  {courseDescFormOpen && createPortal(
                    <div className="fixed inset-0 z-[60] flex items-center justify-center">
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCourseDescFormOpen(false)} />
                      <div className="relative w-full max-w-2xl mx-4 rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/50 p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold text-white">Course Description</h3>
                          <button type="button" onClick={() => setCourseDescFormOpen(false)} className="h-[2.125rem] rounded-xl px-[1.125rem] bg-neutral-800/60 border border-white/40 text-white text-[0.8125rem] hover:border-white/60 shadow-md shadow-black/30 inline-flex items-center justify-center transition-all duration-200">
                            Done
                          </button>
                        </div>
                        <Textarea
                          className="min-h-[320px] text-sm resize-none !bg-neutral-800 !border !border-white/20 text-white placeholder:text-neutral-500 focus:!border-white/40 focus:ring-1 focus:ring-white/20"
                          placeholder="Course overview, syllabus, and learning outcomes..."
                          value={courseNotes}
                          onChange={(e) => setCourseNotes(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                  , document.body)}
                </div>
                {touchedFields.courseNotes && !courseNotes.trim() && (
                  <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" /> Course Description cannot be blank
                  </p>
                )}
              </div>
            </div>

              {isReturningFromBuilder && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400/90">
                    <AlertCircle className="h-3 w-3 inline mr-1.5" />
                    Course details are locked. Only the knowledge base can be updated.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Special Instructions Section - Only shown in advanced edit mode */}
          {showSpecialInstructions && (
            <div className="p-6 rounded-xl border border-neutral-700/40 bg-neutral-900 shadow-lg shadow-black/20">
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-1">
                    <h3 className="text-lg font-semibold text-white">Special Instructions</h3>
                    <div className="relative group">
                      <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                        <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                        <p className="text-xs text-neutral-300">Customize how your agent behaves with special instructions</p>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-neutral-700/50" />
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-neutral-300">Instructions</Label>
                    <p className="text-xs text-neutral-500 mb-2">
                      Detailed instructions that define how your agent should behave
                    </p>
                    <Textarea
                      className="min-h-[150px] font-mono text-xs resize-none !bg-neutral-900/80 !border !border-white/40 text-white placeholder:text-white/70 focus:!border-white/60 focus:ring-1 focus:ring-white/30"
                      placeholder="Agent behavior instructions..."
                      value={cfgInstr}
                      onChange={(e) => setCfgInstr?.(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========== RESOURCES (Course + Exam merged) ========== */}
          {createsBothAgents ? (
            <div className="p-5 rounded-xl border border-white/40 bg-neutral-900 shadow-lg shadow-black/20">
              <div className="space-y-5">
                {/* Section Header */}
                <div className="space-y-3">
                  <div className="flex items-center gap-1">
                    <h3 className="text-lg font-semibold text-white">Course Resources</h3>
                    <div className="relative group">
                      <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                        <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <div className="absolute left-0 top-full mt-2 w-72 p-3 bg-neutral-800 border border-neutral-700 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                        <p className="text-xs text-neutral-300">Upload learning materials, exam papers, and study guides. Add URLs to relevant websites.</p>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-neutral-600" />
                </div>

                {/* Textbooks Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-semibold text-neutral-100">Textbooks <span className="text-red-500">*</span></h4>
                      <p className="text-xs text-neutral-500 mt-0.5">Add textbooks with details and optional PDF uploads</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { resetTextbookForm(); setEditingTextbookId(null); setTextbookFormOpen(true); }}
                        className="h-[2.125rem] rounded-xl px-[1.125rem] bg-neutral-800/60 border border-white/40 text-white text-[0.8125rem] hover:border-white/60 shadow-md shadow-black/30 inline-flex items-center justify-center gap-1.5 transition-all duration-200"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Textbook cards */}
                  {textbooks.length > 0 && (
                    <div className="space-y-2">
                      {textbooks.map((tb) => (
                        <div key={tb.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors shadow-sm shadow-black/20 border-white/[0.08] bg-white/[0.04] hover:border-white/[0.12]">
                          <BookOpen className="h-4 w-4 shrink-0 text-neutral-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-neutral-100">{tb.name}</p>
                            <p className="text-xs text-neutral-500">
                              {tb.edition && <span>{tb.edition} • </span>}
                              {tb.authors && tb.authors.length > 0 && <span>{tb.authors.join(', ')} • </span>}
                              <span className={tb.type === "primary" ? "text-blue-400" : "text-neutral-400"}>{tb.type === "primary" ? "Primary" : "Reference"}</span>
                              {tb.file && <span> • PDF attached</span>}
                            </p>
                          </div>
                          <button type="button" onClick={() => {
                            // Pre-populate form with this textbook's data for editing
                            setTbName(tb.name);
                            setTbEdition(tb.edition);
                            setTbAuthors(tb.authors || []);
                            setTbType(tb.type);
                            setTbDescription(tb.description || "");
                            setTbFile(tb.file || null);
                            setEditingTextbookId(tb.id);
                            setTextbookFormOpen(true);
                          }} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors" title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => onRemoveTextbook?.(tb.id)} className="p-1.5 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remove">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Textbook Modal/Dialog */}
                {textbookFormOpen && createPortal(
                  <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { resetTextbookForm(); setEditingTextbookId(null); setTextbookFormOpen(false); }} />
                    {/* Dialog */}
                    <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/50 p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">{editingTextbookId ? "Edit Textbook" : "Add Textbook"}</h3>
                        <button type="button" onClick={() => { resetTextbookForm(); setEditingTextbookId(null); setTextbookFormOpen(false); }} className="h-8 w-8 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm font-medium text-neutral-300">Name <span className="text-red-500">*</span></Label>
                            <Input
                              value={tbName}
                              onChange={(e) => setTbName(e.target.value)}
                              placeholder="e.g. Introduction to Algorithms"
                              className="h-9 !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-0 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm font-medium text-neutral-300">Type <span className="text-red-500">*</span></Label>
                            <Select value={tbType || undefined} onValueChange={(v) => setTbType(v as "primary" | "reference")}>
                              <SelectTrigger className={`h-9 !bg-neutral-900/80 !border !border-white/40 text-sm !ring-0 focus:!ring-0 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 ${tbType ? 'text-white' : 'text-white/70'}`}>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent className="bg-neutral-800 border-neutral-700 z-[70]">
                                <SelectItem value="primary" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Primary Textbook</SelectItem>
                                <SelectItem value="reference" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Reference Book</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm font-medium text-neutral-300">Edition</Label>
                            <Input
                              value={tbEdition}
                              onChange={(e) => setTbEdition(e.target.value)}
                              placeholder="e.g. 4th Edition"
                              className="h-9 !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-0 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm font-medium text-neutral-300">Authors</Label>
                            <div className="flex flex-wrap items-center gap-1.5 min-h-[2.25rem] px-2 py-1 rounded-lg !bg-neutral-900/80 !border !border-white/40 focus-within:!border-white/60 transition-colors">
                              {tbAuthors.map((author, i) => (
                                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-xs text-neutral-200">
                                  {author}
                                  <button type="button" onClick={() => setTbAuthors(tbAuthors.filter((_, j) => j !== i))} className="p-0 text-neutral-500 hover:text-red-400 transition-colors">
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                              <input
                                value={tbAuthorInput}
                                onChange={(e) => setTbAuthorInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if ((e.key === 'Enter' || e.key === ',') && tbAuthorInput.trim()) {
                                    e.preventDefault();
                                    if (!tbAuthors.includes(tbAuthorInput.trim())) {
                                      setTbAuthors([...tbAuthors, tbAuthorInput.trim()]);
                                    }
                                    setTbAuthorInput("");
                                  } else if (e.key === 'Backspace' && !tbAuthorInput && tbAuthors.length > 0) {
                                    setTbAuthors(tbAuthors.slice(0, -1));
                                  }
                                }}
                                onBlur={() => {
                                  if (tbAuthorInput.trim() && !tbAuthors.includes(tbAuthorInput.trim())) {
                                    setTbAuthors([...tbAuthors, tbAuthorInput.trim()]);
                                  }
                                  setTbAuthorInput("");
                                }}
                                placeholder={tbAuthors.length === 0 ? "Type name, press Enter" : ""}
                                className="bg-blend flex-1 min-w-[8rem] border-none outline-none text-sm text-white placeholder:text-white/70 p-0"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm font-medium text-neutral-300">Description</Label>
                          <textarea
                            value={tbDescription}
                            onChange={(e) => setTbDescription(e.target.value)}
                            placeholder="Brief notes about this textbook, e.g. chapters to cover, relevance to course"
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-0 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 resize-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm font-medium text-neutral-300">Attachment <span className="text-sm text-neutral-500 font-normal">(optional)</span></Label>
                          <input
                            ref={tbFileInputRef}
                            type="file"
                            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json,.html,.htm,.xml,.rtf,.odt,.ods,.odp,image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setTbFile(f);
                              e.target.value = "";
                            }}
                          />
                          {tbFile ? (
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg !border !border-white/40 !bg-neutral-900/80 h-9">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                              <span className="text-sm text-white truncate flex-1">{tbFile.name}</span>
                              <button type="button" onClick={() => setTbFile(null)} className="p-0.5 rounded text-neutral-400 hover:text-red-400 transition-colors" title="Remove">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => tbFileInputRef.current?.click()}
                              className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed !border-white/40 text-neutral-400 hover:!border-white/60 hover:text-neutral-300 transition-colors"
                            >
                              <Upload className="h-3.5 w-3.5" />
                              <span className="text-sm">Attach File</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Dialog footer */}
                      <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => { resetTextbookForm(); setTextbookFormOpen(false); }}
                          className="h-9 rounded-lg px-4 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleAddTextbook}
                          disabled={!tbName.trim() || !tbType}
                          className="h-9 rounded-lg px-5 bg-white/10 border border-white/20 text-sm font-medium text-white hover:bg-white/15 hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          {editingTextbookId ? "Save" : "Add"}
                        </button>
                      </div>
                    </div>
                  </div>
                , document.body)}

                {/* Divider between Textbooks and Learning */}
                <div className="border-t border-neutral-700" />

                {/* Additional Course Material Upload */}
                <div className="space-y-2.5">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-100">Additional Course Material</h4>
                    <p className="text-xs text-neutral-500 mt-0.5">Add PDFs, documents, past papers, question banks, or study guides</p>
                  </div>
                  {/* Drag and drop zone */}
                  <div
                    className="relative py-3 px-4 rounded-lg border-2 border-dashed border-neutral-600/50 hover:border-neutral-500/70 bg-neutral-800/30 hover:bg-neutral-800/50 text-center transition-colors cursor-pointer"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-blue-500/50', 'bg-blue-500/5'); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-blue-500/50', 'bg-blue-500/5'); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-blue-500/50', 'bg-blue-500/5'); const files = Array.from(e.dataTransfer.files); if (files.length > 0) onSelectKbUploads(files); }}
                    onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.pdf,.md,.doc,.docx,application/pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'; input.onchange = (ev) => { const files = Array.from((ev.target as HTMLInputElement).files || []); if (files.length > 0) onSelectKbUploads(files); }; input.click(); }}
                  >
                    <Upload className="h-4 w-4 text-neutral-500 mx-auto mb-1" />
                    <p className="text-xs text-neutral-400">Drag & drop files here, or <span className="text-white underline underline-offset-2">browse</span></p>
                    <p className="text-[0.65rem] text-neutral-600 mt-0.5">PDF, DOC, DOCX, MD</p>
                  </div>
                  {/* Loading state - only in edit mode */}
                  {mode === "edit" && loadingKbFiles && (
                    <div className="p-4 rounded-lg border border-dashed border-white/[0.08] text-center bg-white/[0.02]">
                      <div className="flex flex-col items-center gap-1">
                        <Loader2 className="h-5 w-5 text-neutral-400 animate-spin" />
                        <p className="text-xs text-neutral-500">Loading existing files...</p>
                      </div>
                    </div>
                  )}
                  {/* Show new uploads */}
                  {kbUploads.length > 0 && (
                    <div className="space-y-2">
                      {/* Only show label in edit mode when there are existing files */}
                      {mode === "edit" && kbFiles.length > 0 && (
                        <p className="text-xs font-medium text-neutral-400">New files to upload:</p>
                      )}
                      {(showAllUploads ? kbUploads : kbUploads.slice(0, 3)).map((f, idx) => (
                        <div key={fileKey(f)} className={`rounded-lg border transition-colors shadow-sm shadow-black/20 ${showSpecialInstructions ? 'border-pink-500/10 bg-pink-950/20 hover:border-pink-500/25' : 'border-white/[0.08] bg-white/[0.04] hover:border-white/[0.12]'}`}>
                          <div className="flex items-center gap-3 px-3 py-2">
                            <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-neutral-100">{f.name.replace(/\.[^/.]+$/, "")}</p>
                              <p className="text-xs text-neutral-500">{formatBytes(f.size)} • {f.name.split(".").pop()?.toUpperCase()}{kbFileDescriptions[f.name] ? " • Has description" : ""}</p>
                            </div>
                            {editingDescFile !== f.name ? (
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => { setEditingDescFile(f.name); setEditingDescValue(kbFileDescriptions[f.name] || ""); }} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors" title="Add description">
                                  <MdOutlineEditNote className="h-5 w-5" />
                                </button>
                                <button type="button" onClick={() => onRemoveUpload(idx)} className="p-1.5 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remove">
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setEditingDescFile(null)} className="px-3 py-1.5 text-xs rounded-md text-neutral-400 hover:text-white transition-colors">Cancel</button>
                                <button type="button" onClick={() => { setKbFileDescriptions?.({ ...kbFileDescriptions, [f.name]: editingDescValue.trim() }); setEditingDescFile(null); }} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">Save</button>
                              </div>
                            )}
                          </div>
                          {editingDescFile === f.name && (
                            <div className="px-3 pb-2">
                              <textarea
                                value={editingDescValue}
                                onChange={(e) => setEditingDescValue(e.target.value)}
                                placeholder="Brief description of this file (e.g. chapters covered, relevance to course)"
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg bg-neutral-900/80 border border-white/40 text-sm text-white placeholder:text-white/70 focus:outline-none focus:border-white/60 resize-y"
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {kbUploads.length > 3 && (
                        <button type="button" onClick={() => setShowAllUploads(!showAllUploads)} className="w-full text-xs text-neutral-400 hover:text-white text-center pt-1 transition-colors">
                          {showAllUploads ? "Show less" : `+${kbUploads.length - 3} more file${kbUploads.length - 3 !== 1 ? "s" : ""}`}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Show existing files in edit mode */}
                  {mode === "edit" && kbFiles.length > 0 && (
                    <div className="space-y-2">
                      {kbFiles.map((f) => (
                        <div key={f.filename} className="rounded-lg border transition-colors shadow-sm shadow-black/20 border-white/[0.08] bg-white/[0.04] hover:border-white/[0.12]">
                          <div className="flex items-center gap-3 px-3 py-2">
                            <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-neutral-100">{f.filename.replace(/\.[^/.]+$/, "")}</p>
                              <p className="text-xs text-neutral-500">{formatBytes(f.size)} • {f.filename.split(".").pop()?.toUpperCase()}{kbFileDescriptions[f.filename] ? " • Has description" : ""}</p>
                            </div>
                            {editingDescFile !== f.filename ? (
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => { setEditingDescFile(f.filename); setEditingDescValue(kbFileDescriptions[f.filename] || ""); }} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors" title="Add description">
                                  <MdOutlineEditNote className="h-5 w-5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onSoftDeleteKbFile?.(f.filename)}
                                  className="p-1.5 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Remove"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setEditingDescFile(null)} className="px-3 py-1.5 text-xs rounded-md text-neutral-400 hover:text-white transition-colors">Cancel</button>
                                <button type="button" onClick={() => { setKbFileDescriptions?.({ ...kbFileDescriptions, [f.filename]: editingDescValue.trim() }); setEditingDescFile(null); }} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">Save</button>
                              </div>
                            )}
                          </div>
                          {editingDescFile === f.filename && (
                            <div className="px-3 pb-2">
                              <textarea
                                value={editingDescValue}
                                onChange={(e) => setEditingDescValue(e.target.value)}
                                placeholder="Brief description of this file (e.g. chapters covered, relevance to course)"
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg bg-neutral-900/80 border border-white/40 text-sm text-white placeholder:text-white/70 focus:outline-none focus:border-white/60 resize-y"
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Divider before URLs */}
                <div className="border-t border-neutral-700" />

                {/* Course URLs */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-neutral-100">Course URLs</h4>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-neutral-700 text-neutral-300">Optional</span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-0.5">Add links to course websites, documentation, or exam prep resources</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCourseUrlFormOpen(true)}
                      className="h-[2.125rem] rounded-xl px-[1.125rem] bg-neutral-800/60 border border-white/40 text-white text-[0.8125rem] hover:border-white/60 shadow-md shadow-black/30 inline-flex items-center justify-center gap-1.5 transition-all duration-200"
                    >
                      Add
                    </button>
                  </div>

                  {/* URL cards */}
                  {courseUrls.length > 0 && (
                    <div className="space-y-1.5">
                      {courseUrls.map((entry) => (
                        <div key={entry.url} className="rounded-lg border px-3 py-2 shadow-sm shadow-black/20 border-white/[0.08] bg-white/[0.04] hover:border-white/[0.12] transition-colors">
                          <div className="flex items-center gap-2">
                            <svg className="h-3.5 w-3.5 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-sm text-neutral-300 hover:text-white truncate">{entry.url}</a>
                            <button type="button" onClick={() => removeCourseUrl(entry.url)} className="p-1.5 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0" title="Remove">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          {entry.description && (
                            <p className="text-xs text-neutral-500 mt-1 ml-5.5 pl-[1.375rem]">{entry.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Course URL Modal */}
                {courseUrlFormOpen && createPortal(
                  <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCourseUrlFormOpen(false)} />
                    <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/50 p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">Add Course URL</h3>
                        <button type="button" onClick={() => setCourseUrlFormOpen(false)} className="h-8 w-8 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-neutral-300 mb-1.5">URL <span className="text-red-500">*</span></label>
                          <div className="flex rounded-lg overflow-hidden !border !border-white/40 focus-within:!border-white/60 transition-colors">
                            <div className="flex items-center px-3.5 h-9 bg-neutral-800/60 border-r border-white/20">
                              <span className="text-xs font-medium text-neutral-300 select-none">https://</span>
                            </div>
                            <Input
                              className="h-9 !bg-neutral-900/80 !border-0 !shadow-none text-sm text-white placeholder:text-white/70 focus:!ring-0 focus:!outline-none focus-visible:!ring-0 focus-visible:!outline-none !rounded-none"
                              placeholder="Paste a URL and press Enter"
                              value={courseUrlInput}
                              onChange={(e) => setCourseUrlInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCourseUrl(); } }}
                              autoFocus
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral-300 mb-1.5">Description</label>
                          <textarea
                            className="w-full px-3 py-2 rounded-lg !bg-neutral-900/80 !border !border-white/40 text-sm text-white placeholder:text-white/70 !ring-0 focus:!ring-0 focus-visible:!ring-0 focus-visible:!outline-none focus:!border-white/60 resize-none"
                            placeholder="e.g. Only use chapters 3-7 for teaching, focus on the exercises section"
                            rows={2}
                            value={courseUrlDesc}
                            onChange={(e) => setCourseUrlDesc(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setCourseUrlFormOpen(false)}
                          className="h-9 rounded-lg px-4 text-sm text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => { addCourseUrl(); }}
                          disabled={!courseUrlInput.trim()}
                          className="h-9 rounded-lg px-5 bg-white/10 border border-white/20 text-sm font-medium text-white hover:bg-white/15 hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                , document.body)}
              </div>
            </div>
          ) : (
              /* ========== SINGLE MODE — Resources (merged) ========== */
              <div className="space-y-5 p-5 rounded-xl border border-white/40 bg-neutral-900 shadow-lg shadow-black/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <BookOpen className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Course Resources</h3>
                    <p className="text-xs text-neutral-500">Upload learning materials, exam papers, and study guides</p>
                  </div>
                </div>

              {/* Additional Course Material sub-section */}
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-base font-semibold text-neutral-100">Additional Course Material</h4>
                    <p className="text-xs text-neutral-500 mt-1">Add PDFs, documents, past papers, question banks, or study guides</p>
                  </div>
                  <DarkFileInput
                    fullWidth={false}
                    label="Upload"
                    multiple
                    accept=".pdf,.md,.doc,.docx,application/pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(files) => onSelectKbUploads(Array.from(files || []))}
                  />
                </div>

              {/* Uploaded files list */}
              {kbUploads.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {kbUploads.slice(0, 3).map((f, idx) => (
                    <div
                      key={fileKey(f)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 transition-colors"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-blue-400" />
                      <span className="text-sm font-medium text-neutral-100 truncate max-w-[180px]">
                        {f.name.replace(/\.[^/.]+$/, "")}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveUpload(idx)}
                        className="p-1 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition-colors ml-1"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {kbUploads.length > 3 && (
                    <div className="inline-flex items-center px-3 py-2 text-xs text-neutral-500">
                      +{kbUploads.length - 3} more
                    </div>
                  )}
                </div>
              )}

              {/* Existing KB files - Only show in EDIT mode when there are existing files */}
              {mode === "edit" && kbFiles.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-white">Current Files</p>
                  {loadingKbFiles && (
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading...
                    </div>
                  )}
                </div>

                {kbFilesError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
                    <p className="text-xs text-red-400">{kbFilesError}</p>
                  </div>
                )}

                {kbFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {kbFiles.map((f) => (
                      <div
                        key={f.filename}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 transition-colors"
                      >
                        <FileText className="h-4 w-4 text-blue-400" />
                        <span className="text-sm font-medium text-neutral-100 truncate max-w-[200px]">
                          {f.filename.replace(/\.[^/.]+$/, "")}
                        </span>
                        <div className="flex items-center gap-1 ml-1">
                          <a
                            href={f.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => setFileToDelete(f.filename)}
                            className="p-1 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Delete modal */}
              {fileToDelete && createPortal(
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-xl max-w-sm w-full p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30">
                        <AlertCircle className="h-5 w-5 text-red-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-base font-semibold text-white mb-1">Delete File?</h3>
                        <p className="text-sm text-neutral-400">
                          This will remove the file from the knowledge base.
                        </p>
                        <div className="mt-2 p-2 rounded-lg bg-neutral-800 border border-neutral-700">
                          <p className="text-sm font-medium text-neutral-200 truncate">
                            {fileToDelete}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFileToDelete(null)}
                        disabled={isDeletingFile}
                        className="flex-1 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <LoadingButton
                        variant="danger"
                        loading={isDeletingFile}
                        onClick={() => handleDeleteKbFile(fileToDelete)}
                        className="flex-1"
                        icon={Trash2}
                        height="h-9"
                      >
                        Delete
                      </LoadingButton>
                    </div>
                  </div>
                </div>
              , document.body)}

              {vectorStoreId && (
                <div className="mt-3">
                  <StatusBadge
                    type="success"
                    message={
                      isReturningFromBuilder
                        ? "Knowledge base can be updated"
                        : "Knowledge base ready"
                    }
                  />
                </div>
              )}
              </div>

              {/* Course URLs */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Layers className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Course URLs</h3>
                    <p className="text-xs text-neutral-500">Add links to course websites, documentation, or exam prep resources</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Input
                    className="h-10 bg-neutral-800/50 border-neutral-700/50 text-white placeholder:text-neutral-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
                    placeholder="Paste a URL and press Enter"
                    value={courseUrlInput}
                    onChange={(e) => setCourseUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCourseUrl();
                      }
                    }}
                  />

                  {courseUrls.length > 0 && (
                    <div className="space-y-1.5">
                      {courseUrls.map((entry) => (
                        <div
                          key={entry.url}
                          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="h-3.5 w-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 flex-1 text-sm text-neutral-300 hover:text-white truncate"
                              onClick={(e) => e.stopPropagation()}
                              title={entry.url}
                            >
                              {entry.url}
                            </a>
                            <button
                              type="button"
                              onClick={() => removeCourseUrl(entry.url)}
                              className="p-1 rounded text-neutral-500 hover:text-red-400 transition-colors shrink-0"
                              title="Remove"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {entry.description && (
                            <p className="text-xs text-neutral-500 mt-1 pl-[1.375rem]">{entry.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </div>
            )}

          {/* ========== Conversation Starters ========== */}
          {setConversationStarters && (
            <div className="p-5 rounded-xl border border-white/40 bg-neutral-900 shadow-lg shadow-black/20">
              <div className="space-y-5">
                {/* Section Header */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <h3 className="text-lg font-semibold text-white">Conversation Starters</h3>
                      <div className="relative group">
                        <button type="button" className="p-1 rounded-full hover:bg-neutral-700/50 transition-colors">
                          <svg className="h-4 w-4 text-neutral-500 hover:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <div className="absolute left-0 top-full mt-2 w-72 p-3 bg-neutral-800 border border-neutral-700 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                          <p className="text-xs text-neutral-300">Suggested prompts shown to students when they start a chat.</p>
                        </div>
                      </div>
                    </div>
                    {conversationStarters.length < 6 && (
                      <button
                        type="button"
                        onClick={() => setConversationStarters([...conversationStarters, { title: "", prompt: "" }])}
                        className="h-[2.125rem] rounded-xl px-[1.125rem] bg-neutral-800/60 border border-white/40 text-white text-[0.8125rem] hover:border-white/60 shadow-md shadow-black/30 inline-flex items-center justify-center gap-1.5 transition-all duration-200"
                      >
                        Add
                      </button>
                    )}
                  </div>
                  <div className="border-t border-neutral-600" />
                </div>

                {/* Existing starters */}
                {conversationStarters.length > 0 && (
                  <div className="space-y-0">
                    {/* Rows */}
                    <div className="space-y-2">
                      {conversationStarters.map((starter, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 group"
                        >
                          <span className="text-sm text-neutral-500 w-5 shrink-0 text-center">{idx + 1}.</span>
                          <input
                            type="text"
                            value={starter.prompt}
                            onChange={(e) => {
                              if (idx === 0) return; // First starter is fixed
                              const updated = [...conversationStarters];
                              updated[idx] = { ...updated[idx], prompt: e.target.value, title: e.target.value.slice(0, 40) };
                              setConversationStarters(updated);
                            }}
                            placeholder="Enter a conversation starter"
                            className={`flex-1 h-10 px-3 rounded-lg border text-sm focus:outline-none ${idx === 0 ? "bg-neutral-800 border-neutral-700 text-neutral-500 cursor-not-allowed opacity-50 select-none" : "bg-white/[0.04] border-white/[0.08] text-neutral-100 placeholder:text-neutral-600 focus:border-white/20 focus:ring-1 focus:ring-white/10"}`}
                            disabled={idx === 0}
                            title={idx === 0 ? "This starter is fixed and cannot be edited" : undefined}
                          />
                          {idx === 0 ? (
                          <button
                            type="button"
                            disabled
                            className="p-1.5 rounded-lg text-neutral-700 cursor-not-allowed shrink-0"
                            title="Cannot remove first starter"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          ) : conversationStarters.length > 2 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setConversationStarters(conversationStarters.filter((_, i) => i !== idx));
                            }}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                            title="Remove starter"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          ) : null}
                          <GripVertical className={`h-4 w-4 shrink-0 ${idx === 0 ? "text-neutral-700" : "text-neutral-600 cursor-grab"}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {conversationStarters.length === 0 && (
                  <div className="p-4 rounded-lg border border-dashed border-neutral-700 text-center bg-neutral-800/30">
                    <p className="text-sm text-neutral-400">No conversation starters yet</p>
                    <p className="text-xs text-neutral-500 mt-1">Add suggestions to help students start chatting</p>
                  </div>
                )}

                {/* Minimum starters hint */}
                {conversationStarters.length > 0 && conversationStarters.filter(s => s.prompt.trim()).length < 2 && (
                  <p className="text-xs text-amber-400/80">Minimum 2 non-empty starters required ({conversationStarters.filter(s => s.prompt.trim()).length}/2)</p>
                )}


              </div>
            </div>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}