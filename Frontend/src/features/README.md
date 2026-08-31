# Features Directory

This directory contains feature-based modules that encapsulate domain-specific logic, components, and utilities. Each feature is self-contained and represents a distinct area of the application.

## Directory Structure

```
features/
├── agents/           # Agent display components
├── chat/             # Chat functionality and hooks
├── create/           # Agent creation workflow
├── edit/             # Agent editing views
└── projects/         # Thread and project management
```

## Feature Modules

### `/agents`
Agent display and management:
- `AgentRow.tsx` - Agent list item component for LibraryView

### `/chat`
Chat functionality and state:
- `ChatBubble.tsx` - Individual message bubble component
- `ChatPane.tsx` - Message list renderer
- `useAgentChat.ts` - Hook for agent conversation logic

### `/create`
Complete agent creation workflow:
- `CreateView.tsx` - Main creation view orchestrator
- `ChoosePhase.tsx` - Agent type selection (Learning/Exam)
- `SetupPhase.tsx` - Course information and file upload
- `BuilderPhase.tsx` - Chat with TCA/ECA for agent building
- `useSetupPhaseLogic.ts` - Setup phase business logic hook
- `sharedUI.tsx` - Shared UI components (ChatInput, LoadingButton)
- `designSystem.ts` - Design tokens and theme constants
- `builderTypes.ts` - TypeScript types for builder phase
- `markdownUtils.ts` - Markdown parsing utilities

### `/edit`
Agent editing and configuration:
- `EditView.tsx` - Full-featured edit view with:
  - **Simplistic Mode** - Configure tab only
  - **Advanced Mode** - Chat, Configure, and Preview tabs

### `/projects`
Project and thread management:
- `ThreadList.tsx` - Conversation thread list component

## Architecture Pattern

Each feature follows a consistent pattern:
1. **View Component** - Main container (e.g., `CreateView.tsx`)
2. **Phase/Tab Components** - Sub-views for different states
3. **Hooks** - Business logic extracted to custom hooks
4. **Types** - Feature-specific TypeScript interfaces
5. **Utilities** - Helper functions specific to the feature

## Usage

Features are imported directly by pages:

```tsx
// In pages/TcaLacaBuilderApp.tsx
import CreateView from "@/features/create/CreateView";
import EditView from "@/features/edit/EditView";
```
