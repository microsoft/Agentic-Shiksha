import { useMemo, useState } from "react";
import { Download, ImageIcon, X } from "lucide-react";
import { useChatStore } from "@/lib/chatStore";

export type MediaItem = {
  id: string;
  src: string;
  title: string;
  caption?: string;
  source: "generated" | "uploaded";
  threadId: string;
  agentId?: string;
  createdAt?: number;
};

function toImageSrc(imageData?: string, imageUrl?: string): string {
  if (imageUrl) return imageUrl;
  if (!imageData) return "";
  return imageData.startsWith("data:") ? imageData : `data:image/png;base64,${imageData}`;
}

async function downloadImage(item: MediaItem) {
  const safeName = (item.title || "image").replace(/[^\w\d\-. ]+/g, "_").trim() || "image";
  try {
    // Blob-storage URLs ignore the `download` attribute (cross-origin), so fetch the bytes first.
    const blob = await (await fetch(item.src)).blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(item.src, "_blank", "noopener,noreferrer");
  }
}

/** Media lives inside chat history, so it is collected from the synced threads. */
function useLibraryMedia(): MediaItem[] {
  const messagesByThreadId = useChatStore((s) => s.messagesByThreadId);
  const threads = useChatStore((s) => s.threads);

  return useMemo(() => {
    const items: MediaItem[] = [];

    for (const [threadId, messages] of Object.entries(messagesByThreadId || {})) {
      const agentId = threads?.[threadId]?.agentId;

      (messages || []).forEach((message, messageIndex) => {
        (message.imageUrls || []).forEach((url, urlIndex) => {
          if (!url) return;
          items.push({
            id: `${threadId}-${messageIndex}-upload-${urlIndex}`,
            src: url,
            title: "Uploaded image",
            source: "uploaded",
            threadId,
            agentId,
            createdAt: message.createdAt,
          });
        });

        (message.contentBlocks || []).forEach((block, blockIndex) => {
          if (
            block.type !== "tikz_image"
            && block.type !== "generated_image"
          ) return;
          const src = toImageSrc(
            block.imageData,
            block.type === "generated_image" ? block.imageUrl : undefined,
          );
          if (!src) return;
          items.push({
            id: `${threadId}-${messageIndex}-gen-${blockIndex}`,
            src,
            title: block.title || "Generated image",
            caption: block.caption,
            source: "generated",
            threadId,
            agentId,
            createdAt: message.createdAt,
          });
        });
      });
    }

    return items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [messagesByThreadId, threads]);
}

export function LibraryMediaGrid({ searchQuery }: { searchQuery: string }) {
  const items = useLibraryMedia();
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? items.filter((item) =>
        item.title.toLowerCase().includes(query)
        || (item.caption || "").toLowerCase().includes(query))
    : items;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800">
          <ImageIcon className="h-7 w-7 text-neutral-500" />
        </div>
        <p className="text-lg font-medium text-neutral-300">No media yet</p>
        <p className="mt-1 max-w-sm text-sm text-neutral-500">
          Images your assistant generates, and images you upload in chat, collect here.
        </p>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <p className="py-20 text-center text-sm text-neutral-500">
        No media matches “{searchQuery}”.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreview(item)}
            className="group overflow-hidden rounded-xl border border-neutral-700/60 bg-neutral-800/60 text-left transition-colors hover:border-neutral-500"
          >
            {/* Height follows the image so wide diagrams are shown whole, not cropped. */}
            <div className="w-full overflow-hidden bg-neutral-900">
              <img
                src={item.src}
                alt={item.title}
                loading="lazy"
                className="h-auto w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
              />
            </div>
            <div className="truncate px-3 py-2 text-xs text-neutral-300">{item.title}</div>
          </button>
        ))}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-full w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-3">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                {preview.title}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => downloadImage(preview)}
                  className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                  aria-label="Download image"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                  aria-label="Close preview"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto bg-neutral-950 p-4">
              <img src={preview.src} alt={preview.title} className="mx-auto max-w-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
