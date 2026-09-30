import { createRoot } from "react-dom/client";
import { AssetCard } from "./src/components/assets/AssetCard";
import { AssetContent } from "./src/components/assets/AssetContent";
import { AssetsSection } from "./src/components/assets/AssetsSection";
import { A2UISurfaces } from "./src/features/chat/A2UISurface";
import DashboardChatBubble from "./src/features/dashboard/chat/ChatBubble";
import { useMessagePagination } from "./src/lib/useMessagePagination";
import type { Asset, ContentBlock } from "./src/lib/types";
import type { A2UISurface } from "./src/lib/agui";

export function mountRetirementPreview(
  legacyAsset: Asset,
  supportedAsset: Asset,
  legacyBlock: ContentBlock,
  surfaces: Record<string, A2UISurface>,
) {
  const host = document.createElement("div");
  host.dataset.testid = "retirement-preview";
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <section>
      <div data-testid="retired-asset-preview">
        <AssetCard asset={legacyAsset} />
        <AssetContent content={legacyAsset.content} />
      </div>
      <div data-testid="supported-asset-preview">
        <AssetCard asset={supportedAsset} />
        <AssetContent content={supportedAsset.content} />
      </div>
      <A2UISurfaces surfaces={surfaces} />
      <DashboardChatBubble role="assistant" content="Analytics explanation remains." contentBlocks={[legacyBlock]} />
      <AssetsSection userId={supportedAsset.userId} />
    </section>,
  );
  return () => { root.unmount(); host.remove(); };
}

function HistoryPreview({ threadId }: { threadId: string }) {
  const { messages, totalMessages, isLoading } = useMessagePagination(threadId);
  return <output data-testid="retirement-history">{JSON.stringify({ messages, totalMessages, isLoading })}</output>;
}

export function mountRetirementHistory(threadId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<HistoryPreview threadId={threadId} />);
  return () => { root.unmount(); host.remove(); };
}
