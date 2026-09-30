# Engineering Assessment and Deep Research Brief

Assessment date: 2026-09-16.

Status: In progress. This report is being built from the current working tree, including uncommitted changes. It is not a certification of the deployed system. No application code, cloud resources, production records, credentials, or access policies are being changed for this assessment.

## Executive Direction

Keep the existing React/TypeScript and Python/FastAPI foundations unless measurements show a specific constraint. The first priorities are authoritative authentication and authorization, durable server-side persistence, bounded background work, measurable performance, and verified recovery. More infrastructure or a newer framework is not a substitute for those properties.

## Initial Evidence

### Critical: Chat Persistence Trusts Caller-Supplied Identity

- [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L10715>): `/api/chat/sync` receives `request.userId` and passes it directly to persistence helpers; its declaration has no authentication dependency.
- [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L10759>): `/api/chat/load/{user_id}` reads the supplied user partition without a route-level identity check.
- [Agentic Shiksha Platform/Backend/backend/main.py](<Agentic Shiksha Platform/Backend/backend/main.py#L788>): the application construction and nearby middleware do not establish an application-wide authentication requirement.
- [Agentic Shiksha Platform/Backend/tests/test_chat_initial_load.py](<Agentic Shiksha Platform/Backend/tests/test_chat_initial_load.py#L73>): existing sync tests make requests without authentication while exercising writes against mocked storage.

Working hypothesis: an application caller can request another user's chat data or submit writes under another user's ID unless an independently configured upstream control blocks the request. Upstream deployment controls have not been inspected; CORS is not authorization.

Discriminating check: send an unauthenticated local `TestClient` request with synthetic IDs and mocked persistence, and observe whether storage is reached. Do not test this against production.

## Assessment Boundaries

- Analyze all four services: main backend/frontend and admin backend/frontend, plus shared agent, retrieval, storage, CI, and deployment code.
- Distinguish directly verified behavior, static indicators, existing safeguards, recommendations, and unknown deployment facts.
- Do not copy environment files, tokens, cloud identifiers, private hostnames, real user records, uploaded material, or production transcripts into this report.
- Cost and capacity recommendations must state assumptions; no invented traffic, latency, spend, or savings estimates.
- Recommendations will be prioritized by impact, dependencies, effort, and a measurable acceptance test.

## Deep Research Export

A sanitized stack inventory, architecture description, measurements, constraints, and research prompt will be included after the audit. This report is the only intentional repository edit for this request.