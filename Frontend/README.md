# Ekalaiva Frontend

A modern React + TypeScript frontend for the Ekalaiva AI Agent Builder platform. This application enables users to create, configure, and interact with educational AI agents.

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite (Rolldown)
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **Icons**: Lucide React
- **HTTP Client**: Fetch API
- **Markdown**: React Markdown + KaTeX

## Features

- 🤖 **Agent Creation** - Create Learning and Exam agents with guided workflow
- 📚 **Knowledge Base** - Upload documents to build agent knowledge
- 💬 **Real-time Chat** - Converse with agents using streaming responses
- ⚙️ **Configuration** - Edit agent settings in Simplistic or Advanced mode
- 🎨 **Dark Theme** - Beautiful dark UI with gradient accents

## Project Structure

```
Frontend/
├── public/              # Static assets
├── src/
│   ├── assets/          # Images and icons
│   ├── components/      # Reusable UI components
│   │   ├── chat/        # Chat interface components
│   │   ├── common/      # Shared utility components
│   │   ├── layout/      # Sidebar, header, dialogs
│   │   └── ui/          # Base UI primitives (shadcn/ui)
│   ├── features/        # Feature modules
│   │   ├── agents/      # Agent display components
│   │   ├── chat/        # Chat logic and hooks
│   │   ├── create/      # Agent creation workflow
│   │   ├── edit/        # Agent editing views
│   │   └── projects/    # Thread management
│   ├── lib/             # Utilities and configuration
│   │   ├── api.ts       # API client
│   │   ├── chatStore.ts # Zustand store
│   │   ├── types.ts     # TypeScript interfaces
│   │   └── utils.ts     # Helper functions
│   ├── pages/           # Top-level page components
│   │   ├── ChatView.tsx
│   │   ├── LibraryView.tsx
│   │   └── TcaLacaBuilderApp.tsx
│   ├── App.tsx          # Root component
│   └── main.tsx         # Entry point
├── index.html           # HTML template
├── package.json         # Dependencies
├── tailwind.config.cjs  # Tailwind configuration
├── tsconfig.json        # TypeScript configuration
└── vite.config.ts       # Vite configuration
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables

Create a `.env` file:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Key Views

### Library View
Browse and manage all created agents with filtering by type.

### Create View
Three-phase workflow:
1. **Choose** - Select agent type (Learning/Exam)
2. **Setup** - Enter course info and upload documents
3. **Builder** - Chat with TCA/ECA to configure agent

### Edit View
Two modes:
- **Simplistic** - Configure tab only (course info, files)
- **Advanced** - Full access (Chat, Configure, Preview tabs)

### Chat View
Full-screen conversation interface with the selected agent.

## Architecture

See the [root README](../README.md) for the system diagram and service layout, and
[src/README.md](src/README.md) for how this app is organised internally.

## API Integration

The frontend communicates with the FastAPI backend via REST endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /agents` | List all agents |
| `POST /agent/create` | Create new agent |
| `PUT /agent/{id}` | Update agent |
| `DELETE /agent/{id}` | Delete agent |
| `POST /chat/{id}` | Send message |
| `POST /files/upload` | Upload documents |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## Docker

```bash
# Build image
docker build -t ekalaiva-frontend .

# Run container
docker run -p 3000:80 ekalaiva-frontend
```

## Contributing

1. Follow the feature-based folder structure
2. Use TypeScript for all new code
3. Style with Tailwind CSS utilities
4. Keep components small and focused
5. Add README files for new directories
