// features/create/sharedUI.tsx

import React from "react";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertCircle, Sparkles, ArrowUp, Plus, Square, Globe, X, FileText, File, SlidersHorizontal, Search, Paperclip, Mic, CircleHelp, Target, CornerDownRight } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  LABEL,
  KICKER,
} from "./designSystem";

/* ----------------------------- Chat Input ----------------------------- */

// Uploaded file type with preview
export type UploadedFile = {
  id: string;
  file: File;
  preview?: string;
};

type ComposerAction = {
  id: "concept-inventory" | "challenge" | "document";
  command: string;
  label: string;
  description: string;
  prompt: string;
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  iconBackground: string;
};

const COMPOSER_ACTIONS: ComposerAction[] = [
  {
    id: "concept-inventory",
    command: "/inventory",
    label: "Concept inventory",
    description: "Create a diagnostic concept check",
    prompt: "Create a concept inventory about ",
    keywords: ["inventory", "concept", "quiz", "check"],
    icon: CircleHelp,
    iconClass: "text-violet-300",
    iconBackground: "bg-violet-500/15",
  },
  {
    id: "challenge",
    command: "/challenge",
    label: "Challenge",
    description: "Create a guided problem with hints",
    prompt: "Create a challenge about ",
    keywords: ["challenge", "problem", "practice"],
    icon: Target,
    iconClass: "text-amber-300",
    iconBackground: "bg-amber-500/15",
  },
  {
    id: "document",
    command: "/document",
    label: "Document",
    description: "Create structured notes or a study guide",
    prompt: "Create a document about ",
    keywords: ["document", "notes", "guide", "summary"],
    icon: FileText,
    iconClass: "text-cyan-300",
    iconBackground: "bg-cyan-500/15",
  },
];

function slashCommandContext(value: string): { start: number; query: string } | null {
  const match = value.match(/(^|\s)\/([a-z-]*)$/i);
  if (!match) return null;
  return {
    start: value.length - match[2].length - 1,
    query: match[2].toLowerCase(),
  };
}

type ChatInputProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: (attachedFiles?: UploadedFile[], overrideText?: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: (enabled: boolean) => void;
  showWebSearchToggle?: boolean;
  // Deep Research
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: (enabled: boolean) => void;
  showDeepResearchButton?: boolean;
  isDeepResearching?: boolean;
  quotedText?: string;
  onClearQuotedText?: () => void;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  isSending,
  placeholder = "Ask anything",
  webSearchEnabled = false,
  onWebSearchToggle,
  showWebSearchToggle = false,
  deepResearchEnabled = false,
  onDeepResearchToggle,
  showDeepResearchButton = false,
  isDeepResearching = false,
  quotedText,
  onClearQuotedText,
}: ChatInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const slashMenuRef = React.useRef<HTMLDivElement>(null);
  const currentValueRef = React.useRef(value);
  const [showPlusMenu, setShowPlusMenu] = React.useState(false);
  const [showToolsMenu, setShowToolsMenu] = React.useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = React.useState(0);
  const [dismissedSlashValue, setDismissedSlashValue] = React.useState<string | null>(null);
  const [activeAction, setActiveAction] = React.useState<ComposerAction | null>(null);
  // Track the "base" text (everything before the current interim chunk)
  const baseTextRef = React.useRef(value);

  // Keep baseTextRef in sync when user types manually (not during interim injection)
  const inInterimRef = React.useRef(false);
  React.useEffect(() => {
    currentValueRef.current = value;
    if (!inInterimRef.current) {
      baseTextRef.current = value;
    }
  }, [value]);

  const slashContext = slashCommandContext(value);
  const filteredComposerActions = React.useMemo(() => {
    const query = slashContext?.query || "";
    if (!query) return COMPOSER_ACTIONS;
    return COMPOSER_ACTIONS.filter((action) =>
      [action.id, action.command.slice(1), action.label, ...action.keywords]
        .some((term) => term.toLowerCase().startsWith(query)),
    );
  }, [slashContext?.query]);
  const showSlashMenu = Boolean(
    slashContext
      && dismissedSlashValue !== value
      && filteredComposerActions.length > 0
      && !disabled,
  );
  const selectedCommandIndex = Math.min(
    activeCommandIndex,
    Math.max(0, filteredComposerActions.length - 1),
  );

  React.useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashContext?.query]);

  const emitValue = (nextValue: string) => {
    inInterimRef.current = false;
    baseTextRef.current = nextValue;
    currentValueRef.current = nextValue;
    onChange({ target: { value: nextValue } } as React.ChangeEvent<HTMLTextAreaElement>);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });
  };

  // The action becomes an inline chip; its prompt is prepended on send.
  const selectComposerAction = (action: ComposerAction, fromSlash: boolean) => {
    const context = fromSlash ? slashCommandContext(value) : null;
    setShowPlusMenu(false);
    setDismissedSlashValue(null);
    setActiveAction(action);
    emitValue(context ? value.slice(0, context.start).trimEnd() : value);
  };

  // ---- Mic sound helper (Web Audio API) ----
  const playMicSound = React.useCallback((start: boolean) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      if (start) {
        osc.frequency.setValueAtTime(600, now);
      } else {
        osc.frequency.setValueAtTime(700, now);
      }
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      osc.onended = () => ctx.close();
    } catch (e) { console.warn("Mic sound failed:", e); }
  }, []);

  // ---- Speech-to-text ----
  const speech = useSpeechRecognition({
    language: "en-US",
    onInterim: (text) => {
      if (!text) return;
      inInterimRef.current = true;
      const base = baseTextRef.current;
      const next = base ? `${base} ${text}` : text;
      onChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
    },
    onFinal: (text) => {
      inInterimRef.current = false;
      if (!text) return;
      const base = baseTextRef.current;
      const next = base ? `${base} ${text}` : text;
      baseTextRef.current = next;
      onChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
    },
  });
  const isListening = speech.state === "listening" || speech.state === "starting";
  const isStarting = speech.state === "starting";

  // ---- Play sound on state transitions (starting→listening, listening→idle) ----
  const prevSpeechState = React.useRef(speech.state);
  React.useEffect(() => {
    const prev = prevSpeechState.current;
    const curr = speech.state;
    prevSpeechState.current = curr;
    if (prev === "starting" && curr === "listening") {
      playMicSound(true);
    } else if ((prev === "listening" || prev === "starting") && curr === "idle") {
      playMicSound(false);
    }
  }, [speech.state, playMicSound]);

  // Scale the mic button 1x → 1.4x based on voice loudness
  const micScale = isListening ? 1 + speech.volume * 0.2 : 1;

  // Determine the listening status text
  const listeningStatusText = isStarting ? "Loading..." : "Listening...";
  
  // Show "Listening..." after existing text when mic is active and no interim speech  
  const showListeningHint = isListening && value && !inInterimRef.current;
  const [uploadedFiles, setUploadedFiles] = React.useState<{ id: string; file: File; preview?: string }[]>([]);
  const [previewImage, setPreviewImage] = React.useState<{ id: string; preview: string } | null>(null);

  // Check if file is an image
  const isImageFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  };

  // Get file type info for display
  const getFileTypeInfo = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return { label: 'PDF', bgColor: 'bg-red-500', icon: FileText };
    if (ext === 'md') return { label: 'File', bgColor: 'bg-blue-500', icon: FileText };
    if (ext === 'txt') return { label: 'Text', bgColor: 'bg-gray-500', icon: FileText };
    if (ext === 'doc' || ext === 'docx') return { label: 'Word', bgColor: 'bg-blue-600', icon: FileText };
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return { label: 'Image', bgColor: 'bg-green-500', icon: File };
    return { label: 'File', bgColor: 'bg-blue-500', icon: FileText };
  };
  const plusMenuRef = React.useRef<HTMLDivElement>(null);
  const toolsMenuRef = React.useRef<HTMLDivElement>(null);
  const MAX_HEIGHT = 180;
  const MIN_HEIGHT = 28;

  // Determine which tools are available and active
  const hasAnyTools = showWebSearchToggle || showDeepResearchButton;
  const activeTools: { id: string; label: string; icon: React.ReactNode; onRemove: () => void }[] = [];
  if (webSearchEnabled && onWebSearchToggle) {
    activeTools.push({
      id: "web-search",
      label: "Web Search",
      icon: <Globe className="h-4 w-4" />,
      onRemove: () => onWebSearchToggle(false),
    });
  }
  if (deepResearchEnabled && onDeepResearchToggle) {
    activeTools.push({
      id: "deep-research",
      label: "Deep Research",
      icon: <Search className="h-4 w-4" />,
      onRemove: () => onDeepResearchToggle(false),
    });
  }

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFiles = Array.from(files).map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        preview: isImageFile(file.name) ? URL.createObjectURL(file) : undefined
      }));
      setUploadedFiles(prev => [...prev, ...newFiles]);
      // Reset the input so the same file can be selected again
      event.target.value = '';
    }
  };

  // Remove uploaded file
  const removeFile = (id: string) => {
    setUploadedFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove?.preview) {
        URL.revokeObjectURL(fileToRemove.preview);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  // Close menus when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setShowPlusMenu(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setShowToolsMenu(false);
      }
      if (
        slashMenuRef.current
        && !slashMenuRef.current.contains(event.target as Node)
        && !textareaRef.current?.contains(event.target as Node)
      ) {
        setDismissedSlashValue(currentValueRef.current);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-grow textarea on value change or when textarea re-appears after listening overlay
  React.useLayoutEffect(() => {
    if (textareaRef.current) {
      // If empty, reset to minimum height
      if (!value.trim()) {
        textareaRef.current.style.height = `${MIN_HEIGHT}px`;
        textareaRef.current.style.overflowY = 'hidden';
        return;
      }
      
      // Reset height to 0 to get accurate scrollHeight
      textareaRef.current.style.height = '0px';
      const scrollHeight = textareaRef.current.scrollHeight;
      
      // Cap at MAX_HEIGHT
      if (scrollHeight > MAX_HEIGHT) {
        textareaRef.current.style.height = `${MAX_HEIGHT}px`;
        textareaRef.current.style.overflowY = 'auto';
      } else {
        textareaRef.current.style.height = `${Math.max(scrollHeight, MIN_HEIGHT)}px`;
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
    // Sync overlay dimensions with textarea
    if (textareaRef.current && overlayRef.current && showListeningHint) {
      const ta = textareaRef.current;
      const scrollbarW = ta.offsetWidth - ta.clientWidth;
      overlayRef.current.style.paddingRight = `${scrollbarW}px`;
      overlayRef.current.style.height = ta.style.height;
      overlayRef.current.scrollTop = ta.scrollTop;
    }
  }, [value, showListeningHint]);

  // Handle sending message with files
  const handleSendWithFiles = () => {
    if (!disabled && !isSending && (value.trim() || uploadedFiles.length > 0)) {
      const composed = activeAction ? `${activeAction.prompt}${value.trim()}` : undefined;
      onSend(uploadedFiles.length > 0 ? uploadedFiles : undefined, composed);
      // Clear uploaded files after sending
      // NOTE: Don't revoke preview URLs - they're needed for displaying in chat messages
      // They'll be garbage collected when the page is refreshed
      setUploadedFiles([]);
      setActiveAction(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredComposerActions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveCommandIndex((index) => (index + 1) % filteredComposerActions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveCommandIndex(
          (index) => (index - 1 + filteredComposerActions.length) % filteredComposerActions.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectComposerAction(filteredComposerActions[selectedCommandIndex], true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedSlashValue(value);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendWithFiles();
    }
    // Shift+Enter = new line (default behavior, no preventDefault)
  };

  // Handle paste event for clipboard images
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const imageFiles: File[] = [];
    
    // Method 1: Check clipboardData.files (for some browsers)
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }
    }
    
    // Method 2: Check clipboardData.items (for other browsers like Chrome)
    if (imageFiles.length === 0 && clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            // Rename the file by creating a new File from the blob
            const extension = item.type.split('/')[1] || 'png';
            const fileName = `pasted-image-${Date.now()}.${extension}`;
            // Use Object.assign to add name property to the file
            const namedFile = Object.assign(blob, { name: fileName }) as File;
            imageFiles.push(namedFile);
          }
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images
      
      // Add pasted images to uploaded files
      const newFiles = imageFiles.map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        preview: URL.createObjectURL(file)
      }));
      setUploadedFiles(prev => [...prev, ...newFiles]);
    }
  };

  return (
    <div className="w-full">
      {/* Joins onto the input box below: no bottom edge, and the box drops its top one */}
      {quotedText && (
        <div className="flex items-start gap-2.5 rounded-t-[22px] border border-b-0 border-neutral-500 bg-black/25 px-4 py-3">
          <CornerDownRight className="mt-[3px] h-3.5 w-3.5 shrink-0 text-neutral-500" />
          <p className="min-w-0 flex-1 max-h-[4.5rem] overflow-hidden whitespace-pre-wrap break-words text-[13px] leading-snug text-neutral-100">
            {quotedText}
          </p>
          <button
            type="button"
            onClick={onClearQuotedText}
            aria-label="Remove quoted text"
            className="shrink-0 rounded-full p-0.5 text-neutral-500 transition-colors hover:bg-white/[0.08] hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="relative w-full">
        {showSlashMenu && (
          <div
            ref={slashMenuRef}
            role="listbox"
            aria-label="Create content"
            className="absolute bottom-[calc(100%+0.4rem)] left-0 z-50 w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700/70 bg-neutral-900 p-1 shadow-xl shadow-black/40"
          >
            {filteredComposerActions.map((action, index) => {
              const Icon = action.icon;
              const selected = index === selectedCommandIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectComposerAction(action, true)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
                    selected ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-800/70"
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${action.iconBackground}`}>
                    <Icon className={`h-3.5 w-3.5 ${action.iconClass}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{action.label}</span>
                    <span className="block truncate text-[10px] text-neutral-500">{action.description}</span>
                  </span>
                  <span className="hidden shrink-0 font-mono text-[9px] text-neutral-600 md:block">
                    {action.command}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {/* Outer glow ring */}
        <div className="absolute -inset-[1px] rounded-[23px] bg-gradient-to-b from-neutral-500/10 via-neutral-600/5 to-neutral-700/10 blur-[1px] pointer-events-none" />
        <div className={`relative bg-neutral-900 border border-neutral-500 ${quotedText ? "rounded-b-[22px] border-t-0" : "rounded-[22px]"} pl-4 pr-4 pt-4 pb-[52px] shadow-[0_2px_16px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]`}>
          {/* Uploaded files preview */}
          {uploadedFiles.length > 0 && (
            <div className="flex gap-3 mb-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {uploadedFiles.map((uploadedFile) => {
                const fileInfo = getFileTypeInfo(uploadedFile.file.name);
                const IconComponent = fileInfo.icon;
                const isImage = isImageFile(uploadedFile.file.name);
                
                // Image thumbnail display
                if (isImage && uploadedFile.preview) {
                  return (
                    <div key={uploadedFile.id} className="relative flex-shrink-0 w-16 h-16 rounded-xl border border-neutral-600 overflow-hidden">
                      <img
                        src={uploadedFile.preview}
                        alt="Upload preview"
                        className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPreviewImage({ id: uploadedFile.id, preview: uploadedFile.preview! })}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(uploadedFile.id);
                        }}
                        className="absolute top-1 right-1 bg-white hover:bg-neutral-200 rounded-full p-0.5 transition-colors"
                      >
                        <X className="h-3 w-3 text-black" />
                      </button>
                    </div>
                  );
                }
                
                // Card display for non-image files
                return (
                  <div 
                    key={uploadedFile.id} 
                    className="relative flex-shrink-0 flex items-center gap-3 bg-neutral-700/50 border border-neutral-600 rounded-2xl px-3 py-2 h-16 min-w-[180px] max-w-[280px]"
                  >
                    {/* File icon */}
                    <div className={`flex-shrink-0 w-9 h-9 ${fileInfo.bgColor} rounded-xl flex items-center justify-center`}>
                      <IconComponent className="h-5 w-5 text-white" />
                    </div>
                    {/* File info */}
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="text-sm text-neutral-100 font-medium truncate">{uploadedFile.file.name}</p>
                      <p className="text-xs text-neutral-400">{fileInfo.label}</p>
                    </div>
                    {/* Remove button - top right corner */}
                    <button
                      type="button"
                      onClick={() => removeFile(uploadedFile.id)}
                      className="absolute top-1 right-1 bg-white hover:bg-neutral-200 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-3 w-3 text-black" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Image Preview Modal */}
          {previewImage && (
            <div 
              className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]"
              onClick={() => setPreviewImage(null)}
            >
              <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                <img
                  src={previewImage.preview}
                  alt="Preview"
                  className="max-w-full max-h-[85vh] object-contain rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="absolute -top-3 -right-3 bg-neutral-800 hover:bg-neutral-700 rounded-full p-1.5 transition-colors"
                >
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
          )}
          
          {/* Input row with an optional inline create action */}
          <div className="flex w-full items-start gap-3">
            {activeAction && (
              <span className="mt-0.5 inline-flex h-8 max-w-[60%] shrink-0 items-center gap-2 rounded-full border border-neutral-600/60 bg-neutral-900/70 pl-2 pr-1.5 text-sm text-neutral-100">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${activeAction.iconBackground}`}>
                  <activeAction.icon className={`h-3.5 w-3.5 ${activeAction.iconClass}`} />
                </span>
                <span className="truncate font-medium">{activeAction.label}</span>
                <button
                  type="button"
                  onClick={() => setActiveAction(null)}
                  className="shrink-0 rounded-full p-0.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white"
                  aria-label={`Remove ${activeAction.label}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}

          {/* Input field */}
          <div className="relative min-w-0 flex-1">
          <Textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            readOnly={isListening}
            placeholder={isListening ? listeningStatusText : placeholder}
            onScroll={() => {
              if (overlayRef.current && textareaRef.current) {
                overlayRef.current.scrollTop = textareaRef.current.scrollTop;
              }
            }}
            className="
              w-full resize-none min-h-[28px] rounded-none
              py-1 px-0 !leading-[1.75]
              !bg-transparent border-0
              text-neutral-300 placeholder:text-neutral-500
              focus:outline-none focus:ring-0 focus-visible:ring-0 focus:border-0
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            style={{
              boxShadow: 'none', backgroundColor: 'transparent', outline: 'none',
              border: 'none', borderRadius: 0, fontSize: '16px',
              ...(showListeningHint ? { color: 'transparent', WebkitTextFillColor: 'transparent', userSelect: 'none' as const } : {}),
            }}
          />
          {showListeningHint && (
            <div
              ref={overlayRef}
              className="absolute top-0 left-0 right-0 pointer-events-none py-1 px-0 leading-[1.75] whitespace-pre-wrap break-words"
              style={{ fontSize: '16px', overflowY: 'hidden' }}
              aria-hidden
            >
              <span className="text-neutral-300">{value}</span>
              <span className="text-neutral-500"> {listeningStatusText}</span>
            </div>
          )}
          </div>
          </div>

          {/* Plus button with dropdown menu - pinned bottom left, aligned with text */}
          <div className="absolute left-3 bottom-2" ref={plusMenuRef}>
            {/* Hidden file inputs - separate for images and files */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
              multiple
              className="hidden"
              data-type="images"
            />
            <input
              type="file"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.txt,.md,application/pdf"
              multiple
              className="hidden"
              id="file-input-docs"
            />
            
            <button
              type="button"
              onClick={() => {
                if (disabled) return;
                setShowPlusMenu(!showPlusMenu);
                setDismissedSlashValue(currentValueRef.current);
              }}
              disabled={disabled}
              className={`size-9 rounded-lg flex items-center justify-center transition-colors outline-none ${disabled ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:bg-neutral-700/60 hover:text-neutral-100'}`}
              aria-label="Add"
              aria-expanded={showPlusMenu}
            >
              <Plus className="h-5 w-5 stroke-[1.75]" />
            </button>
            
            {/* Dropdown menu */}
            {showPlusMenu && (
              <div className="absolute bottom-10 left-0 bg-[#2a2a2a] rounded-xl shadow-2xl z-50 min-w-[208px] border border-neutral-700/40 px-1.5 py-1.5 flex flex-col gap-0.5">
                {COMPOSER_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-neutral-200 transition-colors hover:bg-neutral-700/40 hover:text-white"
                      onClick={() => selectComposerAction(action, false)}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${action.iconBackground}`}>
                        <Icon className={`h-[14px] w-[14px] ${action.iconClass}`} />
                      </span>
                      <span>{action.label}</span>
                    </button>
                  );
                })}
                <div className="my-1 h-px bg-neutral-700/60" />
                <button
                  type="button"
                  className="flex items-center gap-2.5 px-2 py-1.5 text-[13px] font-medium text-neutral-200 hover:bg-neutral-700/30 hover:text-white transition-colors text-left w-full rounded-lg"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowPlusMenu(false);
                  }}
                >
                  <Paperclip className="h-[15px] w-[15px] stroke-[1.5] text-neutral-400" />
                  <span>Attach images</span>
                </button>
                <div
                  className="relative group/upload flex items-center gap-2.5 px-2 py-1.5 text-[13px] font-medium text-neutral-600 text-left w-full rounded-lg cursor-default"
                >
                  <FileText className="h-[15px] w-[15px] stroke-[1.5] text-neutral-600" />
                  <span>Upload files</span>
                  <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 text-xs text-white bg-black border border-neutral-600 rounded-md whitespace-nowrap opacity-0 group-hover/upload:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">Coming soon</span>
                </div>
              </div>
            )}
          </div>

          {/* Tools Button - disabled (coming soon) */}
          {hasAnyTools && (
            <div className="absolute left-[50px] bottom-2 flex items-center gap-1.5" ref={toolsMenuRef}>
              <div
                className="
                  relative group/tools h-9 px-2 gap-1.5
                  flex items-center justify-center
                  text-neutral-600 cursor-default
                "
              >
                <SlidersHorizontal className="h-[18px] w-[18px] stroke-[1.75]" />
                <span className="text-sm font-medium">Tools</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-xs text-white bg-black border border-neutral-600 rounded-md whitespace-nowrap opacity-0 group-hover/tools:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">Coming soon</span>
              </div>
            </div>
          )}

          {/* Action buttons - pinned bottom right */}
          <div className="absolute right-2.5 bottom-2 flex items-center gap-1.5">
            {/* Mic button — always visible unless sending */}
            {!(isSending && onStop) && (
              <button
                type="button"
                onClick={() => !disabled && speech.toggle()}
                onPointerEnter={() => !disabled && speech.prewarm()}
                onPointerDown={() => !disabled && speech.prewarm()}
                disabled={disabled}
                className={`
                  size-9 rounded-full shrink-0
                  flex items-center justify-center
                  outline-none focus:outline-none
                  ${disabled
                    ? "bg-transparent text-neutral-600 cursor-not-allowed"
                    : isListening
                      ? "bg-neutral-200 text-neutral-900 transition-colors duration-200 ease-out"
                      : "bg-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/60 transition-all duration-200 ease-out"
                  }
                `}
                aria-label={isListening ? "Stop recording" : "Start recording"}
                title={isListening ? "Stop recording" : "Voice input"}
              >
                {isListening ? (
                  <div className="flex items-center justify-center gap-[4px]" style={{ height: 20 }}>
                    {speech.state === "starting"
                      ? [0, 1, 2].map(i => (
                          <div key={i} className="bg-neutral-900" style={{
                            width: 5,
                            height: 8,
                            borderRadius: 9999,
                            animation: `dot-wave 1.2s ease-in-out infinite`,
                            animationDelay: `${i * 0.2}s`,
                          }} />
                        ))
                      : speech.bands.map((b, i) => (
                          <div key={i} className="bg-neutral-900" style={{
                            width: 5,
                            height: Math.round(8 + b * 7),
                            borderRadius: 9999,
                            transition: 'height 100ms ease-out',
                          }} />
                        ))
                    }
                  </div>
                ) : (
                  <Mic className="h-[18px] w-[18px] stroke-[2]" />
                )}
              </button>
            )}

            {/* Send / Stop button — send uses width animation for smooth entry */}
            {isSending && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="
                  size-9 rounded-full shrink-0
                  bg-neutral-700
                  flex items-center justify-center
                  transition-all duration-150 ease-out outline-none focus:outline-none
                  hover:bg-neutral-600 hover:scale-105
                "
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-white text-white" />
              </button>
            ) : (() => {
              const hasContent = !!(value.trim() || uploadedFiles.length > 0);
              return (
                <div
                  className="transition-all duration-200 ease-out overflow-hidden"
                  style={{ width: hasContent ? 36 : 0, opacity: hasContent ? 1 : 0 }}
                >
                  <button
                    type="button"
                    onClick={handleSendWithFiles}
                    disabled={disabled || isSending || !hasContent}
                    className="
                      size-9 rounded-full shrink-0
                      bg-neutral-200
                      flex items-center justify-center
                      disabled:cursor-not-allowed
                      transition-colors duration-150 ease-out outline-none focus:outline-none
                      hover:bg-white
                    "
                    aria-label="Send message"
                  >
                    <ArrowUp className="h-[18px] w-[18px] stroke-[2.5] text-neutral-900" />
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Buttons / badges etc. ----------------------------- *//* ----------------------------- Buttons / badges etc. ----------------------------- */

export function LoadingButton({
  loading = false,
  loadingText,
  onClick,
  className = "",
  children,
  disabled,
  "aria-label": ariaLabel,
  height = "h-10",
  variant = "default",
  icon: Icon,
}: {
  loading?: boolean;
  loadingText?: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  height?: string;
  variant?: "default" | "primary" | "danger" | "white";
  icon?: React.ComponentType<{ className: string }>;
}) {
  const isWhiteVariant = variant === "white";
  const baseStyles = `
    relative inline-flex items-center justify-center 
    ${isWhiteVariant ? "rounded-lg px-5 py-1.5" : `rounded-xl px-5 ${height}`} font-medium 
    transition-all duration-300 
    disabled:opacity-50 disabled:cursor-not-allowed 
    group overflow-hidden
  `;

  const variantStyles = {
    primary: BUTTON_PRIMARY,
    default: BUTTON_SECONDARY,
    danger:
      "bg-gradient-to-r from-red-500/20 to-rose-500/20 hover:from-red-500/30 hover:to-rose-500/30 text-red-400 border border-red-500/30 hover:border-red-500/50",
    white: "bg-white hover:bg-neutral-200 text-neutral-900 border-0",
  };
  
  // Determine what text to show when loading
  const displayLoadingText = loadingText || (typeof children === 'string' && children.toLowerCase().includes('create') ? 'Creating' : 'Loading');

  return (
    <button
      type="button"
      onClick={loading ? undefined : onClick}
      disabled={loading || disabled}
      aria-busy={loading}
      aria-label={ariaLabel}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
    >
      {loading ? (
        <span className="flex items-baseline">
          <span>{displayLoadingText}</span>
          <span className="inline-flex ml-1 gap-[3px] items-end pb-[2px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[5px] h-[5px] rounded-full"
                style={{
                  animation: 'dotHighlight 1.8s ease-in-out infinite',
                  animationDelay: `${i * 0.35}s`,
                  backgroundColor: 'currentColor',
                }}
              />
            ))}
          </span>
          <style>{`
            @keyframes dotHighlight {
              0%, 100% { opacity: 0.3; }
              40%, 60% { opacity: 1; }
            }
          `}</style>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4" />}
          {children}
        </span>
      )}
    </button>
  );
}

export function StatusBadge({
  type,
  message,
  icon: Icon,
  className = "",
}: {
  type: "success" | "error" | "warning" | "info";
  message: string;
  icon?: React.ComponentType<{ className: string }>;
  className?: string;
}) {
  const styles = {
    success:
      "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/10",
    error:
      "bg-red-500/10 border-red-500/30 text-red-400 shadow-lg shadow-red-500/10",
    warning:
      "bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-lg shadow-amber-500/10",
    info:
      "bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-lg shadow-blue-500/10",
  };

  const defaultIcons = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertCircle,
    info: Sparkles,
  };

  const IconComponent = Icon || defaultIcons[type];

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold backdrop-blur-sm ${styles[type]} ${className}`}
    >
      <IconComponent className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

export function IconButton({
  onClick,
  icon: Icon,
  label,
  className = "",
  variant = "default",
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className: string }>;
  label: string;
  className?: string;
  variant?: "default" | "danger";
}) {
  const variantStyles =
    variant === "danger"
      ? "text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
      : "text-neutral-400 hover:text-white hover:bg-white/10 border-white/10";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-lg p-2.5 border transition-all duration-200 ${variantStyles} ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function ProgressIndicator({
  steps,
  currentStep,
}: {
  steps: { label: string; icon: React.ComponentType<{ className: string }> }[];
  currentStep: number;
}) {
  return (
    <div className="flex items-center justify-center mb-8">
      <div className="flex items-center gap-3">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-500 ${
                    index < currentStep
                      ? "bg-gradient-to-br from-emerald-500/30 to-emerald-600/30 text-emerald-400 border-2 border-emerald-500/50 shadow-lg shadow-emerald-500/20"
                      : index === currentStep
                      ? "bg-gradient-to-br from-blue-500/30 to-indigo-600/30 text-blue-400 border-2 border-blue-500/50 shadow-xl shadow-blue-500/30 scale-110"
                      : "bg-white/5 text-neutral-500 border-2 border-white/10"
                  }`}
                >
                  {index < currentStep ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </div>
                {index === currentStep && (
                  <div className="absolute inset-0 rounded-xl bg-blue-500/20 animate-ping" />
                )}
              </div>
              <span
                className={`text-sm font-semibold hidden sm:inline transition-all duration-300 ${
                  index === currentStep ? "text-white scale-105" : "text-neutral-500"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-12 h-0.5 rounded-full transition-all duration-700 ${
                  index < currentStep
                    ? "bg-gradient-to-r from-emerald-500/50 to-emerald-600/50"
                    : "bg-white/10"
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// You can re-export these if you want them in other places
export { LABEL, KICKER };