# components/assets

Rendering for the structured blocks an agent produces — the "assets" of a conversation.

| Component | Purpose |
| --- | --- |
| [AssetsSection.tsx](AssetsSection.tsx) | Container listing a conversation's assets. |
| [AssetCard.tsx](AssetCard.tsx) | Collapsed card for a single asset. |
| [AssetContent.tsx](AssetContent.tsx) | Expanded body, dispatched by asset type. |
| [DocumentWithSectionRail.tsx](DocumentWithSectionRail.tsx) | Long document with a section navigation rail. |
| [assetPayload.ts](assetPayload.ts) | `parseAssetPayload`, `AssetPayload`, `InventoryAnswer`, `isConceptInventoryContent`. |

`assetPayload.ts` is the boundary between the backend's tool output and the UI. It parses
model-generated payloads, so it must treat a malformed or unexpected shape as a normal
case and fail into a safe fallback — a thrown parse error here takes the chat pane down
with it.

Assets are produced by the custom tools in
[Backend/agent_tools/custom/](../../../../Backend/agent_tools/custom) — `add_document`,
`add_quiz`, `add_flashcard`, `add_challenge` and friends. Inline chat-pane rendering of
those blocks lives in [../../features/chat/](../../features/chat); this folder is the
side-panel and document view.
