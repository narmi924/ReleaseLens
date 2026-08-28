<p align="center">
  <img src="./docs/assets/releaselens-mark.svg" width="104" alt="ReleaseLens orbital mark">
</p>

<h1 align="center">ReleaseLens</h1>

<p align="center">
  Release intelligence and a regression observatory for developer tools.<br>
  Traceable first-party evidence for one question: “What actually changed?”
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?style=flat-square&amp;logo=nextdotjs&amp;logoColor=white">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js%2022%2B-5FA04E?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white">
  <img alt="pnpm 9+" src="https://img.shields.io/badge/pnpm%209%2B-F69220?style=flat-square&amp;logo=pnpm&amp;logoColor=white">
  <img alt=".NET 10" src="https://img.shields.io/badge/.NET%2010-512BD4?style=flat-square&amp;logo=dotnet&amp;logoColor=white">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&amp;logo=playwright&amp;logoColor=white">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-141413?style=flat-square">
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./docs/methodology.md">Methodology</a> ·
  <a href="./docs/product-profiles.md">Product profiles</a> ·
  <a href="./docs/data-schema.md">Data schema</a> ·
  <a href="./docs/local-development.md">Local development</a>
</p>

---

ReleaseLens V1.0 is a static, evidence-first release-intelligence product. Its normalized observation history lives in Git; large artifacts are downloaded, verified, inspected or tested, and then discarded within a single observation. It has no database, account system, paid object storage, or always-on backend.

## What you get

| Product     | V1 release model                       | Key conclusion                                                                                                                            |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Microsoft Store / MSIX                 | Models DisplayCatalog visibility separately from experimental FE3 downloadability; x64 is primary and ARM64 evidence is non-blocking.     |
| Claude Code | Official native/recommended and WinGet | Compares official or officially recommended distribution surfaces, clearly exposing version drift without changing the developer machine. |
| Gemini CLI  | npm `latest` / `preview` / `nightly`   | Verifies registry integrity and package contents, recording channel history, interface snapshots, and promotion evidence.                 |

Live observation data lives in [`data/`](data/). Test fixtures live only in [`fixtures/`](fixtures/) and never reach production pages or the static API. Research, phase planning, and operator instructions stay in the ignored local `Local/` directory and are not part of the public repository.

## From upstream to an understandable conclusion

```text
first-party upstream
  -> source adapter -> candidate / SourceEvidence
  -> temporary artifact lease -> verify -> inspect / smoke
  -> diff + deterministic verdict + LKG + incident
  -> canonical Git data -> static JSON API / RSS / Atom / website
```

Every domain object has a schema version. `SourceEvidence`, `ArtifactEvidence`, `InterfaceEvidence`, `BehaviorEvidence`, `CommunityEvidence`, `ReleaseDiff`, `ReleaseVerdict`, LKG, and Incidents are all inspectable first-class data. Signed runtime download URLs, authentication data, temporary paths, and process state cannot be serialized into `data/` or the public site.

See [architecture](docs/architecture.md) for module boundaries, data flow, and automation; see [methodology](docs/methodology.md) for verdict rules and the declared test scope.

## Quick start

Requirements: Node.js 22+ and pnpm 9+. Do not use these commands to install, downgrade, update, or uninstall an existing Codex, Claude Code, or Gemini CLI installation on your development machine.

```powershell
pnpm install --frozen-lockfile
pnpm rl doctor
pnpm rl validate-data
pnpm build
pnpm e2e
```

Common observation commands:

```powershell
pnpm rl discover --all
pnpm rl observe --all
pnpm rl observe --product gemini-cli --force
pnpm rl refresh-community --recent 72h
pnpm rl build-public
pnpm rl validate-public
```

`observe` uses only temporary directories, a temporary HOME/profile, and an isolated npm prefix. Only artifacts that pass required verification may be executed. See [local development](docs/local-development.md) for detailed development, test, and cleanup rules.

## Deliverables

`pnpm build` produces a static Next.js site and versioned assets. Its primary entry points are:

- `/api/v1/index.json` and `/api/v1/products.json`
- `/api/v1/products/<product>/latest.json`
- `/api/v1/products/<product>/releases/<observation>.json`
- `/api/v1/incidents.json`
- `/rss.xml` and `/atom.xml`

`apps/web/public/api/` and the feeds are reproducible build output and are not committed to Git. Once deployed, visitors get a browsable ReleaseLens site and can consume the stable JSON and feeds directly. See [data schema](docs/data-schema.md) for endpoint fields, relationships, and safety constraints.

## Deploy to GitHub Pages

The repository contains three GitHub Actions workflows:

- `observe.yml`: runs hourly and manually on a hosted Windows runner under a concurrency guard. It commits only material changes to `data/`, then builds, validates, and publishes Pages.
- `ci.yml`: cross-platform unit, integration, build, Playwright, isolated tool-smoke, and first-party-source discovery checks.
- `deploy-pages.yml`: builds and deploys the static export to GitHub Pages on every push to `main`.

For the first deployment, create a public GitHub repository, push `main`, then set **Settings → Pages** to use **GitHub Actions**. The workflow reads GitHub Pages’ official configuration for `base_url` and `base_path`, so project pages, user pages, and configured custom domains work without code changes. The default project-page address is `https://<owner>.github.io/<repository>/`; a separate domain does not exist until you configure one.

No database, object storage, or server is required. Pushing the initial commit triggers CI and one Pages build/deployment. Afterwards, `observe.yml` observes upstream releases every hour on GitHub-hosted Windows runners; only material data changes produce a bot commit and redeployment.

## Important limitations

- `NO_REGRESSION_DETECTED` means only that no regression was detected within ReleaseLens’ declared, executed test scope. It is not a safety, quality, or compatibility guarantee.
- Microsoft FE3 is an undocumented experimental adapter that may change. DisplayCatalog visibility does not mean an artifact is downloadable; rollout races remain conservative, unverified evidence.
- The GitHub API, WinGet, and upstream delivery infrastructure may rate-limit or change. Such conditions become structured failure or unsupported evidence; they never produce fabricated success.
- ReleaseLens does not retain installers, scan for malware, invoke models or APIs, or replace vendor support channels.

See [product profiles](docs/product-profiles.md) for the differences between release surfaces.

## License

[MIT](LICENSE)
