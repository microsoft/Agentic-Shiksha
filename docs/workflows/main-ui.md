# Main frontend workflow coverage

[Audit index](README.md) / [API endpoint index](api-index.md)

Source snapshot: **2026-09-30**. Generated from [main-ui.json](main-ui.json). UI gates are presentation, not proof of server authorization. The API guides document actual enforcement and limitations. A workflow may be a tab, dialog or artifact action rather than a separate URL.

## Registered routes

| Path | Kind / condition | Primary workflow |
| --- | --- | --- |
| `/preview/pet-animations` | screen / import.meta.env.DEV | [Decorative companion pose catalogue and development preview](#ui-companion-catalogue) |
| `/shared/:shareToken` | screen / public tokenized view | [Create/revoke a conversation share and open its read-only view](#ui-chat-sharing) |
| `/join/:code` | screen / valid code; handles sign-in redirect | [Connect by TA code and preserve an invite through sign-in](#ui-invitation) |
| `/auth` | screen / public | [Provider sign-in, callback, account synchronization and sign-out](#ui-authentication) |
| `/auth/callback` | screen / public provider-return screen | [Provider sign-in, callback, account synchronization and sign-out](#ui-authentication) |
| `/signout` | screen / public navigation entry | [Provider sign-in, callback, account synchronization and sign-out](#ui-authentication) |
| `/onboarding` | screen / AuthGuard | [First-run learner profile collection](#ui-onboarding) |
| `/` | layout / AuthGuard and validated config | [Protected shell and backend configuration](#ui-shell) |
| `/` | index / redirect /home | [Help, learning guide, redirects, update notice and unknown routes](#ui-support-navigation) |
| `/home` | screen / protected shell | [Send, stream, stop, retry or edit a learner turn](#ui-chat-turn) |
| `/chat/:courseName/:threadId` | screen / protected shell; selected course/thread | [Conversation history, naming, pagination and deletion](#ui-history) |
| `/library` | screen / protected shell | [Discover, preview and open an accessible Teaching Assistant](#ui-library) |
| `/assets` | screen / protected shell | [Saved Assets search, opening, deletion and public visibility](#ui-assets) |
| `/dashboard` | screen / page:dashboard | [Embedded teacher roster, learner evidence, usage, feedback and Insights](#ui-teacher-dashboard) |
| `/dashboard/:section` | screen / page:dashboard; students/usage/feedback or overview fallback | [Embedded teacher roster, learner evidence, usage, feedback and Insights](#ui-teacher-dashboard) |
| `/create` | screen / student redirect; teacher/admin UI | [Configure, upload, create and recover a course Teaching Assistant](#ui-create-course) |
| `/edit/:courseName` | screen / protected editor access | [Edit metadata/materials, regenerate instructions and preview compatibility](#ui-edit-course) |
| `/course/:courseName` | screen / protected shell; selected course | [Send, stream, stop, retry or edit a learner turn](#ui-chat-turn) |
| `/settings` | screen / protected shell | [Profile settings and local presentation preferences](#ui-settings) |
| `/companion-appearance` | redirect / redirect /create | [Help, learning guide, redirects, update notice and unknown routes](#ui-support-navigation) |
| `/companion-animations` | screen / protected shell | [Decorative companion pose catalogue and development preview](#ui-companion-catalogue) |
| `/learn` | screen / protected shell | [Help, learning guide, redirects, update notice and unknown routes](#ui-support-navigation) |
| `/help` | screen / protected shell | [Help, learning guide, redirects, update notice and unknown routes](#ui-support-navigation) |
| `/*` | fallback / protected catch-all and reused error boundary | [Help, learning guide, redirects, update notice and unknown routes](#ui-support-navigation) |

## Reachable action families

These are manually traced component actions, not additional URL routes or a claim that every possible event interleaving has been tested.

| Action | Source | Primary workflow |
| --- | --- | --- |
| Retry authentication/configuration and sign out | [main-session-retry](<../../Agentic Shiksha Platform/Frontend/src/components/auth/AuthGuard.tsx>) | [ui-shell](#ui-shell) |
| Browse uploaded/generated media in Library | [main-library-media](<../../Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx>) | [ui-documents-images](#ui-documents-images) |
| Course Info, capabilities, tool enable/update | [main-course-info](<../../Agentic Shiksha Platform/Frontend/src/components/chat/AgentCapabilities.tsx>) | [ui-course-management](#ui-course-management) |
| Share TA code/link and manage-code verification | [main-share-ta](<../../Agentic Shiksha Platform/Frontend/src/components/ManageCodeDialog.tsx>) | [ui-course-management](#ui-course-management) |
| Answer depth, stop, retry and message edit | [main-answer-depth](<../../Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>) | [ui-chat-turn](#ui-chat-turn) |
| History, pagination, rename, new/delete conversation | [main-history](<../../Agentic Shiksha Platform/Frontend/src/components/chat/ChatHistoryDrawer.tsx>) | [ui-history](#ui-history) |
| Create/copy/revoke a chat share | [main-share-chat](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>) | [ui-chat-sharing](#ui-chat-sharing) |
| Attach files/images and extract context | [main-attachments](<../../Agentic Shiksha Platform/Frontend/src/features/create/sharedUI.tsx>) | [ui-attachments-speech](#ui-attachments-speech) |
| Explicit speech recognition | [main-voice](<../../Agentic Shiksha Platform/Frontend/src/hooks/useSpeechRecognition.ts>) | [ui-attachments-speech](#ui-attachments-speech) |
| Partial answers, submit/default, timed extension | [main-clarification](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ClarifyBlock.tsx>) | [ui-clarification](#ui-clarification) |
| Document pane, sections, fullscreen, copy/export, Ask TA | [main-document-reader](<../../Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>) | [ui-documents-images](#ui-documents-images) |
| Open course passage citations and source files | [main-course-sources](<../../Agentic Shiksha Platform/Frontend/src/components/chat/CourseMaterialSources.tsx>) | [ui-documents-images](#ui-documents-images) |
| Quiz choice/reasoning, first submission, answers/feedback | [main-quiz](<../../Agentic Shiksha Platform/Frontend/src/features/chat/QuizBlock.tsx>) | [ui-quiz](#ui-quiz) |
| Challenge hints and show/hide solution | [main-challenge](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ChallengeBlock.tsx>) | [ui-challenges](#ui-challenges) |
| Slides edit/import/undo/save copy/export | [main-slide-editor](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SlidesEditor.tsx>) | [ui-slides](#ui-slides) |
| Presentation controls and speaker/component scripts | [main-slide-presenter](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SlidesPresenter.tsx>) | [ui-slides](#ui-slides) |
| Local/cloud narration controls and provider failures | [main-slide-narration](<../../Agentic Shiksha Platform/Frontend/src/hooks/useSlideNarration.ts>) | [ui-slides](#ui-slides) |
| Circuit topology, presets, events, instruments, run/replay | [main-circuit-editor](<../../Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx>) | [ui-circuits](#ui-circuits) |
| Saved asset filters/delete/public-private/open | [main-asset-actions](<../../Agentic Shiksha Platform/Frontend/src/pages/AssetsView.tsx>) | [ui-assets](#ui-assets) |
| Learner profile tabs, defaults, save/clear, practice draft | [main-learner-profile](<../../Agentic Shiksha Platform/Frontend/src/components/chat/LearnerProfileDialog.tsx>) | [ui-learner-profile](#ui-learner-profile) |
| Curriculum read/edit/recovery/history | [main-curriculum](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>) | [ui-curriculum](#ui-curriculum) |
| Generate/select/cache a syllabus translation | [main-curriculum-translation](<../../Agentic Shiksha Platform/Frontend/src/components/chat/SyllabusTranslationControl.tsx>) | [ui-curriculum](#ui-curriculum) |
| Snapshot, evidence, scope, pending/error/retry | [main-memory-inspect](<../../Agentic Shiksha Platform/Frontend/src/features/memory/GraphMemoryPanel.tsx>) | [ui-graph-memory](#ui-graph-memory) |
| Draft graph/policy, import, publish, separate activate | [main-graph-authoring](<../../Agentic Shiksha Platform/Frontend/src/features/memory/CurriculumGraphEditor.tsx>) | [ui-graph-authoring](#ui-graph-authoring) |
| Saved creation job recovery and material retry | [main-course-recovery](<../../Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx>) | [ui-create-course](#ui-create-course) |
| Chat-only/allow edits, stop, undo and scoped history | [main-course-companion](<../../Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx>) | [ui-course-companion](#ui-course-companion) |
| Simple/advanced Update, preview and regeneration | [main-course-editor](<../../Agentic Shiksha Platform/Frontend/src/features/edit/EditView.tsx>) | [ui-edit-course](#ui-edit-course) |
| Research planning, streamed activity and results | [main-research-panel](<../../Agentic Shiksha Platform/Frontend/src/components/chat/ResearchSidePanel.tsx>) | [ui-research](#ui-research) |
| Teacher roster/evidence/usage and scoped Insights | [main-teacher-insights](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx>) | [ui-teacher-dashboard](#ui-teacher-dashboard) |
| Feedback sentiment/text/attachments and retries | [main-feedback](<../../Agentic Shiksha Platform/Frontend/src/components/FeedbackDialog.tsx>) | [ui-feedback](#ui-feedback) |
| Update banner, local log view and help navigation | [main-local-tools](<../../Agentic Shiksha Platform/Frontend/src/components/layout/Sidebar.tsx>) | [ui-support-navigation](#ui-support-navigation) |

<a id="ui-shell"></a>
## Protected shell and backend configuration

**Classification:** current.

**Actors**
- Signed-in student, teacher or admin

**Actual agent, tool or worker**
- No agent; AuthGuard, MainLayout and backend configuration client

**Permissions**
- AuthGuard controls presentation using the session-derived account and onboarding state. Role visibility is not proof of backend authorization; use the API workflow entries for enforcement.

**State changes**
- Hydrates account and chat stores, selected course and layout context; caches validated model configuration in the browser process.

**Success path**
- Validate authentication, complete onboarding when required, load valid backend configuration and render the selected child route.

**Failure and retry behavior**
- Unauthenticated users go to /auth; incomplete onboarding goes to /onboarding; invited accounts can remain in setup. Authentication and configuration failures expose retry. Do not assume the guard secures every legacy endpoint.

**API hand-offs**
- `GET /auth/me` (main); [main-session](main-service.md#main-session).
- `GET /api/config` (main); [domain-system-status](main-domains.md#domain-system-status).

**Source evidence**
- [ProtectedLayout](<../../Agentic Shiksha Platform/Frontend/src/router.tsx>)
- [AuthGuard](<../../Agentic Shiksha Platform/Frontend/src/components/auth/AuthGuard.tsx>)
- [MainLayout](<../../Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/layouts/README.md](<../../Agentic Shiksha Platform/Frontend/src/layouts/README.md>)

<a id="ui-authentication"></a>
## Provider sign-in, callback, account synchronization and sign-out

**Classification:** current.

**Actors**
- Anonymous visitor
- Signed-in account

**Actual agent, tool or worker**
- No agent; backend-mediated Microsoft/Google OAuth and useAuth

**Permissions**
- Provider exchange/session cookies belong to backend auth routes. Persisted UI role and account flags are not independent authorization.

**State changes**
- Sign-in redirects through the backend; /auth/me and user-profile synchronization establish browser account state. Switching accounts clears the prior local chat state. Logout clears local stores and requests server cookie removal.

**Success path**
- Choose a provider, return through /auth/callback, invalidate the agent list cache and navigate through the protected shell. Sign-out clears the local session view.

**Failure and retry behavior**
- Callback errors redirect to /auth?error; auth synchronization can be retried. Logout clears local state even when its backend request fails, so local sign-out alone is not proof of server-side revocation.

**API hand-offs**
- `GET /auth/login` (main); [main-entra-sign-in](main-service.md#main-entra-sign-in).
- `GET /auth/google/login` (main); [main-google-sign-in](main-service.md#main-google-sign-in).
- `GET /auth/me` (main); [main-session](main-service.md#main-session).
- `POST /auth/logout` (main); [main-session](main-service.md#main-session).
- `GET /api/user/{userId}` (main); [main-profile-legacy](main-service.md#main-profile-legacy).
- `PUT /api/user/{userId}` (main); [main-profile-legacy](main-service.md#main-profile-legacy).

**Source evidence**
- [useAuth](<../../Agentic Shiksha Platform/Frontend/src/lib/useAuth.ts>)
- [AuthCallback](<../../Agentic Shiksha Platform/Frontend/src/components/auth/AuthCallback.tsx>)
- [SignOutPage](<../../Agentic Shiksha Platform/Frontend/src/components/auth/SignOutPage.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/components/auth/README.md](<../../Agentic Shiksha Platform/Frontend/src/components/auth/README.md>)
- [INSTALL.md](<../../INSTALL.md>)

<a id="ui-onboarding"></a>
## First-run learner profile collection

**Classification:** current.

**Actors**
- Authenticated account with onboarding incomplete

**Actual agent, tool or worker**
- No agent; OnboardingPage and profile synchronization

**Permissions**
- The route is wrapped in AuthGuard; profile-write enforcement is the main API's responsibility.

**State changes**
- Preferred name, hometown, language and interests update the chat/profile store. Completion sets onboardingCompleted and flushes the queued profile update before navigation.

**Success path**
- Complete the step sequence, save the profile and open /home; existing pending invite handling subsequently returns to the intended course.

**Failure and retry behavior**
- Required empty input cannot advance. Back preserves prior answers. Save failures are logged; the store's flush helper catches errors, so the UI sequence is not a transactional guarantee of durable onboarding.

**API hand-offs**
- `PUT /api/user/{userId}` (main); [main-profile-legacy](main-service.md#main-profile-legacy).

**Source evidence**
- [finishOnboarding](<../../Agentic Shiksha Platform/Frontend/src/pages/OnboardingPage.tsx>)
- [flushUserProfileSync](<../../Agentic Shiksha Platform/Frontend/src/lib/chatStore.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-settings"></a>
## Profile settings and local presentation preferences

**Classification:** current.

**Actors**
- Signed-in account

**Actual agent, tool or worker**
- No agent; SettingsPage, SettingsView, chatStore and theme provider

**Permissions**
- Settings visibility is client-side. Institution/department selectors shown as locked are not an administrator affiliation-management workflow.

**State changes**
- Profile edits are local until Save invokes store setters and debounced profile sync. Cancel restores the local baseline. Theme and presentation preferences are browser state.

**Success path**
- Review profile fields, change supported values, Save or Cancel; theme selection affects the current browser interface.

**Failure and retry behavior**
- Profile sync errors are logged by the store; a cleared dirty flag is not an explicit durable-save acknowledgement. Placeholder account/privacy content must not be described as implemented account deletion/export.

**API hand-offs**
- `GET /api/user/{userId}` (main); [main-profile-legacy](main-service.md#main-profile-legacy).
- `PUT /api/user/{userId}` (main); [main-profile-legacy](main-service.md#main-profile-legacy).

**Source evidence**
- [SettingsPage](<../../Agentic Shiksha Platform/Frontend/src/pages/SettingsPage.tsx>)
- [handleSave](<../../Agentic Shiksha Platform/Frontend/src/pages/SettingsView.tsx>)
- [flushUserProfileSync](<../../Agentic Shiksha Platform/Frontend/src/lib/chatStore.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-library"></a>
## Discover, preview and open an accessible Teaching Assistant

**Classification:** current.

**Actors**
- Student
- Teacher
- Admin

**Actual agent, tool or worker**
- No model call merely to browse; selected course TA is used only when a conversation starts

**Permissions**
- The server-scoped agent list controls available courses; client owner/role display is not membership enforcement.

**State changes**
- Caches agent metadata and images, changes search/filter/preview state, creates or selects a local course project/thread when starting chat.

**Success path**
- Load the library, inspect a course, choose Start Chat or a starter, and navigate to the correct course context.

**Failure and retry behavior**
- List/setup failures have loading/error handling; cache invalidation requests fresh data after account or course changes. Missing courses must not become invented library entries.

**API hand-offs**
- `GET /api/azure/agents/list` (main); [domain-agent-connect-list](main-domains.md#domain-agent-connect-list).
- `GET /api/agents/setup/{agent_name}` (main); [main-agent-setup](main-service.md#main-agent-setup).

**Source evidence**
- [LibraryView](<../../Agentic Shiksha Platform/Frontend/src/pages/LibraryView.tsx>)
- [handleSelectCourse](<../../Agentic Shiksha Platform/Frontend/src/layouts/MainLayout.tsx>)
- [listAzureAgents](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-invitation"></a>
## Connect by TA code and preserve an invite through sign-in

**Classification:** current.

**Actors**
- Invite recipient
- Assigned student
- Teacher joining a manageable TA

**Actual agent, tool or worker**
- No agent; JoinAgentPage and ConnectAgentDialog

**Permissions**
- A valid six-character code or link does not assign student access. The connect API decides membership; teacher joining and student assignment have different contracts.

**State changes**
- A pending code is kept in sessionStorage across OAuth; successful connection selects a local project and invalidates the agent list.

**Success path**
- Validate the code, sign in if necessary, call connect-by-code, clear the pending code and open the returned course.

**Failure and retry behavior**
- Malformed code shows Invalid invite link; unavailable code or API failure produces a message and Library escape path. JoinAgentPage attempts once per mount; users retry via reopening or the Connect dialog.

**API hand-offs**
- `POST /api/agents/connect-by-code` (main); [domain-agent-connect-list](main-domains.md#domain-agent-connect-list).

**Source evidence**
- [JoinAgentPage](<../../Agentic Shiksha Platform/Frontend/src/pages/JoinAgentPage.tsx>)
- [ConnectAgentDialog](<../../Agentic Shiksha Platform/Frontend/src/components/ManageCodeDialog.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-course-management"></a>
## Course information, sharing its access code and explicit management actions

**Classification:** current.

**Actors**
- Course member viewing information
- Owner/assigned teacher or administrator managing a course

**Actual agent, tool or worker**
- Named course TA definition; capability inspection and version-checked tool configuration, not a new agent

**Permissions**
- UI role/ownership checks hide edit/delete/enable controls. Manage-code and API access checks remain distinct; a read of Course Info never grants rights or enables tools.

**State changes**
- Read cached setup/capabilities; copy code/link to clipboard. Explicit enable/update or delete operations can change remote agent configuration and course records; local caches/project state update after acknowledgement.

**Success path**
- Open information, inspect supported tools, share a TA code, or explicitly confirm a permitted management operation.

**Failure and retry behavior**
- Malformed/unavailable capability status shows retry; tool enablement uses expected version and invalidates caches even on failure. Clipboard errors are explicit. Delete and manage-code dialogs require their own user confirmation; they are not substitutes for server permission checks.

**API hand-offs**
- `GET /api/agents/{agent_name}/details` (main); [main-agent-inspection](main-service.md#main-agent-inspection).
- `GET /api/agents/{agent_id}/manage-code` (main); [main-manage-codes](main-service.md#main-manage-codes).
- `POST /api/agents/{agent_id}/circuit/tool` (main); [domain-circuit-tool-control](main-domains.md#domain-circuit-tool-control).
- `POST /api/agents/{agent_id}/slides/tool` (main); [domain-slides-tool-control](main-domains.md#domain-slides-tool-control).

**Source evidence**
- [ChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>)
- [AgentCapabilities](<../../Agentic Shiksha Platform/Frontend/src/components/chat/AgentCapabilities.tsx>)
- [ManageCodeRevealDialog](<../../Agentic Shiksha Platform/Frontend/src/components/ManageCodeDialog.tsx>)
- [LibraryView](<../../Agentic Shiksha Platform/Frontend/src/pages/LibraryView.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)
- [docs/agents/course-ta.md](<../../docs/agents/course-ta.md>)

<a id="ui-chat-turn"></a>
## Send, stream, stop, retry or edit a learner turn

**Classification:** current.

**Actors**
- Authorized course participant

**Actual agent, tool or worker**
- Selected course TA through GeneralAgent; SSE or opt-in AG-UI; local teaching tools

**Permissions**
- UI needs an authenticated course context; chat API independently verifies account/course access. Shared pages disable sending.

**State changes**
- Draft becomes a user message. The turn controller snapshots course/profile/session context, normalizes SSE or AG-UI events through the reducer and presentation layer, then commits assistant content to the originating thread store for synchronization. Answer depth and stable event identity travel on each request.
- Completed slide decks are independently queued for Assets; document, quiz and challenge persistence follows the turn's completion policy. Asset storage and conversation synchronization are not one transaction.

**Success path**
- Choose Concise/Balanced/Comprehensive, send text or image context, show Contextualising/waiting/tool activity, reconcile text and artifacts, then commit the completed turn. An explicit done event establishes completed status.
- After a completed answer, missing follow-up suggestions can be requested separately, validated as three distinct bounded strings and attached only if the same saved turn is still current. Suggestions do not automatically send a new turn.

**Failure and retry behavior**
- Abort, page exit or course/thread/account switch interrupts the current controller and preserves eligible partial content before retiring its generation. EOF without done is interrupted, not completed. Errors and block cancellation retain explicit failure/interruption states.
- Retry/edit starts a new generation rather than rolling back completed tool writes. Lifecycle identifiers reject stale UI updates; stable event identity and supersession depend on the configured memory path.
- Document/quiz/challenge save failures are logged, while a failed slide save shows a toast and leaves the deck in chat. None is proof of a durable Assets write. Follow-up requests abort after ten seconds or context change and do not replace the answer with a success-shaped fallback.

**API hand-offs**
- `POST /api/agents/{agent_id}/chat/stream` (main); [domain-chat-turn](main-domains.md#domain-chat-turn).
- `POST /api/agents/{agent_id}/chat/agui` (main); [domain-chat-turn](main-domains.md#domain-chat-turn).
- `POST /api/chat/sync` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `POST /api/agents/{agent_id}/chat/suggestions` (main); [domain-chat-suggestions](main-domains.md#domain-chat-suggestions).
- `POST /api/assets` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `POST /api/quiz-assets` (main); [domain-assessment-first-attempt](main-domains.md#domain-assessment-first-attempt).

**Source evidence**
- [useAgentChat](<../../Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/generationLifecycle.ts](<../../Agentic Shiksha Platform/Frontend/src/features/chat/generationLifecycle.ts>)
- [createChatTurnController](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatTurnController.ts>)
- [reduceChatTurn](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatTurnReducer.ts>)
- [createChatTurnPersistence](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatPersistence.ts>)
- [streamChatTurn](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatTransport.ts>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/useChatPresentation.ts](<../../Agentic Shiksha Platform/Frontend/src/features/chat/useChatPresentation.ts>)
- [streamAgentChatViaAGUI](<../../Agentic Shiksha Platform/Frontend/src/lib/aguiAdapter.ts>)
- [ChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>)

**Existing guides**
- [docs/agents/course-ta.md](<../../docs/agents/course-ta.md>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-history"></a>
## Conversation history, naming, pagination and deletion

**Classification:** current.

**Actors**
- Signed-in conversation owner

**Actual agent, tool or worker**
- No TA call to browse history; title generation is a separate configured direct-model API workflow, not a named TA invocation

**Permissions**
- History UI is scoped by current account/course; server ownership checks are documented with the chat persistence handlers.

**State changes**
- Loads/syncs thread and message records into Zustand, changes active thread, persists rename/delete requests and uses URL course/thread deep links.

**Success path**
- Open Chat History, load earlier messages, select or start a conversation, rename it, or confirm deletion.

**Failure and retry behavior**
- Pagination/sync tracks loading and failure; refresh/retry does not prove unsynced drafts were durable. Thread deletion is not a guarantee that every separately saved artifact, assessment or memory record is erased.
- Automatic title generation applies only to default-named threads after a completed answer; failure is logged and the first five words of the user message become the local title. Restoring history reconstructs saved messages/documents, not an in-flight remote request.

**API hand-offs**
- `GET /api/chat/load/{user_id}` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `GET /api/chat/threads/{user_id}` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `GET /api/chat/thread/{thread_id}/messages` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `PUT /api/chat/thread/{thread_id}` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `DELETE /api/chat/thread/{thread_id}` (main); [main-chat-persistence](main-service.md#main-chat-persistence).
- `POST /api/chat/generate-title` (main); [main-chat-titles-starters](main-service.md#main-chat-titles-starters).

**Source evidence**
- [ChatHistoryDrawer](<../../Agentic Shiksha Platform/Frontend/src/components/chat/ChatHistoryDrawer.tsx>)
- [useMessagePagination](<../../Agentic Shiksha Platform/Frontend/src/lib/useMessagePagination.ts>)
- [useChatStore](<../../Agentic Shiksha Platform/Frontend/src/lib/chatStore.ts>)
- [chatApi](<../../Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)
- [restoreChatHistory](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatPersistence.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/lib/README.md](<../../Agentic Shiksha Platform/Frontend/src/lib/README.md>)
- [docs/architecture.md](<../../docs/architecture.md>)

<a id="ui-chat-sharing"></a>
## Create/revoke a conversation share and open its read-only view

**Classification:** current.

**Actors**
- Conversation owner creating/revoking a share
- Anonymous token-holder reading a share

**Actual agent, tool or worker**
- No new agent turn; saved messages/artifacts rendered read-only

**Permissions**
- Share management requires owner API access. The tokenized public view is distinct from TA enrollment; source serializers and artifact-specific read-only rules determine exposed data.

**State changes**
- Creates or revokes a server share capability. Public viewing loads a snapshot and local viewer state only.

**Success path**
- Owner creates/copies a share URL; token holder opens messages and allowed document/artifact views. Revocation prevents later valid loads.

**Failure and retry behavior**
- Missing/expired/revoked share shows an unavailable/error state. Shared UI cannot edit/save/run a circuit or export/save/edit slides; do not treat read-only quiz behavior as an authenticated assessment submission.

**API hand-offs**
- `POST /api/chat/thread/{thread_id}/share` (main); [domain-chat-share](main-domains.md#domain-chat-share).
- `DELETE /api/chat/thread/{thread_id}/share` (main); [domain-chat-share](main-domains.md#domain-chat-share).
- `GET /api/shared/{share_token}` (main); [main-public-chat-share](main-service.md#main-public-chat-share).

**Source evidence**
- [SharedChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/SharedChatView.tsx>)
- [ChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>)
- [createShareLink](<../../Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-attachments-speech"></a>
## Attach learner context and use voice input

**Classification:** optional.

**Actors**
- Signed-in course participant with browser file/microphone permission

**Actual agent, tool or worker**
- File/image upload and extraction helpers; speech recognition; resulting text/images become input to the selected TA

**Permissions**
- Client limits and browser microphone grants are separate from server file/token authorization. No voice is captured without the user's explicit microphone action.

**State changes**
- Local selected files/previews and speech interim text; supported uploads may persist blobs, while extracted text/image references join the outgoing turn.

**Success path**
- Select supported attachments or start voice input, inspect the composed text/context, then send through the normal chat flow.

**Failure and retry behavior**
- Invalid/oversized attachments and upload failures are reported. Speech initialization/permission/token failures stop capture rather than invent audio text; reattempt requires user action. Cancelling a draft does not necessarily delete a previously uploaded blob.

**API hand-offs**
- `POST /api/blob/upload` (main); [main-blob-legacy](main-service.md#main-blob-legacy).
- `POST /api/document/extract-text` (main); [main-document-extraction](main-service.md#main-document-extraction).
- `GET /api/speech/token` (main); [domain-speech-token](main-domains.md#domain-speech-token).

**Source evidence**
- [ChatInput](<../../Agentic Shiksha Platform/Frontend/src/features/create/sharedUI.tsx>)
- [useSpeechRecognition](<../../Agentic Shiksha Platform/Frontend/src/hooks/useSpeechRecognition.ts>)
- [uploadChatImage](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)
- [Agentic Shiksha Platform/Backend/backend/README.md](<../../Agentic Shiksha Platform/Backend/backend/README.md>)

<a id="ui-clarification"></a>
## Answer, save, extend or default a clarification

**Classification:** current.

**Actors**
- Owner of the active waiting chat turn

**Actual agent, tool or worker**
- Course TA ask_clarification tool and ClarifyBlock

**Permissions**
- Only the active turn's owner may mutate the server clarification; read-only shares do not resume it.

**State changes**
- Partial answers and extension revisions are sent to the server's waiting-turn state; client unsent text/selection stays local until submitted.

**Success path**
- Read server deadlines, choose/type answers, save partial choices, submit, continue with defaults, or request another permitted window; matching completion events clear the waiting card.

**Failure and retry behavior**
- Failed saves/extensions remain visible and retryable. A local remount does not reset the deadline. Expired/revision-conflicting operations follow the API failure contract; process-local waits do not survive arbitrary server restart.

**API hand-offs**
- `GET /api/clarify/{clarify_id}` (main); [domain-chat-clarification](main-domains.md#domain-chat-clarification).
- `PATCH /api/clarify/{clarify_id}` (main); [domain-chat-clarification](main-domains.md#domain-chat-clarification).
- `POST /api/clarify/{clarify_id}` (main); [domain-chat-clarification](main-domains.md#domain-chat-clarification).
- `POST /api/clarify/{clarify_id}/extend` (main); [domain-chat-clarification](main-domains.md#domain-chat-clarification).

**Source evidence**
- [ClarifyBlock](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ClarifyBlock.tsx>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/chatQueryEvent.ts](<../../Agentic Shiksha Platform/Frontend/src/features/chat/chatQueryEvent.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)
- [Agentic Shiksha Platform/Backend/backend/README.md](<../../Agentic Shiksha Platform/Backend/backend/README.md>)

<a id="ui-documents-images"></a>
## Read, quote, export and browse generated documents/images

**Classification:** mixed.

**Actors**
- Course participant
- Read-only shared-chat viewer for permitted operations

**Actual agent, tool or worker**
- TA add_document/generate_image and compatibility diagram output; renderer, document exporter and Ask the TA selection action

**Permissions**
- Read-only mode limits mutation; quoting into a live TA requires a course conversation. Source-link/media access is not granted merely by rendering a URL.

**State changes**
- Opens artifact panes, selection/scroll/full-screen state and browser downloads. Ask the TA prefill/quote is not automatically evidence of a new completed learning event.

**Success path**
- Open the generated artifact, navigate sections, inspect citations, use full screen, copy/download supported formats, or bring a selected passage into the live composer.

**Failure and retry behavior**
- Malformed blocks are rejected/hidden, cancelled generation does not become a completed card, and export failures are reported. Some image-download failures fall back to opening the image URL. Legacy retired artifact types remain stored but are not shown.

**API hand-offs**
- `GET /api/agents/{agent_name}/course-materials/file` (main); [domain-material-files](main-domains.md#domain-material-files).
- `GET /api/blob/proxy` (main); [main-blob-legacy](main-service.md#main-blob-legacy).

**Source evidence**
- [ChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>)
- [AssetContent](<../../Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>)
- [CourseMaterialSources](<../../Agentic Shiksha Platform/Frontend/src/components/chat/CourseMaterialSources.tsx>)
- [AskTASelection](<../../Agentic Shiksha Platform/Frontend/src/features/chat/AskTASelection.tsx>)
- [LibraryMediaGrid](<../../Agentic Shiksha Platform/Frontend/src/pages/LibraryMedia.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-quiz"></a>
## Practice quizzes and server-identified concept inventories

**Classification:** mixed.

**Actors**
- Authenticated learner submitting an assessment
- Read-only viewer where supported

**Actual agent, tool or worker**
- TA add_quiz; QuizBlock; first-attempt and server diagnostic APIs

**Permissions**
- An authoritative diagnostic requires its server assessment identity, curriculum version and course access. Browser answer keys are not a substitute for server grading.

**State changes**
- Caches unsubmitted choices/reasoning, saves quiz assets, records the first attempt and grading receipt; may trigger a tutor-feedback turn or memory-refresh event.

**Success path**
- Open the inventory, choose options and explain reasoning, submit once, show confirmed score/feedback and distinguish pending memory processing from committed progress.

**Failure and retry behavior**
- Incomplete answers disable submit; failed grading preserves the attempt for explicit retry. Frozen identities are reused instead of generating a new attempt on retry. Legacy client-graded practice/retake behavior differs from authoritative assessments; read-only viewing is not a new grade.

**API hand-offs**
- `POST /api/quiz-assets` (main); [domain-assessment-first-attempt](main-domains.md#domain-assessment-first-attempt).
- `GET /api/quiz-attempts/{quiz_id}/first` (main); [domain-assessment-first-attempt](main-domains.md#domain-assessment-first-attempt).
- `POST /api/quiz-attempts/first` (main); [domain-assessment-first-attempt](main-domains.md#domain-assessment-first-attempt).
- `POST /api/quiz-attempts/{quiz_id}/feedback` (main); [domain-assessment-feedback](main-domains.md#domain-assessment-feedback).

**Source evidence**
- [QuizBlock](<../../Agentic Shiksha Platform/Frontend/src/features/chat/QuizBlock.tsx>)
- [parseQuizContent](<../../Agentic Shiksha Platform/Frontend/src/lib/quizContract.ts>)
- [submitFirstDiagnosticAttempt](<../../Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)
- [docs/memory/evidence-model.md](<../../docs/memory/evidence-model.md>)

<a id="ui-challenges"></a>
## Explore a challenge, progressive hints and a worked solution

**Classification:** current.

**Actors**
- Course participant
- Allowed read-only artifact viewer

**Actual agent, tool or worker**
- TA add_challenge and ChallengeBlock

**Permissions**
- Artifact visibility follows its course/chat/share access. Revealing a hint or solution does not grant access or constitute verified assessment evidence.

**State changes**
- Client open/tab/hint/solution state; saved challenge content is an artifact. A later explanation sent in chat follows the normal authenticated turn flow.

**Success path**
- Open the problem, predict before help, progressively reveal hints, show/hide the solution and optionally explain the result to the TA.

**Failure and retry behavior**
- Unsupported/malformed or cancelled output is not a valid challenge. UI reveal/hide can be repeated locally; there is no independent automatic mastery-write or generic challenge-grade endpoint implied by this viewer.

**API hand-offs**
- Local action or part of the surrounding chat/tool flow; no independent API request is implied.

**Source evidence**
- [ChallengeBlock](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ChallengeBlock.tsx>)
- [AssetContent](<../../Agentic Shiksha Platform/Frontend/src/components/assets/AssetContent.tsx>)
- [ChatBubble](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ChatBubble.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-slides"></a>
## View, edit, save, export, present and narrate slides

**Classification:** current.

**Actors**
- Course participant with private deck access
- Read-only shared viewer for local viewing/presentation

**Actual agent, tool or worker**
- TA add_slides; slide schema/parser, editor, PPTX API and optional narration

**Permissions**
- Shared views cannot edit/save/export or silently switch to authenticated cloud narration. Private save/export requires the originating course and server access; capability enablement is a separate management workflow.

**State changes**
- Local slide selection, edits, undo/redo and presentation state; explicit Save copy creates a new private asset without overwriting the original. Export downloads a PPTX/JSON; local/cloud speech may use bounded session audio caches.

**Success path**
- Validate the deck, browse notes/sources, edit within supported layouts/limits, save a confirmed copy, export, enter presentation mode and explicitly start narration.

**Failure and retry behavior**
- Invalid decks/unsafe links are rejected. Save failures retain the draft and are not automatically retried. Dirty close/import is confirmed. Narration failures are visible and do not silently choose another provider; closing, navigation or account changes stop relevant sessions.

**API hand-offs**
- `POST /api/agents/{agent_id}/slides/save` (main); [domain-slides-export-copy](main-domains.md#domain-slides-export-copy).
- `POST /api/agents/{agent_id}/slides/export` (main); [domain-slides-export-copy](main-domains.md#domain-slides-export-copy).
- `GET /api/agents/{agent_id}/slides/voices` (main); [domain-slides-narration](main-domains.md#domain-slides-narration).
- `POST /api/agents/{agent_id}/slides/speech` (main); [domain-slides-narration](main-domains.md#domain-slides-narration).

**Source evidence**
- [SlidesBlock](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SlidesBlock.tsx>)
- [SlidesEditor](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SlidesEditor.tsx>)
- [SlidesPresenter](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SlidesPresenter.tsx>)
- [useSlideNarration](<../../Agentic Shiksha Platform/Frontend/src/hooks/useSlideNarration.ts>)
- [parseSlideDeck](<../../Agentic Shiksha Platform/Frontend/src/lib/slides.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-circuits"></a>
## Circuit Lab editing, simulation, instruments and replay

**Classification:** current.

**Actors**
- Course participant
- Shared viewer replaying existing results

**Actual agent, tool or worker**
- TA add_circuit; Circuit Lab frontend and backend numerical solver

**Permissions**
- New simulations and edits are unavailable in read-only shares. The originating course and tool capability are checked separately from renderer visibility.

**State changes**
- Edits circuit draft topology/parameters, events and instruments; changes invalidate prior readings until explicit Run succeeds. Result traces and notices are separate from playback position. Saved circuit context can accompany a scoped chat turn.

**Success path**
- Open a validated circuit, inspect/adjust supported components or a confirmed preset, Run, inspect numerical readings and replay the solver result.

**Failure and retry behavior**
- Invalid/unsupported circuits are rejected rather than replaced with invented numbers. Solver errors/timeouts/unavailable readings remain explicit and reruns are user initiated. Retired Industrial Trainer metadata/assets are not a current training workflow; saved ordinary circuits still open.

**API hand-offs**
- `POST /api/agents/{agent_id}/circuit/simulate` (main); [domain-circuit-simulation](main-domains.md#domain-circuit-simulation).
- `GET /api/agents/{agent_id}/circuit/tool` (main); [domain-circuit-tool-control](main-domains.md#domain-circuit-tool-control).

**Source evidence**
- [SimulationWorkspace](<../../Agentic Shiksha Platform/Frontend/src/features/chat/SimulationWorkspace.tsx>)
- [CircuitBlock](<../../Agentic Shiksha Platform/Frontend/src/features/chat/CircuitBlock.tsx>)
- [CircuitInstruments](<../../Agentic Shiksha Platform/Frontend/src/features/chat/CircuitInstruments.tsx>)
- [circuitChatText](<../../Agentic Shiksha Platform/Frontend/src/lib/circuit.ts>)
- [isRetiredAsset](<../../Agentic Shiksha Platform/Frontend/src/lib/retiredContent.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-assets"></a>
## Saved Assets search, opening, deletion and public visibility

**Classification:** current.

**Actors**
- Signed-in asset owner
- Eligible readers of public assets

**Actual agent, tool or worker**
- No new agent; chatApi asset operations and artifact viewers

**Permissions**
- The UI lists the current user's assets and exposes owner actions; server asset ownership/public-read rules remain authoritative.

**State changes**
- Loads up to the requested list limit, filters locally, navigates to the originating chat or standalone slide viewer. Explicit delete removes a record; share toggles isPublic.

**Success path**
- Search/filter saved work, open it in context, explicitly delete or change its public/private status, and update the list from acknowledged responses.

**Failure and retry behavior**
- List errors expose Try again; failed mutations retain the item and report an error. Invalid slide payloads are rejected. An asset with no routable chat context may only produce a Viewing toast; do not promise every legacy asset has a standalone renderer.

**API hand-offs**
- `GET /api/assets` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `POST /api/assets` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `GET /api/assets/{asset_id}` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `PUT /api/assets/{asset_id}` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `DELETE /api/assets/{asset_id}` (main); [main-assets-legacy](main-service.md#main-assets-legacy).
- `GET /api/assets/public` (main); [main-assets-legacy](main-service.md#main-assets-legacy).

**Source evidence**
- [AssetsView](<../../Agentic Shiksha Platform/Frontend/src/pages/AssetsView.tsx>)
- [AssetCard](<../../Agentic Shiksha Platform/Frontend/src/components/assets/AssetCard.tsx>)
- [listAssets](<../../Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)
- [Agentic Shiksha Platform/Frontend/src/components/assets/README.md](<../../Agentic Shiksha Platform/Frontend/src/components/assets/README.md>)

<a id="ui-learner-profile"></a>
## Learner profile, default instructions, progress and contextual practice

**Classification:** current.

**Actors**
- Current signed-in learner/course participant

**Actual agent, tool or worker**
- No agent on profile read; saved instructions become context for the next course TA turn

**Permissions**
- Dialog hides mismatched users; the profile/learning APIs must verify the authenticated learner and course. Suggested defaults edit only the browser draft until Save.

**State changes**
- Loads scoped learning data and profile instructions, persists confirmed instruction edits/clearing, updates the matching local cache, and can prefill a practice question without sending it.

**Success path**
- Inspect Overview/Learning/Memory, add defaults or free text, Save and verify acknowledgement, refresh learning records, or choose a recommended practice draft.

**Failure and retry behavior**
- Load failures do not appear as zero progress; separate retry controls remain. Unacknowledged saves retain edits and error state. Dirty closing is confirmed; account changes/abort prevent stale results. Authoritative graph mode avoids presenting legacy progress as graph authority.

**API hand-offs**
- `GET /api/learner-profile` (main); [domain-learner-profile](main-domains.md#domain-learner-profile).
- `PUT /api/learner-profile` (main); [domain-learner-profile](main-domains.md#domain-learner-profile).
- `GET /api/learner-profile/learning/{agent_id}` (main); [domain-learner-learning-compatibility](main-domains.md#domain-learner-learning-compatibility).

**Source evidence**
- [ScopedLearnerProfile](<../../Agentic Shiksha Platform/Frontend/src/components/chat/LearnerProfileDialog.tsx>)
- [getLearnerLearning](<../../Agentic Shiksha Platform/Frontend/src/lib/chatApi.ts>)
- [updateLearnerProfile](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Backend/backend/README.md](<../../Agentic Shiksha Platform/Backend/backend/README.md>)
- [docs/memory/README.md](<../../docs/memory/README.md>)

<a id="ui-curriculum"></a>
## Course curriculum, recovery, version history and translation

**Classification:** current.

**Actors**
- Course member reading
- Permitted teacher/admin editing or retrying generation

**Actual agent, tool or worker**
- Configured textbook/threshold research through backend jobs; translation model through its API; no model call for selecting a saved version

**Permissions**
- UI gates edit/retry using server capability/status and role. The API separately enforces course read/edit access. History/translation do not publish or activate a memory graph.

**State changes**
- Reads readiness and curriculum, updates local tab/expanded state, explicitly saves edited curriculum/history, selects or generates scoped translation variants and queues eligible research recovery.

**Success path**
- Open Syllabus/Threshold Concepts, inspect status, edit when permitted, browse versions, select a saved translation or request a validated new one.

**Failure and retry behavior**
- Failed/unknown readiness stays distinct from processing and ready. Recovery is explicit and active work is not restarted by duplicate UI clicks. Translation errors preserve source content; newer source hashes and account/course changes invalidate stale results.

**API hand-offs**
- `GET /api/agents/{agent_name}/course-curriculum` (main); [domain-course-curriculum](main-domains.md#domain-course-curriculum).
- `PUT /api/agents/{agent_name}/course-curriculum` (main); [domain-course-curriculum](main-domains.md#domain-course-curriculum).
- `POST /api/agents/{agent_name}/course-curriculum/retry` (main); [domain-course-curriculum](main-domains.md#domain-course-curriculum).
- `GET /api/agents/{agent_name}/course-curriculum/versions` (main); [main-curriculum-history](main-service.md#main-curriculum-history).
- `GET /api/agents/{agent_name}/course-curriculum/versions/{version_id}` (main); [main-curriculum-history](main-service.md#main-curriculum-history).
- `POST /api/agents/{agent_id}/course-curriculum/translations` (main); [domain-curriculum-translations](main-domains.md#domain-curriculum-translations).

**Source evidence**
- [ChatView](<../../Agentic Shiksha Platform/Frontend/src/pages/ChatView.tsx>)
- [useSyllabusTranslation](<../../Agentic Shiksha Platform/Frontend/src/components/chat/SyllabusTranslationControl.tsx>)
- [retryAgentCurriculum](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [docs/agents/curriculum-research.md](<../../docs/agents/curriculum-research.md>)
- [Agentic Shiksha Platform/Backend/backend/README.md](<../../Agentic Shiksha Platform/Backend/backend/README.md>)

<a id="ui-graph-memory"></a>
## Inspect custom learner memory, evidence and next probes

**Classification:** optional.

**Actors**
- Authorized learner
- Teacher inspecting a permitted student

**Actual agent, tool or worker**
- GraphMemoryPanel and scoped memory/context/evidence APIs; not a separate learning agent

**Permissions**
- Server-provided config.enabled and off/shadow/authoritative mode gate availability. Course/student scope and evidence access are server contracts; no standalone Vite flag grants access.

**State changes**
- Read-only snapshot/context/evidence requests and local selection; pending polling/refresh can reveal a later committed snapshot. Individual teacher mode can explicitly request evidence-processing retry.

**Success path**
- Inspect snapshot version/freshness, distinguish concept mastery from crossing, select a concept and open evidence, then review the next-probe recommendation.

**Failure and retry behavior**
- Pending/failed/retry-pending processing is explicit. Missing evidence is not failure, stale versions require revalidation, and read errors cannot be treated as mastery. Shadow labels remain experimental; refresh does not itself commit state.

**API hand-offs**
- `GET /api/agents/{agent_id}/memory/config` (main); [domain-memory-config](main-domains.md#domain-memory-config).
- `GET /api/agents/{agent_id}/learners/{student_id}/memory` (main); [domain-memory-read](main-domains.md#domain-memory-read).
- `GET /api/agents/{agent_id}/learners/{student_id}/memory/context` (main); [domain-memory-read](main-domains.md#domain-memory-read).
- `GET /api/agents/{agent_id}/learners/{student_id}/memory/evidence/{evidence_id}` (main); [domain-memory-read](main-domains.md#domain-memory-read).

**Source evidence**
- [GraphMemoryPanel](<../../Agentic Shiksha Platform/Frontend/src/features/memory/GraphMemoryPanel.tsx>)
- [useMemoryConfig](<../../Agentic Shiksha Platform/Frontend/src/features/memory/useMemoryConfig.ts>)
- [learnerMemoryApi](<../../Agentic Shiksha Platform/Frontend/src/lib/learnerMemoryApi.ts>)

**Existing guides**
- [docs/memory/overview.md](<../../docs/memory/overview.md>)
- [docs/memory/see-it-think.md](<../../docs/memory/see-it-think.md>)

<a id="ui-graph-authoring"></a>
## Edit/import a curriculum graph, publish and separately activate it

**Classification:** optional.

**Actors**
- Authorized course editor
- Scoped administrator for activation/configuration

**Actual agent, tool or worker**
- CurriculumGraphEditor and graph-validation APIs; no agent decides publication or crossing policy

**Permissions**
- Graph authoring is not offered as a learner control. can_manage exposes configuration UI but is not authorization; backend scope/role/revision checks decide writes.

**State changes**
- Local graph/policy draft; explicit save persists a revision, publication creates an immutable version, and separate configuration selects mode/scope/binding. Import creates an unreviewed draft, not a live graph.

**Success path**
- Load or start a draft, edit stable nodes/edges/policy or import existing content, validate and save, explicitly publish reviewed data, then activate only with appropriate administrative rights.

**Failure and retry behavior**
- Client/server graph validation errors retain the draft. Conflicts require reloading rather than overwriting. Publication uses a stable operation key for retry; dirty state blocks publish. New binding/policy can invalidate earlier learner verdicts.

**API hand-offs**
- `GET /api/agents/{agent_id}/course-curriculum/graph` (main); [domain-memory-graph-draft](main-domains.md#domain-memory-graph-draft).
- `PUT /api/agents/{agent_id}/course-curriculum/graph` (main); [domain-memory-graph-draft](main-domains.md#domain-memory-graph-draft).
- `POST /api/agents/{agent_id}/course-curriculum/graph/import` (main); [domain-memory-graph-draft](main-domains.md#domain-memory-graph-draft).
- `POST /api/agents/{agent_id}/course-curriculum/publish` (main); [domain-memory-graph-publish](main-domains.md#domain-memory-graph-publish).
- `PUT /api/agents/{agent_id}/memory/config` (main); [domain-memory-config](main-domains.md#domain-memory-config).

**Source evidence**
- [CurriculumGraphEditor](<../../Agentic Shiksha Platform/Frontend/src/features/memory/CurriculumGraphEditor.tsx>)
- [validateGraph](<../../Agentic Shiksha Platform/Frontend/src/features/memory/curriculumGraphValidation.ts>)
- [learnerMemoryApi](<../../Agentic Shiksha Platform/Frontend/src/lib/learnerMemoryApi.ts>)

**Existing guides**
- [docs/memory/overview.md](<../../docs/memory/overview.md>)

<a id="ui-create-course"></a>
## Configure, upload, create and recover a course Teaching Assistant

**Classification:** current.

**Actors**
- Teacher or administrator

**Actual agent, tool or worker**
- CACA course-agent-creation-agent via durable server workflow; material and curriculum workers; no separate LACA/TCA

**Permissions**
- Students are redirected from Create. Server draft ownership, active account and teacher/admin checks are authoritative; course metadata must not supply another owner.

**State changes**
- Form/picture/starters/files remain local until submission. Preflight and confirmed sequential uploads create an owner-bound draft; the browser stores a recovery job ID; backend queues creation and separate indexing/curriculum work.

**Success path**
- Fill required fields, review preflight, upload originals, explicitly Create, poll persisted status and open the TA while distinguishing creation/material/curriculum readiness.

**Failure and retry behavior**
- Saved job IDs allow reload/status recovery without repeated creation. Files not uploaded must be reselected. Retry reuses server checkpoints. Closing a recovery dialog does not cancel work; Start a new TA clears only local linkage after confirmation.

**API hand-offs**
- `POST /api/knowledge/preflight` (main); [domain-material-preflight](main-domains.md#domain-material-preflight).
- `POST /api/knowledge/drafts` (main); [domain-material-draft-upload](main-domains.md#domain-material-draft-upload).
- `POST /api/agents/create-async` (main); [domain-course-creation](main-domains.md#domain-course-creation).
- `GET /api/agents/creation-jobs/{job_id}` (main); [domain-course-creation](main-domains.md#domain-course-creation).
- `POST /api/agents/creation-jobs/{job_id}/retry` (main); [domain-course-creation](main-domains.md#domain-course-creation).

**Source evidence**
- [CreateView](<../../Agentic Shiksha Platform/Frontend/src/features/create/CreateView.tsx>)
- [SetupPhase](<../../Agentic Shiksha Platform/Frontend/src/features/create/SetupPhase.tsx>)
- [MaterialJobPanel](<../../Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx>)

**Existing guides**
- [docs/agents/course-creation.md](<../../docs/agents/course-creation.md>)
- [Agentic Shiksha Platform/Frontend/src/features/create/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/create/README.md>)

<a id="ui-course-companion"></a>
## Course Companion chat-only assistance, draft edits and Undo

**Classification:** current.

**Actors**
- Teacher/admin authoring or editing a course

**Actual agent, tool or worker**
- form-fill-assistant through POST /api/course-form/assist

**Permissions**
- The assistant is a teacher-facing form helper. Editing-disabled requests cannot write fields; the API validates roles/output and immutable fields are excluded.

**State changes**
- Maintains account/draft-or-TA-scoped browser conversation history and proposed form patches. Done acknowledges a patch; Undo restores only values not subsequently changed manually.

**Success path**
- Open the docked assistant, send current form context, review advice or allowed field changes, and explicitly Create/Update separately.

**Failure and retry behavior**
- Errors leave the form intact and retry uses current context. Stop, close, scope/account change, navigation and Create/Update prevent late responses overwriting the draft. The assistant does not upload files, provision a TA or save the form itself.

**API hand-offs**
- `POST /api/course-form/assist` (main); [domain-course-form-companion](main-domains.md#domain-course-form-companion).

**Source evidence**
- [FormAssistant](<../../Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx>)
- [applyCourseFormPatch](<../../Agentic Shiksha Platform/Frontend/src/features/create/builderTypes.ts>)
- [readCompanionHistory](<../../Agentic Shiksha Platform/Frontend/src/features/create/formAssistantHistory.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/create/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/create/README.md>)
- [Agentic Shiksha Platform/Frontend/src/features/edit/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/edit/README.md>)
- [docs/agents/README.md](<../../docs/agents/README.md>)

<a id="ui-edit-course"></a>
## Edit metadata/materials, regenerate instructions and preview compatibility

**Classification:** mixed.

**Actors**
- Permitted teacher/administrator editor

**Actual agent, tool or worker**
- Course TA version update; CACA regeneration; CCA builder and temporary-preview compatibility paths when explicitly used

**Permissions**
- UI owner/manage-code and role controls do not replace server course-edit checks. Existing TA name/identity/material-session fields are not freely reassigned.

**State changes**
- Local Simplistic/Advanced form and instruction drafts; explicit Update can save metadata, queue material updates and change remote agent versions. Companion history remains separately scoped.

**Success path**
- Load setup, edit allowed fields, inspect per-file readiness, preflight/uploads if needed, explicitly Update and wait for confirmed material readiness; preview is distinct from saved publication.

**Failure and retry behavior**
- Loading/failed setup cannot be overwritten by late assistance. Per-file/job status errors and retries remain visible. Dirty draft/assistant cancellation is preserved. Compatibility CCA/preview requests must not be described as the normal learner TA flow.

**API hand-offs**
- `GET /api/agents/setup/{agent_name}` (main); [main-agent-setup](main-service.md#main-agent-setup).
- `POST /api/cca/start` (main); [main-builder-conversations](main-service.md#main-builder-conversations).
- `POST /api/cca/step` (main); [main-builder-conversations](main-service.md#main-builder-conversations).
- `POST /api/agents/{agent_id}/update` (main); [main-agent-update](main-service.md#main-agent-update).

**Source evidence**
- [EditView](<../../Agentic Shiksha Platform/Frontend/src/features/edit/EditView.tsx>)
- [MaterialJobPanel](<../../Agentic Shiksha Platform/Frontend/src/features/create/MaterialWorkflow.tsx>)
- [updateTempPreviewAgent](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/edit/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/edit/README.md>)
- [docs/agents/README.md](<../../docs/agents/README.md>)

<a id="ui-research"></a>
## Optional research query, streamed progress and result inspection

**Classification:** optional.

**Actors**
- Signed-in user where the research UI is exposed and backend configured

**Actual agent, tool or worker**
- Configured deep-research integration; research side panel and clarifying-question selection

**Permissions**
- Role feature flags and a research toggle do not prove a backend model/tool is enabled. This is not the ordinary course-grounded turn or a mastery update.

**State changes**
- Local research query/activity/output state, cancellation controller, citations and saved research blocks in conversation history.

**Success path**
- Specify/refine the research question, run the supported research path, inspect streamed activity and open result/citations.

**Failure and retry behavior**
- Stop/abort and failures retain explicit incomplete/error states; retries can create new remote research work rather than transactionally resume prior runs. Source compatibility helpers exist even when a UI entry is not offered.

**API hand-offs**
- `POST /api/deep-research/stream` (main); [main-deep-research](main-service.md#main-deep-research).

**Source evidence**
- [useAgentChat](<../../Agentic Shiksha Platform/Frontend/src/features/chat/useAgentChat.ts>)
- [ResearchMCQ](<../../Agentic Shiksha Platform/Frontend/src/components/chat/ResearchMCQ.tsx>)
- [ResearchSidePanel](<../../Agentic Shiksha Platform/Frontend/src/components/chat/ResearchSidePanel.tsx>)
- [streamDeepResearch](<../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>)

**Existing guides**
- [docs/agents/README.md](<../../docs/agents/README.md>)
- [Agentic Shiksha Platform/Frontend/src/features/chat/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md>)

<a id="ui-teacher-dashboard"></a>
## Embedded teacher roster, learner evidence, usage, feedback and Insights

**Classification:** mixed.

**Actors**
- Teacher or permitted administrator in the main frontend

**Actual agent, tool or worker**
- Teacher-scoped analytics APIs and the agent configured by TEACHER_ANALYTICS_AGENT_NAME; optional graph-memory cohort/individual views

**Permissions**
- DashboardRoute checks page:dashboard for display; main teacher APIs construct authorized course/student scopes. This UI does not use the independent Admin Dashboard API for its core operations.

**State changes**
- Local selected course/student/tab/filter and asset preview; scoped Insights conversations/history in browser storage; analytic reads, optional explicit memory retry and streamed analytics answers.

**Success path**
- Open course overview/My Students/Usage/Feedback; inspect learner concepts/topics/assets or graph evidence; filter date/granularity; select Insights scope and ask a supported question.

**Failure and retry behavior**
- Loading/API errors expose retry or unavailable states; no records do not prove zero learning. Scope changes isolate insight history. Only students, usage and feedback are explicit section tabs; unrecognized section names fall back to overview, not hidden implemented analytics/evaluation pages.

**API hand-offs**
- `GET /api/teacher-dashboard/agents` (main); [main-teacher-roster](main-service.md#main-teacher-roster).
- `GET /api/teacher-dashboard/summary` (main); [main-teacher-roster](main-service.md#main-teacher-roster).
- `GET /api/teacher-dashboard/agents/{agent_id}/overview` (main); [main-teacher-roster](main-service.md#main-teacher-roster).
- `POST /api/teacher-dashboard/logging-agent/chat/stream` (main); [main-teacher-insights](main-service.md#main-teacher-insights).

**Source evidence**
- [TeacherDashboard](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx>)
- [StudentInsightsChat](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/TeacherDashboardPage.tsx>)
- [getAgentOverview](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/dashboardApi.ts>)
- [DASHBOARD_API_URL](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/lib/config.ts>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/features/dashboard/README.md](<../../Agentic Shiksha Platform/Frontend/src/features/dashboard/README.md>)
- [docs/agents/README.md](<../../docs/agents/README.md>)

<a id="ui-feedback"></a>
## Submit platform feedback and use message-level actions

**Classification:** current.

**Actors**
- Current user opening the feedback dialog
- Chat participant using available message actions

**Actual agent, tool or worker**
- No agent for platform feedback; message retry routes back through the existing TA turn

**Permissions**
- The dialog sends current account or anonymous fallback fields; client identity fields are not proof of server authentication. Message-action visibility is not an access boundary.

**State changes**
- Local sentiment/text/attachment draft; uploads attachment blobs then posts a feedback record. Copy is clipboard-local; retry/edit uses the normal generation lifecycle.

**Success path**
- Choose sentiment, enter feedback, optionally attach up to the UI limit, submit and show confirmation; close resets the dialog.

**Failure and retry behavior**
- Upload/post errors preserve a visible failure for retry. Earlier uploaded files can exist even if the feedback post fails. Clipboard/download capability is browser-dependent; do not infer every decorative thumbs action writes a backend record.

**API hand-offs**
- `POST /api/feedback/upload-image` (main); [main-feedback](main-service.md#main-feedback).
- `POST /api/feedback` (main); [main-feedback](main-service.md#main-feedback).

**Source evidence**
- [FeedbackDialog](<../../Agentic Shiksha Platform/Frontend/src/components/FeedbackDialog.tsx>)
- [ChatBubble](<../../Agentic Shiksha Platform/Frontend/src/features/chat/ChatBubble.tsx>)
- [Sidebar](<../../Agentic Shiksha Platform/Frontend/src/components/layout/Sidebar.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/components/README.md](<../../Agentic Shiksha Platform/Frontend/src/components/README.md>)

<a id="ui-support-navigation"></a>
## Help, learning guide, redirects, update notice and unknown routes

**Classification:** current.

**Actors**
- Visitor completing authentication routing
- Signed-in reader of Help/Learn
- User with an updated browser bundle

**Actual agent, tool or worker**
- No agent; static information, client routing and update presentation

**Permissions**
- Help/Learn and the protected catch-all inherit the main shell. Public route error components are also used by auth/share/join flows; a NotFoundPage is not server access enforcement.

**State changes**
- Navigation, local update/log-panel visibility and optional page reload; no domain model write merely from reading a guide.

**Success path**
- Root redirects to /home; /companion-appearance redirects to /create; Help/Learn show documentation; unknown paths show the not-found view.

**Failure and retry behavior**
- Route error boundaries and informational error pages offer recovery navigation. An update/reload can interrupt unsaved local drafts; static documentation is not a live feature-health check.

**API hand-offs**
- Local action or part of the surrounding chat/tool flow; no independent API request is implied.

**Source evidence**
- [router](<../../Agentic Shiksha Platform/Frontend/src/router.tsx>)
- [HelpPage](<../../Agentic Shiksha Platform/Frontend/src/pages/HelpPage.tsx>)
- [LearnPage](<../../Agentic Shiksha Platform/Frontend/src/pages/LearnPage.tsx>)
- [NotFoundPage](<../../Agentic Shiksha Platform/Frontend/src/pages/NotFoundPage.tsx>)
- [UpdateBanner](<../../Agentic Shiksha Platform/Frontend/src/components/UpdateBanner.tsx>)
- [LogViewer](<../../Agentic Shiksha Platform/Frontend/src/components/LogViewer.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

<a id="ui-companion-catalogue"></a>
## Decorative companion pose catalogue and development preview

**Classification:** mixed.

**Actors**
- Signed-in viewer
- Developer using the DEV-only preview route

**Actual agent, tool or worker**
- No agent; CatCompanion artwork/state and CSS animation

**Permissions**
- The normal catalogue inherits the shell. /preview/pet-animations is registered only when import.meta.env.DEV is true; it is not a production anonymous-learning endpoint.

**State changes**
- Local size, speed and playback selection; reduced-motion handling. No chat, learner-memory or assessment mutation.

**Success path**
- Inspect the actual sitting/walking/running/stretching/sleeping poses, pause or change presentation speed/size.

**Failure and retry behavior**
- Reduced motion shows still poses and disables movement. Missing animation support affects decoration, not whether an agent or tool completed work.

**API hand-offs**
- Local action or part of the surrounding chat/tool flow; no independent API request is implied.

**Source evidence**
- [CompanionAnimationsPage](<../../Agentic Shiksha Platform/Frontend/src/pages/CompanionAnimationsPage.tsx>)
- [CatCompanion](<../../Agentic Shiksha Platform/Frontend/src/components/chat/CatCompanion.tsx>)
- [router](<../../Agentic Shiksha Platform/Frontend/src/router.tsx>)

**Existing guides**
- [Agentic Shiksha Platform/Frontend/src/pages/README.md](<../../Agentic Shiksha Platform/Frontend/src/pages/README.md>)

## Explicit exclusions

- **Agentic Shiksha Platform/Frontend/src/pages/ProjectHomeView.tsx:** Retained module, not registered as a current route in router.tsx; do not invent a second course-home workflow.
- **Flashcards and Industrial Trainer:** Retired artifact families. Historical records can remain stored; they are filtered out of the current supported teaching surface.
- **assets/web/memory/index.html and other web galleries:** Static documentation/generated media, not application UI/API workflows or proof of a deployed memory-insights agent.
- **Unreferenced API helpers and unmounted builder files:** A client export or source file alone does not establish a user-reachable page. API-only compatibility endpoints are inventoried in backend guides.
