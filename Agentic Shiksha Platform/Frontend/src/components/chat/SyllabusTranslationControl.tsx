import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Languages, Loader2, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createSyllabusTranslation, getSyllabusTranslation, listSyllabusTranslations, SYLLABUS_LANGUAGES,
  type SyllabusLanguage, type SyllabusTranslation, type SyllabusTranslationCatalog,
  type SyllabusTranslationStyle, type SyllabusTranslationSummary,
} from "@/lib/api";

function translationKey(translation: Pick<SyllabusTranslationSummary, "language" | "style" | "instructions_hash">) {
  const key = `${translation.language}-${translation.style}`;
  return !translation.instructions_hash || translation.instructions_hash === "default" ? key : `${key}-${translation.instructions_hash}`;
}

function translationLabel(translation: SyllabusTranslationSummary, variants: SyllabusTranslationSummary[]) {
  const label = `${SYLLABUS_LANGUAGES[translation.language]} (${translation.style === "pure" ? "Pure" : "Mixed"})`;
  if (!translation.instructions_hash || translation.instructions_hash === "default") return label;
  const customIndex = variants.filter(item =>
    item.language === translation.language && item.style === translation.style
    && item.instructions_hash && item.instructions_hash !== "default",
  ).findIndex(item => item.instructions_hash === translation.instructions_hash);
  return `${label} - Custom ${customIndex + 1}`;
}

function normalizeInstructions(instructions: string) {
  return instructions.replace(/\r\n?/g, "\n").trim();
}

function preferenceKey(agentId: string, userId: string, sourceHash: string) {
  return `ekalaiva.syllabus-language.v1:${JSON.stringify([userId, agentId, sourceHash])}`;
}

export function useSyllabusTranslation(agentId: string | null | undefined, curriculum: unknown, open: boolean, userId: string) {
  const [catalog, setCatalog] = useState<SyllabusTranslationCatalog | null>(null);
  const [selected, setSelected] = useState<SyllabusTranslation | null>(null);
  const [loadedScope, setLoadedScope] = useState<{ agentId: string; userId: string; curriculum: unknown } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [language, setLanguage] = useState<SyllabusLanguage | "">("");
  const [style, setStyle] = useState<SyllabusTranslationStyle>("mixed");
  const [instructions, setInstructions] = useState("");
  const [instructionVariant, setInstructionVariant] = useState<{ text: string; hash: string } | null>(null);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const requestId = useRef(0);
  const saved = useRef(new Map<string, SyllabusTranslation>());
  const matchesScope = loadedScope !== null && loadedScope.agentId === agentId && loadedScope.userId === userId && loadedScope.curriculum === curriculum;
  const defaultInstructions = catalog?.default_instructions ?? "";
  const maxInstructionsLength = catalog?.max_instructions_length ?? 2000;
  const normalizedInstructions = normalizeInstructions(instructions);
  const instructionsValid = normalizedInstructions.length > 0 && normalizedInstructions.length <= maxInstructionsLength;
  const instructionsHash = instructionVariant?.text === normalizedInstructions ? instructionVariant.hash : null;

  useEffect(() => {
    let cancelled = false;
    setInstructionVariant(null);
    setInstructionsError(null);
    if (!dialogOpen || !instructionsValid) return;
    if (normalizedInstructions === normalizeInstructions(defaultInstructions)) {
      setInstructionVariant({ text: normalizedInstructions, hash: "default" });
      return;
    }
    void (async () => {
      try {
        const encoded = new TextEncoder().encode(`instructions-v1\n${normalizedInstructions}`);
        const digest = await crypto.subtle.digest("SHA-256", encoded);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (!cancelled) setInstructionVariant({ text: normalizedInstructions, hash });
      } catch {
        if (!cancelled) setInstructionsError("Custom instructions require a secure connection. Reopen this page using HTTPS.");
      }
    })();
    return () => { cancelled = true; };
  }, [normalizedInstructions, defaultInstructions, dialogOpen, instructionsValid]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setCatalog(null);
    setSelected(null);
    setLoadedScope(null);
    setBusy(false);
    setError(null);
    setDialogOpen(false);
    setInstructions("");
    saved.current.clear();
    if (!agentId || !curriculum || !open) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const result = await listSyllabusTranslations(agentId);
        if (requestId.current !== currentRequest) return;
        setCatalog(result);
        setLoadedScope({ agentId, userId, curriculum });
        setInstructions(result.default_instructions ?? "");
        let preference: string | null = null;
        try { preference = localStorage.getItem(preferenceKey(agentId, userId, result.source_hash)); } catch {}
        const previous = result.translations.find(item => translationKey(item) === preference);
        if (previous) {
          const translation = await getSyllabusTranslation(agentId, previous.language, previous.style, result.source_hash, previous.instructions_hash);
          if (requestId.current !== currentRequest) return;
          saved.current.set(translationKey(translation), translation);
          setSelected(translation);
        }
      } catch (failure) {
        if (requestId.current === currentRequest) setError(failure instanceof Error ? failure.message : "Saved translations could not be loaded.");
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    })();
    return () => { requestId.current += 1; };
  }, [agentId, userId, curriculum, open, reload]);

  function remember(key: string) {
    if (agentId && catalog) {
      try { localStorage.setItem(preferenceKey(agentId, userId, catalog.source_hash), key); } catch {}
    }
  }

  async function select(key: string) {
    if (!agentId || !catalog || !matchesScope || busy || loading) return;
    const currentRequest = ++requestId.current;
    setError(null);
    if (key === "original") {
      setSelected(null);
      remember(key);
      return;
    }
    const summary = catalog.translations.find(item => translationKey(item) === key);
    if (!summary) return;
    setBusy(true);
    try {
      const translation = saved.current.get(key) ?? await getSyllabusTranslation(agentId, summary.language, summary.style, catalog.source_hash, summary.instructions_hash);
      if (requestId.current !== currentRequest) return;
      saved.current.set(key, translation);
      setSelected(translation);
      remember(key);
      setDialogOpen(false);
    } catch (failure) {
      if (requestId.current === currentRequest) setError(failure instanceof Error ? failure.message : "The saved translation could not be loaded.");
    } finally {
      if (requestId.current === currentRequest) setBusy(false);
    }
  }

  const savedVariant = language && instructionsHash ? catalog?.translations.find(item =>
    item.language === language && item.style === style && (item.instructions_hash ?? "default") === instructionsHash,
  ) : undefined;
  const alreadySaved = Boolean(savedVariant);

  async function create() {
    if (!agentId || !catalog || !language || !matchesScope || !instructionsValid || !instructionsHash || busy || loading) return;
    if (savedVariant) {
      await select(translationKey(savedVariant));
      return;
    }
    const currentRequest = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const result = await createSyllabusTranslation(agentId, language, style, catalog.source_hash, normalizedInstructions);
      if (requestId.current !== currentRequest) return;
      saved.current.set(translationKey(result), result);
      setCatalog(previous => previous ? {
        ...previous,
        translations: [...previous.translations.filter(item => translationKey(item) !== translationKey(result)), result],
      } : previous);
      setSelected(result);
      remember(translationKey(result));
      setDialogOpen(false);
    } catch (failure) {
      if (requestId.current === currentRequest) setError(failure instanceof Error ? failure.message : "Translation could not be completed.");
    } finally {
      if (requestId.current === currentRequest) setBusy(false);
    }
  }

  return {
    catalog: matchesScope ? catalog : null,
    active: matchesScope ? selected : null,
    loading, busy, error, dialogOpen, setDialogOpen, language, setLanguage, style, setStyle,
    instructions, setInstructions, instructionsValid, instructionsHash, instructionsError, maxInstructionsLength,
    resetInstructions: () => setInstructions(defaultInstructions),
    alreadySaved, select, create,
    retry: () => setReload(value => value + 1),
    newTranslation: () => { setLanguage(""); setStyle("mixed"); setInstructions(defaultInstructions); setError(null); setDialogOpen(true); },
  };
}

export function SyllabusTranslationControl({ translation }: { translation: ReturnType<typeof useSyllabusTranslation> }) {
  const languageId = useId();
  const instructionsId = useId();
  const variants = translation.catalog?.translations ?? [];
  const hasTranslations = Boolean(translation.catalog?.translations.length);
  const activeKey = translation.active ? translationKey(translation.active) : "original";
  const pending = translation.loading || translation.busy;
  const button = (
    <button
      type="button"
      disabled={pending || !translation.catalog}
      onClick={hasTranslations ? undefined : translation.newTranslation}
      aria-label={hasTranslations ? "Switch syllabus language" : "Translate syllabus"}
      title={translation.active ? translationLabel(translation.active, variants) : "Original (English)"}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 px-2 text-xs text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
      {translation.busy ? "Loading..." : hasTranslations ? "Switch" : "Translate"}
      {hasTranslations && <ChevronDown className="h-3 w-3" />}
    </button>
  );

  return (
    <>
      {hasTranslations ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)] border-neutral-700 bg-neutral-900 text-neutral-200">
            <DropdownMenuRadioGroup value={activeKey} onValueChange={key => void translation.select(key)}>
              <DropdownMenuRadioItem value="original">Original (English)</DropdownMenuRadioItem>
              {translation.catalog!.translations.map(item => (
                <DropdownMenuRadioItem key={translationKey(item)} value={translationKey(item)}>
                  {translationLabel(item, variants)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={translation.newTranslation}>
              <Plus className="h-3.5 w-3.5" />New translation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : button}
      {translation.error && !translation.dialogOpen && (
        <div className="basis-full flex items-start gap-2 text-xs text-amber-300" role="alert">
          <span className="min-w-0 flex-1 break-words">{translation.error}</span>
          <button type="button" onClick={translation.retry} title="Retry saved translations" aria-label="Retry saved translations" className="p-1">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <Dialog open={translation.dialogOpen} onOpenChange={translation.setDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto border-neutral-700 bg-neutral-900 text-neutral-100" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Translate syllabus</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label id={languageId} className="text-sm text-neutral-300">Language</label>
            <Select value={translation.language} onValueChange={value => translation.setLanguage(value as SyllabusLanguage)} disabled={pending}>
              <SelectTrigger aria-labelledby={languageId} className="border-neutral-600"><SelectValue placeholder="Choose language" /></SelectTrigger>
              <SelectContent>
                {Object.entries(SYLLABUS_LANGUAGES).map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="mb-2 text-sm text-neutral-300">Style</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["pure", "mixed"] as const).map(style => (
                <label key={style} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${translation.style === style ? "border-neutral-300 bg-neutral-800" : "border-neutral-700"}`}>
                  <input type="radio" name={languageId} value={style} checked={translation.style === style} onChange={() => translation.setStyle(style)} className="accent-white" />
                  {style === "pure" ? "Pure" : "Mixed"}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={instructionsId} className="text-sm text-neutral-300">Translation instructions</label>
              <button
                type="button"
                onClick={translation.resetInstructions}
                disabled={pending}
                title="Reset to default instructions"
                aria-label="Reset to default instructions"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <Textarea
              id={instructionsId}
              value={translation.instructions}
              onChange={event => translation.setInstructions(event.target.value)}
              disabled={pending}
              required
              maxLength={translation.maxInstructionsLength}
              aria-describedby={`${instructionsId}-count`}
              className="h-40 min-h-32 resize-y border-neutral-600 bg-neutral-950/40 text-sm leading-relaxed focus-visible:ring-neutral-400"
            />
            <p id={`${instructionsId}-count`} className="text-right text-xs tabular-nums text-neutral-500">
              {translation.instructions.length}/{translation.maxInstructionsLength}
            </p>
          </div>
          {translation.instructionsError && <p role="alert" className="break-words text-xs text-amber-300">{translation.instructionsError}</p>}
          {translation.error && <p role="alert" className="break-words text-xs text-amber-300">{translation.error}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => translation.setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!translation.language || !translation.instructionsValid || !translation.instructionsHash || pending} onClick={() => void translation.create()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
              {translation.busy ? "Translating..." : translation.alreadySaved ? "View saved" : "Translate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}