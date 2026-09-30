# src/hooks

Reusable React hooks that are not tied to a single feature.

| Hook | Purpose |
| --- | --- |
| [useUserRole.ts](useUserRole.ts) | Resolves the signed-in user's role. |
| [useSpeechRecognition.ts](useSpeechRecognition.ts) | Azure Speech SDK dictation with backend-issued short-lived tokens and browser microphone metering. |

`useUserRole` is for **presentation only** — showing or hiding UI. Authorization is
enforced server-side on every protected route, and the two must not be conflated: a role
read in the browser can be altered by the user.

`useSpeechRecognition` obtains a token from `/api/speech/token`, then uses the Azure
Speech SDK and Web Audio APIs. It requires a secure browser context (HTTPS or
localhost), microphone permission and a configured speech service. Callers must
surface token/permission failures and stop recording when hidden or disabled.
Speech service keys must never be embedded in the frontend.

Feature-specific hooks stay with their feature — for example
[../features/chat/useAgentChat.ts](../features/chat/useAgentChat.ts).
