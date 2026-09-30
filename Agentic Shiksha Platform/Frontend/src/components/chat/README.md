# components/chat

Chat surfaces shared across features — the shell and side panels, rather than the
individual message blocks.

`CatCompanion` owns its SVG, colors, timing, reduced-motion rules, and shared
gait stylesheet. Its only actions are `sit`, `walk`, `run`, `stretch`, and `sleep`;
the catalogue and live chat render this same component. `ChatCompanion` uses
`chatCompanionState` to resolve both motion and speech from the same state.
Chat containers mark their interaction boundary with `data-chat-companion-surface`;
composer text and conversation keys also reset inactivity. The cat stretches
once after work and sleeps after two minutes without interaction. At night
(22:00-06:00 in the user's local time), it starts asleep and returns to sleep
after one minute without interaction. Typing, clicking, or focusing the chat
wakes it; active agent work always takes priority over sleep. Timers/listeners
are cleared on unmount or deactivation. The generated gait stylesheet is hoisted
and deduplicated across instances.

The cat's empty greeting, ready prompt, drafting hint, sleep message, and live
tool information follow its current scenario. Copy rotates every 20 seconds
(40 seconds while asleep); the actual tool label stays stable until the tool
changes and is the only live-announced text. Asset-generation labels such as
creating a slide deck or simulating a circuit select running even before text
streams. Other tool work uses walking. No timer invents a completion percentage
or an agent step. Pending clarification answers alternate standing for 10 seconds
and stretching for 4.8 seconds, but can also become idle/asleep.

The selected pairing is automatic: `speech` (Classic speech) for every awake
pose, and `thought` (Soft thought) with a small thought trail while sleeping.
The optional `bubbleVariant` prop can override this pairing for design previews,
including the `whisper` and `card` alternatives. `ChatCompanionBubble`
renders the same artwork and bubble in previews without duplicating the state
resolver. In empty course chats, the cat sits or sleeps on the top edge of the
first conversation starter. Its bubble stays above the cards, including when
text wraps on mobile; the decoration does not intercept starter clicks.
In `ChatPane`, only a matching pending tool-activity annotation in the
current assistant message is suppressed while the companion displays that label.
Stored blocks, completed steps, other activities, and the actual answer remain
untouched.

| Component | Purpose |
| --- | --- |
| [UnifiedChatContainer.tsx](UnifiedChatContainer.tsx) | Consistent chat shell used across the app. |
| [CatCompanion.tsx](CatCompanion.tsx) | Shared five-pose cat artwork and activity-driven `ChatCompanion`. |
| [chatCompanionState.ts](chatCompanionState.ts) | Local-time/idle state, scenario copy, and live-status deduplication. |
| [companionCatGaits.ts](companionCatGaits.ts) | Coordinated walking/running CSS keyframes and leg pivots. |
| [ChatHistoryDrawer.tsx](ChatHistoryDrawer.tsx) | Past conversations drawer. |
| [LearnerProfileDialog.tsx](LearnerProfileDialog.tsx) | Keyboard-accessible Overview / Learning / Memory tabs, confirmed account-wide instructions, and scoped course progress. |
| [ChatQueryRail.tsx](ChatQueryRail.tsx) | Rail of queries within the current conversation. |
| [ResearchSidePanel.tsx](ResearchSidePanel.tsx) | Side panel for research output. |
| [ResearchMessageCard.tsx](ResearchMessageCard.tsx) | A single research result. |
| [ResearchMCQ.tsx](ResearchMCQ.tsx) | `parseMCQQuestions`, `ResearchMCQQuestion`, `ResearchMCQ`. |

The learner profile reads `GET /api/learner-profile/learning/{agent_id}` for the
signed-in learner's persisted state and saved account preferences. Progress is
computed from actual topic statuses, not cached aggregate percentages, using the
same [summary helper](../../lib/learningProgress.ts) as the curriculum's **Your
progress** card. **Topics covered** includes both learned and in-progress topics,
with explicit statuses, learned topics first and alphabetical order within each
status. Untouched topics stay in the total but not the covered list; in-progress
topics are not counted as completed. Strengths are recorded learned topics; focus
areas are in-progress topics/concepts. Open progress views refresh after the
current learner's chat finishes, and profile Refresh re-reads the saved snapshot
without overwriting unsaved instructions. Authoritative courses still use Graph
Memory rather than inferring mastery from legacy progress.
The TA-menu profile icon matches the other muted-gray action icons. The dialog
uses neutral surfaces, gray progress and status icons, and visible neutral
keyboard-focus indicators rather than green accents. A consistent 13px scale
aligns section headings, tabs, topic rows and actions; 12px supporting text and
larger summary numbers provide the hierarchy. The compact, viewport-bounded
dialog keeps the header, tabs and footer fixed while the content scrolls. Changing
tabs returns the content to the top without clearing instruction drafts.
The header places a text-only **Refresh** button beside Close, with a disabled,
accessible busy state while loading and no separate learner/course identity row.
Overview leads with recorded progress and the next practice action; covered
topics follow in aligned two-column rows (one column on mobile), with every
covered topic retained. **Save instructions** appears on Learning, or on any tab
while edits are pending, with a subdued disabled state and a light enabled state.
Learning puts the instruction editor first, followed by saved preferences and
recorded strengths/focus areas, so long topic lists do not bury the editing controls.
Error and destructive warnings retain their semantic colors.
**Practice** opens a draft for the most recently touched in-progress topic and
does not send automatically. Unsaved instruction edits survive tab changes and
block starting practice until saved or discarded.

Custom instructions include optional one-click defaults for step-by-step guidance,
everyday examples, understanding checks, hints first, and clear language. Each
suggestion appends to the editable draft without replacing existing instructions
or adding duplicate text. Suggestions do not change saved preferences or the
active chat instructions until **Save instructions** succeeds. They are unavailable
during loading, after a failed profile read, and while saving. Saving an empty
draft still clears the account-wide instructions; suggestions are not reapplied
automatically.

Memory details show scoped topic/concept records and unique nonempty saved
summaries, misconception notes, and objective evidence. Duplicate mirrored
summaries count once. This is a snapshot, not a complete conversation history.
Personal course goals and week numbers are not currently stored or presented as
learner goals. Active misconceptions are explicitly unavailable; resolved misconceptions are never relabeled
as active. Missing collections stay unavailable rather than becoming zero counts.
Instruction reads/saves and learning-data reads have independent retry states;
account/TA changes reset the dialog and discard stale responses.

Message-level rendering — bubbles, quizzes, challenges, clarifications, A2UI widgets —
lives in [../../features/chat/](../../features/chat). Keep the split: this folder owns
the container, that one owns what goes inside it.

The shared [composer](../../features/create/sharedUI.tsx) replaces the former Tools
placeholder with a text-only **Answer depth** dropdown: **Concise** (Short and direct),
**Balanced** (Clear, with key details; the default), and **Comprehensive** (Thorough
and in-depth). The trigger has no leading icon; its dropdown chevron is retained.
Its compact 208px menu omits the visible heading, keeps the short descriptions,
and uses 44px option rows. The trigger and menu retain accessible answer-depth
labels, keyboard navigation and the selected-option checkmark.
The choice is stored in the existing browser chat preferences, survives navigation
and refresh, and resets to Balanced on sign-out. It is disabled during generation
and does not modify the draft, attachments, or visible user messages.
The original wire/storage keys `quick`, `balanced`, and `detailed` are retained;
existing saved choices map to the new display names without a preference reset.

Both SSE and AG-UI send the selected `answer_depth` on every chat turn, including
new chats, edits, and retries. The backend applies it as current-turn presentation
context without changing the model, tools, or course teaching instructions.
Only the selected style's versioned prompt is included, alongside the shared
presentation constraints and confirmed learner-profile context.
Explicit length/format requests in the message take precedence; these modes are
guidance, not strict word counts or response-time guarantees.
TA preview sends, edits, and retries use the same preference. Builder configuration
conversations and the separate form assistant do not show this control because
they use their own instruction-generation APIs rather than the TA answer stream.

`parseMCQQuestions` parses model output and must degrade gracefully on an unexpected
shape rather than throwing.
