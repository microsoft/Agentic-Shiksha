# Pages Directory

Route-level screens for the main platform. [router.tsx](../router.tsx) is the
source of truth for registered URLs; [MainLayout](../layouts/README.md) owns the
protected shell and shared context.

## Files

| File | Description |
|------|-------------|
| [LibraryView.tsx](LibraryView.tsx), [LibraryMedia.tsx](LibraryMedia.tsx) | TA library, previews and media browsing |
| [ChatView.tsx](ChatView.tsx) | Course chat, history, Course Info and artifact panes |
| [AssetsView.tsx](AssetsView.tsx) | Saved artifact filtering and navigation |
| [SharedChatView.tsx](SharedChatView.tsx) | Tokenized read-only conversation shares |
| [JoinAgentPage.tsx](JoinAgentPage.tsx) | TA invitation-code flow |
| [OnboardingPage.tsx](OnboardingPage.tsx) | Initial profile collection |
| [SettingsPage.tsx](SettingsPage.tsx) | Settings route |
| [LearnPage.tsx](LearnPage.tsx), [HelpPage.tsx](HelpPage.tsx), [NotFoundPage.tsx](NotFoundPage.tsx) | Information/help and unknown routes |
| [CompanionAnimationsPage.tsx](CompanionAnimationsPage.tsx) | Shared cat-pose catalogue and development preview |

## Page Components

### `LibraryView.tsx`
Agent library view displaying all created agents:
- Agents / Media section switcher with compact 32px-high controls
- Connect / Create header actions use the same 32px height; the page header,
  control widths and Create buttons elsewhere retain their existing sizing
- Agent cards with metadata (model, type, status)
- Plain-text `By <name>` attribution using assigned teachers, with creator fallback
- Quick actions: Chat, Edit, Delete
- Empty state for new users

### `ChatView.tsx`
Full-screen chat interface for conversing with agents:
- Unified chat container with message history
- Thread management for conversation context
- Real-time message streaming
- File attachment support
- Curriculum readiness notifications appear only while its panel is closed and are
  dismissed when the panel opens or the course changes, leaving its controls reachable.

### `CompanionAnimationsPage.tsx`
The `/companion-animations` catalogue previews only the five cat poses used in
chat: sitting, walking, running, stretching, and sleeping. It renders the shared
[CatCompanion](../components/chat/CatCompanion.tsx), not a separate copy of the
artwork. Previews default to 88 px and can switch to 44 px.
The sitting kitten is the character reference for the side-view poses. They share
the same round eyes and highlights, forehead markings, pink features, grey
haunches and tail, and rounded proportions. Filled limb segments overlap at
their animated joint pivots, including the running and stretching poses.
Walking and running use [companionCatGaits.ts](../components/chat/companionCatGaits.ts) to generate coordinated CSS
keyframes once. Two-bone leg positioning keeps stance paws level on the ground;
the four-beat walk and hind-to-front gallop coordinate their body and shadow
motion with contact and suspension phases, without a JavaScript frame loop.
Pause and speed controls apply to every animated part; the system reduced-motion
preference displays still poses and disables playback. The standalone
`/preview/pet-animations` route is available only in development.
Run the focused browser coverage with `npx playwright test companion-animations.spec.ts`.

## Navigation Flow

| URL | Screen/owner |
| --- | --- |
| `/home`, `/course/:courseName`, `/chat/:courseName/:threadId` | Course chat |
| `/library`, `/assets` | TA selection and saved artifacts |
| `/create` | [Create feature](../features/create/README.md), one course TA with durable recovery |
| `/edit/:courseName` | [Edit feature](../features/edit/README.md), simple/advanced modes |
| `/dashboard`, `/dashboard/:section` | [Embedded teacher dashboard](../features/dashboard/README.md) |
| `/settings`, `/onboarding` | Settings and initial profile |
| `/shared/:shareToken`, `/join/:code` | Distinct public share/invitation flows |
| `/companion-animations` | Shared cat-pose previews |

[main.tsx](../main.tsx) renders `RouterProvider`; the old `TcaLacaBuilderApp`,
`ChoosePhase` and `BuilderPhase` flow is not the active application.
[ProjectHomeView.tsx](ProjectHomeView.tsx) and [SettingsView.tsx](SettingsView.tsx)
are retained modules rather than the route-registration authority.

## State Management

Pages connect to:
- **Zustand Store** (`lib/chatStore.ts`) - Global user/agent state
- **Local State** - View-specific UI state
- **URL Params** - Navigation state (agent ID, view mode)

## Usage

Add or change routes in [router.tsx](../router.tsx), preserving authentication and
role gating. API authorization still belongs on the server. Verify deep links,
back/forward navigation, saved state and mobile layouts with the
[frontend browser tests](../../README.md#verification).
