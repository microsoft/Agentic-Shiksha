import type { Page } from "@playwright/test";

type AzureAudioRecord = {
  src: string;
  playbackRate: number;
  onplaying: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  savedEnd: (() => void) | null;
  playCount: number;
  pauseCount: number;
};
declare global {
  interface Window {
    azureAudioMock: { records: AzureAudioRecord[]; playBlocked: boolean; created: string[]; revoked: string[] };
  }
}

export async function installAzureAudioMock(page: Page) {
  await page.addInitScript(() => {
    const mock: Window["azureAudioMock"] = { records: [], playBlocked: false, created: [], revoked: [] };
    window.azureAudioMock = mock;
    class Audio {
      src = "";
      playbackRate = 1;
      onplaying: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      savedEnd: (() => void) | null = null;
      playCount = 0;
      pauseCount = 0;
      constructor() { mock.records.push(this); }
      play() {
        this.playCount++;
        if (mock.playBlocked) return Promise.reject(new DOMException("Audio blocked", "NotAllowedError"));
        this.savedEnd = this.onended;
        this.onplaying?.();
        return Promise.resolve();
      }
      pause() { this.pauseCount++; }
      removeAttribute(name: string) { if (name === "src") this.src = ""; }
      load() { /* Mock has no decoder to reset. */ }
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: Audio });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); mock.created.push(url); return url; };
    URL.revokeObjectURL = url => { mock.revoked.push(url); revoke(url); };
  });
}

export type Voice = Pick<SpeechSynthesisVoice, "name" | "lang" | "voiceURI" | "default" | "localService">;
type SpeechRecord = {
  text: string;
  voice: Voice | null;
  rate: number;
  start: (() => void) | null;
  end: (() => void) | null;
  error: ((error: string) => void) | null;
};
export type SpeechMock = {
  records: SpeechRecord[];
  cancels: number;
  pauses: number;
  resumes: number;
  autoStart: boolean;
  throwSpeak: boolean;
  failVoices: boolean;
  finish: (index?: number) => void;
  fail: (error?: string) => void;
  setVoices: (voices: Voice[], notify?: boolean) => void;
  hide: (hidden: boolean) => void;
  unownedSpeech: (speaking: boolean) => void;
};
declare global {
  interface Window {
    narrationMock: SpeechMock;
    narrationUnsafe?: boolean;
  }
}

export const speechMockVoices: Voice[] = [
  { name: "Cloud default", lang: "en-US", voiceURI: "remote", default: true, localService: false },
  { name: "Local Hindi", lang: "hi-IN", voiceURI: "local-hi", default: false, localService: true },
  { name: "Local English", lang: "en-US", voiceURI: "local-en", default: false, localService: true },
];

export async function installSpeechMock(page: Page, options: { supported?: boolean; voices?: Voice[]; autoStart?: boolean } = {}) {
  await page.addInitScript(({ supported, initialVoices, autoStart }) => {
    let currentVoices = initialVoices;
    const events = new EventTarget();
    class Utterance {
      text: string;
      voice: Voice | null = null;
      rate = 1;
      lang = "";
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const engine = {
      speaking: false,
      pending: false,
      paused: false,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      getVoices: () => {
        if (mock.failVoices) throw new Error("Voice discovery failed");
        return currentVoices;
      },
      speak: (utterance: Utterance) => {
        if (mock.throwSpeak) throw new Error("Speech engine failed");
        const savedError = utterance.onerror;
        const record: SpeechRecord = {
          text: utterance.text, voice: utterance.voice, rate: utterance.rate,
          start: utterance.onstart, end: utterance.onend, error: error => savedError?.({ error }),
        };
        mock.records.push(record);
        engine.speaking = true;
        if (mock.autoStart) record.start?.();
      },
      cancel: () => { mock.cancels += 1; engine.speaking = false; engine.pending = false; },
      pause: () => { mock.pauses += 1; engine.paused = true; },
      resume: () => { mock.resumes += 1; engine.paused = false; },
    };
    const mock: SpeechMock = {
      records: [], cancels: 0, pauses: 0, resumes: 0, autoStart, throwSpeak: false, failVoices: false,
      finish: (index = mock.records.length - 1) => { engine.speaking = false; mock.records[index]?.end?.(); },
      fail: (error = "synthesis-failed") => { engine.speaking = false; mock.records.at(-1)?.error?.(error); },
      setVoices: (next, notify = true) => { currentVoices = next; if (notify) events.dispatchEvent(new Event("voiceschanged")); },
      hide: hidden => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      unownedSpeech: speaking => { engine.speaking = speaking; },
    };
    window.narrationMock = mock;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: supported ? engine : undefined });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: supported ? Utterance : undefined });
  }, { supported: options.supported ?? true, initialVoices: options.voices ?? speechMockVoices, autoStart: options.autoStart ?? true });
}
