import { createRoot } from "react-dom/client";
import { SlidesLaunchCard } from "./src/features/chat/SlidesBlock";
import type { CompleteSlidesBlock } from "./src/lib/slides";

/** Browser-only fixture for replacing props on the real, already-open slide dialog. */
export function mountSlidesPreview(block: CompleteSlidesBlock) {
  const host = document.createElement("div");
  host.dataset.testid = "slides-replacement-harness";
  document.body.append(host);
  const root = createRoot(host);
  const update = (next: CompleteSlidesBlock) => root.render(<SlidesLaunchCard block={next} />);
  update(block);
  return { update, dispose: () => { root.unmount(); host.remove(); } };
}
