# Lib Directory

This directory contains shared utilities, API layer, state management, types, and configuration used across the frontend application.

## Files

| File | Description |
|------|-------------|
| `api.ts` | API client for backend communication |
| `chatStore.ts` | Zustand store for global state |
| `config.ts` | Application configuration |
| `types.ts` | Shared TypeScript interfaces |
| `utils.ts` | Utility functions |

## Detailed Overview

### `api.ts`
Central API layer for all backend communication:
- Agent CRUD operations
- File upload/download
- Chat messaging
- Thread management
- Vector store operations

```tsx
import { API } from "@/lib/api";

// Example usage
const agents = await API.getAgents();
await API.createAgent(agentData);
```

### `chatStore.ts`
Zustand-based global state management:
- User settings (name, nickname)
- Selected agent state
- Persisted preferences

```tsx
import { useChatStore } from "@/lib/chatStore";

const { userName, selectedAgent } = useChatStore();
```

### `config.ts`
Application configuration:
- API base URL
- Environment-specific settings
- Feature flags

### `types.ts`
Shared TypeScript interfaces:
- `Agent` - Agent model
- `Message` - Chat message
- `Thread` - Conversation thread
- `VectorStore` - Knowledge base store

```tsx
import type { Agent, Message } from "@/lib/types";
```

### `utils.ts`
General utility functions:
- `cn()` - Tailwind class name merger (clsx + tailwind-merge)
- Date formatting
- String manipulation

```tsx
import { cn } from "@/lib/utils";

<div className={cn("base-class", isActive && "active-class")} />
```

## Best Practices

1. **Centralized Imports** - Import from `@/lib/` for consistency
2. **Type Safety** - Use types from `types.ts` throughout the app
3. **API Abstraction** - Always use `api.ts` for backend calls
4. **State Co-location** - Keep local state in components, global state in store
