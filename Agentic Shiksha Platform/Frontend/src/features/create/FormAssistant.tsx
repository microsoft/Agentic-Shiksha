import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight, History, MessageCircle, Pencil, SquarePen, Trash2, Undo2, X } from "lucide-react";
import ChatPane from "@/features/chat/ChatPane";
import { ChatCompanion } from "@/components/chat/CatCompanion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fillCourseForm, listAzureAgents } from "@/lib/api";
import { getCourseName } from "@/lib/utils";
import { ChatInput, type UploadedFile } from "./sharedUI";
import { applyCourseFormPatch, courseFormContext, fileKey, formAttachmentKind, FORM_ATTACHMENT_LIMIT, undoCourseFormPatch, type CompanionChanges, type CreateFormState } from "./builderTypes";
import { newCompanionConversation, readCompanionHistory, writeCompanionHistory, type CompanionConversation, type CompanionMessage } from "./formAssistantHistory";

const FIELD_LABELS: Record<string, string> = {
  courseName: "Course name", courseLevel: "Level", courseSpan: "Duration", courseNotes: "Description",
  courseCode: "Course code", prerequisites: "Prerequisites", courseUrls: "Course URLs",
  textbooks: "Textbooks", conversationStarters: "Conversation starters",
};

const SUGGESTIONS = [
  "What details are missing from this course?",
  "Help me organize the course description.",
  "Suggest conversation starters for this course.",
];

async function encodeAttachment(file: File, signal: AbortSignal) {
  const kind = formAttachmentKind(file);
  if (kind !== "document" && kind !== "image") throw new Error("This file cannot be read in chat. Add it to course materials instead.");
  const types: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  };
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException("Cancelled", "AbortError")); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.readAsDataURL(file);
  });
  return { name: file.name, contentType: types[file.name.split(".").pop()!.toLowerCase()], data };
}

export function FormAssistant({ form, setForm, disabled, open, onOpenChange, userId, onAddCourseFiles, onChanges, mode = "create" }: {
  form: CreateFormState;
  setForm: Dispatch<SetStateAction<CreateFormState>>;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onAddCourseFiles: (files: File[]) => void;
  onChanges: (changes: CompanionChanges | null) => void;
  mode?: "create" | "edit";
}) {
  const panelId = useId();
  const [initialHistory] = useState(() => {
    try { return { conversations: readCompanionHistory(localStorage, userId), error: "" }; }
    catch { return { conversations: [] as CompanionConversation[], error: "Saved chat history could not be loaded on this device." }; }
  });
  const [initialConversation] = useState(() => initialHistory.conversations.find(conversation => conversation.draftId === form.sessionUuid) ?? newCompanionConversation(form.sessionUuid));
  const [activeId, setActiveId] = useState(initialConversation.id);
  const [conversations, setConversations] = useState(initialHistory.conversations);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(initialHistory.error);
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const previews = useRef(new Set<string>());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>(initialConversation.messages);
  const [lastFill, setLastFill] = useState<{ before: CreateFormState; after: CreateFormState } | null>(null);
  const [allowEdits, setAllowEdits] = useState(true);
  const currentForm = useRef(form);
  const currentlyDisabled = useRef(disabled);
  const pending = useRef<AbortController | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  currentForm.current = form;
  currentlyDisabled.current = disabled;

  useEffect(() => () => {
    pending.current?.abort();
    previews.current.forEach(url => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    if (!messages.length) return;
    const entry: CompanionConversation = {
      id: activeId, draftId: form.sessionUuid,
      title: messages.find(message => message.role === "user")?.text.slice(0, 80) || "Course materials",
      updatedAt: Date.now(), messages,
    };
    const next = [entry, ...conversationsRef.current.filter(conversation => conversation.id !== activeId)];
    conversationsRef.current = next;
    setConversations(next);
    if (initialHistory.error) return;
    try { writeCompanionHistory(localStorage, userId, next); setHistoryError(""); }
    catch { setHistoryError("Chat history could not be saved on this device. Delete an older conversation or check browser storage."); }
  }, [messages, activeId, form.sessionUuid, userId, initialHistory.error]);
  useEffect(() => {
    if (disabled) {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
    }
  }, [disabled]);
  useEffect(() => {
    if (open && !historyOpen) composer.current?.querySelector("textarea")?.focus();
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open, historyOpen]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy]);
  function cancel() {
    if (pending.current) {
      setMessages(previous => [...previous, { role: "assistant", text: "Stopped. No changes were made.", createdAt: Date.now() }]);
    }
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }

  function close() {
    cancel();
    onOpenChange(false);
  }

  function newChat() {
    cancel();
    onChanges(null);
    setActiveId(newCompanionConversation(form.sessionUuid).id);
    setMessages([]);
    setError(null);
    setText("");
    setLastFill(null);
    setAttachmentNotice("");
    setHistoryOpen(false);
    composer.current?.querySelector("textarea")?.focus();
  }

  function selectConversation(conversation: CompanionConversation) {
    cancel();
    onChanges(null);
    setActiveId(conversation.id);
    setMessages(conversation.messages);
    setText("");
    setError(null);
    setLastFill(null);
    setAttachmentNotice("");
    setHistoryOpen(false);
    if (conversation.draftId !== form.sessionUuid) setAllowEdits(false);
  }

  function deleteConversation() {
    if (!deleteId) return;
    const next = conversationsRef.current.filter(conversation => conversation.id !== deleteId);
    try { writeCompanionHistory(localStorage, userId, next); }
    catch { setHistoryError("This conversation could not be deleted from browser storage."); setDeleteId(null); return; }
    conversationsRef.current = next;
    setConversations(next);
    if (deleteId === activeId) newChat();
    setDeleteId(null);
  }

  function addCourseMaterials(files: File[]) {
    if (disabled || busy) return;
    const accepted = files.filter(file => ["document", "material"].includes(formAttachmentKind(file)));
    const existing = new Set(currentForm.current.kbUploads.map(fileKey));
    const additions = accepted.filter(file => !existing.has(fileKey(file)));
    if (additions.length) onAddCourseFiles(additions);
    setAttachmentNotice(additions.length ? `${additions.length} file${additions.length === 1 ? "" : "s"} queued in Additional Course Material. Not read in chat.` : "No new course files added.");
    if (accepted.length !== files.length) setError("Course materials must be PDF, DOC, DOCX, TXT, or MD files up to 50 MB.");
  }

  function filterAttachments(files: File[], existing: File[]) {
    const accepted: File[] = [];
    const materials: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const kind = formAttachmentKind(file);
      if (kind === "material") materials.push(file);
      else if (kind === "unsupported" || file.name.length > 255) rejected.push(file.name);
      else if (existing.length + accepted.length < FORM_ATTACHMENT_LIMIT) accepted.push(file);
      else rejected.push(file.name);
    }
    if (materials.length) addCourseMaterials(materials);
    if (accepted.length) setAttachmentNotice(`${accepted.length} attachment${accepted.length === 1 ? "" : "s"} ready to read.${materials.length ? ` ${materials.length} larger/legacy document(s) queued as course materials only.` : ""} Documents: 1 MB / 5 PDF pages max. Images: 2 MB max.`);
    setError(rejected.length ? "Some attachments were not added. Use up to 3 small documents or PNG/JPEG/WebP images within the size limits." : null);
    return accepted;
  }

  async function submit(attachedFiles: UploadedFile[] = [], overrideText?: string): Promise<boolean> {
    if (pending.current || busy || disabled || (!(overrideText ?? text).trim() && !attachedFiles.length)) return false;
    if (messages.length >= 98) { setError("This conversation is full. Start a new chat to continue."); return false; }
    const controller = new AbortController();
    pending.current = controller;
    const baseline = currentForm.current;
    const requestText = (overrideText ?? text).trim() || "Please review these attachments for this course.";
    const previousMessages = messages.at(-1)?.role === "user" && messages.at(-1)?.text === requestText
      ? messages.slice(0, -1)
      : messages;
    const history = previousMessages.slice(-6).map(message => ({
      role: message.role,
      text: [
        message.text,
        message.changes?.length ? `Applied to the draft: ${message.changes.map(field => FIELD_LABELS[field]).join(", ")}.` : "",
        message.skipped?.length ? `Kept manual edits to: ${message.skipped.map(field => FIELD_LABELS[field]).join(", ")}.` : "",
      ].filter(Boolean).join("\n").slice(0, 2000),
    }));
    setBusy(true);
    setError(null);
    const imageUrls = attachedFiles.filter(attachment => formAttachmentKind(attachment.file) === "image").map(attachment => {
      const url = URL.createObjectURL(attachment.file);
      previews.current.add(url);
      return url;
    });
    setMessages([...previousMessages, {
      role: "user", text: requestText, createdAt: Date.now(), imageUrls,
      attachments: attachedFiles.map(attachment => ({ name: attachment.file.name, size: attachment.file.size, kind: formAttachmentKind(attachment.file) === "image" ? "image" : "document" })),
    }]);
    setText("");
    try {
      const courses = await listAzureAgents();
      if (controller.signal.aborted) return false;
      const available = courses.filter(course => /^course[-_]/i.test(course.name)).slice(0, 100).map(course => ({
        id: course.name, name: getCourseName(course.name),
      }));
      const attachments = await Promise.all(attachedFiles.map(attachment => encodeAttachment(attachment.file, controller.signal)));
      const result = await fillCourseForm(requestText, courseFormContext(baseline), available, controller.signal, { history, allowEdits, attachments });
      if (controller.signal.aborted || currentlyDisabled.current || currentForm.current.sessionUuid !== baseline.sessionUuid) return false;
      const before = currentForm.current;
      const fields = allowEdits ? result.fields : {};
      const { courseName: proposedName, ...editableFields } = fields;
      const nameLocked = mode === "edit" && proposedName?.trim() && proposedName.trim() !== before.courseName;
      const update = applyCourseFormPatch(before, baseline, mode === "edit" ? editableFields : fields);
      if (update.applied.length) {
        setForm(update.form);
        setLastFill({ before, after: update.form });
        onChanges({ form: update.form, fields: update.applied });
      }
      setMessages(previous => [...previous, {
        role: "assistant",
        text: [result.message, nameLocked ? "The course name is fixed for an existing TA and was not changed." : ""].filter(Boolean).join("\n\n"),
        changes: update.applied, skipped: update.skipped, createdAt: Date.now(),
      }]);
      setAttachmentNotice("");
      return true;
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Course Companion could not complete this request. Please retry.");
        setText(current => current || requestText);
      }
      return false;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function undo() {
    if (!lastFill || disabled || busy) return;
    setForm(current => undoCourseFormPatch(current, lastFill.before, lastFill.after));
    setLastFill(null);
    onChanges(null);
    setMessages(previous => [...previous, { role: "assistant", text: "Undid my last changes. Your later edits were kept.", createdAt: Date.now() }]);
  }

  return (
    <>
        <aside
          id={panelId}
          data-chat-companion-surface
          role="complementary"
          aria-label="Course Companion"
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}
          className={`${open ? "flex" : "hidden"} h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-l border-white/[0.06] bg-neutral-900 text-neutral-100 lg:w-[420px] lg:max-w-[50%] xl:w-[520px] 2xl:w-[560px]`}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
            <h2 className="min-w-0 text-sm font-semibold">Course Companion</h2>
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy || disabled} onClick={() => setHistoryOpen(current => !current)} title="Chat history" aria-label="Chat history" aria-expanded={historyOpen} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"><History className="h-4 w-4" /></button>
              <button type="button" disabled={busy || disabled} onClick={newChat} title="New conversation" aria-label="New conversation" className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-700/50 hover:text-white disabled:opacity-30"><SquarePen className="h-4 w-4" /></button>
              <button type="button" onClick={close} title="Close Course Companion" aria-label="Close Course Companion" className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-700/50 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
          </div>
          {historyError && <p role="alert" className="px-5 py-2 text-xs text-amber-300">{historyError}</p>}
          {historyOpen ? (
            <section aria-label="Companion chat history" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <h3 className="px-2 pb-3 text-sm font-semibold">Chat history</h3>
              {conversations.length === 0 && <p className="px-2 text-sm text-neutral-500">No conversations yet</p>}
              {conversations.map(conversation => (
                <div key={conversation.id} className={`mb-1 flex min-w-0 items-center gap-1 rounded-lg ${conversation.id === activeId ? "bg-neutral-800" : "hover:bg-neutral-800/60"}`}>
                  <button type="button" onClick={() => selectConversation(conversation)} aria-label={`Open conversation: ${conversation.title}`} className="block min-w-0 flex-1 px-3 py-3 text-left">
                    <span className="block truncate text-sm text-neutral-200">{conversation.title}</span><span className="mt-1 block text-xs text-neutral-500">{new Date(conversation.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <button type="button" onClick={() => setDeleteId(conversation.id)} aria-label={`Delete conversation: ${conversation.title}`} title="Delete conversation" className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-700 hover:text-white"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </section>
          ) : null}
          <div className={`${historyOpen ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}>
          <div ref={log} role="log" aria-label="Course Companion conversation" aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 text-sm">
            {messages.length === 0 && !busy ? (
              <div className="space-y-6 pt-5">
                <ChatCompanion size={64} empty activityKey={text} contextKey={activeId} active={open && !historyOpen} readOnly={disabled} />
                <h3 className="text-xl font-semibold leading-snug tracking-normal">{mode === "edit" ? "Let's refine your course" : "Let's build your course"}</h3>
                {mode === "edit" && <p className="text-sm leading-relaxed text-neutral-400">Changes stay in this form until you press Update. The course name and existing material session stay unchanged.</p>}
                <div className="space-y-2">
                  {SUGGESTIONS.map(suggestion => (
                    <button key={suggestion} type="button" disabled={disabled} onClick={() => { setText(suggestion); composer.current?.querySelector("textarea")?.focus(); }} className="flex w-full items-center justify-between gap-3 rounded-lg bg-neutral-800/70 px-3 py-3 text-left text-sm leading-relaxed text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-40">
                      <span className="min-w-0 break-words">{suggestion}</span><ChevronRight className="h-4 w-4 shrink-0 text-neutral-500" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ChatPane
                key={activeId}
                compact={false}
                messages={messages.map(message => ({
                  role: message.role, createdAt: message.createdAt, imageUrls: message.imageUrls,
                  content: [message.text,
                    message.attachments?.length ? `Attachments: ${message.attachments.map(attachment => attachment.name).join(", ")}` : "",
                    message.changes?.length ? `Updated: ${message.changes.map(field => FIELD_LABELS[field]).join(", ")}.` : "",
                    message.skipped?.length ? `Kept your newer edits to ${message.skipped.map(field => FIELD_LABELS[field]).join(", ")}.` : "",
                  ].filter(Boolean).join("\n\n"),
                }))}
                isSending={busy}
                statusLabel="Working on your request..."
                companionActivityKey={text}
                companionActive={open && !historyOpen}
                readOnly={disabled}
                disableAutoScroll
                className="!p-0"
              />
            )}
          </div>
          <div ref={composer} className="shrink-0 space-y-3 px-4 pb-4 pt-2">
            {error && <p role="alert" className="break-words text-xs text-amber-300">{error}</p>}
            {attachmentNotice && <p role="status" className="break-words text-xs text-neutral-400">{attachmentNotice}</p>}
            {lastFill && (
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy || disabled} onClick={() => { setLastFill(null); onChanges(null); }} className="flex h-8 items-center gap-1.5 rounded-md bg-neutral-100 px-3 text-xs font-medium text-neutral-950 hover:bg-white disabled:opacity-40"><Check className="h-3.5 w-3.5" />Done</button>
                <button type="button" disabled={busy || disabled} onClick={undo} aria-label="Undo last changes" title="Undo last changes" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-300 hover:bg-neutral-700/50 disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" />Undo</button>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={busy || disabled} aria-label="Companion mode" title="Change companion mode" className="flex h-8 min-w-32 items-center justify-between gap-2 rounded-md px-2 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-40">
                  <span>{allowEdits ? "Allow editing" : "Chat only"}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" sideOffset={8} onEscapeKeyDown={event => event.stopPropagation()} className="w-52 max-w-[calc(100vw-2rem)] rounded-lg border-neutral-700 bg-neutral-900 p-1 text-neutral-200 shadow-xl shadow-black/30">
                <DropdownMenuRadioGroup value={allowEdits ? "editing" : "chat"} onValueChange={value => setAllowEdits(value === "editing")}>
                  <DropdownMenuRadioItem value="editing" disabled={busy || disabled} className="gap-3 rounded-md px-3 py-3 focus:bg-neutral-800 focus:text-white [&>span:first-child]:hidden">
                    <Pencil className="h-4 w-4 shrink-0 text-neutral-400" /><span className="min-w-0 flex-1">Allow editing</span><Check aria-hidden="true" className={`h-4 w-4 shrink-0 ${allowEdits ? "opacity-100" : "opacity-0"}`} />
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="chat" disabled={busy || disabled} className="gap-3 rounded-md px-3 py-3 focus:bg-neutral-800 focus:text-white [&>span:first-child]:hidden">
                    <MessageCircle className="h-4 w-4 shrink-0 text-neutral-400" /><span className="min-w-0 flex-1">Chat only</span><Check aria-hidden="true" className={`h-4 w-4 shrink-0 ${allowEdits ? "opacity-0" : "opacity-100"}`} />
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ChatInput
              key={activeId}
              value={text}
              onChange={event => setText(event.target.value)}
              onSend={submit}
              onStop={cancel}
              isSending={busy}
              disabled={disabled}
              placeholder="Message Course Companion..."
              ariaLabel="Message Course Companion"
              maxLength={16000}
              autoFocus
              allowDocumentUpload
              showContentActions={false}
              filterAttachments={filterAttachments}
              onAddCourseMaterials={addCourseMaterials}
              retainAttachmentPreviews={false}
              compact={false}
              active={open && !historyOpen}
            />
          </div>
          </div>
        </aside>
      {!open && (
        <button
          ref={trigger}
          type="button"
          onClick={() => onOpenChange(true)}
          disabled={disabled}
          aria-label="Course Companion"
          title="Open Course Companion"
          aria-expanded={open}
          aria-controls={panelId}
          data-launcher-icon="cat"
          data-launcher-shape="circle"
          data-launcher-animation="cat"
          className="companion-launcher absolute bottom-5 right-5 z-30 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-neutral-800 text-neutral-100 shadow-md shadow-black/20 transition-colors hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 disabled:opacity-40"
        >
          <ChatCompanion size={40} showStatus={false} readOnly={disabled} />
        </button>
      )}
      <AlertDialog open={Boolean(deleteId)} onOpenChange={value => { if (!value) setDeleteId(null); }}>
        <AlertDialogContent className="border-neutral-700 bg-neutral-900 text-neutral-100">
          <AlertDialogHeader><AlertDialogTitle>Delete conversation?</AlertDialogTitle><AlertDialogDescription>This removes the conversation from this browser. The course form and materials are unchanged.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deleteConversation}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}