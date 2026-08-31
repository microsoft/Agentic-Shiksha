import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import Markdown from "@/components/common/Markdown";
import { SectionScrollRail } from "@/components/common/SectionScrollRail";

type DocumentSection = {
  id: string;
  title: string;
};

function findVerticalScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function DocumentWithSectionRail({
  content,
  title,
}: {
  content: string;
  title?: string;
}) {
  const markdownRef = useRef<HTMLDivElement>(null);
  const sectionElementsRef = useRef<HTMLElement[]>([]);
  const [sections, setSections] = useState<DocumentSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = markdownRef.current;
    if (!root) return;

    const documentTitle = normalizeTitle(title || "");
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>("h1, h2, h3, h4"),
    ).filter((heading) => {
      const headingTitle = normalizeTitle(heading.textContent || "");
      return headingTitle
        && headingTitle !== documentTitle
        && headingTitle !== "table of contents";
    });

    const shallowestLevel = candidates.reduce(
      (level, heading) => Math.min(level, Number(heading.tagName.slice(1))),
      5,
    );
    const sectionElements = candidates.filter(
      (heading) => Number(heading.tagName.slice(1)) === shallowestLevel,
    );

    sectionElements.forEach((heading, index) => {
      if (!heading.id) heading.id = `document-section-${index + 1}`;
      heading.dataset.documentSectionIndex = String(index);
      heading.classList.add("scroll-mt-4");
    });

    sectionElementsRef.current = sectionElements;
    setSections(sectionElements.map((heading) => ({
      id: heading.id,
      title: (heading.textContent || `Section ${heading.dataset.documentSectionIndex}`).trim(),
    })));
    setActiveIndex(0);
    setScrollContainer(
      sectionElements[0] ? findVerticalScrollContainer(sectionElements[0]) : null,
    );
  }, [content, title]);

  useEffect(() => {
    if (!scrollContainer || sections.length < 2) return;

    const syncActiveSection = () => {
      const remainingScroll = scrollContainer.scrollHeight
        - scrollContainer.clientHeight
        - scrollContainer.scrollTop;
      if (remainingScroll <= 2) {
        setActiveIndex(sections.length - 1);
        return;
      }

      const activationTop = scrollContainer.getBoundingClientRect().top + 24;
      let nextIndex = 0;
      sectionElementsRef.current.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= activationTop) nextIndex = index;
      });
      setActiveIndex(nextIndex);
    };

    syncActiveSection();
    scrollContainer.addEventListener("scroll", syncActiveSection, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", syncActiveSection);
  }, [scrollContainer, sections.length]);

  const scrollToSection = useCallback((index: number) => {
    const section = sectionElementsRef.current[index];
    if (!section) return;
    const container = findVerticalScrollContainer(section);
    if (!container) return;

    const sectionOffset = section.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    container.scrollTop = Math.max(0, sectionOffset - 16);
    setActiveIndex(index);
  }, []);

  const hasSectionRail = sections.length > 1;

  return (
    <div
      className={clsx(
        "grid w-full items-start bg-transparent",
        hasSectionRail
          ? "grid-cols-[minmax(0,1fr)_2rem] gap-[22px]"
          : "grid-cols-1",
      )}
    >
      <div ref={markdownRef} className="min-w-0">
        <Markdown>{content}</Markdown>
      </div>

      {hasSectionRail && (
        <SectionScrollRail
          items={sections.map((section) => ({ id: section.id, label: section.title }))}
          activeIndex={activeIndex}
          onSelect={scrollToSection}
          ariaLabel="Document sections"
          className="sticky top-1/2 z-10 col-start-2 row-start-1 -translate-y-1/2 translate-x-9"
        />
      )}
    </div>
  );
}

export default DocumentWithSectionRail;