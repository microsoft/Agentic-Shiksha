# Contributing

Thank you for your interest in Agentic Shiksha.

## Contributor License Agreement

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
<https://cla.opensource.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply
follow the instructions provided by the bot. You will only need to do this once across
all repositories using our CLA.

## Code of Conduct

This project has adopted the
[Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), the
[Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/), or contact
[opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or
comments.

## Getting Help

See [SUPPORT.md](SUPPORT.md) for how to file issues and work through common setup
problems, and [FAQ.md](FAQ.md) for intended use, evaluation, safeguards and known
limitations.

## Reporting Security Issues

Do not open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md)
for the coordinated disclosure process.

## Repository Layout

| Path | Purpose |
| --- | --- |
| [Main platform](<Agentic Shiksha Platform/README.md>) | Main backend/frontend product boundary |
| [Main backend](<Agentic Shiksha Platform/Backend/README.md>) | FastAPI, agent runtime, tools and Azure integrations |
| [Main frontend](<Agentic Shiksha Platform/Frontend/README.md>) | React, TypeScript, Vite and embedded teacher dashboard |
| [Admin Dashboard](Admin-Dashboard/README.md) | Independent admin API and frontend |

## Development Setup

Use [INSTALL.md](INSTALL.md) for supported runtime versions, separate Python
environments, npm lockfile installation, public frontend settings and server-only
configuration. Run commands from the service directory named in that guide; the
repository root and `Agentic Shiksha Platform` are not installable applications.

## Running Tests

Use the [verification commands](INSTALL.md#verification) and the service-local test
READMEs. Select the smallest tests covering the change. Browser regressions use
intercepted synthetic APIs; application startup and integration scripts can contact
Azure. Check test setup rather than assuming a whole service is offline.

For main-frontend changes, `npm run build` includes `tsc -b` and the production Vite
build. A plain `vite build` does not perform the same TypeScript check. Backend
pytest output may report ordinary tests and subtests separately.

## Documentation maintenance

- Every maintained source, configuration, script or reference-material directory
  should have a `README.md`. Explain its purpose, real entry points, important
  boundaries and how to test it; link to its parent and relevant neighboring guides.
- Do not add README boilerplate inside dependencies, virtual environments, caches,
  generated bundles, test reports or private runtime-data folders. Document those
  outputs in the nearest maintained parent.
- Put setup commands in [INSTALL.md](INSTALL.md), and link there from service guides.
  Keep versions and commands aligned with manifests, lockfiles, Dockerfiles and CI.
- Keep cross-service concepts in the [design and operations guides](docs/README.md).
  Link agent and memory behavior to its current implementation, and distinguish
  research intent, disabled-by-default paths, and verified rollout status.
- Add user-visible changes to **Unreleased** in [CHANGELOG.md](CHANGELOG.md). Put
  upgrade actions, compatibility and known limitations in [RELEASE_NOTES.md](RELEASE_NOTES.md).
  Use actual release identifiers and dates only after a release is verified.
- Update nearby READMEs when behavior, paths or ownership change. Use relative links;
  wrap paths containing spaces in angle brackets. Verify both link targets and anchors.
- Never put deployment secrets, real learner examples, local account paths or private
  operational identifiers in documentation. Do not claim a build/test/deployment ran
  unless there is evidence.

## Pull Requests

1. Keep changes focused — one concern per pull request.
2. Run relevant tests and the affected service's build/type check. For documentation-only
   changes, verify commands, links and README coverage; application builds are not required.
3. Never commit `.env` files, credentials, or personal data. Test fixtures should use
   example addresses such as `user@example.com`.
4. Explain *why* in the PR description; the diff already shows *what*.
5. Include documentation and an Unreleased changelog entry for behavior or setup changes.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause
confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos is
subject to those third parties' policies.
