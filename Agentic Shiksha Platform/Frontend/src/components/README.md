# Shared components

Reusable UI used by [pages](../pages/README.md) and [features](../features/README.md).

| Area | Responsibilities |
| --- | --- |
| [assets](assets/README.md) | Saved/generated artifact cards, payload dispatch and fullscreen panes |
| [auth](auth/README.md) | Sign-in, callback, route guards and sign-out |
| [chat](chat/README.md) | Chat shells, course metadata, learner profile and companion artwork |
| [common](common/README.md) | Markdown, file inputs and section navigation |
| [layout](layout/README.md) | Sidebar, headers and settings dialog |
| [ui](ui/README.md) | Local Radix/shadcn primitives and shared action buttons |

Direct children include [ManageCodeDialog.tsx](ManageCodeDialog.tsx),
[EditModeDialog.tsx](EditModeDialog.tsx), [FeedbackDialog.tsx](FeedbackDialog.tsx),
[LogViewer.tsx](LogViewer.tsx) and [UpdateBanner.tsx](UpdateBanner.tsx).

Keep props typed and prefer controlled state where the containing feature owns the
workflow. Preserve accessible names, keyboard/focus behavior, reduced motion and
narrow-screen layout. Validate shared changes on every caller, including embedded
teacher dashboards and create/edit forms.

Role-based visibility is not API authorization. Markdown and artifact parsing are
untrusted-input boundaries, not just presentation helpers.

See [frontend verification](../../README.md#verification) for the existing tests;
do not add another UI framework or separate implementation for an existing primitive.
