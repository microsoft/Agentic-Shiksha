import { useId, type KeyboardEvent } from "react";
import { Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { useSlideNarration } from "@/hooks/useSlideNarration";
import { getSlideNarration, narrationVoiceId, NARRATION_RATES, type NarrationSource } from "@/lib/slideNarration";
import type { SlideDeck, SlideHighlightTarget } from "@/lib/slides";
import "./SlideNarration.css";

export type SlideNarrationProps = {
  deck: SlideDeck;
  index: number;
  onNavigate: (index: number) => void;
  active?: boolean;
  onHighlightChange?: (target: SlideHighlightTarget | null) => void;
  agentId?: string;
  allowAzure?: boolean;
};

export default function SlideNarration({ deck, index, onNavigate, active = true, onHighlightChange, agentId, allowAzure = false }: SlideNarrationProps) {
  const narration = useSlideNarration({ deck, index, onNavigate, active, onHighlightChange, agentId, allowAzure });
  const id = useId();
  const content = getSlideNarration(deck.slides[index], narration.source);
  const running = ["starting", "playing", "paused"].includes(narration.phase);
  const azure = narration.provider === "azure";
  const canPlay = active && !!content.text && (azure
    ? narration.azureAvailable && !!narration.azureVoiceId && !narration.azureLoading
    : narration.supported && !!narration.voiceId);
  const isolateKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") event.stopPropagation();
  };
  const status = {
    idle: "Ready when you are. Select Play to start.",
    starting: azure ? "Preparing Azure narration…" : "Starting on-device narration…",
    playing: "Reading aloud.",
    paused: "Narration paused.",
    complete: "Narration complete.",
    error: "Narration stopped.",
  }[narration.phase];

  return <section className="slide-narration" aria-label="Slide narration" onKeyDown={isolateKeys} onKeyUp={isolateKeys}>
    <div className="slide-narration-heading">
      <h3><Volume2 aria-hidden="true" />Read aloud</h3>
      <span className="slide-narration-device">{azure ? "Azure · India" : "On-device"}</span>
    </div>
    <p className="slide-narration-help" id={`${id}-privacy`}>{azure
      ? "Selecting Play sends the selected saved script to Azure Speech for audio generation. The script is not rewritten or translated. Speech usage may incur charges."
      : "Uses only voices marked as local by your browser. No cloud fallback."}</p>
    {allowAzure && agentId && <div className="slide-narration-field">
      <label htmlFor={`${id}-provider`}>Voice provider</label>
      <select id={`${id}-provider`} value={narration.provider} onChange={event => narration.setProvider(event.target.value === "azure" ? "azure" : "local")}>
        <option value="local">On-device voices</option>
        <option value="azure">Azure Indian voices</option>
      </select>
    </div>}
    {azure ? <>
      {narration.azureLoading && <p className="slide-narration-help" role="status">Loading Azure Indian voices…</p>}
      {narration.azureError && <p className="slide-narration-warning" role="alert">{narration.azureError}</p>}
    </> : !narration.supported
      ? <p className="slide-narration-warning" role="status">On-device speech is not supported in this browser. Try a browser with local speech support.</p>
      : !narration.voices.length
        ? <p className="slide-narration-warning" role="status">{narration.voiceError || "No on-device voices are available. Install a voice in your device's speech or language settings, then reload voices."}</p>
        : null}
    <div className="slide-narration-settings">
      <div className="slide-narration-field">
        <label htmlFor={`${id}-source`}>Narration source</label>
        <select id={`${id}-source`} value={narration.source} aria-describedby={`${id}-source-help`} onChange={event => narration.setSource(event.target.value as NarrationSource)}>
          <option value="notes">Saved notes &amp; scripts</option>
          <option value="slide">Slide text</option>
        </select>
      </div>
      <div className="slide-narration-field slide-narration-voice">
        <label htmlFor={`${id}-voice`}>{azure ? "Azure Indian voice" : "On-device voice"}</label>
        {azure ? <select id={`${id}-voice`} value={narration.azureVoiceId} disabled={narration.azureLoading || !narration.azureAvailable} aria-describedby={`${id}-privacy`} onChange={event => narration.setAzureVoice(event.target.value)}>
          {!narration.azureVoices.length && <option value="">Azure voices unavailable</option>}
          {narration.azureVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} ({voice.language})</option>)}
        </select> : <select id={`${id}-voice`} value={narration.voiceId} disabled={!narration.voices.length} aria-describedby={`${id}-privacy`} onChange={event => narration.setVoice(event.target.value)}>
            {!narration.voices.length && <option value="">No local voices</option>}
            {narration.voices.map(voice => <option key={narrationVoiceId(voice)} value={narrationVoiceId(voice)}>{voice.name} ({voice.lang})</option>)}
          </select>}
      </div>
      <div className="slide-narration-field">
        <label htmlFor={`${id}-rate`}>Speed</label>
        <select id={`${id}-rate`} value={narration.rate} onChange={event => narration.setRate(Number(event.target.value))}>
          {NARRATION_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </div>
    </div>
    <p className="slide-narration-help" id={`${id}-source-help`}>
      {narration.source === "notes"
        ? "Reads saved slide / topic notes, then component scripts in visual order, exactly as stored. Nothing is generated or filled in."
        : "Reads the exact visible component text in visual order. Source citations are not included."}
    </p>
    {narration.source === "notes" && <>
      {!content.segments.length && <div className="slide-narration-warning">
        <p>No saved narration notes for this slide. Nothing will play unless you choose Slide text.</p>
        <button type="button" className="slide-narration-source-choice" onClick={() => narration.setSource("slide")}>Use slide text</button>
      </div>}
      <p className="slide-narration-help">
        {content.hasIntro ? "Slide / topic script included. " : "No slide / topic script. "}
        {content.totalComponents > 0
          ? `Body component scripts: ${content.scriptedComponents} of ${content.totalComponents}. `
          : "No body components on this slide. "}
        Title and subtitle scripts are optional and read when saved.
        {content.missingComponents.length > 0 && " Missing body scripts are skipped."}
      </p>
      {content.missingComponents.length > 0 && <details className="slide-narration-coverage">
        <summary>Body components without scripts ({content.missingComponents.length})</summary>
        <ul>{content.missingComponents.map(component => <li key={component.target}>{component.label}</li>)}</ul>
      </details>}
    </>}
    {narration.source === "slide" && !content.segments.length && <p className="slide-narration-warning">There is no readable slide text.</p>}
    {!active && <p className="slide-narration-help">Narration is stopped while this view is inactive. It will not restart automatically.</p>}
    <label className="slide-narration-auto">
      <input type="checkbox" checked={narration.autoAdvance} onChange={event => narration.setAutoAdvance(event.target.checked)} />
      Auto-advance through deck
    </label>
    <div className="slide-narration-actions" role="group" aria-label="Narration playback">
      {narration.phase === "paused"
        ? <button type="button" aria-label="Resume narration" disabled={!canPlay} onClick={narration.resume}><Play aria-hidden="true" />Resume</button>
        : running
          ? <button type="button" aria-label="Pause narration" disabled={!active} onClick={narration.pause}><Pause aria-hidden="true" />Pause</button>
          : <button type="button" aria-label="Play narration" disabled={!canPlay} onClick={narration.play}><Play aria-hidden="true" />Play</button>}
      <button type="button" aria-label="Stop narration" disabled={!running} onClick={narration.stop}><Square aria-hidden="true" />Stop</button>
      <button type="button" className="slide-narration-reload" aria-label={azure ? "Reload Azure voices" : "Reload on-device voices"}
        disabled={azure && narration.azureLoading} onClick={azure ? () => void narration.reloadAzureVoices() : narration.reloadVoices}><RotateCcw aria-hidden="true" />Reload voices</button>
    </div>
    <p className="slide-narration-status" role="status" aria-live="polite" aria-atomic="true">
      {status}{narration.totalChunks > 0 && ` ${Math.min(narration.completedChunks + (running ? 1 : 0), narration.totalChunks)} / ${narration.totalChunks} parts.`}
    </p>
    {narration.currentChunk && <div className="slide-narration-caption" role="group" aria-label="Current narration script" data-narration-target={narration.currentChunk.target}>
      <p className="slide-narration-caption-label">{narration.currentChunk.label}</p>
      <p data-testid="narration-caption">{narration.currentChunk.text}</p>
    </div>}
    {narration.totalChunks > 1 && <progress className="slide-narration-progress" aria-label="Narration progress" value={narration.completedChunks} max={narration.totalChunks} />}
    {narration.error && <p className="slide-narration-error" role="alert">{narration.error}</p>}
  </section>;
}
