import { useLayoutEffect, useRef } from "react";
import type { Slide, SlideHighlightTarget, SlideLayout, SlideTheme } from "@/lib/slides";
import "./SlidesBlock.css";

const layoutLabels: Record<SlideLayout, string> = {
  title: "Introduction", section: "Section", content: "Key ideas", two_column: "Compare",
  question: "Think about it", summary: "Takeaways", process: "Step by step",
  timeline: "The journey", quote: "A perspective", key_stat: "In focus",
};

const narrationAttributes = (target: string, highlightedTarget?: SlideHighlightTarget | null) => ({
  "data-narration-target": target,
  "data-narration-active": target === highlightedTarget ? "true" : undefined,
});

function SlideBody({ slide, highlightedTarget }: { slide: Slide; highlightedTarget?: SlideHighlightTarget | null }) {
  if (slide.layout === "two_column") return <div className="slides-columns">
    {slide.columns.map((column, index) => <section key={index} {...narrationAttributes(`column-${index + 1}`, highlightedTarget)}>
      <h4>{column.heading}</h4>
      <ul>{column.bullets.map((bullet, item) => <li key={item} {...narrationAttributes(`column-${index + 1}-bullet-${item + 1}`, highlightedTarget)}>{bullet}</li>)}</ul>
    </section>)}
  </div>;
  if (slide.layout === "process") return <ol className="slides-process" data-count={slide.bullets.length}>
    {slide.bullets.map((bullet, index) => <li key={index} {...narrationAttributes(`bullet-${index + 1}`, highlightedTarget)}>
      <span className="slides-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <p>{bullet}</p>
    </li>)}
  </ol>;
  if (slide.layout === "timeline") return <ol className="slides-timeline">
    {slide.bullets.map((bullet, index) => <li key={index} {...narrationAttributes(`bullet-${index + 1}`, highlightedTarget)}>
      <span className="slides-timeline-marker" aria-hidden="true">{index + 1}</span>
      <p>{bullet}</p>
    </li>)}
  </ol>;
  if (slide.layout === "quote") return <figure className="slides-quotation">
    <span className="slides-quote-mark" aria-hidden="true">&ldquo;</span>
    <blockquote {...narrationAttributes("bullet-1", highlightedTarget)}>{slide.bullets[0]}</blockquote>
    {slide.subtitle && <figcaption {...narrationAttributes("subtitle", highlightedTarget)}>{slide.subtitle}</figcaption>}
  </figure>;
  if (slide.layout === "key_stat") return <div className="slides-statistic">
    <p className="slides-statistic-value" {...narrationAttributes("bullet-1", highlightedTarget)}>{slide.bullets[0]}</p>
    {slide.subtitle && <p className="slides-statistic-caption" {...narrationAttributes("subtitle", highlightedTarget)}>{slide.subtitle}</p>}
  </div>;
  if (!slide.bullets.length) return null;
  return <ul className="slides-bullets">{slide.bullets.map((bullet, index) => <li key={index} {...narrationAttributes(`bullet-${index + 1}`, highlightedTarget)}>{bullet}</li>)}</ul>;
}

export function SlideCanvas({ slide, theme, index, count, highlightedTarget }: {
  slide: Slide; theme: SlideTheme; index: number; count: number; highlightedTarget?: SlideHighlightTarget | null;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = shell.current;
    const area = fit.current;
    const body = content.current;
    if (!frame || !area || !body) return;
    let disposed = false;
    // Fit bounded text before paint without changing the 16:9 canvas.
    const resize = () => {
      if (disposed || !area.clientHeight) return;
      let scale = 1;
      area.style.setProperty("--slide-scale", "1");
      for (let attempt = 0; attempt < 16 && (body.scrollHeight > area.clientHeight || body.scrollWidth > area.clientWidth); attempt++) {
        scale *= Math.min(area.clientHeight / body.scrollHeight, area.clientWidth / body.scrollWidth, 0.95) * 0.97;
        area.style.setProperty("--slide-scale", String(scale));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    void document.fonts.ready.then(resize);
    return () => { disposed = true; observer.disconnect(); };
  }, [slide, theme]);

  return <div ref={shell} className={`slides-canvas-shell slides-theme-${theme}`} data-testid="slide-canvas" data-layout={slide.layout} data-narration-focus={highlightedTarget || undefined}>
    <div className={`slides-canvas slides-layout-${slide.layout}`} role="group" aria-label={`Slide ${index + 1}: ${slide.title}`}>
      <div className="slides-eyebrow" aria-hidden="true">{layoutLabels[slide.layout]}</div>
      <div className="slides-fit" ref={fit}>
        <div ref={content} className="slides-fit-content">
          <h3 {...narrationAttributes("title", highlightedTarget === "slide" ? "title" : highlightedTarget)}>{slide.title}</h3>
          {slide.subtitle && !["quote", "key_stat"].includes(slide.layout) && <p className="slides-subtitle" {...narrationAttributes("subtitle", highlightedTarget)}>{slide.subtitle}</p>}
          <SlideBody slide={slide} highlightedTarget={highlightedTarget} />
        </div>
      </div>
      <div className="slides-canvas-footer" aria-hidden="true"><span>EKALAIVA · Learning slides</span><span>{index + 1} / {count}</span></div>
    </div>
  </div>;
}
