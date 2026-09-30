/* eslint-disable react-refresh/only-export-components -- Browser-only fixture mounted imperatively by Playwright. */
import { StrictMode, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import SlideNarration from "./src/features/chat/SlideNarration";
import SlidesPresenter from "./src/features/chat/SlidesPresenter";
import { SlideCanvas } from "./src/features/chat/SlideCanvas";
import type { SlideDeck, SlideHighlightTarget } from "./src/lib/slides";
import "./src/index.css";

type Options = { initialIndex?: number; secondPanel?: boolean; agentId?: string; allowAzure?: boolean };

function Fixture({ deck: initialDeck, options }: { deck: SlideDeck; options: Options }) {
  const [deck, setDeck] = useState(initialDeck);
  const [index, setIndex] = useState(options.initialIndex || 0);
  const [secondIndex, setSecondIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [active, setActive] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [advances, setAdvances] = useState(0);
  const [keys, setKeys] = useState(0);
  const [highlight, setHighlight] = useState<SlideHighlightTarget | null>(null);
  const [secondHighlight, setSecondHighlight] = useState<SlideHighlightTarget | null>(null);
  const [revision, setRevision] = useState(0);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " ", "b"].includes(event.key)) setKeys(value => value + 1);
  };
  return <main onKeyDown={keyDown} style={{ width: "100%", maxWidth: 1000, padding: 12, boxSizing: "border-box" }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" onClick={() => setIndex(value => Math.max(0, value - 1))}>Previous preview slide</button>
      <button type="button" onClick={() => setIndex(value => Math.min(deck.slides.length - 1, value + 1))}>Next preview slide</button>
      <button type="button" onClick={() => setActive(value => !value)}>{active ? "Deactivate narration" : "Activate narration"}</button>
      <button type="button" onClick={() => setVisible(value => !value)}>{visible ? "Hide first narration" : "Show first narration"}</button>
      <button type="button" onClick={() => setDeck(value => ({ ...value, title: "Updated presentation" }))}>Replace deck</button>
      <button type="button" onClick={() => setRevision(value => value + 1)}>Rerender narration</button>
      <button type="button" onClick={() => {
        Object.assign(deck.slides[index], { speaker_notes: "Changed saved script." });
        setRevision(value => value + 1);
      }}>Mutate current script</button>
      <button type="button" onClick={() => setPresenting(true)}>Start presentation</button>
    </div>
    <p>Slide <output data-testid="preview-position">{index + 1}</output></p>
    <output data-testid="automatic-advances">{advances}</output>
    <output data-testid="preview-key-events">{keys}</output>
    <output data-testid="narration-target">{highlight ?? ""}</output>
    <output data-testid="secondary-narration-target">{secondHighlight ?? ""}</output>
    <output data-testid="navigation-revision">{navigationRevision}</output>
    <div data-testid="primary-narration">
      {visible && <SlideNarration deck={deck} index={index} active={active && !presenting} agentId={options.agentId} allowAzure={options.allowAzure} onHighlightChange={target => setHighlight(target)} onNavigate={next => {
        setIndex(next);
        setAdvances(value => value + 1);
        setNavigationRevision(revision);
      }} />}
    </div>
    <div data-testid="narration-preview">
      <SlideCanvas slide={deck.slides[index]} theme={deck.theme} index={index} count={deck.slides.length} highlightedTarget={highlight} />
    </div>
    {options.secondPanel && <div data-testid="secondary-narration">
      <SlideNarration deck={deck} index={secondIndex} onNavigate={setSecondIndex} onHighlightChange={setSecondHighlight} />
    </div>}
    {presenting && <SlidesPresenter deck={deck} initialIndex={index} agentId={options.agentId} allowAzure={options.allowAzure} onClose={next => {
      setIndex(next);
      setPresenting(false);
    }} />}
  </main>;
}

export function mountNarrationFixture(deck: SlideDeck, options: Options = {}) {
  const host = document.createElement("div");
  host.dataset.testid = "narration-harness";
  document.body.append(host);
  const root = createRoot(host);
  root.render(<StrictMode><Fixture deck={deck} options={options} /></StrictMode>);
  return { dispose: () => { root.unmount(); host.remove(); } };
}
