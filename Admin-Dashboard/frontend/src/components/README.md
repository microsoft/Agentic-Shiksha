# src/components

Components for the admin dashboard.

| Path | Purpose |
| --- | --- |
| [ImageQuotaCard.tsx](ImageQuotaCard.tsx) | Displays image-generation quota usage. |
| [chat/](chat) | Chat shell for the analytics agent. |
| [common/](common) | Shared presentational components. |
| [layout/](layout) | Page chrome. |
| [ui/](ui) | Primitives. |

`ImageQuotaCard` reads the weekly per-user, per-agent quota maintained by
[Backend/azure_services/persistence/image_quota.py](../../../../Backend/azure_services/persistence/image_quota.py).

Several components here are trimmed copies of their counterparts in
[Frontend/src/components/](../../../../Frontend/src/components). The duplication is
deliberate — this app does not need the teaching-specific rendering paths — but it means a
fix in one tree does not reach the other.
