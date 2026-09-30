import { useLayoutEffect, useRef } from "react";
import { slideComponents, type Slide, type SlideHighlightTarget } from "@/lib/slides";

export default function SlideNotes({ slide, highlightedTarget }: { slide: Slide; highlightedTarget?: SlideHighlightTarget | null }) {
  const root = useRef<HTMLDivElement>(null);
  const notes = new Map(slide.component_notes?.map(note => [note.target, note.text]));
  const components = slideComponents(slide).filter(component => notes.has(component.target));
  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>(".slides-details, .slides-presenter-notes");
    const current = root.current?.querySelector<HTMLElement>('[data-note-active="true"]');
    if (!scroller?.clientHeight || !current) return;
    const frame = scroller.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    // Reveal only within the notes pane; never scroll the slide or the chat.
    if (item.height > frame.height - 16 || item.top < frame.top + 8) scroller.scrollTop += item.top - frame.top - 8;
    else if (item.bottom > frame.bottom - 8) scroller.scrollTop += item.bottom - frame.bottom + 8;
  });
  return <div ref={root} className="slide-note-scripts">
    <p className="slide-note-label">Slide / topic notes</p>
    <p className="slide-note-text" data-note-active={highlightedTarget === "slide" ? "true" : undefined}>
      {slide.speaker_notes || "No speaker notes for this slide."}
    </p>
    {components.length > 0 && <section aria-label="Component speaker notes" className="slide-component-scripts">
      <p className="slide-note-label">Component notes · spoken in slide order</p>
      <ol>{components.map(component => <li key={component.target} data-note-target={component.target} data-note-active={highlightedTarget === component.target ? "true" : undefined}>
        <p className="slide-note-component-label">{component.label}: {component.text}</p>
        <p className="slide-note-text">{notes.get(component.target)}</p>
      </li>)}</ol>
    </section>}
  </div>;
}
