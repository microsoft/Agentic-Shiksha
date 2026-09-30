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
`add_quiz`, `add_challenge` and friends. Inline chat-pane rendering of
those blocks lives in [../../features/chat/](../../features/chat); this folder is the
side-panel and document view.

Circuits render through `SimulationWorkspace` directly in Circuit Lab, with editing in
interactive course views and read-only playback in shared views. Legacy circuit envelopes
ignore obsolete trainer metadata without rewriting the stored record. Retired
`industrial_trainer` assets are hidden rather than opened or deleted.

[`retiredContent.ts`](../../lib/retiredContent.ts) hides retired assets by their
legacy category or payload, including old untyped JSON. This is read-only filtering,
not a migration: stored content is not deleted or rewritten. The backend must exclude
retired assets before list limits/counts; defensive frontend filters preserve response
metadata and leave supported asset types unchanged.
