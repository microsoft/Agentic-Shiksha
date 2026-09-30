import { slideComponents, type Slide, type SlideHighlightTarget } from "./slides";

export type NarrationSource = "notes" | "slide";
export const NARRATION_RATES = [0.75, 1, 1.25, 1.5] as const;
export const NARRATION_CHUNK_LENGTH = 180;

export type NarrationSegment = { target: SlideHighlightTarget; label: string; text: string };
export type NarrationChunk = NarrationSegment & { segmentIndex: number };
export type NarrationPlan = {
  segments: NarrationSegment[];
  text: string;
  hasIntro: boolean;
  scriptedComponents: number;
  totalComponents: number;
  missingComponents: ReturnType<typeof slideComponents>;
};

export function getSlideNarration(slide: Slide | undefined, source: NarrationSource): NarrationPlan {
  const components = slide ? slideComponents(slide) : [];
  const bodyComponents = components.filter(component => component.target !== "title" && component.target !== "subtitle");
  const notes = new Map((slide?.component_notes ?? []).map(note => [note.target, note.text]));
  const hasIntro = !!slide?.speaker_notes.trim();
  const missingComponents = bodyComponents.filter(component => !notes.get(component.target)?.trim());
  const segments: NarrationSegment[] = [];
  if (source === "notes") {
    if (slide && hasIntro) segments.push({ target: "slide", label: "Slide / topic notes", text: slide.speaker_notes });
    for (const component of components) {
      const text = notes.get(component.target);
      // Trimming only tests presence; the stored script itself is never transformed.
      if (text?.trim()) segments.push({ target: component.target, label: component.label, text });
    }
  } else {
    segments.push(...components.filter(component => component.text.trim()));
  }
  return {
    segments, text: segments.map(segment => segment.text).join(""), hasIntro,
    scriptedComponents: bodyComponents.length - missingComponents.length,
    totalComponents: bodyComponents.length, missingComponents,
  };
}

/** Keep every character, prefer natural boundaries, and never split a surrogate pair. */
export function chunkNarration(text: string, maxLength = NARRATION_CHUNK_LENGTH): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 2 || maxLength > 1200) throw new Error("Invalid narration chunk limit.");
  const graphemes = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), part => part.segment)
    : Array.from(text);
  const units = graphemes.flatMap(part => part.length > maxLength ? Array.from(part) : [part]);
  const chunks: string[] = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let length = 0;
    let boundary = start;
    while (end < units.length && length + units[end].length <= maxLength) {
      length += units[end].length;
      end += 1;
      if (length >= maxLength / 2 && /[\s.!?。！？]/u.test(units[end - 1])) boundary = end;
    }
    if (end < units.length && boundary > start) end = boundary;
    chunks.push(units.slice(start, end).join(""));
    start = end;
  }
  return chunks;
}

export function narrationChunks(plan: NarrationPlan, maxLength = NARRATION_CHUNK_LENGTH): NarrationChunk[] {
  return plan.segments.flatMap((segment, segmentIndex) => chunkNarration(segment.text, maxLength).map(text => ({
    ...segment, text, segmentIndex,
  })));
}

export const narrationVoiceId = (voice: SpeechSynthesisVoice) => JSON.stringify([voice.voiceURI, voice.name, voice.lang]);

export function initialNarrationVoice(voices: SpeechSynthesisVoice[], languages: readonly string[]) {
  const indianEnglish = voices.find(voice => voice.lang.toLowerCase() === "en-in");
  if (indianEnglish) return indianEnglish;
  for (const language of languages) {
    const matching = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
    if (matching) return matching;
  }
  for (const language of languages) {
    const matching = voices.find(voice => voice.lang.split("-")[0].toLowerCase() === language.split("-")[0].toLowerCase());
    if (matching) return matching;
  }
  return voices.find(voice => voice.default) || voices[0];
}
