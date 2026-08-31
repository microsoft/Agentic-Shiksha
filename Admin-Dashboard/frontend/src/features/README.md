# src/features

Feature-scoped modules for the admin dashboard.

| Path | Purpose |
| --- | --- |
| [chat/](chat) | Message components for the analytics agent. |

Screens live in [../pages/](../pages); this folder holds the pieces they compose.

Small by design — the admin dashboard is mostly tables and a single chat surface, so most
of its logic sits in [../lib/](../lib) and the pages themselves.
