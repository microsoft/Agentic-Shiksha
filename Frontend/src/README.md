# Frontend Source Directory

This directory contains all the source code for the Ekalaiva frontend application built with React, TypeScript, and Vite.

## Directory Structure

```
src/
├── assets/           # Static assets (images, icons, etc.)
├── components/       # Reusable UI components
├── features/         # Feature-based modules (domain logic)
├── lib/              # Utilities, API, stores, and types
├── pages/            # Top-level page components
├── App.tsx           # Main application component
├── main.tsx          # Application entry point
├── index.css         # Global styles (Tailwind base)
└── App.css           # App-specific styles
```

## Key Files

| File | Description |
|------|-------------|
| `main.tsx` | React entry point, mounts the app |
| `App.tsx` | Root component with providers |
| `index.css` | Tailwind CSS imports and global styles |

## Architecture Overview

The frontend follows a **feature-first** architecture:

1. **Pages** - Top-level route components (`ChatView`, `LibraryView`, `TcaLacaBuilderApp`)
2. **Features** - Domain-specific modules (`create/`, `edit/`, `chat/`, `agents/`)
3. **Components** - Reusable UI elements (`ui/`, `common/`, `layout/`)
4. **Lib** - Shared utilities, API layer, state stores, and types

## State Management

- **Zustand** - Global state via `lib/chatStore.ts`
- **React useState/useReducer** - Local component state
- **React Context** - Theme and configuration

## Styling

- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Pre-built accessible components in `components/ui/`
- **Custom CSS** - Minimal custom styles in `.css` files

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```
