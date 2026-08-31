// hooks/useSpeechRecognition.ts
//
// React hook for browser-side live speech-to-text using Azure Speech SDK.
// Fetches a short-lived token from the backend so the API key is never
// exposed on the client.
// Also monitors mic volume via Web Audio API for visual feedback.

import { useCallback, useEffect, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { API_BASE_URL } from "@/lib/config";

export type SpeechRecognitionState = "idle" | "starting" | "listening" | "error";

/**
 * STS tokens stay valid for ten minutes, so they are cached across mic sessions
 * instead of costing a round trip on every click.
 */
let cachedToken: { token: string; region: string; expiresAt: number } | null = null;
let inflightToken: Promise<{ token: string; region: string }> | null = null;

async function getSpeechToken(): Promise<{ token: string; region: string }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return { token: cachedToken.token, region: cachedToken.region };
  }
  if (inflightToken) return inflightToken;

  inflightToken = (async () => {
    const base = (API_BASE_URL || "").replace(/\/+$/, "");
    const res = await fetch(`${base}/api/speech/token`);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Speech token request failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as { token: string; region: string };
    cachedToken = { ...data, expiresAt: Date.now() + 9 * 60 * 1000 };
    return data;
  })();

  try {
    return await inflightToken;
  } catch (err) {
    cachedToken = null;
    throw err;
  } finally {
    inflightToken = null;
  }
}

interface UseSpeechRecognitionOptions {
  /** BCP-47 language code, e.g. "en-US", "hi-IN" */
  language?: string;
  /** Called with partial (interim) transcript text */
  onInterim?: (text: string) => void;
  /** Called when a final phrase is recognized */
  onFinal?: (text: string) => void;
  /** Called on error */
  onError?: (message: string) => void;
}

export function useSpeechRecognition({
  language = "en-US",
  onInterim,
  onFinal,
  onError,
}: UseSpeechRecognitionOptions = {}) {
  const [state, setState] = useState<SpeechRecognitionState>("idle");
  const [volume, setVolume] = useState(0); // 0-1 overall loudness
  const [bands, setBands] = useState<[number, number, number]>([0, 0, 0]); // 3-band levels
  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const audioConfigRef = useRef<SpeechSDK.AudioConfig | null>(null);
  const stoppedRef = useRef(false);
  const startingRef = useRef(false); // guards against double-start
  const receivedVoiceRef = useRef(false); // first voice data received?

  // Web Audio refs for volume metering
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  /* ---------- volume metering ---------- */

  const startVolumeMeter = useCallback(async (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      const smoothedBands: [number, number, number] = [0, 0, 0];
      // Per-bar phase offsets for natural staggered look
      const phases: [number, number, number] = [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ];

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);

        // Overall volume from full spectrum
        const len = dataArray.length;
        let total = 0;
        for (let i = 0; i < len; i++) total += dataArray[i];
        const raw = Math.min(1, (total / len / 255) * 10);
        const alpha = raw > smoothed ? 0.6 : 0.15;
        smoothed += (raw - smoothed) * alpha;
        setVolume(smoothed);

        // Derive 3 pseudo-bands from the single volume with staggered jitter
        // (like Google Assistant — all react to speech but look independent)
        const t = performance.now() / 1000;
        for (let b = 0; b < 3; b++) {
          // Add sine-based wobble so each bar has its own rhythm
          const wobble = 0.15 * Math.sin(t * (3.5 + b * 1.2) + phases[b]);
          const target = Math.max(0, Math.min(1, smoothed + wobble));
          const a = target > smoothedBands[b] ? 0.5 : 0.12;
          smoothedBands[b] += (target - smoothedBands[b]) * a;
        }
        setBands([...smoothedBands] as [number, number, number]);

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Mic access denied or unavailable – ignore, volume stays 0
    }
  }, []);

  const stopVolumeMeter = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    setVolume(0);
    setBands([0, 0, 0]);
  }, []);

  // Clean up on unmount
  useEffect(() => () => stopVolumeMeter(), [stopVolumeMeter]);

  /* ---------- helpers ---------- */

  /** One mic open per session — the SDK and the volume meter share this stream. */
  const ensureMicStream = useCallback(async () => {
    const existing = streamRef.current;
    if (existing && existing.getAudioTracks().some((t) => t.readyState === "live")) {
      return existing;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  }, []);

  /** Fetch the token ahead of the click so starting the mic feels instant. */
  const prewarm = useCallback(() => {
    void getSpeechToken().catch(() => { /* surfaced on start() */ });
  }, []);

  /* ---------- start ---------- */

  const start = useCallback(async () => {
    // Already running or already starting? No-op.
    if (recognizerRef.current || startingRef.current) return;
    startingRef.current = true;

    setState("starting");
    stoppedRef.current = false;
    receivedVoiceRef.current = false;

    try {
      // Mic capture and token retrieval are independent, so overlap them.
      const [stream, { token, region }] = await Promise.all([
        ensureMicStream(),
        getSpeechToken(),
      ]);

      // If stop() was called while we were starting, bail out
      if (stoppedRef.current) {
        startingRef.current = false;
        stopVolumeMeter();
        setState("idle");
        return;
      }

      void startVolumeMeter(stream);

      // Use fromAuthorizationToken with the short STS token
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
        token,
        region
      );
      speechConfig.speechRecognitionLanguage = language;

      // Reuse the open stream so the device is not acquired a second time.
      const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
      audioConfigRef.current = audioConfig;
      const recognizer = new SpeechSDK.SpeechRecognizer(
        speechConfig,
        audioConfig
      );

      // Partial / interim results
      recognizer.recognizing = (_sender, e) => {
        if (stoppedRef.current) return;
        console.log("[Speech] Recognizing:", e.result.text, "reason:", e.result.reason);
        if (e.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
          onInterim?.(e.result.text);
        }
      };

      // Final recognized phrase
      recognizer.recognized = (_sender, e) => {
        if (stoppedRef.current) return;
        console.log("[Speech] Recognized:", e.result.text, "reason:", e.result.reason);
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          onFinal?.(e.result.text);
        } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
          console.log("[Speech] NoMatch — silence or unrecognised audio");
        }
      };

      // Session started → mark listening
      recognizer.sessionStarted = (_sender, e) => {
        console.log("[Speech] Session started:", e.sessionId);
        setState("listening");
      };

      // Session stopped
      recognizer.sessionStopped = (_sender, e) => {
        console.log("[Speech] Session stopped:", e.sessionId);
        setState("idle");
      };

      // Errors
      recognizer.canceled = (_sender, e) => {
        console.error("[Speech] Canceled:", e.reason, e.errorDetails, "errorCode:", e.errorCode);
        if (e.reason === SpeechSDK.CancellationReason.Error) {
          const msg = e.errorDetails || "Speech recognition cancelled";
          setState("error");
          onError?.(msg);
        }
        cleanup();
      };

      recognizerRef.current = recognizer;
      startingRef.current = false;
      console.log("[Speech] Starting continuous recognition...");
      recognizer.startContinuousRecognitionAsync(
        () => console.log("[Speech] Continuous recognition started successfully"),
        (err) => console.error("[Speech] Failed to start recognition:", err)
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState("error");
      startingRef.current = false;
      stopVolumeMeter();
      onError?.(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, ensureMicStream, startVolumeMeter, stopVolumeMeter]);

  /* ---------- stop ---------- */

  const cleanup = useCallback(() => {
    const r = recognizerRef.current;

    // Unwind before checking for a recognizer: a click during the "starting"
    // window has none yet, and returning early would strand the UI in
    // "starting" with the mic stream still open. stoppedRef also tells the
    // in-flight start() to abandon the session it is midway through creating.
    stoppedRef.current = true;
    startingRef.current = false;
    receivedVoiceRef.current = false;
    setState("idle");
    stopVolumeMeter();

    if (!r) return;
    recognizerRef.current = null;

    // Detach event handlers so the SDK can't fire into stale state
    r.recognizing = undefined as any;
    r.recognized = undefined as any;
    r.sessionStarted = undefined as any;
    r.sessionStopped = undefined as any;
    r.canceled = undefined as any;

    // Grab AudioConfig and null the ref immediately
    const ac = audioConfigRef.current;
    audioConfigRef.current = null;

    // Use setTimeout(0) to defer close — calling r.close() from within
    // the SDK's own 'canceled' callback can silently fail, leaving the
    // internal mic stream alive and WebSocket retries running.
    setTimeout(() => {
      try {
        r.stopContinuousRecognitionAsync(
          () => { try { r.close(); } catch { /* ignore */ } },
          () => { try { r.close(); } catch { /* ignore */ } },
        );
      } catch {
        try { r.close(); } catch { /* ignore */ }
      }
      try { ac?.close(); } catch { /* ignore */ }
    }, 0);
  }, [stopVolumeMeter]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  /* ---------- toggle ---------- */

  const toggle = useCallback(() => {
    if (recognizerRef.current || startingRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  return { state, volume, bands, start, stop, toggle, prewarm } as const;
}
