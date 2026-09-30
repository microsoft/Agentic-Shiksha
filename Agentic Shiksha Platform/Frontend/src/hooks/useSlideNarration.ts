import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { SlideDeck, SlideHighlightTarget } from "@/lib/slides";
import { getAzureSlideVoices, synthesizeSlideSpeech, type AzureSlideVoice } from "@/lib/api";
import { getSlideNarration, initialNarrationVoice, narrationChunks, narrationVoiceId, NARRATION_RATES, type NarrationChunk, type NarrationSource } from "@/lib/slideNarration";

type Callbacks = {
  onNavigate: (index: number) => void;
  onHighlightChange?: (target: SlideHighlightTarget | null) => void;
};
type Context = Callbacks & { deck: SlideDeck; index: number; active: boolean; agentId?: string; allowAzure?: boolean };
type ControllerContext = Omit<Context, keyof Callbacks> & { callbacks: RefObject<Callbacks> };
type Phase = "idle" | "starting" | "playing" | "paused" | "complete" | "error";
type Snapshot = {
  provider: "local" | "azure";
  azureVoices: AzureSlideVoice[];
  azureVoiceId: string;
  azureAvailable: boolean;
  azureLoading: boolean;
  azureError: string | null;
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  voiceId: string;
  voiceError: string | null;
  source: NarrationSource;
  rate: number;
  autoAdvance: boolean;
  phase: Phase;
  completedChunks: number;
  totalChunks: number;
  currentChunk: NarrationChunk | null;
  error: string | null;
};
type Session = {
  engine: SpeechSynthesis | null;
  provider: "local" | "azure";
  agentId?: string;
  audio: HTMLAudioElement | null;
  audioUrl: string | null;
  request: AbortController | null;
  deck: SlideDeck;
  deckSignature: string;
  index: number;
  nextIndex: number | null;
  source: NarrationSource;
  voiceId: string;
  rate: number;
  autoAdvance: boolean;
  chunks: NarrationChunk[];
  cursor: number;
  utterance: SpeechSynthesisUtterance | null;
  started: boolean;
  paused: boolean;
  finishedChunk: boolean;
  timer: number | undefined;
};

// Web Speech has a single document-wide queue. Only its recorded owner may cancel it.
let owner: { controller: NarrationController; session: Session } | null = null;
const START_TIMEOUT = 8_000;
const AZURE_START_TIMEOUT = 35_000;
const SPEECH_ERROR = "On-device narration failed. Check your device's speech settings, then select Play to retry.";
const emptyScriptMessage = (source: NarrationSource) => source === "notes"
  ? "No saved narration notes for this slide. Choose Slide text explicitly to read the visible content."
  : "There is no readable slide text. Choose another slide.";

function speechEngine(): SpeechSynthesis | null {
  if (typeof window === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") return null;
  const engine = window.speechSynthesis;
  return engine && ["getVoices", "speak", "cancel", "pause", "resume", "addEventListener", "removeEventListener"]
    .every(method => typeof engine[method as keyof SpeechSynthesis] === "function") ? engine : null;
}

class NarrationController {
  private snapshot: Snapshot = {
    provider: "local", azureVoices: [], azureVoiceId: "", azureAvailable: false, azureLoading: false, azureError: null,
    supported: false, voices: [], voiceId: "", voiceError: null, source: "notes",
    rate: 1, autoAdvance: false, phase: "idle", completedChunks: 0, totalChunks: 0, currentChunk: null, error: null,
  };
  private listeners = new Set<() => void>();
  private context: ControllerContext | null = null;
  private deckSignature = "";
  private engine: SpeechSynthesis | null = null;
  private session: Session | null = null;
  private highlight: SlideHighlightTarget | null = null;
  private mounted = false;
  private catalogRequest: AbortController | null = null;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach(listener => listener());
  }
  private clearTimer(session: Session) {
    window.clearTimeout(session.timer);
    session.timer = undefined;
  }
  private current(session: Session) {
    return this.mounted && this.session === session && owner?.session === session && owner.controller === this;
  }
  private setHighlight(target: SlideHighlightTarget | null) {
    if (this.highlight === target) return;
    this.highlight = target;
    this.context?.callbacks.current.onHighlightChange?.(target);
  }
  private release(session: Session, cancel: boolean) {
    this.clearTimer(session);
    if (session.utterance) {
      session.utterance.onstart = null;
      session.utterance.onend = null;
      session.utterance.onerror = null;
    }
    this.clearAudio(session);
    if (this.session === session) this.session = null;
    if (owner?.session === session && owner.controller === this) {
      owner = null;
      if (cancel && session.engine) {
        try { session.engine.cancel(); } catch { /* A failed engine must not retain ownership. */ }
      }
    }
    this.setHighlight(null);
  }
  private clearAudio(session: Session) {
    session.request?.abort();
    session.request = null;
    if (session.audio) {
      session.audio.onplaying = null;
      session.audio.onended = null;
      session.audio.onerror = null;
      session.audio.pause();
      session.audio.removeAttribute("src");
      session.audio.load();
      session.audio = null;
    }
    if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
    session.audioUrl = null;
  }
  stop = () => {
    if (this.session) this.release(this.session, true);
    this.setHighlight(null);
    this.publish({ phase: "idle", error: null, completedChunks: 0, totalChunks: 0, currentChunk: null });
  };
  private fail(message = SPEECH_ERROR) {
    if (this.session) this.release(this.session, true);
    this.setHighlight(null);
    this.publish({ phase: "error", error: message, currentChunk: null });
  }
  private onVisibility = () => { if (document.hidden) this.stop(); };
  private onPageHide = () => this.stop();

  mount = () => {
    this.mounted = true;
    this.reloadVoices();
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    return () => {
      this.mounted = false;
      if (this.session) this.release(this.session, true);
      this.engine?.removeEventListener("voiceschanged", this.reloadVoices);
      this.engine = null;
      this.catalogRequest?.abort();
      this.catalogRequest = null;
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pagehide", this.onPageHide);
    };
  };
  configure(context: ControllerContext) {
    const deckSignature = JSON.stringify(context.deck);
    const changed = this.context && (this.context.deck !== context.deck || this.deckSignature !== deckSignature
      || this.context.index !== context.index || (this.context.active && !context.active));
    const azureContextChanged = this.context && (this.context.agentId !== context.agentId || this.context.allowAzure !== context.allowAzure);
    this.context = context;
    this.deckSignature = deckSignature;
    if (azureContextChanged) {
      this.catalogRequest?.abort();
      this.catalogRequest = null;
      if (this.session?.provider === "azure") this.stop();
      this.publish({ provider: "local", azureVoices: [], azureVoiceId: "", azureAvailable: false, azureLoading: false, azureError: null });
    }
    const session = this.session;
    if (!session) {
      if (changed) this.stop();
      return;
    }
    if (!context.active || document.hidden || context.deck !== session.deck || deckSignature !== session.deckSignature
      || (context.index !== session.index && context.index !== session.nextIndex)) {
      this.stop();
      return;
    }
    if (session.nextIndex !== null && context.index === session.nextIndex) {
      this.clearTimer(session);
      session.index = context.index;
      session.nextIndex = null;
      session.chunks = narrationChunks(getSlideNarration(context.deck.slides[context.index], session.source), session.provider === "azure" ? 1000 : undefined);
      session.cursor = 0;
      session.utterance = null;
      session.started = false;
      session.finishedChunk = false;
      if (session.paused) this.publish({ phase: "paused", completedChunks: 0, totalChunks: session.chunks.length, currentChunk: null });
      else this.speakChunk(session);
    }
  }
  reloadVoices = () => {
    if (!this.mounted) return;
    const engine = speechEngine();
    if (engine !== this.engine) {
      if (this.session?.provider === "local") this.stop();
      this.engine?.removeEventListener("voiceschanged", this.reloadVoices);
      this.engine = engine;
      engine?.addEventListener("voiceschanged", this.reloadVoices);
    }
    let voices: SpeechSynthesisVoice[] = [];
    let voiceError: string | null = null;
    try {
      voices = (engine?.getVoices() || []).filter(voice => voice.localService === true);
    } catch {
      voiceError = "Unable to load on-device voices. Reload voices to try again.";
    }
    const selected = voices.find(voice => narrationVoiceId(voice) === this.snapshot.voiceId)
      || initialNarrationVoice(voices, navigator.languages || [navigator.language]);
    this.publish({ supported: !!engine, voices, voiceId: selected ? narrationVoiceId(selected) : "", voiceError });
    if (this.session?.provider === "local" && !voices.some(voice => narrationVoiceId(voice) === this.session!.voiceId)) {
      this.fail("The selected on-device voice is no longer available. Reload voices, choose a local voice, and select Play.");
    }
  };
  reloadAzureVoices = async () => {
    const context = this.context;
    if (!this.mounted || !context?.allowAzure || !context.agentId) return;
    this.catalogRequest?.abort();
    const request = new AbortController();
    this.catalogRequest = request;
    this.publish({ azureLoading: true, azureError: null });
    try {
      const catalog = await getAzureSlideVoices(context.agentId, request.signal);
      if (!this.mounted || request.signal.aborted || this.catalogRequest !== request) return;
      const selected = catalog.voices.find(voice => voice.id === this.snapshot.azureVoiceId)
        || catalog.voices.find(voice => voice.id === "en-IN-NeerjaNeural") || catalog.voices[0];
      this.publish({
        azureVoices: catalog.available ? catalog.voices : [],
        azureVoiceId: catalog.available && selected ? selected.id : "",
        azureAvailable: catalog.available && catalog.voices.length > 0,
        azureError: catalog.available && selected ? null : catalog.detail || "Azure speech is not configured. You can still use on-device voices.",
      });
    } catch (error) {
      if (!request.signal.aborted && this.mounted) this.publish({
        azureAvailable: false, azureVoices: [], azureVoiceId: "",
        azureError: error instanceof Error ? error.message : "Azure voices could not be loaded. Reload voices to retry.",
      });
    } finally {
      if (this.catalogRequest === request) {
        this.catalogRequest = null;
        if (this.mounted) this.publish({ azureLoading: false });
      }
    }
  };
  setProvider = (provider: "local" | "azure") => {
    if (provider === "azure" && (!this.context?.allowAzure || !this.context.agentId)) return;
    this.stop();
    this.catalogRequest?.abort();
    this.publish({ provider, azureLoading: false });
    if (provider === "azure") void this.reloadAzureVoices();
  };
  setAzureVoice = (voiceId: string) => {
    if (!this.snapshot.azureVoices.some(voice => voice.id === voiceId)) return;
    this.stop();
    this.publish({ azureVoiceId: voiceId });
  };
  setSource = (source: NarrationSource) => {
    if (source !== "notes" && source !== "slide") return;
    this.stop();
    this.publish({ source });
  };
  setVoice = (voiceId: string) => {
    if (!this.snapshot.voices.some(voice => narrationVoiceId(voice) === voiceId && voice.localService === true)) return;
    this.stop();
    this.publish({ voiceId });
  };
  setRate = (rate: number) => {
    if (!NARRATION_RATES.some(value => value === rate)) return;
    this.stop();
    this.publish({ rate });
  };
  setAutoAdvance = (autoAdvance: boolean) => {
    this.stop();
    this.publish({ autoAdvance });
  };

  play = () => {
    const context = this.context;
    const engine = this.engine;
    const provider = this.snapshot.provider;
    if (!this.mounted || !context?.active || document.hidden || (provider === "local" && !engine)) return;
    const chunks = narrationChunks(getSlideNarration(context.deck.slides[context.index], this.snapshot.source), provider === "azure" ? 1000 : undefined);
    if (!chunks.length) {
      this.fail(emptyScriptMessage(this.snapshot.source));
      return;
    }
    if (provider === "azure") {
      if (!context.allowAzure || !context.agentId || !this.snapshot.azureAvailable || !this.snapshot.azureVoiceId) {
        this.fail("Choose an available Azure voice before playing.");
        return;
      }
    } else {
      let localVoice: SpeechSynthesisVoice | undefined;
      try {
        localVoice = engine?.getVoices().find(voice => voice.localService === true && narrationVoiceId(voice) === this.snapshot.voiceId);
      } catch { this.fail(); return; }
      if (!localVoice) {
        this.reloadVoices();
        this.fail("No selected on-device voice is available. Reload voices and choose a local voice before playing.");
        return;
      }
    }
    if (!owner && engine && (engine.speaking || engine.pending)) {
      this.fail("Another speech session is active. Stop it before starting slide narration.");
      return;
    }
    owner?.controller.stop();
    const session: Session = {
      engine: provider === "local" ? engine : null, provider, agentId: context.agentId,
      audio: null, audioUrl: null, request: null,
      deck: context.deck, deckSignature: JSON.stringify(context.deck), index: context.index, nextIndex: null,
      source: this.snapshot.source, voiceId: provider === "azure" ? this.snapshot.azureVoiceId : this.snapshot.voiceId, rate: this.snapshot.rate, autoAdvance: this.snapshot.autoAdvance,
      chunks, cursor: 0, utterance: null, started: false, paused: false, finishedChunk: false, timer: undefined,
    };
    this.session = session;
    owner = { controller: this, session };
    this.speakChunk(session);
  };
  private armStartup(session: Session) {
    this.clearTimer(session);
    session.timer = window.setTimeout(() => {
      if (this.current(session) && !session.started && !session.paused) {
        this.fail(session.provider === "azure" ? "Azure narration did not start. Check your connection and audio permissions, then select Play to retry."
          : "On-device speech did not start. Reload voices or check your device's speech settings, then select Play to retry.");
      }
    }, session.provider === "azure" ? AZURE_START_TIMEOUT : START_TIMEOUT);
  }
  private speakChunk(session: Session) {
    if (!this.current(session)) return;
    if (!this.context?.active || document.hidden) { this.stop(); return; }
    if (!session.chunks.length) {
      this.fail(emptyScriptMessage(session.source));
      return;
    }
    if (session.provider === "azure") {
      void this.speakAzureChunk(session);
      return;
    }
    try {
      // Revalidate for every chunk: never let a missing voice fall back to a cloud default.
      const engine = session.engine;
      const voice = engine?.getVoices().find(entry => entry.localService === true && narrationVoiceId(entry) === session.voiceId);
      if (!voice || !engine) {
        this.fail("The selected on-device voice is no longer available. Reload voices and select Play to retry.");
        return;
      }
      const chunk = session.chunks[session.cursor];
      if (this.highlight !== chunk.target) this.setHighlight(null);
      const utterance = new window.SpeechSynthesisUtterance(chunk.text);
      session.utterance = utterance;
      session.started = false;
      session.finishedChunk = false;
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = session.rate;
      const current = () => this.current(session) && session.utterance === utterance;
      utterance.onstart = () => {
        if (!current() || session.finishedChunk) return;
        session.started = true;
        this.clearTimer(session);
        this.setHighlight(chunk.target);
        this.publish({ phase: session.paused ? "paused" : "playing" });
      };
      utterance.onend = () => {
        if (!current() || session.finishedChunk) return;
        if (!session.started) { this.fail(SPEECH_ERROR); return; }
        this.clearTimer(session);
        session.finishedChunk = true;
        session.cursor += 1;
        this.publish({ completedChunks: session.cursor });
        if (!session.paused) this.advance(session);
      };
      utterance.onerror = event => {
        if (!current() || session.finishedChunk) return;
        this.fail(event.error === "not-allowed"
          ? "Your browser blocked on-device speech. Select Play to retry, or check the browser's audio permissions."
          : SPEECH_ERROR);
      };
      this.publish({ phase: "starting", completedChunks: session.cursor, totalChunks: session.chunks.length, currentChunk: chunk, error: null });
      this.armStartup(session);
      if (engine.paused) engine.resume();
      engine.speak(utterance);
    } catch { this.fail(); }
  }
  private async speakAzureChunk(session: Session) {
    if (!session.agentId || !this.current(session)) return;
    this.clearAudio(session);
    const request = new AbortController();
    session.request = request;
    const chunk = session.chunks[session.cursor];
    session.started = false;
    session.finishedChunk = false;
    this.setHighlight(null);
    this.publish({ phase: "starting", completedChunks: session.cursor, totalChunks: session.chunks.length, currentChunk: chunk, error: null });
    this.armStartup(session);
    try {
      const blob = await synthesizeSlideSpeech(session.agentId, chunk.text, session.voiceId, request.signal);
      if (!this.current(session) || request.signal.aborted) return;
      const audio = new Audio();
      session.audio = audio;
      session.audioUrl = URL.createObjectURL(blob);
      audio.src = session.audioUrl;
      audio.playbackRate = session.rate;
      const current = () => this.current(session) && session.audio === audio && !session.finishedChunk;
      audio.onplaying = () => {
        if (!current()) return;
        if (session.paused) { audio.pause(); return; }
        session.started = true;
        this.clearTimer(session);
        this.setHighlight(chunk.target);
        this.publish({ phase: "playing" });
      };
      audio.onended = () => {
        if (!current()) return;
        if (!session.started) { this.fail("Azure narration ended before playback started. Select Play to retry."); return; }
        this.clearTimer(session);
        session.finishedChunk = true;
        session.cursor += 1;
        this.publish({ completedChunks: session.cursor });
        this.clearAudio(session);
        if (!session.paused) this.advance(session);
      };
      audio.onerror = () => { if (current()) this.fail("The Azure audio could not be played. Select Play to retry."); };
      if (!session.paused) await audio.play();
    } catch (error) {
      if (!this.current(session) || request.signal.aborted) return;
      this.fail(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Your browser blocked audio. Allow audio for this site, then select Play."
        : error instanceof Error ? `Azure narration failed. ${error.message}` : "Azure narration failed. Select Play to retry.");
    }
  }
  private advance(session: Session) {
    if (!this.current(session)) return;
    if (!this.context?.active || document.hidden) { this.stop(); return; }
    if (session.cursor < session.chunks.length) {
      this.speakChunk(session);
    } else if (session.autoAdvance && session.index < session.deck.slides.length - 1) {
      session.nextIndex = session.index + 1;
      this.setHighlight(null);
      this.publish({ phase: "starting", currentChunk: null });
      session.timer = window.setTimeout(() => {
        if (this.current(session) && session.nextIndex !== null) this.fail("Unable to advance to the next slide. Choose a slide and select Play to retry.");
      }, START_TIMEOUT);
      try { this.context.callbacks.current.onNavigate(session.nextIndex); } catch { this.fail(); }
    } else {
      this.release(session, false);
      this.publish({ phase: "complete", currentChunk: null });
    }
  }
  pause = () => {
    const session = this.session;
    if (!session || !this.current(session) || session.paused) return;
    session.paused = true;
    this.clearTimer(session);
    try {
      if (session.provider === "azure") session.audio?.pause();
      else session.engine?.pause();
      this.publish({ phase: "paused" });
    } catch { this.fail(); }
  };
  resume = () => {
    const session = this.session;
    if (!session || !this.current(session) || !session.paused) return;
    if (!this.context?.active || document.hidden) { this.stop(); return; }
    session.paused = false;
    try {
      if (session.provider === "azure") {
        if (session.finishedChunk) this.advance(session);
        else if (!session.audio && !session.request && session.nextIndex === null) this.speakChunk(session);
        else {
          this.publish({ phase: session.started ? "playing" : "starting" });
          if (!session.started) this.armStartup(session);
          const audio = session.audio;
          if (audio) void audio.play().catch(() => {
            if (this.current(session) && session.audio === audio) this.fail("The Azure audio could not resume. Select Play to retry.");
          });
        }
        return;
      }
      session.engine?.resume();
      if (!session.utterance || session.finishedChunk) this.advance(session);
      else {
        this.publish({ phase: session.started ? "playing" : "starting" });
        if (!session.started) this.armStartup(session);
      }
    } catch { this.fail(); }
  };
}

export function useSlideNarration(context: Context) {
  const [controller] = useState(() => new NarrationController());
  const callbacks = useRef<Callbacks>({ onNavigate: context.onNavigate, onHighlightChange: context.onHighlightChange });
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    callbacks.current = { onNavigate: context.onNavigate, onHighlightChange: context.onHighlightChange };
  });
  useLayoutEffect(() => controller.mount(), [controller]);
  useLayoutEffect(() => controller.configure({ deck: context.deck, index: context.index, active: context.active, agentId: context.agentId, allowAzure: context.allowAzure, callbacks }));
  return {
    ...snapshot, play: controller.play, pause: controller.pause, resume: controller.resume, stop: controller.stop,
    setSource: controller.setSource, setVoice: controller.setVoice, setRate: controller.setRate,
    setAutoAdvance: controller.setAutoAdvance, reloadVoices: controller.reloadVoices,
    setProvider: controller.setProvider, setAzureVoice: controller.setAzureVoice, reloadAzureVoices: controller.reloadAzureVoices,
  };
}
