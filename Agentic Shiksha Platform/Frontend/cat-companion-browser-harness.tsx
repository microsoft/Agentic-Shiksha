import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import ChatPane from "./src/features/chat/ChatPane";
import DashboardChatPane from "./src/features/dashboard/chat/ChatPane";
import { UnifiedChatContainer } from "./src/components/chat/UnifiedChatContainer";

export type CompanionChatPreviewState = {
  kind: "teaching" | "dashboard" | "starters";
  isSending: boolean;
  isTyping: boolean;
  statusLabel: string | null;
  toolActivity: string | null;
  draft: string;
  conversation: number;
  active: boolean;
  readOnly: boolean;
  empty: boolean;
};

export type CompanionChatPreviewController = {
  setState: (patch: Partial<CompanionChatPreviewState>) => void;
  dispose: () => void;
};

export function mountCompanionChatPreview(initial: Partial<CompanionChatPreviewState> = {}): CompanionChatPreviewController {
  let state: CompanionChatPreviewState = {
    kind: "teaching", isSending: false, isTyping: false, statusLabel: null, toolActivity: null,
    draft: "", conversation: 1, active: true, readOnly: false, empty: false,
    ...initial,
  };
  const application = document.getElementById("root");
  const previousHidden = application?.getAttribute("aria-hidden");
  application?.setAttribute("aria-hidden", "true");
  const host = document.createElement("div");
  host.dataset.testid = "cat-chat-preview";
  host.style.cssText = "position:fixed;inset:0;z-index:10000;background:#171717;";
  document.body.append(host);
  const root = createRoot(host);

  function setState(patch: Partial<CompanionChatPreviewState>) {
    state = { ...state, ...patch };
    render();
  }

  function render() {
    const createdAt = Date.UTC(2026, 0, 1) + state.conversation * 1000;
    const messages = state.empty ? [] : [
      { role: "user" as const, content: "Help me understand this lesson.", createdAt },
      {
        role: "assistant" as const, content: "Let's work through it together.", createdAt: createdAt + 1,
        contentBlocks: state.toolActivity ? [{ type: "tool_activity" as const, activityId: "preview-activity", label: state.toolActivity, done: false }] : undefined,
      },
    ];
    root.render(
      <StrictMode>
        <MemoryRouter>
          <section data-chat-companion-surface aria-label="Chat companion preview" className="flex h-full flex-col bg-neutral-900 p-4 text-neutral-100">
            <h1 className="mb-3 text-lg font-semibold">Chat companion preview</h1>
            {state.kind === "starters" ? (
              <UnifiedChatContainer messages={messages} input={state.draft}
                onInputChange={event => setState({ draft: event.target.value })}
                onSend={() => setState({ isSending: true })}
                isSending={state.isSending} isTyping={state.isTyping}
                emptyStateSuggestions={["Why should I learn this course?", "Check my understanding", "Try a challenge", "Explain a concept"]}
                onSuggestionClick={suggestion => setState({ draft: suggestion })}
                threadId={`preview-${state.conversation}`} />
            ) : state.kind === "teaching" ? (
              <ChatPane messages={messages} threadId={`preview-${state.conversation}`} agentName="Preview tutor"
                isSending={state.isSending} isTyping={state.isTyping} statusLabel={state.statusLabel}
                companionActivityKey={state.draft} companionActive={state.active} readOnly={state.readOnly} />
            ) : (
              <DashboardChatPane messages={messages.map(({ role, content, createdAt }) => ({ role, content, createdAt }))} isSending={state.isSending} isTyping={state.isTyping}
                companionActivityKey={state.draft} companionActive={state.active} readOnly={state.readOnly} />
            )}
            <label className="mt-3 block text-sm">
              Companion draft
              <input aria-label="Companion draft" value={state.draft} disabled={state.readOnly}
                onChange={event => setState({ draft: event.target.value })}
                className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3" />
            </label>
          </section>
        </MemoryRouter>
      </StrictMode>,
    );
  }
  render();
  return {
    setState,
    dispose: () => {
      root.unmount();
      host.remove();
      if (previousHidden == null) application?.removeAttribute("aria-hidden");
      else application?.setAttribute("aria-hidden", previousHidden);
    },
  };
}
