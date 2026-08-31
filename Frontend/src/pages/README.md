# Pages Directory

This directory contains top-level page components that serve as route endpoints in the application. Each page represents a distinct view or screen that users navigate to.

## Files

| File | Description |
|------|-------------|
| `TcaLacaBuilderApp.tsx` | Main application shell with routing |
| `LibraryView.tsx` | Agent library/list view |
| `ChatView.tsx` | Agent chat interface |

## Page Components

### `TcaLacaBuilderApp.tsx`
The main application shell that orchestrates navigation:
- Integrates sidebar navigation
- Routes between Create, Edit, Library, and Chat views
- Manages agent selection state
- Handles view mode switching (Simplistic/Advanced)

### `LibraryView.tsx`
Agent library view displaying all created agents:
- Tab-based filtering: All | Learning | Exam
- Agent cards with metadata (model, type, status)
- Quick actions: Chat, Edit, Delete
- Empty state for new users

### `ChatView.tsx`
Full-screen chat interface for conversing with agents:
- Unified chat container with message history
- Thread management for conversation context
- Real-time message streaming
- File attachment support

## Navigation Flow

```
TcaLacaBuilderApp (Shell)
├── LibraryView (default)
│   └── ChatView (when agent selected for chat)
├── CreateView (when creating new agent)
│   ├── ChoosePhase
│   ├── SetupPhase
│   └── BuilderPhase
└── EditView (when editing agent)
    ├── Simplistic Mode (Configure only)
    └── Advanced Mode (Chat | Configure | Preview)
```

## State Management

Pages connect to:
- **Zustand Store** (`lib/chatStore.ts`) - Global user/agent state
- **Local State** - View-specific UI state
- **URL Params** - Navigation state (agent ID, view mode)

## Usage

These pages are composed in `TcaLacaBuilderApp.tsx`:

```tsx
{view === "library" && <LibraryView />}
{view === "chat" && <ChatView />}
{view === "create" && <CreateView />}
{view === "edit" && <EditView />}
```
