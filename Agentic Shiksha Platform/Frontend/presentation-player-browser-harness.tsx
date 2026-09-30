/* eslint-disable react-refresh/only-export-components -- Browser-only fixture mounted imperatively by Playwright. */
import { useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { AssetFullscreenButton } from "./src/components/assets/AssetFullscreenButton";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./src/components/ui/dialog";
import SlidesPresenter from "./src/features/chat/SlidesPresenter";
import type { SlideDeck } from "./src/lib/slides";
import "./src/index.css";

type Options = { initialIndex?: number; nested?: boolean };

function Preview({ deck, initialIndex = 0 }: { deck: SlideDeck; initialIndex?: number }) {
  const [index, setIndex] = useState(initialIndex);
  const [presenting, setPresenting] = useState(false);
  const [exits, setExits] = useState(0);
  const [previewKeys, setPreviewKeys] = useState(0);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) setPreviewKeys(value => value + 1);
  };
  return <section aria-label="Slide preview fixture" data-fullscreen-surface onKeyDown={keyDown}>
    <p data-testid="preview-slide-title">{deck.slides[index]?.title}</p>
    <output data-testid="preview-position">{index + 1}</output>
    <output data-testid="presentation-exits">{exits}</output>
    <output data-testid="preview-key-events">{previewKeys}</output>
    <AssetFullscreenButton />
    <button type="button" onClick={() => setPresenting(true)}>Start presentation</button>
    {presenting && <SlidesPresenter deck={deck} initialIndex={index} onClose={next => {
      setIndex(next);
      setExits(value => value + 1);
      setPresenting(false);
    }} />}
  </section>;
}

function Fixture({ deck, options }: { deck: SlideDeck; options: Options }) {
  const [clicks, setClicks] = useState(0);
  return <>
    <button type="button" onClick={() => setClicks(value => value + 1)}>Outside control: {clicks}</button>
    {options.nested ? <Dialog>
      <DialogTrigger asChild><button type="button">Open slide preview</button></DialogTrigger>
      <DialogContent className="slides-dialog" data-testid="outer-preview-dialog">
        <DialogTitle>Preview: {deck.title}</DialogTitle>
        <DialogDescription>Preview a slide before starting presentation mode.</DialogDescription>
        <Preview deck={deck} initialIndex={options.initialIndex} />
      </DialogContent>
    </Dialog> : <Preview deck={deck} initialIndex={options.initialIndex} />}
  </>;
}

/** Browser-only fixture: exercises the real player independently of chat and editor APIs. */
export function mountPresentationPlayer(deck: SlideDeck, options: Options = {}) {
  const host = document.createElement("div");
  host.dataset.testid = "presentation-player-harness";
  document.body.append(host);
  const root = createRoot(host);
  root.render(<Fixture deck={deck} options={options} />);
  return { dispose: () => { root.unmount(); host.remove(); } };
}
