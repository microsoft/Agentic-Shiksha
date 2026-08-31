# Components Directory

This directory contains reusable UI components organized by their purpose and scope.

## Directory Structure

```
components/
├── chat/             # Chat-related components
├── common/           # Shared utility components
├── layout/           # Layout and navigation components
├── ui/               # Base UI primitives (shadcn/ui)
├── AgentTypeDialog.tsx    # Dialog for selecting agent type
└── EditModeDialog.tsx     # Dialog for selecting edit mode
```

## Subdirectories

### `/chat`
Chat interface components:
- `UnifiedChatContainer.tsx` - Consistent chat UI used across the app (builder, preview, agent chat)

### `/common`
Reusable utility components:
- `Chat.tsx` - Legacy chat component
- `DarkFileInput.tsx` - Dark-themed file upload input with drag-and-drop
- `Markdown.tsx` - Markdown renderer with syntax highlighting
- `SectionTitle.tsx` - Styled section headers

### `/layout`
Application layout components:
- `Sidebar.tsx` - Main navigation sidebar with agent list
- `SettingsDialog.tsx` - User settings modal

### `/ui`
Base UI primitives from [shadcn/ui](https://ui.shadcn.com/):
- Buttons, inputs, cards, dialogs, tabs, etc.
- Styled for dark theme with Tailwind CSS
- Accessible and composable

## Component Guidelines

1. **Single Responsibility** - Each component should do one thing well
2. **Props Over State** - Prefer controlled components with props
3. **TypeScript** - All components use TypeScript for type safety
4. **Tailwind CSS** - Use Tailwind utilities for styling
5. **Accessibility** - Include proper ARIA attributes and keyboard support

## Usage Example

```tsx
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import { DarkFileInput } from "@/components/common/DarkFileInput";
import { Button } from "@/components/ui/button";
```
