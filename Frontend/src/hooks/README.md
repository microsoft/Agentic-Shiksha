# src/hooks

Reusable React hooks that are not tied to a single feature.

| Hook | Purpose |
| --- | --- |
| [useUserRole.ts](useUserRole.ts) | Resolves the signed-in user's role. |
| [useSpeechRecognition.ts](useSpeechRecognition.ts) | Voice input via the browser Speech Recognition API. |

`useUserRole` is for **presentation only** — showing or hiding UI. Authorization is
enforced server-side on every protected route, and the two must not be conflated: a role
read in the browser can be altered by the user.

`useSpeechRecognition` depends on a browser API with uneven support and requires a
microphone permission prompt, so callers need a working path for the unsupported and
denied cases.

Feature-specific hooks stay with their feature — for example
[../features/chat/useAgentChat.ts](../features/chat/useAgentChat.ts).
