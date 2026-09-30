# components/chat

Chat shell for the admin analytics agent.

| Component | Purpose |
| --- | --- |
| [UnifiedChatContainer.tsx](UnifiedChatContainer.tsx) | Controlled composer, message scrolling, suggestions, send/stop and optional retry callbacks. |

A stripped version of the container in
[Frontend/src/components/chat/](<../../../../../Agentic Shiksha Platform/Frontend/src/components/chat>). The
analytics agent answers questions about usage and progress; it does not teach, so this
shell carries no quiz, challenge or A2UI rendering. It also omits speech input,
uploads, web-search and deep-research controls.

Message components live in [../../features/chat/](../../features/chat).
The parent [DashboardView](../../pages/DashboardView.tsx) owns messages,
network/SSE handling and cancellation. This shell neither persists conversations
nor authenticates callers. Keep send/stop state and callbacks coordinated with
that parent; do not add a second API client here.
